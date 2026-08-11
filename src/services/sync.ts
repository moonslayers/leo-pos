import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { StoreName, SyncConfig, SyncDoc, SyncMeta, SyncResult } from '../types';
import { SYNC_KEY, SYNC_META_KEY } from '../core/constants';
import { getStorage, setSyncTrackingHook, sinTracking } from '../storage';

const ORDEN: StoreName[] = ['productos', 'clientes', 'ventas', 'abonos'];

let firestoreCache: { project: string; db: Firestore } | null = null;

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generarCredenciales(): { syncToken: string; deviceId: string } {
  return { syncToken: uuid(), deviceId: uuid() };
}

export function cargarConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    if (!parsed || typeof parsed.syncToken !== 'string' || typeof parsed.deviceId !== 'string') return null;
    return parsed as SyncConfig;
  } catch {
    return null;
  }
}

export function guardarConfig(config: SyncConfig): boolean {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function borrarConfig(): void {
  localStorage.removeItem(SYNC_KEY);
}

export async function inicializarFirebase(config: SyncConfig): Promise<Firestore | null> {
  const project = config.projectId || '';
  if (firestoreCache && firestoreCache.project === project) return firestoreCache.db;
  let app: FirebaseApp | null = null;
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getFirestore } = await import('firebase/firestore');
    const appName = 'leo-pos-' + project;
    app = getApps().find((a) => a.name === appName) || initializeApp({
      apiKey: config.apiKey,
      projectId: config.projectId,
      appId: config.appId,
      authDomain: config.authDomain,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      measurementId: config.measurementId
    }, appName);
    const db = getFirestore(app);
    firestoreCache = { project, db };
    return db;
  } catch (e) {
    if (app) {
      try {
        const { deleteApp } = await import('firebase/app');
        await deleteApp(app);
      } catch {
        // el app ya estaba borrado; no es crítico
      }
    }
    firestoreCache = null;
    console.error('Error al inicializar Firebase:', e);
    return null;
  }
}

function cargarMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return { version: 1, deviceId: '', gids: {} };
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      version: 1,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
      gids: parsed.gids && typeof parsed.gids === 'object' ? parsed.gids : {},
      updatedAt: parsed.updatedAt && typeof parsed.updatedAt === 'object' ? parsed.updatedAt : {},
      dirty: parsed.dirty && typeof parsed.dirty === 'object' ? parsed.dirty : undefined,
      dirtyDel: parsed.dirtyDel && typeof parsed.dirtyDel === 'object' ? parsed.dirtyDel : undefined,
      lastSyncAt: parsed.lastSyncAt,
      lastPushAt: parsed.lastPushAt,
      lastPullAt: parsed.lastPullAt
    };
  } catch {
    return { version: 1, deviceId: '', gids: {} };
  }
}

function guardarMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.error('No se pudo guardar la meta de sincronización:', e);
  }
}

function gidsDe(meta: SyncMeta, store: StoreName): Record<number, string> {
  if (!meta.gids[store]) meta.gids[store] = {};
  return meta.gids[store]!;
}

function updatedAtDe(meta: SyncMeta, store: StoreName): Record<string, number> {
  if (!meta.updatedAt) meta.updatedAt = {};
  if (!meta.updatedAt[store]) meta.updatedAt[store] = {};
  return meta.updatedAt[store]!;
}

function dirtyDe(meta: SyncMeta, store: StoreName): Record<string, number> {
  if (!meta.dirty) meta.dirty = {};
  if (!meta.dirty[store]) meta.dirty[store] = {};
  return meta.dirty[store]!;
}

function dirtyDelDe(meta: SyncMeta, store: StoreName): Record<string, number> {
  if (!meta.dirtyDel) meta.dirtyDel = {};
  if (!meta.dirtyDel[store]) meta.dirtyDel[store] = {};
  return meta.dirtyDel[store]!;
}

function idLocalDe(porGid: Record<number, string>, gid: string): number {
  for (const [idStr, g] of Object.entries(porGid)) {
    if (g === gid) return Number(idStr);
  }
  return 0;
}

function gidDe(meta: SyncMeta, store: StoreName, id: number): string {
  const m = gidsDe(meta, store);
  if (!m[id]) m[id] = uuid();
  return m[id];
}

function sinIndefinidos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sinIndefinidos);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = sinIndefinidos(v);
    }
    return out;
  }
  return value;
}

