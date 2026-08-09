import { $ } from './dom';
import { esc, fmt } from '../core/format';
import type { CarritoItem } from '../types';

declare global {
  interface Window {
    cambiarQty: (idx: number, d: number) => void;
    quitarItem: (idx: number) => void;
    vaciarCarrito: () => void;
  }
}

export interface CartOps {
  getCarrito(): CarritoItem[];
  totalCarrito(): number;
  agregarCarrito(id: number): Promise<void>;
  cambiarQty(idx: number, d: number): void;
  quitarItem(idx: number): void;
  vaciarCarrito(): void;
}

let ops: CartOps | null = null;

export function registerCartOps(o: CartOps): void {
  ops = o;
}

export function renderCarrito(): void {
  if (!ops) return;
  const carrito = ops.getCarrito();
  const cont = $('carritoCont');
  if (!carrito.length) {
    cont.innerHTML =
      '<div style="color:#9ca3af;text-align:center;padding:8px;font-size:13px">Carrito vacío — agrega con ＋ o escanea 📷</div>';
    $('carritoAcciones').style.display = 'none';
    return;
  }
  $('carritoAcciones').style.display = 'block';
  $('cartTotal').textContent = fmt(ops.totalCarrito());
  cont.innerHTML = carrito
    .map(
      (i, idx) => `
    <div class="cart-item">
      <div style="flex:1;min-width:0">
        <div class="ci-nom">${esc(i.nombre)}</div>
        <div class="ci-precio">${fmt(i.precio)} c/u</div>
      </div>
      <div class="qty">
        <button onclick="cambiarQty(${idx},-1)">−</button>
        <span>${i.cantidad}</span>
        <button onclick="cambiarQty(${idx},1)">＋</button>
      </div>
      <div class="ci-total">${fmt(i.precio * i.cantidad)}</div>
      <button class="ci-del" onclick="quitarItem(${idx})">✕</button>
    </div>`
    )
    .join('');
}

export function registerCartGlobals(): void {
  window.cambiarQty = (idx, d) => {
    if (ops) {
      ops.cambiarQty(idx, d);
      renderCarrito();
    }
  };
  window.quitarItem = (idx) => {
    if (ops) {
      ops.quitarItem(idx);
      renderCarrito();
    }
  };
  window.vaciarCarrito = () => {
    if (!ops) return;
    if (ops.getCarrito().length && confirm('¿Vaciar carrito?')) {
      ops.vaciarCarrito();
      renderCarrito();
    }
  };
}
