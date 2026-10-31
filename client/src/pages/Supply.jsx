import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, Drawer, Empty, ErrorBox, Field, Loading, PageHead, STATUS_TONE, useLoad, useToast } from '../ui.jsx';
import { date, money, num, today } from '../format.js';

export function Inventory() {
  const { label, hidden, can } = useAuth();
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const sites = useLoad(() => api('/e/sites').catch(() => []), []);
  const inv = useLoad(() => api('/supply/inventory', { query: { siteId } }), [siteId]);
  const rows = (inv.data || []).filter((i) => (!status || i.status === status) && (!q || `${i.part_no} ${i.part_name}`.toLowerCase().includes(q.toLowerCase())));
  const showUsage = !hidden('inventory_levels', 'avg_daily_usage');
  return (
    <>
      <PageHead title="Inventory" sub="On hand, incoming supply and projected position with risk flags" />
      <div className="filters">
        {sites.data?.length > 1 && <Field label={label('site')}><select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">All</option>{sites.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        <Field label="Risk"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="ok">OK</option></select></Field>
        <Field label="Search"><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part…" /></Field>
      </div>
      <ErrorBox error={inv.error} />
      <Card flush>
        {inv.loading && !inv.data ? <Loading /> : (
          <DataTable rows={rows} columns={[
            { header: 'Part', render: (i) => <><b>{i.part_no}</b><div className="muted">{i.part_name}</div></> },
            { header: label('site'), key: 'site_name' },
            { header: 'On hand', right: true, render: (i) => num(i.on_hand) },
            { header: 'Safety', right: true, render: (i) => num(i.safety_stock) },
            { header: 'Incoming', right: true, render: (i) => num(i.incoming_qty) },
            { header: 'Job need', right: true, render: (i) => num(i.job_requirement) },
            { header: 'Projected', right: true, render: (i) => <b style={{ color: i.projected < 0 ? 'var(--bad, #b4232a)' : undefined }}>{num(i.projected)}</b> },
            ...(showUsage ? [{ header: 'Cover', right: true, render: (i) => (i.days_cover == null ? '—' : `${i.days_cover.toFixed(1)} d`) }] : []),
            { header: 'Next ETA', render: (i) => date(i.next_eta || i.next_due) },
            { header: 'Status', render: (i) => <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge> },
            { header: 'Why', render: (i) => (i.reasons.length ? i.reasons.join('; ') : '—') },
          ]} />
        )}
      </Card>
    </>
  );
}

function NewPo({ onClose, onSaved }) {
  const { label } = useAuth();
  const [h, setH] = useState({ po_no: '', supplier_org_id: '', site_id: '', order_date: today(), notes: '' });
  const [lines, setLines] = useState([{ part_id: '', qty: '', due_date: '', unit_cost: '' }]);
  const [err, setErr] = useState('');
  const d = useLoad(() => Promise.all([api('/e/organizations', { query: { type: 'supplier' } }).catch(() => []), api('/e/sites').catch(() => []), api('/e/parts').catch(() => [])]).then(([sup, sites, parts]) => ({ sup, sites, parts })), []);
  const upd = (i, p) => setLines((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    try { await api('/supply/purchase-orders', { method: 'POST', body: { ...h, lines: lines.map((l) => ({ ...l, qty: Number(l.qty), unit_cost: l.unit_cost === '' ? null : Number(l.unit_cost) })) } }); onSaved('Purchase order created'); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Drawer title="New purchase order" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
      <ErrorBox error={err} />
      {d.data && (
        <>
          <div className="form-grid">
            <Field label="PO number" required><input type="text" value={h.po_no} onChange={(e) => setH({ ...h, po_no: e.target.value })} /></Field>
            <Field label="Order date" required><input type="date" value={h.order_date} onChange={(e) => setH({ ...h, order_date: e.target.value })} /></Field>
            <Field label={label('supplier')} required><select value={h.supplier_org_id} onChange={(e) => setH({ ...h, supplier_org_id: e.target.value })}><option value="">Select…</option>{d.data.sup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label={`Receiving ${label('site').toLowerCase()}`} required><select value={h.site_id} onChange={(e) => setH({ ...h, site_id: e.target.value })}><option value="">Select…</option>{d.data.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <h3 style={{ margin: '16px 0 8px' }}>Lines <button className="btn sm" onClick={() => setLines([...lines, { part_id: '', qty: '', due_date: '', unit_cost: '' }])}><Plus size={12} /> Add</button></h3>
          {lines.map((l, i) => (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto', alignItems: 'end', marginBottom: 8 }}>
              <Field label="Part"><select value={l.part_id} onChange={(e) => upd(i, { part_id: e.target.value })}><option value="">Select…</option>{d.data.parts.map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.name}</option>)}</select></Field>
              <Field label="Qty"><input type="number" min="1" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} /></Field>
              <Field label="Due"><input type="date" value={l.due_date} onChange={(e) => upd(i, { due_date: e.target.value })} /></Field>
              <Field label="Unit cost"><input type="number" min="0" step="any" value={l.unit_cost} onChange={(e) => upd(i, { unit_cost: e.target.value })} /></Field>
              <button className="btn link" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 size={15} /></button>
            </div>
          ))}
        </>
      )}
    </Drawer>
  );
}

export function PurchaseOrders() {
  const { can, hidden, label } = useAuth();
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toast, toastNode] = useToast();
  const list = useLoad(() => api('/e/purchase_orders', { query: { status } }), [status]);
  const det = useLoad(() => (sel ? api(`/supply/purchase-orders/${sel}`) : null), [sel]);
  const showValue = !hidden('purchase_orders', 'po_value');
  const showCost = !hidden('po_lines', 'unit_cost');
  return (
    <>
      <PageHead title="Purchase Orders" sub="Open and historical orders to suppliers">
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['open', 'partial', 'received', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select>
        {can('purchase_orders', 'c') && <button className="btn primary" onClick={() => setAdding(true)}><Plus size={14} /> New PO</button>}
      </PageHead>
      <ErrorBox error={list.error} />
      <Card flush>
        {list.loading && !list.data ? <Loading /> : (
          <DataTable rows={list.data} onRowClick={(r) => setSel(r.id)} columns={[
            { header: 'PO', render: (r) => <b>{r.po_no}</b> }, { header: label('supplier'), key: 'supplier_name' }, { header: label('site'), key: 'site_name' },
            { header: 'Ordered', render: (r) => date(r.order_date) }, { header: 'Lines', right: true, render: (r) => r.line_count },
            { header: 'Next due', render: (r) => date(r.next_due) },
            ...(showValue ? [{ header: 'Value', right: true, render: (r) => money(r.po_value) }] : []),
            { header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
          ]} />
        )}
      </Card>
      {sel && (
        <Drawer title={det.data ? `PO ${det.data.po_no}` : 'Purchase order'} onClose={() => setSel(null)}>
          {!det.data ? <Loading /> : (
            <DataTable rows={det.data.lines} columns={[
              { header: 'Part', render: (l) => <><b>{l.part_no}</b><div className="muted">{l.part_name}</div></> },
              { header: 'Ordered', right: true, render: (l) => num(l.qty) }, { header: 'Received', right: true, render: (l) => num(l.qty_received) },
              { header: 'Due', render: (l) => <span style={{ color: l.qty_received < l.qty && l.due_date < today() ? '#b4232a' : undefined }}>{date(l.due_date)}</span> },
              ...(showCost ? [{ header: 'Unit cost', right: true, render: (l) => (l.unit_cost == null ? '—' : Number(l.unit_cost).toFixed(2)) }] : []),
            ]} />
          )}
        </Drawer>
      )}
      {adding && <NewPo onClose={() => setAdding(false)} onSaved={(m) => { setAdding(false); toast(m); list.reload(); }} />}
      {toastNode}
    </>
  );
}

function NewShipment({ onClose, onSaved }) {
  const [h, setH] = useState({ shipment_no: '', po_id: '', ship_date: today(), eta: '', carrier: '', tracking_no: '', notes: '', status: 'planned' });
  const [qty, setQty] = useState({});
  const [err, setErr] = useState('');
  const pos = useLoad(() => Promise.all([api('/e/purchase_orders', { query: { status: 'open' } }), api('/e/purchase_orders', { query: { status: 'partial' } })]).then((a) => a.flat()), []);
  const po = useLoad(() => (h.po_id ? api(`/supply/purchase-orders/${h.po_id}`) : null), [h.po_id]);
  const open = (po.data?.lines || []).filter((l) => l.qty_received < l.qty);
  const save = async () => {
    try {
      const lines = open.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ po_line_id: l.id, qty: Number(qty[l.id]) }));
      await api('/supply/shipments', { method: 'POST', body: { ...h, lines } }); onSaved('Shipment notice created');
    } catch (e) { setErr(e.message); }
  };
  return (
    <Drawer title="New shipment (ASN)" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Shipment number" required><input type="text" value={h.shipment_no} onChange={(e) => setH({ ...h, shipment_no: e.target.value })} /></Field>
        <Field label="Purchase order" required><select value={h.po_id} onChange={(e) => { setH({ ...h, po_id: e.target.value }); setQty({}); }}><option value="">Select…</option>{pos.data?.map((p) => <option key={p.id} value={p.id}>{p.po_no} · {p.supplier_name}</option>)}</select></Field>
        <Field label="Ship date"><input type="date" value={h.ship_date} onChange={(e) => setH({ ...h, ship_date: e.target.value })} /></Field>
        <Field label="ETA at receiving site" required><input type="date" value={h.eta} onChange={(e) => setH({ ...h, eta: e.target.value })} /></Field>
        <Field label="Carrier"><input type="text" value={h.carrier} onChange={(e) => setH({ ...h, carrier: e.target.value })} /></Field>
        <Field label="Tracking no."><input type="text" value={h.tracking_no} onChange={(e) => setH({ ...h, tracking_no: e.target.value })} /></Field>
        <Field label="Status"><select value={h.status} onChange={(e) => setH({ ...h, status: e.target.value })}><option value="planned">Planned</option><option value="in_transit">In transit</option></select></Field>
      </div>
      {h.po_id && (
        <>
          <h3 style={{ margin: '16px 0 8px' }}>Quantities shipped</h3>
          {po.loading ? <Loading /> : !open.length ? <Empty>No open lines on this PO.</Empty> : (
            <DataTable rows={open} columns={[
              { header: 'Part', render: (l) => <><b>{l.part_no}</b><div className="muted">{l.part_name}</div></> },
              { header: 'Open', right: true, render: (l) => num(l.qty - l.qty_received) }, { header: 'Due', render: (l) => date(l.due_date) },
              { header: 'Ship qty', render: (l) => <input type="number" min="0" max={l.qty - l.qty_received} style={{ width: 90 }} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /> },
            ]} />
          )}
        </>
      )}
    </Drawer>
  );
}

