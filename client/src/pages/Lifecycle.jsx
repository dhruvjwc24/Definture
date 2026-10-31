import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, ErrorBox, Field, Kpi, Loading, PageHead, STATUS_TONE, useLoad, useToast } from '../ui.jsx';
import { date, num, pct } from '../format.js';

const TYPE_LABEL = { raw: 'Raw material', component: 'Component', subassembly: 'Subassembly', finished: 'Finished product' };
const qtyText = (q) => `×${num(q, 2).replace(/\.?0+$/, '')}`;

// Flatten the nested structure into unique parts (first occurrence wins)
function flatten(root) {
  const seen = new Map();
  const walk = (n) => { if (!seen.has(n.id)) seen.set(n.id, n); n.children.forEach(walk); };
  walk(root);
  return [...seen.values()];
}
const depthOf = (n) => 1 + Math.max(0, ...n.children.map(depthOf));

function PartBox({ n, root, onOpen }) {
  const made = n.children.length > 0;
  const sup = n.suppliers[0];
  const inbound = n.shipments.reduce((s, x) => s + Number(x.qty), 0);
  const nextEta = n.shipments[0]?.eta;
  const job = n.jobs[0];
  return (
    <div className={`lc-part ${n.part_type} ${root ? 'root' : ''}`} onClick={() => onOpen(n.id)} title="Open the lifecycle of this part">
      {!root && <span className="lc-qty">{qtyText(n.qty_per)}</span>}
      <div className="lc-type">{made || n.part_type === 'finished' ? TYPE_LABEL[n.part_type] : sup ? 'Purchased' : TYPE_LABEL[n.part_type]}</div>
      <b>{n.part_no}</b>
      <div className="lc-name">{n.name}</div>
      <div className="lc-facts">
        {n.stock ? <div><i className={`dot ${n.stock.status}`} />{num(n.stock.on_hand)} on hand{n.stock.days_cover != null && ` · ${n.stock.days_cover.toFixed(1)} d`}</div> : <div className="muted">No stock record</div>}
        {!made && sup && <div>{sup.org_name} · {sup.lead_time_days} d lead</div>}
        {!made && n.operations.length > 0 && <div className="muted">Supplier routing: {n.operations.length} steps</div>}
        {made && !root && <div className="muted">Built in its own lane below</div>}
        {made && n.production && <div>{num(n.production.output)} out · {pct(n.production.scrap_rate)} scrap</div>}
        {inbound > 0 && <div className={n.inbound_late ? 'late' : ''}>Inbound {num(inbound)}{nextEta ? ` · ETA ${date(nextEta).slice(5)}` : ''}{n.inbound_late ? ' · late' : ''}</div>}
        {job && <div>{job.job_no} · {num(job.qty_done)}/{num(job.qty_planned)}</div>}
      </div>
    </div>
  );
}

function OpBox({ op }) {
  return (
    <div className="lc-op" title={`${op.name}\n${op.machine_name} · ${op.line_name} · ${op.site_name}\nCycle ${op.cycle_time_sec}s · operator work ${op.manual_time_sec}s${op.stats?.oee != null ? `\nOEE (30 d) ${pct(op.stats.oee)}` : ''}`}>
      <span className="lc-seq">{op.seq}</span>
      <div><b>{op.name}</b><div className="muted small">{op.machine_code} · {num(op.cycle_time_sec)} s{op.stats?.oee != null && ` · OEE ${pct(op.stats.oee, 0)}`}</div></div>
    </div>
  );
}

