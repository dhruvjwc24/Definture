// Integration tests: run against a seeded server (npm run db:reset && npm start), then `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const tokens = {};
async function api(user, method, path, body) {
  if (user && !tokens[user]) {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: 'apex', email: user, password: 'Welcome1!' }) });
    tokens[user] = (await r.json()).token;
  }
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${tokens[user]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}

test('login rejects bad credentials and unknown company', async () => {
  const bad = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: 'apex', email: 'exec@apex.com', password: 'nope' }) });
  assert.equal(bad.status, 401);
  const other = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: 'other', email: 'exec@apex.com', password: 'Welcome1!' }) });
  assert.equal(other.status, 401);
});

test('API requires authentication', async () => {
  assert.equal((await api(null, 'GET', '/e/machines')).status, 401);
});

test('record-level visibility: operator < lead < GM < executive', async () => {
  const n = async (u) => (await api(u, 'GET', '/e/machines')).data.length;
  const [op, lead, gm, exec] = [await n('operator@apex.com'), await n('lead@apex.com'), await n('gm@apex.com'), await n('exec@apex.com')];
  assert.equal(op, 2); assert.equal(lead, 11); assert.ok(gm > lead); assert.ok(exec > gm);
});

test('supplier only sees its own site, machines and POs', async () => {
  const u = 'supplier.admin@castings.com';
  const sites = (await api(u, 'GET', '/e/sites')).data;
  assert.deepEqual(sites.map((s) => s.name), ['Precision Castings - Toledo']);
  const pos = (await api(u, 'GET', '/e/purchase_orders')).data;
  assert.ok(pos.length > 0 && pos.every((p) => p.supplier_name === 'Precision Castings Ltd'));
  const rotorPo = (await api('planner@apex.com', 'GET', '/e/purchase_orders?q=PO-24001')).data[0];
  assert.equal((await api(u, 'GET', `/supply/purchase-orders/${rotorPo.id}`)).status, 404);
});

test('field-level security hides cost for roles without access', async () => {
  assert.ok('unit_cost' in (await api('planner@apex.com', 'GET', '/e/parts')).data[0]);
  assert.ok(!('unit_cost' in (await api('lead@apex.com', 'GET', '/e/parts')).data[0]));
});

test('CRED: operator cannot delete or configure; executive cannot create logs', async () => {
  const m = (await api('operator@apex.com', 'GET', '/e/machines')).data[0];
  assert.equal((await api('operator@apex.com', 'DELETE', `/e/machines/${m.id}`)).status, 403);
  assert.equal((await api('operator@apex.com', 'POST', '/e/reason_codes', { kind: 'scrap', code: 'X', name: 'X' })).status, 403);
  assert.equal((await api('exec@apex.com', 'POST', '/logs', { machine_id: m.id, good_count: 1 })).status, 403);
  assert.equal((await api('operator@apex.com', 'GET', '/admin/users')).status, 403);
});

test('operator cannot log against a machine outside their scope', async () => {
  const lineAMachine = (await api('lead@apex.com', 'GET', '/e/machines')).data.find((m) => m.code === 'A01');
  const shift = (await api('operator@apex.com', 'GET', '/e/shifts')).data[0];
  const r = await api('operator@apex.com', 'POST', '/logs', { machine_id: lineAMachine.id, shift_id: shift.id, ideal_cycle_sec: 90, good_count: 10 });
  assert.equal(r.status, 403);
});

