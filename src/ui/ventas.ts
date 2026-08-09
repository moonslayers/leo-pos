import type { Cliente, Frecuencia, PlanPago, Producto } from '../types';
import { catInfo } from '../core/constants';
import { esc, fmt } from '../core/format';
import { getStorage } from '../storage';
import { $, abrirModal, cerrarModal, toast } from './dom';
import { renderCarrito } from './cart';
import { mostrarVista, registerViewRenderers } from './navigation';
import { calcularDeudas, crearCliente } from '../services/clients';
import {
  actualizarResumenCondiciones as fiadoActualizarResumen,
  calcularCondiciones,
  cambiarNumPagos as fiadoCambiarNumPagos,
  elegirPlan as fiadoElegirPlan,
  frecuenciaCambio as fiadoFrecuenciaCambio,
  getPlanElegido,
  registrarFiado as fiadoRegistrarFiado,
  setAbonoChip as fiadoSetAbonoChip,
  setFechaChip as fiadoSetFechaChip,
  setFiandoClienteId
} from '../services/fiados';
import {
  cobrarContado as salesCobrarContado,
  getCarrito,
  totalCarrito
} from '../services/sales';

declare global {
  interface Window {
    agregarCarrito: (id: number) => Promise<void>;
    cobrarContado: () => Promise<void>;
    iniciarFiado: () => Promise<void>;
    seleccionarClienteFiado: (id: number) => Promise<void>;
    crearClienteYFiar: () => Promise<void>;
    elegirPlan: (p: PlanPago) => void;
    cambiarNumPagos: (d: number) => void;
    setAbonoChip: (v: string) => void;
    setFechaChip: (dias: number) => void;
    frecuenciaCambio: () => void;
    actualizarResumenCondiciones: () => void;
    registrarFiado: () => Promise<void>;
  }
}

/* ================= Lista de productos (vista ventas) ================= */
export async function renderVentaProductos(): Promise<void> {
  const q = (($('buscarVenta') as HTMLInputElement).value || '').trim().toLowerCase();
  let prods = await getStorage().getAll<Producto>('productos');
  if (q) {
    prods = prods.filter(
      p => (p.nombre || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q)
    );
  }
  prods.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  const cont = $('listaVentaProductos');
  if (!prods.length) {
    cont.innerHTML =
      '<div class="card" style="text-align:center;color:#9ca3af;font-size:13px">No hay productos todavía.<br><br><button class="btn btn-primary" onclick="nuevoProducto()">＋ Crear mi primer producto</button></div>';
    return;
  }
  cont.innerHTML = prods
    .map(p => {
      const c = catInfo(p.categoria);
      const stock = p.stock || 0;
      return `<div class="card fila-prod">
      <div style="flex:1;min-width:0">
        <div class="p-nom">${c.emoji} ${esc(p.nombre)}</div>
        <div class="p-meta"><span class="chip" style="background:${c.color}18;color:${c.color}">${c.nombre}</span> &nbsp;<span class="stock ${stock <= 0 ? 'rojo' : stock <= 3 ? 'naranja' : 'verde'}">Stock: ${stock}</span></div>
        <div class="p-precio">${fmt(p.precio)}</div>
      </div>
      <button class="btn-add" onclick="agregarCarrito(${p.id})">＋</button>
    </div>`;
    })
    .join('');
}

/* ================= Carrito y ventas ================= */
async function cobrarContado(): Promise<void> {
  if (!getCarrito().length) {
    toast('Primero agrega productos al carrito 🛒');
    return;
  }
  const total = totalCarrito();
  if (!confirm('¿Cobrar ' + fmt(total) + ' en efectivo?')) return;
  const res = await salesCobrarContado();
  if (!res.ok) {
    toast(res.error);
    return;
  }
  renderCarrito();
  renderVentaProductos();
  toast(res.mensaje);
}

/* ---------- Fiado: paso 1 (cliente) ---------- */
async function iniciarFiado(): Promise<void> {
  if (!getCarrito().length) {
    toast('Primero agrega productos al carrito 🛒');
    return;
  }
  $('fiadoTotal').textContent = fmt(totalCarrito());
  const deudas = await calcularDeudas();
  deudas.sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre));
  $('listaClientesFiado').innerHTML = deudas.length
    ? deudas
        .map(m => {
          const cid = m.cliente.id;
          if (cid == null) return '';
          return `<div class="fila-cliente card" onclick="seleccionarClienteFiado(${cid})">
      <div style="flex:1;min-width:0">
        <div class="p-nom">👤 ${esc(m.cliente.nombre)}</div>
        ${m.cliente.telefono ? `<div class="p-meta">${esc(m.cliente.telefono)}</div>` : ''}
      </div>
      ${m.deuda > 0 ? `<div class="deuda" style="font-size:14px">${fmt(m.deuda)}</div>` : '<div style="color:#059669;font-size:13px">✓ al corriente</div>'}
    </div>`;
        })
        .join('')
    : '<div style="color:#9ca3af;text-align:center;padding:10px;font-size:13px">Aún no hay clientes. Crea el primero arriba 👆</div>';
  abrirModal('mClientes');
}

