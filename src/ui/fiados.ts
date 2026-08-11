import { $, toast, abrirModal, cerrarModal } from './dom';
import { registerViewRenderers } from './navigation';
import { esc, fechaLocal, fmt, fmtF, inicioDia } from '../core/format';
import { FREQ_TXT } from '../core/constants';
import type { Cliente, DeudaCliente, Movimiento } from '../types';
import {
  abonoMontoInicial,
  calcularDeudas,
  detalleCliente as detalleClienteSvc,
  eliminarCliente as eliminarClienteSvc,
  eliminarMov as eliminarMovSvc,
  guardarAbono as guardarAbonoSvc,
  guardarClienteNuevo as guardarClienteNuevoSvc,
  recordarWhatsApp as recordarWhatsAppUrl,
  registrarDeudaPrevia as registrarDeudaPreviaSvc
} from '../services/clients';

declare global {
  interface Window {
    detalleCliente: (id: number) => Promise<void>;
    eliminarMov: (tipo: 'fiado' | 'abono', id: number, clienteId: number) => Promise<void>;
    eliminarCliente: () => Promise<void>;
    abrirAbono: (id: number, deuda: number) => void;
    guardarAbono: () => Promise<void>;
    recordarWhatsApp: (c: Cliente, deuda: number) => void;
    abrirModalClienteNuevo: () => void;
    guardarClienteNuevo: () => Promise<void>;
    abrirModalDeudaPrevia: () => Promise<void>;
    seleccionarClienteDeuda: (id: number) => void;
    registrarDeudaPrevia: () => Promise<void>;
  }
}

let detalleClienteId: number | null = null;
let abonoClienteId: number | null = null;
let deudaPreviaClienteId: number | null = null;

export async function renderFiados(): Promise<void> {
  const lista = await calcularDeudas();
  const hoy = inicioDia(Date.now());
  const conDeuda = lista.filter(m => m.deuda > 0.009).sort((a, b) => b.deuda - a.deuda);
  const alCorriente = lista
    .filter(m => m.deuda <= 0.009)
    .sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre));
  $('totalPorCobrar').textContent = fmt(conDeuda.reduce((s, m) => s + m.deuda, 0));
  let html = '';
  if (!lista.length)
    html +=
      '<div class="card" style="text-align:center;color:#9ca3af;font-size:13px">No hay clientes todavía.<br>Se crean automáticamente al hacer tu primera venta fiada.</div>';
  html += conDeuda.map(m => filaDeudaHtml(m, hoy)).join('');
  if (alCorriente.length) {
    html +=
      '<h3 style="margin:14px 4px 8px;color:#6b7280;font-size:13px">Clientes al corriente</h3>';
    html += alCorriente.map(filaCorrienteHtml).join('');
  }
  $('listaFiados').innerHTML = html;
}

function filaDeudaHtml(m: DeudaCliente, hoy: number): string {
  if (m.cliente.id == null) return '';
  let planTxt = '';
  if (m.plan === 'parcial' && m.numPagos)
    planTxt =
      'En ' + m.numPagos + ' partes' + (m.frecuencia ? ' · ' + FREQ_TXT[m.frecuencia].toLowerCase() : '');
  else if (m.plan === 'uno')
    planTxt = '1 solo pago' + (m.frecuencia ? ' · ' + FREQ_TXT[m.frecuencia].toLowerCase() : '');
  let proxTxt = '';
  if (m.proximaFecha) {
    if (m.proximaFecha < hoy)
      proxTxt =
        '<div class="p-meta" style="color:#dc2626;font-weight:700">⚠️ Pago atrasado (era el ' +
        fmtF(m.proximaFecha) +
        ')</div>';
    else if (m.proximaFecha === hoy)
      proxTxt = '<div class="p-meta" style="color:#d97706;font-weight:700">📅 Paga hoy</div>';
    else proxTxt = '<div class="p-meta">📅 Próximo pago: ' + fmtF(m.proximaFecha) + '</div>';
  }
  return (
    '<div class="card fila-cliente" onclick="detalleCliente(' + m.cliente.id + ')">' +
    '<div style="flex:1;min-width:0">' +
    '<div class="p-nom">👤 ' + esc(m.cliente.nombre) + '</div>' +
    '<div class="p-meta">' +
    m.fiados +
    ' fiado(s) · último: ' +
    (m.ultimo ? fmtF(m.ultimo) : '—') +
    (planTxt ? ' · ' + planTxt : '') +
    '</div>' +
    proxTxt +
    '</div>' +
    '<div class="deuda">' + fmt(m.deuda) + '</div>' +
    '</div>'
  );
}

