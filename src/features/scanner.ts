import { $, abrirModal, cerrarModal, toast, registerScannerClose, registerManualCode } from '../ui/dom';

declare global {
  interface Window {
    abrirScanner: (target: ScanTarget) => Promise<void>;
    cerrarScanner: () => void;
    enviarCodigoManual: () => void;
  }
}

export type ScanTarget = 'venta' | 'producto-codigo';

export interface ScannerHandlers {
  onCodeForVenta: (codigo: string) => void | Promise<void>;
  onCodeForProducto: (codigo: string) => void | Promise<void>;
}

let scanStream: MediaStream | null = null;
let scanTimer: number | null = null;
let scanTarget: ScanTarget = 'venta';
let handlers: ScannerHandlers | null = null;

export function registerScannerHandlers(h: ScannerHandlers): void {
  handlers = h;
}

export async function abrirScanner(target: ScanTarget): Promise<void> {
  scanTarget = target;
  $('scanError').textContent = '';
  $('scanMsg').textContent = 'Abriendo cámara…';
  ($('scanManual') as HTMLInputElement).value = '';
  abrirModal('mScanner');
  const video = $('scanVideo') as HTMLVideoElement;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    video.srcObject = scanStream;
    await video.play();
  } catch {
    $('scanError').textContent = 'No se pudo abrir la cámara. Escribe el código abajo.';
    $('scanMsg').textContent = '';
    return;
  }
  if ('BarcodeDetector' in window) {
    try {
      const soportados = await BarcodeDetector.getSupportedFormats();
      const pref = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'];
      const formats = pref.filter((f) => soportados.includes(f));
      const detector = new BarcodeDetector(formats.length ? { formats } : undefined);
      $('scanMsg').textContent = 'Apunta al código de barras…';
      scanTimer = window.setInterval(async () => {
        if (video.readyState >= 2) {
          try {
            const codigos = await detector.detect(video);
            if (codigos.length) {
              const valor = codigos[0].rawValue;
              if (navigator.vibrate) navigator.vibrate(80);
              cerrarScanner();
              void procesarCodigo(valor);
            }
          } catch {}
        }
      }, 250);
    } catch {
      $('scanMsg').textContent = 'Escribe el código abajo (escáner no disponible):';
    }
  } else {
    $('scanMsg').textContent = 'Este navegador no tiene escáner automático. Escribe el código abajo:';
  }
}

export function cerrarScanner(): void {
  if (scanTimer !== null) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
  cerrarModal('mScanner');
}

export function enviarCodigoManual(): void {
  const v = ($('scanManual') as HTMLInputElement).value.trim();
  if (!v) {
    toast('Escribe un código');
    return;
  }
  cerrarScanner();
  void procesarCodigo(v);
}

export async function procesarCodigo(codigo: string): Promise<void> {
  codigo = (codigo || '').trim();
  if (!codigo) return;
  if (!handlers) return;
  if (scanTarget === 'producto-codigo') {
    await handlers.onCodeForProducto(codigo);
  } else {
    await handlers.onCodeForVenta(codigo);
  }
}

export function registerScannerGlobals(): void {
  window.abrirScanner = abrirScanner;
  window.cerrarScanner = cerrarScanner;
  window.enviarCodigoManual = enviarCodigoManual;
  registerScannerClose(cerrarScanner);
  registerManualCode(enviarCodigoManual);
}
