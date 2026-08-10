---
name: leo-pos-storage-sync-mongo
description: Capa de storage del POS Leonides (interfaz Storage + backends IndexedDB/localStorage), esquema IndexedDB intocable, y cómo insertar el wrapper de sync MongoDB (patrón decorator) sin tocar services ni ui.
license: MIT
---

## Propósito

Documentar la capa de persistencia del POS Leonides y el punto exacto de costura donde se añadirá la sincronización con MongoDB. Los datos reales del negocio dependen del esquema IndexedDB: cualquier cambio debe respetarlo.

## Cuándo usarla

- Antes de tocar cualquier lectura/escritura de datos.
- Cuando se implemente el sync con MongoDB (próximo feature planeado).
- Cuando se reporte un problema de guardado o de almacenamiento.
- Al investigar cómo los datos llegan desde el backend hasta la UI.

## Ubicación

```
src/storage/
├── storage.ts        # Interfaz Storage + tipos (Backend, Put)
├── indexed-db.ts     # Backend IndexedDB (esquema leonides_pos v1)
├── local-storage.ts  # Fallback localStorage (key leonides_pos_data_v1) + setOnStorageFull
└── index.ts          # Factory initStorage() + singleton getStorage() con auto-fallback
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

**Todos** los accesos a datos de la app pasan por `getStorage()` (singleton en `src/storage/index.ts`). Esa es la costura donde un wrapper de sync puede interceptar SIN tocar services ni ui.

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

Los IDs son **numéricos autoincrement por store** → dos dispositivos generan el mismo `id` (colisión). La capa de sync debe **re-idenciar** (prefijo de dispositivo o UUID) al importar. Diseñar esta estrategia ANTES de escribir el wrapper, y conservar referencias cruzadas (p. ej. `ventas` → `productoId`, `abonos` → `clienteId`).

## Diseño de sync aprobado por el usuario

- **Local-first siempre**: el navegador local es la fuente principal.
- El **token de Mongo se guarda SOLO en localStorage** del navegador donde se activa (nunca en la nube).
- Otro dispositivo con la misma key detecta que ya existe una base y **descarga/importa** los datos.
- Implementar como **wrapper/decorator** sobre la interfaz `Storage` (patrón decorator) — SIN modificar `services/*` ni `src/ui/*`.
- El export/import de respaldo JSON manual ya existe en Ajustes (`src/services/backup.ts`) para copia manual entre dispositivos.

## Errores comunes / trampas

- NO romper la paridad del esquema (store names, indexes, `id` autoincrement).
- Respetar el auto-fallback a localStorage cuando IndexedDB falla (no lanzar).
- Mantener el toast `'⚠️ No se pudo guardar: almacenamiento lleno'` — cableado vía `setOnStorageFull` en `main.ts` (`src/storage/local-storage.ts`).
- `put` devuelve el id: no asumir que el objeto mutado lleva el id asignado si el backend no lo hace.
- El singleton `getStorage()` cachea la instancia: no crear una segunda instancia manualmente.
