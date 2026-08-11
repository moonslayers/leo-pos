import { $, toast, cerrarModal } from './ui/dom';
import { getStorage, initStorage } from './storage';
import { setOnStorageFull } from './storage/local-storage';
import { registerCartGlobals, registerCartOps, renderCarrito } from './ui/cart';
import { registerScannerGlobals, registerScannerHandlers } from './features/scanner';
import { mostrarVista, registerNavGlobals } from './ui/navigation';
import { initVentas, onCodeForVenta, renderVentaProductos } from './ui/ventas';
import { initProductos, onCodeForProducto, onProductsChanged } from './ui/productos';
import { initFiados } from './ui/fiados';
import { initDashboard } from './ui/dashboard';
import { initAjustes } from './ui/ajustes';
import { initSync } from './ui/sync';
import { instalarTrackingSync } from './services/sync';
import {
  agregarCarrito,
  cambiarQty,
  getCarrito,
  quitarItem,
  totalCarrito,
  vaciarCarrito
} from './services/sales';

declare global {
  interface Window {
    agregarCarrito: (id: number) => Promise<void>;
    cerrarModal: (id: string) => void;
  }
}

window.cerrarModal = cerrarModal;

async function agregarCarritoGlobal(id: number): Promise<void> {
  const r = await agregarCarrito(id);
  if (r.ok) {
    if (r.warning) toast(r.warning);
    renderCarrito();
  }
}

(async function init(): Promise<void> {
  try {
    await initStorage();
  } catch {
    toast('⚠️ No se pudo inicializar el almacenamiento', 3800);
  }
  if (getStorage().getBackend() === 'localstorage') {
    toast('⚠️ IndexedDB no disponible aquí; los datos se guardarán en localStorage', 3800);
  }
  setOnStorageFull(() => toast('⚠️ No se pudo guardar: almacenamiento lleno'));
  instalarTrackingSync();

  const f = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('hdrFecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);

  initVentas();
  initProductos();
  initFiados();
  initDashboard();
  initAjustes();
  initSync();

  window.agregarCarrito = agregarCarritoGlobal;
  registerCartOps({
    getCarrito,
    totalCarrito,
    agregarCarrito: agregarCarritoGlobal,
    cambiarQty,
    quitarItem,
    vaciarCarrito
  });
  registerCartGlobals();

  registerScannerHandlers({ onCodeForVenta, onCodeForProducto });

  onProductsChanged(() => void renderVentaProductos());

  registerNavGlobals();
  registerScannerGlobals();

  renderCarrito();
  mostrarVista('ventas');
})();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
