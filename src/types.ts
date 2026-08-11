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

// ---------- Sincronización Firebase Firestore ----------

export interface SyncConfig {
  apiKey?: string;
  projectId?: string;
  appId?: string;
  authDomain?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  syncToken: string;
  deviceId: string;
  intervalMin?: number;
}

export interface SyncMeta {
  version: 1;
  deviceId: string;
  gids: Partial<Record<StoreName, Record<number, string>>>;
  /**
   * updatedAt[store][gid] = timestamp (ms) del último valor conocido localmente
   * (último push/import exitoso). Ya NO se re-estampa para todos los registros en
   * cada push; solo se actualiza para los gids efectivamente subidos o importados.
   */
  updatedAt?: Partial<Record<StoreName, Record<string, number>>>;
  /**
   * dirty[store][gid] = timestamp (ms) de la última MODIFICACIÓN local pendiente
   * de subir. Clave = gid, valor = Date.now() del put local. Se limpia tras
   * subirlo con éxito. Ausente en metas legacy (ver migración en sync.ts).
   */
  dirty?: Partial<Record<StoreName, Record<string, number>>>;
  /**
   * dirtyDel[store][gid] = timestamp (ms) del BORRADO local pendiente. El push lo
   * sube como tombstone (_deleted) aplicando LWW contra el doc remoto.
   */
  dirtyDel?: Partial<Record<StoreName, Record<string, number>>>;
  lastSyncAt?: number;
  lastPushAt?: number;
  lastPullAt?: number;
}

export interface SyncDoc<T = unknown> {
  data: T;
  _gid: string;
  _dev: string;
  _updatedAt: number;
  _deleted?: boolean;
}

export interface SyncResult {
  ok: boolean;
  subidos: number;
  importados: number;
  errores: number;
  fallidas?: string[];
  mensaje: string;
  /**
   * true cuando la UI no debe mostrar este resultado como toast (p. ej. el
   * early-return de "ya hay una sincronización en curso" del motor).
   */
  omitirToast?: boolean;
}