// One part and everything that happens before it exists: [components added at each step] over a chain of steps ending in the part itself
function Lane({ n, root, onOpen }) {
  const ops = n.children.length ? n.operations : []; // purchased parts: the supplier's own routing is listed in the table below
  const known = new Set(ops.map((o) => o.id));
  const byOp = new Map(); const loose = [];
  for (const k of n.children) {
    if (k.consumed_at && known.has(k.consumed_at)) (byOp.get(k.consumed_at) || byOp.set(k.consumed_at, []).get(k.consumed_at)).push(k);
    else loose.push(k);
  }
  // components with no step assigned join the first step (or feed the part directly when there is no routing)
  const steps = ops.length ? ops.map((o, i) => ({ op: o, inputs: [...(i === 0 ? loose : []), ...(byOp.get(o.id) || [])] })) : [{ op: null, inputs: loose }];
  const partCol = steps.length * 2 + 1;
  return (
    <div className="lc-lane">
      {steps.map((s, i) => (
        <Fragment key={s.op?.id || 'direct'}>
          {s.inputs.length > 0 && (
            <>
              <div className={`lc-add ${s.op ? '' : 'inline'}`} style={{ gridColumn: i * 2 + 1, gridRow: s.op ? 1 : 3 }}>
                <div className="lc-add-h">{s.op ? 'Added at this step' : 'Components'}</div>
                {s.inputs.map((k) => <PartBox key={k.id} n={k} onOpen={onOpen} />)}
              </div>
              {s.op && <div className="lc-down" style={{ gridColumn: i * 2 + 1, gridRow: 2 }} />}
            </>
          )}
          {s.op && <div style={{ gridColumn: i * 2 + 1, gridRow: 3 }} className="lc-cell op"><OpBox op={s.op} /></div>}
          <div className="lc-right" style={{ gridColumn: i * 2 + 2, gridRow: 3 }} />
        </Fragment>
      ))}
      <div className="lc-cell" style={{ gridColumn: partCol, gridRow: 3 }}><PartBox n={n} root={root} onOpen={onOpen} /></div>
    </div>
  );
}