async function seleccionarClienteFiado(id: number): Promise<void> {
  const c = await getStorage().get<Cliente>('clientes', id);
  if (!c) return;
  cerrarModal('mClientes');
  setFiandoClienteId(id);
  $('condCliente').textContent = c.nombre;
  $('condTotal').textContent = fmt(totalCarrito());
  ($('condAbono') as HTMLInputElement).value = '';
  ($('condNumPagos') as HTMLInputElement).value = '2';
  ($('condFrecuencia') as HTMLSelectElement).value = '';
  ($('condFecha') as HTMLInputElement).value = '';
  elegirPlan('uno');
  actualizarResumenCondiciones();
  abrirModal('mCondiciones');
}

async function crearClienteYFiar(): Promise<void> {
  const nombre = ($('nuevoClienteFiado') as HTMLInputElement).value.trim();
  if (!nombre) {
    toast('Escribe el nombre');
    return;
  }
  const telefono = ($('nuevoClienteFiadoTel') as HTMLInputElement).value.trim();
  const id = await crearCliente(nombre, telefono);
  ($('nuevoClienteFiado') as HTMLInputElement).value = '';
  ($('nuevoClienteFiadoTel') as HTMLInputElement).value = '';
  await seleccionarClienteFiado(id);
}

/* ---------- Fiado: paso 2 (condiciones) ---------- */
function elegirPlan(p: PlanPago): void {
  fiadoElegirPlan(p);
  $('planUno').classList.toggle('plan-activo', p === 'uno');
  $('planParcial').classList.toggle('plan-activo', p === 'parcial');
  $('filaNumPagos').style.display = p === 'parcial' ? 'block' : 'none';
  actualizarResumenCondiciones();
}

function cambiarNumPagos(d: number): void {
  const i = $('condNumPagos') as HTMLInputElement;
  i.value = String(fiadoCambiarNumPagos(parseInt(i.value, 10) || 2, d));
  actualizarResumenCondiciones();
}

function setAbonoChip(v: string): void {
  ($('condAbono') as HTMLInputElement).value = fiadoSetAbonoChip(v, totalCarrito());
  actualizarResumenCondiciones();
}

function setFechaChip(dias: number): void {
  ($('condFecha') as HTMLInputElement).value = fiadoSetFechaChip(dias);
}

function frecuenciaCambio(): void {
  const f = ($('condFrecuencia') as HTMLSelectElement).value;
  const fechaEl = $('condFecha') as HTMLInputElement;
  const nueva = f ? fiadoFrecuenciaCambio(f as Frecuencia, fechaEl.value) : null;
  if (nueva) fechaEl.value = nueva;
}

function actualizarResumenCondiciones(): void {
  const plan = getPlanElegido();
  const r = fiadoActualizarResumen(
    totalCarrito(),
    ($('condAbono') as HTMLInputElement).value,
    plan,
    ($('condNumPagos') as HTMLInputElement).value
  );
  $('condSaldo').textContent = fmt(r.saldo);
  if (plan === 'parcial') {
    $('condPorPago').textContent = r.porPago ?? '';
  }
}

async function registrarFiado(): Promise<void> {
  const total = totalCarrito();
  const cond = calcularCondiciones(
    total,
    ($('condAbono') as HTMLInputElement).value,
    ($('condNumPagos') as HTMLInputElement).value,
    ($('condFrecuencia') as HTMLSelectElement).value,
    ($('condFecha') as HTMLInputElement).value
  );
  if (!cond.ok) {
    toast(cond.error);
    return;
  }
  const res = await fiadoRegistrarFiado(cond.condiciones);
  if (!res.ok) {
    toast(res.error);
    return;
  }
  renderCarrito();
  renderVentaProductos();
  cerrarModal('mCondiciones');
  toast(res.mensaje);
}

/* ---------- Escáner: rama 'venta' ---------- */
function abrirNuevoProducto(codigo?: string): void {
  mostrarVista('productos');
  const fn = (window as unknown as Record<string, unknown>).nuevoProducto;
  if (typeof fn === 'function') (fn as (c?: string) => void)(codigo);
}

export async function onCodeForVenta(codigo: string): Promise<void> {
  const p = await getStorage().findByCode(codigo);
  if (p) {
    if (p.id != null) await window.agregarCarrito(p.id);
    toast('✅ ' + p.nombre + ' agregado');
  } else if (confirm('No hay producto con el código ' + codigo + '. ¿Darlo de alta?')) {
    abrirNuevoProducto(codigo);
  }
}

/* ================= Registro ================= */
export function initVentas(): void {
  registerViewRenderers({ ventas: renderVentaProductos });
  $('buscarVenta').addEventListener('input', renderVentaProductos);
  window.cobrarContado = cobrarContado;
  window.iniciarFiado = iniciarFiado;
  window.seleccionarClienteFiado = seleccionarClienteFiado;
  window.crearClienteYFiar = crearClienteYFiar;
  window.elegirPlan = elegirPlan;
  window.cambiarNumPagos = cambiarNumPagos;
  window.setAbonoChip = setAbonoChip;
  window.setFechaChip = setFechaChip;
  window.frecuenciaCambio = frecuenciaCambio;
  window.actualizarResumenCondiciones = actualizarResumenCondiciones;
  window.registrarFiado = registrarFiado;
}
