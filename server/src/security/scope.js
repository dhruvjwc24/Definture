import { rows } from '../db.js';

// Resolve a user's record-level visibility into explicit id sets.
// A scope on a parent grants its descendants (org -> sites -> lines -> machines). `part` scopes
// (managers of a component) grant the machines that have operations on that part.
export async function resolveScope(user) {
  const scopes = await rows('SELECT scope_type, scope_id FROM user_scopes WHERE user_id = $1', [user.id]);
  if (scopes.some((s) => s.scope_type === 'tenant')) return { all: true, ownedOrgs: [], orgs: [], sites: [], lines: [], machines: [] };

  const ids = (t) => scopes.filter((s) => s.scope_type === t).map((s) => s.scope_id);
  const [ownedOrgs, siteS, lineS, machS, partS] = [ids('org'), ids('site'), ids('line'), ids('machine'), ids('part')];

  const machines = (await rows(
    `SELECT id FROM machines WHERE tenant_id = $1 AND (org_id = ANY($2) OR site_id = ANY($3) OR line_id = ANY($4) OR id = ANY($5)
       OR id IN (SELECT machine_id FROM operations WHERE part_id = ANY($6)))`,
    [user.tenant_id, ownedOrgs, siteS, lineS, machS, partS])).map((r) => r.id);

  const lines = (await rows(
    `SELECT id FROM lines WHERE tenant_id = $1 AND (org_id = ANY($2) OR site_id = ANY($3) OR id = ANY($4)
       OR id IN (SELECT line_id FROM machines WHERE id = ANY($5)))`,
    [user.tenant_id, ownedOrgs, siteS, lineS, machines])).map((r) => r.id);

  const sites = (await rows(
    `SELECT id FROM sites WHERE tenant_id = $1 AND (org_id = ANY($2) OR id = ANY($3) OR id IN (SELECT site_id FROM lines WHERE id = ANY($4)))`,
    [user.tenant_id, ownedOrgs, siteS, lines])).map((r) => r.id);

  const orgs = (await rows(
    `SELECT DISTINCT org_id AS id FROM sites WHERE id = ANY($1) UNION SELECT unnest($2::uuid[])`, [sites, ownedOrgs])).map((r) => r.id);

  return { all: false, ownedOrgs, orgs, sites, lines, machines };
}

// SQL condition for an entity's scope rule. Returns '' when the user can see everything.
// `params` is the caller's parameter array; values are appended and placeholders returned.
export function scopeClause(rule, scope, params, alias = 't') {
  if (scope.all || !rule || rule.type === 'none') return '';
  const p = (v) => { params.push(v); return `$${params.length}::uuid[]`; };
  const c = (col) => `${alias}.${col}`;
  switch (rule.type) {
    case 'org': return `${c(rule.col || 'org_id')} = ANY(${p(scope.orgs)})`;
    case 'site': return `${c(rule.col || 'site_id')} = ANY(${p(scope.sites)})`;
    case 'line': return `${c(rule.col || 'line_id')} = ANY(${p(scope.lines)})`;
    case 'machine': return `${c(rule.col || 'machine_id')} = ANY(${p(scope.machines)})`;
    case 'site_or_supplier': // purchase orders & shipments: receiving site, or the supplier that owns them
      return `(${c('site_id')} = ANY(${p(scope.sites)}) OR ${c('supplier_org_id')} = ANY(${p(scope.ownedOrgs)}))`;
    case 'parts': // external users only see parts they supply or produce
      return `(${c('id')} IN (SELECT part_id FROM supplier_parts WHERE org_id = ANY(${p(scope.orgs)}))
        OR ${c('id')} IN (SELECT part_id FROM operations WHERE machine_id = ANY(${p(scope.machines)})))`;
    default: return '';
  }
}

// Check that specific ids fall inside the user's scope (used for write validation)
export function inScope(scope, kind, id) {
  if (scope.all || id == null) return true;
  const set = { site: scope.sites, line: scope.lines, machine: scope.machines, org: scope.orgs }[kind];
  return !!set && set.includes(id);
}
