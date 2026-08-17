import { $, abrirModal, cerrarModal, toast } from './dom';
import { registerViewRenderers } from './navigation';
import { esc, fmt } from '../core/format';
import { catInfo } from '../core/constants';
import {
  ajustarStock as ajustarStockService,
  eliminarProducto as eliminarProductoService,
  guardarProducto as guardarProductoService
} from '../services/products';
import type { ProductoInput } from '../services/products';
import { getStorage } from '../storage';
import type { Producto } from '../types';

declare global {
  interface Window {
    nuevoProducto: (codigo?: string) => void;
    editarProducto: (id: number) => Promise<void>;
    ajustarStock: (d: number) => void;
    guardarProducto: () => Promise<void>;
    eliminarProducto: () => Promise<void>;
  }
}

let editandoProductoId: number | null = null;
let productsChanged: (() => void) | null = null;
let limpiaCodigoModal: (() => void) | null = null;

function calcularCostoDefault(cat: string, precio: number): number | null {
  if (cat === 'ilusion') return Math.round(precio * 0.65 * 100) / 100;
  if (cat === 'fraiche') return Math.max(0, precio - 100);
  return null;
}

function onCostoFieldsChange(): void {
  const cat = ($('fCategoria') as HTMLSelectElement).value;
  const precio = parseFloat(($('fPrecio') as HTMLInputElement).value);
  if (!(precio > 0)) return;
  const costo = calcularCostoDefault(cat, precio);
  if (costo != null) {
    ($('fCosto') as HTMLInputElement).value = String(costo);
  }
}

function registrarListenersCosto(): void {
  limpiaCodigoModal?.();
  const onInput = (): void => onCostoFieldsChange();
  const onChange = (): void => onCostoFieldsChange();
  ($('fPrecio') as HTMLInputElement).addEventListener('input', onInput);
  ($('fCategoria') as HTMLSelectElement).addEventListener('change', onChange);
  limpiaCodigoModal = (): void => {
    ($('fPrecio') as HTMLInputElement).removeEventListener('input', onInput);
    ($('fCategoria') as HTMLSelectElement).removeEventListener('change', onChange);
  };
}

export function onProductsChanged(cb: () => void): void {
  productsChanged = cb;
}

function notifyProductsChanged(): void {
  if (productsChanged) productsChanged();
}

export async function renderProductos(): Promise<void> {
  const q = ($('buscarProducto') as HTMLInputElement).value.trim().toLowerCase();
  let prods = await getStorage().getAll<Producto>('productos');
  if (q) {
    prods = prods.filter(
      (p) => (p.nombre || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q)
    );
  }
  prods.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  $('numProductos').textContent = prods.length + ' producto(s)';
  const cont = $('listaProductos');
  if (!prods.length) {
    cont.innerHTML =
      '<div class="card" style="text-align:center;color:#9ca3af;font-size:13px">Sin productos. Da de alta el primero con el botón ＋ Nuevo o escaneando 📷</div>';
    return;
  }
  cont.innerHTML = prods
    .map((p) => {
      const c = catInfo(p.categoria);
      const stock = p.stock || 0;
      return `<div class="card fila-prod" onclick="editarProducto(${p.id})">
      <div style="flex:1;min-width:0">
        <div class="p-nom">${c.emoji} ${esc(p.nombre)}</div>
        <div class="p-meta"><span class="chip" style="background:${c.color}18;color:${c.color}">${c.nombre}</span>${
          p.codigo ? ' · ' + esc(p.codigo) : ''
        }</div>
        <div class="p-meta">Venta: <b>${fmt(p.precio)}</b>${p.costo ? ' · Costo: ' + fmt(p.costo) : ''}</div>
      </div>
      <div class="stock-badge ${stock <= 0 ? 'rojo' : stock <= 3 ? 'naranja' : 'verde'}">${stock}<span style="font-size:9px;display:block;font-weight:600">piezas</span></div>
    </div>`;
    })
    .join('');
}

export function nuevoProducto(codigo?: string): void {
  editandoProductoId = null;
  $('prodTitulo').textContent = 'Nuevo producto';
  const fCodigo = $('fCodigo') as HTMLInputElement;
  fCodigo.value = codigo || '';
  fCodigo.disabled = false;
  ($('fNombre') as HTMLInputElement).value = '';
  ($('fCategoria') as HTMLSelectElement).value = 'ilusion';
  ($('fPrecio') as HTMLInputElement).value = '';
  ($('fCosto') as HTMLInputElement).value = '';
  ($('fStock') as HTMLInputElement).value = '1';
  $('btnEliminarProducto').classList.add('oculto');
  registrarListenersCosto();
  abrirModal('mProducto');
  fCodigo.focus();
}

