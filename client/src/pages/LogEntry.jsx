import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, ErrorBox, Field, Kpi, PageHead, useLoad, useToast } from '../ui.jsx';
import { pct, today } from '../format.js';
import { CustomFieldInputs } from './DataPage.jsx';

const safe = (p) => p.catch(() => []);
const secOf = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 3600 + m * 60; };

export default function LogEntry() {
  const { label, can } = useAuth();
  const nav = useNavigate();
  const [toast, toastNode] = useToast();
  const lists = useLoad(() => Promise.all([
    safe(api('/e/machines')), safe(api('/e/operations')), safe(api('/e/jobs', { query: { status: 'running' } })), safe(api('/e/shifts')),
    safe(api('/e/reason_codes', { query: { kind: 'downtime', active: true } })), safe(api('/e/reason_codes', { query: { kind: 'scrap', active: true } })), safe(api('/e/lines')),
  ]).then(([machines, ops, jobs, shifts, dtReasons, scReasons, lines]) => ({ machines, ops, jobs, shifts, dtReasons, scReasons, lines })), []);

  const [f, setF] = useState({ machine_id: '', operation_id: '', job_id: '', shift_id: '', log_date: today(), good_count: '', rework_count: '', notes: '', custom: {} });
  const [downtime, setDowntime] = useState([]);
  const [scrap, setScrap] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const L = lists.data;

  const machineOps = useMemo(() => (L ? L.ops.filter((o) => o.machine_id === f.machine_id) : []), [L, f.machine_id]);
  const machine = L?.machines.find((m) => m.id === f.machine_id);
  const op = L?.ops.find((o) => o.id === f.operation_id);
  const line = L?.lines.find((l) => l.id === machine?.line_id);
  const shift = L?.shifts.find((s) => s.id === f.shift_id);

  // Live preview mirrors server defaults: planned = shift - break, ideal = max(cycle, takt) on paced lines
  const planned = shift ? ((secOf(shift.end_time) - secOf(shift.start_time) + 86400) % 86400 || 86400) - shift.planned_break_min * 60 : null;
  const ideal = op ? (line?.paced && line?.takt_sec ? Math.max(Number(op.cycle_time_sec), Number(line.takt_sec)) : Number(op.cycle_time_sec)) : null;
  const good = Number(f.good_count) || 0, rework = Number(f.rework_count) || 0;
  const scrapQty = scrap.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  const dtSec = downtime.reduce((s, x) => s + (Number(x.minutes) || 0) * 60, 0);
  const total = good + rework + scrapQty;
  const run = planned != null ? Math.max(planned - dtSec, 0) : null;
  const A = planned ? run / planned : null;
  const P = run && ideal ? Math.min((total * ideal) / run, 1) : null;
  const Q = total ? good / total : null;
  const OEE = A != null && P != null && Q != null ? A * P * Q : null;

  const set = (p) => setF((s) => ({ ...s, ...p }));
  const upd = (setter, i, p) => setter((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const submit = async (status) => {
    setBusy(true); setErr('');
    try {
      await api('/logs', { method: 'POST', body: {
        ...f, status, operation_id: f.operation_id || null, job_id: f.job_id || null, shift_id: f.shift_id || null,
        downtime: downtime.filter((d) => d.reason_id && d.minutes).map((d) => ({ reason_id: d.reason_id, duration_sec: Math.round(Number(d.minutes) * 60), notes: d.notes || null })),
        scrap: scrap.filter((s) => s.reason_id && s.qty).map((s) => ({ reason_id: s.reason_id, qty: Number(s.qty), notes: s.notes || null })),
      } });
      toast(status === 'draft' ? 'Draft saved' : 'Production log submitted');
      setTimeout(() => nav('/shopfloor/logs'), 700);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  if (!L) return <ErrorBox error={lists.error} />;
  return (
    <>
      <PageHead title="Enter Production Log" sub={`One ${label('machine').toLowerCase()}, one shift. Downtime and scrap are captured as events.`} />
      <ErrorBox error={err} />
      <div className="grid g21">
        <div>
          <Card title="Production">
            <div className="form-grid">
              <Field label={label('machine')} required>
                <select value={f.machine_id} onChange={(e) => set({ machine_id: e.target.value, operation_id: '' })}>
                  <option value="">Select…</option>{L.machines.map((m) => <option key={m.id} value={m.id}>{m.line_name ? `${m.line_name} · ` : ''}{m.name}</option>)}
                </select>
              </Field>
              <Field label={label('operation')}>
                <select value={f.operation_id} onChange={(e) => set({ operation_id: e.target.value })} disabled={!f.machine_id}>
                  <option value="">Auto / none</option>{machineOps.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.part_no})</option>)}
                </select>
              </Field>
              <Field label="Shift">
                <select value={f.shift_id} onChange={(e) => set({ shift_id: e.target.value })}>
                  <option value="">Select…</option>{L.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)})</option>)}
                </select>
              </Field>
              <Field label="Date" required><input type="date" value={f.log_date} max={today()} onChange={(e) => set({ log_date: e.target.value })} /></Field>
              <Field label={label('job')}>
                <select value={f.job_id} onChange={(e) => set({ job_id: e.target.value })}>
                  <option value="">None</option>{L.jobs.map((j) => <option key={j.id} value={j.id}>{j.job_no} · {j.part_name}</option>)}
                </select>
              </Field>
              <span />
              <Field label="Good units" required><input type="number" min="0" value={f.good_count} onChange={(e) => set({ good_count: e.target.value })} /></Field>
              <Field label="Rework units"><input type="number" min="0" value={f.rework_count} onChange={(e) => set({ rework_count: e.target.value })} /></Field>
              <Field label="Notes" className="full"><textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
              <CustomFieldInputs entity="production_logs" value={f.custom} onChange={(custom) => set({ custom })} />
            </div>
          </Card>
          <Card title="Downtime" actions={<button className="btn sm" onClick={() => setDowntime([...downtime, { reason_id: '', minutes: '', notes: '' }])}><Plus size={13} /> Add</button>}>
            {!downtime.length && <div className="muted">No downtime recorded.</div>}
            {downtime.map((d, i) => (
              <div key={i} className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 2fr auto', marginBottom: 8, alignItems: 'end' }}>
                <Field label="Reason"><select value={d.reason_id} onChange={(e) => upd(setDowntime, i, { reason_id: e.target.value })}><option value="">Select…</option>{L.dtReasons.map((r) => <option key={r.id} value={r.id}>{r.name}{r.planned ? ' (planned)' : ''}</option>)}</select></Field>
                <Field label="Minutes"><input type="number" min="0" value={d.minutes} onChange={(e) => upd(setDowntime, i, { minutes: e.target.value })} /></Field>
                <Field label="Notes"><input type="text" value={d.notes} onChange={(e) => upd(setDowntime, i, { notes: e.target.value })} /></Field>
                <button className="btn link" onClick={() => setDowntime(downtime.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button>
              </div>
            ))}
          </Card>
          <Card title="Scrap" actions={<button className="btn sm" onClick={() => setScrap([...scrap, { reason_id: '', qty: '', notes: '' }])}><Plus size={13} /> Add</button>}>
            {!scrap.length && <div className="muted">No scrap recorded.</div>}
            {scrap.map((s, i) => (
              <div key={i} className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 2fr auto', marginBottom: 8, alignItems: 'end' }}>
                <Field label="Reason"><select value={s.reason_id} onChange={(e) => upd(setScrap, i, { reason_id: e.target.value })}><option value="">Select…</option>{L.scReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
                <Field label="Quantity"><input type="number" min="0" value={s.qty} onChange={(e) => upd(setScrap, i, { qty: e.target.value })} /></Field>
                <Field label="Operator notes"><input type="text" value={s.notes} onChange={(e) => upd(setScrap, i, { notes: e.target.value })} /></Field>
                <button className="btn link" onClick={() => setScrap(scrap.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button>
              </div>
            ))}
          </Card>
          <div className="row">
            <button className="btn primary" disabled={busy || !f.machine_id || f.good_count === ''} onClick={() => submit('submitted')}>{can('production_logs', 'a') ? 'Save & approve' : 'Submit'}</button>
            <button className="btn" disabled={busy || !f.machine_id || f.good_count === ''} onClick={() => submit('draft')}>Save draft</button>
          </div>
        </div>
        <div>
          <Card title="Live OEE preview">
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Kpi label="Availability" value={pct(A)} metric="availability" raw={A} />
              <Kpi label="Performance" value={pct(P)} metric="performance" raw={P} />
              <Kpi label="Quality" value={pct(Q)} metric="quality" raw={Q} />
              <Kpi label="OEE" value={pct(OEE)} metric="oee" raw={OEE} />
            </div>
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Total {total} units · planned {planned != null ? Math.round(planned / 60) : '—'} min · ideal cycle {ideal ?? '—'} s. Preview only — the server recalculates on save.
            </div>
          </Card>
        </div>
      </div>
      {toastNode}
    </>
  );
}
