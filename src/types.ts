export type StoreName = 'productos' | 'ventas' | 'clientes' | 'abonos';

export type PlanPago = 'uno' | 'parcial';

export type Frecuencia = 'semanal' | 'quincenal' | 'mensual';

export type TipoVenta = 'contado' | 'fiado';

export type Vista = 'ventas' | 'productos' | 'fiados' | 'dashboard' | 'ajustes';

export interface Producto {
  id?: number;
  codigo: string;
  nombre: string;
  categoria: string;
  precio: number;
  costo?: number;
  stock: number;
}

export interface CarritoItem {
  productoId: number;
  codigo: string;
  nombre: string;
  precio: number;
  categoria: string;
  cantidad: number;
}

export interface Venta {
  id?: number;
  tipo: TipoVenta;
  items: CarritoItem[];
  total: number;
  fecha: number;
  clienteId?: number;
  clienteNombre?: string;
  abonoInicial?: number;
  saldo?: number;
  plan?: PlanPago | null;
  numPagos?: number | null;
  frecuencia?: Frecuencia | null;
  proximaFecha?: number | null;
}

export interface Cliente {
  id?: number;
  nombre: string;
  telefono?: string;
}

export interface Abono {
  id?: number;
  clienteId: number;
  monto: number;
  fecha: number;
  nota?: string;
}

export interface Categoria {
  id: string;
  nombre: string;
  emoji: string;
  color: string;
}

export interface TourStep {
  t: string;
  x: string;
  el?: string;
}

export interface DeudaCliente {
  cliente: Cliente;
  deuda: number;
  fiados: number;
  ultimo: number | null;
  plan: PlanPago | null;
  numPagos: number | null;
  frecuencia: Frecuencia | null;
  proximaFecha: number | null;
  _fechaUlt: number;
}

export interface Movimiento {
  tipo: 'fiado' | 'abono';
  fecha: number;
  monto: number;
  id: number;
  det: string;
}
