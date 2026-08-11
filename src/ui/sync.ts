import { $, toast } from './dom';
import { esc } from '../core/format';
import { RULES_TEMPLATE, SYNC_META_KEY } from '../core/constants';
import {
  borrarConfig,
  cargarConfig,
  generarCredenciales,
  guardarConfig,
  sincronizar
} from '../services/sync';
import type { SyncConfig } from '../types';

declare global {
  interface Window {
    guardarSyncConfig: () => void;
    sincronizarAhora: () => void;
    desconectarSync: () => void;
    copiarReglas: () => void;
    cambiarIntervaloSync: () => void;
  }
}

let syncInterval: number | null = null;
let sincronizando = false;

function leerUltimaSync(): number | null {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as { lastSyncAt?: number };
    return typeof meta.lastSyncAt === 'number' ? meta.lastSyncAt : null;
  } catch {
    return null;
  }
}

function detenerTimer(): void {
  if (syncInterval !== null) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function arrancarTimer(): void {
  detenerTimer();
  const config = cargarConfig();
  if (!config) return;
  const min = config.intervalMin == null ? 5 : config.intervalMin;
  if (min <= 0) return;
  syncInterval = window.setInterval(() => void ejecutarSync(false), min * 60 * 1000);
}

async function ejecutarSync(toastSiempre: boolean): Promise<void> {
  const config = cargarConfig();
  if (!config) return;
  if (sincronizando) {
    if (toastSiempre) toast('⏳ Ya hay una sincronización en curso. Espera a que termine.');
    return;
  }
  sincronizando = true;
  try {
    const res = await sincronizar(config);
    renderSync();
    if (!res.omitirToast && (toastSiempre || !res.ok || res.errores > 0)) toast(res.mensaje, 4000);
  } finally {
    sincronizando = false;
  }
}

function vistaSinConfig(): string {
  return (
    '<p class="hint">Sincroniza tus datos (productos, ventas, clientes y abonos) entre varios teléfonos o la PC mediante Firebase. Pega la config Firebase de tu proyecto y, si vas a conectar un segundo dispositivo, pega también el token compartido del primero.</p>' +
    '<label>Config Firebase (JSON)</label>' +
    '<textarea id="syncFbConfig" placeholder=\'{"apiKey":"AIza...","projectId":"mi-proyecto","appId":"1:...:web:..."}\' style="width:100%;padding:11px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;font-family:monospace;min-height:110px;background:#fff;color:#111827"></textarea>' +
    '<label>Token compartido (deja vacío para generar uno nuevo)</label>' +
    '<input id="syncToken" placeholder="Pégalo aquí en el segundo dispositivo">' +
    '<button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="guardarSyncConfig()">🔑 Conectar y sincronizar</button>'
  );
}

function vistaConfigurada(config: SyncConfig): string {
  const ultima = leerUltimaSync();
  const fecha = ultima
    ? new Date(ultima).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Aún no se ha sincronizado';
  const min = config.intervalMin == null ? 5 : config.intervalMin;
  const textoAuto = min <= 0
    ? 'Sincronización automática por tiempo desactivada. Los cambios se sincronizan al momento al guardarlos o borrarlos.'
    : 'Se sincroniza automáticamente cada ' + min + ' min, al abrir la app y con el botón de abajo.';
  const opciones = [3, 5, 10, 15]
    .map((v) => '<option value="' + v + '"' + (min === v ? ' selected' : '') + '>Cada ' + v + ' min</option>')
    .join('');
  const selOff = min <= 0 ? ' selected' : '';
  return (
    '<p class="hint">' +
    textoAuto +
    '</p>' +
    '<label>Frecuencia de sincronización automática</label>' +
    '<select id="syncInterval" onchange="cambiarIntervaloSync()">' +
    '<option value="0"' +
    selOff +
    '>Desactivada (por tiempo)</option>' +
    opciones +
    '</select>' +
    '<div class="stat-row"><span>Proyecto</span><b>' +
    esc(config.projectId) +
    '</b></div>' +
    '<div class="stat-row"><span>Última sync</span><b>' +
    esc(fecha) +
    '</b></div>' +
    '<div class="stat-row" style="border-bottom:0"><span>Token compartido</span><b style="font-family:monospace;font-size:11px">' +
    esc(config.syncToken) +
    '</b></div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:12px;margin-bottom:8px" onclick="sincronizarAhora()">🔄 Sincronizar ahora</button>' +
    '<button class="btn btn-outline" style="width:100%;margin-bottom:8px" onclick="copiarReglas()">📋 Copiar Security Rules</button>' +
    '<button class="btn btn-danger-ghost" style="width:100%" onclick="desconectarSync()">🔌 Desconectar</button>'
  );
}

function renderSync(): void {
  const cont = $('syncStatus');
  const config = cargarConfig();
  cont.innerHTML = config ? vistaConfigurada(config) : vistaSinConfig();
}

function guardarSyncConfig(): void {
  const ta = $('syncFbConfig') as HTMLTextAreaElement;
  const campoToken = $('syncToken') as HTMLInputElement;
  let fb: Record<string, unknown>;
  try {
    fb = JSON.parse(ta.value.trim()) as Record<string, unknown>;
    if (!fb || typeof fb !== 'object' || Array.isArray(fb)) throw new Error('no object');
  } catch {
    toast('⚠️ El JSON de Firebase no es válido. Pégalo tal cual lo muestra la consola de Firebase.');
    return;
  }
  const projectId = typeof fb.projectId === 'string' ? fb.projectId : '';
  const apiKey = typeof fb.apiKey === 'string' ? fb.apiKey : '';
  if (!projectId || !apiKey) {
    toast('⚠️ El JSON debe incluir al menos "apiKey" y "projectId".');
    return;
  }
  let token = campoToken.value.trim();
  const creds = generarCredenciales();
  if (!token) token = creds.syncToken;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(token)) {
    toast('⚠️ El token solo puede contener letras, números, guiones y guiones bajos (máx. 128 caracteres).');
    return;
  }
  const config: SyncConfig = {
    apiKey,
    projectId,
    appId: typeof fb.appId === 'string' ? fb.appId : undefined,
    authDomain: typeof fb.authDomain === 'string' ? fb.authDomain : undefined,
    storageBucket: typeof fb.storageBucket === 'string' ? fb.storageBucket : undefined,
    messagingSenderId: typeof fb.messagingSenderId === 'string' ? fb.messagingSenderId : undefined,
    measurementId: typeof fb.measurementId === 'string' ? fb.measurementId : undefined,
    syncToken: token,
    deviceId: creds.deviceId,
    intervalMin: 5
  };
  if (!guardarConfig(config)) {
    toast('⚠️ No se pudo guardar la configuración: almacenamiento lleno');
    return;
  }
  arrancarTimer();
  renderSync();
  toast('✅ Sincronización configurada');
}

