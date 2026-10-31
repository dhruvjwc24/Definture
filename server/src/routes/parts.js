import { Router } from 'express';
import { rows, tx } from '../db.js';
import { HttpError, requirePerm, can, audit, stripHidden } from '../security/auth.js';
import { scopeClause } from '../security/scope.js';

// Part lifecycle: the multi-level bill of materials with routing, sourcing, stock, jobs and recent
// production for every part in the structure, plus a small editor for the BOM itself.
const r = Router();
const WINDOW_DAYS = 30;
const MAX_DEPTH = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const external = (req) => req.user.org_type !== 'internal';
const checkId = (id) => { if (!UUID.test(id)) throw new HttpError(404, 'Part not found or not visible to you'); };

// Internal users see all parts (shared master data); suppliers only the parts they supply or produce
async function visibleParts(req, ids) {
  const params = [req.tenantId, ids];
  const sc = external(req) ? scopeClause({ type: 'parts' }, req.ctx.scope, params) : '';
  const found = await rows(`SELECT t.id FROM parts t WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[]) ${sc ? 'AND ' + sc : ''}`, params);
  return new Set(found.map((x) => x.id));
}

const group = (list, key) => list.reduce((m, x) => { (m.get(x[key]) || m.set(x[key], []).get(x[key])).push(x); return m; }, new Map());
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

