// Declarative definition of master/config entities served by the generic CRUD router (crud.js).
// t = column type, req = required on create, ref = FK table (tenant-checked), scopeKind = value must be inside the actor's record scope.
const text = (n, o = {}) => ({ n, t: 'text', ...o });
const num = (n, o = {}) => ({ n, t: 'num', ...o });
const int = (n, o = {}) => ({ n, t: 'int', ...o });
const bool = (n, o = {}) => ({ n, t: 'bool', ...o });
const date = (n, o = {}) => ({ n, t: 'date', ...o });
const en = (n, values, o = {}) => ({ n, t: 'enum', values, ...o });
const ref = (n, table, o = {}) => ({ n, t: 'uuid', ref: table, ...o });

export const ENTITIES = {
  organizations: {
    table: 'organizations', perm: 'organizations', scope: { type: 'org', col: 'id' }, order: 't.type, t.name', search: ['t.name', 't.code'], filters: ['type', 'active'],
    cols: [text('code', { req: true }), text('name', { req: true }), en('type', ['internal', 'supplier', 'customer'], { req: true }), text('contact_email'), bool('active')],
  },
  sites: {
    table: 'sites', perm: 'sites', scope: { type: 'site', col: 'id' }, order: 't.name', search: ['t.name', 't.code', 't.city'], filters: ['org_id', 'active'],
    joins: 'LEFT JOIN organizations o ON o.id = t.org_id', extra: 'o.name AS org_name',
    cols: [ref('org_id', 'organizations', { req: true, scopeKind: 'org' }), text('code', { req: true }), text('name', { req: true }), text('city'), text('country'), text('timezone'), bool('active')],
  },
  lines: {
    table: 'lines', perm: 'lines', scope: { type: 'line', col: 'id' }, order: 's.name, t.name', search: ['t.name', 't.code'], filters: ['site_id', 'org_id', 'active'],
    joins: 'LEFT JOIN sites s ON s.id = t.site_id', extra: 's.name AS site_name',
    cols: [ref('site_id', 'sites', { req: true, scopeKind: 'site' }), text('code', { req: true }), text('name', { req: true }), text('layout'), num('takt_sec'), bool('paced'), bool('active')],
    derive: async (d, { one }) => { if (d.site_id) d.org_id = (await one('SELECT org_id FROM sites WHERE id=$1', [d.site_id])).org_id; },
  },
  machines: {
    table: 'machines', perm: 'machines', scope: { type: 'machine', col: 'id' }, order: 'l.name, t.station_no NULLS LAST, t.name', search: ['t.name', 't.code', 't.machine_type'], filters: ['line_id', 'site_id', 'org_id', 'active'],
    joins: 'LEFT JOIN lines l ON l.id = t.line_id LEFT JOIN sites s ON s.id = t.site_id', extra: 'l.name AS line_name, s.name AS site_name',
    cols: [ref('line_id', 'lines', { req: true, scopeKind: 'line' }), text('code', { req: true }), text('name', { req: true }), text('machine_type'), int('station_no'), bool('active')],
    derive: async (d, { one }) => { if (d.line_id) { const l = await one('SELECT org_id, site_id FROM lines WHERE id=$1', [d.line_id]); d.org_id = l.org_id; d.site_id = l.site_id; } },
  },
  parts: {
    table: 'parts', perm: 'parts', scope: { type: 'parts' }, scopeExternalOnly: true, order: 't.part_no', search: ['t.part_no', 't.name'], filters: ['part_type', 'active'],
    cols: [text('part_no', { req: true }), text('name', { req: true }), en('part_type', ['raw', 'component', 'subassembly', 'finished'], { req: true }), text('uom'), num('unit_cost'), bool('active')],
  },
  operations: {
    table: 'operations', perm: 'operations', scope: { type: 'machine', col: 'machine_id' }, order: 'p.part_no, t.seq', search: ['t.name', 'p.name', 'm.name'], filters: ['part_id', 'machine_id'],
    joins: 'LEFT JOIN parts p ON p.id = t.part_id LEFT JOIN machines m ON m.id = t.machine_id LEFT JOIN lines l ON l.id = m.line_id',
    extra: 'p.part_no, p.name AS part_name, m.name AS machine_name, l.name AS line_name',
    cols: [ref('part_id', 'parts', { req: true }), ref('machine_id', 'machines', { req: true, scopeKind: 'machine' }), int('seq', { req: true }), text('name', { req: true }),
      num('cycle_time_sec', { req: true }), num('manual_time_sec'), text('operator_group')],
  },
  jobs: {
    table: 'jobs', perm: 'jobs', scope: { type: 'site', col: 'site_id' }, order: 't.due_date NULLS LAST, t.job_no', search: ['t.job_no', 'p.name', 'p.part_no'], filters: ['site_id', 'line_id', 'status', 'part_id'],
    joins: 'LEFT JOIN parts p ON p.id = t.part_id LEFT JOIN sites s ON s.id = t.site_id LEFT JOIN lines l ON l.id = t.line_id',
    extra: 'p.part_no, p.name AS part_name, s.name AS site_name, l.name AS line_name',
    cols: [ref('site_id', 'sites', { req: true, scopeKind: 'site' }), ref('line_id', 'lines', { scopeKind: 'line' }), text('job_no', { req: true }), ref('part_id', 'parts', { req: true }),
      num('qty_planned', { req: true }), num('qty_done'), date('due_date'), en('status', ['open', 'running', 'complete', 'cancelled'])],
    derive: async (d, { one }) => { if (d.site_id) d.org_id = (await one('SELECT org_id FROM sites WHERE id=$1', [d.site_id])).org_id; },
  },
  inventory_levels: {
    table: 'inventory_levels', perm: 'inventory_levels', scope: { type: 'site', col: 'site_id' }, order: 's.name, p.part_no', search: ['p.part_no', 'p.name'], filters: ['site_id', 'part_id'],
    joins: 'LEFT JOIN parts p ON p.id = t.part_id LEFT JOIN sites s ON s.id = t.site_id', extra: 'p.part_no, p.name AS part_name, p.uom, s.name AS site_name',
    cols: [ref('site_id', 'sites', { req: true, scopeKind: 'site' }), ref('part_id', 'parts', { req: true }), num('on_hand'), num('safety_stock'), num('reorder_point'), num('avg_daily_usage')],
    derive: async (d, { one }) => { if (d.site_id) d.org_id = (await one('SELECT org_id FROM sites WHERE id=$1', [d.site_id])).org_id; d.updated_at = new Date(); },
  },
  purchase_orders: {
    table: 'purchase_orders', perm: 'purchase_orders', scope: { type: 'site_or_supplier' }, order: 't.order_date DESC, t.po_no', search: ['t.po_no', 'so.name'], filters: ['supplier_org_id', 'site_id', 'status'],
    joins: 'LEFT JOIN organizations so ON so.id = t.supplier_org_id LEFT JOIN sites s ON s.id = t.site_id',
    extra: `so.name AS supplier_name, s.name AS site_name,
      (SELECT SUM(l.qty * COALESCE(l.unit_cost,0)) FROM po_lines l WHERE l.po_id = t.id) AS po_value,
      (SELECT COUNT(*) FROM po_lines l WHERE l.po_id = t.id) AS line_count,
      (SELECT MIN(l.due_date) FROM po_lines l WHERE l.po_id = t.id AND l.qty_received < l.qty) AS next_due`,
    cols: [text('po_no', { req: true }), ref('supplier_org_id', 'organizations', { req: true }), ref('site_id', 'sites', { req: true, scopeKind: 'site' }), date('order_date', { req: true }),
      en('status', ['draft', 'open', 'partial', 'received', 'cancelled']), text('notes')],
  },
  shipments: {
    table: 'shipments', perm: 'shipments', scope: { type: 'site_or_supplier' }, order: 't.eta NULLS LAST, t.shipment_no', search: ['t.shipment_no', 'po.po_no', 't.tracking_no'], filters: ['supplier_org_id', 'site_id', 'status', 'po_id'],
    joins: 'LEFT JOIN purchase_orders po ON po.id = t.po_id LEFT JOIN organizations so ON so.id = t.supplier_org_id LEFT JOIN sites s ON s.id = t.site_id',
    extra: `po.po_no, so.name AS supplier_name, s.name AS site_name,
      (SELECT COALESCE(SUM(sl.qty),0) FROM shipment_lines sl WHERE sl.shipment_id = t.id) AS total_qty,
      (SELECT MIN(pl.due_date) FROM shipment_lines sl JOIN po_lines pl ON pl.id = sl.po_line_id WHERE sl.shipment_id = t.id) AS po_due`,
    cols: [text('shipment_no', { req: true }), ref('po_id', 'purchase_orders', { req: true }), en('status', ['planned', 'in_transit', 'delayed', 'delivered', 'cancelled']),
      date('ship_date'), date('eta'), date('delivered_on'), text('carrier'), text('tracking_no'), text('delay_reason'), text('notes')],
    derive: async (d, { one }) => { if (d.po_id) { const p = await one('SELECT supplier_org_id, site_id FROM purchase_orders WHERE id=$1', [d.po_id]); d.supplier_org_id = p.supplier_org_id; d.site_id = p.site_id; } },
  },
  reason_codes: {
    table: 'reason_codes', perm: 'reason_codes', noCustom: true, order: 't.kind, t.name', search: ['t.name', 't.code'], filters: ['kind', 'active'],
    cols: [en('kind', ['scrap', 'downtime'], { req: true }), text('code', { req: true }), text('name', { req: true }), text('category'), bool('planned'), bool('active')],
  },
  shifts: {
    table: 'shifts', perm: 'shifts', noCustom: true, order: 't.start_time', search: ['t.name'], filters: [],
    cols: [text('name', { req: true }), { n: 'start_time', t: 'time', req: true }, { n: 'end_time', t: 'time', req: true }, int('planned_break_min')],
  },
  custom_fields: {
    table: 'custom_fields', perm: 'custom_fields', order: 't.entity, t.sort_order', search: ['t.label', 't.key'], filters: ['entity'], noCustom: true,
    cols: [en('entity', ['organizations', 'sites', 'lines', 'machines', 'parts', 'operations', 'jobs', 'production_logs', 'purchase_orders', 'shipments', 'inventory_levels'], { req: true }),
      text('key', { req: true }), text('label', { req: true }), en('type', ['text', 'number', 'date', 'boolean', 'select'], { req: true }), { n: 'options', t: 'json' }, bool('required'), int('sort_order')],
  },
};
