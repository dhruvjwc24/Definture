import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, Empty, ErrorBox, FilterBar, Kpi, Loading, PageHead, Pct, STATUS_TONE, queryOf, useFilters, useLoad } from '../ui.jsx';
import { GroupOeeChart, LossChart, ParetoChart, TrendChart } from '../charts.jsx';
import { date, hrs, money, num, pct } from '../format.js';

const diff = (c, p) => (c == null || p == null ? null : c - p);

function KpiRow({ s }) {
  const c = s.current, p = s.previous;
  return (
    <div className="grid g4">
      <Kpi label="OEE" metric="oee" raw={c.oee} value={pct(c.oee)} delta={diff(c.oee, p.oee)} foot="vs prior period" />
      <Kpi label="Availability" metric="availability" raw={c.availability} value={pct(c.availability)} delta={diff(c.availability, p.availability)} />
      <Kpi label="Performance" metric="performance" raw={c.performance} value={pct(c.performance)} delta={diff(c.performance, p.performance)} />
      <Kpi label="Quality" metric="quality" raw={c.quality} value={pct(c.quality)} delta={diff(c.quality, p.quality)} />
    </div>
  );
}

function OeeDashboard({ title, sub, groupBy }) {
  const { label } = useAuth();
  const [f, set] = useFilters();
  const q = queryOf(f);
  const sum = useLoad(() => api('/analytics/summary', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const trend = useLoad(() => api('/analytics/trend', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const groups = useLoad(() => api('/analytics/groups', { query: { ...q, by: groupBy } }), [f.from, f.to, f.siteId, f.lineId, groupBy]);
  const machines = useLoad(() => api('/analytics/machines', { query: q }), [f.from, f.to, f.siteId, f.lineId]);
  const dt = useLoad(() => api('/analytics/downtime-pareto', { query: { ...q, unplannedOnly: 1 } }), [f.from, f.to, f.siteId, f.lineId]);
  const err = sum.error || trend.error;
  const worst = [...(machines.data || [])].filter((m) => m.oee != null).sort((a, b) => a.oee - b.oee).slice(0, 6);

  return (
    <>
      <PageHead title={title} sub={sub} />
      <FilterBar filters={f} set={set} />
      <ErrorBox error={err} />
      {sum.loading && !sum.data ? <Loading /> : sum.data && (
        <>
          <KpiRow s={sum.data} />
          <div className="grid g4" style={{ marginTop: 16 }}>
            <Kpi label="Units produced" value={num(sum.data.current.total)} foot={`${num(sum.data.current.good)} good`} />
            <Kpi label="Scrap rate" metric="scrap_rate" raw={sum.data.current.scrap_rate} value={pct(sum.data.current.scrap_rate)} deltaGoodWhen="down" delta={diff(sum.data.current.scrap_rate, sum.data.previous.scrap_rate)} foot={`${num(sum.data.current.scrap)} scrapped`} />
            <Kpi label="Unplanned downtime" value={hrs(sum.data.current.downtime_sec)} foot={`of ${hrs(sum.data.current.planned_sec)} planned`} />
            <Kpi label="Production logs" value={num(sum.data.current.logs)} foot={`${sum.data.from} → ${sum.data.to}`} />
          </div>
          <div className="grid g21" style={{ marginTop: 16 }}>
            <Card title="OEE trend">{trend.data?.length ? <TrendChart data={trend.data} /> : <Empty />}</Card>
            <Card title="Where the time goes"><LossChart loss={sum.data.current.loss} />{!sum.data.current.planned_sec && <Empty />}</Card>
          </div>
        </>
      )}
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title={`OEE by ${label(groupBy)}`}>{groups.data?.length ? <GroupOeeChart data={groups.data} /> : <Empty />}</Card>
        <Card title="Top downtime reasons (unplanned)">
          {dt.data?.length ? <ParetoChart data={dt.data.slice(0, 6).map((d) => ({ ...d, hours: +(d.seconds / 3600).toFixed(1) }))} valueKey="hours" yLabel="Hours" /> : <Empty />}
        </Card>
      </div>
      <Card title={`Lowest-performing ${label('machine', true).toLowerCase()}`} flush>
        <DataTable rows={worst} columns={[
          { header: label('machine'), render: (m) => <>{m.name} {m.is_constraint && <Badge tone="blue">Constraint</Badge>}</> },
          { header: label('line'), key: 'line_name' }, { header: label('site'), key: 'site_name' },
          { header: 'OEE', render: (m) => <Pct value={m.oee} metric="oee" /> },
          { header: 'Availability', right: true, render: (m) => pct(m.availability) },
          { header: 'Performance', right: true, render: (m) => pct(m.performance) },
          { header: 'Quality', right: true, render: (m) => pct(m.quality) },
        ]} />
      </Card>
    </>
  );
}

export const Executive = () => <OeeDashboard title="Executive Dashboard" sub="Enterprise OEE, losses and the biggest opportunities" groupBy="site" />;
export const Plant = () => <OeeDashboard title="Plant & Line Dashboard" sub="Line performance and bottleneck stations" groupBy="line" />;

export function SupplyDash() {
  const { can, label, hidden } = useAuth();
  const sum = useLoad(() => api('/supply/summary'), []);
  const sup = useLoad(() => api('/supply/suppliers'), []);
  if (sum.loading && !sum.data) return <Loading />;
  const s = sum.data;
  return (
    <>
      <PageHead title="Supply Chain Dashboard" sub="Inbound risk, delays and supplier performance" />
      <ErrorBox error={sum.error || sup.error} />
      {s && (
        <>
          <div className="grid g4">
            <Kpi label="Critical parts" value={s.critical} raw={null} foot={`${s.warning} at warning · ${s.parts_tracked} tracked`} />
            <Kpi label="Open purchase orders" value={s.open_pos} foot={`${s.late_po_lines} lines past due`} />
            <Kpi label="Inbound shipments" value={s.inbound_shipments} foot={`${s.delayed_shipments.length} delayed / late`} />
            {s.open_value != null ? <Kpi label="Open PO value" value={money(s.open_value)} /> : <Kpi label="Delayed shipments" value={s.delayed_shipments.length} />}
          </div>
          <div className="grid g2" style={{ marginTop: 16 }}>
            <Card title="Parts at risk" actions={can('inventory_levels') && <Link className="btn sm" to="/supply/inventory">All inventory</Link>} flush>
              <DataTable rows={s.at_risk} empty="No parts at risk." columns={[
                { header: 'Part', render: (i) => <><b>{i.part_no}</b><div className="muted">{i.part_name}</div></> },
                { header: label('site'), key: 'site_name' },
                { header: 'On hand', right: true, render: (i) => num(i.on_hand) },
                { header: 'Cover', right: true, render: (i) => (i.days_cover == null ? '—' : `${i.days_cover.toFixed(1)} d`) },
                { header: 'Status', render: (i) => <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge> },
                { header: 'Why', render: (i) => i.reasons.join('; ') },
              ]} />
            </Card>
            <Card title="Delayed or late shipments" flush>
              <DataTable rows={s.delayed_shipments} empty="No delayed shipments." columns={[
                { header: 'Shipment', key: 'shipment_no' }, { header: 'PO', key: 'po_no' }, { header: label('supplier'), key: 'supplier_name' },
                { header: 'ETA', render: (d) => date(d.eta) }, { header: 'PO due', render: (d) => date(d.po_due) },
                { header: 'Status', render: (d) => <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge> },
                { header: 'Reason', render: (d) => d.delay_reason || '—' },
              ]} />
            </Card>
          </div>
        </>
      )}
      <Card title={`${label('supplier')} scorecard (last 90 days)`} flush>
        <DataTable rows={sup.data} empty="No suppliers visible." columns={[
          { header: label('supplier'), render: (x) => <b>{x.name}</b> },
          { header: 'On-time delivery', render: (x) => (x.otd == null ? '—' : <Pct value={x.otd / 100} metric="otd" />) },
          { header: 'Delivered', right: true, render: (x) => x.delivered_90d },
          { header: 'Avg days late', right: true, render: (x) => x.avg_days_late.toFixed(1) },
          { header: 'Inbound', right: true, render: (x) => x.inbound },
          { header: 'Delayed now', right: true, render: (x) => x.delayed_now },
        ]} />
      </Card>
    </>
  );
}
