import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { StoreName, SyncConfig, SyncDoc, SyncMeta, SyncResult } from '../types';
import { SYNC_KEY, SYNC_META_KEY } from '../core/constants';
import { getStorage } from '../storage';

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

async function pushLocal(
  db: Firestore,
  config: SyncConfig,
  meta: SyncMeta
): Promise<{ n: number; errores: number; fallidas: StoreName[] }> {
  const f = await import('firebase/firestore');
  let n = 0;
  let errores = 0;
  const fallidas: StoreName[] = [];
  for (const store of ORDEN) {
    try {
      const filas = await getStorage().getAll<Record<string, unknown>>(store);
      const now = Date.now();
      const porGid = gidsDe(meta, store);
      const ups = updatedAtDe(meta, store);
      const gidsActivos = new Set<string>();
      for (const fila of filas) {
        if (typeof fila.id !== 'number') continue;
        const gid = gidDe(meta, store, fila.id);
        gidsActivos.add(gid);
        await f.setDoc(f.doc(db, 'pos', config.syncToken, store, gid), {
          data: sinIndefinidos(fila),
          _gid: gid,
          _dev: config.deviceId,
          _updatedAt: now
        });
        ups[gid] = now;
        n++;
      }
      for (const [idStr, gid] of Object.entries(porGid)) {
        if (gidsActivos.has(gid)) continue;
        await f.setDoc(f.doc(db, 'pos', config.syncToken, store, gid), {
          data: { id: Number(idStr) },
          _gid: gid,
          _dev: config.deviceId,
          _updatedAt: now,
          _deleted: true
        });
        delete porGid[Number(idStr)];
        delete ups[gid];
        n++;
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

async function pullRemote(
  db: Firestore,
  config: SyncConfig,
  meta: SyncMeta,
  fallidas: StoreName[]
): Promise<{ n: number; errores: number; fallidas: StoreName[] }> {
  const f = await import('firebase/firestore');
  let n = 0;
  let errores = 0;
  const fallidasPull: StoreName[] = [];
  const refMap: RefMap = {};
  for (const store of ORDEN) {
    if (fallidas.includes(store)) continue;
    try {
      const porGid = gidsDe(meta, store);
      const ups = updatedAtDe(meta, store);
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
            await getStorage().del(store, idLocal);
            delete porGid[idLocal];
            delete ups[gid];
            n++;
          }
          continue;
        }
        if (idLocal == null) {
          const { id: _idOrigen, ...limpiado } = doc.data;
          const data = remapearReferencias(store, limpiado, refMap);
          const idNuevo = await getStorage().put(store, data);
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
          if (doc._dev !== config.deviceId && masNuevo) {
            const { id: _idOrigen, ...limpiado } = doc.data;
            const data = remapearReferencias(store, limpiado, refMap);
            await getStorage().put(store, { ...data, id: idLocal });
            ups[gid] = doc._updatedAt;
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

export async function sincronizar(config: SyncConfig): Promise<SyncResult> {
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
  const meta = cargarMeta();
  if (config.deviceId) meta.deviceId = config.deviceId;
  let subidos = 0;
  let importados = 0;
  let errores = 0;
  let fallidas: string[] = [];
  try {
    const push = await pushLocal(db, config, meta);
    meta.lastPushAt = Date.now();
    subidos = push.n;
    errores += push.errores;
    // TODO(n3): el push secuencial por store puede optimizarse con Promise.all por store si hace falta
    const pull = await pullRemote(db, config, meta, push.fallidas);
    meta.lastPullAt = Date.now();
    importados = pull.n;
    errores += pull.errores;
    fallidas = push.fallidas.concat(pull.fallidas);
    meta.lastSyncAt = Date.now();
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
}
