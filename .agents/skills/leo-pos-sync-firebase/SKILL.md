---
name: leo-pos-sync-firebase
description: Sincronización del POS Leonides entre dispositivos con Firebase Firestore — motor en src/services/sync.ts, sync incremental bidireccional con LWW (dirty/dirtyDel, getDoc previo, anti-clobber), sincronizar(config, { soloStores }) con subset de stores en el push y cascade de referencias en el pull, sync-on-write con debounce 1.5s, guard de concurrencia a nivel motor + SyncResult.omitirToast, config/meta en localStorage, lazy-loading de firebase, path pos/{syncToken}/{store}/{gid}, re-idenciación de IDs. Úsala al tocar sync/Ajustes/Sincronización, al cambiar de proyecto Firebase, o al depurar datos duplicados/desaparecidos entre PC y celular.
license: MIT
---

## Propósito

Documentar la sincronización del POS Leonides (PC ↔ celular) con **Firebase Firestore**, implementada como feature real de la app. La sincronización es **local-first**: el navegador local es la fuente principal; la nube (Firestore) es el canal de intercambio entre dispositivos.

**Modelo de consistencia**: sync **incremental bidireccional con LWW (last-write-wins)**. Ya NO es un full-repush ciego: cada dispositivo sube solo lo que cambió localmente (dirty-tracking) y nunca pisa un doc remoto más nuevo (`getDoc` previo + comparación de `_updatedAt`).

**Contexto histórico**: el plan original era MongoDB Atlas (Data API + wrapper decorator sobre `Storage`, ver skill `leo-pos-storage-sync-mongo`), pero la MongoDB Atlas **Data API de App Services se deprecó sept-2024 y se apagó el 30-sep-2025 (EOL)** — ese plan es INVIABLE. Se migró a Firebase Firestore.

## Cuándo usarla

- Antes de tocar cualquier cosa de sync: `src/services/sync.ts`, `src/ui/sync.ts`, `src/storage/index.ts` (hook de tracking), la card `#cardSync` de Ajustes.
- Al reportar datos duplicados, perdidos o sobrescritos entre dispositivos (bugs de merge/pull, pisar ediciones de otro dispositivo).
- Al cambiar de proyecto Firebase (otro projectId/token) o al activar el sync en un dispositivo nuevo.
- Al modificar la plantilla de Security Rules o el setup de Firestore (`docs/SYNC_FIREBASE.md`).
- Al agregar/depurar el auto-sync por timer, el botón "Sincronizar ahora" o el **sync por evento (sync-on-write)** que disparan los CRUD locales.

## Arquitectura (archivos clave)

```
src/services/sync.ts     # Motor de sync (PURA lógica, sin DOM) — push selectivo + LWW, pull con anti-clobber, migración legacy, subset de stores, sync-on-write, guard de concurrencia
src/ui/sync.ts           # Card #cardSync en Ajustes + window globals + timer auto-sync
src/storage/index.ts     # Dirty-tracking: setSyncTrackingHook / sinTracking sobre el singleton getStorage()
src/types.ts             # SyncConfig, SyncMeta (dirty/dirtyDel), SyncResult, SyncDoc
src/core/constants.ts    # SYNC_KEY, SYNC_META_KEY, RULES_TEMPLATE
docs/SYNC_FIREBASE.md    # Guía setup Spark + plantilla de rules (apunta a RULES_TEMPLATE como fuente de verdad)
package.json             # firebase@^12.17.1 — ÚNICA dependencia de runtime del proyecto
```

