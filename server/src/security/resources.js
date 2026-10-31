// Registry of everything a role can be granted. `kind: feature` = menu/report access (Read is what matters),
// `kind: object` = data object (full Create / Read / Edit / Delete, plus Approve where there is a workflow).
export const RESOURCES = [
  { key: 'dashboard.executive', label: 'Executive Dashboard', group: 'Dashboards', kind: 'feature' },
  { key: 'dashboard.plant', label: 'Plant / Line Dashboard', group: 'Dashboards', kind: 'feature' },
  { key: 'supply.dashboard', label: 'Supply Chain Dashboard', group: 'Dashboards', kind: 'feature' },
  { key: 'report.quality', label: 'Quality Report (Pareto & Rejects)', group: 'Reports', kind: 'feature' },
  { key: 'report.oee', label: 'OEE Report', group: 'Reports', kind: 'feature' },
  { key: 'report.downtime', label: 'Downtime Report', group: 'Reports', kind: 'feature' },
  { key: 'report.balance', label: 'Line Balance (Yamazumi)', group: 'Reports', kind: 'feature' },
  { key: 'production_logs', label: 'Production Logs (incl. downtime & scrap)', group: 'Shop Floor', kind: 'object', approve: true },
  { key: 'jobs', label: 'Jobs / Work Orders', group: 'Shop Floor', kind: 'object' },
  { key: 'purchase_orders', label: 'Purchase Orders', group: 'Supply Chain', kind: 'object' },
  { key: 'shipments', label: 'Shipments (ASN)', group: 'Supply Chain', kind: 'object', approve: true },
  { key: 'inventory_levels', label: 'Inventory', group: 'Supply Chain', kind: 'object' },
  { key: 'organizations', label: 'Organizations / Suppliers', group: 'Master Data', kind: 'object' },
  { key: 'sites', label: 'Sites / Plants', group: 'Master Data', kind: 'object' },
  { key: 'lines', label: 'Assembly Lines', group: 'Master Data', kind: 'object' },
  { key: 'machines', label: 'Machines / Workcenters', group: 'Master Data', kind: 'object' },
  { key: 'parts', label: 'Parts & Products', group: 'Master Data', kind: 'object' },
  { key: 'operations', label: 'Operations (Routing)', group: 'Master Data', kind: 'object' },
  { key: 'users', label: 'Users', group: 'Administration', kind: 'object' },
  { key: 'roles', label: 'Roles & Permissions', group: 'Administration', kind: 'object' },
  { key: 'settings', label: 'Tenant Settings & KPI Targets', group: 'Administration', kind: 'object' },
  { key: 'reason_codes', label: 'Scrap & Downtime Reasons', group: 'Administration', kind: 'object' },
  { key: 'shifts', label: 'Shifts', group: 'Administration', kind: 'object' },
  { key: 'custom_fields', label: 'Custom Fields', group: 'Administration', kind: 'object' },
  { key: 'audit', label: 'Audit Log', group: 'Administration', kind: 'object' },
];
export const RESOURCE_KEYS = RESOURCES.map((r) => r.key);

// Fields that can be hidden / made read-only per role (field-level security)
export const SECURABLE_FIELDS = {
  parts: ['unit_cost'],
  purchase_orders: ['po_value'],
  po_lines: ['unit_cost'],
  production_logs: ['operator_name'],
  inventory_levels: ['avg_daily_usage'],
};

export const DEFAULT_LABELS = {
  site: 'Plant', line: 'Assembly Line', machine: 'Machine', operation: 'Operation',
  part: 'Part', job: 'Job', operator: 'Operator', supplier: 'Supplier',
};

export const DEFAULT_TARGETS = [
  ['oee', 80, 65, 'higher'], ['availability', 90, 80, 'higher'], ['performance', 95, 85, 'higher'],
  ['quality', 98, 95, 'higher'], ['scrap_rate', 2, 4, 'lower'], ['otd', 95, 85, 'higher'],
];
