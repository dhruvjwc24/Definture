import { Router } from 'express';
import { rows, one, tx } from '../db.js';
import { HttpError, requirePerm, can, audit, stripHidden } from '../security/auth.js';
import { scopeClause, inScope } from '../security/scope.js';

const r = Router();
const today = () => new Date().toISOString().slice(0, 10);

const visiblePo = async (req, id, c) => {
  const params = [req.tenantId, id];
  const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, params);
  const q = `SELECT t.* FROM purchase_orders t WHERE t.tenant_id=$1 AND t.id=$2 ${sc ? 'AND ' + sc : ''}`;
  const po = c ? (await c.query(q, params)).rows[0] : await one(q, params);
  if (!po) throw new HttpError(404, 'Purchase order not found or not visible to you');
  return po;
};

// ───── Purchase orders with lines ─────
r.get('/purchase-orders/:id', requirePerm('purchase_orders', 'r'), async (req, res, next) => {
  try {
    const po = await visiblePo(req, req.params.id);
    const lines = await rows(`SELECT l.*, p.part_no, p.name AS part_name, p.uom FROM po_lines l JOIN parts p ON p.id = l.part_id WHERE l.po_id = $1 ORDER BY p.part_no`, [po.id]);
    res.json({ ...po, lines: lines.map((l) => stripHidden(req.ctx, 'po_lines', l)) });
  } catch (e) { next(e); }
});

r.post('/purchase-orders', requirePerm('purchase_orders', 'c'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.po_no || !b.supplier_org_id || !b.site_id || !Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'PO number, supplier, receiving site and at least one line are required');
    if (!inScope(req.ctx.scope, 'site', b.site_id)) throw new HttpError(403, 'You cannot raise POs for that site');
    const id = await tx(async (c) => {
      const sup = await c.query("SELECT 1 FROM organizations WHERE id=$1 AND tenant_id=$2 AND type='supplier'", [b.supplier_org_id, req.tenantId]);
      if (!sup.rows[0]) throw new HttpError(400, 'Unknown supplier');
      const ins = await c.query(`INSERT INTO purchase_orders(tenant_id, po_no, supplier_org_id, site_id, order_date, status, notes) VALUES ($1,$2,$3,$4,$5,'open',$6) RETURNING id`,
        [req.tenantId, b.po_no, b.supplier_org_id, b.site_id, b.order_date || today(), b.notes || null]);
      for (const l of b.lines) {
        if (!(Number(l.qty) > 0) || !l.due_date || !l.part_id) throw new HttpError(400, 'Each line needs part, quantity and due date');
        const unitCost = can(req.ctx, 'purchase_orders', 'e') && !req.ctx.fields.hidden.po_lines?.has('unit_cost') && !req.ctx.fields.read.po_lines?.has('unit_cost') ? (l.unit_cost ?? null) : null;
        await c.query('INSERT INTO po_lines(tenant_id, po_id, part_id, qty, unit_cost, due_date) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, ins.rows[0].id, l.part_id, l.qty, unitCost, l.due_date]);
      }
      return ins.rows[0].id;
    });
    await audit(req, 'create', 'purchase_orders', id);
    res.status(201).json({ id });
  } catch (e) { next(e.code === '23505' ? new HttpError(409, 'PO number already exists') : e); }
});

// ───── Shipments (supplier-entered ASN) ─────
r.get('/shipments/:id', requirePerm('shipments', 'r'), async (req, res, next) => {
  try {
    const params = [req.tenantId, req.params.id];
    const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, params);
    const s = await one(`SELECT t.*, po.po_no, so.name AS supplier_name FROM shipments t JOIN purchase_orders po ON po.id=t.po_id JOIN organizations so ON so.id=t.supplier_org_id WHERE t.tenant_id=$1 AND t.id=$2 ${sc ? 'AND ' + sc : ''}`, params);
    if (!s) throw new HttpError(404, 'Shipment not found or not visible to you');
    s.lines = await rows(`SELECT sl.*, p.part_no, p.name AS part_name, pl.due_date FROM shipment_lines sl JOIN parts p ON p.id=sl.part_id JOIN po_lines pl ON pl.id=sl.po_line_id WHERE sl.shipment_id=$1`, [s.id]);
    res.json(s);
  } catch (e) { next(e); }
});

