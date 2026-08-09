import { $ } from './dom';
import { cancelTour, iniciarTour, registerTourGlobals } from '../features/tours';
import type { Vista } from '../types';

declare global {
  interface Window {
    mostrarVista: (nombre: Vista) => void;
    vistaActual: Vista;
  }
}

type ViewRenderer = () => void | Promise<void>;

let renderers: Partial<Record<Vista, ViewRenderer>> = {};
let vista: Vista = 'ventas';

export function registerViewRenderers(r: Partial<Record<Vista, ViewRenderer>>): void {
  renderers = { ...renderers, ...r };
}

export function vistaActual(): Vista {
  return vista;
}

export function mostrarVista(nombre: Vista): void {
  cancelTour();
  vista = nombre;
  window.vistaActual = nombre;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('v-' + nombre).classList.add('active');
  document.querySelectorAll('.tab').forEach((b) => {
    const tab = b as HTMLElement;
    tab.classList.toggle('active', tab.dataset.v === nombre);
  });
  const render = renderers[nombre];
  if (render) render();
  window.scrollTo(0, 0);
  window.setTimeout(() => iniciarTour(nombre, false), 550);
}

export function registerNavGlobals(): void {
  window.mostrarVista = mostrarVista;
  window.vistaActual = vista;
  registerTourGlobals(() => vista);
}