- **`src/services/sync.ts`**: funciones exportadas `generarCredenciales()`, `cargarConfig()`, `guardarConfig(): boolean`, `borrarConfig()`, `inicializarFirebase()`, `instalarTrackingSync()`, `sincronizar(config, opciones?)`. Config en localStorage, meta en key aparte, loader lazy de firebase. Motor incremental + LWW: push selectivo (solo filas nuevas sin gid + `dirty`/`dirtyDel`), `getDoc` previo a cada `setDoc`, tombstones con timestamp real, migración legacy (full-push único). Acepta `opciones.soloStores` (subset de stores), tiene guard de concurrencia a nivel motor y un scheduler **sync-on-write** con debounce (ver secciones "Flujo de sync" y "Sync por evento").
- **`src/storage/index.ts`**: costura del dirty-tracking (decorator `conTracking` sobre el backend real). `setSyncTrackingHook(hook)` registra el hook; `sinTracking(fn)` ejecuta `fn` con el tracking suprimido (contador `trackingDepth`). El hook se dispara tras `put`/`del` exitosos en AMBOS backends (IndexedDB y fallback localStorage) SOLO si `trackingDepth === 0`.
- **`src/ui/sync.ts`**: `initSync()` cableado en `main.ts` (junto a `initAjustes()`). Expone window globals para los `onclick` inline de `index.html`: `guardarSyncConfig`, `sincronizarAhora`, `desconectarSync`, `copiarReglas`, `cambiarIntervaloSync`.
- **`src/core/constants.ts`**: `SYNC_KEY = 'leonides_sync_v1'`, `SYNC_META_KEY = 'leonides_sync_meta_v1'`, `RULES_TEMPLATE` (plantilla compartida de Security Rules). La UI importa `RULES_TEMPLATE` y la doc apunta a ella — NO duplicar en otros sitios.
- **`docs/SYNC_FIREBASE.md`**: guía de setup con plan Spark, path, plantilla de rules y limitaciones.

## Modelo de datos en Firestore

- **Path**: `pos/{syncToken}/{store}/{docId}`. El `syncToken` es **segmento del path** (no campo de documento) y es la llave compartida entre dispositivos.
- **Shape del doc**: `SyncDoc<T> = { data: T; _gid: string; _dev: string; _updatedAt: number; _deleted?: boolean }`. `_updatedAt` es el timestamp REAL del último cambio (del push local o del remoto) — es la clave del LWW.
- **Stores** (4): `productos`, `clientes`, `ventas`, `abonos` (mismos nombres que las stores IndexedDB, ver skill `leo-pos-storage-sync-mongo`).
- La config y el token se guardan SOLO en localStorage de cada dispositivo (nunca como campo de documento).

## Modelo de datos local — `SyncMeta` + dirty-tracking

La meta vive en localStorage (`SYNC_META_KEY = 'leonides_sync_meta_v1'`):

- `gids[store][idLocal] = gid` — mapeo id local → gid compartido.
- `updatedAt[store][gid]` = timestamp del último valor conocido localmente (último push/import exitoso). **Ya NO se re-estampa masivamente en cada push**; solo se actualiza para los gids efectivamente subidos o importados.
- `dirty[store][gid]` = timestamp de la última **MODIFICACIÓN local pendiente** de subir. Clave = gid, valor = `Date.now()` del `put` local. Se limpia tras subirlo con éxito. **Ausente en metas legacy** (ver Migración).
- `dirtyDel[store][gid]` = timestamp del **BORRADO local pendiente**. El push lo sube como tombstone (`_deleted`) aplicando LWW contra el doc remoto.
- `lastSyncAt` / `lastPushAt` / `lastPullAt`.

**Tracking**: `main.ts` llama `instalarTrackingSync()` tras `initStorage()`, que registra un hook en `src/storage/index.ts`. El hook corre tras cada `put`/`del` del usuario sobre `getStorage()` y marca `dirty` (put) o `dirtyDel` (del) con `Date.now()` real. Escrituras sin gid conocido (id sin mapear) NO se marcan: el push detecta filas nuevas por ausencia de gid. Además de marcar, el hook dispara el **sync por evento** (sección "Sync por evento"): recolecta la store escrita y programa un sync automático con debounce.

## Flujo de sync

`sincronizar(config, opciones?)` acepta un **subset de stores**: con `opciones.soloStores` el **PUSH corre SOLO sobre esas stores** (solo sube las afectadas), pero el **PULL se amplía con el cascade de referencias** (`ampliarPullSubset`): si el subset incluye `ventas` → el pull incluye además `clientes` y `productos`; si incluye `abonos` → el pull incluye además `clientes`; sin `ventas`/`abonos` → el pull usa el subset tal cual. Sin la opción se sincronizan las 4 en orden canónico (comportamiento previo intacto). El subset preserva el orden `productos → clientes → ventas → abonos` (necesario para el remapeo de referencias del pull) y `fallidas` refleja solo las stores realmente procesadas. El snapshot/fusión de marcas concurrentes y la migración legacy siempre operan sobre el meta completo, no sobre el subset.