r.post('/shipments', requirePerm('shipments', 'c'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.shipment_no || !b.po_id || !Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'Shipment number, PO and at least one line are required');
    const id = await tx(async (c) => {
      const po = await visiblePo(req, b.po_id, c);
      const ins = await c.query(
        `INSERT INTO shipments(tenant_id, shipment_no, po_id, supplier_org_id, site_id, status, ship_date, eta, carrier, tracking_no, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [req.tenantId, b.shipment_no, po.id, po.supplier_org_id, po.site_id, b.status === 'in_transit' ? 'in_transit' : 'planned', b.ship_date || null, b.eta || null, b.carrier || null, b.tracking_no || null, b.notes || null]);
      for (const l of b.lines) {
        const pl = (await c.query('SELECT * FROM po_lines WHERE id=$1 AND po_id=$2', [l.po_line_id, po.id])).rows[0];
        if (!pl) throw new HttpError(400, 'Line does not belong to that PO');
        if (!(Number(l.qty) > 0) || Number(l.qty) > Number(pl.qty) - Number(pl.qty_received)) throw new HttpError(400, 'Shipped quantity exceeds the open PO quantity');
        await c.query('INSERT INTO shipment_lines(tenant_id, shipment_id, po_line_id, part_id, qty) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, ins.rows[0].id, pl.id, pl.part_id, l.qty]);
      }
      return ins.rows[0].id;
    });
    await audit(req, 'create', 'shipments', id);
    res.status(201).json({ id });
  } catch (e) { next(e.code === '23505' ? new HttpError(409, 'Shipment number already exists') : e); }
});

// Goods receipt by the buyer: posts quantities to PO lines and inventory
r.post('/shipments/:id/receive', requirePerm('shipments', 'a'), async (req, res, next) => {
  try {
    await tx(async (c) => {
      const params = [req.tenantId, req.params.id];
      const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, params);
      const s = (await c.query(`SELECT t.* FROM shipments t WHERE t.tenant_id=$1 AND t.id=$2 ${sc ? 'AND ' + sc : ''} FOR UPDATE`, params)).rows[0];
      if (!s) throw new HttpError(404, 'Shipment not found or not visible to you');
      if (s.status === 'delivered') throw new HttpError(409, 'Shipment already received');
      if (s.status === 'cancelled') throw new HttpError(409, 'Shipment was cancelled');
      const site = (await c.query('SELECT org_id FROM sites WHERE id=$1', [s.site_id])).rows[0];
      for (const l of (await c.query('SELECT * FROM shipment_lines WHERE shipment_id=$1', [s.id])).rows) {
        await c.query('UPDATE po_lines SET qty_received = qty_received + $2 WHERE id=$1', [l.po_line_id, l.qty]);
        await c.query(`INSERT INTO inventory_levels(tenant_id, org_id, site_id, part_id, on_hand) VALUES ($1,$2,$3,$4,$5)
                       ON CONFLICT (site_id, part_id) DO UPDATE SET on_hand = inventory_levels.on_hand + EXCLUDED.on_hand, updated_at = now()`, [req.tenantId, site.org_id, s.site_id, l.part_id, l.qty]);
        await c.query(`INSERT INTO inventory_transactions(tenant_id, site_id, part_id, kind, qty, ref, user_id) VALUES ($1,$2,$3,'receipt',$4,$5,$6)`, [req.tenantId, s.site_id, l.part_id, l.qty, s.shipment_no, req.user.id]);
      }
      await c.query("UPDATE shipments SET status='delivered', delivered_on=$2 WHERE id=$1", [s.id, today()]);
      await c.query(`UPDATE purchase_orders SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM po_lines WHERE po_id=$1 AND qty_received < qty) THEN 'received' ELSE 'partial' END WHERE id=$1`, [s.po_id]);
    });
    await audit(req, 'approve', 'shipments', req.params.id, { action: 'receive' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ───── Inventory with risk classification ─────
async function inventoryRows(req) {
  const params = [req.tenantId];
  const sc = scopeClause({ type: 'site', col: 'site_id' }, req.ctx.scope, params, 'i');
  let extra = '';
  if (req.query.siteId) { params.push(req.query.siteId); extra += ` AND i.site_id = $${params.length}`; }
  const data = await rows(
    `WITH inc AS (
        SELECT po.site_id, pl.part_id, SUM(pl.qty - pl.qty_received) AS qty, MIN(pl.due_date) AS next_due
          FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
         WHERE po.tenant_id = $1 AND po.status IN ('open','partial') AND pl.qty_received < pl.qty GROUP BY 1,2),
      ship AS (
        SELECT s.site_id, sl.part_id, MIN(s.eta) AS next_eta, BOOL_OR(s.status = 'delayed' OR s.eta > pl.due_date) AS late
          FROM shipments s JOIN shipment_lines sl ON sl.shipment_id = s.id JOIN po_lines pl ON pl.id = sl.po_line_id
         WHERE s.tenant_id = $1 AND s.status IN ('planned','in_transit','delayed') GROUP BY 1,2),
      req AS (
        SELECT j.site_id, b.child_part_id AS part_id, SUM((j.qty_planned - j.qty_done) * b.qty_per) AS qty
          FROM jobs j JOIN bom b ON b.parent_part_id = j.part_id WHERE j.tenant_id = $1 AND j.status IN ('open','running') GROUP BY 1,2)
     SELECT i.id, i.site_id, i.part_id, i.on_hand, i.safety_stock, i.reorder_point, i.avg_daily_usage, i.updated_at,
            p.part_no, p.name AS part_name, p.uom, p.part_type, s.name AS site_name, o.name AS org_name, o.type AS org_type,
            COALESCE(inc.qty,0) AS incoming_qty, inc.next_due, ship.next_eta, COALESCE(ship.late,false) AS late, COALESCE(req.qty,0) AS job_requirement,
            (SELECT MIN(lead_time_days) FROM supplier_parts WHERE part_id = i.part_id) AS lead_time_days
       FROM inventory_levels i JOIN parts p ON p.id = i.part_id JOIN sites s ON s.id = i.site_id JOIN organizations o ON o.id = i.org_id
       LEFT JOIN inc ON inc.site_id = i.site_id AND inc.part_id = i.part_id LEFT JOIN ship ON ship.site_id = i.site_id AND ship.part_id = i.part_id
       LEFT JOIN req ON req.site_id = i.site_id AND req.part_id = i.part_id
      WHERE i.tenant_id = $1 ${sc ? 'AND ' + sc : ''} ${extra} ORDER BY p.part_no, s.name`, params);

  return data.map((d) => {
    const usage = Number(d.avg_daily_usage) || 0;
    const daysCover = usage > 0 ? d.on_hand / usage : null;
    const projected = d.on_hand + d.incoming_qty - d.job_requirement;
    const reasons = [];
    let status = 'ok';
    const bump = (lvl, why) => { reasons.push(why); if (lvl === 'critical') status = 'critical'; else if (status === 'ok') status = 'warning'; };
    if (d.on_hand <= 0) bump('critical', 'Out of stock');
    else if (d.on_hand < d.safety_stock) bump('critical', 'Below safety stock');
    if (projected < 0) bump('critical', `Open jobs need ${Math.round(-projected)} more than on hand + incoming`);
    if (d.on_hand > 0 && d.on_hand >= d.safety_stock && d.on_hand <= d.reorder_point) bump('warning', 'At reorder point');
    if (daysCover != null && daysCover < 7 && d.on_hand > 0) bump(daysCover < 3 ? 'critical' : 'warning', `${daysCover.toFixed(1)} days of cover`);
    if (d.late) bump('warning', 'Inbound shipment delayed');
    return { ...d, days_cover: daysCover, projected, status, reasons };
  });
}

r.get('/inventory', requirePerm('inventory_levels', 'r'), async (req, res, next) => {
  try { res.json((await inventoryRows(req)).map((x) => stripHidden(req.ctx, 'inventory_levels', x))); } catch (e) { next(e); }
});

r.get('/summary', requirePerm('supply.dashboard', 'r'), async (req, res, next) => {
  try {
    const inv = await inventoryRows(req);
    const params = [req.tenantId];
    const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, params, 'po');
    const poScope = sc ? 'AND ' + sc : '';
    const open = await one(
      `SELECT COUNT(DISTINCT po.id) AS open_pos,
              COUNT(*) FILTER (WHERE pl.due_date < CURRENT_DATE) AS late_lines,
              COALESCE(SUM((pl.qty - pl.qty_received) * COALESCE(pl.unit_cost,0)),0) AS open_value
         FROM purchase_orders po JOIN po_lines pl ON pl.po_id = po.id WHERE po.tenant_id = $1 AND po.status IN ('open','partial') AND pl.qty_received < pl.qty ${poScope}`, params);
    const sparams = [req.tenantId];
    const ssc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, sparams, 's');
    const delayed = await rows(
      `SELECT s.id, s.shipment_no, s.status, s.eta, s.delay_reason, po.po_no, so.name AS supplier_name, st.name AS site_name,
              (SELECT MIN(pl.due_date) FROM shipment_lines sl JOIN po_lines pl ON pl.id = sl.po_line_id WHERE sl.shipment_id = s.id) AS po_due
         FROM shipments s JOIN purchase_orders po ON po.id = s.po_id JOIN organizations so ON so.id = s.supplier_org_id JOIN sites st ON st.id = s.site_id
        WHERE s.tenant_id = $1 AND s.status IN ('planned','in_transit','delayed') ${ssc ? 'AND ' + ssc : ''}
          AND (s.status = 'delayed' OR s.eta > (SELECT MIN(pl.due_date) FROM shipment_lines sl JOIN po_lines pl ON pl.id = sl.po_line_id WHERE sl.shipment_id = s.id))
        ORDER BY s.eta`, sparams);
    const inbound = await one(`SELECT COUNT(*) AS n FROM shipments s WHERE s.tenant_id=$1 AND s.status IN ('planned','in_transit','delayed') ${ssc ? 'AND ' + ssc : ''}`, sparams);
    const hideValue = req.ctx.fields.hidden.purchase_orders?.has('po_value');
    res.json({
      critical: inv.filter((i) => i.status === 'critical').length, warning: inv.filter((i) => i.status === 'warning').length, parts_tracked: inv.length,
      open_pos: Number(open.open_pos), late_po_lines: Number(open.late_lines), open_value: hideValue ? null : Number(open.open_value),
      inbound_shipments: Number(inbound.n), delayed_shipments: delayed,
      at_risk: inv.filter((i) => i.status !== 'ok').sort((a, b) => (a.status === b.status ? (a.days_cover ?? 999) - (b.days_cover ?? 999) : a.status === 'critical' ? -1 : 1)).slice(0, 12),
    });
  } catch (e) { next(e); }
});

// Supplier scorecard: on-time delivery, delays, open commitments (+ OEE if the supplier captures shop-floor data)
r.get('/suppliers', requirePerm('supply.dashboard', 'r'), async (req, res, next) => {
  try {
    const params = [req.tenantId];
    const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, params, 's');
    const data = await rows(
      `SELECT o.id, o.name, o.code,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'delivered' AND s.delivered_on >= CURRENT_DATE - 90) AS delivered_90d,
          COUNT(sl.id) FILTER (WHERE s.status = 'delivered' AND s.delivered_on >= CURRENT_DATE - 90 AND s.delivered_on <= pl.due_date) AS lines_on_time,
          COUNT(sl.id) FILTER (WHERE s.status = 'delivered' AND s.delivered_on >= CURRENT_DATE - 90) AS lines_total,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'delayed') AS delayed_now,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('planned','in_transit','delayed')) AS inbound,
          COALESCE(AVG(GREATEST(s.delivered_on - pl.due_date, 0)) FILTER (WHERE s.status = 'delivered' AND s.delivered_on >= CURRENT_DATE - 90),0) AS avg_days_late
         FROM organizations o LEFT JOIN shipments s ON s.supplier_org_id = o.id ${sc ? 'AND ' + sc : ''}
         LEFT JOIN shipment_lines sl ON sl.shipment_id = s.id LEFT JOIN po_lines pl ON pl.id = sl.po_line_id
        WHERE o.tenant_id = $1 AND o.type = 'supplier' ${req.ctx.scope.all ? '' : `AND o.id IN (SELECT supplier_org_id FROM purchase_orders po WHERE po.tenant_id = $1 AND ${scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, params, 'po')})`}
        GROUP BY o.id ORDER BY o.name`, params);
    res.json(data.map((d) => ({ ...d, otd: Number(d.lines_total) ? (Number(d.lines_on_time) / Number(d.lines_total)) * 100 : null, avg_days_late: Number(d.avg_days_late) })));
  } catch (e) { next(e); }
});

export default r;