export function Shipments() {
  const { can, label } = useAuth();
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [upd, setUpd] = useState({});
  const [toast, toastNode] = useToast();
  const list = useLoad(() => api('/e/shipments', { query: { status } }), [status]);
  const det = useLoad(() => (sel ? api(`/supply/shipments/${sel}`).then((s) => { setUpd({ status: s.status, eta: s.eta, delay_reason: s.delay_reason || '' }); return s; }) : null), [sel]);
  const s = det.data;
  const run = async (fn, msg) => { try { await fn(); toast(msg); list.reload(); det.reload(); } catch (e) { toast(e.message, true); } };
  const editable = s && can('shipments', 'e') && !['delivered', 'cancelled'].includes(s.status);
  return (
    <>
      <PageHead title="Shipments" sub="Supplier advance ship notices and inbound tracking">
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['planned', 'in_transit', 'delayed', 'delivered', 'cancelled'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select>
        {can('shipments', 'c') && <button className="btn primary" onClick={() => setAdding(true)}><Plus size={14} /> New shipment</button>}
      </PageHead>
      <ErrorBox error={list.error} />
      <Card flush>
        {list.loading && !list.data ? <Loading /> : (
          <DataTable rows={list.data} onRowClick={(r) => setSel(r.id)} columns={[
            { header: 'Shipment', render: (r) => <b>{r.shipment_no}</b> }, { header: 'PO', key: 'po_no' }, { header: label('supplier'), key: 'supplier_name' }, { header: label('site'), key: 'site_name' },
            { header: 'Ship date', render: (r) => date(r.ship_date) }, { header: 'ETA', render: (r) => date(r.eta) }, { header: 'PO due', render: (r) => date(r.po_due) },
            { header: 'Qty', right: true, render: (r) => num(r.total_qty) },
            { header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge> },
          ]} />
        )}
      </Card>
      {sel && (
        <Drawer title={s ? `Shipment ${s.shipment_no}` : 'Shipment'} onClose={() => setSel(null)} footer={s && (
          <>
            {editable && <button className="btn" onClick={() => run(() => api(`/e/shipments/${s.id}`, { method: 'PUT', body: { status: upd.status, eta: upd.eta || null, delay_reason: upd.delay_reason || null } }), 'Shipment updated')}>Save changes</button>}
            {can('shipments', 'a') && !['delivered', 'cancelled'].includes(s.status) && <button className="btn primary" onClick={() => run(() => api(`/supply/shipments/${s.id}/receive`, { method: 'POST', body: {} }), 'Received into inventory')}>Receive</button>}
          </>
        )}>
          {!s ? <Loading /> : (
            <>
              <div className="form-grid">
                <div><div className="muted">PO</div><b>{s.po_no}</b></div><div><div className="muted">{label('supplier')}</div>{s.supplier_name}</div>
                <div><div className="muted">Carrier / tracking</div>{s.carrier || '—'} {s.tracking_no && `· ${s.tracking_no}`}</div><div><div className="muted">Delivered</div>{date(s.delivered_on)}</div>
                <Field label="Status"><select disabled={!editable} value={upd.status || ''} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>{['planned', 'in_transit', 'delayed', 'delivered', 'cancelled'].map((x) => <option key={x} value={x} disabled={x === 'delivered'}>{x.replace('_', ' ')}</option>)}</select></Field>
                <Field label="ETA"><input type="date" disabled={!editable} value={String(upd.eta || '').slice(0, 10)} onChange={(e) => setUpd({ ...upd, eta: e.target.value })} /></Field>
                <Field label="Delay reason" className="full"><input type="text" disabled={!editable} value={upd.delay_reason || ''} onChange={(e) => setUpd({ ...upd, delay_reason: e.target.value })} /></Field>
              </div>
              <h3 style={{ margin: '16px 0 8px' }}>Lines</h3>
              <DataTable rows={s.lines} columns={[{ header: 'Part', render: (l) => <><b>{l.part_no}</b><div className="muted">{l.part_name}</div></> }, { header: 'Qty', right: true, render: (l) => num(l.qty) }, { header: 'PO due', render: (l) => date(l.due_date) }]} />
            </>
          )}
        </Drawer>
      )}
      {adding && <NewShipment onClose={() => setAdding(false)} onSaved={(m) => { setAdding(false); toast(m); list.reload(); }} />}
      {toastNode}
    </>
  );
}
