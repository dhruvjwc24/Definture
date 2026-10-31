import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, Drawer, ErrorBox, Field, Loading, PageHead, STATUS_TONE, useLoad, useToast } from '../ui.jsx';
import { date, num } from '../format.js';

// Client-side description of the generic master-data / configuration entities served by /api/e/:entity
const F = {
  text: (n, label, o = {}) => ({ n, label, t: 'text', ...o }), num: (n, label, o = {}) => ({ n, label, t: 'num', ...o }), bool: (n, label, o = {}) => ({ n, label, t: 'bool', ...o }),
  date: (n, label, o = {}) => ({ n, label, t: 'date', ...o }), time: (n, label, o = {}) => ({ n, label, t: 'time', ...o }),
  en: (n, label, values, o = {}) => ({ n, label, t: 'enum', values, ...o }), ref: (n, label, ref, o = {}) => ({ n, label, t: 'ref', ref, ...o }),
};
const ENTITY_UI = {
  organizations: { title: 'Organizations & Suppliers', perm: 'organizations', fields: [F.text('code', 'Code', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.en('type', 'Type', ['internal', 'supplier', 'customer'], { req: 1 }), F.text('contact_email', 'Contact email'), F.bool('active', 'Active')],
    cols: [['code', 'Code'], ['name', 'Name'], ['type', 'Type', 'badge'], ['contact_email', 'Contact'], ['active', 'Active', 'bool']] },
  sites: { title: 'Sites', perm: 'sites', fields: [F.ref('org_id', 'Organization', 'organizations', { req: 1 }), F.text('code', 'Code', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.text('city', 'City'), F.text('country', 'Country'), F.text('timezone', 'Time zone'), F.bool('active', 'Active')],
    cols: [['code', 'Code'], ['name', 'Name'], ['org_name', 'Organization'], ['city', 'City'], ['country', 'Country'], ['active', 'Active', 'bool']] },
  lines: { title: 'Assembly Lines', perm: 'lines', fields: [F.ref('site_id', 'Site', 'sites', { req: 1 }), F.text('code', 'Code', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.text('layout', 'Layout'), F.num('takt_sec', 'Takt (sec)'), F.bool('paced', 'Paced line (takt is the ideal cycle)'), F.bool('active', 'Active')],
    cols: [['code', 'Code'], ['name', 'Name'], ['site_name', 'Site'], ['layout', 'Layout'], ['takt_sec', 'Takt (s)', 'num'], ['active', 'Active', 'bool']] },
  machines: { title: 'Machines / Workcenters', perm: 'machines', fields: [F.ref('line_id', 'Line', 'lines', { req: 1 }), F.text('code', 'Code', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.text('machine_type', 'Type'), F.num('station_no', 'Station #'), F.bool('active', 'Active')],
    cols: [['code', 'Code'], ['name', 'Name'], ['line_name', 'Line'], ['site_name', 'Site'], ['station_no', 'Stn', 'num'], ['machine_type', 'Type'], ['active', 'Active', 'bool']] },
  parts: { title: 'Parts & Products', perm: 'parts', fields: [F.text('part_no', 'Part number', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.en('part_type', 'Type', ['raw', 'component', 'subassembly', 'finished'], { req: 1 }), F.text('uom', 'UoM'), F.num('unit_cost', 'Unit cost'), F.bool('active', 'Active')],
    cols: [['part_no', 'Part no'], ['name', 'Name'], ['part_type', 'Type', 'badge'], ['uom', 'UoM'], ['unit_cost', 'Unit cost', 'num2'], ['active', 'Active', 'bool']] },
  operations: { title: 'Operations (Routing)', perm: 'operations', fields: [F.ref('part_id', 'Part', 'parts', { req: 1 }), F.ref('machine_id', 'Machine', 'machines', { req: 1 }), F.num('seq', 'Sequence', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.num('cycle_time_sec', 'Cycle time (s)', { req: 1 }), F.num('manual_time_sec', 'Manual work (s)'), F.text('operator_group', 'Operator group')],
    cols: [['part_no', 'Part'], ['seq', 'Seq', 'num'], ['name', 'Operation'], ['machine_name', 'Machine'], ['line_name', 'Line'], ['cycle_time_sec', 'Cycle (s)', 'num'], ['manual_time_sec', 'Manual (s)', 'num'], ['operator_group', 'Operator']] },
  jobs: { title: 'Jobs', perm: 'jobs', fields: [F.ref('site_id', 'Site', 'sites', { req: 1 }), F.ref('line_id', 'Line', 'lines'), F.text('job_no', 'Job number', { req: 1 }), F.ref('part_id', 'Part', 'parts', { req: 1 }), F.num('qty_planned', 'Qty planned', { req: 1 }), F.num('qty_done', 'Qty done'), F.date('due_date', 'Due date'), F.en('status', 'Status', ['open', 'running', 'complete', 'cancelled'])],
    cols: [['job_no', 'Job'], ['part_no', 'Part'], ['site_name', 'Site'], ['line_name', 'Line'], ['qty_planned', 'Planned', 'num'], ['qty_done', 'Done', 'num'], ['due_date', 'Due', 'date'], ['status', 'Status', 'badge']] },
  reason_codes: { title: 'Scrap & Downtime Reasons', perm: 'reason_codes', fields: [F.en('kind', 'Kind', ['scrap', 'downtime'], { req: 1 }), F.text('code', 'Code', { req: 1 }), F.text('name', 'Name', { req: 1 }), F.text('category', 'Category'), F.bool('planned', 'Planned stop (does not reduce availability)'), F.bool('active', 'Active')],
    cols: [['kind', 'Kind', 'badge'], ['code', 'Code'], ['name', 'Name'], ['category', 'Category'], ['planned', 'Planned', 'bool'], ['active', 'Active', 'bool']] },
  shifts: { title: 'Shifts', perm: 'shifts', fields: [F.text('name', 'Name', { req: 1 }), F.time('start_time', 'Start', { req: 1 }), F.time('end_time', 'End', { req: 1 }), F.num('planned_break_min', 'Planned break (min)')],
    cols: [['name', 'Name'], ['start_time', 'Start', 'time'], ['end_time', 'End', 'time'], ['planned_break_min', 'Break (min)', 'num']] },
  custom_fields: { title: 'Custom Fields', perm: 'custom_fields', fields: [F.en('entity', 'Applies to', ['organizations', 'sites', 'lines', 'machines', 'parts', 'operations', 'jobs', 'production_logs', 'purchase_orders', 'shipments', 'inventory_levels'], { req: 1 }), F.text('key', 'Key (no spaces)', { req: 1 }), F.text('label', 'Label', { req: 1 }), F.en('type', 'Type', ['text', 'number', 'date', 'boolean', 'select'], { req: 1 }), F.text('options', 'Options (comma separated, for select)'), F.bool('required', 'Required'), F.num('sort_order', 'Sort order')],
    cols: [['entity', 'Entity'], ['key', 'Key'], ['label', 'Label'], ['type', 'Type', 'badge'], ['required', 'Required', 'bool']] },
};
export { ENTITY_UI };

const REF_LABEL = { parts: (r) => `${r.part_no} — ${r.name}`, jobs: (r) => r.job_no };

function renderCell(v, kind) {
  if (v == null || v === '') return '—';
  if (kind === 'bool') return v ? 'Yes' : 'No';
  if (kind === 'badge') return <Badge tone={STATUS_TONE[v]}>{v}</Badge>;
  if (kind === 'num') return num(v, 2).replace(/\.00$/, '');
  if (kind === 'num2') return num(v, 2);
  if (kind === 'date') return date(v);
  if (kind === 'time') return String(v).slice(0, 5);
  return String(v);
}

// Tenant-defined custom fields for an entity, rendered as inputs (value = key/value object)
export function CustomFieldInputs({ entity, value = {}, onChange }) {
  const { session } = useAuth();
  const defs = (session.customFields || []).filter((c) => c.entity === entity);
  const set = (k, v) => onChange({ ...value, [k]: v });
  return defs.map((c) => (
    <Field key={c.key} label={c.label} required={c.required}>
      {c.type === 'select' ? <select value={value[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)}><option value="">—</option>{(c.options || []).map((o) => <option key={o}>{o}</option>)}</select>
        : c.type === 'boolean' ? <label className="check"><input type="checkbox" checked={!!value[c.key]} onChange={(e) => set(c.key, e.target.checked)} /> Yes</label>
        : <input type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'} value={value[c.key] ?? ''} onChange={(e) => set(c.key, c.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />}
    </Field>
  ));
}

function RefSelect({ spec, value, onChange, disabled }) {
  const opts = useLoad(() => api(`/e/${spec.ref}`).catch(() => []), [spec.ref]);
  const lab = REF_LABEL[spec.ref] || ((r) => r.name);
  return <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}><option value="">{spec.req ? 'Select…' : 'None'}</option>{opts.data?.map((r) => <option key={r.id} value={r.id}>{lab(r)}</option>)}</select>;
}

function EditForm({ ui, entity, row, onClose, onSaved }) {
  const { session, hidden } = useAuth();
  const ro = session.readonlyFields?.[ui.perm] || [];
  const editing = !!row;
  const init = {};
  for (const f of ui.fields) init[f.n] = row ? (f.n === 'options' ? (row.options || []).join(', ') : row[f.n]) : f.t === 'bool' ? (f.n === 'active' || f.n === 'paced') : '';
  const [v, setV] = useState({ ...init, custom: row?.custom || {} });
  const [err, setErr] = useState('');
  const save = async () => {
    const body = { custom: v.custom };
    for (const f of ui.fields) {
      if (hidden(ui.perm, f.n) || ro.includes(f.n)) continue;
      let x = v[f.n];
      if (f.n === 'options') x = x ? x.split(',').map((s) => s.trim()).filter(Boolean) : null;
      else if (f.t === 'num') x = x === '' || x == null ? null : Number(x);
      else if (f.t === 'ref' || f.t === 'date' || f.t === 'text') x = x === '' ? null : x;
      body[f.n] = x;
    }
    try { await api(editing ? `/e/${entity}/${row.id}` : `/e/${entity}`, { method: editing ? 'PUT' : 'POST', body }); onSaved(editing ? 'Saved' : 'Created'); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Drawer title={`${editing ? 'Edit' : 'New'} ${ui.title.replace(/s$/, '')}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        {ui.fields.filter((f) => !hidden(ui.perm, f.n)).map((f) => {
          const dis = ro.includes(f.n) || (editing && f.t === 'ref' && f.n !== 'line_id' && false);
          const set = (x) => setV((s) => ({ ...s, [f.n]: x }));
          return (
            <Field key={f.n} label={f.label} required={f.req} className={f.t === 'bool' ? 'full' : ''}>
              {f.t === 'bool' ? <label className="check"><input type="checkbox" checked={!!v[f.n]} disabled={dis} onChange={(e) => set(e.target.checked)} /> {f.label}</label>
                : f.t === 'enum' ? <select value={v[f.n] ?? ''} disabled={dis} onChange={(e) => set(e.target.value)}><option value="">{f.req ? 'Select…' : '—'}</option>{f.values.map((o) => <option key={o}>{o}</option>)}</select>
                : f.t === 'ref' ? <RefSelect spec={f} value={v[f.n]} onChange={set} disabled={dis} />
                : <input type={{ num: 'number', date: 'date', time: 'time' }[f.t] || 'text'} step={f.t === 'num' ? 'any' : undefined} value={f.t === 'time' ? String(v[f.n] ?? '').slice(0, 5) : f.t === 'date' ? String(v[f.n] ?? '').slice(0, 10) : v[f.n] ?? ''} disabled={dis} onChange={(e) => set(e.target.value)} />}
            </Field>
          );
        })}
        {!ui.noCustom && entity !== 'custom_fields' && entity !== 'reason_codes' && entity !== 'shifts' && <CustomFieldInputs entity={entity} value={v.custom} onChange={(custom) => setV((s) => ({ ...s, custom }))} />}
      </div>
    </Drawer>
  );
}

export default function DataPage() {
  const { entity } = useParams();
  const nav = useNavigate();
  const ui = ENTITY_UI[entity];
  const { can, hidden, session } = useAuth();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // null | 'new' | row
  const [toast, toastNode] = useToast();
  useEffect(() => { setQ(''); setEdit(null); }, [entity]);
  const list = useLoad(() => (ui ? api(`/e/${entity}`, { query: { q } }) : null), [entity, q]);
  if (!ui) return <div className="alert">Unknown page.</div>;
  if (!can(ui.perm, 'r')) return <div className="alert">You do not have access to this page.</div>;
  const customDefs = (session.customFields || []).filter((c) => c.entity === entity);
  const columns = [
    ...ui.cols.filter(([k]) => !hidden(ui.perm, k)).map(([k, h, kind]) => ({ header: h, key: k, right: kind?.startsWith('num'), render: (r) => renderCell(r[k], kind) })),
    ...customDefs.map((c) => ({ header: c.label, render: (r) => renderCell(r.custom?.[c.key]) })),
  ];
  const del = async (r) => {
    if (!window.confirm('Delete this record?')) return;
    try { await api(`/e/${entity}/${r.id}`, { method: 'DELETE' }); toast('Deleted'); list.reload(); } catch (e) { toast(e.message, true); }
  };
  return (
    <>
      <PageHead title={ui.title} sub={list.data ? `${list.data.length} record(s)` : ''}>
        <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        {can(ui.perm, 'c') && <button className="btn primary" onClick={() => setEdit('new')}><Plus size={14} /> New</button>}
      </PageHead>
      <ErrorBox error={list.error} />
      <Card flush>
        {list.loading && !list.data ? <Loading /> : (
          <DataTable rows={list.data} onRowClick={can(ui.perm, 'e') ? setEdit : undefined} columns={[
            ...columns,
            ...(entity === 'parts' ? [{ header: '', width: 80, render: (r) => <button className="btn link" onClick={(e) => { e.stopPropagation(); nav(`/lifecycle/${r.id}`); }}>Lifecycle</button> }] : []),
            ...(can(ui.perm, 'd') ? [{ header: '', width: 60, render: (r) => <button className="btn link" onClick={(e) => { e.stopPropagation(); del(r); }}>Delete</button> }] : []),
          ]} />
        )}
      </Card>
      {edit && <EditForm ui={ui} entity={entity} row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); list.reload(); }} />}
      {toastNode}
    </>
  );
}
