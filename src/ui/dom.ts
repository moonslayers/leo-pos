export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('Elemento no encontrado: #' + id);
  return el;
}

let toastH = 0;

export function toast(msg: string, ms?: number): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastH);
  toastH = window.setTimeout(() => t.classList.remove('show'), ms || 2200);
}

export function abrirModal(id: string): void {
  $(id).classList.add('open');
}

export function cerrarModal(id: string): void {
  $(id).classList.remove('open');
}

let scannerClose: (() => void) | null = null;
let manualCode: (() => void) | null = null;

export function registerScannerClose(fn: () => void): void {
  scannerClose = fn;
}

export function registerManualCode(fn: () => void): void {
  manualCode = fn;
}

document.addEventListener('click', (e) => {
  const target = e.target as Element | null;
  if (target && target.classList && target.classList.contains('modal')) {
    if (target.id === 'mScanner') {
      if (scannerClose) scannerClose();
    } else {
      cerrarModal(target.id);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'scanManual') {
    if (manualCode) manualCode();
  }
});
