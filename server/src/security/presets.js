// Starter roles every new tenant receives (system roles can be cloned / adjusted in the UI).
// perm string: c r e d a  (Create, Read, Edit, Delete, Approve)
import { RESOURCE_KEYS } from './resources.js';

const ALL_READ = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 'r']));

export const ROLE_PRESETS = [
  {
    name: 'Tenant Admin', persona: 'admin', description: 'Configures the platform, users and security. Full access.',
    perms: Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 'creda'])), hidden: [],
  },
  {
    name: 'Executive', persona: 'executive', description: 'Leadership: enterprise dashboards, reports and supply chain visibility (read only).',
    perms: { ...ALL_READ, users: '', roles: '', settings: '', audit: '', custom_fields: '', shifts: 'r', reason_codes: 'r' }, hidden: [],
  },
  {
    name: 'Plant Manager (GM)', persona: 'plant_manager',
    description: 'Runs the plant: budget, quality, staffing, efficiency. Full plant visibility and approval rights.',
    perms: {
      ...ALL_READ, production_logs: 'creda', jobs: 'creda', machines: 'cre', lines: 'cre', sites: 'r', operations: 'cre', parts: 'cre',
      inventory_levels: 'cre', purchase_orders: 'r', shipments: 'r', reason_codes: 'cre', shifts: 'cre', users: 'r', roles: '', settings: '', audit: 'r', custom_fields: '',
    }, hidden: [],
  },
  {
    name: 'Manager', persona: 'manager', description: 'Manages operations of a part or component; accountable for its OEE.',
    perms: {
      ...ALL_READ, production_logs: 'crea', jobs: 're', operations: 're', parts: 're', machines: 'r', inventory_levels: 'r',
      users: '', roles: '', settings: '', audit: '', custom_fields: '', 'dashboard.executive': '', purchase_orders: 'r', shipments: 'r',
    }, hidden: [],
  },
  {
    name: 'Supervisor', persona: 'supervisor', description: 'Supervises several assembly lines across shifts; approves logs and manages line staffing.',
    perms: {
      'dashboard.plant': 'r', 'report.quality': 'r', 'report.oee': 'r', 'report.downtime': 'r', 'report.balance': 'r',
      production_logs: 'crea', jobs: 're', machines: 'r', lines: 'r', sites: 'r', operations: 'r', parts: 'r', inventory_levels: 'r',
      reason_codes: 'r', shifts: 'r', organizations: 'r',
    }, hidden: ['parts.unit_cost'],
  },
  {
    name: 'Lead', persona: 'lead', description: 'Operations lead for one assembly line; inputs and approves logs for all machines on the line.',
    perms: {
      'dashboard.plant': 'r', 'report.quality': 'r', 'report.oee': 'r', 'report.downtime': 'r', 'report.balance': 'r',
      production_logs: 'crea', jobs: 'r', machines: 'r', lines: 'r', sites: 'r', operations: 'r', parts: 'r', reason_codes: 'r', shifts: 'r',
    }, hidden: ['parts.unit_cost'],
  },
  {
    name: 'Operator', persona: 'operator', description: 'Operates machines; records production, downtime and scrap for assigned machines.',
    perms: {
      'dashboard.plant': 'r', 'report.quality': 'r', production_logs: 'cre', jobs: 'r', machines: 'r', lines: 'r', sites: 'r', operations: 'r', parts: 'r',
      reason_codes: 'r', shifts: 'r',
    }, hidden: ['parts.unit_cost', 'purchase_orders.po_value'],
  },
  {
    name: 'Supply Chain Planner', persona: 'planner', description: 'Plans materials: purchase orders, inbound shipments, inventory and supplier performance.',
    perms: {
      ...ALL_READ, 'dashboard.executive': '', purchase_orders: 'creda', shipments: 'creda', inventory_levels: 'creda', parts: 'cre', organizations: 'cre',
      production_logs: 'r', users: '', roles: '', settings: '', audit: '', custom_fields: '', reason_codes: 'r',
    }, hidden: [],
  },
  {
    name: 'Quality Engineer', persona: 'quality', description: 'Analyses scrap, rework and downtime; maintains reason codes.',
    perms: {
      'dashboard.plant': 'r', 'report.quality': 'r', 'report.oee': 'r', 'report.downtime': 'r', 'report.balance': 'r',
      production_logs: 're', machines: 'r', lines: 'r', sites: 'r', operations: 'r', parts: 'r', jobs: 'r', reason_codes: 'cre', shifts: 'r',
    }, hidden: ['parts.unit_cost'],
  },
  {
    name: 'Supplier Admin', persona: 'supplier_admin', description: 'Third-party supplier lead: manages own shipments, stock and shop-floor data.',
    perms: {
      'dashboard.plant': 'r', 'supply.dashboard': 'r', 'report.quality': 'r', 'report.oee': 'r', 'report.downtime': 'r',
      production_logs: 'crea', shipments: 'cred', purchase_orders: 'r', inventory_levels: 'cre', machines: 'r', lines: 'r', sites: 'r',
      operations: 'r', parts: 'r', jobs: 'r', organizations: 'r', reason_codes: 'r', shifts: 'r',
    }, hidden: ['parts.unit_cost'],
  },
  {
    name: 'Supplier User', persona: 'supplier_operator', description: 'Third-party supplier operator: updates shipments, stock and production data.',
    perms: {
      'dashboard.plant': 'r', production_logs: 'cre', shipments: 'cre', purchase_orders: 'r', inventory_levels: 're', machines: 'r', lines: 'r',
      sites: 'r', operations: 'r', parts: 'r', reason_codes: 'r', shifts: 'r', 'report.quality': 'r',
    }, hidden: ['parts.unit_cost'],
  },
];

export function permFlags(str) {
  return { c: str.includes('c'), r: str.includes('r'), e: str.includes('e'), d: str.includes('d'), a: str.includes('a') };
}