function filaCorrienteHtml(m: DeudaCliente): string {
  if (m.cliente.id == null) return '';
  return (
    '<div class="card fila-cliente" onclick="detalleCliente(' + m.cliente.id + ')">' +
    '<div style="flex:1;min-width:0"><div class="p-nom">👤 ' + esc(m.cliente.nombre) + '</div></div>' +
    '<div style="color:#059669;font-weight:700;font-size:13px">' +
    (m.deuda < -0.009 ? 'Saldo a favor ' + fmt(-m.deuda) : 'Al corriente ✓') +
    '</div>' +
    '</div>'
  );
}

function filaMovHtml(m: Movimiento, clienteId: number): string {
  return (
    '<div class="mov">' +
    '<div style="flex:1;min-width:0">' +
    '<div class="mov-t">' +
    (m.tipo === 'fiado' ? '📓 Fiado' : '💰 Abono') +
    ' <span class="mov-f">' + fmtF(m.fecha) + '</span></div>' +
    '<div class="mov-d">' + esc(m.det) + '</div>' +
    '</div>' +
    '<div class="mov-m" style="color:' + (m.tipo === 'fiado' ? '#dc2626' : '#059669') + '">' +
    (m.tipo === 'fiado' ? '+' : '−') + fmt(m.monto) +
    '</div>' +
    '<button class="ci-del" onclick="eliminarMov(\'' + m.tipo + '\',' + m.id + ',' + clienteId + ')">🗑</button>' +
    '</div>'
  );
}

async function abrirDetalleCliente(id: number): Promise<void> {
  detalleClienteId = id;
  const det = await detalleClienteSvc(id);
  if (!det) return;
  $('dcNombre').textContent = det.cliente.nombre;
  $('dcTel').textContent = det.cliente.telefono ? '📞 ' + det.cliente.telefono : '';
  $('dcDeuda').textContent = fmt(det.deuda);
  $('dcDeuda').style.color = det.deuda > 0 ? '#dc2626' : '#059669';
  const planDiv = $('dcPlan');
  if (det.planDiv) {
    planDiv.innerHTML = det.planDiv;
    planDiv.classList.remove('oculto');
  } else planDiv.classList.add('oculto');
  $('dcMovs').innerHTML = det.movs.length
    ? det.movs.map(m => filaMovHtml(m, id)).join('')
    : '<div style="color:#9ca3af;text-align:center;padding:10px;font-size:13px">Sin movimientos</div>';
  $('btnAbonar').onclick = () => window.abrirAbono(id, det.deuda);
  const wa = $('btnWhatsApp');
  if (det.cliente.telefono && det.deuda > 0) {
    wa.classList.remove('oculto');
    wa.onclick = () => window.recordarWhatsApp(det.cliente, det.deuda);
  } else wa.classList.add('oculto');
  abrirModal('mClienteDetalle');
}

