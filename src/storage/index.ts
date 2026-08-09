import type { Storage } from './storage';
import { IndexedDBStorage } from './indexed-db';
import { LocalStorageStorage } from './local-storage';

let instance: Storage | null = null;

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
  instance = storage;
  return instance;
}

export function getStorage(): Storage {
  if (!instance) throw new Error('Storage no inicializado: llama a initStorage() antes de usar getStorage()');
  return instance;
}
