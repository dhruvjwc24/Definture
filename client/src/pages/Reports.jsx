import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, Empty, ErrorBox, Field, FilterBar, Kpi, Loading, PageHead, Pct, queryOf, useFilters, useLoad } from '../ui.jsx';
import { GroupOeeChart, LossChart, ParetoChart, StationChart, TrendChart, YamazumiChart } from '../charts.jsx';
import { date, downloadCsv, hrs, mins, num, pct } from '../format.js';

const Actions = ({ onCsv }) => (
  <>
    {onCsv && <button className="btn" onClick={onCsv}><Download size={14} /> CSV</button>}
    <button className="btn" onClick={() => window.print()}><Printer size={14} /> Print</button>
  </>
);

export function QualityReport() {
  const { label } = useAuth();
  const [f, set] = useFilters();
  const [reason, setReason] = useState('');
  const q = queryOf(f);
  const pareto = useLoad(() => api('/analytics/scrap-pareto', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const rejects = useLoad(() => api('/analytics/rejects', { query: { ...q, reasonId: reason } }), [f.from, f.to, f.siteId, f.lineId, reason]);
  const sel = pareto.data?.find((p) => p.id === reason);
  // Column order is fixed by the requirement; Operator Notes is the right-most column
  const cols = [
    { header: label('machine'), render: (r) => r.machine_name, value: (r) => r.machine_name },
    { header: label('operation'), render: (r) => r.operation, value: (r) => r.operation },
    { header: 'Scrap Count', right: true, render: (r) => num(r.scrap_count), value: (r) => r.scrap_count },
    { header: 'Scrap Reason', render: (r) => r.scrap_reason, value: (r) => r.scrap_reason },
    { header: 'Operator Notes', render: (r) => r.operator_notes || '—', value: (r) => r.operator_notes },
  ];
  return (
    <>
      <PageHead title="Quality Report" sub="Rejected parts Pareto and rejects log"><Actions onCsv={() => downloadCsv(`rejects_${f.from}_${f.to}.csv`, rejects.data || [], cols)} /></PageHead>
      <FilterBar filters={f} set={set} />
      <ErrorBox error={pareto.error || rejects.error} />
      <Card title="Rejected parts by reason" actions={reason && <button className="btn sm" onClick={() => setReason('')}>Clear filter: {sel?.reason}</button>}>
        {pareto.loading && !pareto.data ? <Loading /> : pareto.data?.length ? <ParetoChart data={pareto.data} valueKey="qty" yLabel="Rejected parts" selected={reason} onSelect={(d) => setReason(reason === d.id ? '' : d.id)} /> : <Empty />}
        <div className="muted" style={{ fontSize: 12 }}>Click a bar to filter the rejects log below.</div>
      </Card>
      <Card title="Rejects log" flush>
        {rejects.loading && !rejects.data ? <Loading /> : <DataTable rows={rejects.data} columns={cols} />}
      </Card>
    </>
  );
}

export function OeeReport() {
  const { label } = useAuth();
  const [f, set] = useFilters();
  const [by, setBy] = useState('line');
  const q = queryOf(f);
  const sum = useLoad(() => api('/analytics/summary', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const trend = useLoad(() => api('/analytics/trend', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const groups = useLoad(() => api('/analytics/groups', { query: { ...q, by } }), [f.from, f.to, f.siteId, f.lineId, by]);
  const machines = useLoad(() => api('/analytics/machines', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const c = sum.data?.current;
  const mcols = [
    { header: label('line'), value: (m) => m.line_name }, { header: label('machine'), value: (m) => m.name }, { header: 'OEE', value: (m) => m.oee },
    { header: 'Availability', value: (m) => m.availability }, { header: 'Performance', value: (m) => m.performance }, { header: 'Quality', value: (m) => m.quality },
  ];
  return (
    <>
      <PageHead title="OEE Report" sub="Availability × Performance × Quality"><Actions onCsv={() => downloadCsv(`oee_${f.from}_${f.to}.csv`, machines.data || [], mcols)} /></PageHead>
      <FilterBar filters={f} set={set} extra={<Field label="Group by"><select value={by} onChange={(e) => setBy(e.target.value)}>{['site', 'line', 'org', 'shift'].map((b) => <option key={b} value={b}>{b === 'org' ? 'organization' : b}</option>)}</select></Field>} />
      <ErrorBox error={sum.error || machines.error} />
      {c && (
        <div className="grid g4">
          <Kpi label="OEE" metric="oee" raw={c.oee} value={pct(c.oee)} /><Kpi label="Availability" metric="availability" raw={c.availability} value={pct(c.availability)} />
          <Kpi label="Performance" metric="performance" raw={c.performance} value={pct(c.performance)} /><Kpi label="Quality" metric="quality" raw={c.quality} value={pct(c.quality)} />
        </div>
      )}
      <div className="grid g21" style={{ marginTop: 16 }}>
        <Card title="Trend">{trend.data?.length ? <TrendChart data={trend.data} /> : <Empty />}</Card>
        <Card title="Loss breakdown">{c ? <LossChart loss={c.loss} /> : null}</Card>
      </div>
      <Card title={`OEE by ${by}`}>{groups.data?.length ? <GroupOeeChart data={groups.data} /> : <Empty />}</Card>
      <Card title={`${label('machine', true)} (constraint highlighted)`} flush>
        <DataTable rows={machines.data} columns={[
          { header: label('line'), key: 'line_name' }, { header: 'Stn', right: true, key: 'station_no' },
          { header: label('machine'), render: (m) => <>{m.name} {m.is_constraint && <Badge tone="blue">Constraint</Badge>} {m.is_worst_oee && <Badge tone="bad">Lowest OEE</Badge>}</> },
          { header: 'Cycle (s)', right: true, render: (m) => m.cycle_time_sec ?? '—' },
          { header: 'OEE', render: (m) => <Pct value={m.oee} metric="oee" /> },
          { header: 'Avail.', right: true, render: (m) => pct(m.availability) }, { header: 'Perf.', right: true, render: (m) => pct(m.performance) }, { header: 'Qual.', right: true, render: (m) => pct(m.quality) },
        ]} />
      </Card>
    </>
  );
}

export function DowntimeReport() {
  const [f, set] = useFilters();
  const [unplanned, setUnplanned] = useState(true);
  const q = { ...queryOf(f), unplannedOnly: unplanned ? 1 : undefined };
  const p = useLoad(() => api('/analytics/downtime-pareto', { query: q }), [f.from, f.to, f.siteId, f.lineId, unplanned]);
  const data = (p.data || []).map((d) => ({ ...d, hours: +(d.seconds / 3600).toFixed(1) }));
  const cols = [{ header: 'Reason', value: (d) => d.reason }, { header: 'Category', value: (d) => d.category }, { header: 'Hours', value: (d) => d.hours }, { header: 'Events', value: (d) => d.events }, { header: 'Cumulative %', value: (d) => d.cumulative_pct.toFixed(1) }];
  return (
    <>
      <PageHead title="Downtime Report" sub="Pareto of stop reasons"><Actions onCsv={() => downloadCsv(`downtime_${f.from}_${f.to}.csv`, data, cols)} /></PageHead>
      <FilterBar filters={f} set={set} extra={<label className="check"><input type="checkbox" checked={unplanned} onChange={(e) => setUnplanned(e.target.checked)} /> Unplanned only</label>} />
      <ErrorBox error={p.error} />
      <Card title="Downtime by reason">{data.length ? <ParetoChart data={data} valueKey="hours" yLabel="Hours" /> : p.loading ? <Loading /> : <Empty />}</Card>
      <Card flush>
        <DataTable rows={data} columns={[
          { header: 'Reason', key: 'reason' }, { header: 'Category', render: (d) => d.category || '—' },
          { header: 'Hours', right: true, key: 'hours' }, { header: 'Events', right: true, key: 'events' }, { header: 'Cumulative', right: true, render: (d) => `${d.cumulative_pct.toFixed(1)}%` },
        ]} />
      </Card>
    </>
  );
}

export function BalanceReport() {
  const { label } = useAuth();
  const [lineId, setLineId] = useState('');
  const [demand, setDemand] = useState('');
  const [avail, setAvail] = useState(7);
  const lines = useLoad(() => api('/e/lines').catch(() => []), []);
  const bal = useLoad(() => api('/analytics/line-balance', { query: { lineId } }), [lineId]);
  const planTakt = demand > 0 ? Math.floor((avail * 3600) / demand) : null;
  return (
    <>
      <PageHead title="Line Balance (Yamazumi)" sub="Operator work content against takt time"><Actions /></PageHead>
      <div className="filters no-print">
        <Field label={label('line')}><select value={lineId} onChange={(e) => setLineId(e.target.value)}><option value="">All</option>{lines.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Available hours / day"><input type="number" min="1" value={avail} onChange={(e) => setAvail(Number(e.target.value))} /></Field>
        <Field label="Customer demand / day"><input type="number" min="1" value={demand} onChange={(e) => setDemand(e.target.value)} placeholder="units" /></Field>
        {planTakt && <div className="field"><label>Takt = hours ÷ demand</label><b style={{ fontSize: 18 }}>{planTakt} s</b></div>}
      </div>
      <ErrorBox error={bal.error} />
      {bal.loading && !bal.data ? <Loading /> : !bal.data?.lines.length ? <Empty>No routing data available.</Empty> : bal.data.lines.map((l) => {
        const takt = planTakt || Number(l.takt_sec) || null;
        const need = takt ? Math.ceil(l.total_work_sec / takt) : null;
        return (
          <Card key={l.line_id} title={`${l.line_name} — ${l.part}`}>
            <div className="grid g4" style={{ marginBottom: 12 }}>
              <Kpi label="Takt time" value={takt ? `${takt} s` : '—'} foot={planTakt ? 'from demand calculator' : 'line setting'} />
              <Kpi label="Total work content" value={`${l.total_work_sec} s`} />
              <Kpi label="Min. operators" value={need ?? '—'} foot={`${l.operators.length} currently assigned`} />
              <Kpi label="Constraint" value={l.constraint.machine} foot={`${l.constraint.name} · ${l.constraint.cycle_time_sec}s`} />
            </div>
            <div className="grid g2">
              <div><h3>Operator work content</h3><YamazumiChart operators={l.operators} takt={takt} /></div>
              <div><h3>Station cycle time vs takt</h3><StationChart operations={l.operations} takt={takt} /></div>
            </div>
          </Card>
        );
      })}
    </>
  );
}
