---
name: leo-pos-storage-sync-mongo
description: Capa de storage del POS Leonides (interfaz Storage + backends IndexedDB/localStorage), esquema IndexedDB intocable, y cómo insertar el wrapper de sync MongoDB (patrón decorator) sin tocar services ni ui.
license: MIT
---

## Propósito

Documentar la capa de persistencia del POS Leonides y el punto exacto de costura donde se añadirá la sincronización con MongoDB. Los datos reales del negocio dependen del esquema IndexedDB: cualquier cambio debe respetarlo.

## Cuándo usarla

- Antes de tocar cualquier lectura/escritura de datos.
- Para entender el contrato `Storage` y el esquema IndexedDB (contexto de la re-idenciación del sync, ver skill `leo-pos-sync-firebase`).
- Cuando se reporte un problema de guardado o de almacenamiento.
- Al investigar cómo los datos llegan desde el backend hasta la UI.

## Ubicación

```
src/storage/
├── storage.ts        # Interfaz Storage + tipos (Backend, Put)
├── indexed-db.ts     # Backend IndexedDB (esquema leonides_pos v1)
├── local-storage.ts  # Fallback localStorage (key leonides_pos_data_v1) + setOnStorageFull
└── index.ts          # Factory initStorage() + singleton getStorage() con auto-fallback + hook de tracking (setSyncTrackingHook / sinTracking)
```

## Contrato de la interfaz `Storage`

- `init(): Promise<void>`
- `getAll<T>(store): Promise<T[]>`
- `get<T>(store, id): Promise<T | undefined>`
- `put<T>(store, value): Promise<number>` — **devuelve el id asignado**
- `del(store, id): Promise<void>`
- `clear(store): Promise<void>`
- `findByCode(codigo): Promise<Producto | undefined>`
- `getBackend(): 'indexeddb' | 'localstorage'`

**Todos** los accesos a datos de la app pasan por `getStorage()` (singleton en `src/storage/index.ts`). Esa es la costura donde un wrapper de sync puede interceptar SIN tocar services ni ui. **NOTA**: la costura de tracking YA está implementada — `src/storage/index.ts` expone `setSyncTrackingHook(hook)` y `sinTracking(fn)` (decorator `conTracking` sobre el backend real, contador `trackingDepth`); `src/services/sync.ts` los consume para marcar `dirty`/`dirtyDel` en `SyncMeta` (ver skill `leo-pos-sync-firebase`).

## Esquema IndexedDB (NO cambiar — datos reales dependen de esto)

DB `leonides_pos`, versión **1**; todas las stores con `keyPath: 'id'`, `autoIncrement`:

| Store      | Indexes          |
|------------|------------------|
| `productos`| `codigo`         |
| `ventas`   | `fecha`          |
| `clientes` | (sin index)      |
| `abonos`   | `clienteId`      |

## Fallback localStorage

- Key: `leonides_pos_data_v1`.
- Estructura: `{ productos: [], ventas: [], clientes: [], abonos: [], seq: {...} }` con `seq` por store (contador de ids).
- Auto-fallback en `initStorage()`: si `window.indexedDB` no existe o falla la init, usa `LocalStorageStorage` con warning en consola.

## TRAMPA CRÍTICA para el sync futuro — IDs

Los IDs son **numéricos autoincrement por store** → dos dispositivos generan el mismo `id` (colisión). La capa de sync debe **re-idenciar** (prefijo de dispositivo o UUID) al importar. Diseñar esta estrategia ANTES de escribir el wrapper, y conservar referencias cruzadas (p. ej. `ventas` → `productoId`, `abonos` → `clienteId`). **Esta trampa es la razón de la re-idenciación real del sync** (insertar sin id + remapeo de referencias en orden productos→clientes→ventas→abonos) — ver skill `leo-pos-sync-firebase`.

## Diseño de sync (HISTÓRICO — implementado con Firebase, no Mongo)

> **NOTA**: el sync real se implementó con **Firebase Firestore** — ver skill `leo-pos-sync-firebase`. El plan original de Mongo (Data API + wrapper decorator) quedó **obsoleto**: la MongoDB Atlas Data API de App Services se deprecó sept-2024 y se apagó el **30-sep-2025 (EOL)**. La capa `Storage` y el esquema IndexedDB documentados aquí siguen vigentes (son los backends que el motor de sync usa); lo que sigue a continuación es la propuesta que se descartó.

- **Local-first siempre**: el navegador local es la fuente principal. (Se conservó en la implementación Firebase.)
- El token de Mongo se guardaba SOLO en localStorage del navegador donde se activa (nunca en la nube). (En Firebase: el `syncToken` es segmento del path de Firestore y la config vive solo en localStorage.)
- Otro dispositivo con la misma key detecta que ya existe una base y **descarga/importa** los datos. (Equivalente al pull de Firebase.)
- Implementar como **wrapper/decorator** sobre la interfaz `Storage` (patrón decorator) — SIN modificar `services/*` ni `src/ui/*`. (Descartado: el motor Firebase vive en `src/services/sync.ts` y consulta `Storage` directamente.)
- El export/import de respaldo JSON manual ya existe en Ajustes (`src/services/backup.ts`) para copia manual entre dispositivos. (Sigue vigente.)
- **La costura de tracking YA está implementada** (no es solo propuesta): `src/storage/index.ts` expone `setSyncTrackingHook` y `sinTracking` (decorator `conTracking`, contador de profundidad `trackingDepth`) y `src/services/sync.ts` los consume para marcar `dirty`/`dirtyDel` en `SyncMeta` y suprimir el tracking en los writes del pull. El patrón decorator sobre `Storage` pasó de ser "costura futura" a la base del dirty-tracking real del sync Firebase.

## Errores comunes / trampas

- NO romper la paridad del esquema (store names, indexes, `id` autoincrement).
- Respetar el auto-fallback a localStorage cuando IndexedDB falla (no lanzar).
- Mantener el toast `'⚠️ No se pudo guardar: almacenamiento lleno'` — cableado vía `setOnStorageFull` en `main.ts` (`src/storage/local-storage.ts`).
- `put` devuelve el id: no asumir que el objeto mutado lleva el id asignado si el backend no lo hace.
- El singleton `getStorage()` cachea la instancia: no crear una segunda instancia manualmente.
