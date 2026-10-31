-- Smart TAKT Board — PostgreSQL schema (multi-tenant SaaS, shared schema, tenant_id on every row)
-- Idempotent: drops and recreates everything. Run via `npm run db:reset` (never against production).

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Tenancy & configuration ─────────────
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,              -- "company code" typed at login
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'standard',
  -- configuration: terminology overrides, enabled modules, OEE thresholds, currency, etc.
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Organizations: the tenant's own company (internal / first party) and its suppliers (third party)
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('internal','supplier','customer')),
  contact_email text,
  active      boolean NOT NULL DEFAULT true,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- ───────────── Security: users, roles, CRED, field security, record scope ─────────────
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  persona     text,                              -- operator | lead | supervisor | manager | plant_manager | executive | ...
  is_system   boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, name)
);

-- Feature + object permissions. "CRED" = Create / Read / Edit / Delete, plus approve for workflow objects.
CREATE TABLE role_permissions (
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource    text NOT NULL,                     -- see server/src/security/resources.js
  can_create  boolean NOT NULL DEFAULT false,
  can_read    boolean NOT NULL DEFAULT false,
  can_edit    boolean NOT NULL DEFAULT false,
  can_delete  boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, resource)
);

-- Field-level security: hidden = removed from responses and writes, read = visible but not writable
CREATE TABLE field_security (
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource    text NOT NULL,
  field       text NOT NULL,
  access      text NOT NULL CHECK (access IN ('hidden','read')),
  PRIMARY KEY (role_id, resource, field)
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  role_id     uuid NOT NULL REFERENCES roles(id),
  email       text NOT NULL,
  full_name   text NOT NULL,
  title       text,
  password_hash text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  last_login  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Record-level visibility: which part of the hierarchy a user can see / act on.
-- scope_type: tenant (everything) | org | site | line | machine | part (manager of a part/component)
CREATE TABLE user_scopes (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type  text NOT NULL CHECK (scope_type IN ('tenant','org','site','line','machine','part')),
  scope_id    uuid,
  UNIQUE (user_id, scope_type, scope_id)
);
CREATE UNIQUE INDEX user_scopes_tenant_uq ON user_scopes(user_id) WHERE scope_type = 'tenant';

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid,
  action      text NOT NULL,                     -- create | update | delete | approve | login | ...
  resource    text NOT NULL,
  record_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_time ON audit_log(tenant_id, created_at DESC);

-- Tenant-defined extra fields (stored in the `custom` jsonb column of the target table)
CREATE TABLE custom_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity      text NOT NULL,
  key         text NOT NULL,
  label       text NOT NULL,
  type        text NOT NULL CHECK (type IN ('text','number','date','boolean','select')),
  options     jsonb,                             -- for select: ["A","B"]
  required    boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, entity, key)
);

-- Configurable KPI targets / thresholds (green >= target, amber >= warn)
CREATE TABLE kpi_targets (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric      text NOT NULL,                     -- oee | availability | performance | quality | scrap_rate | otd | ...
  target      numeric NOT NULL,
  warn        numeric NOT NULL,
  direction   text NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher','lower')),
  PRIMARY KEY (tenant_id, metric)
);

CREATE TABLE reason_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('scrap','downtime')),
  code        text NOT NULL,
  name        text NOT NULL,
  category    text,                              -- downtime: breakdown | changeover | material | quality | planned ...
  planned     boolean NOT NULL DEFAULT false,    -- downtime only: planned stops do not hurt availability
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, kind, code)
);

CREATE TABLE shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  planned_break_min int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);

-- ───────────── Plant hierarchy: org → site → line → machine/workcenter ─────────────
CREATE TABLE sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  code        text NOT NULL,
  name        text NOT NULL,
  city        text,
  country     text,
  timezone    text NOT NULL DEFAULT 'UTC',
  active      boolean NOT NULL DEFAULT true,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, code)
);

CREATE TABLE lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  layout      text DEFAULT 'U-shaped',
  takt_sec    numeric,                           -- target takt for the line (available time / customer demand)
  paced       boolean NOT NULL DEFAULT true,     -- paced lines use takt as the ideal cycle for OEE
  active      boolean NOT NULL DEFAULT true,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, code)
);

CREATE TABLE machines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  line_id     uuid NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  machine_type text,                             -- manual station | automated | test bench | ...
  station_no  int,                               -- position in the line flow
  active      boolean NOT NULL DEFAULT true,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, code)
);
CREATE INDEX machines_line ON machines(line_id);

-- ───────────── Product structure ─────────────
CREATE TABLE parts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  part_no     text NOT NULL,
  name        text NOT NULL,
  part_type   text NOT NULL CHECK (part_type IN ('raw','component','subassembly','finished')),
  uom         text NOT NULL DEFAULT 'EA',
  unit_cost   numeric(14,4),                     -- sensitive: field-level security target
  active      boolean NOT NULL DEFAULT true,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, part_no)
);

CREATE TABLE bom (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  child_part_id  uuid NOT NULL REFERENCES parts(id),
  qty_per     numeric NOT NULL DEFAULT 1,
  PRIMARY KEY (parent_part_id, child_part_id)
);

-- Operation = a routing step: what is done to a part, on which machine/station
CREATE TABLE operations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  part_id     uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  machine_id  uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  seq         int NOT NULL,
  name        text NOT NULL,
  cycle_time_sec   numeric NOT NULL,             -- station cycle time
  manual_time_sec  numeric NOT NULL DEFAULT 0,   -- operator work content (Yamazumi); automated time excluded
  operator_group   text,                         -- which operator covers this step (A, B, C...)
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (part_id, seq)
);

-- Which routing step of the parent consumes this component (optional); drives the part lifecycle flow
ALTER TABLE bom ADD COLUMN operation_id uuid REFERENCES operations(id) ON DELETE SET NULL;

CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  site_id     uuid NOT NULL REFERENCES sites(id),
  line_id     uuid REFERENCES lines(id),
  job_no      text NOT NULL,
  part_id     uuid NOT NULL REFERENCES parts(id),
  qty_planned numeric NOT NULL,
  qty_done    numeric NOT NULL DEFAULT 0,
  due_date    date,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','running','complete','cancelled')),
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, job_no)
);

-- ───────────── Shop-floor capture (OEE) ─────────────
-- One production log = one machine, one operation, one shift. Downtime and scrap are child events.
CREATE TABLE production_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  machine_id  uuid NOT NULL REFERENCES machines(id),
  operation_id uuid REFERENCES operations(id),
  job_id      uuid REFERENCES jobs(id),
  shift_id    uuid REFERENCES shifts(id),
  log_date    date NOT NULL,
  planned_time_sec numeric NOT NULL,             -- planned production time (shift minus planned breaks)
  ideal_cycle_sec  numeric NOT NULL,
  good_count  numeric NOT NULL DEFAULT 0,
  rework_count numeric NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','approved','rejected')),
  operator_id uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  notes       text,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plogs_machine_date ON production_logs(machine_id, log_date);
CREATE INDEX plogs_tenant_date ON production_logs(tenant_id, log_date);

CREATE TABLE downtime_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  log_id      uuid NOT NULL REFERENCES production_logs(id) ON DELETE CASCADE,
  reason_id   uuid NOT NULL REFERENCES reason_codes(id),
  duration_sec numeric NOT NULL CHECK (duration_sec > 0),
  started_at  timestamptz,
  notes       text,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX downtime_log ON downtime_events(log_id);

CREATE TABLE scrap_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  log_id      uuid NOT NULL REFERENCES production_logs(id) ON DELETE CASCADE,
  reason_id   uuid NOT NULL REFERENCES reason_codes(id),
  qty         numeric NOT NULL CHECK (qty > 0),
  occurred_at timestamptz,
  notes       text,                              -- "Operator Notes" in the Quality report
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX scrap_log ON scrap_events(log_id);

-- ───────────── Supply chain: suppliers, POs, shipments, inventory ─────────────
CREATE TABLE supplier_parts (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),   -- the supplier
  part_id     uuid NOT NULL REFERENCES parts(id),
  lead_time_days int NOT NULL DEFAULT 14,
  min_order_qty  numeric NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, part_id)
);

CREATE TABLE purchase_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_no       text NOT NULL,
  supplier_org_id uuid NOT NULL REFERENCES organizations(id),
  site_id     uuid NOT NULL REFERENCES sites(id),           -- receiving site
  order_date  date NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','partial','received','cancelled')),
  notes       text,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, po_no)
);

CREATE TABLE po_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id       uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id     uuid NOT NULL REFERENCES parts(id),
  qty         numeric NOT NULL,
  qty_received numeric NOT NULL DEFAULT 0,
  unit_cost   numeric(14,4),                     -- sensitive
  due_date    date NOT NULL
);

-- Supplier-entered advance ship notice
CREATE TABLE shipments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_no text NOT NULL,
  po_id       uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_org_id uuid NOT NULL REFERENCES organizations(id),
  site_id     uuid NOT NULL REFERENCES sites(id),
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_transit','delayed','delivered','cancelled')),
  ship_date   date,
  eta         date,
  delivered_on date,
  carrier     text,
  tracking_no text,
  delay_reason text,
  notes       text,
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shipment_no)
);

CREATE TABLE shipment_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  po_line_id  uuid NOT NULL REFERENCES po_lines(id),
  part_id     uuid NOT NULL REFERENCES parts(id),
  qty         numeric NOT NULL
);

-- Stock at any site (the tenant's plants and, when shared, supplier sites)
CREATE TABLE inventory_levels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  site_id     uuid NOT NULL REFERENCES sites(id),
  part_id     uuid NOT NULL REFERENCES parts(id),
  on_hand     numeric NOT NULL DEFAULT 0,
  safety_stock numeric NOT NULL DEFAULT 0,
  reorder_point numeric NOT NULL DEFAULT 0,
  avg_daily_usage numeric NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (site_id, part_id)
);

CREATE TABLE inventory_transactions (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL,
  part_id     uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('receipt','issue','adjustment')),
  qty         numeric NOT NULL,
  ref         text,
  user_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Reporting view: one row per production log with all OEE building blocks ─────────────
CREATE VIEW v_log_metrics AS
SELECT
  l.id AS log_id, l.tenant_id, l.machine_id, m.line_id, m.site_id, m.org_id,
  l.operation_id, l.job_id, l.shift_id, l.log_date, l.status,
  l.planned_time_sec, l.ideal_cycle_sec, l.good_count, l.rework_count,
  COALESCE(s.scrap, 0)  AS scrap_count,
  COALESCE(d.unplanned, 0) AS downtime_sec,
  COALESCE(d.planned, 0)   AS planned_stop_sec,
  l.good_count + l.rework_count + COALESCE(s.scrap, 0) AS total_count
FROM production_logs l
JOIN machines m ON m.id = l.machine_id
LEFT JOIN LATERAL (SELECT SUM(qty) AS scrap FROM scrap_events WHERE log_id = l.id) s ON true
LEFT JOIN LATERAL (
  SELECT SUM(e.duration_sec) FILTER (WHERE NOT r.planned) AS unplanned,
         SUM(e.duration_sec) FILTER (WHERE r.planned)     AS planned
  FROM downtime_events e JOIN reason_codes r ON r.id = e.reason_id WHERE e.log_id = l.id) d ON true
WHERE l.status <> 'rejected' AND l.status <> 'draft';
