import { Router } from 'express';
import { rows, one, query, tx } from '../db.js';
import { HttpError, requirePerm, audit, hashPassword, invalidateUser } from '../security/auth.js';
import { RESOURCES, SECURABLE_FIELDS } from '../security/resources.js';
import { createTenant } from '../tenants.js';
import { config } from '../config.js';

const r = Router();
// Delegated administration is Phase 2: only tenant-wide users may manage users/roles/settings
const tenantWide = (req, _res, next) => (req.ctx.scope.all ? next() : next(new HttpError(403, 'Only tenant-wide administrators can manage this')));

// ───── Users ─────
r.get('/users', requirePerm('users', 'r'), async (req, res, next) => {
  try {
    res.json(await rows(
      `SELECT u.id, u.email, u.full_name, u.title, u.active, u.last_login, u.org_id, u.role_id, o.name AS org_name, r.name AS role_name,
              COALESCE((SELECT json_agg(json_build_object('type', s.scope_type, 'id', s.scope_id)) FROM user_scopes s WHERE s.user_id = u.id), '[]') AS scopes
         FROM users u JOIN organizations o ON o.id = u.org_id JOIN roles r ON r.id = u.role_id WHERE u.tenant_id = $1 ORDER BY u.full_name`, [req.tenantId]));
  } catch (e) { next(e); }
});

