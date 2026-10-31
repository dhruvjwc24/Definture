import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, Drawer, ErrorBox, FilterBar, Loading, PageHead, STATUS_TONE, queryOf, useFilters, useLoad, useToast } from '../ui.jsx';
import { date, mins, num } from '../format.js';

export default function Logs() {
  const { can, label, hidden } = useAuth();
  const [f, set] = useFilters();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [sel, setSel] = useState(null);
  const [toast, toastNode] = useToast();
  const logs = useLoad(() => api('/logs', { query: { from: f.from, to: f.to, line_id: f.lineId, status, mine: mine ? 1 : undefined } }), [f.from, f.to, f.lineId, status, mine]);
  const detail = useLoad(() => (sel ? api(`/logs/${sel}`) : null), [sel]);
  const act = async (verb) => {
    try { await api(`/logs/${sel}/${verb}`, { method: 'POST', body: {} }); toast(`Log ${verb}${verb.endsWith('e') ? 'd' : 'ed'}`); logs.reload(); detail.reload(); }
    catch (e) { toast(e.message, true); }
  };
  const d = detail.data;
  return (
    <>
      <PageHead title="Production Logs" sub="Submitted shop-floor records awaiting review or already approved" />
      <FilterBar filters={f} set={set} sites={false} extra={<>
        <div className="field"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['draft', 'submitted', 'approved', 'rejected'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only</label>
      </>} />
      <ErrorBox error={logs.error} />
      <Card flush>
        {logs.loading && !logs.data ? <Loading /> : (
          <DataTable rows={logs.data} onRowClick={(r) => setSel(r.id)} columns={[
            { header: 'Date', render: (r) => date(r.log_date) }, { header: label('machine'), render: (r) => <><b>{r.machine_name}</b><div className="muted">{r.line_name}</div></> },
            { header: label('operation'), render: (r) => r.operation_name || '—' },
            { header: 'Part / job', render: (r) => r.part_no ? <><b>{r.part_no}</b> {r.part_name}<div className="muted">{r.job_no || 'No job'}</div></> : '—' }, { header: 'Shift', render: (r) => r.shift_name || '—' },
            { header: 'Good', right: true, render: (r) => num(r.good_count) }, { header: 'Scrap', right: true, render: (r) => num(r.scrap_count) },
            { header: 'Downtime', right: true, render: (r) => mins(r.downtime_sec) },
            ...(hidden('production_logs', 'operator_name') ? [] : [{ header: label('operator'), render: (r) => r.operator_name || '—' }]),
            { header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
          ]} />
        )}
      </Card>
      {sel && (
        <Drawer title="Production log" onClose={() => setSel(null)} footer={d && can('production_logs', 'a') && (
          <>
            {d.status !== 'approved' && <button className="btn primary" onClick={() => act('approve')}>Approve</button>}
            {d.status === 'submitted' && <button className="btn danger" onClick={() => act('reject')}>Reject</button>}
            {(d.status === 'approved' || d.status === 'rejected') && <button className="btn" onClick={() => act('reopen')}>Reopen</button>}
          </>
        )}>
          {!d ? <Loading /> : (
            <>
              <div className="form-grid">
                <div><div className="muted">{label('machine')}</div><b>{d.machine_name}</b></div><div><div className="muted">Date / shift</div>{date(d.log_date)} · {d.shift_name || '—'}</div>
                <div><div className="muted">{label('operation')}</div>{d.operation_name || '—'}</div><div><div className="muted">Part</div>{d.part_no ? `${d.part_no} · ${d.part_name}` : '—'}</div><div><div className="muted">{label('job')}</div>{d.job_no || '—'}</div>
                <div><div className="muted">Status</div><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>{d.approved_by_name && <span className="muted"> by {d.approved_by_name}</span>}</div>
                <div><div className="muted">Good / rework</div>{num(d.good_count)} / {num(d.rework_count)}</div><div><div className="muted">Planned / ideal cycle</div>{mins(d.planned_time_sec)} / {d.ideal_cycle_sec}s</div>
              </div>
              {d.notes && <p><span className="muted">Notes: </span>{d.notes}</p>}
              <h3 style={{ marginTop: 16 }}>Downtime</h3>
              {d.downtime.length ? <DataTable rows={d.downtime} columns={[{ header: 'Reason', render: (x) => <>{x.reason} {x.planned && <Badge>planned</Badge>}</> }, { header: 'Duration', right: true, render: (x) => mins(x.duration_sec) }, { header: 'Notes', render: (x) => x.notes || '—' }]} /> : <div className="muted">None</div>}
              <h3 style={{ marginTop: 16 }}>Scrap</h3>
              {d.scrap.length ? <DataTable rows={d.scrap} columns={[{ header: 'Reason', key: 'reason' }, { header: 'Qty', right: true, key: 'qty' }, { header: 'Operator notes', render: (x) => x.notes || '—' }]} /> : <div className="muted">None</div>}
            </>
          )}
        </Drawer>
      )}
      {toastNode}
    </>
  );
}
