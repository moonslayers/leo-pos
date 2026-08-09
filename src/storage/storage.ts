import type { Producto, StoreName } from '../types';

export type Store = StoreName;

export type Backend = 'indexeddb' | 'localstorage';

export interface Put<T> {
  store: StoreName;
  value: T;
}

export interface Storage {
  init(): Promise<void>;
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, id: number): Promise<T | undefined>;
  put<T>(store: StoreName, value: T): Promise<number>;
  del(store: StoreName, id: number): Promise<void>;
  clear(store: StoreName): Promise<void>;
  findByCode(codigo: string): Promise<Producto | undefined>;
  getBackend(): Backend;
}
