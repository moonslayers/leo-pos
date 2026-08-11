---
name: leo-pos-fiados-deudas
description: Dominio de fiados y cuentas por cobrar del POS Leonides — las deudas se DERIVAN (sum ventas tipo 'fiado' − sum abonos, no son entidad), la deuda previa del cuaderno se representa como Venta tipo 'fiado' con items vacíos y flag `previa`, contrato de `registrarDeudaPrevia`, flujo de registro rápido en la vista Fiados, exclusión en estadísticas del dashboard y decisiones de producto. Úsala al tocar fiados, deudas, abonos, deuda previa o stats de por cobrar.
license: MIT
---

## Propósito

Capturar cómo funciona el dominio de **fiados y cuentas por cobrar** del POS Leonides: la regla NO-obvia de que **no existe una entidad "deuda"** (todo se deriva en runtime), y el feature **"Registrar deuda previa"** (fiado histórico del cuaderno) que permite meter a un cliente con deuda SIN pasar por el flujo de venta con productos. Es la fuente de verdad para no confundir deuda-dato con deuda-cálculo y para respetar las decisiones de producto al tocar fiados/stats.

## Cuándo usarla

- Antes de tocar la vista Fiados (`#v-fiados`), el modal de deuda previa (`mDeudaPrevia`), el detalle de cliente o los abonos.
- Al modificar `src/services/clients.ts` (deudas, abonos, clientes) o `src/services/fiados.ts` (flujo de venta fiada).
- Al cambiar estadísticas del dashboard que involucren "por cobrar" o ventas.
- Al depurar por qué un cliente "aparece solo" en Fiados, por qué un fiado sin productos rompe algo, o por qué una deuda previa no cuenta en las gráficas.

## Modelo de deudas (CRÍTICO)

- **NO existe entidad deuda en storage.** La deuda es un **cálculo en runtime**: `calcularDeudas()` (`src/services/clients.ts`) = `sum(ventas.tipo === 'fiado'.total)` − `sum(abonos.monto)` por cliente.
- `DeudaCliente` (`src/types.ts`) es un tipo de **LECTURA** (shape de fila de la vista), no una store ni algo que se persista.
- La store `ventas` guarda los fiados; la store `abonos` guarda los pagos. Nada más.
- Un cliente aparece en la lista de Fiados **automáticamente** al tener su primera venta tipo `'fiado'` (o si ya existe en `clientes`, `calcularDeudas` lo incluye aunque su deuda sea 0 — fila "al corriente").
- `detalleCliente(id)` (`src/services/clients.ts`) deriva lo mismo para un cliente: `deuda = sum(fiados) − sum(abonos)` y arma `Movimiento[]`.

## Deuda previa (fiado histórico del cuaderno)

La deuda previa se representa como una **`Venta`** con:

- `tipo: 'fiado'`
- `items: []` (vacío — no hay productos)
- `previa: true` (campo **opcional** en `Venta`, `src/types.ts`)
- `plan` / `numPagos` / `frecuencia` / `proximaFecha`: `null`
- `total` = monto de la deuda; `saldo` = `total − abonoInicial`
- `fecha` = la del cuaderno (o hoy)

**No cambia el esquema IndexedDB** — es un campo extra de documento, ignorado por el remapeo (ver Trampas). Es la solución para registrar un cliente con deuda **sin pasar por el flujo de venta con productos** (el módulo asumía clientes nuevos sin deuda previa).

## Contrato `registrarDeudaPrevia` (`src/services/clients.ts`)

Firma: `registrarDeudaPrevia(input: { clienteId?, nombre?, telefono?, monto, abono?, fecha? })` → `Promise<DeudaPreviaResult>`.

`DeudaPreviaResult` (discriminated union):
- `{ ok: true; mensaje }`
- `{ ok: false; mensaje; errores?: string[] }`

Comportamiento:
- **Cliente nuevo** (`clienteId` ausente): valida `nombre` (no vacío) y lo crea con `crearCliente`.
- **Cliente existente**: valida `monto > 0` y `abono` en `[0, monto]` con mensajes específicos:
  - `NaN` (no parseable) → `'El abono debe ser un número válido'`
  - `< 0` → `'El abono no puede ser negativo'`
  - `> monto` → `'El abono no puede ser mayor al monto'`