// Scales the diagram to the card width ("fit") or a fixed zoom; the scaled box keeps its real size so scrolling stays correct
function FitView({ zoom, children }) {
  const outer = useRef(); const inner = useRef();
  const [size, setSize] = useState({ w: 1, h: 1, cw: 0 });
  useLayoutEffect(() => {
    const measure = () => setSize((s) => {
      const next = { w: inner.current.offsetWidth, h: inner.current.offsetHeight, cw: outer.current.clientWidth };
      return next.w === s.w && next.h === s.h && next.cw === s.cw ? s : next;
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer.current); ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  const z = zoom === 'fit' ? Math.max(0.55, Math.min(1, (size.cw - 16) / size.w)) : zoom;
  return (
    <div ref={outer} className="lc-scroll">
      <div style={{ width: size.w * z, height: size.h * z }}>
        <div ref={inner} style={{ transform: `scale(${z})`, transformOrigin: 'top left', width: 'max-content' }}>{children}</div>
      </div>
    </div>
  );
}

function BomEditor({ root, onChanged }) {
  const { can } = useAuth();
  const [toast, toastNode] = useToast();
  const all = useLoad(() => api('/e/parts').catch(() => []), []);
  const [f, setF] = useState({ child: '', qty: 1, op: '' });
  const [err, setErr] = useState('');
  const editable = can('parts', 'e');
  const opName = (id) => root.operations.find((o) => o.id === id);
  const save = async () => {
    setErr('');
    try {
      await api(`/parts/${root.id}/bom/${f.child}`, { method: 'PUT', body: { qty_per: Number(f.qty), operation_id: f.op || null } });
      setF({ child: '', qty: 1, op: '' }); toast('Component saved'); onChanged();
    } catch (e) { setErr(e.message); }
  };
  const remove = async (k) => {
    if (!window.confirm(`Remove ${k.part_no} from ${root.part_no}?`)) return;
    try { await api(`/parts/${root.id}/bom/${k.id}`, { method: 'DELETE' }); toast('Component removed'); onChanged(); } catch (e) { setErr(e.message); }
  };
  return (
    <Card title={`Components of ${root.part_no}`} flush>
      <ErrorBox error={err} />
      <DataTable rows={root.children} empty="No components yet. A part with no components is treated as purchased or raw material." columns={[
        { header: 'Component', render: (k) => <><b>{k.part_no}</b> {k.name}</> },
        { header: 'Type', render: (k) => <Badge tone={k.part_type === 'subassembly' ? 'blue' : ''}>{k.part_type}</Badge> },
        { header: 'Qty per', right: true, render: (k) => num(k.qty_per, 2).replace(/\.?0+$/, '') },
        { header: 'Added at step', render: (k) => { const o = opName(k.consumed_at); return o ? `${o.seq} · ${o.name}` : <span className="muted">Not linked to a step</span>; } },
        ...(editable ? [{ header: '', width: 120, render: (k) => (
          <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <button className="btn link" onClick={() => setF({ child: k.id, qty: k.qty_per, op: k.consumed_at || '' })}>Edit</button>
            <button className="btn link" onClick={() => remove(k)} title="Remove"><Trash2 size={14} /></button>
          </span>) }] : []),
      ]} />
      {editable && (
        <div className="lc-bom-form">
          <Field label="Component">
            <select value={f.child} onChange={(e) => setF({ ...f, child: e.target.value })}>
              <option value="">Select part…</option>
              {all.data?.filter((p) => p.id !== root.id).map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="Qty per"><input type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Added at step">
            <select value={f.op} onChange={(e) => setF({ ...f, op: e.target.value })}>
              <option value="">Not linked</option>
              {root.operations.map((o) => <option key={o.id} value={o.id}>{o.seq} · {o.name}</option>)}
            </select>
          </Field>
          <button className="btn primary" disabled={!f.child || !(Number(f.qty) > 0)} onClick={save}><Plus size={14} /> Save component</button>
        </div>
      )}
      {toastNode}
    </Card>
  );
}

export default function Lifecycle() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [zoom, setZoom] = useState('fit');
  const parts = useLoad(() => api('/e/parts'), []);
  // default to the finished product with the deepest structure story: first finished part
  const first = useMemo(() => parts.data?.find((p) => p.part_type === 'finished') || parts.data?.[0], [parts.data]);
  useEffect(() => { if (!id && first) nav(`/lifecycle/${first.id}`, { replace: true }); }, [id, first, nav]);
  const lc = useLoad(() => (id ? api(`/parts/${id}/lifecycle`) : null), [id]);
  const open = (pid) => nav(`/lifecycle/${pid}`);
  const root = lc.data?.tree;
  const all = useMemo(() => (root ? flatten(root) : []), [root]);
  const purchased = all.filter((n) => n.id !== root?.id && n.children.length === 0);
  const made = all.filter((n) => n.children.length > 0);
  const atRisk = purchased.filter((n) => n.stock?.status === 'critical' || n.inbound_late);
  const jobsAll = made.flatMap((n) => n.jobs.map((j) => ({ ...j, part_no: n.part_no })));
  const rootJobs = root?.jobs || [];
  const jobPlanned = rootJobs.reduce((s, j) => s + Number(j.qty_planned), 0);
  const jobDone = rootJobs.reduce((s, j) => s + Number(j.qty_done), 0);

  return (
    <>
      <PageHead title="Part Lifecycle" sub="From supplier to finished product: structure, steps, stock, inbound supply, jobs and recent production">
        <div className="field" style={{ minWidth: 280 }}>
          <select value={id || ''} onChange={(e) => open(e.target.value)} aria-label="Part">
            {['finished', 'subassembly', 'component', 'raw'].map((t) => (
              <optgroup key={t} label={TYPE_LABEL[t]}>{parts.data?.filter((p) => p.part_type === t).map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.name}</option>)}</optgroup>
            ))}
          </select>
        </div>
      </PageHead>
      <ErrorBox error={lc.error} />
      {lc.loading && !lc.data ? <Loading /> : root && (
        <>
          <div className="grid g4">
            <div className="card kpi"><div className="k-label">Structure</div><div className="k-value">{made.length} made · {purchased.length} bought</div><div className="k-foot">{depthOf(root)} level{depthOf(root) > 1 ? 's' : ''} deep</div></div>
            <div className={`card kpi ${atRisk.length ? 'bad' : 'good'}`}><div className="k-label">Supply risk</div><div className="k-value">{atRisk.length} at risk</div><div className="k-foot">{atRisk.length ? atRisk.slice(0, 3).map((n) => n.part_no).join(', ') : 'No shortage or late inbound'}</div></div>
            {rootJobs.length ? <Kpi label="Open job progress" value={pct(jobPlanned ? jobDone / jobPlanned : null, 0)} foot={`${rootJobs.map((j) => j.job_no).join(', ')} · due ${date(rootJobs[0].due_date)}`} />
              : <Kpi label="Open jobs" value="None" foot="No open or running jobs for this part" />}
            {root.production ? <Kpi label="Scrap rate (30 d)" metric="scrap_rate" raw={root.production.scrap_rate} value={pct(root.production.scrap_rate)} foot={`OEE ${pct(root.production.oee)}`} />
              : <Kpi label="Scrap rate (30 d)" value="—" foot="No production logged" />}
          </div>

          <Card title="Flow: supplier to finished product" className="lc-card" actions={(
            <>
              <span className="lc-legend"><i className="dot ok" />Stock OK</span><span className="lc-legend"><i className="dot warning" />Low</span><span className="lc-legend"><i className="dot critical" />Critical</span>
              <select value={zoom} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))} aria-label="Zoom" style={{ width: 110 }}>
                <option value="fit">Fit to width</option><option value={1}>100%</option><option value={0.8}>80%</option><option value={0.65}>65%</option>
              </select>
            </>)}>
            {made.map((n) => (
              <div key={n.id} className="lc-lane-block">
                <div className="lc-lane-title">{n.id === root.id ? 'Final product' : 'Subassembly'}: <b>{n.part_no}</b> {n.name}</div>
                <FitView zoom={zoom}><Lane n={n} root={n.id === root.id} onOpen={open} /></FitView>
              </div>
            ))}
            <div className="muted small" style={{ marginTop: 8 }}>Read left to right. Components are added at the step shown above it; the chain of steps ends in the part. Click any part to open its own lifecycle.</div>
          </Card>

          <div style={{ marginTop: 16 }}><BomEditor root={root} onChanged={lc.reload} /></div>

          <div style={{ marginTop: 16 }}>
            <Card title="Sourcing and inbound supply" flush>
              <DataTable rows={purchased} empty="This part has no purchased components." columns={[
                { header: 'Component', render: (n) => <><b>{n.part_no}</b> {n.name}</> },
                { header: 'Supplier', render: (n) => n.suppliers.map((s) => `${s.org_name} (${s.lead_time_days} d)`).join(', ') || '—' },
                { header: 'On hand', right: true, render: (n) => (n.stock ? <><i className={`dot ${n.stock.status}`} />{num(n.stock.on_hand)}</> : '—') },
                { header: 'Days cover', right: true, render: (n) => (n.stock?.days_cover != null ? n.stock.days_cover.toFixed(1) : '—') },
                { header: 'Open PO', render: (n) => (n.open_pos.length ? n.open_pos.map((p) => `${p.po_no}: ${num(p.open_qty)} due ${date(p.due_date).slice(5)}`).join('; ') : '—') },
                { header: 'Shipment', render: (n) => (n.shipments.length ? n.shipments.map((s) => <div key={s.shipment_no}><Badge tone={STATUS_TONE[s.status]}>{s.status.replace('_', ' ')}</Badge> {s.shipment_no} · {num(s.qty)} · ETA {date(s.eta).slice(5)}{s.delay_reason && <div className="muted small">{s.delay_reason}</div>}</div>) : '—') },
              ]} />
            </Card>
          </div>

          <div className="grid g2" style={{ marginTop: 16 }}>
            <Card title="Open jobs" flush>
              <DataTable rows={jobsAll} empty="No open or running jobs." columns={[
                { header: 'Job', key: 'job_no' }, { header: 'Part', key: 'part_no' }, { header: 'Line', render: (j) => j.line_name || '—' },
                { header: 'Done', right: true, render: (j) => `${num(j.qty_done)} / ${num(j.qty_planned)}` }, { header: 'Due', render: (j) => date(j.due_date) },
                { header: 'Status', render: (j) => <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge> },
              ]} />
            </Card>
            <Card title="Where this part is used" flush>
              <DataTable rows={lc.data.where_used} empty="Not used in any other part." columns={[
                { header: 'Part', render: (p) => <button className="btn link" onClick={() => open(p.id)}><b>{p.part_no}</b> {p.name}</button> },
                { header: 'Type', render: (p) => <Badge tone={p.part_type === 'subassembly' ? 'blue' : ''}>{p.part_type}</Badge> },
                { header: 'Level', right: true, render: (p) => (p.depth === 1 ? 'Direct' : `Via ${p.depth - 1} level${p.depth > 2 ? 's' : ''}`) },
                { header: 'Qty per', right: true, render: (p) => (p.qty_per == null ? '—' : num(p.qty_per, 2).replace(/\.?0+$/, '')) },
              ]} />
            </Card>
          </div>

          <div style={{ marginTop: 16 }}>
            <Card title={`Steps and performance (last ${lc.data.window_days} days)`} flush>
              <DataTable rows={made.flatMap((n) => n.operations.map((o) => ({ ...o, part_no: n.part_no })))} empty="No routing defined." columns={[
                { header: 'Part', key: 'part_no' }, { header: 'Seq', right: true, key: 'seq' }, { header: 'Step', key: 'name' },
                { header: 'Machine', render: (o) => `${o.machine_code} · ${o.line_name}` },
                { header: 'Cycle (s)', right: true, render: (o) => num(o.cycle_time_sec) }, { header: 'Operator (s)', right: true, render: (o) => num(o.manual_time_sec) },
                { header: 'Output', right: true, render: (o) => (o.stats ? num(o.stats.good) : '—') },
                { header: 'Scrap', right: true, render: (o) => (o.stats ? pct(o.stats.scrap_rate) : '—') },
                { header: 'OEE', right: true, render: (o) => (o.stats ? pct(o.stats.oee) : '—') },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
