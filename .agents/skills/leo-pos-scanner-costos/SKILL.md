---
name: leo-pos-scanner-costos
description: Flujo del lector de código de barras (hardware tipo teclado y cámara BarcodeDetector) en ventas y productos, y reglas de costo automático por categoría. Úsala al tocar escáner, código de barras, ventas, productos, captura de productos, costos, categorías o el modal de producto.
license: MIT
---

## Propósito

Documentar el flujo del **lector de código de barras** (hardware tipo teclado que teclea código + Enter en el input con foco) y las **reglas de costo automático por categoría** en la vista de productos. Es la fuente de verdad para saber cómo llegan los códigos al POS y cómo se calculan los costos reactivos.

## Cuándo usarla

- Al trabajar con el lector de código de barras (hardware o cámara).
- Al modificar la vista Ventas (`src/ui/ventas.ts`) o Productos (`src/ui/productos.ts`).
- Al tocar el modal de producto, categorías, o el cálculo de costos.
- Al depurar por qué un escáner no agrega al carrito, o por qué un costo no se calcula.

## Dos caminos del escáner (CRÍTICO)

El POS acepta códigos por **dos caminos distintos** que NO se mezclan:

### (a) Escáner hardware (teclado USB/Bluetooth)

- El lector teclea los caracteres del código **directamente en el input con foco** y luego simula un Enter.
- **Ventas**: el input `#buscarVenta` recibe el código (auto-focus al entrar a la vista, `navigation.ts:54-56`). El listener `keydown` Enter en `initVentas` (`ventas.ts:242-254`) hace `findByCode` exacto → `agregarCarrito(id)` + limpia input + re-render. Si no coincide, no hace nada (el filtro `.includes` normal sigue en el evento `input`).
- **Productos**: el input `#buscarProducto` recibe el código (auto-focus al entrar a la vista, `navigation.ts:57-59`). El listener `keydown` Enter en `initProductos` (`productos.ts:203-219`) tiene **tres caminos**:
  1. Si `findByCode` encuentra el código → `confirm` "¿Editarlo?" → si sí: `editarProducto(p.id)`. Si cancela: **return sin abrir modal duplicado**.
  2. Si NO existe y el valor es numérico (regex `/^\d{4,}$/`, longitud ≥ 4) → `nuevoProducto(codigo)` + `fCodigo.disabled = true` + focus en `#fNombre` (código pre-cargado, no editable).
  3. Si no es numérico → no hace nada (filtro normal del input).
- **NO pasa por `onCodeForVenta`/`onCodeForProducto`** — es un camino completamente distinto al de cámara.

### (b) Escáner de cámara (BarcodeDetector)

- Se abre con `abrirScanner(target)` (`src/features/scanner.ts:27`), donde `target` es `'venta'` | `'producto-codigo'`.
- Usa `BarcodeDetector` API del navegador para detectar códigos del video cada 250ms.
- Al detectar un código → `cerrarScanner()` → `procesarCodigo(valor)` (`scanner.ts:96-105`).
- `procesarCodigo` despacha según `scanTarget`: llama a `handlers.onCodeForVenta` o `handlers.onCodeForProducto`.
- Los handlers se cablean **UNA sola vez** en `main.ts:73` vía `registerScannerHandlers({ onCodeForVenta, onCodeForProducto })`.
- También soporta entrada manual (`enviarCodigoManual`) en el modal del escáner.

## Auto-focus (ambas vistas)

Ambas vistas tienen **auto-focus síncrono + fallback setTimeout 300ms** al entrar:

- **Ventas**: `enfocarBusquedaVentas()` (`navigation.ts:17-23`) enfoca `#buscarVenta`. Se llama en `mostrarVista` (`navigation.ts:54-56`).
- **Productos**: `enfocarBusquedaProductos()` (`navigation.ts:25-31`) enfoca `#buscarProducto`. Se llama en `mostrarVista` (`navigation.ts:57-59`).

Ambos helpers verifican `window.vistaActual` antes de enfocar (guard contra foco en vista incorrecta).

## Ventas (`src/ui/ventas.ts`)

- **Listener Enter** (`initVentas`, `ventas.ts:242-254`):
  1. Captura `keydown` Enter en `#buscarVenta`.
  2. `getStorage().findByCode(codigo)` — búsqueda **exacta** (no fuzzy).
  3. Si existe y `p.id != null` → `window.agregarCarrito(p.id)` + limpia input + re-render + toast `✅ nombre agregado`.
  4. Si no existe → no hace nada (el filtro `.includes` del evento `input` se encarga de mostrar "no encontrado").
- **`onCodeForVenta`** (scanner cámara, `ventas.ts:226-236`):
  1. `findByCode` exacto → si existe: `agregarCarrito` + toast.
  2. Si no existe → `confirm` "¿Darlo de alta?" → si sí, llama `abrirNuevoProducto(codigo)` que navega a Productos y ejecuta `nuevoProducto(codigo)`.
  3. Limpia input y re-render en cualquier caso.

## Productos (`src/ui/productos.ts`)

- **Auto-focus**: al entrar a la vista, `mostrarVista('productos')` (`navigation.ts:57-59`) hace focus síncrono + fallback `setTimeout 300ms` en `#buscarProducto`.
- **Listener Enter en `#buscarProducto`** (`initProductos`, `productos.ts:203-219`):
  1. Captura `keydown` Enter en `#buscarProducto`.
  2. `findByCode` exacto → si existe: `confirm` "¿Editarlo?" → si sí: `editarProducto(p.id)`. Si cancela: **return sin abrir modal duplicado**.
  3. Si NO existe y el valor es numérico (`/^\d{4,}$/`) → `nuevoProducto(codigo)` + `fCodigo.disabled = true` + focus en `#fNombre`.
  4. Si no es numérico → no hace nada (filtro normal).