**Push (local → nube) = SELECTIVO + LWW** (`pushLocal`):
- Solo sube: (a) filas locales **sin gid** (nuevas — se les asigna gid en el momento), (b) gids en `dirty` (modificadas), (c) gids en `dirtyDel` (borradas → tombstone `_deleted` con su timestamp).
- Antes de cada `setDoc` lee `getDoc` del remoto: si `remoto._updatedAt >= stamp` (el remoto es igual o más nuevo) **NO escribe** y limpia la marca `dirty`/`dirtyDel` — el pull lo traerá al local. Local-first PERO el más nuevo gana.
- `_updatedAt` = timestamp REAL del cambio local (el de `dirty`/`dirtyDel`, o `Date.now()` solo para filas nuevas). **Ya NO es un `Date.now()` global de la store**.
- Tras subir con éxito se limpia `dirty`/`dirtyDel` y se actualiza `updatedAt[gid] = stamp`.
- Gids de `porGid` que ya no existen localmente y no tienen marca dirty se re-suben como tombstone (limpieza de restos remotos).

**Pull (nube → local)** (`pullRemote`):
- Para cada store lee los docs remotos; las stores con push fallido se **SKIP** (`fallidas`).
- **gid desconocido** → inserta el registro localmente SIN id (que IndexedDB/localStorage autoincrementen), registra `gid → idNuevo` y remapea referencias cruzadas. El write va envuelto en `sinTracking` (el pull no debe marcarse a sí mismo como dirty).
- **gid conocido** → solo aplica el doc remoto si `doc._dev !== config.deviceId` (viene de OTRO dispositivo) y es más nuevo (`doc._updatedAt > updatedAtLocal[gid]`, fallback a `lastSyncAt` para metas legacy) **Y** `!marcaLocalMasNueva(dirty, dirtyDel, gid, doc._updatedAt)`.
- **tombstone remoto** (`_deleted`) → borra localmente solo si el remoto es más nuevo y no hay marca local más nueva.

**Concurrencia durante el sync**:
- `capturarSnapshot(meta)` clona `dirty`/`dirtyDel` al INICIO de `sincronizar()` (justo tras `cargarMeta()`).
- `fusionarMarcasConcurrentes(meta, snapshot)` se llama en 2 puntos: ANTES del pull (para que el guard anti-clobber no pise una edición concurrente) y ANTES de `guardarMeta` (para no perder la marca al persistir). Fusiona SOLO marcas que el hook escribió DURANTE los awaits de red (gid ausente del snapshot o stamp > snapStamp); las del snapshot ya procesadas por el push NO se re-insertan.
- El **tracking queda ACTIVO durante todo el sync** (si el usuario edita en un await, el hook lo captura). Solo los 3 writes del pull (tombstone del, import put, update put) van envueltos con `sinTracking(...)` **por-operación**.
- **Guard de concurrencia a nivel motor**: flag module-level `syncEnCurso` envuelve TODO el cuerpo de `sincronizar` en `try/finally`. Si llega otra invocación (manual, timer o sync-on-write) mientras un sync corre → early-return con `{ ok: false, subidos: 0, importados: 0, errores: 0, omitirToast: true, mensaje: 'Ya hay una sincronización en curso.' }`. `omitirToast: true` marca resultados que la UI NO debe toastear (el sync-on-write es silencioso por diseño y no debe interrumpir con un toast de error). `src/ui/sync.ts` ya lo consume en `ejecutarSync` (`if (!res.omitirToast && (...)) toast(...)`).

**Migración legacy** (`necesitaMigracion`): si `meta.dirty == null` Y `gids` no vacío → full-push UNA vez (misma lógica LWW) para poblar la nube y `updatedAt`; se marca migrado (`meta.dirty = {}; meta.dirtyDel = {}`) SOLO si ninguna store falló (`fallidas.length === 0`). Si falla, reintenta completo el siguiente sync. El **sync por evento** también la respeta: al detectar meta legacy hace un full sync SIN subset en vez de sincronizar solo la store escrita (ver sección "Sync por evento").

## Sync por evento (sync-on-write)

