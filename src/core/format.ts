export function fmt(n?: number): string {
  return (n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export function fmtF(ts: number): string {
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtCorto(n: number): string {
  return n >= 1000 ? '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(n);
}

export function inicioDia(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function fechaLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

const ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function esc(s?: string): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ESC_MAP[m]);
}
