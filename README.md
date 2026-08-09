# Leonides POS

Sistema de punto de venta (POS) para el negocio de lencería, perfumes y cosméticos de Leonides. Funciona **local-first**: todos los datos se guardan en el navegador y no requiere servidor ni conexión a internet para operar.

## Stack

- **Vite** + **TypeScript** vanilla (sin framework)
- **IndexedDB** para el almacenamiento, con **fallback a localStorage** si IndexedDB no está disponible
- Módulos separados por capas: servicios (storage, ventas, clientes), núcleo (formato, constantes) y UI (ventas, productos, fiados, dashboard, ajustes, carrito)

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # genera dist/
npm run typecheck
```

## Deploy a GitHub Pages

Haz push a la rama `main` y el workflow (`.github/workflows/deploy.yml`) compila la app y la publica automáticamente en GitHub Pages:

```
https://moonslayers.github.io/leo-pos/
```

> **Nota:** los datos se guardan en el navegador (IndexedDB). Para respaldo manual usa la sección **Ajustes** → **Exportar respaldo**.
