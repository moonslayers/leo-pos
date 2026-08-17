import { TOUR_KEY } from '../core/constants';
import type { TourStep, Vista } from '../types';
import { $, toast } from '../ui/dom';

declare global {
  interface Window {
    iniciarTour?: (seccion: Vista, forzar?: boolean) => void;
    reiniciarGuias?: () => void;
  }
}

export function toursVistos(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TOUR_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function marcarTourVisto(id: string): void {
  try {
    const t = toursVistos();
    t[id] = true;
    localStorage.setItem(TOUR_KEY, JSON.stringify(t));
  } catch {
    // localStorage no disponible
  }
}

export function reiniciarGuias(): void {
  try {
    localStorage.removeItem(TOUR_KEY);
  } catch {
    // localStorage no disponible
  }
  toast('💡 Las guías volverán a mostrarse al entrar a cada sección');
}

export const TOUR_STEPS: Record<Vista, TourStep[]> = {
  ventas: [
    { t: '🛒 ¡Bienvenida a Ventas!', x: 'Aquí registras cada venta en 3 pasos: busca el producto, agrégalo al carrito y cobra. Te enseño rápido 👇' },
    { t: '🔍 Buscar o escanear', x: 'Escribe el nombre del producto o toca <b>📷 Escanear</b> para leer su código de barras con la cámara.', el: '#filaBusqueda' },
    { t: '💵 Cobrar o fiar', x: 'Aquí ves el total del carrito. Toca <b>Contado</b> si pagan en efectivo, o <b>Fiado</b> para elegir cliente, pedir <b>abono inicial</b> y definir el <b>plan de pago</b> (1 pago o en partes, con fecha de próximo pago).', el: '#carritoCard' },
    { t: '➕ Tus productos', x: 'Toca el botón <b>＋</b> de cada producto para agregarlo al carrito. Puedes llevar varios a la vez.', el: '#listaVentaProductos' },
    { t: '🌸 ¡Lista para vender!', x: 'Cuando necesites ayuda, toca el botón flotante <b>💡</b> para repetir esta guía. ¡Mucho éxito!' }
  ],
  productos: [
    { t: '📦 Tus productos', x: 'Aquí das de alta todo lo que vendes: lencería Ilusión, perfumes Fraiche y cosméticos.' },
    { t: '➕ Nuevo producto', x: 'Busca un producto o toca <b>＋ Nuevo</b> para crearlo. Puedes escribir sus datos o <b>escanear su código</b> 📷.', el: '#cardBusquedaProd' },
    { t: '✏️ Editar y surtir', x: 'Toca cualquier producto para cambiar precio, costo y existencia. Al recibir mercancía usa los botones <b>+1, +5 y +10</b>.', el: '#listaProductos' },
    { t: '💡 Ayuda', x: 'Toca el botón <b>💡</b> cuando quieras repetir esta guía.' }
  ],
  fiados: [
    { t: '📓 Cuentas por cobrar', x: 'Aquí ves <b>quién te debe, cuánto y desde qué fecha</b>. Todas las cuentas en un solo lugar.' },
    { t: '💰 Total por cobrar', x: 'Esta es la suma de todo lo que te deben entre todos tus clientes.', el: '#cardPorCobrar' },
    { t: '👤 Cada cliente', x: 'Toca un cliente para ver su <b>plan de pago</b>, la <b>fecha del próximo pago</b> (te aviso si está atrasado ⚠️), registrar <b>abonos 💰</b> o mandar <b>recordatorio por WhatsApp 📱</b>.', el: '#listaFiados' },
    { t: '💡 Ayuda', x: 'El botón <b>💡</b> repite esta guía cuando la necesites.' }
  ],
  dashboard: [
    { t: '📊 El resumen del negocio', x: 'Aquí ves cómo va todo de un vistazo, sin hacer cuentas a mano.' },
    { t: '💵 Tus números del día', x: 'Ingresos de hoy (ventas + abonos), ventas del día, lo que te deben y el valor de tu inventario.', el: '#gridStats' },
    { t: '📈 Últimos 7 días', x: 'Esta gráfica muestra cuánto vendiste cada día de la última semana.', el: '#cardChart' },
    { t: '⚠️ Stock bajo', x: 'Aquí te aviso qué productos se están acabando para que los resurtas a tiempo.', el: '#cardStockBajo' },
    { t: '💡 Ayuda', x: 'Toca <b>💡</b> para repetir esta guía cuando quieras.' }
  ],
  ajustes: [
    { t: '⚙️ Ajustes y respaldos', x: 'Esta sección es muy importante: aquí cuidas tu información.' },
    { t: '💾 Respaldo', x: 'Con <b>Exportar</b> guardas todo (productos, ventas, clientes y abonos) en un archivo que puedes mandarte por WhatsApp. Con <b>Importar</b> lo restauras en este u otro teléfono.', el: '#cardRespaldo' },
    { t: '💡 Guías', x: 'Aquí puedes volver a ver las guías de cada sección o reiniciarlas.', el: '#cardGuias' },
    { t: '⚠️ Cuidado', x: 'La zona de peligro borra todo. Antes de borrar, siempre exporta un respaldo primero.', el: '#cardPeligro' }
  ]
};

interface TourActiva {
  cancel: (marcar: boolean) => void;
  _wrap: HTMLDivElement;
}

let tourActiva: TourActiva | null = null;

export function iniciarTour(seccion: Vista, forzar?: boolean): void {
  const defs = TOUR_STEPS[seccion];
  if (!defs || !defs.length) return;
  if (!forzar && toursVistos()[seccion]) return;
  if (tourActiva) tourActiva.cancel(false);

  const wrap = document.createElement('div');
  wrap.id = 'tourWrap';
  wrap.innerHTML =
    '<div id="tourSpot"></div>' +
    '<div id="tourCard">' +
    '<button id="tourCerrar">✕</button>' +
    '<div id="tourTitulo"></div>' +
    '<div id="tourTexto"></div>' +
    '<div id="tourPie">' +
    '<span id="tourContador"></span>' +
    '<div style="display:flex;gap:8px">' +
    '<button id="tourAtras" class="tour-btn tour-btn-sec">Atrás</button>' +
    '<button id="tourSig" class="tour-btn">Siguiente</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  const spot = $('tourSpot');
  const card = $('tourCard');
  let idx = 0;
  let cerrado = false;

  function colocar(): void {
    if (cerrado) return;
    const paso = defs[idx];
    const vh = window.innerHeight;
    let target: Element | null = paso.el ? document.querySelector(paso.el) : null;
    if (target && target.getBoundingClientRect().height > vh * 0.6) target = null;
    if (target) {
      const r = target.getBoundingClientRect();
      const pad = 6;
      spot.style.display = 'block';
      spot.style.left = Math.max(r.left - pad, 4) + 'px';
      spot.style.top = r.top - pad + 'px';
      spot.style.width = r.width + pad * 2 + 'px';
      spot.style.height = r.height + pad * 2 + 'px';
      card.style.left = '12px';
      card.style.right = '12px';
      const altoCard = card.offsetHeight;
      if (r.bottom + altoCard + 26 <= vh) {
        card.style.top = r.bottom + 14 + 'px';
        card.style.bottom = 'auto';
        card.style.transform = 'none';
      } else if (r.top - altoCard - 26 > 0) {
        card.style.top = 'auto';
        card.style.bottom = vh - r.top + 14 + 'px';
        card.style.transform = 'none';
      } else {
        card.style.top = '50%';
        card.style.bottom = 'auto';
        card.style.transform = 'translateY(-50%)';
      }
    } else {
      spot.style.display = 'none';
      card.style.left = '12px';
      card.style.right = '12px';
      card.style.top = '50%';
      card.style.bottom = 'auto';
      card.style.transform = 'translateY(-50%)';
    }
  }

  function mostrarPaso(): void {
    const paso = defs[idx];
    $('tourTitulo').textContent = paso.t;
    $('tourTexto').innerHTML = paso.x;
    $('tourContador').textContent = idx + 1 + ' / ' + defs.length;
    $('tourAtras').style.display = idx === 0 ? 'none' : 'block';
    $('tourSig').textContent = idx === defs.length - 1 ? '¡Listo! ✓' : 'Siguiente';
    const target = paso.el ? document.querySelector(paso.el) : null;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    colocar();
  }

  function cerrar(marcar?: boolean): void {
    if (cerrado) return;
    cerrado = true;
    if (marcar !== false) marcarTourVisto(seccion);
    window.removeEventListener('scroll', colocar, true);
    window.removeEventListener('resize', colocar);
    wrap.remove();
    if (tourActiva && tourActiva._wrap === wrap) tourActiva = null;
    if (window.vistaActual === 'ventas') {
      window.setTimeout(() => {
        const el = $('buscarVenta') as HTMLInputElement | null;
        if (el) el.focus();
      }, 50);
    }
  }

  $('tourCerrar').onclick = () => cerrar(true);
  $('tourAtras').onclick = () => {
    if (idx > 0) {
      idx--;
      mostrarPaso();
    }
  };
  $('tourSig').onclick = () => {
    if (idx < defs.length - 1) {
      idx++;
      mostrarPaso();
    } else {
      cerrar(true);
    }
  };
  window.addEventListener('scroll', colocar, true);
  window.addEventListener('resize', colocar);

  tourActiva = { cancel: cerrar, _wrap: wrap };
  mostrarPaso();
}

export function cancelTour(): void {
  if (tourActiva) tourActiva.cancel(false);
}

export function registerTourGlobals(getVistaActual: () => Vista): void {
  window.iniciarTour = (seccion, forzar) => {
    const s = seccion === undefined ? getVistaActual() : seccion;
    iniciarTour(s, forzar);
  };
  window.reiniciarGuias = reiniciarGuias;
}
