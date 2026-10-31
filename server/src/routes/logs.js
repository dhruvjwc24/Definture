import { Router } from 'express';
import { one, rows, tx } from '../db.js';
import { HttpError, requirePerm, can, audit, stripHidden } from '../security/auth.js';
import { scopeClause, inScope } from '../security/scope.js';
import { cleanCustom } from '../crud.js';

const r = Router();
const num = (v, name, { min = 0, req = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (req) throw new HttpError(400, `${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new HttpError(400, `${name} must be a number >= ${min}`);
  return n;
};

const LIST_SQL = `
  SELECT l.id, l.log_date, l.status, l.good_count, l.rework_count, l.planned_time_sec, l.ideal_cycle_sec, l.notes, l.machine_id, l.operation_id, l.job_id, l.shift_id, l.operator_id,
         m.name AS machine_name, m.code AS machine_code, ln.name AS line_name, ln.id AS line_id, s.name AS site_name,
         op.name AS operation_name, j.job_no, pt.part_no, pt.name AS part_name, sh.name AS shift_name, u.full_name AS operator_name, ap.full_name AS approved_by_name,
         COALESCE((SELECT SUM(qty) FROM scrap_events WHERE log_id = l.id),0) AS scrap_count,
         COALESCE((SELECT SUM(duration_sec) FROM downtime_events WHERE log_id = l.id),0) AS downtime_sec
    FROM production_logs l
    JOIN machines m ON m.id = l.machine_id JOIN lines ln ON ln.id = m.line_id JOIN sites s ON s.id = m.site_id
    LEFT JOIN operations op ON op.id = l.operation_id LEFT JOIN jobs j ON j.id = l.job_id LEFT JOIN parts pt ON pt.id = COALESCE(j.part_id, op.part_id) LEFT JOIN shifts sh ON sh.id = l.shift_id
    LEFT JOIN users u ON u.id = l.operator_id LEFT JOIN users ap ON ap.id = l.approved_by`;

async function getLog(req, id) {
  const params = [req.tenantId, id];
  const sc = scopeClause({ type: 'machine', col: 'machine_id' }, req.ctx.scope, params, 'l');
  const log = await one(`${LIST_SQL} WHERE l.tenant_id = $1 AND l.id = $2 ${sc ? 'AND ' + sc : ''}`, params);
  if (!log) throw new HttpError(404, 'Log not found or not visible to you');
  return log;
}

// Operators may only touch their own logs; approvers (lead/supervisor/...) may touch any log in scope
function assertCanModify(req, log) {
  if (can(req.ctx, 'production_logs', 'a')) return;
  if (log.operator_id !== req.user.id) throw new HttpError(403, 'You can only change logs you entered');
  if (log.status === 'approved') throw new HttpError(403, 'Approved logs are locked; ask your lead to reopen');
}

async function validateEvents(req, c, body) {
  const down = [], scrap = [];
  for (const d of body.downtime || []) {
    const reason = await c.query("SELECT id FROM reason_codes WHERE id=$1 AND tenant_id=$2 AND kind='downtime'", [d.reason_id, req.tenantId]);
    if (!reason.rows[0]) throw new HttpError(400, 'Unknown downtime reason');
    down.push({ reason_id: d.reason_id, duration_sec: num(d.duration_sec ?? (d.duration_min != null ? d.duration_min * 60 : null), 'Downtime duration', { min: 1, req: true }), notes: d.notes || null });
  }
  for (const s of body.scrap || []) {
    const reason = await c.query("SELECT id FROM reason_codes WHERE id=$1 AND tenant_id=$2 AND kind='scrap'", [s.reason_id, req.tenantId]);
    if (!reason.rows[0]) throw new HttpError(400, 'Unknown scrap reason');
    scrap.push({ reason_id: s.reason_id, qty: num(s.qty, 'Scrap quantity', { min: 1, req: true }), notes: s.notes || null });
  }
  return { down, scrap };
}

async function writeEvents(c, req, logId, { down, scrap }) {
  await c.query('DELETE FROM downtime_events WHERE log_id=$1', [logId]);
  await c.query('DELETE FROM scrap_events WHERE log_id=$1', [logId]);
  for (const d of down) await c.query('INSERT INTO downtime_events(tenant_id, log_id, reason_id, duration_sec, notes) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, logId, d.reason_id, d.duration_sec, d.notes]);
  for (const s of scrap) await c.query('INSERT INTO scrap_events(tenant_id, log_id, reason_id, qty, notes) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, logId, s.reason_id, s.qty, s.notes]);
}

// Resolve planned time and ideal cycle defaults from shift / operation / line
async function defaults(req, c, b) {
  const machine = await c.query('SELECT m.id, m.line_id, l.paced, l.takt_sec FROM machines m JOIN lines l ON l.id = m.line_id WHERE m.id=$1 AND m.tenant_id=$2', [b.machine_id, req.tenantId]);
  const m = machine.rows[0];
  if (!m) throw new HttpError(400, 'Unknown machine');
  if (!inScope(req.ctx.scope, 'machine', m.id)) throw new HttpError(403, 'You do not have access to that machine');

  let op = null;
  if (b.operation_id) {
    op = (await c.query('SELECT id, cycle_time_sec FROM operations WHERE id=$1 AND tenant_id=$2 AND machine_id=$3', [b.operation_id, req.tenantId, m.id])).rows[0];
    if (!op) throw new HttpError(400, 'That operation does not run on the selected machine');
  }
  if (b.job_id && !(await c.query('SELECT 1 FROM jobs WHERE id=$1 AND tenant_id=$2', [b.job_id, req.tenantId])).rows[0]) throw new HttpError(400, 'Unknown job');

  let planned = num(b.planned_time_sec, 'Planned time');
  if (planned == null && b.shift_id) {
    const sh = (await c.query(`SELECT EXTRACT(EPOCH FROM (CASE WHEN end_time > start_time THEN end_time - start_time ELSE end_time - start_time + interval '24 hours' END)) AS secs, planned_break_min
                                 FROM shifts WHERE id=$1 AND tenant_id=$2`, [b.shift_id, req.tenantId])).rows[0];
    if (!sh) throw new HttpError(400, 'Unknown shift');
    planned = Number(sh.secs) - sh.planned_break_min * 60;
  }
  if (planned == null) throw new HttpError(400, 'Choose a shift or enter planned time');

  let ideal = num(b.ideal_cycle_sec, 'Ideal cycle time');
  if (ideal == null) {
    if (!op) throw new HttpError(400, 'Choose an operation or enter the ideal cycle time');
    // Paced lines run at takt: the ideal cycle is the slower of station cycle time and takt
    ideal = m.paced && m.takt_sec ? Math.max(Number(op.cycle_time_sec), Number(m.takt_sec)) : Number(op.cycle_time_sec);
  }
  return { planned, ideal };
}

r.get('/', requirePerm('production_logs', 'r'), async (req, res, next) => {
  try {
    const params = [req.tenantId];
    const where = ['l.tenant_id = $1'];
    const sc = scopeClause({ type: 'machine', col: 'machine_id' }, req.ctx.scope, params, 'l');
    if (sc) where.push(sc);
    const add = (cond, v) => { params.push(v); where.push(cond.replace('?', '$' + params.length)); };
    if (req.query.from) add('l.log_date >= ?', req.query.from);
    if (req.query.to) add('l.log_date <= ?', req.query.to);
    if (req.query.machine_id) add('l.machine_id = ?', req.query.machine_id);
    if (req.query.line_id) add('m.line_id = ?', req.query.line_id);
    if (req.query.status) add('l.status = ?', req.query.status);
    if (req.query.mine === '1') add('l.operator_id = ?', req.user.id);
    const data = await rows(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY l.log_date DESC, l.created_at DESC LIMIT 300`, params);
    res.json(data.map((x) => stripHidden(req.ctx, 'production_logs', x)));
  } catch (e) { next(e); }
});