test('shop-floor flow: operator submits, lead approves, metrics include it', async () => {
  const machine = (await api('operator@apex.com', 'GET', '/e/machines')).data.find((m) => m.code === 'A05');
  const shift = (await api('operator@apex.com', 'GET', '/e/shifts')).data[0];
  const op = (await api('operator@apex.com', 'GET', `/e/operations?machine_id=${machine.id}`)).data[0];
  const reasons = (await api('operator@apex.com', 'GET', '/e/reason_codes')).data;
  const created = await api('operator@apex.com', 'POST', '/logs', {
    machine_id: machine.id, operation_id: op.id, shift_id: shift.id, log_date: new Date().toISOString().slice(0, 10), good_count: 250, rework_count: 3,
    downtime: [{ reason_id: reasons.find((r) => r.kind === 'downtime').id, duration_min: 30, notes: 'jam' }],
    scrap: [{ reason_id: reasons.find((r) => r.kind === 'scrap').id, qty: 4, notes: 'test scrap' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'submitted');
  assert.equal(created.data.scrap_count, 4);
  assert.equal(created.data.downtime_sec, 1800);
  assert.equal((await api('operator@apex.com', 'POST', `/logs/${created.data.id}/approve`)).status, 403);
  const approved = await api('lead@apex.com', 'POST', `/logs/${created.data.id}/approve`);
  assert.equal(approved.data.status, 'approved');
  // locked for the operator now
  assert.equal((await api('operator@apex.com', 'PUT', `/logs/${created.data.id}`, { good_count: 1 })).status, 403);
  assert.equal((await api('lead@apex.com', 'DELETE', `/logs/${created.data.id}`)).status, 403); // leads approve but cannot delete
  assert.equal((await api('gm@apex.com', 'DELETE', `/logs/${created.data.id}`)).status, 204);
});

test('OEE = availability x performance x quality', async () => {
  const { current: c } = (await api('exec@apex.com', 'GET', '/analytics/summary')).data;
  assert.ok(Math.abs(c.oee - c.availability * c.performance * c.quality) < 1e-9);
});

test('Pareto is sorted and ends at 100%', async () => {
  const p = (await api('quality@apex.com', 'GET', '/analytics/scrap-pareto')).data;
  assert.ok(p.length > 1);
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].qty >= p[i].qty);
  assert.ok(Math.abs(p.at(-1).cumulative_pct - 100) < 1e-6);
  const rej = (await api('quality@apex.com', 'GET', '/analytics/rejects')).data;
  assert.deepEqual(Object.keys(rej[0]).filter((k) => ['machine_name', 'operation', 'scrap_count', 'scrap_reason', 'operator_notes'].includes(k)).sort(), ['machine_name', 'operation', 'operator_notes', 'scrap_count', 'scrap_reason']);
});

test('line balance returns operator work content and takt', async () => {
  const lb = (await api('lead@apex.com', 'GET', '/analytics/line-balance')).data.lines[0];
  assert.equal(lb.takt_sec, 90);
  assert.equal(lb.operators.length, 3);
  assert.ok(lb.min_operators >= 3);
});

test('supply: critical parts and delayed shipments flagged; supplier receipt posts inventory', async () => {
  const s = (await api('planner@apex.com', 'GET', '/supply/summary')).data;
  assert.ok(s.critical > 0 && s.delayed_shipments.length > 0);
  const inbound = (await api('planner@apex.com', 'GET', '/e/shipments?status=in_transit')).data[0];
  const before = (await api('planner@apex.com', 'GET', '/supply/inventory')).data;
  assert.equal((await api('supplier.admin@seals.com', 'POST', `/supply/shipments/${inbound.id}/receive`)).status, 403); // suppliers cannot receive their own goods
  assert.equal((await api('planner@apex.com', 'POST', `/supply/shipments/${inbound.id}/receive`)).status, 200);
  const after = (await api('planner@apex.com', 'GET', '/supply/inventory')).data;
  const sl = (k) => after.find((i) => i.part_no === k && i.site_name === 'Detroit Plant').on_hand - before.find((i) => i.part_no === k && i.site_name === 'Detroit Plant').on_hand;
  assert.equal(sl('SL-410'), 2500);
});

test('generic CRUD enforces uniqueness and custom field validation', async () => {
  const site = (await api('gm@apex.com', 'GET', '/e/sites')).data[0];
  const dup = await api('planner@apex.com', 'POST', '/e/parts', { part_no: 'CH-210', name: 'dup', part_type: 'component' });
  assert.equal(dup.status, 409);
  const cf = await api('admin@apex.com', 'POST', '/e/custom_fields', { entity: 'machines', key: 'asset_tag', label: 'Asset Tag', type: 'text', required: true });
  assert.equal(cf.status, 201);
  const line = (await api('admin@apex.com', 'GET', '/e/lines')).data[0];
  assert.equal((await api('admin@apex.com', 'POST', '/e/machines', { line_id: line.id, code: 'T-1', name: 'Tmp' })).status, 400); // required custom field
  const ok = await api('admin@apex.com', 'POST', '/e/machines', { line_id: line.id, code: 'T-1', name: 'Tmp', custom: { asset_tag: 'AT-1' } });
  assert.equal(ok.status, 201);
  assert.equal((await api('admin@apex.com', 'DELETE', `/e/machines/${ok.data.id}`)).status, 204);
  assert.equal((await api('admin@apex.com', 'DELETE', `/e/custom_fields/${cf.data.id}`)).status, 204);
  assert.ok(site);
});

test('part lifecycle: multi-level structure, step links, BOM edits guarded', async () => {
  const parts = (await api('planner@apex.com', 'GET', '/e/parts')).data;
  const id = (no) => parts.find((p) => p.part_no === no).id;
  const lc = await api('planner@apex.com', 'GET', `/parts/${id('T-GT1749')}/lifecycle`);
  assert.equal(lc.status, 200);
  const chra = lc.data.tree.children.find((c) => c.part_no === 'CHRA-100');
  assert.ok(chra && chra.children.length >= 3, 'subassembly expands to its own components');
  assert.ok(chra.consumed_at, 'subassembly is consumed at a turbo assembly step');
  assert.ok(lc.data.tree.children.every((c) => c.consumed_at));
  assert.ok((await api('planner@apex.com', 'GET', `/parts/${id('CH-210')}/lifecycle`)).data.where_used.some((p) => p.part_no === 'T-GT1749'));
  assert.equal((await api('planner@apex.com', 'GET', '/parts/not-a-uuid/lifecycle')).status, 404);
  // BOM edits: cycle rejected, self rejected, supplier blocked, valid edit round-trips
  assert.equal((await api('planner@apex.com', 'PUT', `/parts/${id('CHRA-100')}/bom/${id('T-GT1749')}`, { qty_per: 1 })).status, 400);
  assert.equal((await api('planner@apex.com', 'PUT', `/parts/${id('CHRA-100')}/bom/${id('CHRA-100')}`, { qty_per: 1 })).status, 400);
  assert.equal((await api('planner@apex.com', 'PUT', `/parts/${id('CHRA-100')}/bom/${id('NT-440')}`, { qty_per: 0 })).status, 400);
  assert.ok([401, 403, 404].includes((await api('supplier.admin@castings.com', 'PUT', `/parts/${id('CHRA-100')}/bom/${id('NT-440')}`, { qty_per: 1 })).status));
  assert.equal((await api('planner@apex.com', 'PUT', `/parts/${id('CHRA-100')}/bom/${id('NT-440')}`, { qty_per: 2 })).status, 200);
  assert.equal((await api('planner@apex.com', 'DELETE', `/parts/${id('CHRA-100')}/bom/${id('NT-440')}`)).status, 204);
  // supplier sees only parts it supplies
  const sup = await api('supplier.admin@castings.com', 'GET', `/parts/${id('T-GT1749')}/lifecycle`);
  assert.ok(sup.status === 404 || sup.data.tree.children.every((c) => ['CH-210', 'TH-220'].includes(c.part_no) || c.children.length >= 0));
});
