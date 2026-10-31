export const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
export const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
export const hrs = (sec) => (sec == null ? '—' : `${(sec / 3600).toFixed(1)} h`);
export const mins = (sec) => (sec == null ? '—' : `${Math.round(sec / 60).toLocaleString()} min`);
export const money = (v, cur = 'USD') => (v == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v));
export const date = (v) => (v ? String(v).slice(0, 10) : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// status for a KPI against tenant targets. value is a fraction (0..1) for percentage metrics.
export function kpiStatus(target, value) {
  if (!target || value == null) return 'none';
  const v = value * 100;
  if (target.direction === 'lower') return v <= target.target ? 'good' : v <= target.warn ? 'warn' : 'bad';
  return v >= target.target ? 'good' : v >= target.warn ? 'warn' : 'bad';
}

export function toCsv(rows, columns) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [columns.map((c) => esc(c.header)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\n');
}
export function downloadCsv(name, rows, columns) {
  const blob = new Blob([toCsv(rows, columns)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