Cada CRUD local (agregar/editar/eliminar → `put`/`del` sobre `getStorage()`) dispara el hook de tracking, que ADEMÁS de marcar `dirty`/`dirtyDel` recolecta la store en un `Set` pendiente module-level (`storesPendientesSync`) y programa un sync automático con **debounce TRAILING de `DEBOUNCE_SYNC_EVENTO_MS = 1500`** (constante interna de sync.ts). Cada write resetea el timer (`programarSyncPorEvento`) → una operación que toca varias stores (ej. una venta descuenta stock: `ventas` + `productos`) coalesce en UNA sola llamada a `sincronizar`. La recolección ocurre ANTES de los early-returns del marcado por gid → las filas nuevas sin gid y las metas legacy también programan el sync (el push las detecta por ausencia de gid).

Al cumplirse el debounce, `ejecutarSyncPorEvento()`:
- Captura y limpia el `Set` pendiente (`[...pendientes]`, `clear()`).
- Relee la config **fresca** con `cargarConfig()` (no cachea) — si no hay config/token → nada.
- Si hay un sync en curso (`syncEnCurso`) → **se descarta silenciosamente**; lo pendiente queda en `dirty`/`dirtyDel` (o sin gid si es fila nueva) y se subirá en el próximo sync.
- Si `necesitaMigracion(meta)` (meta legacy) → **FULL sync SIN subset** (migración one-time que pobla la nube).
- Si no → `sincronizar(config, { soloStores: pendientes })` con SOLO las stores afectadas en el push (ej. venta → `ventas` + `productos`; borrado → tombstone de esa store). El pull se amplía con el cascade de referencias: un pull que incluya `ventas`/`abonos` trae también `clientes` (+`productos` para `ventas`) para poder remapear referencias contra clientes/productos conocidos o nuevos.
- **Silencioso**: fire-and-forget (`void`, sin toasts, sin re-render de la card); en catch → `console.error`.
- **Independiente de `intervalMin`**: funciona incluso con auto-timer en 0 (`src/ui/sync.ts` no interviene).

**Sin loops de auto-sync**: los writes del pull van envueltos en `sinTracking(...)` por-operación → el hook NO se dispara con datos importados, así que el sync por evento nunca se re-dispara a sí mismo.

## TRAMPA CRÍTICA — IDs / re-idenciación

Los IDs locales son **numéricos autoincrement POR STORE** → dos dispositivos generan el mismo `id` (colisión). Al importar un gid desconocido:

1. Insertar SIN id → el backend asigna el siguiente id local y se registra el mapeo `gid → idNuevo` en `SyncMeta.gids[store]`.
2. **Orden de importación fijo**: `productos → clientes → ventas → abonos` (los clientes deben existir antes que las ventas/abonos que los referencian).
3. **Remapeo de referencias cruzadas** tras importar:
   - `abonos.clienteId`, `ventas.clienteId` → id local del cliente remapeado.
   - `ventas.items[].productoId` → id local del producto remapeado.
   - Ref no mapeable → `0`.

## Lazy-loading de firebase

- **Por qué**: mantener el bundle principal liviano; el chunk de firebase queda aparte (~662 KB / ~170 KB gzip) y solo se carga al sincronizar.
- **Cómo**: `import type` (tipos) + `await import('firebase/app')` / `await import('firebase/firestore')` DENTRO de la función que sincroniza. **NUNCA** `import` estático al tope del archivo.
- **Apps NOMBRADAS por proyecto**: `initializeApp(opts, 'leo-pos-' + projectId)` + `getApps().find(...)` para reutilizar la app existente (evita el error "app already exists" al cambiar de proyecto). Cache por projectId.
- **Cleanup**: en el catch se hace `deleteApp(app)` y se invalida el cache (`firestoreCache = null`).

## Anti-clobber (LWW — M2)

Sin esto, un push parcial fallido + pull posterior sobrescribe un edit local más nuevo con la versión remota vieja (pérdida silenciosa). Protección en capas:

