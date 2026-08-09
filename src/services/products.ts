import type { Producto } from '../types';
import { getStorage } from '../storage';

export interface ProductoInput {
  codigo: string;
  nombre: string;
  categoria: string;
  precio: number;
  costo: number;
  stock: number;
}

export type GuardarProductoResult =
  | { ok: false; error: string }
  | { ok: false; duplicate: Producto; confirmMsg: string }
  | { ok: true; id: number; mensaje: string };

export async function guardarProducto(
  input: ProductoInput,
  editandoId?: number,
  forzar?: boolean
): Promise<GuardarProductoResult> {
  const nombre = input.nombre.trim();
  const precio = input.precio;
  if (!nombre) return { ok: false, error: 'Escribe el nombre' };
  if (!(precio > 0)) return { ok: false, error: 'Precio inválido' };

  const obj: Producto = {
    codigo: input.codigo.trim(),
    nombre,
    categoria: input.categoria,
    precio,
    costo: input.costo || 0,
    stock: input.stock || 0
  };

  if (obj.codigo) {
    const existe = await getStorage().findByCode(obj.codigo);
    if (existe && existe.id !== editandoId && !forzar) {
      return {
        ok: false,
        duplicate: existe,
        confirmMsg: 'Ya existe "' + existe.nombre + '" con ese código. ¿Guardar de todos modos?'
      };
    }
  }

  if (editandoId) obj.id = editandoId;
  const id = await getStorage().put<Producto>('productos', obj);
  return { ok: true, id, mensaje: '✅ Producto guardado' };
}

export async function eliminarProducto(id: number): Promise<void> {
  await getStorage().del('productos', id);
}

export function ajustarStock(cur: number, d: number): number {
  return Math.max(cur + d, 0);
}
