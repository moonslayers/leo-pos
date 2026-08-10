---
name: leo-pos-responsive-desktop
description: Arquitectura CSS responsive del POS Leonides — todo el CSS vive en el <style> de index.html (base móvil + bloque @media (min-width:1024px)), convención .oculto para show/hide y el gotcha de selectores .view.active. Úsala al tocar el layout/CSS/responsive.
license: MIT
---

## Propósito

Capturar la arquitectura CSS responsive del proyecto leo-pos (POS "Leonides POS", Vite + vanilla TypeScript strict, SIN framework y SIN archivos .css). Todo el CSS vive en el bloque `<style>` de `index.html`. El proyecto era 100% mobile-first (columna de 560px) y ahora tiene un layout desktop real mediante un único `@media (min-width:1024px)`. Es la fuente de verdad para saber DÓNDE y CÓMO van los cambios de layout/CSS antes de tocar nada.

## Cuándo usarla

- Al tocar el layout/CSS/responsive de `index.html`.
- Al ajustar o extender el layout desktop (sidebar, grids, modales, vista ventas 2 columnas).
- Al trabajar en las vistas de `src/ui/*` que renderizan con `innerHTML`.
- Antes de agregar un elemento que se muestra/oculta desde JS.

## Estructura del CSS (líneas reales de index.html)

El CSS vive en un único bloque `<style>` (líneas 13-155), con dos zonas:

- **Base móvil**: líneas 14-112. Define todo el estilo mobile-first: reset, header, cards, botones, carrito, dashboard, `nav.bottom`, modales (bottom-sheet con `border-radius:20px 20px 0 0`), toast, `#btnAyuda`, condiciones del fiado y guías interactivas.
- **`.oculto{display:none!important}`**: línea 21, dentro de la base móvil.
- **`@media (min-width:1024px)`**: líneas 113-154, al final del `<style>`. Contiene TODO el layout desktop.

**Regla de oro**: todo cambio desktop va DENTRO del media query; la base móvil (<1024px) debe quedar intacta.

## Convención CRÍTICA — `.oculto`

Los estilos inline (`element.style.display`) SIEMPRE ganan a media queries (y a clases normales). Por eso el show/hide de elementos NO usa `style.display`, sino la clase utilitaria `.oculto{display:none!important}` (línea 21) que el JS alterna con `classList.add/remove/toggle('oculto')`.

Elementos migrados a `.oculto`:
- `#carritoAcciones` — cart.ts (líneas 35, 38) → `src/ui/cart.ts`.
- `#btnEliminarProducto` — productos.ts (líneas 78, 93) → `src/ui/productos.ts`.
- `#filaNumPagos` — ventas.ts (línea 155, `toggle('oculto', p !== 'parcial')`) → `src/ui/ventas.ts`.
- `#dcPlan` — fiados.ts (líneas 130, 131) → `src/ui/fiados.ts`.
- `#btnWhatsApp` — fiados.ts (líneas 138, 140); INICIA VISIBLE (sin `class="oculto"` en el HTML, línea 413), solo se oculta cuando el cliente no tiene teléfono.

Reglas:
- **NO uses `style.display` inline para ocultar elementos**; usa `.oculto`.
- Cualquier regla CSS futura que quiera MOSTRAR uno de estos elementos necesita `!important` (o quedaría invisible por el `.oculto`).

## Gotcha CRÍTICO — `.view.active`

Para aplicar `display:grid`/`flex` a una vista en desktop hay que usar selectores tipo `#v-ventas.view.active` (id + clase activa). Un selector `#v-ventas` a secas pisa el `display:none` de `.view` (línea 22) y deja las vistas ocultas visibles al mismo tiempo. Ver `#v-ventas.view.active` (línea 138) y `#v-dashboard.view.active` (línea 149).

## Layout desktop (resumen del @media)

- **Sidebar**: `nav.bottom` se convierte en sidebar izquierda fija de 220px (`left:0;right:auto;top:0;bottom:0;width:220px;flex-direction:column`, línea 115) + `body{padding-left:220px}` (línea 114). Los `.tab` conservan su `data-v` y `onclick="mostrarVista(...)"` originales (HTML líneas 265-271); solo cambia su presentación (fila horizontal, línea 116).
- **Main**: `max-width:1200px`, centrado, sin el padding-bottom de nav móvil (línea 119).
- **Header**: `overflow:hidden` (línea 120) para que `#hdrFecha` con `white-space:nowrap` no desborde en 1024-1150px; `#hdrFecha` `max-width:none` (línea 122).
- **Modales**: centrados (`.modal{align-items:center}`, línea 133), `.modal-card` 640px con `border-radius:16px` (línea 134), `#mProducto`/`#mCondiciones` a 720px (línea 135).
- **Toast/FAB**: reposicionados abajo-derecha (`#toast` derecha 24px, línea 136; `#btnAyuda` derecha 24px, línea 137).
- **Vista ventas**: 2 columnas con `grid-template-areas:"busqueda busqueda" "productos carrito"` (línea 138), `#carritoCard` sticky `top:72px` (línea 142).
- **Grids de listas**: productos `auto-fill minmax(260px,1fr)` (línea 143), fiados 2 col (línea 144), dashboard 2 col con `#gridStats` 4 col (líneas 149-151).
- **Tipografía mayor**: inputs 17px (línea 125), botones 15.5px (línea 126), stats 22px (línea 132).
- **Detalle importante**: `#dcMovs` (modal detalle cliente) y `#carritoCont` quedan verticales a propósito (una sola columna), sin override desktop.

## Trampa — CSS inline en templates JS

Las vistas `src/ui/*` renderizan filas con `innerHTML` usando mucho CSS inline (`flex:1;min-width:0`, colores, backgrounds dinámicos). La mayoría es cosmético o dinámico (colores de categoría, alturas de barra del chart) y NO bloquea media queries. Solo los display-toggles bloqueaban — ya migrados a `.oculto`. No toques esos estilos inline salvo que cambie la lógica visual real.

## Style.display intencionales que quedan

`src/features/tours.ts` (líneas 119, 141, 155) usa `style.display` para el overlay de las guías interactivas (`#tourSpot`/`#tourAtras`). Es intencional, NO migrar: el motor de tours reposiciona el overlay con `getBoundingClientRect()` y recalcula en `resize`, por lo que funciona sobre el layout desktop.

## Errores comunes / trampas

- **NO usar `style.display` para ocultar** — usa `.oculto` (los inline ganan a media queries).
- **NO usar `#v-ventas` a secas** para dar grid/flex en desktop — usa `#v-ventas.view.active` o pisa el `display:none` de las vistas ocultas.
- **NO sacar cambios desktop fuera del `@media`** — la base móvil <1024px debe quedar intacta.
- **NO migrar los `style.display` de `tours.ts`** — son intencionales (overlay del tour).
- **NO tocar los `onclick` inline de `index.html`** sin registrar el global correspondiente en su vista (patrón de `leo-pos-arquitectura`).
- Una regla que quiera mostrar un elemento `.oculto` necesita `!important`, o quedará invisible.
