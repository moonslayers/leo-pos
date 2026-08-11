---
name: leo-pos-arquitectura
description: Arquitectura del POS Leonides (Vite + vanilla TypeScript strict, sin framework): estructura de src/, patrón de registries, window globals para onclick inline, y trampas del HTML shell original.
license: MIT
---

## Propósito

Capturar la arquitectura del proyecto leo-pos (POS "Leonides POS" para negocio de lencería/perfumes/cosméticos) migrado de un único `index.html` vanilla JS a Vite + vanilla TypeScript strict **SIN framework**. Es la fuente de verdad para saber DÓNDE vive cada pieza y CÓMO se conectan antes de tocar cualquier cosa.

## Cuándo usarla

- Al iniciar cualquier tarea sobre este repo, para ubicar archivos y entender el cableado.
- Antes de agregar una vista, una función de negocio o un botón nuevo.
- Antes de tocar `index.html` o cualquier `onclick` inline.
- Para mantener la paridad de comportamiento con `reference/original-script.js`.

## Stack

- **Vite 6** + **TypeScript strict** (`noUnusedLocals` / `noUnusedParameters`).
- Única dependencia de runtime: `firebase@^12.17.1` (solo para el sync, carga lazy en chunk aparte — ver skill `leo-pos-sync-firebase`). Sigue siendo vanilla TS sin framework.
- `vite.config.ts` solo define `base: './'`.

## Estructura de archivos

```
src/
├── main.ts                # Bootstrap: initStorage, header date, inits, cableado de registries
├── types.ts               # Tipos de dominio (Producto, Venta, Cliente, Abono, CarritoItem,
│                          #   DeudaCliente, Movimiento, PlanPago, Frecuencia, StoreName, Vista, TourStep)
├── types/browser.d.ts     # Ambient declarations (BarcodeDetector)
├── core/
│   ├── constants.ts       # CATS, catInfo, FREQ_TXT, DB_NAME, DB_VERSION, STORES, LS_KEY, TOUR_KEY,
│   │                      #   SYNC_KEY, SYNC_META_KEY, RULES_TEMPLATE
│   └── format.ts          # fmt, fmtF, fmtCorto, inicioDia, fechaLocal, esc
├── storage/               # Interfaz Storage + backends (ver skill leo-pos-storage-sync-mongo)
├── services/              # products, sales, fiados, clients, backup, sync — lógica PURA sin DOM
│                          #   sync = motor Firebase Firestore (ver skill leo-pos-sync-firebase)
├── features/
│   ├── tours.ts           # Guías interactivas
│   └── scanner.ts         # Escáner con BarcodeDetector
└── ui/
    ├── dom.ts             # $, toast, abrirModal, cerrarModal + handlers globales click/keydown
    ├── navigation.ts      # mostrarVista + registerViewRenderers
    ├── cart.ts            # renderCarrito + registerCartOps
    ├── ventas.ts          # Vista ventas (cobrar, scanner de venta)
    ├── productos.ts       # Vista productos (CRUD, scanner de producto)
    ├── fiados.ts          # Vista fiados (abonos, detalle cliente, deuda previa)
    │   #   Lógica de clientes/deudas (crearCliente, guardarAbono, calcularDeudas,
    │   #   detalleCliente, registrarDeudaPrevia) vive en src/services/clients.ts;
    │   #   Venta puede llevar previa?: boolean (deuda previa del cuaderno, items vacíos).
    │   #   Ver skill leo-pos-fiados-deudas
    ├── dashboard.ts       # Vista dashboard (estadísticas)
    ├── ajustes.ts         # Vista ajustes (backup, tours, import/export)
    └── sync.ts            # Card #cardSync en Ajustes (sync Firebase, window globals + timer)

docs/                       # Guías de configuración externa (ej. SYNC_FIREBASE.md con setup Spark + rules)
index.html                  # HTML shell casi intacto (vistas, modales, CSS, onclick inline).
                          #   TODO el CSS vive en su <style> (base móvil + bloque @media (min-width:1024px)
                          #   al final); los cambios de layout/CSS van ahí (ver skill leo-pos-responsive-desktop)
reference/original-script.js # Script JS original completo (provenance del port)
```

## Patrones y convenciones

- **Services puros**: `src/services/*` contienen lógica de negocio SIN DOM, consumen `getStorage()`. Retornan resultados estructurados (discriminated unions) con mensajes en español; la UI decide si mostrar toast/confirm.
- **Convención — `.oculto` para show/hide**: los estilos inline (`element.style.display`) ganan a media queries, por eso el show/hide de elementos se hace con la clase `.oculto{display:none!important}` (index.html) alternada por JS con `classList.add/remove/toggle('oculto')` — NO con `style.display`. Ver skill `leo-pos-responsive-desktop` para el detalle del layout desktop.
- **Patrón CRÍTICO — registries para evitar imports circulares**: las vistas registran sus renderers vía `registerViewRenderers({ventas: renderVentaProductos, ...})`; las operaciones de carrito vía `registerCartOps(...)`; los handlers de escáner vía `registerScannerHandlers({onCodeForVenta, onCodeForProducto})`. Todo se cablea **UNA sola vez** en `main.ts`. Si un botón nuevo no funciona, probablemente falta registrarlo aquí.
- **Patrón CRÍTICO — window globals para onclick inline**: `index.html` conserva los `onclick="..."` originales. Cada vista registra sus funciones en `window` (ej. `window.cobrarContado`, `window.guardarProducto`, `window.detalleCliente`) con `declare global`. Sin esto los botones del HTML NO funcionan.
- **Flujo de bootstrap** (`main.ts`): `initStorage` → header date → inits de vistas → `registerCartOps` (punto único) → `registerScannerHandlers` (punto único con AMBOS handlers) → `onProductsChanged` → `registerNavGlobals` + `registerScannerGlobals` → `renderCarrito` → `mostrarVista('ventas')`.
- **Renders async**: los renders hacen `await dbGetAll(...)`; nunca asumas que los datos están listos de forma síncrona.

## Errores comunes / trampas

- **NO tocar los `onclick` de `index.html`** sin registrar el global correspondiente en su vista — el botón quedará muerto.
- **NO agregar funciones a `window` en dos lugares** — el punto único de cableado es `main.ts` y los `register*`.
- **Mensajes en español idénticos al original**: la paridad con `reference/original-script.js` es requisito; no cambies textos de toasts/confirms sin revisarlo.
- Los renders son async (await); no leer `getStorage().getAll` sin await.
- TypeScript strict: variables sin uso rompen el build (`noUnusedLocals`/`noUnusedParameters`).
- `index.html` es 26 KB de HTML shell — los cambios estructurales van en `src/ui/*`, no ahí, salvo que sean puramente de layout/CSS.
