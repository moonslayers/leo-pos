import type { Categoria, Frecuencia, StoreName } from '../types';

export const DB_NAME = 'leonides_pos';
export const DB_VERSION = 1;
export const STORES: StoreName[] = ['productos', 'ventas', 'clientes', 'abonos'];
export const LS_KEY = 'leonides_pos_data_v1';
export const TOUR_KEY = 'leonides_tours_v1';
export const SYNC_KEY = 'leonides_sync_v1';
export const SYNC_META_KEY = 'leonides_sync_meta_v1';

export const CATS: Categoria[] = [
  { id: 'ilusion', nombre: 'Lencería Ilusión', emoji: '👙', color: '#ec4899' },
  { id: 'fraiche', nombre: 'Perfume Fraiche', emoji: '🌺', color: '#8b5cf6' },
  { id: 'cosmeticos', nombre: 'Cosméticos', emoji: '💄', color: '#f59e0b' },
  { id: 'otros', nombre: 'Otros', emoji: '📦', color: '#6b7280' },
  { id: 'originales', nombre: 'Perfumes Originales', emoji: '💎', color: '#3b82f6' }
];

export const FREQ_TXT: Record<Frecuencia, string> = {
  semanal: 'Cada semana',
  quincenal: 'Cada quincena',
  mensual: 'Cada mes'
};

export function catInfo(categoriaId?: string): Categoria {
  return CATS.find(c => c.id === categoriaId) || CATS[3];
}

export const RULES_TEMPLATE = `rules_version = '2';

service cloud.firestore {

  match /databases/{database}/documents {

    // ------------------------------------------------------------------
    //  RUTA DE SINCRONIZACIÓN: pos/{syncToken}/{store}/{docId}
    // ------------------------------------------------------------------
    //  Única ruta accesible. Todo documento de sincronización vive bajo
    //  este path, donde {syncToken} es la llave compartida entre
    //  dispositivos. Los datos SOLO son legibles/escritibles si el
    //  syncToken del path coincide exactamente con el token esperado.
    //
    //  > REEMPLAZA <SYNC_TOKEN> por el token que genera la app en
    //  > Ajustes → Sincronización (botón "Sincronizar ahora" / "Iniciar
    //  > sync"). Si los dispositivos usan otro token, quedan fuera.
    // ------------------------------------------------------------------
    match /pos/{syncToken}/{store}/{docId} {

      // El token coincide: se permite leer y escribir.
      // write incluye create, update y delete.
      allow read, write: if syncToken == '<SYNC_TOKEN>';

    }

    // ------------------------------------------------------------------
    //  DEFAULT DENY: todo lo demás queda bloqueado.
    //  Sin reglas explícitas, Firestore deniega por defecto; se deja
    //  constancia aquí de que ninguna otra ruta (ni subruta) es accesible.
    // ------------------------------------------------------------------
    match /{document=**} {
      allow read, write: if false;
    }

  }

}`;
