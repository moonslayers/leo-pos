import type { CarritoItem, Producto, Venta } from '../types';
import { fmt } from '../core/format';
import { getStorage } from '../storage';

let carrito: CarritoItem[] = [];

export function getCarrito(): CarritoItem[] {
  return carrito;
}

export function setCarrito(items: CarritoItem[]): void {
  carrito = items;
}

export function totalCarrito(): number {
  return carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
}

export type AgregarResult =
  | { ok: false; error: string }
  | { ok: true; nombre: string; warning: string | null };

export async function agregarCarrito(id: number): Promise<AgregarResult> {
  const p = await getStorage().get<Producto>('productos', id);
  if (!p) return { ok: false, error: 'Producto no encontrado' };
  const it = carrito.find(i => i.productoId === id);
  if (it) it.cantidad++;
  else {
    carrito.push({
      productoId: id,
      codigo: p.codigo || '',
      nombre: p.nombre,
      precio: p.precio,
      categoria: p.categoria || 'otros',
      cantidad: 1
    });
  }
  const actual = carrito.find(i => i.productoId === id);
  let warning: string | null = null;
  if (actual && p.stock != null && p.stock > 0 && actual.cantidad > p.stock) {
    warning = '⚠️ Solo hay ' + p.stock + ' en stock';
  }
  return { ok: true, nombre: p.nombre, warning };
}

export function cambiarQty(idx: number, d: number): void {
  const it = carrito[idx];
  if (!it) return;
  it.cantidad += d;
  if (it.cantidad <= 0) carrito.splice(idx, 1);
}

export function quitarItem(idx: number): void {
  carrito.splice(idx, 1);
}

export function vaciarCarrito(): void {
  carrito = [];
}

export async function descontarStock(items: CarritoItem[]): Promise<void> {
  for (const it of items) {
    const p = await getStorage().get<Producto>('productos', it.productoId);
    if (p) {
      p.stock = (p.stock || 0) - it.cantidad;
      await getStorage().put<Producto>('productos', p);
    }
  }
}

export type CobrarResult =
  | { ok: false; error: string }
  | { ok: true; total: number; mensaje: string };

export async function cobrarContado(): Promise<CobrarResult> {
  if (!carrito.length) return { ok: false, error: 'Primero agrega productos al carrito 🛒' };
  const total = totalCarrito();
  await getStorage().put<Venta>('ventas', {
    tipo: 'contado',
    items: carrito.map(i => ({ ...i })),
    total,
    fecha: Date.now()
  });
  await descontarStock(carrito);
  carrito = [];
  return { ok: true, total, mensaje: '✅ Venta cobrada: ' + fmt(total) };
}