export async function editarProducto(id: number): Promise<void> {
  const p = await getStorage().get<Producto>('productos', id);
  if (!p) return;
  editandoProductoId = id;
  $('prodTitulo').textContent = 'Editar producto';
  const fCodigo = $('fCodigo') as HTMLInputElement;
  fCodigo.value = p.codigo || '';
  fCodigo.disabled = false;
  ($('fNombre') as HTMLInputElement).value = p.nombre || '';
  ($('fCategoria') as HTMLSelectElement).value = p.categoria || 'otros';
  ($('fPrecio') as HTMLInputElement).value = p.precio != null ? String(p.precio) : '';
  ($('fCosto') as HTMLInputElement).value = p.costo != null ? String(p.costo) : '';
  ($('fStock') as HTMLInputElement).value = p.stock != null ? String(p.stock) : '0';
  $('btnEliminarProducto').classList.remove('oculto');
  registrarListenersCosto();
  abrirModal('mProducto');
}

export function ajustarStock(d: number): void {
  const i = $('fStock') as HTMLInputElement;
  i.value = String(ajustarStockService(parseInt(i.value) || 0, d));
}

export async function guardarProducto(): Promise<void> {
  const nombre = ($('fNombre') as HTMLInputElement).value.trim();
  const precio = parseFloat(($('fPrecio') as HTMLInputElement).value);
  if (!nombre) {
    toast('Escribe el nombre');
    return;
  }
  if (!(precio > 0)) {
    toast('Precio inválido');
    return;
  }
  const input: ProductoInput = {
    codigo: ($('fCodigo') as HTMLInputElement).value.trim(),
    nombre,
    categoria: ($('fCategoria') as HTMLSelectElement).value,
    precio,
    costo: parseFloat(($('fCosto') as HTMLInputElement).value) || 0,
    stock: parseInt(($('fStock') as HTMLInputElement).value) || 0
  };
  let result = await guardarProductoService(input, editandoProductoId ?? undefined);
  if (!result.ok && 'duplicate' in result) {
    if (!confirm(result.confirmMsg)) return;
    result = await guardarProductoService(input, editandoProductoId ?? undefined, true);
  }
  if (!result.ok) {
    if ('error' in result) toast(result.error);
    return;
  }
  limpiaCodigoModal?.();
  cerrarModal('mProducto');
  toast(result.mensaje);
  void renderProductos();
  notifyProductsChanged();
  const buscar = $('buscarProducto') as HTMLInputElement;
  buscar.value = '';
  setTimeout(() => buscar.focus(), 50);
}

export async function eliminarProducto(): Promise<void> {
  if (!editandoProductoId) return;
  if (!confirm('¿Eliminar este producto? Las ventas pasadas no se borran.')) return;
  await eliminarProductoService(editandoProductoId);
  limpiaCodigoModal?.();
  cerrarModal('mProducto');
  toast('Producto eliminado');
  void renderProductos();
  notifyProductsChanged();
}

export async function onCodeForProducto(codigo: string): Promise<void> {
  const p = await getStorage().findByCode(codigo);
  if (p && p.id != null) {
    if (confirm('Ya existe "' + p.nombre + '" con este código. ¿Editarlo?')) {
      await editarProducto(p.id);
    }
    return;
  }
  nuevoProducto(codigo);
  ($('fCodigo') as HTMLInputElement).disabled = true;
  ($('fNombre') as HTMLInputElement).focus();
}

export function initProductos(): void {
  registerViewRenderers({ productos: renderProductos });
  ($('buscarProducto') as HTMLInputElement).addEventListener('input', () => void renderProductos());
  ($('buscarProducto') as HTMLInputElement).addEventListener('keydown', async (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const val = ($('buscarProducto') as HTMLInputElement).value.trim();
    if (!val) return;
    const p = await getStorage().findByCode(val);
    if (p && p.id != null) {
      if (confirm('Ya existe "' + p.nombre + '" con este código. ¿Editarlo?')) {
        await editarProducto(p.id);
      }
      return;
    }
    if (/^\d{4,}$/.test(val)) {
      nuevoProducto(val);
      ($('fCodigo') as HTMLInputElement).disabled = true;
      ($('fNombre') as HTMLInputElement).focus();
    }
  });
  $('mProducto').addEventListener('click', (e) => {
    if ((e.target as Element)?.classList?.contains('ci-del')) {
      ($('fCodigo') as HTMLInputElement).disabled = false;
      ($('fCodigo') as HTMLInputElement).value = '';
    }
  });
  window.nuevoProducto = nuevoProducto;
  window.editarProducto = editarProducto;
  window.ajustarStock = ajustarStock;
  window.guardarProducto = guardarProducto;
  window.eliminarProducto = eliminarProducto;
}