r.get('/:id/lifecycle', requirePerm('parts', 'r'), async (req, res, next) => {
  try {
    const rootId = req.params.id;
    checkId(rootId);
    const T = req.tenantId;
    if (!(await visibleParts(req, [rootId])).has(rootId)) throw new HttpError(404, 'Part not found or not visible to you');

    // 1. Structure downwards (cycle-safe, depth-limited)
    const edgesAll = await rows(
      `WITH RECURSIVE t AS (
         SELECT b.parent_part_id, b.child_part_id, b.qty_per, b.operation_id, 1 AS depth, ARRAY[b.parent_part_id, b.child_part_id] AS path
           FROM bom b WHERE b.tenant_id = $1 AND b.parent_part_id = $2
         UNION ALL
         SELECT b.parent_part_id, b.child_part_id, b.qty_per, b.operation_id, t.depth + 1, t.path || b.child_part_id
           FROM bom b JOIN t ON b.parent_part_id = t.child_part_id
          WHERE b.tenant_id = $1 AND NOT b.child_part_id = ANY(t.path) AND t.depth < ${MAX_DEPTH})
       SELECT DISTINCT parent_part_id, child_part_id, qty_per, operation_id FROM t`, [T, rootId]);
    const wanted = [...new Set([rootId, ...edgesAll.flatMap((e) => [e.parent_part_id, e.child_part_id])])];
    const vis = await visibleParts(req, wanted);
    const edges = edgesAll.filter((e) => vis.has(e.parent_part_id) && vis.has(e.child_part_id));
    const ids = [...vis];
    const children = group(edges, 'parent_part_id');

    // 2. Facts per part, loaded in batches
    const partRows = new Map((await rows('SELECT id, part_no, name, part_type, uom, unit_cost FROM parts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, ids])).map((p) => [p.id, p]));

    const opParams = [T, ids];
    const opScope = external(req) ? scopeClause({ type: 'machine', col: 'machine_id' }, req.ctx.scope, opParams, 'o') : '';
    const ops = await rows(
      `SELECT o.id, o.part_id, o.seq, o.name, o.cycle_time_sec, o.manual_time_sec, o.operator_group, o.machine_id,
              m.code AS machine_code, m.name AS machine_name, l.name AS line_name, s.name AS site_name, org.name AS org_name
         FROM operations o JOIN machines m ON m.id = o.machine_id JOIN lines l ON l.id = m.line_id JOIN sites s ON s.id = m.site_id JOIN organizations org ON org.id = m.org_id
        WHERE o.tenant_id = $1 AND o.part_id = ANY($2::uuid[]) ${opScope ? 'AND ' + opScope : ''} ORDER BY o.part_id, o.seq`, opParams);

    // production over the last 30 days, restricted to the machines the user may see
    const prodParams = [T, ops.map((o) => o.id), WINDOW_DAYS];
    const prodScope = scopeClause({ type: 'machine', col: 'machine_id' }, req.ctx.scope, prodParams, 'v');
    const prod = new Map((await rows(
      `SELECT v.operation_id, SUM(v.good_count) AS good, SUM(v.rework_count) AS rework, SUM(v.scrap_count) AS scrap, SUM(v.total_count) AS total,
              SUM(v.planned_time_sec) AS planned, SUM(v.ideal_cycle_sec * v.good_count) AS ideal_good
         FROM v_log_metrics v WHERE v.tenant_id = $1 AND v.operation_id = ANY($2::uuid[]) AND v.log_date >= CURRENT_DATE - $3::int ${prodScope ? 'AND ' + prodScope : ''}
        GROUP BY v.operation_id`, prodParams)).map((p) => [p.operation_id, p]));
    for (const o of ops) {
      const p = prod.get(o.id);
      o.stats = p ? { good: Number(p.good), scrap: Number(p.scrap), rework: Number(p.rework), total: Number(p.total),
        scrap_rate: Number(p.total) > 0 ? Number(p.scrap) / Number(p.total) : null, planned: Number(p.planned), ideal_good: Number(p.ideal_good),
        oee: Number(p.planned) > 0 ? Number(p.ideal_good) / Number(p.planned) : null } : null;
    }
    const opsBy = group(ops, 'part_id');

    const spParams = [T, ids];
    const sourcing = group(await rows(
      `SELECT sp.part_id, sp.org_id, o.name AS org_name, sp.lead_time_days, sp.min_order_qty FROM supplier_parts sp JOIN organizations o ON o.id = sp.org_id
        WHERE sp.tenant_id = $1 AND sp.part_id = ANY($2::uuid[]) ${external(req) ? 'AND sp.org_id = ANY($3::uuid[])' : ''} ORDER BY o.name`,
      external(req) ? [...spParams, req.ctx.scope.orgs] : spParams), 'part_id');

    let poBy = new Map(); let shBy = new Map(); let invBy = new Map(); let jobBy = new Map();
    if (can(req.ctx, 'purchase_orders', 'r')) {
      const p = [T, ids]; const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, p, 'po');
      poBy = group(await rows(
        `SELECT pl.part_id, po.po_no, o.name AS supplier_name, s.name AS site_name, (pl.qty - pl.qty_received) AS open_qty, pl.due_date
           FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id JOIN organizations o ON o.id = po.supplier_org_id JOIN sites s ON s.id = po.site_id
          WHERE pl.tenant_id = $1 AND pl.part_id = ANY($2::uuid[]) AND po.status IN ('open','partial') AND pl.qty_received < pl.qty ${sc ? 'AND ' + sc : ''} ORDER BY pl.due_date`, p), 'part_id');
    }
    if (can(req.ctx, 'shipments', 'r')) {
      const p = [T, ids]; const sc = scopeClause({ type: 'site_or_supplier' }, req.ctx.scope, p, 'sh');
      shBy = group(await rows(
        `SELECT sl.part_id, sh.shipment_no, sh.status, sh.eta, sh.delay_reason, sl.qty, po.po_no, pl.due_date, s.name AS site_name
           FROM shipment_lines sl JOIN shipments sh ON sh.id = sl.shipment_id JOIN po_lines pl ON pl.id = sl.po_line_id JOIN purchase_orders po ON po.id = pl.po_id JOIN sites s ON s.id = sh.site_id
          WHERE sl.tenant_id = $1 AND sl.part_id = ANY($2::uuid[]) AND sh.status IN ('planned','in_transit','delayed') ${sc ? 'AND ' + sc : ''} ORDER BY sh.eta`, p), 'part_id');
    }
    if (can(req.ctx, 'inventory_levels', 'r')) {
      const p = [T, ids]; const sc = scopeClause({ type: 'site', col: 'site_id' }, req.ctx.scope, p, 'i');
      invBy = group((await rows(
        `SELECT i.part_id, s.name AS site_name, i.on_hand, i.safety_stock, i.reorder_point, i.avg_daily_usage
           FROM inventory_levels i JOIN sites s ON s.id = i.site_id WHERE i.tenant_id = $1 AND i.part_id = ANY($2::uuid[]) ${sc ? 'AND ' + sc : ''} ORDER BY s.name`, p))
        .map((x) => stripHidden(req.ctx, 'inventory_levels', x)), 'part_id');
    }
    if (can(req.ctx, 'jobs', 'r')) {
      const p = [T, ids]; const sc = scopeClause({ type: 'site', col: 'site_id' }, req.ctx.scope, p, 'j');
      jobBy = group(await rows(
        `SELECT j.id, j.part_id, j.job_no, j.status, j.qty_planned, j.qty_done, j.due_date, s.name AS site_name, l.name AS line_name
           FROM jobs j JOIN sites s ON s.id = j.site_id LEFT JOIN lines l ON l.id = j.line_id
          WHERE j.tenant_id = $1 AND j.part_id = ANY($2::uuid[]) AND j.status IN ('open','running') ${sc ? 'AND ' + sc : ''} ORDER BY j.due_date NULLS LAST`, p), 'part_id');
    }

    // 3. Assemble the nested structure
    const today = new Date().toISOString().slice(0, 10);
    const facts = (id) => {
      const opList = opsBy.get(id) || [];
      const st = opList.map((o) => o.stats).filter(Boolean);
      const last = [...opList].reverse().find((o) => o.stats);
      const inv = invBy.get(id) || [];
      const onHand = sum(inv, (x) => x.on_hand); const safety = sum(inv, (x) => x.safety_stock); const reorder = sum(inv, (x) => x.reorder_point);
      const usage = inv.some((x) => x.avg_daily_usage != null) ? sum(inv, (x) => x.avg_daily_usage) : null;
      const daysCover = usage > 0 ? onHand / usage : null;
      let stockStatus = 'ok';
      if (inv.length && (onHand < safety || (daysCover != null && daysCover < 3))) stockStatus = 'critical';
      else if (inv.length && (onHand <= reorder || (daysCover != null && daysCover < 7))) stockStatus = 'warning';
      const sh = shBy.get(id) || [];
      const jobs = jobBy.get(id) || [];
      const total = sum(st, (s) => s.total); const planned = sum(st, (s) => s.planned);
      return {
        operations: opList,
        suppliers: sourcing.get(id) || [], open_pos: poBy.get(id) || [], shipments: sh,
        inbound_late: sh.some((s) => s.status === 'delayed' || (s.due_date && s.eta && String(s.eta) > String(s.due_date))),
        stock: inv.length ? { on_hand: onHand, safety_stock: safety, days_cover: daysCover, status: stockStatus, sites: inv } : null,
        jobs,
        production: st.length ? { window_days: WINDOW_DAYS, output: last ? last.stats.good : null, scrap: sum(st, (s) => s.scrap),
          scrap_rate: total > 0 ? sum(st, (s) => s.scrap) / total : null, oee: planned > 0 ? sum(st, (s) => s.ideal_good) / planned : null } : null,
      };
    };
    const build = (id, qty, consumedAt, path) => {
      const p = stripHidden(req.ctx, 'parts', partRows.get(id));
      const kids = (children.get(id) || []).filter((e) => !path.includes(e.child_part_id));
      return { ...p, qty_per: qty, consumed_at: consumedAt, ...facts(id),
        children: kids.map((e) => build(e.child_part_id, Number(e.qty_per), e.operation_id, [...path, id])) };
    };
    const tree = build(rootId, 1, null, []);

    // 4. Where the root part is used (all levels upwards)
    const upIds = await rows(
      `WITH RECURSIVE u AS (
         SELECT parent_part_id, qty_per, 1 AS depth FROM bom WHERE tenant_id = $1 AND child_part_id = $2
         UNION ALL
         SELECT b.parent_part_id, b.qty_per, u.depth + 1 FROM bom b JOIN u ON b.child_part_id = u.parent_part_id WHERE b.tenant_id = $1 AND u.depth < ${MAX_DEPTH})
       SELECT parent_part_id AS id, MIN(depth) AS depth, MAX(CASE WHEN depth = 1 THEN qty_per END) AS qty_per FROM u GROUP BY parent_part_id`, [T, rootId]);
    const upVis = await visibleParts(req, upIds.map((u) => u.id));
    const upParts = new Map((await rows('SELECT id, part_no, name, part_type FROM parts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, upIds.map((u) => u.id)])).map((p) => [p.id, p]));
    const whereUsed = upIds.filter((u) => upVis.has(u.id)).map((u) => ({ ...upParts.get(u.id), depth: Number(u.depth), qty_per: u.qty_per == null ? null : Number(u.qty_per) }))
      .sort((a, b) => a.depth - b.depth || a.part_no.localeCompare(b.part_no));

    res.json({ generated_for: today, window_days: WINDOW_DAYS, tree, where_used: whereUsed });
  } catch (e) { next(e); }
});

// ───── Bill of materials editor: one component line of a parent part ─────
r.put('/:id/bom/:childId', requirePerm('parts', 'e'), async (req, res, next) => {
  try {
    const { id: parentId, childId } = req.params;
    checkId(parentId); checkId(childId);
    if (external(req)) throw new HttpError(403, 'External users cannot change the bill of materials');
    if (parentId === childId) throw new HttpError(400, 'A part cannot be a component of itself');
    const b = req.body || {};
    const qty = Number(b.qty_per ?? 1);
    if (!(qty > 0)) throw new HttpError(400, 'Quantity per must be greater than zero');
    const opId = b.operation_id || null;
    await tx(async (c) => {
      const found = (await c.query('SELECT id FROM parts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [req.tenantId, [parentId, childId]])).rows;
      if (found.length !== 2) throw new HttpError(404, 'Part not found');
      const loop = (await c.query(
        `WITH RECURSIVE d AS (
           SELECT child_part_id FROM bom WHERE tenant_id = $1 AND parent_part_id = $2
           UNION SELECT b.child_part_id FROM bom b JOIN d ON b.parent_part_id = d.child_part_id WHERE b.tenant_id = $1)
         SELECT 1 FROM d WHERE child_part_id = $3`, [req.tenantId, childId, parentId])).rows[0];
      if (loop) throw new HttpError(400, 'That would make the part contain itself (circular structure)');
      if (opId && !(await c.query('SELECT 1 FROM operations WHERE id = $1 AND part_id = $2 AND tenant_id = $3', [opId, parentId, req.tenantId])).rows[0])
        throw new HttpError(400, 'The operation must belong to the parent part');
      await c.query(
        `INSERT INTO bom(tenant_id, parent_part_id, child_part_id, qty_per, operation_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (parent_part_id, child_part_id) DO UPDATE SET qty_per = EXCLUDED.qty_per, operation_id = EXCLUDED.operation_id`,
        [req.tenantId, parentId, childId, qty, opId]);
    });
    await audit(req, 'update', 'parts', parentId, { bom: { child: childId, qty_per: qty, operation_id: opId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.delete('/:id/bom/:childId', requirePerm('parts', 'e'), async (req, res, next) => {
  try {
    const { id: parentId, childId } = req.params;
    checkId(parentId); checkId(childId);
    if (external(req)) throw new HttpError(403, 'External users cannot change the bill of materials');
    await rows('DELETE FROM bom WHERE tenant_id = $1 AND parent_part_id = $2 AND child_part_id = $3', [req.tenantId, parentId, childId]);
    await audit(req, 'update', 'parts', parentId, { bom_removed: childId });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default r;
