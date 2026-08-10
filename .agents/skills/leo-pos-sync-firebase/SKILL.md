---
name: leo-pos-sync-firebase
description: Sincronización del POS Leonides entre dispositivos con Firebase Firestore — motor en src/services/sync.ts, config/meta en localStorage, lazy-loading de firebase, path pos/{syncToken}/{store}/{gid}, re-idenciación de IDs y merge anti-clobber. Úsala al tocar sync/Ajustes/Sincronización, al cambiar de proyecto Firebase, o al depurar datos duplicados/desaparecidos entre PC y celular.
license: MIT
---

## Propósito

Documentar la sincronización del POS Leonides (PC ↔ celular) con **Firebase Firestore**, implementada como feature real de la app. La sincronización es **local-first**: el navegador local es la fuente principal; la nube (Firestore) es el canal de intercambio entre dispositivos.

**Contexto histórico**: el plan original era MongoDB Atlas (Data API + wrapper decorator sobre `Storage`, ver skill `leo-pos-storage-sync-mongo`), pero la MongoDB Atlas **Data API de App Services se deprecó sept-2024 y se apagó el 30-sep-2025 (EOL)** — ese plan es INVIABLE. Se migró a Firebase Firestore.

## Cuándo usarla

- Antes de tocar cualquier cosa de sync: `src/services/sync.ts`, `src/ui/sync.ts`, la card `#cardSync` de Ajustes.
- Al reportar datos duplicados, perdidos o sobrescritos entre dispositivos (bugs de merge/pull).
- Al cambiar de proyecto Firebase (otro projectId/token) o al activar el sync en un dispositivo nuevo.
- Al modificar la plantilla de Security Rules o el setup de Firestore (`docs/SYNC_FIREBASE.md`).
- Al agregar/depurar el auto-sync por timer o el botón "Sincronizar ahora".

## Arquitectura (archivos clave)

```
src/services/sync.ts     # Motor de sync (PURA lógica, sin DOM)
src/ui/sync.ts           # Card #cardSync en Ajustes + window globals + timer auto-sync
src/types.ts             # SyncConfig, SyncMeta, SyncResult, SyncDoc (líneas 95-130 aprox.)
src/core/constants.ts    # SYNC_KEY, SYNC_META_KEY, RULES_TEMPLATE (líneas 8-9, 28-65)
docs/SYNC_FIREBASE.md    # Guía setup Spark + plantilla de rules (apunta a RULES_TEMPLATE como fuente de verdad)
package.json             # firebase@^12.17.1 — ÚNICA dependencia de runtime del proyecto
```

- **`src/services/sync.ts`**: funciones exportadas `generarCredenciales()`, `cargarConfig()`, `guardarConfig(): boolean`, `borrarConfig()`, `inicializarFirebase()`, `sincronizar()`. Config en localStorage, meta en key aparte, loader lazy de firebase.
- **`src/ui/sync.ts`**: `initSync()` cableado en `main.ts` (junto a `initAjustes()`). Expone window globals para los `onclick` inline de `index.html`: `guardarSyncConfig`, `sincronizarAhora`, `desconectarSync`, `copiarReglas`, `cambiarIntervaloSync`.
- **`src/core/constants.ts`**: `SYNC_KEY = 'leonides_sync_v1'`, `SYNC_META_KEY = 'leonides_sync_meta_v1'`, `RULES_TEMPLATE` (plantilla compartida de Security Rules). La UI importa `RULES_TEMPLATE` y la doc apunta a ella — NO duplicar en otros sitios.
- **`docs/SYNC_FIREBASE.md`**: guía de setup con plan Spark, path, plantilla de rules y limitaciones.

## Modelo de datos en Firestore

- **Path**: `pos/{syncToken}/{store}/{docId}`. El `syncToken` es **segmento del path** (no campo de documento) y es la llave compartida entre dispositivos.
- **Shape del doc**: `SyncDoc<T> = { data: T; _gid: string; _dev: string; _updatedAt: number; _deleted?: boolean }`.
- **Stores** (4): `productos`, `clientes`, `ventas`, `abonos` (mismos nombres que las stores IndexedDB, ver skill `leo-pos-storage-sync-mongo`).
- La config y el token se guardan SOLO en localStorage de cada dispositivo (nunca como campo de documento).

## Flujo de sync

**Push (local → nube)**: `setDoc` upsert por gid en `pos/{syncToken}/{store}/{gid}` con `_updatedAt = Date.now()`. Los registros borrados localmente se envían como **tombstone** (`_deleted: true`); tras enviarlo se limpia el gid del mapa persistido (`gids`/`updatedAt`) para NO re-enviarlo infinitamente. Local-first: **el último push gana** en la nube (sobrescribe la versión anterior).