- Guarda la `Venta` fiado con `previa: true` y, si `abono > 0`, un `Abono` con `nota: 'Deuda previa'`.
- **NO toca carrito ni stock** (no usa `getCarrito`/`setCarrito`/`descontarStock`) — a diferencia de `registrarFiado` (`src/services/fiados.ts`), que sí usa el carrito global del flujo de venta.

## Flujo UI (vista Fiados)

- Botón `📝 Deuda previa` en `#v-fiados` (`onclick="abrirModalDeudaPrevia()"`, `index.html`) → modal `mDeudaPrevia`.
- El modal (`index.html`) tiene ids: `#listaClientesDeuda` (lista de clientes existentes, alterna), `#dpNombre`, `#dpTel`, `#dpMonto`, `#dpAbono`, `#dpFecha` (type=date), y la sección `#dpNuevoCliente` que se alterna con la clase `.oculto`.
- Window globals en `src/ui/fiados.ts` (patrón de onclick inline):
  - `abrirModalDeudaPrevia()`: resetea estado, lista clientes, rellena `#dpFecha` con hoy y abre el modal.
  - `seleccionarClienteDeuda(id)`: selecciona/deselecciona un cliente de la lista; al deseleccionar vuelve a mostrar `#dpNuevoCliente`.
  - `registrarDeudaPrevia()`: lee los inputs, convierte `YYYY-MM-DD` → timestamp con el patrón `new Date(raw + 'T12:00:00').getTime()`, **delega TODO al service** (`registrarDeudaPreviaSvc`), muestra toast con `res.mensaje` y re-renderiza con `renderFiados()`.
- `renderFiados()` (`src/ui/fiados.ts`) renderiza la lista de Fiados desde `calcularDeudas()`, separando "con deuda" y "al corriente".

## Estadísticas (decisión de producto)

En `src/ui/dashboard.ts`:

- **EXCLUYE** `previa: true` de las métricas de venta: `ventasGraf = ventas.filter(v => !v.previa)` se usa para hoy/semana (`stVentasHoy`, chart de 7 días) y mes (por categorías). Una deuda previa **NO** cuenta como "venta".
- La cifra **'por cobrar'** (`stPorCobrar`) usa la lista **COMPLETA**: `sum(ventas fiado) − sum(abonos)` sin filtrar `previa` (las deudas previas SÍ deben aparecer ahí).

**No dupliques la exclusión `!v.previa` en 'por cobrar'** — ahí va la lista completa a propósito.

## Decisiones de producto

- (a) La deuda previa **NO cuenta en las estadísticas de venta** (hoy/semana/mes).
- (b) El **abono inicial HEREDA la fecha de la deuda** (se guarda con la misma `fecha`, no con `Date.now()`): si la deuda es retroactiva, el abono NO cuenta en "Ingresos de hoy" — decisión consciente de la usuaria, no cambiar sin consultar.
- (c) La nota del abono inicial es `'Deuda previa'` (se muestra en el detalle del cliente).
- (d) El movimiento del fiado previo muestra `det = 'Deuda previa (cuaderno)'` en el detalle del cliente (`detalleCliente` en `clients.ts`), en vez de la lista de items.
- El registro es rápido por diseño: obligatorio solo cliente (o nombre) + monto; abono y fecha son opcionales.

## Trampas / edge cases

- **`plan: null` es tolerado**: en `detalleCliente` (`src/services/clients.ts`) el plan se calcula con `fiados.filter(f => f.plan)` (los previos se ignoran) y en la UI el `#dcPlan` se oculta con `.oculto` si no hay plan.
- **`items: []` es seguro para sync y backup**: `remapearReferencias` en `src/services/sync.ts` usa `Array.isArray(data.items)` (no asume items presentes) y `backup.ts` valida arrays — una venta sin items no rompe nada.
- **NaN en abono se rechaza**: el parse falla → mensaje específico, nunca se guarda abono inválido.
- **`parseFloat` no maneja separador de miles** (ej. "1,500" → 1.5): consistente con el resto del codebase, no "corregir" solo aquí.
- **`DeudaPreviaResult.errores` no se puebla hoy** (campo muerto del discriminated union; el service siempre devuelve `mensaje`): no hay código que lo asigne.
- Los mensajes de error/éxito van en español y el service es PURA lógica (sin DOM); la UI solo muestra toast/cierra modal/re-render.
