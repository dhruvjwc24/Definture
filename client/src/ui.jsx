import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { kpiStatus, pct, daysAgo, today } from './format.js';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

// Data loading hook: re-runs when deps change, exposes reload()
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve(fn()).then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (error) => id === seq.current && setState({ data: null, error: error.message, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export const Loading = ({ text = 'Loading…' }) => <div className="spinner">{text}</div>;
export const ErrorBox = ({ error }) => (error ? <div className="alert">{error}</div> : null);
export const Empty = ({ children = 'No data for the selected filters.' }) => <div className="empty">{children}</div>;

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      <div className="row no-print">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, flush, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-h"><h3>{title}</h3><div className="row">{actions}</div></div>}
      <div className={`card-b ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

// KPI tile; `metric` links to the tenant's configurable target for the red/amber/green edge
export function Kpi({ label, value, metric, raw, foot, delta, deltaGoodWhen = 'up' }) {
  const { targets } = useAuth();
  const status = metric ? kpiStatus(targets[metric], raw) : 'none';
  const good = delta == null ? null : deltaGoodWhen === 'up' ? delta >= 0 : delta <= 0;
  return (
    <div className={`card kpi ${status === 'none' ? '' : status}`}>
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      <div className="k-foot">
        {delta != null && <span className={`delta ${good ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)} pts</span>}
        {foot && <span>{foot}</span>}
      </div>
    </div>
  );
}

export function Badge({ tone = '', children }) { return <span className={`badge ${tone}`}>{children}</span>; }
export const STATUS_TONE = { approved: 'good', submitted: 'blue', draft: '', rejected: 'bad', critical: 'bad', warning: 'warn', ok: 'good', delayed: 'bad', in_transit: 'blue', planned: '', delivered: 'good', cancelled: '', open: 'blue', partial: 'warn', received: 'good', running: 'blue', complete: 'good' };

export function Pct({ value, metric }) {
  const { targets } = useAuth();
  const s = kpiStatus(targets[metric], value);
  return (
    <div className="cell-bar">
      <span style={{ minWidth: 48, textAlign: 'right' }}>{pct(value)}</span>
      <div className={`bar ${s === 'none' ? '' : s}`}><span style={{ width: `${Math.min(100, (value || 0) * 100)}%` }} /></div>
    </div>
  );
}

export function Field({ label, required, children, className = '' }) {
  return <div className={`field ${className}`}><label>{label}{required && <span className="req"> *</span>}</label>{children}</div>;
}

export function Drawer({ title, onClose, children, footer }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-h"><h3>{title}</h3><button className="btn link" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); }, []);
  const node = toast ? <div className={`toast ${toast.err ? 'err' : ''}`} role="status">{toast.msg}</div> : null;
  return [show, node];
}

// Shared date-range + site/line filter bar
export function useFilters(initial = {}) {
  const [f, setF] = useState({ from: daysAgo(29), to: today(), siteId: '', lineId: '', ...initial });
  return [f, (patch) => setF((p) => ({ ...p, ...patch }))];
}
export function FilterBar({ filters, set, sites = true, lines = true, extra }) {
  const { can, label } = useAuth();
  const siteList = useLoad(() => (sites && can('sites') ? api('/e/sites') : []), []);
  const lineList = useLoad(() => (lines && can('lines') ? api('/e/lines', { query: { site_id: filters.siteId } }) : []), [filters.siteId]);
  const preset = (n) => set({ from: daysAgo(n - 1), to: today() });
  return (
    <div className="filters no-print">
      <div className="seg" role="group" aria-label="Date range">
        {[[7, '7d'], [30, '30d'], [90, '90d']].map(([n, l]) => <button key={n} onClick={() => preset(n)}>{l}</button>)}
      </div>
      <Field label="From"><input type="date" value={filters.from} max={filters.to} onChange={(e) => set({ from: e.target.value })} /></Field>
      <Field label="To"><input type="date" value={filters.to} min={filters.from} onChange={(e) => set({ to: e.target.value })} /></Field>
      {sites && (siteList.data?.length > 1) && (
        <Field label={label('site')}>
          <select value={filters.siteId} onChange={(e) => set({ siteId: e.target.value, lineId: '' })}>
            <option value="">All</option>{siteList.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}
      {lines && (lineList.data?.length > 1) && (
        <Field label={label('line')}>
          <select value={filters.lineId} onChange={(e) => set({ lineId: e.target.value })}>
            <option value="">All</option>{lineList.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      )}
      {extra}
    </div>
  );
}
export const queryOf = (f) => ({ from: f.from, to: f.to, siteId: f.siteId, lineId: f.lineId });

export function DataTable({ columns, rows, onRowClick, empty, footer }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{columns.map((c) => <th key={c.key || c.header} className={c.right ? 'r' : ''} style={c.width ? { width: c.width } : undefined}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} className={onRowClick ? 'click' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key || c.header} className={c.right ? 'r' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}
