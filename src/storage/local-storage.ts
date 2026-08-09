import type { Producto, StoreName } from '../types';
import { LS_KEY, STORES } from '../core/constants';
import type { Backend, Storage } from './storage';

interface LSSeq {
  productos: number;
  ventas: number;
  clientes: number;
  abonos: number;
}

interface LSData {
  productos: unknown[];
  ventas: unknown[];
  clientes: unknown[];
  abonos: unknown[];
  seq: LSSeq;
}

type LSRow = { id?: number };

let storageFullHandler: (() => void) | null = null;

export function setOnStorageFull(handler: (() => void) | null): void {
  storageFullHandler = handler;
}

export class LocalStorageStorage implements Storage {
  private data: LSData | null = null;

  init(): Promise<void> {
    this.cargar();
    return Promise.resolve();
  }

  private cargar(): void {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    } catch {
      parsed = null;
    }
    const ls = parsed as Partial<LSData> | null;
    if (!ls || !Array.isArray(ls.productos)) {
      this.data = {
        productos: [],
        ventas: [],
        clientes: [],
        abonos: [],
        seq: { productos: 0, ventas: 0, clientes: 0, abonos: 0 },
      };
    } else {
      this.data = ls as LSData;
    }
    STORES.forEach((s) => {
      if (!Array.isArray(this.data![s])) this.data![s] = [];
      if (!this.data!.seq) this.data!.seq = {} as LSSeq;
      if (this.data!.seq[s] == null) this.data!.seq[s] = 0;
    });
  }

  private guardar(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.data));
    } catch {
      if (storageFullHandler) storageFullHandler();
      console.warn('⚠️ No se pudo guardar: almacenamiento lleno');
    }
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return (this.data![store] || []).map((x) => ({ ...(x as object) })) as unknown as T[];
  }

  async get<T>(store: StoreName, id: number): Promise<T | undefined> {
    return (this.data![store] as LSRow[]).find((x) => x.id === id) as T | undefined;
  }

  async put<T>(store: StoreName, value: T): Promise<number> {
    const rows = this.data![store] as LSRow[];
    const obj = { ...(value as object) } as LSRow;
    if (obj.id == null) {
      this.data!.seq[store] = (this.data!.seq[store] || 0) + 1;
      obj.id = this.data!.seq[store];
    } else {
      this.data!.seq[store] = Math.max(this.data!.seq[store] || 0, obj.id);
    }
    const i = rows.findIndex((x) => x.id === obj.id);
    if (i >= 0) rows[i] = obj;
    else rows.push(obj);
    this.guardar();
    return obj.id!;
  }

  async del(store: StoreName, id: number): Promise<void> {
    this.data![store] = (this.data![store] as LSRow[]).filter((x) => x.id !== id);
    this.guardar();
  }

  async clear(store: StoreName): Promise<void> {
    this.data![store] = [];
    this.guardar();
  }

  async findByCode(codigo: string): Promise<Producto | undefined> {
    return (this.data!.productos as Producto[]).find((x) => x.codigo === codigo);
  }

  getBackend(): Backend {
    return 'localstorage';
  }
}