- **`nuevoProducto(codigo?)`** (`productos.ts:98-113`): abre modal `mProducto` con `#fCodigo` **no disabled** + focus en `#fCodigo`. Si se pasa `codigo`, lo pre-carga. Llama `registrarListenersCosto()`.
- **`editarProducto(id)`** (`productos.ts:115-131`): carga los datos del producto existente en el modal. `#fCodigo` **no disabled**. Llama `registrarListenersCosto()`.
- **`onCodeForProducto(codigo)`** (`productos.ts:187-198`) — solo se llama desde escáner de cámara:
  1. `findByCode(codigo)` — si existe y `p.id != null` → `confirm` "¿Editarlo?" → si sí: `editarProducto(p.id)`. Si CANCELA: **return sin hacer nada**.
  2. Si NO existe → `nuevoProducto(codigo)` → luego `fCodigo.disabled = true` + focus en `#fNombre`.
- **Flujo post-guardado** (`guardarProducto`, `productos.ts:171-173`): tras un guardado exitoso (nuevo o editado), se limpia `#buscarProducto` (`value=''`) y se re-enfoca con `setTimeout 50ms` para que el usuario pueda escanear el siguiente producto de inmediato. Aplica tanto al crear como al editar.

## Costos reactivos

### Helper `calcularCostoDefault` (`productos.ts:28-32`)

```
cat === 'ilusion'  → Math.round(precio * 0.65 * 100) / 100   (2 decimales)
cat === 'fraiche'  → Math.max(0, precio - 100)                (ganancia fija 100, mínimo 0)
 resto             → null                                       (sin regla, editable)
```

### Listeners (`registrarListenersCosto`, `productos.ts:44-54`)

- Se registran al abrir el modal (en `nuevoProducto` y `editarProducto`).
- `#fPrecio` evento `input` → `onCostoFieldsChange()`.
- `#fCategoria` evento `change` → `onCostoFieldsChange()`.
- `onCostoFieldsChange` lee categoría y precio, llama `calcularCostoDefault`, si retorna `number` → escribe en `#fCosto`.
- **Anti-leak**: `limpiaCodigoModal` (closure, `productos.ts:50-53`) SOLO remueve los listeners de `#fPrecio` y `#fCategoria`. **NO toca `#fCodigo`** (ni value ni disabled). Se ejecuta al cerrar modal (`guardarProducto` línea 166 / `eliminarProducto` línea 180) o al reabrir (`registrarListenersCosto` línea 45).

### Aplicación

- Se aplica tanto al **crear** como al **editar** un producto.
- El costo solo se auto-llena si la categoría es `ilusion` o `fraiche`. Para `originales`, `cosmeticos` y `otros`, el usuario lo ingresa manualmente.

## Categoría `originales`

- En `CATS` (`src/core/constants.ts:16`): `{ id: 'originales', nombre: 'Perfumes Originales', emoji: '💎', color: '#3b82f6' }`.
- Es el **índice 4** en el array `CATS` (no el 3).
- `catInfo` fallback: `CATS.find(c => c.id === categoriaId) || CATS[3]` → `CATS[3]` es `otros`, NO `originales`.
- Option en `<select id="fCategoria">` (`index.html:316`): `<option value="originales">💎 Perfumes Originales</option>`.

## Trampas / edge cases

- **Cancel-confirm no abre modal duplicado**: tanto en `onCodeForProducto` como en el listener Enter de `#buscarProducto` (`initProductos`), si el código existe y el usuario cancela el confirm, la función hace `return` sin abrir `nuevoProducto`. Esto evita que se abra el modal con un código que ya existe.
- **`#fCodigo` se rehabilita por botón cerrar, NO por `limpiaCodigoModal`**: el closure `limpiaCodigoModal` SOLO remueve listeners de costo (anti-leak). La rehabilitación de `#fCodigo` (`disabled = false`, `value = ''`) la hace el listener de click en el botón `.ci-del` del modal (`productos.ts:220-225`). Si se modifica `limpiaCodigoModal` para tocar `fCodigo`, se rompe el flujo de edición (el código aparecería vacío).
- **Solo códigos numéricos ≥ 4 dígitos abren modal nuevo**: el listener Enter de `#buscarProducto` usa `/^\d{4,}$/` — códigos alfanuméricos o cortos NO abren modal, solo filtran.
- **Redondeo a 2 decimales**: `Math.round(precio * 0.65 * 100) / 100` — no usar `toFixed` (retorna string).
- **Fraiche mínimo 0**: `Math.max(0, precio - 100)` — nunca costo negativo.
- **Escáner hardware NO pasa por `onCodeForVenta`/`onCodeForProducto`**: el hardware teclea directamente en el input y el Enter se maneja por el listener de `initVentas`/`initProductos`. Los handlers de cámara son solo para `BarcodeDetector`.
- **TypeScript strict** (`noUnusedLocals`): las variables sin uso rompen el build.
- **`findByCode` es exacto**: no fuzzy match — si el escáner teclea un código con espacio extra, no lo encuentra.
- **Focus post-guardado con `setTimeout 50ms`**: el foco seaplica después de cerrar el modal para que el DOM esté listo. Si se hace focus síncrono, el modal puede interceptar el foco.