function cambiarIntervaloSync(): void {
  const sel = $('syncInterval') as HTMLSelectElement;
  const config = cargarConfig();
  if (!config) return;
  config.intervalMin = Number(sel.value);
  if (!guardarConfig(config)) {
    toast('⚠️ No se pudo guardar la frecuencia: almacenamiento lleno');
    renderSync();
    return;
  }
  arrancarTimer();
  renderSync();
  toast('✅ Frecuencia de sincronización actualizada');
}

function sincronizarAhora(): void {
  void ejecutarSync(true);
}

function desconectarSync(): void {
  if (!confirm('⚠️ ¿Desconectar la sincronización? Tus datos locales se conservan, pero dejarás de compartirlos con otros dispositivos.')) return;
  detenerTimer();
  borrarConfig();
  renderSync();
  toast('🔌 Sincronización desconectada');
}

function copiarReglas(): void {
  const config = cargarConfig();
  if (!config || !config.syncToken) {
    toast('⚠️ Configura la sincronización primero.');
    return;
  }
  const texto = RULES_TEMPLATE.replace('<SYNC_TOKEN>', config.syncToken);
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard
      .writeText(texto)
      .then(() => toast('✅ Reglas copiadas. Pégalas en Firestore → Rules.'))
      .catch(() => copiaFallback(texto));
  } else {
    copiaFallback(texto);
  }
}

function copiaFallback(texto: string): void {
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('✅ Reglas copiadas. Pégalas en Firestore → Rules.');
  } catch {
    toast('⚠️ No se pudo copiar automáticamente. Usa la consola de Firebase.');
  } finally {
    ta.remove();
  }
}

export function initSync(): void {
  window.guardarSyncConfig = guardarSyncConfig;
  window.sincronizarAhora = sincronizarAhora;
  window.desconectarSync = desconectarSync;
  window.copiarReglas = copiarReglas;
  window.cambiarIntervaloSync = cambiarIntervaloSync;
  renderSync();
  if (cargarConfig()) {
    arrancarTimer();
    void ejecutarSync(true);
  }
}
