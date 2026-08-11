import type { Storage } from './storage';
import { IndexedDBStorage } from './indexed-db';
import { LocalStorageStorage } from './local-storage';
import type { StoreName } from '../types';

let instance: Storage | null = null;

export type SyncTrackingHook = (store: StoreName, id: number, tipo: 'put' | 'del') => void;

let trackingHook: SyncTrackingHook | null = null;
let trackingDepth = 0;

export function setSyncTrackingHook(hook: SyncTrackingHook | null): void {
  trackingHook = hook;
}

/**
 * Ejecuta `fn` con el tracking de sync SUPRIMIDO (contador de profundidad).
 * El hook no se dispara mientras el contador > 0. Sirve para que las escrituras
 * del propio sync (pull/importación) no marquen dirty. Con `fn` async el contador
 * baja al resolver la promesa, no antes, así que no hay ventana global de
 * supresión: los puts/dels del usuario durante los awaits de red SÍ se marcan.
 */
export function sinTracking<T>(fn: () => Promise<T> | T): Promise<T> | T {
  trackingDepth++;
  let result: Promise<T> | T;
  try {
    result = fn();
  } catch (e) {
    trackingDepth--;
    throw e;
  }
  if (result instanceof Promise) {
    return result.finally(() => {
      trackingDepth--;
    });
  }
  trackingDepth--;
  return result;
}

function conTracking(base: Storage): Storage {
  return {
    init: () => base.init(),
    getAll: <T,>(store: StoreName) => base.getAll<T>(store),
    get: <T,>(store: StoreName, id: number) => base.get<T>(store, id),
    put: async <T,>(store: StoreName, value: T): Promise<number> => {
      const id = await base.put(store, value);
      if (trackingDepth === 0 && trackingHook && typeof id === 'number') trackingHook(store, id, 'put');
      return id;
    },
    del: async (store: StoreName, id: number): Promise<void> => {
      await base.del(store, id);
      if (trackingDepth === 0 && trackingHook) trackingHook(store, id, 'del');
    },
    clear: (store: StoreName) => base.clear(store),
    findByCode: (codigo: string) => base.findByCode(codigo),
    getBackend: () => base.getBackend()
  };
}

export async function initStorage(): Promise<Storage> {
  if (instance) return instance;
  let storage: Storage;
  try {
    if (!window.indexedDB) throw new Error('IndexedDB no existe en este navegador');
    storage = new IndexedDBStorage();
    await storage.init();
  } catch {
    console.warn('⚠️ IndexedDB no disponible aquí; los datos se guardarán en localStorage');
    storage = new LocalStorageStorage();
    await storage.init();
  }
  instance = conTracking(storage);
  return instance;
}

export function getStorage(): Storage {
  if (!instance) throw new Error('Storage no inicializado: llama a initStorage() antes de usar getStorage()');
  return instance;
}