r.get('/:id', requirePerm('production_logs', 'r'), async (req, res, next) => {
  try {
    const log = await getLog(req, req.params.id);
    log.downtime = await rows(`SELECT e.id, e.reason_id, e.duration_sec, e.notes, rc.name AS reason, rc.planned FROM downtime_events e JOIN reason_codes rc ON rc.id = e.reason_id WHERE e.log_id=$1 ORDER BY e.duration_sec DESC`, [log.id]);
    log.scrap = await rows(`SELECT e.id, e.reason_id, e.qty, e.notes, rc.name AS reason FROM scrap_events e JOIN reason_codes rc ON rc.id = e.reason_id WHERE e.log_id=$1 ORDER BY e.qty DESC`, [log.id]);
    res.json(stripHidden(req.ctx, 'production_logs', log));
  } catch (e) { next(e); }
});

r.post('/', requirePerm('production_logs', 'c'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const id = await tx(async (c) => {
      const { planned, ideal } = await defaults(req, c, b);
      const events = await validateEvents(req, c, b);
      const approver = can(req.ctx, 'production_logs', 'a');
      const status = b.status === 'draft' ? 'draft' : approver ? 'approved' : 'submitted';
      const custom = await cleanCustom(req.tenantId, 'production_logs', b.custom);
      const ins = await c.query(
        `INSERT INTO production_logs(tenant_id, machine_id, operation_id, job_id, shift_id, log_date, planned_time_sec, ideal_cycle_sec, good_count, rework_count, status, operator_id, approved_by, approved_at, notes, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [req.tenantId, b.machine_id, b.operation_id || null, b.job_id || null, b.shift_id || null, b.log_date || new Date().toISOString().slice(0, 10), planned, ideal,
          num(b.good_count, 'Good count', { req: true }), num(b.rework_count, 'Rework count') ?? 0, status, req.user.id, status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null, b.notes || null, custom]);
      await writeEvents(c, req, ins.rows[0].id, events);
      return ins.rows[0].id;
    });
    await audit(req, 'create', 'production_logs', id);
    res.status(201).json(await getLog(req, id));
  } catch (e) { next(e); }
});

r.put('/:id', requirePerm('production_logs', 'e'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const existing = await getLog(req, req.params.id);
    assertCanModify(req, existing);
    await tx(async (c) => {
      const merged = { ...existing, ...b, machine_id: existing.machine_id };
      const { planned, ideal } = await defaults(req, c, { ...merged, planned_time_sec: b.planned_time_sec ?? existing.planned_time_sec, ideal_cycle_sec: b.ideal_cycle_sec ?? existing.ideal_cycle_sec });
      const approver = can(req.ctx, 'production_logs', 'a');
      const status = approver ? (existing.status === 'rejected' ? 'submitted' : existing.status) : 'submitted';
      await c.query(
        `UPDATE production_logs SET operation_id=$3, job_id=$4, shift_id=$5, log_date=$6, planned_time_sec=$7, ideal_cycle_sec=$8, good_count=$9, rework_count=$10, notes=$11, status=$12
          WHERE id=$1 AND tenant_id=$2`,
        [existing.id, req.tenantId, merged.operation_id || null, merged.job_id || null, merged.shift_id || null, merged.log_date, planned, ideal,
          num(merged.good_count, 'Good count', { req: true }), num(merged.rework_count, 'Rework count') ?? 0, merged.notes || null, status]);
      if (b.downtime || b.scrap) {
        const cur = { downtime: b.downtime ?? (await c.query('SELECT reason_id, duration_sec, notes FROM downtime_events WHERE log_id=$1', [existing.id])).rows, scrap: b.scrap ?? (await c.query('SELECT reason_id, qty, notes FROM scrap_events WHERE log_id=$1', [existing.id])).rows };
        await writeEvents(c, req, existing.id, await validateEvents(req, c, cur));
      }
    });
    await audit(req, 'update', 'production_logs', existing.id);
    res.json(await getLog(req, existing.id));
  } catch (e) { next(e); }
});

r.delete('/:id', requirePerm('production_logs', 'd'), async (req, res, next) => {
  try {
    const log = await getLog(req, req.params.id);
    assertCanModify(req, log);
    await rows('DELETE FROM production_logs WHERE id=$1 AND tenant_id=$2', [log.id, req.tenantId]);
    await audit(req, 'delete', 'production_logs', log.id);
    res.status(204).end();
  } catch (e) { next(e); }
});

for (const [verb, status] of [['approve', 'approved'], ['reject', 'rejected'], ['reopen', 'submitted']]) {
  r.post(`/:id/${verb}`, requirePerm('production_logs', 'a'), async (req, res, next) => {
    try {
      const log = await getLog(req, req.params.id);
      await rows('UPDATE production_logs SET status=$3, approved_by=$4, approved_at=now() WHERE id=$1 AND tenant_id=$2', [log.id, req.tenantId, status, status === 'submitted' ? null : req.user.id]);
      await audit(req, verb, 'production_logs', log.id, { note: req.body?.note });
      res.json(await getLog(req, log.id));
    } catch (e) { next(e); }
  });
}

export default r;
