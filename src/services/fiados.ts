import type { Abono, Cliente, Frecuencia, PlanPago, Venta } from '../types';
import { fechaLocal, fmt } from '../core/format';
import { getStorage } from '../storage';
import { descontarStock, getCarrito, setCarrito, totalCarrito } from './sales';

let fiandoClienteId: number | null = null;
let planElegido: PlanPago = 'uno';

export function setFiandoClienteId(id: number | null): void {
  fiandoClienteId = id;
}

export function getPlanElegido(): PlanPago {
  return planElegido;
}

export function elegirPlan(p: PlanPago): void {
  planElegido = p;
}

export function cambiarNumPagos(cur: number, d: number): number {
  return Math.max(2, cur + d);
}

export function setAbonoChip(v: string, total: number): string {
  return v === 'mitad' ? (total / 2).toFixed(2) : v;
}

export function setFechaChip(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return fechaLocal(d);
}

export function frecuenciaCambio(f: Frecuencia, fechaActual: string): string | null {
  if (f && !fechaActual) return setFechaChip(f === 'semanal' ? 7 : f === 'quincenal' ? 14 : 30);
  return null;
}

export interface ResumenCondiciones {
  abono: number;
  saldo: number;
  porPago: string | null;
}

export function actualizarResumenCondiciones(
  total: number,
  abonoRaw: string,
  plan: PlanPago,
  numPagosRaw: string
): ResumenCondiciones {
  const abono = Math.min(parseFloat(abonoRaw) || 0, total);
  const saldo = total - abono;
  let porPago: string | null = null;
  if (plan === 'parcial') {
    const n = Math.max(2, parseInt(numPagosRaw, 10) || 2);
    porPago = '≈ ' + fmt(saldo / n) + ' cada pago';
  }
  return { abono, saldo, porPago };
}

export interface CondicionesFiado {
  abonoInicial: number;
  saldo: number;
  plan: PlanPago;
  numPagos: number | null;
  frecuencia: Frecuencia | null;
  proximaFecha: number | null;
}

export type CondicionesResult =
  | { ok: false; error: string }
  | { ok: true; condiciones: CondicionesFiado };

export function calcularCondiciones(
  total: number,
  abonoRaw: string,
  numPagosRaw: string,
  frecuenciaRaw: string,
  fechaRaw: string
): CondicionesResult {
  let abonoInicial = parseFloat(abonoRaw) || 0;
  if (abonoInicial < 0) abonoInicial = 0;
  if (abonoInicial > total) return { ok: false, error: 'El abono inicial no puede ser mayor al total' };
  const saldo = total - abonoInicial;
  const plan = planElegido;
  const numPagos = plan === 'parcial' ? Math.max(2, parseInt(numPagosRaw, 10) || 2) : null;
  const frecuencia = frecuenciaRaw ? (frecuenciaRaw as Frecuencia) : null;
  let proximaFecha: number | null = null;
  if (fechaRaw) {
    proximaFecha = new Date(fechaRaw + 'T12:00:00').getTime();
  } else if (frecuencia) {
    const dias = frecuencia === 'semanal' ? 7 : frecuencia === 'quincenal' ? 14 : 30;
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(12, 0, 0, 0);
    proximaFecha = d.getTime();
  }
  return {
    ok: true,
    condiciones: { abonoInicial, saldo, plan, numPagos, frecuencia, proximaFecha }
  };
}

export type RegistrarFiadoResult =
  | { ok: false; error: string }
  | { ok: true; saldo: number; clienteNombre: string; mensaje: string };

export async function registrarFiado(condiciones: CondicionesFiado): Promise<RegistrarFiadoResult> {
  if (fiandoClienteId == null) return { ok: false, error: 'Selecciona un cliente' };
  const c = await getStorage().get<Cliente>('clientes', fiandoClienteId);
  if (!c || c.id == null) return { ok: false, error: 'Cliente no encontrado' };
  const carrito = getCarrito();
  const total = totalCarrito();
  const { abonoInicial, saldo, plan, numPagos, frecuencia, proximaFecha } = condiciones;

  await getStorage().put<Venta>('ventas', {
    tipo: 'fiado',
    clienteId: c.id,
    clienteNombre: c.nombre,
    items: carrito.map(i => ({ ...i })),
    total,
    abonoInicial,
    saldo,
    plan,
    numPagos,
    frecuencia,
    proximaFecha,
    fecha: Date.now()
  });
  if (abonoInicial > 0) {
    await getStorage().put<Abono>('abonos', {
      clienteId: c.id,
      monto: abonoInicial,
      fecha: Date.now(),
      nota: 'Abono inicial'
    });
  }
  await descontarStock(carrito);
  setCarrito([]);

  const mensaje =
    saldo > 0
      ? '📓 Fiado a ' + c.nombre + ' · quedó debiendo ' + fmt(saldo)
      : '✅ ' + c.nombre + ' pagó todo, quedó al corriente';
  return { ok: true, saldo, clienteNombre: c.nombre, mensaje };
}
