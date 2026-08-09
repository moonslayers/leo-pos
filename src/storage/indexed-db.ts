import type { Producto, StoreName } from '../types';
import { DB_NAME, DB_VERSION } from '../core/constants';
import type { Backend, Storage } from './storage';

export class IndexedDBStorage implements Storage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    this.db = await this.open();
    await this.req(this.st('productos').getAll());
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('productos')) {
          const s = d.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
          s.createIndex('codigo', 'codigo');
        }
        if (!d.objectStoreNames.contains('ventas')) {
          const s = d.createObjectStore('ventas', { keyPath: 'id', autoIncrement: true });
          s.createIndex('fecha', 'fecha');
        }
        if (!d.objectStoreNames.contains('clientes')) {
          d.createObjectStore('clientes', { keyPath: 'id', autoIncrement: true });
        }
        if (!d.objectStoreNames.contains('abonos')) {
          const s = d.createObjectStore('abonos', { keyPath: 'id', autoIncrement: true });
          s.createIndex('clienteId', 'clienteId');
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('bloqueado'));
    });
  }

  private req<R>(r: IDBRequest<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  private st(n: StoreName, m: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) throw new Error('IndexedDB no abierta');
    return this.db.transaction(n, m).objectStore(n);
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return this.req(this.st(store).getAll() as IDBRequest<T[]>);
  }

  async get<T>(store: StoreName, id: number): Promise<T | undefined> {
    return this.req(this.st(store).get(id) as IDBRequest<T | undefined>);
  }

  async put<T>(store: StoreName, value: T): Promise<number> {
    return this.req(this.st(store, 'readwrite').put(value) as IDBRequest<number>);
  }

  async del(store: StoreName, id: number): Promise<void> {
    await this.req(this.st(store, 'readwrite').delete(id));
  }

  async clear(store: StoreName): Promise<void> {
    await this.req(this.st(store, 'readwrite').clear());
  }

  async findByCode(codigo: string): Promise<Producto | undefined> {
    return this.req(this.st('productos').index('codigo').get(codigo) as IDBRequest<Producto | undefined>);
  }

  getBackend(): Backend {
    return 'indexeddb';
  }
}
