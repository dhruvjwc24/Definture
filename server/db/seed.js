// Demo tenant "apex" (Apex Turbo Systems): 2 plants, turbocharger line from the requirements doc, 3 suppliers,
// 45 days of production logs, inventory, POs and shipments. Password for all demo users: Welcome1!
import { pool, tx } from '../src/db.js';
import { createTenant } from '../src/tenants.js';
import { hashPassword } from '../src/security/auth.js';

// deterministic PRNG so demo data is repeatable
let seed = 20261030;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const between = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (items) => { let r = rnd() * items.reduce((s, i) => s + i[1], 0); for (const [v, w] of items) { if ((r -= w) <= 0) return v; } return items[0][0]; };
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

const { tenantId, orgId: apexOrg, roleIds } = await createTenant({
  slug: 'apex', name: 'Apex Turbo Systems', adminEmail: 'admin@apex.com', adminName: 'Avery Admin', adminPassword: 'Welcome1!',
});

await tx(async (c) => {
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const ins = async (table, o) => {
    const keys = Object.keys(o);
    return (await q(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, keys.map((k) => o[k])))[0].id;
  };
  const T = { tenant_id: tenantId };

  // ── Organizations (first party + third-party suppliers)
  const org = { APEX: apexOrg };
  for (const [code, name] of [['CAST', 'Precision Castings Ltd'], ['ROTD', 'Rotor Dynamics Inc'], ['SEAL', 'Global Seals Co']]) org[code] = await ins('organizations', { ...T, code, name, type: 'supplier', contact_email: `sales@${code.toLowerCase()}.example` });
  await q("UPDATE organizations SET code='APEX' WHERE id=$1", [apexOrg]);

  // ── Sites
  const site = {};
  for (const [k, o, code, name, city, country, tz] of [
    ['P1', 'APEX', 'DET', 'Detroit Plant', 'Detroit', 'US', 'America/Detroit'], ['P2', 'APEX', 'MTY', 'Monterrey Plant', 'Monterrey', 'MX', 'America/Monterrey'],
    ['C1', 'CAST', 'CAST-TOL', 'Precision Castings - Toledo', 'Toledo', 'US', 'America/New_York'], ['R1', 'ROTD', 'ROTD-AKR', 'Rotor Dynamics - Akron', 'Akron', 'US', 'America/New_York'],
    ['S1', 'SEAL', 'SEAL-CLE', 'Global Seals - Cleveland DC', 'Cleveland', 'US', 'America/New_York']])
    site[k] = await ins('sites', { ...T, org_id: org[o], code, name, city, country, timezone: tz });

  // ── Lines
  const line = {};
  for (const [k, s, o, code, name, takt, paced, layout] of [
    ['A', 'P1', 'APEX', 'DET-A', 'Turbo Assembly Line A', 90, true, 'U-shaped'], ['B', 'P1', 'APEX', 'DET-B', 'CHRA Cell B', 70, true, 'Cell'],
    ['C', 'P2', 'APEX', 'MTY-C', 'HD Turbo Line C', 110, true, 'Straight'],
    ['CL', 'C1', 'CAST', 'CAST-1', 'Housing Machining', null, false, 'Cell'], ['RL', 'R1', 'ROTD', 'ROTD-1', 'Shaft & Wheel Finishing', null, false, 'Cell']])
    line[k] = await ins('lines', { ...T, org_id: org[o], site_id: site[s], code, name, takt_sec: takt, paced, layout });

  // ── Parts
  const part = {};
  for (const [k, no, name, type, cost] of [
    ['TURBO', 'T-GT1749', 'Turbocharger GT1749 (passenger)', 'finished', 412], ['TURBOHD', 'T-GT2056', 'Turbocharger GT2056 (heavy duty)', 'finished', 868],
    ['CHRA', 'CHRA-100', 'CHRA Cartridge', 'subassembly', 188], ['CH', 'CH-210', 'Compressor Housing', 'component', 34.5], ['TH', 'TH-220', 'Turbine Housing', 'component', 52],
    ['SH', 'SH-300', 'Turbo Shaft', 'component', 21], ['CW', 'CW-310', 'Compressor Wheel', 'component', 28], ['TW', 'TW-320', 'Turbine Wheel', 'component', 61],
    ['BR', 'BR-400', 'Bearing Set', 'component', 14.2], ['SL', 'SL-410', 'Seal Kit', 'component', 6.8], ['HS', 'HS-420', 'Heat Shield', 'component', 9.4],
    ['CL', 'CL-430', 'V-Band Clamp', 'component', 3.1], ['NT', 'NT-440', 'Lock Nut', 'component', 0.9]])
    part[k] = await ins('parts', { ...T, part_no: no, name, part_type: type, unit_cost: cost });
  for (const [p, ch, qty] of [['TURBO', 'CHRA', 1], ['TURBO', 'CH', 1], ['TURBO', 'TH', 1], ['TURBO', 'CW', 1], ['TURBO', 'TW', 1], ['TURBO', 'HS', 1], ['TURBO', 'CL', 1], ['TURBO', 'NT', 1],
    ['TURBOHD', 'CHRA', 1], ['TURBOHD', 'CH', 1], ['TURBOHD', 'TH', 1], ['CHRA', 'SH', 1], ['CHRA', 'BR', 1], ['CHRA', 'SL', 1]])
    await q('INSERT INTO bom VALUES ($1,$2,$3,$4)', [tenantId, part[p], part[ch], qty]);
  for (const [o, p, lt, moq] of [['CAST', 'CH', 21, 500], ['CAST', 'TH', 28, 500], ['ROTD', 'SH', 14, 1000], ['ROTD', 'CW', 21, 500], ['ROTD', 'TW', 21, 500],
    ['SEAL', 'BR', 10, 2000], ['SEAL', 'SL', 10, 2000], ['SEAL', 'HS', 12, 1000], ['SEAL', 'CL', 7, 2000], ['SEAL', 'NT', 7, 5000]])
    await q('INSERT INTO supplier_parts VALUES ($1,$2,$3,$4,$5)', [tenantId, org[o], part[p], lt, moq]);

  // ── Machines + operations. Line A is the 11-station U-cell from the requirements document.
  const mach = {}; const opRow = {};
  async function addMachine(lineKey, code, name, type, stationNo) {
    const l = (await q('SELECT org_id, site_id FROM lines WHERE id=$1', [line[lineKey]]))[0];
    const id = await ins('machines', { ...T, org_id: l.org_id, site_id: l.site_id, line_id: line[lineKey], code, name, machine_type: type, station_no: stationNo });
    mach[code] = { id, line: lineKey };
    return id;
  }
  async function addOp(partKey, code, seq, name, ct, manual, group) {
    opRow[code] = await ins('operations', { ...T, part_id: part[partKey], machine_id: mach[code].id, seq, name, cycle_time_sec: ct, manual_time_sec: manual, operator_group: group });
  }
  const A = [
    ['A01', 'Incoming Inspection', 'Manual station', 45, 45, 'A'], ['A02', 'Parts Cleaning & Prep', 'Manual station', 60, 60, 'A'], ['A03', 'CHRA Assembly A (shaft + bearings)', 'Manual station', 75, 75, 'A'],
    ['A04', 'CHRA Assembly B (seals + thrust)', 'Manual station', 75, 75, 'B'], ['A05', 'Rotor Balancing (VSR)', 'Automated balancer', 90, 30, 'B'], ['A06', 'Compressor Assembly', 'Manual station', 60, 60, 'B'],
    ['A07', 'Turbine Assembly', 'Manual station', 60, 60, 'C'], ['A08', 'Housing Assembly', 'Manual station', 75, 75, 'C'], ['A09', 'Functional Test', 'Automated test bench', 90, 15, 'C'],
    ['A10', 'Final Inspection', 'Manual station', 45, 45, 'C'], ['A11', 'Pack & Label', 'Manual station', 45, 45, 'C']];
  for (const [i, [code, name, type, ct, man, grp]] of A.entries()) { await addMachine('A', code, name, type, i + 1); await addOp('TURBO', code, i + 1, name, ct, man, grp); }
  const B = [['B01', 'Shaft + Bearing Press', 'Manual station', 55, 55, 'A'], ['B02', 'Seal & Thrust Install', 'Manual station', 70, 70, 'A'], ['B03', 'CHRA Balancing', 'Automated balancer', 70, 25, 'B'], ['B04', 'CHRA Leak Check', 'Automated test bench', 60, 20, 'B']];
  for (const [i, [code, name, type, ct, man, grp]] of B.entries()) { await addMachine('B', code, name, type, i + 1); await addOp('CHRA', code, i + 1, name, ct, man, grp); }
  const C = [['C01', 'CHRA Fitment', 'Manual station', 95, 95, 'A'], ['C02', 'Compressor / Turbine Assembly', 'Manual station', 100, 100, 'A'], ['C03', 'Housing Clamp & Clocking', 'Manual station', 90, 90, 'B'],
    ['C04', 'Hot Gas Test', 'Automated test bench', 110, 25, 'B'], ['C05', 'Final Inspection & Pack', 'Manual station', 70, 70, 'B']];
  for (const [i, [code, name, type, ct, man, grp]] of C.entries()) { await addMachine('C', code, name, type, i + 1); await addOp('TURBOHD', code, i + 1, name, ct, man, grp); }
  for (const [i, [code, name, ct]] of [['CAST-M1', 'CNC Mill - Compressor Housing', 120], ['CAST-M2', 'Bore Finishing', 90], ['CAST-M3', 'Leak Test', 60]].entries()) { await addMachine('CL', code, name, 'CNC / test', i + 1); await addOp('CH', code, i + 1, name, ct, 20, 'A'); }
  for (const [i, [code, name, ct]] of [['ROTD-G1', 'Shaft Grinder', 110], ['ROTD-G2', 'Shaft Polisher', 80], ['ROTD-I1', 'Dimensional Inspection', 50]].entries()) { await addMachine('RL', code, name, 'CNC / inspection', i + 1); await addOp('SH', code, i + 1, name, ct, 15, 'A'); }

  // ── Which routing step consumes each component (drives the part lifecycle flow diagram)
  for (const [p, ch, opCode] of [['TURBO', 'CW', 'A06'], ['TURBO', 'CH', 'A06'], ['TURBO', 'NT', 'A06'], ['TURBO', 'TW', 'A07'], ['TURBO', 'TH', 'A07'],
    ['TURBO', 'CHRA', 'A08'], ['TURBO', 'HS', 'A08'], ['TURBO', 'CL', 'A08'], ['TURBOHD', 'CHRA', 'C01'], ['TURBOHD', 'CH', 'C02'], ['TURBOHD', 'TH', 'C02'],
    ['CHRA', 'SH', 'B01'], ['CHRA', 'BR', 'B01'], ['CHRA', 'SL', 'B02']])
    await q('UPDATE bom SET operation_id=$1 WHERE parent_part_id=$2 AND child_part_id=$3', [opRow[opCode], part[p], part[ch]]);

  // ── Jobs
  const job = {};
  for (const [k, s, l, no, p, qty, done, due, status] of [
    ['J1', 'P1', 'A', 'J-24101', 'TURBO', 5000, 3200, day(8), 'running'], ['J2', 'P1', 'A', 'J-24102', 'TURBO', 4000, 0, day(18), 'open'],
    ['J3', 'P1', 'B', 'J-24110', 'CHRA', 6000, 3900, day(6), 'running'], ['J4', 'P2', 'C', 'J-25001', 'TURBOHD', 2400, 900, day(12), 'running']])
    job[k] = await ins('jobs', { ...T, org_id: org.APEX, site_id: site[s], line_id: line[l], job_no: no, part_id: part[p], qty_planned: qty, qty_done: done, due_date: due, status });

  // ── Inventory (plants + supplier-held stock)
  const inv = (s, o, p, onHand, safety, reorder, usage) => ins('inventory_levels', { ...T, org_id: org[o], site_id: site[s], part_id: part[p], on_hand: onHand, safety_stock: safety, reorder_point: reorder, avg_daily_usage: usage });
  for (const [p, onHand, safety, reorder, usage] of [['CH', 2300, 1000, 1800, 480], ['TH', 1900, 1000, 1600, 480], ['SH', 4100, 1500, 2500, 480], ['CW', 2600, 1000, 1800, 480], ['TW', 640, 1000, 1700, 480],
    ['BR', 2900, 1500, 2400, 480], ['SL', 1200, 1200, 2000, 480], ['HS', 3400, 1000, 1800, 480], ['CL', 5200, 2000, 3500, 480], ['NT', 11000, 4000, 7000, 480], ['CHRA', 6200, 1500, 3000, 480], ['TURBO', 2400, 900, 1500, 300]]) await inv('P1', 'APEX', p, onHand, safety, reorder, usage);
  for (const [p, onHand, safety, reorder, usage] of [['CH', 1100, 500, 900, 220], ['TH', 380, 500, 800, 220], ['CHRA', 700, 300, 600, 220], ['CW', 1400, 500, 900, 220], ['TW', 1250, 500, 900, 220], ['HS', 2100, 500, 900, 220], ['TURBOHD', 900, 300, 500, 110]]) await inv('P2', 'APEX', p, onHand, safety, reorder, usage);
  for (const [s, o, p, onHand, safety, reorder, usage] of [['C1', 'CAST', 'CH', 2400, 800, 1200, 700], ['C1', 'CAST', 'TH', 900, 800, 1200, 700], ['R1', 'ROTD', 'SH', 5200, 1500, 2500, 480], ['R1', 'ROTD', 'TW', 300, 800, 1400, 700], ['S1', 'SEAL', 'SL', 9000, 3000, 5000, 700], ['S1', 'SEAL', 'BR', 7000, 3000, 5000, 700]]) await inv(s, o, p, onHand, safety, reorder, usage);

  // ── Purchase orders & shipments (history for OTD, plus delayed / in-transit)
  const poLine = {};
  async function po(no, sup, s, orderOff, lines) {
    const id = await ins('purchase_orders', { ...T, po_no: no, supplier_org_id: org[sup], site_id: site[s], order_date: day(orderOff), status: 'open' });
    for (const [p, qty, received, dueOff] of lines) poLine[`${no}:${p}`] = await ins('po_lines', { ...T, po_id: id, part_id: part[p], qty, qty_received: received, unit_cost: (await q('SELECT unit_cost FROM parts WHERE id=$1', [part[p]]))[0].unit_cost, due_date: day(dueOff) });
    return id;
  }
  async function ship(no, poId, sup, s, status, shipOff, etaOff, deliveredOff, lines, extra = {}) {
    const sid = await ins('shipments', { ...T, shipment_no: no, po_id: poId, supplier_org_id: org[sup], site_id: site[s], status, ship_date: day(shipOff), eta: day(etaOff), delivered_on: deliveredOff == null ? null : day(deliveredOff), carrier: pick(['XPO Logistics', 'Estes Express', 'Old Dominion', 'FedEx Freight']), tracking_no: `TRK${Math.floor(rnd() * 9e6 + 1e6)}`, ...extra });
    for (const [poNo, p, qty] of lines) await ins('shipment_lines', { ...T, shipment_id: sid, po_line_id: poLine[`${poNo}:${p}`], part_id: part[p], qty });
  }
  // historic, delivered (mix of on-time and late)
  for (const [i, [sup, p, dueOff, delivOff]] of [['CAST', 'CH', -60, -61], ['CAST', 'TH', -52, -49], ['ROTD', 'SH', -45, -46], ['ROTD', 'CW', -38, -38], ['SEAL', 'SL', -30, -27], ['SEAL', 'BR', -24, -25], ['CAST', 'CH', -18, -18], ['ROTD', 'TW', -14, -10], ['SEAL', 'CL', -9, -9]].entries()) {
    const no = `PO-23${100 + i}`;
    const id = await po(no, sup, 'P1', dueOff - 20, [[p, 1000, 1000, dueOff]]);
    await q("UPDATE purchase_orders SET status='received' WHERE id=$1", [id]);
    await ship(`SH-23${100 + i}`, id, sup, 'P1', 'delivered', delivOff - 5, dueOff, delivOff, [[no, p, 1000]]);
  }
  const p1 = await po('PO-24001', 'ROTD', 'P1', -15, [['TW', 2500, 0, 2]]);
  await ship('SH-24001', p1, 'ROTD', 'P1', 'delayed', -6, 6, null, [['PO-24001', 'TW', 1500]], { delay_reason: 'Heat-treat furnace down for repair; expedite requested' });
  const p2 = await po('PO-24002', 'SEAL', 'P1', -8, [['SL', 4000, 0, 3], ['BR', 3000, 0, 5]]);
  await ship('SH-24002', p2, 'SEAL', 'P1', 'in_transit', -2, 2, null, [['PO-24002', 'SL', 2500], ['PO-24002', 'BR', 3000]]);
  const p3 = await po('PO-24003', 'CAST', 'P2', -12, [['TH', 1500, 0, 1], ['CH', 1000, 0, 7]]);
  await ship('SH-24003', p3, 'CAST', 'P2', 'delayed', -5, 4, null, [['PO-24003', 'TH', 1500]], { delay_reason: 'Carrier capacity shortage at border crossing' });
  const p4 = await po('PO-24004', 'CAST', 'P1', -4, [['CH', 3000, 0, 14], ['TH', 2500, 0, 14]]);
  await ship('SH-24004', p4, 'CAST', 'P1', 'planned', 5, 12, null, [['PO-24004', 'CH', 3000]]);
  await po('PO-24005', 'ROTD', 'P2', -2, [['CW', 1500, 0, 16], ['TW', 1500, 0, 16]]);

  // ── Reason codes lookup
  const reasons = await q('SELECT id, kind, code, name FROM reason_codes WHERE tenant_id=$1', [tenantId]);
  const R = (kind, code) => reasons.find((r) => r.kind === kind && r.code === code).id;
  const shifts = await q('SELECT id, name FROM shifts WHERE tenant_id=$1 ORDER BY start_time', [tenantId]);

  // ── Users
  const pw = await hashPassword('Welcome1!');
  const users = {};
  async function user(key, email, name, title, role, o, scopes) {
    const id = await ins('users', { tenant_id: tenantId, org_id: org[o], role_id: roleIds[role], email, full_name: name, title, password_hash: pw });
    for (const [type, sid] of scopes) await q('INSERT INTO user_scopes(user_id, scope_type, scope_id) VALUES ($1,$2,$3)', [id, type, sid]);
    users[key] = id;
  }
  await user('exec', 'exec@apex.com', 'Elena Rossi', 'Chief Operating Officer', 'Executive', 'APEX', [['tenant', null]]);
  await user('gm', 'gm@apex.com', 'Gary Mitchell', 'General Manager, Detroit Plant', 'Plant Manager (GM)', 'APEX', [['site', site.P1]]);
  await user('manager', 'manager@apex.com', 'Maria Gonzalez', 'Turbocharger Product Manager', 'Manager', 'APEX', [['part', part.TURBO]]);
  await user('supervisor', 'supervisor@apex.com', 'Sam Patel', 'Operations Supervisor', 'Supervisor', 'APEX', [['line', line.A], ['line', line.B]]);
  await user('lead', 'lead@apex.com', 'Lena Park', 'Line A Lead', 'Lead', 'APEX', [['line', line.A]]);
  await user('operator', 'operator@apex.com', 'Omar Haddad', 'Machine Operator', 'Operator', 'APEX', [['machine', mach.A05.id], ['machine', mach.A06.id]]);
  await user('planner', 'planner@apex.com', 'Priya Nair', 'Supply Chain Planner', 'Supply Chain Planner', 'APEX', [['tenant', null]]);
  await user('quality', 'quality@apex.com', 'Quinn Foster', 'Quality Engineer', 'Quality Engineer', 'APEX', [['site', site.P1], ['site', site.P2]]);
  await user('castAdmin', 'supplier.admin@castings.com', 'Carl Becker', 'Plant Manager, Precision Castings', 'Supplier Admin', 'CAST', [['org', org.CAST]]);
  await user('castOp', 'supplier.op@castings.com', 'Cora Lin', 'Machine Operator, Precision Castings', 'Supplier User', 'CAST', [['org', org.CAST]]);
  await user('rotorAdmin', 'supplier.admin@rotor.com', 'Rob Tanaka', 'Operations Lead, Rotor Dynamics', 'Supplier Admin', 'ROTD', [['org', org.ROTD]]);
  await user('sealAdmin', 'supplier.admin@seals.com', 'Sara Klein', 'Logistics, Global Seals', 'Supplier Admin', 'SEAL', [['org', org.SEAL]]);

  // ── 45 days of production logs
  const PROFILE = { // [availability, performance, quality] base values
    A05: [0.80, 0.93, 0.955], A09: [0.83, 0.94, 0.965], A03: [0.88, 0.95, 0.965], A04: [0.88, 0.96, 0.97], A08: [0.87, 0.96, 0.975], A02: [0.90, 0.97, 0.99], A06: [0.89, 0.96, 0.985],
    C04: [0.79, 0.92, 0.95], C01: [0.86, 0.94, 0.97], B03: [0.82, 0.94, 0.96], 'CAST-M1': [0.84, 0.91, 0.94], 'ROTD-G1': [0.81, 0.93, 0.95],
  };
  const DOWN = {
    default: [['MST', 5], ['BRK', 2], ['MAT', 2], ['QCH', 1], ['CHG', 1]],
    A05: [['BRK', 4], ['MST', 5], ['CHG', 2], ['MAT', 1]], A09: [['QCH', 4], ['BRK', 3], ['MST', 3]], C04: [['BRK', 5], ['MST', 3], ['CHG', 2]],
  };
  const SCRAP = {
    default: [['DIM', 3], ['SUR', 2], ['OTH', 1]], A05: [['BAL', 8], ['DIM', 1]], A09: [['LEAK', 8], ['OTH', 1]], A03: [['DIM', 4], ['BUR', 2], ['SUR', 1]], A04: [['LEAK', 3], ['DIM', 2]],
    A08: [['DIM', 3], ['OTH', 2]], 'CAST-M1': [['DIM', 4], ['BUR', 5], ['SUR', 2]], 'ROTD-G1': [['DIM', 5], ['SUR', 4]], C04: [['LEAK', 6], ['BAL', 2]], B03: [['BAL', 7], ['DIM', 1]],
  };
  const NOTES = ['Setup piece scrapped at start of run', 'Out of tolerance on first-article check', 'Tool wear suspected, offset adjusted', 'Burr found at inspection, deburr station backed up', 'Supplier lot suspect - held for review',
    'Fixture clamp slipped', 'Operator misload, reloaded', 'Found at final inspection', 'Surface mark from handling', 'Reject after re-test confirmed', 'Part dropped during transfer', 'Rework not possible, scrapped'];
  const DNOTES = ['Waiting on maintenance', 'Sensor fault cleared', 'Jam at feeder', 'Waiting for seal kit delivery', 'Torque tool recalibration', 'Waiting for QA release', 'Changeover to next lot', 'Pneumatic leak repaired'];

  const opByMachine = Object.fromEntries((await q('SELECT machine_id, id, cycle_time_sec FROM operations WHERE tenant_id=$1', [tenantId])).map((o) => [o.machine_id, o]));
  const lineInfo = Object.fromEntries((await q('SELECT id, takt_sec, paced FROM lines WHERE tenant_id=$1', [tenantId])).map((l) => [l.id, l]));
  const operatorFor = (code) => (['A05', 'A06'].includes(code) ? users.operator : mach[code].line === 'A' ? users.lead : mach[code].line === 'CL' ? users.castOp : mach[code].line === 'RL' ? users.rotorAdmin : users.supervisor);

  let n = 0;
  for (let d = -45; d <= -1; d++) {
    const date = day(d);
    if (new Date(date + 'T00:00:00Z').getUTCDay() === 0) continue; // no Sunday production
    const trend = (d + 45) / 45 * 0.02; // slow improvement over the period
    for (const [code, m] of Object.entries(mach)) {
      const op = opByMachine[m.id];
      const li = lineInfo[line[m.line]];
      const ideal = li.paced && li.takt_sec ? Math.max(op.cycle_time_sec, li.takt_sec) : op.cycle_time_sec;
      const [a0, p0, q0] = PROFILE[code] || [0.90, 0.965, 0.985];
      for (const sh of shifts.slice(0, m.line === 'CL' || m.line === 'RL' ? 1 : 2)) {
        const planned = 27000;
        const av = Math.min(0.985, Math.max(0.6, a0 + trend + between(-0.07, 0.06)));
        const pf = Math.min(1, Math.max(0.75, p0 + between(-0.05, 0.035)));
        const ql = Math.min(0.999, Math.max(0.85, q0 + trend / 2 + between(-0.035, 0.02)));
        const dtTotal = Math.round(planned * (1 - av));
        const run = planned - dtTotal;
        const total = Math.round((run / ideal) * pf);
        const bad = Math.round(total * (1 - ql));
        const scrapQty = Math.round(bad * 0.72);
        const rework = bad - scrapQty;
        const recent = d >= -2;
        const status = recent ? weighted([['submitted', 3], ['approved', 1]]) : 'approved';
        const logId = await ins('production_logs', {
          ...T, machine_id: m.id, operation_id: op.id, job_id: m.line === 'A' ? job.J1 : m.line === 'B' ? job.J3 : m.line === 'C' ? job.J4 : null, shift_id: sh.id, log_date: date,
          planned_time_sec: planned, ideal_cycle_sec: ideal, good_count: total - scrapQty - rework, rework_count: rework, status, operator_id: operatorFor(code),
          approved_by: status === 'approved' ? users.lead : null, approved_at: status === 'approved' ? new Date(date + 'T22:00:00Z') : null,
        });
        // split downtime into 1-4 events
        let left = dtTotal;
        const events = Math.min(4, 1 + Math.floor(rnd() * 4));
        for (let i = 0; i < events && left > 60; i++) {
          const dur = i === events - 1 ? left : Math.round(left * between(0.25, 0.6));
          left -= dur;
          await ins('downtime_events', { ...T, log_id: logId, reason_id: R('downtime', weighted(DOWN[code] || DOWN.default)), duration_sec: Math.max(dur, 30), notes: rnd() < 0.5 ? pick(DNOTES) : null });
        }
        // scheduled break stop recorded as planned maintenance occasionally
        if (rnd() < 0.06) await ins('downtime_events', { ...T, log_id: logId, reason_id: R('downtime', 'PM'), duration_sec: 900, notes: 'Planned lubrication / PM check' });
        // scrap events
        let sLeft = scrapQty;
        while (sLeft > 0) {
          const qty = Math.min(sLeft, Math.max(1, Math.round(sLeft * between(0.3, 0.8))));
          sLeft -= qty;
          await ins('scrap_events', { ...T, log_id: logId, reason_id: R('scrap', weighted(SCRAP[code] || SCRAP.default)), qty, notes: rnd() < 0.7 ? pick(NOTES) : null });
        }
        n++;
      }
    }
  }
  console.log(`Seeded ${n} production logs`);
});

await pool.end();
console.log('Done. Sign in with company code "apex" and any demo email, password Welcome1!');
