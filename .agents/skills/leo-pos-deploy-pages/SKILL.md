---
name: leo-pos-deploy-pages
description: Deploy de leo-pos a GitHub Pages — workflow con Node 24 y actions v7, el gotcha de artifacts que rompe el deploy con actions viejas, config de Pages requerida y detalles PWA/relativos.
license: MIT
---

## Propósito

Documentar cómo se publica leo-pos en GitHub Pages (https://moonslayers.github.io/leo-pos/) y, sobre todo, el gotcha de versión de actions que costó 2 runs fallidos. Para que el deploy nunca vuelva a fallar por lo mismo.

## Cuándo usarla

- Al tocar el workflow de CI/CD (`.github/workflows/deploy.yml`).
- Al re-deployar o solucionar un deploy fallido.
- Al cambiar el manifest PWA, el service worker o los íconos.
- Al verificar que la versión publicada refleje la rama `main`.

## Datos del proyecto

- Repo: `moonslayers/leo-pos`, rama `main`.
- URL publicada: https://moonslayers.github.io/leo-pos/
- Sub-ruta base: `/leo-pos/` (implica rutas relativas en build y SW).

## Workflow (`.github/workflows/deploy.yml`)

- **Trigger**: push a `main` + `workflow_dispatch`.
- **Permissions**: `contents: read`, `pages: write`, `id-token: write`.
- **Concurrency**: group `pages`, `cancel-in-progress: true`.
- **Build** (ubuntu-latest):
  - `actions/checkout@v7`
  - `actions/setup-node@v7` con `node-version: 24` y `cache: npm`
  - `npm ci` → `npm run build`
  - `actions/upload-pages-artifact@v5` con `path: dist`
- **Deploy**: `actions/deploy-pages@v5`, environment `github-pages` con `url: ${{ steps.deployment.outputs.page_url }}`.

## GOTCHA CRÍTICO — actions viejas rompen el deploy (2 runs fallidos)

Las actions antiguas (`checkout@v4`, `setup-node@v4`, `upload-pages-artifact@v3`, `deploy-pages@v4`) apuntan al runtime **Node 20**, deprecado en 2026. En particular:

- `upload-pages-artifact@v3` usa internamente el servicio viejo `upload-artifact@v3`.
- `deploy-pages@v4` ya no lee ese artifact viejo → error: `No artifacts named "github-pages" were found`.
- Además aparece el warning `Node.js 20 is deprecated`.

**FIX (commit `733edde`)**: subir a v5/v7 + Node 24 — `checkout@v7`, `setup-node@v7`, `node-version: 24`, `upload-pages-artifact@v5` (usa `upload-artifact@v7` internamente), `deploy-pages@v5`. El run pasó sin warnings de Node.

**SIEMPRE verificar versiones actuales al tocar el workflow** (GitHub releases API) antes de editar.

## Config de GitHub requerida

- **Settings → Pages → Source = `GitHub Actions`** (NO `Deploy from a branch`).
- Cuando es `GitHub Actions` no hay campos de branch/folder — el "folder" `dist/` se define dentro del workflow (`path: dist` en `upload-pages-artifact`).
- Si está en `Deploy from a branch`, el deploy vía actions fallará aunque el build pase.

## Build y rutas

- `vite.config.ts`: `base: './'` (relativo) — **crítico** para servir desde `/leo-pos/`.
- El build produce `dist/`, que es lo que se sube como artifact.

## PWA

- `public/manifest.webmanifest`: `start_url: "./"`, `scope: "./"` (relativos, no `/leo-pos/`).
- `public/sw.js`: cache-first para assets, network-first para navegación con fallback al index cacheado; usa `self.registration.scope` — **sin hardcodear la subruta**.
- Íconos: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` + `icon.svg`.
- Registro del SW SOLO en producción: `import.meta.env.PROD` en `src/main.ts`.

## Errores comunes / trampas

- NO hardcodear `/leo-pos/` en el service worker ni en el manifest (usar rutas relativas / `self.registration.scope`).
- Después del primer deploy, **recargar 2 veces** en el navegador para que el SW tome control de la nueva versión.
- Probar offline en DevTools → Network → Offline.
- El `manifest.webmanifest` debe ser **JSON estricto**: sin comentarios (los comentarios rompen la carga).
- Si el build pasa pero "no se encuentra el artifact", es el gotcha de versiones de actions — no re-deployes, actualiza las actions.