1. **Push**: `getDoc` previo a cada `setDoc` — si `remoto._updatedAt >= stamp` no escribe (el remoto igual o más nuevo gana; el pull lo trae al local).
2. `SyncMeta.updatedAt[store][gid]` guarda el timestamp local por gid. En pull, para gids conocidos solo aplica el doc remoto si `doc._updatedAt > updatedAtLocal[gid]` (fallback a `lastSyncAt` solo para metas legacy sin `updatedAt`).
3. `marcaLocalMasNueva(dirty, dirtyDel, gid, stamp)` aplicada en AMBOS branches del pull (tombstone `_deleted` y live-doc): no aplica un doc remoto si hay marca `dirty`/`dirtyDel` local con timestamp > `doc._updatedAt`. El guard `doc._dev !== config.deviceId` se conserva (un doc del propio dispositivo nunca se re-aplica).
4. `pushLocal` retorna `fallidas: StoreName[]`; las stores con push fallido se SKIP en el pull (`if (fallidas.includes(store)) continue;`).
5. Al importar/aplicar un doc remoto se actualiza `updatedAt[store][gid]` con el `_updatedAt` remoto y se limpia `dirty`/`dirtyDel` del gid.

**Escenario A/B/A resuelto** (referencia mental): A sube X v1 (10:00) → B edita X v2 y sube (10:30) → A re-sincroniza sin tocar X (11:00) → A YA NO pisa a B: su push hace `getDoc`, ve `_updatedAt` de B más nuevo, no escribe; el pull trae v2 al local. Antes del refactor (full-repush ciego) esto perdía v2 silenciosamente.

## Contrato para otros módulos

- **Funciones exportadas** (`src/services/sync.ts`):
  - `generarCredenciales(): { syncToken: string; deviceId: string }`
  - `cargarConfig(): SyncConfig | null`
  - `guardarConfig(config: SyncConfig): boolean` (catch → false; la UI muestra toast de almacenamiento lleno)
  - `borrarConfig(): void`
  - `inicializarFirebase(config): Promise<Firestore | null>`
  - `instalarTrackingSync(): void` — registra el hook de dirty-tracking y dispara el **sync por evento** (debounce 1.5s); llamada en `main.ts` tras `initStorage()`.
  - `sincronizar(config, opciones?: { soloStores?: StoreName[] }): Promise<SyncResult>` — con `soloStores`, el push sube SOLO ese subset pero el pull se amplía con el cascade de referencias (`clientes`+`productos` si hay `ventas`; `clientes` si hay `abonos`); sin él, las 4 stores. Guard de concurrencia: si ya hay un sync en curso retorna `{ ok: false, omitirToast: true, mensaje: 'Ya hay una sincronización en curso.' }`.
- **API de storage** (`src/storage/index.ts`): `setSyncTrackingHook(hook: ((store, id, tipo: 'put' | 'del') => void) | null): void` y `sinTracking<T>(fn): Promise<T> | T`. El flag global `setSyncTrackingEnabled` fue **ELIMINADO** — usar `sinTracking` por-operación.
- **Constantes** (`src/core/constants.ts`): `SYNC_KEY`, `SYNC_META_KEY`, `RULES_TEMPLATE`.
- **Tipos** (`src/types.ts`):
  - `SyncConfig`: campos firebase opcionales + `syncToken`/`deviceId` obligatorios + `intervalMin`.
  - `SyncMeta`: `version: 1`, `deviceId`, `gids`, `updatedAt`, `dirty?`, `dirtyDel?`, `lastSyncAt`/`lastPushAt`/`lastPullAt`.
  - `SyncResult`: `ok`, `subidos`, `importados`, `errores`, `fallidas?: string[]`, `mensaje`, `omitirToast?: boolean` (true → la UI NO debe toastear el resultado; p. ej. el early-return de concurrencia del motor).
  - `SyncDoc<T = unknown>`.
- **Convenciones**: `intervalMin: 0` = auto-sync desactivado; `null/undefined` = default 5 (minutos). Mensajes/errores en español.

## Seguridad

- La `apiKey` de Firebase es **PÚBLICA por diseño** — no es un secreto; la seguridad real son las **Security Rules**: `match /pos/{syncToken}/{store}/{docId} { allow read, write: if syncToken == '<SYNC_TOKEN>'; }` + default deny (`allow read, write: if false;`).
- El `syncToken` es la llave maestra compartida entre dispositivos (segmento del path, se muestra en la UI). NO es un secreto absoluto: quien lo tenga accede a los datos de ese path.
- Config + token se guardan SOLO en localStorage de cada dispositivo; nunca como campo de documento.
- `guardarSyncConfig` valida el token pegado con regex `^[A-Za-z0-9_-]{1,128}$` (toast de error y no guarda si no cumple).
- **LWW es protección SOLO de cliente**: no se toca `RULES_TEMPLATE`; dos dispositivos escribiendo el MISMO path al MISMO tiempo se resuelven en la nube por último `setDoc`, pero el flujo normal evita pisar gracias a `getDoc` previo + `_updatedAt`.

