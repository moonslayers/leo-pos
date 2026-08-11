import type { Abono, Cliente, DeudaCliente, Movimiento, Venta } from '../types';
import { fmt, fmtF, inicioDia } from '../core/format';
import { FREQ_TXT } from '../core/constants';
import { getStorage } from '../storage';

export async function calcularDeudas(): Promise<DeudaCliente[]> {
  const [ventas, clientes, abonos] = await Promise.all([
    getStorage().getAll<Venta>('ventas'),
    getStorage().getAll<Cliente>('clientes'),
    getStorage().getAll<Abono>('abonos')
  ]);
  const map: Record<number, DeudaCliente> = {};
  clientes.forEach(c => {
    if (c.id != null) {
      map[c.id] = {
        cliente: c,
        deuda: 0,
        fiados: 0,
        ultimo: null,
        plan: null,
        numPagos: null,
        frecuencia: null,
        proximaFecha: null,
        _fechaUlt: 0
      };
    }
  });
  ventas.filter(v => v.tipo === 'fiado').forEach(v => {
    if (v.clienteId == null) return;
    const id = v.clienteId;
    if (!map[id]) {
      map[id] = {
        cliente: { id, nombre: v.clienteNombre || 'Cliente ' + id },
        deuda: 0,
        fiados: 0,
        ultimo: null,
        plan: null,
        numPagos: null,
        frecuencia: null,
        proximaFecha: null,
        _fechaUlt: 0
      };
    }
    const m = map[id];
    m.deuda += v.total;
    m.fiados++;
    m.ultimo = Math.max(m.ultimo || 0, v.fecha);
    if (v.fecha >= m._fechaUlt) {
      m._fechaUlt = v.fecha;
      m.plan = v.plan || null;
      m.numPagos = v.numPagos || null;
      m.frecuencia = v.frecuencia || null;
      m.proximaFecha = v.proximaFecha || null;
    }
  });
  abonos.forEach(a => {
    if (map[a.clienteId]) map[a.clienteId].deuda -= a.monto;
  });
  return Object.values(map);
}

function construirPlanPago(fiadoConPlan: Venta, deuda: number): string | null {
  if (deuda <= 0) return null;
  const hoy = inicioDia(Date.now());
  let txt = '📋 <b>Plan de pago:</b> ' + (fiadoConPlan.plan === 'uno' ? '1 solo pago' : 'En ' + fiadoConPlan.numPagos + ' partes');
  if (fiadoConPlan.frecuencia) txt += ' · ' + FREQ_TXT[fiadoConPlan.frecuencia];
  if (fiadoConPlan.proximaFecha) {
    const pf = fiadoConPlan.proximaFecha;
    if (pf < hoy) txt += '<br><b style="color:#dc2626">⚠️ Pago atrasado (era el ' + fmtF(pf) + ')</b>';
    else if (pf === hoy) txt += '<br><b style="color:#d97706">📅 Paga hoy</b>';
    else txt += '<br>📅 Próximo pago: <b>' + fmtF(pf) + '</b>';
  }
  return txt;
}

export interface DetalleClienteResult {
  cliente: Cliente;
  deuda: number;
  planDiv: string | null;
  movs: Movimiento[];
}

export async function detalleCliente(id: number): Promise<DetalleClienteResult | null> {
  const [cliente, ventas, abonos] = await Promise.all([
    getStorage().get<Cliente>('clientes', id),
    getStorage().getAll<Venta>('ventas'),
    getStorage().getAll<Abono>('abonos')
  ]);
  if (!cliente) return null;
  const fiados = ventas.filter(v => v.tipo === 'fiado' && v.clienteId === id);
  const abs = abonos.filter(a => a.clienteId === id);
  const deuda = fiados.reduce((s, v) => s + v.total, 0) - abs.reduce((s, a) => s + a.monto, 0);

  const fiadoConPlan = fiados.filter(f => f.plan).sort((a, b) => b.fecha - a.fecha)[0];
  const planDiv = fiadoConPlan ? construirPlanPago(fiadoConPlan, deuda) : null;

  const movs: Movimiento[] = [
    ...fiados.map(v => ({
      tipo: 'fiado' as const,
      fecha: v.fecha,
      monto: v.total,
      id: v.id ?? 0,
      det:
        (v.previa
          ? 'Deuda previa (cuaderno)'
          : v.items.map(i => i.cantidad + '× ' + i.nombre).join(', ')) +
        (v.abonoInicial ? ' · abono inicial ' + fmt(v.abonoInicial) : '')
    })),
    ...abs.map(a => ({
      tipo: 'abono' as const,
      fecha: a.fecha,
      monto: a.monto,
      id: a.id ?? 0,
      det: a.nota || 'Abono en efectivo'
    }))
  ].sort((a, b) => b.fecha - a.fecha);

  return { cliente, deuda, planDiv, movs };
}

