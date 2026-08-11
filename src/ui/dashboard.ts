import { $ } from './dom';
import { esc, fmt, fmtCorto, inicioDia } from '../core/format';
import { CATS, catInfo } from '../core/constants';
import { calcularDeudas } from '../services/clients';
import { getStorage } from '../storage';
import { registerViewRenderers } from './navigation';
import type { Abono, Producto, Venta } from '../types';

export async function renderDashboard(): Promise<void> {
  const [ventas, abonos, productos] = await Promise.all([
    getStorage().getAll<Venta>('ventas'),
    getStorage().getAll<Abono>('abonos'),
    getStorage().getAll<Producto>('productos')
  ]);
  const ventasGraf = ventas.filter((v) => !v.previa);
  const hoy = inicioDia(Date.now());
  const vHoy = ventasGraf.filter((v) => v.fecha >= hoy);
  const totalVHoy = vHoy.reduce((s, v) => s + v.total, 0);
  const contadoHoy = vHoy.filter((v) => v.tipo === 'contado').reduce((s, v) => s + v.total, 0);
  const aHoy = abonos.filter((a) => a.fecha >= hoy).reduce((s, a) => s + a.monto, 0);
  $('stIngresos').textContent = fmt(contadoHoy + aHoy);
  $('stIngresosDet').textContent = 'Efectivo ' + fmt(contadoHoy) + ' + abonos ' + fmt(aHoy);
  $('stVentasHoy').textContent = fmt(totalVHoy);
  $('stVentasHoyDet').textContent = vHoy.length + ' venta(s)';
  const porCobrar =
    ventas.filter((v) => v.tipo === 'fiado').reduce((s, v) => s + v.total, 0) -
    abonos.reduce((s, a) => s + a.monto, 0);
  const deudores = (await calcularDeudas()).filter((m) => m.deuda > 0.009).length;
  $('stPorCobrar').textContent = fmt(Math.max(porCobrar, 0));
  $('stPorCobrarDet').textContent = deudores + ' cliente(s) deben';
  const unidades = productos.reduce((s, p) => s + Math.max(p.stock || 0, 0), 0);
  const valor = productos.reduce((s, p) => s + (p.precio || 0) * Math.max(p.stock || 0, 0), 0);
  $('stInventario').textContent = fmt(valor);
  $('stInventarioDet').textContent = unidades + ' piezas · ' + productos.length + ' productos';

  const dias: { total: number; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const ini = d.getTime();
    const fin = ini + 86400000;
    const total = ventasGraf.filter((v) => v.fecha >= ini && v.fecha < fin).reduce((s, v) => s + v.total, 0);
    dias.push({ total, label: new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(d) });
  }
  const max = Math.max(1, ...dias.map((d) => d.total));
  $('chart').innerHTML = dias
    .map(
      (d) => `
    <div class="bar-col">
      <div class="bar-val">${d.total ? fmtCorto(d.total) : ''}</div>
      <div class="bar-wrap"><div class="bar" style="height:${Math.max(Math.round((d.total / max) * 100), d.total ? 4 : 2)}%"></div></div>
      <div class="bar-day">${d.label}</div>
    </div>`
    )
    .join('');

  const iniMes = new Date();
  iniMes.setDate(1);
  iniMes.setHours(0, 0, 0, 0);
  const catTotals: Record<string, number> = {};
  CATS.forEach((c) => (catTotals[c.id] = 0));
  ventasGraf
    .filter((v) => v.fecha >= iniMes.getTime())
    .forEach((v) => {
      (v.items || []).forEach((i) => {
        const cat = CATS.some((c) => c.id === i.categoria) ? i.categoria : 'otros';
        catTotals[cat] = (catTotals[cat] || 0) + i.precio * i.cantidad;
      });
    });
  const mesTotal = Object.values(catTotals).reduce((a, b) => a + b, 0);
  $('catVentas').innerHTML = mesTotal
    ? CATS.filter((c) => catTotals[c.id] > 0)
        .map((c) => {
          const t = catTotals[c.id];
          const pct = Math.round((t / mesTotal) * 100);
          return `<div class="cat-row">
      <div class="cat-top"><span>${c.emoji} ${c.nombre}</span><b>${fmt(t)} <span style="color:#9ca3af;font-weight:400">(${pct}%)</span></b></div>
      <div class="cat-bar-bg"><div class="cat-bar" style="width:${pct}%;background:${c.color}"></div></div>
    </div>`;
        })
        .join('')
    : '<div style="color:#9ca3af;font-size:13px">Sin ventas este mes</div>';

  const bajos = productos.filter((p) => (p.stock || 0) <= 3).sort((a, b) => (a.stock || 0) - (b.stock || 0));
  $('stockBajo').innerHTML = bajos.length
    ? bajos
        .slice(0, 12)
        .map((p) => {
          const c = catInfo(p.categoria);
          return `<div class="bajo-row"><span>${c.emoji} ${esc(p.nombre)}</span><b class="${(p.stock || 0) <= 0 ? 'rojo' : 'naranja'}">${p.stock || 0} pz</b></div>`;
        })
        .join('')
    : '<div style="color:#9ca3af;font-size:13px">Todo bien surtido ✓</div>';
}

export function initDashboard(): void {
  registerViewRenderers({ dashboard: renderDashboard });
}
