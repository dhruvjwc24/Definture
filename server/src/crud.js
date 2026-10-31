import { Router } from 'express';
import { one, rows, query } from './db.js';
import { HttpError, requirePerm, stripHidden, stripUnwritable, audit } from './security/auth.js';
import { scopeClause, inScope } from './security/scope.js';
import { ENTITIES } from './entities.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_KEY = { site: 'site', line: 'line', machine: 'machine', org: 'org' };

function coerce(col, v) {
  if (v === '' || v === undefined || v === null) return null;
  switch (col.t) {
    case 'num': case 'int': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new HttpError(400, `${col.n} must be a number`);
      return col.t === 'int' ? Math.trunc(n) : n;
    }
    case 'bool': return v === true || v === 'true' || v === 1;
    case 'uuid': if (!UUID.test(v)) throw new HttpError(400, `${col.n} is not a valid id`); return v;
    case 'enum': if (!col.values.includes(v)) throw new HttpError(400, `${col.n} must be one of ${col.values.join(', ')}`); return v;
    case 'date': if (!/^\d{4}-\d{2}-\d{2}/.test(v)) throw new HttpError(400, `${col.n} must be a date`); return String(v).slice(0, 10);
    case 'json': return JSON.stringify(v);
    default: return String(v).trim();
  }
}

// Validate/normalise the tenant-defined `custom` object against custom_fields definitions
export async function cleanCustom(tenantId, entity, input, existing = {}) {
  const defs = await rows('SELECT key, type, options, required, label FROM custom_fields WHERE tenant_id=$1 AND entity=$2', [tenantId, entity]);
  const out = { ...existing };
  for (const d of defs) {
    let v = input?.[d.key];
    if (v === undefined) { if (d.required && out[d.key] == null) throw new HttpError(400, `${d.label} is required`); continue; }
    if (v === '' || v === null) { if (d.required) throw new HttpError(400, `${d.label} is required`); delete out[d.key]; continue; }
    if (d.type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw new HttpError(400, `${d.label} must be a number`); }
    else if (d.type === 'boolean') v = v === true || v === 'true';
    else if (d.type === 'select' && Array.isArray(d.options) && !d.options.includes(v)) throw new HttpError(400, `${d.label} must be one of ${d.options.join(', ')}`);
    else v = String(v);
    out[d.key] = v;
  }
  return out;
}

