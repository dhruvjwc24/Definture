import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one, rows, query } from '../db.js';
import { resolveScope } from './scope.js';
import { DEFAULT_LABELS } from './resources.js';

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const signToken = (user) => jwt.sign({ uid: user.id, tid: user.tenant_id }, config.jwtSecret, { expiresIn: config.jwtTtl });

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// short-lived cache of per-user security context (permissions change rarely; see invalidateUser)
const cache = new Map();
const TTL_MS = 15_000;
export const invalidateUser = (uid) => (uid ? cache.delete(uid) : cache.clear());

export async function loadContext(uid) {
  const hit = cache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.ctx;

  const user = await one(
    `SELECT u.id, u.tenant_id, u.org_id, u.email, u.full_name, u.title, u.active, u.role_id,
            r.name AS role_name, r.persona, o.name AS org_name, o.type AS org_type, t.name AS tenant_name, t.slug AS tenant_slug,
            t.settings AS tenant_settings, t.active AS tenant_active
       FROM users u JOIN roles r ON r.id = u.role_id JOIN organizations o ON o.id = u.org_id JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1`, [uid]);
  if (!user || !user.active || !user.tenant_active) return null;

  const perms = {};
  for (const p of await rows('SELECT * FROM role_permissions WHERE role_id = $1', [user.role_id])) {
    perms[p.resource] = { c: p.can_create, r: p.can_read, e: p.can_edit, d: p.can_delete, a: p.can_approve };
  }
  const fields = { hidden: {}, read: {} };
  for (const f of await rows('SELECT resource, field, access FROM field_security WHERE role_id = $1', [user.role_id])) {
    (fields[f.access][f.resource] ||= new Set()).add(f.field);
  }
  const scope = await resolveScope(user);
  const ctx = { user, perms, fields, scope };
  cache.set(uid, { ctx, exp: Date.now() + TTL_MS });
  return ctx;
}

export async function authenticate(req, _res, next) {
  try {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'Authentication required');
    let payload;
    try { payload = jwt.verify(m[1], config.jwtSecret); } catch { throw new HttpError(401, 'Session expired, please sign in again'); }
    const ctx = await loadContext(payload.uid);
    if (!ctx) throw new HttpError(401, 'Account disabled or not found');
    req.ctx = ctx;
    req.user = ctx.user;
    req.tenantId = ctx.user.tenant_id;
    next();
  } catch (e) { next(e); }
}

// CRED guard: requirePerm('machines', 'r')
export const can = (ctx, resource, action) => !!ctx.perms[resource]?.[action];
export const requirePerm = (resource, action = 'r') => (req, _res, next) =>
  can(req.ctx, resource, action) ? next() : next(new HttpError(403, `You do not have permission to ${LABEL[action]} ${resource.replace(/[._]/g, ' ')}`));
const LABEL = { c: 'create', r: 'view', e: 'edit', d: 'delete', a: 'approve' };

export async function login(slug, email, password, ip) {
  const row = await one(
    `SELECT u.id, u.tenant_id, u.password_hash FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE t.slug = $1 AND lower(u.email) = lower($2) AND u.active AND t.active`, [slug.trim().toLowerCase(), email.trim()]);
  const ok = row && (await bcrypt.compare(password, row.password_hash));
  if (!ok) throw new HttpError(401, 'Invalid company code, email or password');
  await query('UPDATE users SET last_login = now() WHERE id = $1', [row.id]);
  await query(`INSERT INTO audit_log(tenant_id, user_id, action, resource, detail) VALUES ($1,$2,'login','auth',$3)`, [row.tenant_id, row.id, { ip }]);
  return row;
}

// Everything the UI needs to render itself for this user: menu permissions, labels, KPI targets
export async function sessionPayload(ctx) {
  const { user } = ctx;
  const targets = await rows('SELECT metric, target, warn, direction FROM kpi_targets WHERE tenant_id = $1', [user.tenant_id]);
  const customFields = await rows('SELECT entity, key, label, type, options, required FROM custom_fields WHERE tenant_id = $1 ORDER BY sort_order, label', [user.tenant_id]);
  const s = user.tenant_settings || {};
  return {
    user: { id: user.id, name: user.full_name, email: user.email, title: user.title, role: user.role_name, persona: user.persona, org: user.org_name, orgType: user.org_type },
    tenant: { name: user.tenant_name, slug: user.tenant_slug, labels: { ...DEFAULT_LABELS, ...(s.labels || {}) }, modules: s.modules || {}, currency: s.currency || 'USD', brand: s.brand || null },
    permissions: ctx.perms,
    hiddenFields: Object.fromEntries(Object.entries(ctx.fields.hidden).map(([k, v]) => [k, [...v]])),
    readonlyFields: Object.fromEntries(Object.entries(ctx.fields.read).map(([k, v]) => [k, [...v]])),
    scope: { all: ctx.scope.all, sites: ctx.scope.sites.length, lines: ctx.scope.lines.length, machines: ctx.scope.machines.length },
    targets, customFields,
  };
}

export async function audit(req, action, resource, recordId, detail) {
  await query('INSERT INTO audit_log(tenant_id, user_id, action, resource, record_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.tenantId, req.user.id, action, resource, recordId ? String(recordId) : null, detail ?? null]);
}

// Field-level security helpers
export function stripHidden(ctx, resource, obj) {
  const hide = ctx.fields.hidden[resource];
  if (!hide || !obj) return obj;
  const out = { ...obj };
  for (const f of hide) delete out[f];
  return out;
}
export function stripUnwritable(ctx, resource, body) {
  const blocked = [...(ctx.fields.hidden[resource] || []), ...(ctx.fields.read[resource] || [])];
  if (!blocked.length) return body;
  const out = { ...body };
  for (const f of blocked) delete out[f];
  return out;
}