## Errores comunes / trampas

- **Duplicate-app**: cambiar de proyecto Firebase revienta con "app already exists" hasta recargar si no se usan apps nombradas por proyecto + `getApps().find()` + `deleteApp` en catch.
- **Clobber con push fallido**: un pull con push parcial fallido sobrescribe datos locales — por eso se guarda `updatedAt` por gid, se SKIP la store que falló y se aplica `marcaLocalMasNueva` en ambos branches del pull.
- **Tombstones re-enviados**: tras subir un `_deleted` hay que limpiar el gid de `gids`/`updatedAt` y de `dirty`/`dirtyDel`. La fusión con snapshot (`fusionarMarcasConcurrentes`) evita que el hook re-inserte marcas ya procesadas por el push; sin el snapshot, `dirty` nunca se limpia y los tombstones se re-envían infinitamente.
- **Tracking global desactivado → pérdida silenciosa**: si se desactivara el tracking durante todo el sync (flag global), las ediciones del usuario en los awaits de red se perderían. Resuelto con `sinTracking` **por-operación** (el hook queda activo todo el sync) + snapshot/fusión puntual.
- **LIMITACIÓN CONOCIDA (no bloqueante)**: ventana de microsegundos si el usuario edita exactamente durante el tramo FINAL del pull (entre la fusión pre-pull y el procesamiento del gid en `pullRemote`). Es inherente al diseño hook→localStorage + fusión puntual; no requiere fix.
- **`doc.data` sin guard**: los docs remotos pueden tener forma inesperada; validar `if (!doc.data || typeof doc.data !== 'object' || Array.isArray(doc.data)) continue;`.
- **Token inválido**: el syncToken es segmento de path — validar con la regex antes de guardar (caracteres/espacios inválidos rompen la ruta).
- **localStorage lleno**: `guardarConfig()` retorna `false` en catch — la UI debe mostrar toast en vez de callar.
- **Sync-on-write silencioso a propósito**: el auto-sync por evento NO toastea ni re-renderiza; si falla solo sale en consola. Si un cambio local "no se sube", revisa: ¿hay config guardada?, ¿corría un sync manual/timer (el evento se descartó por `syncEnCurso`)?, ¿se cumplió el debounce de 1.5s? El pull NO re-dispara el evento (escribe bajo `sinTracking`).
- **Subset y referencias cruzadas (cascade del pull)**: al sincronizar un subset que incluya `ventas`/`abonos`, el PULL se amplía automáticamente con las stores de referencia (`clientes` y, para `ventas`, también `productos`) — `ampliarPullSubset` en `src/services/sync.ts`. El PUSH NO se amplía: sube solo las stores afectadas por el evento. El refMap del pull se resuelve contra TODAS las entidades de referencia que trae el pull: (a) entidades importadas en el MISMO pull (gid nuevo → id local recién asignado) y (b) entidades ya conocidas localmente (gid ya mapeado → id local de `SyncMeta.gids`), porque al procesar cada doc remoto de la store de referencia se registra `doc.data.id → id local` tanto para gids nuevos como conocidos. Por eso el cascade importa/lee clientes y productos antes de ventas/abonos (orden canónico `productos → clientes → ventas → abonos`). Una ref que NO está ni importada ni conocida en el pull cae en `0` (p. ej. un cliente borrado en todos los dispositivos o nunca subido). **Límite conocido (preexistente, fuera de alcance)**: si un dispositivo crea una venta que referencia un cliente IMPORTADO de otro dispositivo, el `clienteId` de esa venta usa el id LOCAL del creador, que no coincide con el `data.id` remoto del cliente → en el otro extremo puede caer en `0` incluso en full-sync.
- **`omitirToast` en la UI**: el `ejecutarSync` de `src/ui/sync.ts` evita el toast cuando `res.omitirToast` es true — el early-return de concurrencia del motor ("Ya hay una sincronización en curso.") NO llega a la UI como toast. El sync por evento además no toca la UI en absoluto (fire-and-forget).
- **NUNCA import estático de firebase** al tope del archivo: rompe el lazy-loading y engorda el bundle principal.