async function saveUser(req, id) {
  const b = req.body || {};
  const scopes = Array.isArray(b.scopes) ? b.scopes : [];
  return tx(async (c) => {
    const chk = async (table, v) => (await c.query(`SELECT 1 FROM ${table} WHERE id=$1 AND tenant_id=$2`, [v, req.tenantId])).rows[0];
    if (b.org_id && !(await chk('organizations', b.org_id))) throw new HttpError(400, 'Unknown organization');
    if (b.role_id && !(await chk('roles', b.role_id))) throw new HttpError(400, 'Unknown role');
    let uid = id;
    if (!id) {
      if (!b.email || !b.full_name || !b.org_id || !b.role_id) throw new HttpError(400, 'Name, email, organization and role are required');
      if (!b.password || b.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      uid = (await c.query('INSERT INTO users(tenant_id, org_id, role_id, email, full_name, title, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [req.tenantId, b.org_id, b.role_id, b.email.trim(), b.full_name, b.title || null, await hashPassword(b.password)])).rows[0].id;
    } else {
      const cur = (await c.query('SELECT * FROM users WHERE id=$1 AND tenant_id=$2', [id, req.tenantId])).rows[0];
      if (!cur) throw new HttpError(404, 'User not found');
      if (id === req.user.id && b.active === false) throw new HttpError(400, 'You cannot deactivate yourself');
      await c.query('UPDATE users SET org_id=$3, role_id=$4, email=$5, full_name=$6, title=$7, active=$8 WHERE id=$1 AND tenant_id=$2',
        [id, req.tenantId, b.org_id ?? cur.org_id, b.role_id ?? cur.role_id, b.email ?? cur.email, b.full_name ?? cur.full_name, b.title ?? cur.title, b.active ?? cur.active]);
      if (b.password) {
        if (b.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
        await c.query('UPDATE users SET password_hash=$2 WHERE id=$1', [id, await hashPassword(b.password)]);
      }
    }
    if (Array.isArray(b.scopes)) {
      await c.query('DELETE FROM user_scopes WHERE user_id=$1', [uid]);
      const tables = { org: 'organizations', site: 'sites', line: 'lines', machine: 'machines', part: 'parts' };
      for (const s of scopes) {
        if (s.type === 'tenant') { await c.query("INSERT INTO user_scopes(user_id, scope_type, scope_id) VALUES ($1,'tenant',NULL)", [uid]); continue; }
        if (!tables[s.type] || !(await chk(tables[s.type], s.id))) throw new HttpError(400, `Invalid ${s.type} scope`);
        await c.query('INSERT INTO user_scopes(user_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [uid, s.type, s.id]);
      }
    }
    return uid;
  }).then((uid) => { invalidateUser(); return uid; });
}

r.post('/users', requirePerm('users', 'c'), tenantWide, async (req, res, next) => {
  try { const id = await saveUser(req, null); await audit(req, 'create', 'users', id, { email: req.body.email }); res.status(201).json({ id }); }
  catch (e) { next(e.code === '23505' ? new HttpError(409, 'A user with that email already exists') : e); }
});
r.put('/users/:id', requirePerm('users', 'e'), tenantWide, async (req, res, next) => {
  try { await saveUser(req, req.params.id); await audit(req, 'update', 'users', req.params.id); res.json({ ok: true }); }
  catch (e) { next(e.code === '23505' ? new HttpError(409, 'A user with that email already exists') : e); }
});

// ───── Roles, CRED matrix, field security ─────
r.get('/permission-catalog', requirePerm('roles', 'r'), (_req, res) => res.json({ resources: RESOURCES, securableFields: SECURABLE_FIELDS }));

r.get('/roles', requirePerm('roles', 'r'), async (req, res, next) => {
  try {
    const roles = await rows(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r WHERE r.tenant_id = $1 ORDER BY r.is_system DESC, r.name`, [req.tenantId]);
    const perms = await rows('SELECT p.* FROM role_permissions p JOIN roles r ON r.id = p.role_id WHERE r.tenant_id = $1', [req.tenantId]);
    const fields = await rows('SELECT f.* FROM field_security f JOIN roles r ON r.id = f.role_id WHERE r.tenant_id = $1', [req.tenantId]);
    res.json(roles.map((x) => ({
      ...x, user_count: Number(x.user_count),
      permissions: perms.filter((p) => p.role_id === x.id).map((p) => ({ resource: p.resource, c: p.can_create, r: p.can_read, e: p.can_edit, d: p.can_delete, a: p.can_approve })),
      field_security: fields.filter((f) => f.role_id === x.id).map((f) => ({ resource: f.resource, field: f.field, access: f.access })),
    })));
  } catch (e) { next(e); }
});

async function saveRole(req, id) {
  const b = req.body || {};
  if (!b.name?.trim()) throw new HttpError(400, 'Role name is required');
  return tx(async (c) => {
    let rid = id;
    if (!id) rid = (await c.query('INSERT INTO roles(tenant_id, name, description, persona) VALUES ($1,$2,$3,$4) RETURNING id', [req.tenantId, b.name.trim(), b.description || null, b.persona || null])).rows[0].id;
    else {
      const cur = (await c.query('SELECT 1 FROM roles WHERE id=$1 AND tenant_id=$2', [id, req.tenantId])).rows[0];
      if (!cur) throw new HttpError(404, 'Role not found');
      await c.query('UPDATE roles SET name=$3, description=$4 WHERE id=$1 AND tenant_id=$2', [id, req.tenantId, b.name.trim(), b.description || null]);
    }
    if (Array.isArray(b.permissions)) {
      const valid = new Set(RESOURCES.map((x) => x.key));
      await c.query('DELETE FROM role_permissions WHERE role_id=$1', [rid]);
      for (const p of b.permissions) {
        if (!valid.has(p.resource) || !(p.c || p.r || p.e || p.d || p.a)) continue;
        // Create/Edit/Delete/Approve imply Read
        await c.query('INSERT INTO role_permissions VALUES ($1,$2,$3,$4,$5,$6,$7)', [rid, p.resource, !!p.c, !!(p.r || p.c || p.e || p.d || p.a), !!p.e, !!p.d, !!p.a]);
      }
    }
    if (Array.isArray(b.field_security)) {
      await c.query('DELETE FROM field_security WHERE role_id=$1', [rid]);
      for (const f of b.field_security) {
        if (!SECURABLE_FIELDS[f.resource]?.includes(f.field) || !['hidden', 'read'].includes(f.access)) continue;
        await c.query('INSERT INTO field_security VALUES ($1,$2,$3,$4)', [rid, f.resource, f.field, f.access]);
      }
    }
    return rid;
  }).then((rid) => { invalidateUser(); return rid; });
}
r.post('/roles', requirePerm('roles', 'c'), tenantWide, async (req, res, next) => {
  try { const id = await saveRole(req, null); await audit(req, 'create', 'roles', id, { name: req.body.name }); res.status(201).json({ id }); }
  catch (e) { next(e.code === '23505' ? new HttpError(409, 'A role with that name already exists') : e); }
});
r.put('/roles/:id', requirePerm('roles', 'e'), tenantWide, async (req, res, next) => {
  try {
    if (req.params.id === req.user.role_id && req.body.permissions && !req.body.permissions.find((p) => p.resource === 'roles' && p.e)) throw new HttpError(400, 'You cannot remove your own ability to manage roles');
    await saveRole(req, req.params.id); await audit(req, 'update', 'roles', req.params.id); res.json({ ok: true });
  } catch (e) { next(e.code === '23505' ? new HttpError(409, 'A role with that name already exists') : e); }
});
r.delete('/roles/:id', requirePerm('roles', 'd'), tenantWide, async (req, res, next) => {
  try {
    const used = await one('SELECT COUNT(*)::int AS n FROM users WHERE role_id=$1', [req.params.id]);
    if (used.n) throw new HttpError(409, `${used.n} user(s) still have this role`);
    await query('DELETE FROM roles WHERE id=$1 AND tenant_id=$2 AND NOT is_system', [req.params.id, req.tenantId]);
    await audit(req, 'delete', 'roles', req.params.id); res.status(204).end();
  } catch (e) { next(e); }
});

// Pickers for assigning record-level scope
r.get('/scope-options', requirePerm('users', 'r'), async (req, res, next) => {
  try {
    const t = [req.tenantId];
    res.json({
      org: await rows('SELECT id, name, type FROM organizations WHERE tenant_id=$1 ORDER BY name', t),
      site: await rows('SELECT s.id, s.name, o.name AS parent FROM sites s JOIN organizations o ON o.id=s.org_id WHERE s.tenant_id=$1 ORDER BY s.name', t),
      line: await rows('SELECT l.id, l.name, s.name AS parent FROM lines l JOIN sites s ON s.id=l.site_id WHERE l.tenant_id=$1 ORDER BY s.name, l.name', t),
      machine: await rows('SELECT m.id, m.name, l.name AS parent FROM machines m JOIN lines l ON l.id=m.line_id WHERE m.tenant_id=$1 ORDER BY l.name, m.station_no, m.name', t),
      part: await rows('SELECT id, name, part_no AS parent FROM parts WHERE tenant_id=$1 ORDER BY part_no', t),
    });
  } catch (e) { next(e); }
});

// ───── Tenant settings & KPI targets ─────
r.get('/settings', requirePerm('settings', 'r'), async (req, res, next) => {
  try {
    const t = await one('SELECT name, slug, plan, settings FROM tenants WHERE id=$1', [req.tenantId]);
    t.targets = await rows('SELECT metric, target, warn, direction FROM kpi_targets WHERE tenant_id=$1 ORDER BY metric', [req.tenantId]);
    res.json(t);
  } catch (e) { next(e); }
});
r.put('/settings', requirePerm('settings', 'e'), tenantWide, async (req, res, next) => {
  try {
    const b = req.body || {};
    await tx(async (c) => {
      if (b.name) await c.query('UPDATE tenants SET name=$2 WHERE id=$1', [req.tenantId, b.name]);
      if (b.settings && typeof b.settings === 'object') await c.query('UPDATE tenants SET settings = settings || $2::jsonb WHERE id=$1', [req.tenantId, JSON.stringify(b.settings)]);
      for (const t of b.targets || []) {
        if (![t.target, t.warn].every((x) => Number.isFinite(Number(x)))) throw new HttpError(400, 'KPI targets must be numbers');
        await c.query(`INSERT INTO kpi_targets VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, metric) DO UPDATE SET target=$3, warn=$4, direction=$5`,
          [req.tenantId, t.metric, t.target, t.warn, t.direction === 'lower' ? 'lower' : 'higher']);
      }
    });
    await audit(req, 'update', 'settings', null, { keys: Object.keys(b) });
    invalidateUser();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.get('/audit', requirePerm('audit', 'r'), async (req, res, next) => {
  try {
    res.json(await rows(
      `SELECT a.id, a.created_at, a.action, a.resource, a.record_id, a.detail, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.tenant_id = $1 ${req.query.resource ? 'AND a.resource = $2' : ''} ORDER BY a.id DESC LIMIT 300`, req.query.resource ? [req.tenantId, req.query.resource] : [req.tenantId]));
  } catch (e) { next(e); }
});

// ───── Platform operator: onboard a new customer tenant (protected by PLATFORM_ADMIN_KEY) ─────
export const platformRouter = Router();
platformRouter.post('/tenants', async (req, res, next) => {
  try {
    if (!config.platformKey || req.headers['x-platform-key'] !== config.platformKey) throw new HttpError(403, 'Forbidden');
    const { slug, name, adminEmail, adminName, adminPassword } = req.body || {};
    if (!/^[a-z0-9-]{2,30}$/.test(slug || '') || !name || !adminEmail || !adminName || (adminPassword || '').length < 8) throw new HttpError(400, 'slug (a-z0-9-), name, adminEmail, adminName and an 8+ character adminPassword are required');
    res.status(201).json(await createTenant({ slug, name, adminEmail, adminName, adminPassword }));
  } catch (e) { next(e.code === '23505' ? new HttpError(409, 'That company code is taken') : e); }
});

export default r;