**Pull (nube → local)**: para cada store lee los docs remotos:
- **gid desconocido** → inserta el registro localmente SIN id (que IndexedDB/localStorage autoincrementen) y registra `gid → idNuevo`.
- **gid conocido** → solo aplica el doc remoto si viene de OTRO dispositivo (`doc._dev !== deviceId`) y `doc._updatedAt > updatedAtLocal[gid]` (ver Anti-clobber).
- Las stores con push fallido se **SKIP** en el pull.

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

## Anti-clobber (M2)

Sin esto, un push parcial fallido + pull posterior sobrescribe un edit local más nuevo con la versión remota vieja (pérdida silenciosa). Protección doble:

1. `SyncMeta.updatedAt[store][gid]` guarda el timestamp local por gid. En pull, para gids conocidos solo aplica el doc remoto si `doc._updatedAt > updatedAtLocal[gid]` (fallback a `lastSyncAt` solo para metas legacy sin `updatedAt`).
2. `pushLocal` retorna `fallidas: StoreName[]`; las stores con push fallido se SKIP en el pull (`if (fallidas.includes(store)) continue;`).
3. Al importar/aplicar un doc remoto se actualiza `updatedAt[store][gid]` con el `_updatedAt` remoto.

## Contrato para otros módulos

- **Funciones exportadas** (`src/services/sync.ts`):
  - `generarCredenciales(): { syncToken: string; deviceId: string }`
  - `cargarConfig(): SyncConfig | null`
  - `guardarConfig(config: SyncConfig): boolean` (catch → false; la UI muestra toast de almacenamiento lleno)
  - `borrarConfig(): void`
  - `inicializarFirebase(config): Promise<Firestore | null>`
  - `sincronizar(config): Promise<SyncResult>`
- **Constantes** (`src/core/constants.ts`): `SYNC_KEY`, `SYNC_META_KEY`, `RULES_TEMPLATE`.
- **Tipos** (`src/types.ts`):
  - `SyncConfig`: campos firebase opcionales + `syncToken`/`deviceId` obligatorios + `intervalMin`.
  - `SyncMeta`: `version`, `deviceId`, `gids: Partial<Record<StoreName, Record<number, string>>>`, `updatedAt: Partial<Record<StoreName, Record<string, number>>>`, `lastSyncAt`/`lastPushAt`/`lastPullAt`.
  - `SyncResult`: `ok`, `subidos`, `importados`, `errores`, `fallidas?: string[]`, `mensaje`.
  - `SyncDoc<T = unknown>`.
- **Convenciones**: `intervalMin: 0` = auto-sync desactivado; `null/undefined` = default 5 (minutos). Mensajes/errores en español.

## Seguridad

- La `apiKey` de Firebase es **PÚBLICA por diseño** — no es un secreto; la seguridad real son las **Security Rules**: `match /pos/{syncToken}/{store}/{docId} { allow read, write: if syncToken == '<SYNC_TOKEN>'; }` + default deny (`allow read, write: if false;`).
- El `syncToken` es la llave maestra compartida entre dispositivos (segmento del path, se muestra en la UI). NO es un secreto absoluto: quien lo tenga accede a los datos de ese path.
- Config + token se guardan SOLO en localStorage de cada dispositivo; nunca como campo de documento.
- `guardarSyncConfig` valida el token pegado con regex `^[A-Za-z0-9_-]{1,128}$` (toast de error y no guarda si no cumple).

## Errores comunes / trampas

- **Duplicate-app**: cambiar de proyecto Firebase revienta con "app already exists" hasta recargar si no se usan apps nombradas por proyecto + `getApps().find()` + `deleteApp` en catch.
- **Clobber con push fallido**: un pull con push parcial fallido sobrescribe datos locales — por eso se guarda `updatedAt` por gid y se SKIP la store que falló.
- **Tombstones re-enviados**: tras enviar `_deleted` hay que limpiar el gid de `gids`/`updatedAt`; si no, se re-envía cada sesión y la meta crece sin límite.
- **`doc.data` sin guard**: los docs remotos pueden tener forma inesperada; validar `if (!doc.data || typeof doc.data !== 'object' || Array.isArray(doc.data)) continue;`.
- **Token inválido**: el syncToken es segmento de path — validar con la regex antes de guardar (caracteres/espacios inválidos rompen la ruta).
- **localStorage lleno**: `guardarConfig()` retorna `false` en catch — la UI debe mostrar toast en vez de callar.
- **NUNCA import estático de firebase** al tope del archivo: rompe el lazy-loading y engorda el bundle principal.
