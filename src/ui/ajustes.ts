import { $, toast } from './dom';
import { mostrarVista, registerViewRenderers, vistaActual } from './navigation';
import { renderCarrito } from './cart';
import {
  aplicarEjemplos,
  applyImport,
  borrarTodo as borrarTodoService,
  cargarEjemplo as cargarEjemploService,
  exportar as exportarRespaldo,
  parseBackup
} from '../services/backup';
import { getStorage } from '../storage';
import type { Abono, Cliente, Producto, Venta } from '../types';

declare global {
  interface Window {
    exportar: () => void;
    importar: (input: HTMLInputElement) => void;
    borrarTodo: () => void;
    cargarEjemplo: () => void;
  }
}

export function renderTodo(): void {
  renderCarrito();
  mostrarVista(vistaActual());
}

export async function renderStats(): Promise<void> {
  const [p, v, c, a] = await Promise.all([
    getStorage().getAll<Producto>('productos'),
    getStorage().getAll<Venta>('ventas'),
    getStorage().getAll<Cliente>('clientes'),
    getStorage().getAll<Abono>('abonos')
  ]);
  const backend = getStorage().getBackend() === 'localstorage' ? 'localStorage' : 'IndexedDB';
  $('stats').innerHTML =
    '<div class="stat-row"><span>📦 Productos</span><b>' +
    p.length +
    '</b></div>' +
    '<div class="stat-row"><span>🧾 Ventas</span><b>' +
    v.length +
    '</b></div>' +
    '<div class="stat-row"><span>👥 Clientes</span><b>' +
    c.length +
    '</b></div>' +
    '<div class="stat-row"><span>💰 Abonos</span><b>' +
    a.length +
    '</b></div>' +
    '<div class="stat-row" style="border-bottom:0"><span>💽 Guardado en</span><b style="font-size:12px">' +
    backend +
    '</b></div>';
  $('infoScanner').textContent =
    'BarcodeDetector' in window
      ? '✅ Tu navegador sí soporta escaneo de códigos con la cámara.'
      : '⚠️ Este navegador no soporta escaneo automático de códigos. Usa la captura manual del código (escribir los números).';
}

async function exportar(): Promise<void> {
  try {
    const { nombre, json } = await exportarRespaldo();
    const file = new File([json], nombre, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Respaldo Leonides POS' });
        toast('✅ Respaldo compartido');
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('⬇️ Respaldo descargado');
  } catch (e) {
    toast('Error al exportar: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function importar(input: HTMLInputElement): Promise<void> {
  const file = input.files ? input.files[0] : null;
  input.value = '';
  if (!file) return;
  try {
    const res = await parseBackup(await file.text());
    if (!res.ok) {
      toast(res.error);
      return;
    }
    if (!confirm(res.confirmMsg)) return;
    await applyImport(res.data);
    toast('✅ Datos importados');
    renderTodo();
  } catch (e) {
    toast('Error al importar: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function borrarTodo(): Promise<void> {
  if (!confirm('⚠️ ¿Borrar TODOS los datos? Mejor exporta un respaldo primero. Esta acción no se puede deshacer.')) return;
  if (!confirm('¿De verdad? Se borrará todo permanentemente.')) return;
  await borrarTodoService();
  renderTodo();
  toast('Datos borrados');
}

async function cargarEjemplo(): Promise<void> {
  const res = await cargarEjemploService();
  if (res.yaHay && !confirm('Ya hay productos. ¿Agregar los de ejemplo de todos modos?')) return;
  await aplicarEjemplos();
  toast('🎨 Datos de ejemplo cargados');
  renderTodo();
}

export function initAjustes(): void {
  registerViewRenderers({ ajustes: renderStats });
  window.exportar = exportar;
  window.importar = importar;
  window.borrarTodo = borrarTodo;
  window.cargarEjemplo = cargarEjemplo;
}
