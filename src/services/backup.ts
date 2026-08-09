import type { Abono, Cliente, Producto, Venta } from '../types';
import { STORES } from '../core/constants';
import { getStorage } from '../storage';
import { setCarrito } from './sales';

export interface BackupPayload {
  _app: string;
  _version: number;
  _fecha: string;
  productos: Producto[];
  ventas: Venta[];
  clientes: Cliente[];
  abonos: Abono[];
}

export interface ExportarResult {
  nombre: string;
  json: string;
}

export async function exportar(): Promise<ExportarResult> {
  const [productos, ventas, clientes, abonos] = await Promise.all([
    getStorage().getAll<Producto>('productos'),
    getStorage().getAll<Venta>('ventas'),
    getStorage().getAll<Cliente>('clientes'),
    getStorage().getAll<Abono>('abonos')
  ]);
  const data: BackupPayload = {
    _app: 'Leonides POS',
    _version: 1,
    _fecha: new Date().toISOString(),
    productos,
    ventas,
    clientes,
    abonos
  };
  const nombre = 'leonides_pos_respaldo_' + new Date().toISOString().slice(0, 10) + '.json';
  return { nombre, json: JSON.stringify(data, null, 2) };
}

export type ParseBackupResult =
  | { ok: false; error: string }
  | { ok: true; data: BackupPayload; confirmMsg: string };

export async function parseBackup(text: string): Promise<ParseBackupResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Error al importar: ' + (e instanceof Error ? e.message : String(e)) };
  }
  const data = parsed as Partial<BackupPayload>;
  if (!data || (!Array.isArray(data.productos) && !Array.isArray(data.ventas))) {
    return { ok: false, error: 'El archivo no es un respaldo válido' };
  }
  const nP = (data.productos || []).length;
  const nV = (data.ventas || []).length;
  const nC = (data.clientes || []).length;
  const nA = (data.abonos || []).length;
  const confirmMsg =
    'El respaldo contiene:\n' + nP + ' productos, ' + nV + ' ventas, ' + nC + ' clientes, ' +
    nA + ' abonos.\n\nEsto REEMPLAZARÁ los datos actuales. ¿Continuar?';
  return { ok: true, data: data as BackupPayload, confirmMsg };
}

export async function applyImport(data: BackupPayload): Promise<void> {
  for (const s of STORES) await getStorage().clear(s);
  for (const p of data.productos || []) await getStorage().put<Producto>('productos', p);
  for (const v of data.ventas || []) await getStorage().put<Venta>('ventas', v);
  for (const c of data.clientes || []) await getStorage().put<Cliente>('clientes', c);
  for (const a of data.abonos || []) await getStorage().put<Abono>('abonos', a);
  setCarrito([]);
}

export async function borrarTodo(): Promise<void> {
  for (const s of STORES) await getStorage().clear(s);
  setCarrito([]);
}

export const EJEMPLOS: Producto[] = [
  { codigo: '7501000000015', nombre: 'Conjunto encaje rosa Ilusión', categoria: 'ilusion', precio: 350, costo: 200, stock: 5 },
  { codigo: '7501000000022', nombre: 'Brasier varilla Ilusión 34B', categoria: 'ilusion', precio: 180, costo: 95, stock: 8 },
  { codigo: '7501000000039', nombre: 'Panty encaje Ilusión', categoria: 'ilusion', precio: 60, costo: 28, stock: 20 },
  { codigo: '7501000000046', nombre: 'Fraiche inspiración floral 50 ml', categoria: 'fraiche', precio: 250, costo: 140, stock: 6 },
  { codigo: '7501000000053', nombre: 'Fraiche lavanda 30 ml', categoria: 'fraiche', precio: 180, costo: 100, stock: 4 },
  { codigo: '7501000000060', nombre: 'Labial mate rojo', categoria: 'cosmeticos', precio: 95, costo: 45, stock: 10 },
  { codigo: '7501000000077', nombre: 'Rímel volumen', categoria: 'cosmeticos', precio: 120, costo: 60, stock: 3 },
  { codigo: '7501000000084', nombre: 'Base líquida tono 2', categoria: 'cosmeticos', precio: 150, costo: 80, stock: 2 }
];

export interface CargarEjemploResult {
  ok: true;
  yaHay: boolean;
}

export async function cargarEjemplo(): Promise<CargarEjemploResult> {
  const prods = await getStorage().getAll<Producto>('productos');
  return { ok: true, yaHay: prods.length > 0 };
}

export async function aplicarEjemplos(): Promise<void> {
  for (const p of EJEMPLOS) await getStorage().put<Producto>('productos', { ...p });
}
