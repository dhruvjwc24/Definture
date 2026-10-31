import { tx } from './db.js';
import { hashPassword } from './security/auth.js';
import { ROLE_PRESETS, permFlags } from './security/presets.js';
import { DEFAULT_TARGETS, DEFAULT_LABELS } from './security/resources.js';

// Onboard a new customer (tenant): company, internal org, starter roles, KPI targets, reason codes, shifts, first admin.
export async function createTenant({ slug, name, adminEmail, adminName, adminPassword, settings = {} }) {
  return tx(async (c) => {
    const t = (await c.query('INSERT INTO tenants(slug, name, settings) VALUES ($1,$2,$3) RETURNING id', [slug.toLowerCase(), name, { labels: DEFAULT_LABELS, currency: 'USD', ...settings }])).rows[0];
    const org = (await c.query("INSERT INTO organizations(tenant_id, code, name, type) VALUES ($1,'HQ',$2,'internal') RETURNING id", [t.id, name])).rows[0];

    const roleIds = {};
    for (const p of ROLE_PRESETS) {
      const role = (await c.query('INSERT INTO roles(tenant_id, name, description, persona, is_system) VALUES ($1,$2,$3,$4,true) RETURNING id', [t.id, p.name, p.description, p.persona])).rows[0];
      roleIds[p.name] = role.id;
      for (const [res, str] of Object.entries(p.perms)) {
        const f = permFlags(str);
        if (!str) continue;
        await c.query('INSERT INTO role_permissions(role_id, resource, can_create, can_read, can_edit, can_delete, can_approve) VALUES ($1,$2,$3,$4,$5,$6,$7)', [role.id, res, f.c, f.r, f.e, f.d, f.a]);
      }
      for (const h of p.hidden) {
        const [resource, field] = h.split('.');
        await c.query("INSERT INTO field_security(role_id, resource, field, access) VALUES ($1,$2,$3,'hidden')", [role.id, resource, field]);
      }
    }
    for (const [metric, target, warn, direction] of DEFAULT_TARGETS) await c.query('INSERT INTO kpi_targets VALUES ($1,$2,$3,$4,$5)', [t.id, metric, target, warn, direction]);

    const reasons = [
      ['scrap', 'DIM', 'Dimensional'], ['scrap', 'BUR', 'Burrs'], ['scrap', 'SUR', 'Surface Finish'], ['scrap', 'LEAK', 'Leak / Oil Flow Fail'], ['scrap', 'BAL', 'Balance Out of Tolerance'], ['scrap', 'OTH', 'Other'],
      ['downtime', 'BRK', 'Equipment Breakdown', 'breakdown', false], ['downtime', 'CHG', 'Changeover', 'changeover', false], ['downtime', 'MAT', 'No Material', 'material', false],
      ['downtime', 'MST', 'Minor Stop / Jam', 'minor_stop', false], ['downtime', 'QCH', 'Waiting on Inspection', 'quality', false], ['downtime', 'PM', 'Planned Maintenance', 'planned', true],
    ];
    for (const [kind, code, rn, cat, planned] of reasons) await c.query('INSERT INTO reason_codes(tenant_id, kind, code, name, category, planned) VALUES ($1,$2,$3,$4,$5,$6)', [t.id, kind, code, rn, cat || null, !!planned]);
    for (const [sn, st, en, br] of [['Shift 1', '06:00', '14:00', 30], ['Shift 2', '14:00', '22:00', 30]]) await c.query('INSERT INTO shifts(tenant_id, name, start_time, end_time, planned_break_min) VALUES ($1,$2,$3,$4,$5)', [t.id, sn, st, en, br]);

    const admin = (await c.query('INSERT INTO users(tenant_id, org_id, role_id, email, full_name, title, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [t.id, org.id, roleIds['Tenant Admin'], adminEmail, adminName, 'Administrator', await hashPassword(adminPassword)])).rows[0];
    await c.query("INSERT INTO user_scopes(user_id, scope_type, scope_id) VALUES ($1,'tenant',NULL)", [admin.id]);
    return { tenantId: t.id, orgId: org.id, roleIds, adminId: admin.id };
  });
}
