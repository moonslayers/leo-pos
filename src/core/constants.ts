import type { Categoria, Frecuencia, StoreName } from '../types';

export const DB_NAME = 'leonides_pos';
export const DB_VERSION = 1;
export const STORES: StoreName[] = ['productos', 'ventas', 'clientes', 'abonos'];
export const LS_KEY = 'leonides_pos_data_v1';
export const TOUR_KEY = 'leonides_tours_v1';

export const CATS: Categoria[] = [
  { id: 'ilusion', nombre: 'Lencería Ilusión', emoji: '👙', color: '#ec4899' },
  { id: 'fraiche', nombre: 'Perfume Fraiche', emoji: '🌺', color: '#8b5cf6' },
  { id: 'cosmeticos', nombre: 'Cosméticos', emoji: '💄', color: '#f59e0b' },
  { id: 'otros', nombre: 'Otros', emoji: '📦', color: '#6b7280' }
];

export const FREQ_TXT: Record<Frecuencia, string> = {
  semanal: 'Cada semana',
  quincenal: 'Cada quincena',
  mensual: 'Cada mes'
};

export function catInfo(categoriaId?: string): Categoria {
  return CATS.find(c => c.id === categoriaId) || CATS[3];
}
