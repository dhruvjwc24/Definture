import { Router } from 'express';
import { rows, one } from '../db.js';
import { HttpError, requirePerm, can } from '../security/auth.js';

const r = Router();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;

// Shared filter builder: date range + record scope + optional site/line/machine/org/shift filters.
function filters(req, { from, to } = {}) {
  const f = from || req.query.from || addDays(iso(new Date()), -29);
  const t = to || req.query.to || iso(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new HttpError(400, 'from/to must be YYYY-MM-DD');
  const params = [req.tenantId, f, t];
  const where = ['v.tenant_id = $1', 'v.log_date BETWEEN $2 AND $3'];
  if (!req.ctx.scope.all) { params.push(req.ctx.scope.machines); where.push(`v.machine_id = ANY($${params.length}::uuid[])`); }
  for (const [q, col] of [['siteId', 'site_id'], ['lineId', 'line_id'], ['machineId', 'machine_id'], ['orgId', 'org_id'], ['shiftId', 'shift_id']]) {
    if (req.query[q]) { params.push(req.query[q]); where.push(`v.${col} = $${params.length}`); }
  }
  if (req.query.approvedOnly === '1') where.push("v.status = 'approved'");
  return { params, where: where.join(' AND '), from: f, to: t };
}

const AGG = `COUNT(*) AS logs, SUM(v.planned_time_sec) AS planned, SUM(v.downtime_sec) AS downtime, SUM(v.planned_stop_sec) AS planned_stops,
  SUM(v.total_count) AS total, SUM(v.good_count) AS good, SUM(v.scrap_count) AS scrap, SUM(v.rework_count) AS rework, SUM(v.total_count * v.ideal_cycle_sec) AS ideal_time`;

// Turn raw sums into Availability / Performance / Quality / OEE (+ time-loss breakdown)
export function finish(a) {
  const n = (x) => Number(x) || 0;
  const planned = n(a.planned), downtime = n(a.downtime), total = n(a.total), good = n(a.good), idealTime = n(a.ideal_time);
  const run = Math.max(planned - downtime, 0);
  const av = planned > 0 ? run / planned : null;
  const pf = run > 0 ? Math.min(idealTime / run, 1) : null;
  const ql = total > 0 ? good / total : null;
  const oee = av != null && pf != null && ql != null ? av * pf * ql : null;
  const valuedTime = Math.min(idealTime, run);
  return {
    logs: n(a.logs), planned_sec: planned, downtime_sec: downtime, run_sec: run, total, good, scrap: n(a.scrap), rework: n(a.rework),
    availability: av, performance: pf, quality: ql, oee,
    scrap_rate: total > 0 ? n(a.scrap) / total : null, rework_rate: total > 0 ? n(a.rework) / total : null,
    ideal_output: idealTime > 0 && run > 0 ? run / (idealTime / total) : null,
    loss: { planned, downtime, speed: Math.max(run - valuedTime, 0), quality: total > 0 ? valuedTime * (1 - good / total) : 0, productive: total > 0 ? valuedTime * (good / total) : 0 },
  };
}

const feature = (...keys) => (req, res, next) =>
  keys.some((k) => can(req.ctx, k, 'r')) ? next() : next(new HttpError(403, 'You do not have access to this dashboard or report'));
const anyDash = feature('dashboard.executive', 'dashboard.plant', 'report.oee', 'report.quality', 'report.downtime', 'supply.dashboard');

r.get('/summary', anyDash, async (req, res, next) => {
  try {
    const f = filters(req);
    const cur = await one(`SELECT ${AGG} FROM v_log_metrics v WHERE ${f.where}`, f.params);
    const len = daysBetween(f.from, f.to);
    const pf = filters(req, { from: addDays(f.from, -len), to: addDays(f.from, -1) });
    const prev = await one(`SELECT ${AGG} FROM v_log_metrics v WHERE ${pf.where}`, pf.params);
    res.json({ from: f.from, to: f.to, current: finish(cur), previous: finish(prev) });
  } catch (e) { next(e); }
});

r.get('/trend', anyDash, async (req, res, next) => {
  try {
    const f = filters(req);
    const data = await rows(`SELECT v.log_date AS date, ${AGG} FROM v_log_metrics v WHERE ${f.where} GROUP BY v.log_date ORDER BY v.log_date`, f.params);
    res.json(data.map((d) => ({ date: d.date, ...finish(d) })));
  } catch (e) { next(e); }
});

const GROUPS = {
  site: { id: 'v.site_id', join: 'JOIN sites g ON g.id = v.site_id', name: 'g.name' },
  line: { id: 'v.line_id', join: 'JOIN lines g ON g.id = v.line_id', name: "g.name" },
  org: { id: 'v.org_id', join: 'JOIN organizations g ON g.id = v.org_id', name: 'g.name' },
  shift: { id: 'v.shift_id', join: 'LEFT JOIN shifts g ON g.id = v.shift_id', name: "COALESCE(g.name,'Unassigned')" },
};
r.get('/groups', anyDash, async (req, res, next) => {
  try {
    const g = GROUPS[req.query.by || 'site'];
    if (!g) throw new HttpError(400, 'by must be site, line, org or shift');
    const f = filters(req);
    const data = await rows(`SELECT ${g.id} AS id, ${g.name} AS name, ${AGG} FROM v_log_metrics v ${g.join} WHERE ${f.where} GROUP BY ${g.id}, ${g.name} ORDER BY ${g.name}`, f.params);
    res.json(data.map((d) => ({ id: d.id, name: d.name, ...finish(d) })));
  } catch (e) { next(e); }
});

// Machine league table + constraint (bottleneck) detection per line
r.get('/machines', anyDash, async (req, res, next) => {
  try {
    const f = filters(req);
    const data = await rows(
      `SELECT v.machine_id AS id, m.name, m.code, m.station_no, m.machine_type, ln.id AS line_id, ln.name AS line_name, ln.takt_sec, s.name AS site_name, o.name AS org_name,
              (SELECT MAX(cycle_time_sec) FROM operations WHERE machine_id = v.machine_id) AS cycle_time_sec, ${AGG}
         FROM v_log_metrics v JOIN machines m ON m.id = v.machine_id JOIN lines ln ON ln.id = m.line_id JOIN sites s ON s.id = m.site_id JOIN organizations o ON o.id = m.org_id
        WHERE ${f.where} GROUP BY v.machine_id, m.name, m.code, m.station_no, m.machine_type, ln.id, ln.name, ln.takt_sec, s.name, o.name ORDER BY ln.name, m.station_no`, f.params);
    const out = data.map((d) => ({ ...d, ...finish(d) }));
    // Constraint = slowest station on its line; ties broken by lowest OEE. "worst" = lowest OEE on the line.
    const byLine = {};
    for (const m of out) (byLine[m.line_id] ||= []).push(m);
    for (const list of Object.values(byLine)) {
      const c = [...list].sort((a, b) => (b.cycle_time_sec || 0) - (a.cycle_time_sec || 0) || (a.oee ?? 1) - (b.oee ?? 1))[0];
      const w = [...list].sort((a, b) => (a.oee ?? 1) - (b.oee ?? 1))[0];
      list.forEach((m) => { m.is_constraint = m === c && list.length > 1; m.is_worst_oee = m === w && list.length > 1; });
    }
    res.json(out);
  } catch (e) { next(e); }
});

function pareto(items, key) {
  const total = items.reduce((s, i) => s + i[key], 0);
  let run = 0;
  return items.map((i) => { run += i[key]; return { ...i, cumulative_pct: total ? (run / total) * 100 : 0 }; });
}

r.get('/downtime-pareto', feature('report.downtime', 'dashboard.executive', 'dashboard.plant'), async (req, res, next) => {
  try {
    const f = filters(req);
    const data = await rows(
      `SELECT rc.id, rc.name AS reason, rc.category, rc.planned, SUM(e.duration_sec) AS seconds, COUNT(*) AS events
         FROM downtime_events e JOIN v_log_metrics v ON v.log_id = e.log_id JOIN reason_codes rc ON rc.id = e.reason_id
        WHERE ${f.where} ${req.query.unplannedOnly === '1' ? 'AND NOT rc.planned' : ''} GROUP BY rc.id ORDER BY seconds DESC`, f.params);
    res.json(pareto(data.map((d) => ({ ...d, seconds: Number(d.seconds), events: Number(d.events) })), 'seconds'));
  } catch (e) { next(e); }
});

r.get('/scrap-pareto', feature('report.quality', 'dashboard.executive', 'dashboard.plant'), async (req, res, next) => {
  try {
    const f = filters(req);
    const data = await rows(
      `SELECT rc.id, rc.name AS reason, SUM(e.qty) AS qty FROM scrap_events e JOIN v_log_metrics v ON v.log_id = e.log_id JOIN reason_codes rc ON rc.id = e.reason_id
        WHERE ${f.where} GROUP BY rc.id ORDER BY qty DESC`, f.params);
    res.json(pareto(data.map((d) => ({ ...d, qty: Number(d.qty) })), 'qty'));
  } catch (e) { next(e); }
});

// Quality report detail table: Machine, Operation, Scrap Count, Scrap Reason, Operator Notes
r.get('/rejects', feature('report.quality'), async (req, res, next) => {
  try {
    const f = filters(req);
    const params = [...f.params];
    let extra = '';
    if (req.query.reasonId) { params.push(req.query.reasonId); extra = `AND e.reason_id = $${params.length}`; }
    const data = await rows(
      `SELECT e.id, v.log_date, m.name AS machine_name, ln.name AS line_name, COALESCE(op.name,'—') AS operation, e.qty AS scrap_count, rc.name AS scrap_reason,
              COALESCE(e.notes,'') AS operator_notes, u.full_name AS operator, j.job_no
         FROM scrap_events e JOIN v_log_metrics v ON v.log_id = e.log_id JOIN production_logs l ON l.id = e.log_id JOIN machines m ON m.id = v.machine_id
         JOIN lines ln ON ln.id = m.line_id JOIN reason_codes rc ON rc.id = e.reason_id LEFT JOIN operations op ON op.id = l.operation_id
         LEFT JOIN users u ON u.id = l.operator_id LEFT JOIN jobs j ON j.id = l.job_id
        WHERE ${f.where} ${extra} ORDER BY v.log_date DESC, e.qty DESC LIMIT 500`, params);
    res.json(data);
  } catch (e) { next(e); }
});

// Yamazumi / line balance: operator work content per station vs takt
r.get('/line-balance', feature('report.balance'), async (req, res, next) => {
  try {
    const params = [req.tenantId];
    let lineCond = '';
    if (req.query.lineId) { params.push(req.query.lineId); lineCond = `AND m.line_id = $${params.length}`; }
    let scopeCond = '';
    if (!req.ctx.scope.all) { params.push(req.ctx.scope.machines); scopeCond = `AND m.id = ANY($${params.length}::uuid[])`; }
    let partCond = '';
    if (req.query.partId) { params.push(req.query.partId); partCond = `AND op.part_id = $${params.length}`; }
    const ops = await rows(
      `SELECT op.id, op.seq, op.name, op.cycle_time_sec, op.manual_time_sec, COALESCE(op.operator_group,'—') AS operator_group, m.name AS machine_name, m.station_no,
              ln.id AS line_id, ln.name AS line_name, ln.takt_sec, p.name AS part_name, p.part_no
         FROM operations op JOIN machines m ON m.id = op.machine_id JOIN lines ln ON ln.id = m.line_id JOIN parts p ON p.id = op.part_id
        WHERE op.tenant_id = $1 ${lineCond} ${scopeCond} ${partCond}
        ORDER BY ln.name, op.seq`, params);
    if (!ops.length) return res.json({ lines: [] });
    const lines = {};
    for (const o of ops) (lines[o.line_id] ||= { line_id: o.line_id, line_name: o.line_name, takt_sec: o.takt_sec, part: `${o.part_no} ${o.part_name}`, operations: [] }).operations.push(o);
    const out = Object.values(lines).map((l) => {
      const groups = {};
      for (const o of l.operations) {
        const g = (groups[o.operator_group] ||= { group: o.operator_group, total: 0, items: [] });
        g.total += Number(o.manual_time_sec); g.items.push({ name: o.name, sec: Number(o.manual_time_sec), seq: o.seq });
      }
      const total = l.operations.reduce((s, o) => s + Number(o.manual_time_sec), 0);
      const slowest = [...l.operations].sort((a, b) => b.cycle_time_sec - a.cycle_time_sec)[0];
      return { ...l, operators: Object.values(groups), total_work_sec: total, min_operators: l.takt_sec ? Math.ceil(total / l.takt_sec) : null,
        constraint: { name: slowest.name, machine: slowest.machine_name, cycle_time_sec: slowest.cycle_time_sec } };
    });
    res.json({ lines: out });
  } catch (e) { next(e); }
});

export default r;