export function crudRouter() {
  const r = Router();

  const load = (req, _res, next) => {
    const ent = ENTITIES[req.params.entity];
    if (!ent) return next(new HttpError(404, 'Unknown entity'));
    req.ent = ent;
    next();
  };
  const guard = (action) => (req, res, next) => requirePerm(req.ent.perm, action)(req, res, next);

  // Scope rule only applies to every user unless entity is marked external-only (shared master data)
  const rule = (req) => {
    const e = req.ent;
    if (!e.scope) return null;
    if (e.scopeExternalOnly && req.user.org_type === 'internal') return null;
    return e.scope;
  };

  const selectSql = (e) => `SELECT t.*${e.extra ? ', ' + e.extra : ''} FROM ${e.table} t ${e.joins || ''}`;

  async function visibleRow(req, id) {
    const params = [req.tenantId, id];
    const sc = scopeClause(rule(req), req.ctx.scope, params);
    const row = await one(`${selectSql(req.ent)} WHERE t.tenant_id = $1 AND t.id = $2 ${sc ? 'AND ' + sc : ''}`, params);
    if (!row) throw new HttpError(404, 'Record not found or not visible to you');
    return row;
  }

  r.get('/:entity', load, guard('r'), async (req, res, next) => {
    try {
      const e = req.ent;
      const params = [req.tenantId];
      const where = ['t.tenant_id = $1'];
      const sc = scopeClause(rule(req), req.ctx.scope, params);
      if (sc) where.push(sc);
      for (const f of e.filters || []) {
        if (req.query[f] !== undefined && req.query[f] !== '') { params.push(req.query[f]); where.push(`t.${f}::text = $${params.length}::text`); }
      }
      if (req.query.q) { params.push(`%${req.query.q}%`); where.push('(' + e.search.map((c) => `${c} ILIKE $${params.length}`).join(' OR ') + ')'); }
      const limit = Math.min(Number(req.query.limit) || 500, 2000);
      const data = await rows(`${selectSql(e)} WHERE ${where.join(' AND ')} ORDER BY ${e.order} LIMIT ${limit}`, params);
      res.json(data.map((x) => stripHidden(req.ctx, e.perm, x)));
    } catch (err) { next(err); }
  });

  r.get('/:entity/:id', load, guard('r'), async (req, res, next) => {
    try { res.json(stripHidden(req.ctx, req.ent.perm, await visibleRow(req, req.params.id))); } catch (err) { next(err); }
  });

  // derive() mutates its argument; run it on a merged copy and keep only the derived keys
  async function withDerived(req, data, existing) {
    const e = req.ent;
    if (!e.derive) return data;
    const merged = { ...(existing || {}), ...data };
    await e.derive(merged, { one });
    const out = { ...data };
    for (const k of ['org_id', 'site_id', 'supplier_org_id', 'updated_at']) if (merged[k] !== undefined && merged[k] !== (existing || {})[k]) out[k] = merged[k];
    return out;
  }

  async function validateOnly(req, existing) {
    const e = req.ent;
    const body = stripUnwritable(req.ctx, e.perm, req.body || {});
    const data = {};
    for (const col of e.cols) {
      if (body[col.n] === undefined) { if (!existing && col.req) throw new HttpError(400, `${col.n.replace(/_/g, ' ')} is required`); continue; }
      const v = coerce(col, body[col.n]);
      if (col.req && v === null) throw new HttpError(400, `${col.n.replace(/_/g, ' ')} is required`);
      if (v !== null && col.ref) {
        if (!(await one(`SELECT 1 FROM ${col.ref} WHERE id=$1 AND tenant_id=$2`, [v, req.tenantId]))) throw new HttpError(400, `${col.n} refers to an unknown record`);
      }
      if (v !== null && col.scopeKind && !inScope(req.ctx.scope, SCOPE_KEY[col.scopeKind], v)) throw new HttpError(403, `You cannot work with that ${col.n.replace(/_id$/, '')}`);
      data[col.n] = v;
    }
    if (!e.noCustom && (body.custom !== undefined || !existing)) data.custom = JSON.stringify(await cleanCustom(req.tenantId, e.table, body.custom, existing?.custom));
    return withDerived(req, data, existing);
  }

  function dbError(err) {
    if (err.code === '23505') return new HttpError(409, 'A record with the same unique value already exists');
    if (err.code === '23503') return new HttpError(409, 'This record is referenced by other data and cannot be changed or removed');
    if (err.code === '23514') return new HttpError(400, 'A value violates a data rule');
    return err;
  }

  r.post('/:entity', load, guard('c'), async (req, res, next) => {
    try {
      const data = await validateOnly(req, null);
      data.tenant_id = req.tenantId;
      const keys = Object.keys(data);
      const created = await one(`INSERT INTO ${req.ent.table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, keys.map((k) => data[k]));
      await audit(req, 'create', req.ent.table, created.id, { name: data.name || data.code || data.po_no || data.job_no });
      res.status(201).json(stripHidden(req.ctx, req.ent.perm, await visibleRow(req, created.id)));
    } catch (err) { next(dbError(err)); }
  });

  r.put('/:entity/:id', load, guard('e'), async (req, res, next) => {
    try {
      const existing = await visibleRow(req, req.params.id);
      const data = await validateOnly(req, existing);
      const keys = Object.keys(data);
      if (keys.length) {
        await query(`UPDATE ${req.ent.table} SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId, ...keys.map((k) => data[k])]);
      }
      await audit(req, 'update', req.ent.table, req.params.id, { fields: keys });
      res.json(stripHidden(req.ctx, req.ent.perm, await visibleRow(req, req.params.id)));
    } catch (err) { next(dbError(err)); }
  });

  r.delete('/:entity/:id', load, guard('d'), async (req, res, next) => {
    try {
      await visibleRow(req, req.params.id);
      await query(`DELETE FROM ${req.ent.table} WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId]);
      await audit(req, 'delete', req.ent.table, req.params.id);
      res.status(204).end();
    } catch (err) { next(dbError(err)); }
  });

  return r;
}