export async function eliminarMov(tipo: 'fiado' | 'abono', id: number): Promise<void> {
  await getStorage().del(tipo === 'fiado' ? 'ventas' : 'abonos', id);
}

export async function eliminarCliente(id: number): Promise<void> {
  const [ventas, abonos] = await Promise.all([
    getStorage().getAll<Venta>('ventas'),
    getStorage().getAll<Abono>('abonos')
  ]);
  for (const v of ventas.filter(v => v.clienteId === id)) {
    if (v.id != null) await getStorage().del('ventas', v.id);
  }
  for (const a of abonos.filter(a => a.clienteId === id)) {
    if (a.id != null) await getStorage().del('abonos', a.id);
  }
  await getStorage().del('clientes', id);
}

export function abonoMontoInicial(deuda: number): string {
  return deuda > 0 ? deuda.toFixed(2) : '';
}

export type GuardarAbonoResult =
  | { ok: false; error: string }
  | { ok: true; monto: number; mensaje: string };

export async function guardarAbono(clienteId: number, montoRaw: string): Promise<GuardarAbonoResult> {
  const monto = parseFloat(montoRaw);
  if (!monto || monto <= 0) return { ok: false, error: 'Monto inválido' };
  await getStorage().put<Abono>('abonos', { clienteId, monto, fecha: Date.now() });
  return { ok: true, monto, mensaje: '💰 Abono registrado: ' + fmt(monto) };
}

export async function crearCliente(nombre: string, telefono: string): Promise<number> {
  return getStorage().put<Cliente>('clientes', { nombre, telefono });
}

export type GuardarClienteResult =
  | { ok: false; error: string }
  | { ok: true; id: number; mensaje: string };

export async function guardarClienteNuevo(nombre: string, telefono: string): Promise<GuardarClienteResult> {
  const n = nombre.trim();
  if (!n) return { ok: false, error: 'Escribe el nombre' };
  const id = await crearCliente(n, telefono.trim());
  return { ok: true, id, mensaje: '✅ Cliente guardado' };
}

export type DeudaPreviaResult =
  | { ok: true; mensaje: string }
  | { ok: false; mensaje: string; errores?: string[] };

export async function registrarDeudaPrevia(input: {
  clienteId?: number;
  nombre?: string;
  telefono?: string;
  monto: number;
  abono?: number;
  fecha?: number;
}): Promise<DeudaPreviaResult> {
  const { clienteId, monto, abono } = input;
  if (clienteId == null) {
    const n = (input.nombre || '').trim();
    if (!n) return { ok: false, mensaje: 'Escribe el nombre' };
    input.nombre = n;
  }
  if (!monto || monto <= 0) return { ok: false, mensaje: 'Monto inválido' };
  if (abono != null) {
    if (Number.isNaN(abono)) return { ok: false, mensaje: 'El abono debe ser un número válido' };
    if (abono < 0) return { ok: false, mensaje: 'El abono no puede ser negativo' };
    if (abono > monto) return { ok: false, mensaje: 'El abono no puede ser mayor al monto' };
  }

  let clienteIdFinal: number;
  let clienteNombre: string;
  if (clienteId != null) {
    const c = await getStorage().get<Cliente>('clientes', clienteId);
    if (!c) return { ok: false, mensaje: 'Cliente no encontrado' };
    clienteIdFinal = c.id ?? clienteId;
    clienteNombre = c.nombre;
  } else {
    clienteIdFinal = await crearCliente(input.nombre!, (input.telefono || '').trim());
    clienteNombre = input.nombre!;
  }

  const fecha = input.fecha ?? Date.now();
  const abonoFinal = abono || 0;

  await getStorage().put<Venta>('ventas', {
    tipo: 'fiado',
    items: [],
    clienteId: clienteIdFinal,
    clienteNombre,
    total: monto,
    abonoInicial: abonoFinal,
    saldo: monto - abonoFinal,
    plan: null,
    numPagos: null,
    frecuencia: null,
    proximaFecha: null,
    fecha,
    previa: true
  });
  if (abonoFinal > 0) {
    await getStorage().put<Abono>('abonos', {
      clienteId: clienteIdFinal,
      monto: abonoFinal,
      fecha,
      nota: 'Deuda previa'
    });
  }

  return { ok: true, mensaje: '📓 Deuda previa registrada: ' + fmt(monto) };
}

export function recordarWhatsApp(c: Cliente, deuda: number): string {
  let tel = (c.telefono || '').replace(/\D/g, '');
  if (tel.length === 10) tel = '52' + tel;
  const msg =
    'Hola ' + c.nombre + ' 👋, le saluda Leonides. Le recuerdo amablemente su cuenta pendiente: ' +
    fmt(deuda) + '. ¡Muchas gracias! 🌸';
  return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg);
}