export function initFiados(): void {
  registerViewRenderers({ fiados: renderFiados });

  window.detalleCliente = abrirDetalleCliente;

  window.eliminarMov = async (tipo, id, clienteId) => {
    if (!confirm('¿Eliminar este movimiento? Cambiará los totales.')) return;
    await eliminarMovSvc(tipo, id);
    toast('Movimiento eliminado');
    await abrirDetalleCliente(clienteId);
    await renderFiados();
  };

  window.eliminarCliente = async () => {
    const id = detalleClienteId;
    if (id == null) return;
    if (!confirm('¿Eliminar al cliente junto con todos sus fiados y abonos?')) return;
    await eliminarClienteSvc(id);
    cerrarModal('mClienteDetalle');
    toast('Cliente eliminado');
    await renderFiados();
  };

  window.abrirAbono = (id, deuda) => {
    abonoClienteId = id;
    ($('abonoMonto') as HTMLInputElement).value = abonoMontoInicial(deuda);
    abrirModal('mAbono');
  };

  window.guardarAbono = async () => {
    if (abonoClienteId == null) return;
    const res = await guardarAbonoSvc(abonoClienteId, ($('abonoMonto') as HTMLInputElement).value);
    if (!res.ok) {
      toast(res.error);
      return;
    }
    cerrarModal('mAbono');
    toast(res.mensaje);
    await abrirDetalleCliente(abonoClienteId);
    await renderFiados();
  };

  window.recordarWhatsApp = (c, deuda) => {
    window.open(recordarWhatsAppUrl(c, deuda), '_blank');
  };

  window.abrirModalClienteNuevo = () => {
    ($('ncNombre') as HTMLInputElement).value = '';
    ($('ncTel') as HTMLInputElement).value = '';
    abrirModal('mClienteNuevo');
  };

  window.guardarClienteNuevo = async () => {
    const res = await guardarClienteNuevoSvc(
      ($('ncNombre') as HTMLInputElement).value,
      ($('ncTel') as HTMLInputElement).value
    );
    if (!res.ok) {
      toast(res.error);
      return;
    }
    cerrarModal('mClienteNuevo');
    toast(res.mensaje);
    await renderFiados();
  };

  window.abrirModalDeudaPrevia = async () => {
    deudaPreviaClienteId = null;
    const deudas = await calcularDeudas();
    deudas.sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre));
    $('listaClientesDeuda').innerHTML = deudas.length
      ? deudas
          .map(m => {
            const cid = m.cliente.id;
            if (cid == null) return '';
            return `<div class="fila-cliente card" id="drow-${cid}" onclick="seleccionarClienteDeuda(${cid})">
        <div style="flex:1;min-width:0">
          <div class="p-nom">👤 ${esc(m.cliente.nombre)}</div>
          ${m.cliente.telefono ? `<div class="p-meta">${esc(m.cliente.telefono)}</div>` : ''}
        </div>
        ${m.deuda > 0 ? `<div class="deuda" style="font-size:14px">${fmt(m.deuda)}</div>` : '<div style="color:#059669;font-size:13px">✓ al corriente</div>'}
      </div>`;
          })
          .join('')
      : '<div style="color:#9ca3af;text-align:center;padding:10px;font-size:13px">Aún no hay clientes. Crea uno abajo 👇</div>';
    ($('dpNombre') as HTMLInputElement).value = '';
    ($('dpTel') as HTMLInputElement).value = '';
    ($('dpMonto') as HTMLInputElement).value = '';
    ($('dpAbono') as HTMLInputElement).value = '';
    ($('dpFecha') as HTMLInputElement).value = fechaLocal(new Date());
    $('dpNuevoCliente').classList.remove('oculto');
    abrirModal('mDeudaPrevia');
  };

  window.seleccionarClienteDeuda = id => {
    if (deudaPreviaClienteId === id) {
      deudaPreviaClienteId = null;
      $('drow-' + id).style.border = '';
      $('dpNuevoCliente').classList.remove('oculto');
      return;
    }
    deudaPreviaClienteId = id;
    document.querySelectorAll('#listaClientesDeuda .fila-cliente').forEach(row => {
      (row as HTMLElement).style.border = '';
    });
    $('drow-' + id).style.border = '2px solid #d97706';
    $('dpNuevoCliente').classList.add('oculto');
  };

  window.registrarDeudaPrevia = async () => {
    const abonoRaw = ($('dpAbono') as HTMLInputElement).value;
    const fechaRaw = ($('dpFecha') as HTMLInputElement).value;
    const input = {
      monto: parseFloat(($('dpMonto') as HTMLInputElement).value),
      abono: abonoRaw ? parseFloat(abonoRaw) : undefined,
      fecha: fechaRaw ? new Date(fechaRaw + 'T12:00:00').getTime() : undefined
    };
    const res =
      deudaPreviaClienteId != null
        ? await registrarDeudaPreviaSvc({ ...input, clienteId: deudaPreviaClienteId })
        : await registrarDeudaPreviaSvc({
            ...input,
            nombre: ($('dpNombre') as HTMLInputElement).value,
            telefono: ($('dpTel') as HTMLInputElement).value
          });
    if (!res.ok) {
      toast(res.mensaje);
      return;
    }
    cerrarModal('mDeudaPrevia');
    deudaPreviaClienteId = null;
    toast(res.mensaje);
    await renderFiados();
  };
}