interface ItemPush {
  gid: string;
  idLocal: number;
  stamp: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

/**
 * Push selectivo + LWW (last-write-wins):
 * - Solo sube lo que cambió localmente (filas nuevas sin gid, `dirty` y `dirtyDel`).
 * - Antes de cada `setDoc` lee el doc remoto y NO pisa si el remoto es igual o más
 *   nuevo (`remoto._updatedAt >= stamp`); el pull lo traerá al local.
 * - En modo `legacy` (meta antigua sin `dirty`/`dirtyDel`) hace un full-push UNA vez
 *   para poblar la nube y `updatedAt`; después queda incremental.
 */
async function pushLocal(
  db: Firestore,
  config: SyncConfig,
  meta: SyncMeta,
  legacy: boolean,
  stores: StoreName[]
): Promise<{ n: number; errores: number; fallidas: StoreName[] }> {
  const f = await import('firebase/firestore');
  let n = 0;
  let errores = 0;
  const fallidas: StoreName[] = [];
  for (const store of stores) {
    try {
      const filas = await getStorage().getAll<Record<string, unknown>>(store);
      const porGid = gidsDe(meta, store);
      const ups = updatedAtDe(meta, store);
      const dirty: Record<string, number> = legacy ? {} : dirtyDe(meta, store);
      const dirtyDel: Record<string, number> = legacy ? {} : dirtyDelDe(meta, store);
      const idAFila = new Map<number, Record<string, unknown>>();
      const gidAId = new Map<string, number>();
      const gidsActivos = new Set<string>();
      for (const fila of filas) {
        if (typeof fila.id !== 'number') continue;
        idAFila.set(fila.id, fila);
        const gid = porGid[fila.id];
        if (gid != null) {
          gidsActivos.add(gid);
          gidAId.set(gid, fila.id);
        }
      }
      const items: ItemPush[] = [];
      if (legacy) {
        for (const fila of filas) {
          if (typeof fila.id !== 'number') continue;
          const gid = gidDe(meta, store, fila.id);
          items.push({ gid, idLocal: fila.id, stamp: Date.now(), deleted: false, data: fila });
        }
        for (const [idStr, gid] of Object.entries(porGid)) {
          if (gidsActivos.has(gid)) continue;
          const idLocal = Number(idStr);
          items.push({ gid, idLocal, stamp: Date.now(), deleted: true, data: { id: idLocal } });
        }
      } else {
        for (const fila of filas) {
          if (typeof fila.id !== 'number') continue;
          const gid = porGid[fila.id];
          if (gid != null) continue;
          const nuevoGid = gidDe(meta, store, fila.id);
          items.push({ gid: nuevoGid, idLocal: fila.id, stamp: Date.now(), deleted: false, data: fila });
        }
        for (const [gid, stamp] of Object.entries(dirty)) {
          const idLocal = gidAId.get(gid);
          if (idLocal == null) {
            if (!(gid in dirtyDel)) {
              const idHuérfano = idLocalDe(porGid, gid);
              items.push({ gid, idLocal: idHuérfano, stamp, deleted: true, data: { id: idHuérfano } });
            }
            continue;
          }
          items.push({ gid, idLocal, stamp, deleted: false, data: idAFila.get(idLocal)! });
        }
        for (const [gid, stamp] of Object.entries(dirtyDel)) {
          if (gidAId.has(gid)) {
            delete dirtyDel[gid];
            continue;
          }
          const idLocal = idLocalDe(porGid, gid);
          items.push({ gid, idLocal, stamp, deleted: true, data: { id: idLocal } });
        }
        for (const [idStr, gid] of Object.entries(porGid)) {
          if (gidsActivos.has(gid)) continue;
          if (gid in dirtyDel || gid in dirty) continue;
          const idLocal = Number(idStr);
          items.push({ gid, idLocal, stamp: Date.now(), deleted: true, data: { id: idLocal } });
        }
      }
      for (const item of items) {
        const ref = f.doc(db, 'pos', config.syncToken, store, item.gid);
        const snap = await f.getDoc(ref);
        const remoto = snap.exists() ? (snap.data() as SyncDoc<Record<string, unknown>>) : null;
        const remotoU = remoto && typeof remoto._updatedAt === 'number' ? remoto._updatedAt : null;
        if (remotoU != null && remotoU >= item.stamp) {
          if (item.deleted) {
            delete dirtyDel[item.gid];
            delete dirty[item.gid];
            if (remoto!._deleted) {
              if (item.idLocal) delete porGid[item.idLocal];
              delete ups[item.gid];
            }
          } else {
            delete dirty[item.gid];
            delete dirtyDel[item.gid];
          }
          continue;
        }
        if (item.deleted) {
          await f.setDoc(ref, {
            data: item.data,
            _gid: item.gid,
            _dev: config.deviceId,
            _updatedAt: item.stamp,
            _deleted: true
          });
          delete dirtyDel[item.gid];
          delete dirty[item.gid];
          if (item.idLocal) delete porGid[item.idLocal];
          delete ups[item.gid];
          n++;
        } else {
          await f.setDoc(ref, {
            data: sinIndefinidos(item.data),
            _gid: item.gid,
            _dev: config.deviceId,
            _updatedAt: item.stamp
          });
          delete dirty[item.gid];
          delete dirtyDel[item.gid];
          ups[item.gid] = item.stamp;
          n++;
        }
      }
    } catch (e) {
      errores++;
      fallidas.push(store);
      console.error(`Error al subir ${store}:`, e);
    }
  }
  return { n, errores, fallidas };
}

type RefMap = Partial<Record<StoreName, Map<number, number>>>;

function remapearReferencias(
  store: StoreName,
  data: Record<string, unknown>,
  refMap: RefMap
): Record<string, unknown> {
  if (store === 'abonos') {
    if (typeof data.clienteId === 'number') {
      const nuevo = refMap.clientes?.get(data.clienteId);
      data.clienteId = nuevo != null ? nuevo : 0;
    }
  } else if (store === 'ventas') {
    if (typeof data.clienteId === 'number') {
      const nuevo = refMap.clientes?.get(data.clienteId);
      data.clienteId = nuevo != null ? nuevo : 0;
    }
    if (Array.isArray(data.items)) {
      data.items = (data.items as Record<string, unknown>[]).map((item) => {
        const copia = { ...item };
        if (typeof copia.productoId === 'number') {
          const nuevo = refMap.productos?.get(copia.productoId);
          copia.productoId = nuevo != null ? nuevo : 0;
        }
        return copia;
      });
    }
  }
  return data;
}

/**
 * Guard anti-clobber del pull: true si hay una marca local (modificación en
 * `dirty` o borrado en `dirtyDel`) MÁS NUEVA que el doc remoto. En ese caso NO
 * se aplica el doc remoto: la edición/borrado local gana (LWW).
 */
function marcaLocalMasNueva(
  dirty: Record<string, number> | undefined,
  dirtyDel: Record<string, number> | undefined,
  gid: string,
  stamp: number
): boolean {
  const d = dirty ? dirty[gid] : undefined;
  const dd = dirtyDel ? dirtyDel[gid] : undefined;
  return (d != null && d > stamp) || (dd != null && dd > stamp);
}

async function pullRemote(
  db: Firestore,
  config: SyncConfig,
  meta: SyncMeta,
  fallidas: StoreName[],
  stores: StoreName[]
): Promise<{ n: number; errores: number; fallidas: StoreName[] }> {
  const f = await import('firebase/firestore');
  let n = 0;
  let errores = 0;
  const fallidasPull: StoreName[] = [];
  const refMap: RefMap = {};
  for (const store of stores) {
    if (fallidas.includes(store)) continue;
    try {
      const porGid = gidsDe(meta, store);
      const ups = updatedAtDe(meta, store);
      const dirty = meta.dirty && meta.dirty[store] ? meta.dirty[store]! : {};
      const dirtyDel = meta.dirtyDel && meta.dirtyDel[store] ? meta.dirtyDel[store]! : {};
      const gidAId = new Map<string, number>();
      for (const [idStr, gid] of Object.entries(porGid)) gidAId.set(gid, Number(idStr));
      const remap = new Map<number, number>();
      refMap[store] = remap;
      const snaps = await f.getDocs(f.collection(db, 'pos', config.syncToken, store));
      for (const snap of snaps.docs) {
        const doc = snap.data() as SyncDoc<Record<string, unknown>>;
        const gid = typeof doc._gid === 'string' ? doc._gid : snap.id;
        if (!doc.data || typeof doc.data !== 'object' || Array.isArray(doc.data)) continue;
        const idLocal = gidAId.get(gid);
        const idOrigen = typeof doc.data.id === 'number' ? doc.data.id : undefined;
        if (doc._deleted) {
          if (idLocal != null) {
            const localU = ups[gid];
            const masNuevo = localU == null
              ? doc._updatedAt > (meta.lastSyncAt || 0)
              : doc._updatedAt > localU;
            if (masNuevo && !marcaLocalMasNueva(dirty, dirtyDel, gid, doc._updatedAt)) {
              await sinTracking(() => getStorage().del(store, idLocal));
              delete porGid[idLocal];
              delete ups[gid];
              delete dirty[gid];
              delete dirtyDel[gid];
              n++;
            }
          }
          continue;
        }
        if (idLocal == null) {
          const { id: _idOrigen, ...limpiado } = doc.data;
          const data = remapearReferencias(store, limpiado, refMap);
          const idNuevo = await sinTracking(() => getStorage().put(store, data));
          porGid[idNuevo] = gid;
          ups[gid] = typeof doc._updatedAt === 'number' ? doc._updatedAt : Date.now();
          if (idOrigen != null) remap.set(idOrigen, idNuevo);
          n++;
        } else {
          if (idOrigen != null) remap.set(idOrigen, idLocal);
          const localU = ups[gid];
          const masNuevo = localU == null
            ? doc._updatedAt > (meta.lastSyncAt || 0)
            : doc._updatedAt > localU;
          if (doc._dev !== config.deviceId && masNuevo && !marcaLocalMasNueva(dirty, dirtyDel, gid, doc._updatedAt)) {
            const { id: _idOrigen, ...limpiado } = doc.data;
            const data = remapearReferencias(store, limpiado, refMap);
            await sinTracking(() => getStorage().put(store, { ...data, id: idLocal }));
            ups[gid] = doc._updatedAt;
            delete dirty[gid];
            delete dirtyDel[gid];
            n++;
          }
        }
      }
    } catch (e) {
      errores++;
      fallidasPull.push(store);
      console.error(`Error al importar ${store}:`, e);
    }
  }
  return { n, errores, fallidas: fallidasPull };
}

/**
 * Guard de concurrencia a nivel motor: true mientras un `sincronizar` está en
 * curso. Si se invoca otro sync (timer, manual o sync-on-write) se retorna de
 * inmediato un resultado con `omitirToast` para que la UI no toastee.
 */
let syncEnCurso = false;

/** Debounce TRAILING del sync por evento: cada escritura resetea el timer, así
 *  una operación que escribe varias stores (ej. venta → ventas + productos por
 *  stock) coalesce en UNA llamada a `sincronizar`. */
const DEBOUNCE_SYNC_EVENTO_MS = 1500;

const storesPendientesSync = new Set<StoreName>();
let timerSyncEvento: ReturnType<typeof globalThis.setTimeout> | null = null;

function programarSyncPorEvento(store: StoreName): void {
  storesPendientesSync.add(store);
  if (timerSyncEvento !== null) globalThis.clearTimeout(timerSyncEvento);
  timerSyncEvento = globalThis.setTimeout(() => {
    timerSyncEvento = null;
    void ejecutarSyncPorEvento();
  }, DEBOUNCE_SYNC_EVENTO_MS);
}

async function ejecutarSyncPorEvento(): Promise<void> {
  if (storesPendientesSync.size === 0) return;
  const pendientes = [...storesPendientesSync];
  storesPendientesSync.clear();
  const config = cargarConfig();
  if (!config || !config.syncToken) return;
  if (syncEnCurso) return;
  const meta = cargarMeta();
  try {
    if (necesitaMigracion(meta)) {
      await sincronizar(config);
    } else {
      await sincronizar(config, { soloStores: pendientes });
    }
  } catch (e) {
    console.error('Error en la sincronización automática por evento:', e);
  }
}

export function instalarTrackingSync(): void {
  setSyncTrackingHook((store, id, tipo) => {
    const config = cargarConfig();
    if (!config || !config.syncToken) return;
    programarSyncPorEvento(store);
    const meta = cargarMeta();
    if (!meta.dirty || !meta.dirtyDel) return;
    const porGid = meta.gids[store];
    if (!porGid) return;
    const gid = porGid[id];
    if (!gid) return;
    const dirty = dirtyDe(meta, store);
    const dirtyDel = dirtyDelDe(meta, store);
    if (tipo === 'del') {
      dirtyDel[gid] = Date.now();
      delete dirty[gid];
    } else {
      dirty[gid] = Date.now();
    }
    guardarMeta(meta);
  });
}

/**
 * Migración legacy: las metas creadas por la versión anterior no tienen
 * `dirty`/`dirtyDel`. Se detecta en la primera ejecución tras este cambio
 * (dirty ausente PERO gids ya poblados) y se hace un full-push UNA vez para
 * poblar la nube y `updatedAt`. Al completarse todas las stores, se inicializa
 * `dirty`/`dirtyDel` y el sync queda incremental.
 */
function necesitaMigracion(meta: SyncMeta): boolean {
  return meta.dirty == null && Object.keys(meta.gids).length > 0;
}

type MarcasSnapshot = {
  dirty: Partial<Record<StoreName, Record<string, number>>>;
  dirtyDel: Partial<Record<StoreName, Record<string, number>>>;
};

/**
 * Snapshot (clon) de las marcas dirty/dirtyDel al INICIO del sync, justo tras
 * `cargarMeta()`. La fusión compara contra este snapshot para distinguir las
 * marcas ya procesadas por el push de las que el hook añadió DURANTE el sync
 * (ediciones concurrentes del usuario en los awaits de red).
 */
function capturarSnapshot(meta: SyncMeta): MarcasSnapshot {
  const snapshot: MarcasSnapshot = { dirty: {}, dirtyDel: {} };
  for (const store of ORDEN) {
    if (meta.dirty && meta.dirty[store]) snapshot.dirty[store] = { ...meta.dirty[store] };
    if (meta.dirtyDel && meta.dirtyDel[store]) snapshot.dirtyDel[store] = { ...meta.dirtyDel[store] };
  }
  return snapshot;
}

/**
 * Fusiona en la meta en memoria SOLO las marcas dirty/dirtyDel que el hook añadió
 * DESPUÉS del snapshot (ediciones concurrentes durante los awaits de red). Las
 * marcas que estaban en el snapshot ya fueron procesadas por el push y NO se
 * restauran (evita reprocesamiento infinito). Se llama:
 * 1) ANTES del pull, para que el guard anti-clobber no sobrescriba una edición
 *    concurrente con un doc remoto.
 * 2) ANTES de `guardarMeta`, para no pisar esas marcas al persistir la meta.
 * Solo se fusionan marcas; `updatedAt`/`gids` de la meta en memoria ganan.
 */
function fusionarMarcasConcurrentes(meta: SyncMeta, snapshot: MarcasSnapshot): void {
  const fresca = cargarMeta();
  for (const store of ORDEN) {
    fusionarTipoDeMarca(meta.dirty, snapshot.dirty, fresca.dirty, store);
    fusionarTipoDeMarca(meta.dirtyDel, snapshot.dirtyDel, fresca.dirtyDel, store);
  }
}

function fusionarTipoDeMarca(
  metaMap: Partial<Record<StoreName, Record<string, number>>> | undefined,
  snapshotMap: Partial<Record<StoreName, Record<string, number>>>,
  frescaMap: Partial<Record<StoreName, Record<string, number>>> | undefined,
  store: StoreName
): void {
  if (!metaMap || !frescaMap || !frescaMap[store]) return;
  const snapStore = snapshotMap[store];
  const objetivo = metaMap[store] ?? {};
  for (const [gid, stamp] of Object.entries(frescaMap[store]!)) {
    const snapStamp = snapStore ? snapStore[gid] : undefined;
    const esNueva = snapStamp === undefined || stamp > snapStamp;
    if (esNueva && (!(gid in objetivo) || objetivo[gid] < stamp)) objetivo[gid] = stamp;
  }
  metaMap[store] = objetivo;
}

export interface OpcionesSincronizar {
  /** Subconjunto de stores a sincronizar. Si se omite o está vacío, se
   *  sincronizan las 4 stores en el orden canónico `ORDEN`. El PUSH usa el
   *  subset tal cual; el PULL lo amplía con las stores de referencia que
   *  ventas/abonos referencian (ver `ampliarPullSubset`). */
  soloStores?: StoreName[];
}

/**
 * Amplía el subset del PULL con las stores de referencia necesarias para
 * remapear referencias cruzadas (`ventas.clienteId`, `abonos.clienteId`,
 * `ventas.items[].productoId`):
 * - Si el subset incluye `ventas` → el pull incluye además `clientes` y `productos`.
 * - Si el subset incluye `abonos` → el pull incluye además `clientes`.
 * - Sin `ventas`/`abonos` → el pull usa el subset tal cual.
 * El PUSH NO se amplía: solo sube las stores afectadas por el evento.
 * Preserva el orden canónico `ORDEN` (las referencias se procesan antes que
 * sus referentes). En full-sync (subset = `ORDEN`) es un no-op.
 */
function ampliarPullSubset(stores: StoreName[]): StoreName[] {
  const conjunto = new Set<StoreName>(stores);
  if (conjunto.has('ventas')) {
    conjunto.add('clientes');
    conjunto.add('productos');
  }
  if (conjunto.has('abonos')) conjunto.add('clientes');
  return ORDEN.filter((s) => conjunto.has(s));
}

export async function sincronizar(
  config: SyncConfig,
  opciones?: OpcionesSincronizar
): Promise<SyncResult> {
  if (syncEnCurso) {
    return {
      ok: false,
      subidos: 0,
      importados: 0,
      errores: 0,
      omitirToast: true,
      mensaje: 'Ya hay una sincronización en curso.'
    };
  }
  syncEnCurso = true;
  try {
    if (!config || !config.syncToken) {
      return {
        ok: false,
        subidos: 0,
        importados: 0,
        errores: 0,
        mensaje: 'Falta la configuración de sincronización. Actívala en Ajustes.'
      };
    }
    const db = await inicializarFirebase(config);
    if (!db) {
      return {
        ok: false,
        subidos: 0,
        importados: 0,
        errores: 0,
        mensaje: 'No se pudo conectar con Firebase. Revisa la configuración.'
      };
    }
    const solo = opciones?.soloStores;
    const stores = solo && solo.length > 0 ? ORDEN.filter((s) => solo.includes(s)) : ORDEN;
    const storesPull = ampliarPullSubset(stores);
    const meta = cargarMeta();
    if (config.deviceId) meta.deviceId = config.deviceId;
    const legacy = necesitaMigracion(meta);
    const snapshot = capturarSnapshot(meta);
    let subidos = 0;
    let importados = 0;
    let errores = 0;
    let fallidas: string[] = [];
    try {
      // El tracking queda ACTIVO durante todo el sync: si el usuario edita algo en
      // los awaits de red, el hook marca dirty en localStorage. Solo los writes del
      // pull se suprimen por-operación con `sinTracking`. Se fusionan las marcas
      // concurrentes ANTES del pull (para no sobrescribir una edición) y ANTES de
      // persistir (para no pisar la marca).
      const push = await pushLocal(db, config, meta, legacy, stores);
      meta.lastPushAt = Date.now();
      subidos = push.n;
      errores += push.errores;
      if (legacy && push.fallidas.length === 0) {
        meta.dirty = {};
        meta.dirtyDel = {};
      }
      fusionarMarcasConcurrentes(meta, snapshot);
      // TODO(n3): el push secuencial por store puede optimizarse con Promise.all por store si hace falta
      const pull = await pullRemote(db, config, meta, push.fallidas, storesPull);
      meta.lastPullAt = Date.now();
      importados = pull.n;
      errores += pull.errores;
      fallidas = push.fallidas.concat(pull.fallidas);
      meta.lastSyncAt = Date.now();
      fusionarMarcasConcurrentes(meta, snapshot);
      guardarMeta(meta);
      if (errores > 0) {
        const detalle = fallidas.length ? ` Falló: ${fallidas.join(', ')}.` : '';
        return {
          ok: true,
          subidos,
          importados,
          errores,
          fallidas,
          mensaje: `Sincronización con errores parciales: ${subidos} subidos, ${importados} importados, ${errores} errores.${detalle}`
        };
      }
      return {
        ok: true,
        subidos,
        importados,
        errores,
        mensaje: `Sincronización completada: ${subidos} subidos, ${importados} importados.`
      };
    } catch (e) {
      guardarMeta(meta);
      console.error('Error en la sincronización:', e);
      const detalle = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        subidos,
        importados,
        errores,
        fallidas,
        mensaje: `Error durante la sincronización: ${detalle}`
      };
    }
  } finally {
    syncEnCurso = false;
  }
}
