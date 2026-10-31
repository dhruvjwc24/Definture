# Smart TAKT Board — Functional Requirements

Priority key: M = Must (Release 1), S = Should (Release 1 if capacity allows), P2 = Phase 2, P3 = Phase 3.

## 1. Personas and Roles

### 1.1 Role-vs-persona matrix (default seeded roles; all editable per tenant)

| Role | Persona | Scope (record visibility) | Key capabilities |
|---|---|---|---|
| Tenant Admin | System administrator | Tenant | Full CRED on all configuration, users, roles, master data; audit |
| Executive | Corporate leadership | Tenant | Read all dashboards and reports, supply-chain risk; no data entry |
| Plant Manager / GM | Runs the plant | Site(s) | Plant dashboards, all reports, approve logs, read inventory; edit master data for site |
| Manager | Owner of a part/component | Part(s) | Reports for machines running the part's operations; accountable for OEE |
| Supervisor | Multi-line supervisor | Line(s) | View and approve logs across lines; line balance; staffing (Phase 2) |
| Lead | Line operations lead | Line | View all machines in line; create/edit/approve logs for the line |
| Operator | Machine operator | Machine(s) | Create and view own machines' logs, downtime and scrap |
| Quality Engineer | Quality | Tenant or site | Quality report, scrap Pareto, rejects log; read-only elsewhere |
| Supply Chain Planner | Procurement | Tenant or site | Inventory, POs, shipments, supplier scorecard, material risk |
| Supplier Admin | Third-party admin | Supplier org | Manage own org's users (optional), own production and shipments |
| Supplier Operator | Third-party operator | Supplier org / machines | Enter own production logs and shipments |

### 1.2 Difference between Lead and Supervisor (answers the open question in the requirements document)

| Aspect | Lead | Supervisor |
|---|---|---|
| Span | One assembly line | Several assembly lines |
| Time horizon | Current shift, hands-on | Across shifts, day/week |
| Data entry | Enters and approves logs for the line, corrects operator entries | Approves/reviews; handles exceptions and escalations |
| People | Coordinates operators on the shift | Manages staffing and assignments across lines (Phase 2 module) |
| Plan | Meets hourly/shift output | Schedule adherence, line rebalancing, overtime decisions |
| Escalation | Raises to supervisor | Receives from leads; escalates to manager/GM |

## 2. Functional Requirements

### 2.1 Tenancy and Configuration (TEN)

| ID | Requirement | Pri |
|---|---|---|
| FR-TEN-001 | The system shall isolate all data by tenant; every business table carries `tenant_id` and every query is filtered by the authenticated user's tenant. | M |
| FR-TEN-002 | Users shall sign in with company code, email and password. | M |
| FR-TEN-003 | A tenant shall support multiple organizations of type internal, supplier or customer. | M |
| FR-TEN-004 | A tenant administrator shall configure terminology overrides (e.g. "Line" to "Cell", "Machine" to "Workcenter"). | S |
| FR-TEN-005 | A tenant administrator shall configure KPI targets and warning thresholds (OEE, availability, performance, quality, scrap rate, OTD) with direction higher/lower. | M |
| FR-TEN-006 | A tenant administrator shall maintain scrap and downtime reason codes, including category and planned/unplanned flag for downtime. | M |
| FR-TEN-007 | A tenant administrator shall define shifts (name, start, end, planned break minutes). | M |
| FR-TEN-008 | A tenant administrator shall define custom fields (text, number, date, boolean, select; required flag) on supported entities; values are stored in a `custom` JSON column and rendered dynamically in forms and tables. | M |
| FR-TEN-009 | A tenant administrator shall enable or disable modules (e.g. supply chain) via tenant settings. | S |
| FR-TEN-010 | The vendor shall be able to provision a tenant with default roles, reason codes, shifts and KPI targets. | M |

### 2.2 Security (SEC)

| ID | Requirement | Pri |
|---|---|---|
| FR-SEC-001 | Passwords shall be stored hashed (bcrypt); sessions use signed JWTs with expiry. | M |
| FR-SEC-002 | Each role shall have a permission per resource with Create, Read, Edit, Delete (CRED) flags, plus Approve for workflow objects. | M |
| FR-SEC-003 | Navigation items, pages and actions shall be shown only when the role has Read (or the relevant) permission; the server shall enforce the same rules independent of the UI. | M |
| FR-SEC-004 | Field-level security shall allow a role to see a field as hidden or read-only (e.g. `parts.unit_cost`, `po_lines.unit_cost`); hidden fields are removed from responses and ignored on writes. | M |
| FR-SEC-005 | Record-level visibility shall be governed by user scopes: tenant, org, site, line, machine or part. A scope grants access to that node and all descendants. | M |
| FR-SEC-006 | A user may hold multiple scopes; effective visibility is the union. | M |
| FR-SEC-007 | Supplier users shall only see records of their own organization (machines, logs, POs, shipments, inventory) and parts supplied by it. | M |
| FR-SEC-008 | A tenant administrator shall create, clone and edit roles and assign roles and scopes to users. | M |
| FR-SEC-009 | Sensitive actions (create/update/delete/approve/login) shall be written to the audit log with user, resource, record id and detail. | M |
| FR-SEC-010 | Failed logins and inactive users shall be rejected without revealing which factor failed. | M |
| FR-SEC-011 | SSO via OIDC/SAML and MFA. | P2 |

### 2.3 Master Data (MD)

| ID | Requirement | Pri |
|---|---|---|
| FR-MD-001 | Maintain organizations, sites (with timezone), lines (layout, takt seconds, paced flag), machines/workcenters (type, station number). | M |
| FR-MD-002 | Maintain parts of type raw, component, subassembly, finished with UOM and unit cost. | M |
| FR-MD-003 | Maintain single-level BOM (parent part, child part, quantity per). | M |
| FR-MD-004 | Maintain operations (routing steps): part, machine, sequence, name, cycle time, manual time, operator group. | M |
| FR-MD-005 | Maintain jobs: job number, part, site/line, planned and completed quantity, due date, status. | M |
| FR-MD-006 | Maintain supplier-part relationships with lead time and minimum order quantity. | M |
| FR-MD-007 | All master-data lists shall support search, sort and custom fields, and honor CRED and scope. | M |
| FR-MD-008 | Bulk CSV import of master data. | P2 |

### 2.4 Shop-Floor Capture (OPS)

| ID | Requirement | Pri |
|---|---|---|
| FR-OPS-001 | An operator shall create a production log: machine, operation, job, shift, date, planned time, ideal cycle, good count, rework count, notes. | M |
| FR-OPS-002 | Defaults shall be derived from the operation and shift: planned time = shift length minus planned break; ideal cycle = line takt for paced lines, else operation cycle time. | M |
| FR-OPS-003 | A log shall carry any number of downtime events (reason, duration, start, notes) and scrap events (reason, quantity, time, operator notes). | M |
| FR-OPS-004 | Logs follow the states draft, submitted, approved, rejected; users with Approve permission and scope over the machine can approve or reject. | M |
| FR-OPS-005 | Only submitted and approved logs count in analytics; draft and rejected are excluded. | M |
| FR-OPS-006 | Operators see only logs for machines in scope. | M |
| FR-OPS-007 | Validation: non-negative quantities, positive durations, total downtime not exceeding planned time (warning). | M |
| FR-OPS-008 | Automatic machine counts and states via connectors. | P3 |

### 2.5 OEE and TAKT Analytics (OEE)

| ID | Requirement | Pri |
|---|---|---|
| FR-OEE-001 | Availability = (planned time - unplanned downtime) / planned time. | M |
| FR-OEE-002 | Performance = (ideal cycle x total count) / run time, where run time = planned time - unplanned downtime. | M |
| FR-OEE-003 | Quality = good count / total count, where total = good + rework + scrap. | M |
| FR-OEE-004 | OEE = Availability x Performance x Quality, aggregated by summing building blocks (time-weighted), not by averaging percentages. | M |
| FR-OEE-005 | Metrics shall be filterable by date range, org, site, line, machine and shift, within the user's scope. | M |
| FR-OEE-006 | Daily trend of OEE, A, P, Q. | M |
| FR-OEE-007 | Machine ranking by OEE and identification of bottleneck (lowest OEE or longest cycle in line). | M |
| FR-OEE-008 | OEE loss breakdown: planned time, downtime loss, speed loss, quality loss, fully productive time. | M |
| FR-OEE-009 | Output vs plan (ideal output) and takt attainment. | M |
| FR-OEE-010 | KPI tiles coloured against tenant targets (green, amber, red in muted tones). | M |
| FR-OEE-011 | Takt helper: takt = available time / customer demand. | S |

### 2.6 Quality Report (QLT)

| ID | Requirement | Pri |
|---|---|---|
| FR-QLT-001 | Rejected Parts Pareto: bar chart, X axis scrap reasons (long labels wrapped), Y axis rejected count with the number labelled on each bar, overlaid cumulative-percentage line. | M |
| FR-QLT-002 | Rejects Log table with columns Machine Name, Operation, Scrap Count, Scrap Reason, and Operator Notes on the right. | M |
| FR-QLT-003 | Report filters: date range, site, line, machine group; export to CSV. | M |
| FR-QLT-004 | Downtime Pareto by reason with the same pattern. | M |

### 2.7 Line Balance / Yamazumi (LBL)

| ID | Requirement | Pri |
|---|---|---|
| FR-LBL-001 | For a selected line, display stacked bars of operator work content (manual time) per operator group, composed of operation tasks, with a takt line. | M |
| FR-LBL-002 | Flag operator groups exceeding takt and show the overload in seconds. | M |
| FR-LBL-003 | Display station cycle times and highlight the longest as the bottleneck. | M |
| FR-LBL-004 | What-if reallocation of tasks between operators. | P2 |

### 2.8 Dashboards (DSH)

| ID | Requirement | Pri |
|---|---|---|
| FR-DSH-001 | Executive dashboard: OEE, A, P, Q, output vs plan, scrap rate, downtime hours, OEE trend, site comparison, loss breakdown, top bottlenecks, supply-chain risk summary. | M |
| FR-DSH-002 | Plant dashboard: machine OEE cards/table by line, filter by site and line, top downtime and scrap causes. | M |
| FR-DSH-003 | Line view for leads and supervisors: station status, balance vs takt. | M |
| FR-DSH-004 | Home page shall present content appropriate to the role and scope. | M |
| FR-DSH-005 | All dashboards respect scope; figures reflect only visible records. | M |
| FR-DSH-006 | SQDCP board (safety, quality, delivery, cost, people) including safety incidents. | P2 |

### 2.9 Supply Chain (SCM)

| ID | Requirement | Pri |
|---|---|---|
| FR-SCM-001 | Maintain purchase orders with lines (part, quantity, received, unit cost, due date), receiving site and supplier. | M |
| FR-SCM-002 | Suppliers shall create and update shipments (ASN) against their POs: shipment number, lines, ship date, ETA, carrier, tracking, status (planned, in transit, delayed, delivered), delay reason. | M |
| FR-SCM-003 | Maintain inventory levels per site and part: on hand, safety stock, reorder point, average daily usage. | M |
| FR-SCM-004 | Compute days of cover = on hand / average daily usage. | M |
| FR-SCM-005 | Compute material risk: parts below safety stock or reorder point, projected stock-out date, coverage after incoming shipments, and demand from open jobs through BOM explosion. | M |
| FR-SCM-006 | Flag delayed shipments (ETA after PO due date or status delayed). | M |
| FR-SCM-007 | Supplier scorecard: on-time delivery %, delayed shipments, open PO lines. | S |
| FR-SCM-008 | Receipt of a shipment updates PO line received quantity and inventory with a transaction record. | S |
| FR-SCM-009 | Supplier sees only own POs, shipments and shared inventory. | M |
| FR-SCM-010 | Supplier quality (PPM, NCR) and ERP integration. | P3 |

### 2.10 Administration and Audit (ADM)

| ID | Requirement | Pri |
|---|---|---|
| FR-ADM-001 | Users page: create, edit, deactivate, reset password, assign role, org and scopes. | M |
| FR-ADM-002 | Roles page: CRED matrix per resource and field-security editor. | M |
| FR-ADM-003 | Settings page: terminology, KPI targets, reason codes, shifts, custom fields. | M |
| FR-ADM-004 | Audit log viewer with filters by user, resource, action, date. | M |
| FR-ADM-005 | CSV export from list and report pages. | M |

### 2.11 Phase 2 and 3 Items

| ID | Requirement | Pri |
|---|---|---|
| FR-P2-001 | Staffing: shift assignments of people to lines/stations; skill matrix. | P2 |
| FR-P2-002 | Andon: raise call from a station, escalation rules and notifications. | P2 |
| FR-P2-003 | Maintenance: planned/unplanned work orders, MTBF/MTTR. | P2 |
| FR-P2-004 | SSO (OIDC/SAML) and MFA. | P2 |
| FR-P2-005 | Scheduled report distribution by email. | P2 |
| FR-P3-001 | IoT connectors (OPC-UA, MQTT, PLC) for automatic counts and machine states. | P3 |
| FR-P3-002 | Predictive downtime and quality analytics. | P3 |
| FR-P3-003 | ERP/WMS integration. | P3 |

### 2.x Part Lifecycle

| ID | Requirement | Priority |
|---|---|---|
| FR-LC-001 | Show a multi-level part structure (finished product, subassemblies, purchased components) as a left-to-right flow, one lane per made part. | M |
| FR-LC-002 | Each routing step shows the components it adds (bill of materials line linked to the step); unlinked components join the first step. | M |
| FR-LC-003 | Per part: stock and days of cover, supplier and lead time, inbound shipments and late flags, open jobs, 30-day output, scrap and OEE. | M |
| FR-LC-004 | Show where a part is used (all levels upwards). | S |
| FR-LC-005 | Authorised internal users add, change and remove components and link them to steps; circular structures are rejected. | S |
| FR-LC-006 | Supplier users see only parts and machines in their scope. | M |

## 3. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-001 | Cloud | Stateless application container; configuration via environment variables; PostgreSQL via `DATABASE_URL` with optional TLS (`PGSSL`); health endpoint `/api/health`. |
| NFR-002 | Scalability | Horizontal scaling of app instances behind a load balancer; database indexed on tenant/date/machine; support read replicas. |
| NFR-003 | Performance | Typical dashboard API responses under 1 second at 1M log rows; page render under 3 seconds. |
| NFR-004 | Security | TLS in transit; bcrypt hashes; JWT expiry; helmet headers; parameterised SQL; input validation; least-privilege roles; secrets in a secrets manager. |
| NFR-005 | Multi-tenancy | No cross-tenant access; tests for scope leakage; per-tenant configuration. |
| NFR-006 | Availability | Target 99.5% in Release 1; automated database backups with point-in-time recovery in cloud. |
| NFR-007 | Auditability | Audit log retained at least 12 months. |
| NFR-008 | Accessibility | WCAG 2.1 AA: keyboard navigation, contrast, labelled controls, status not conveyed by colour alone. |
| NFR-009 | Usability | Responsive layout usable on tablet at the line; minimal-field entry forms. |
| NFR-010 | Browser support | Current Chrome, Edge, Safari, Firefox. |
| NFR-011 | Observability | Structured logs, request ids, health and readiness checks; metrics hooks. |
| NFR-012 | Portability | Runs identically on macOS, Linux and Docker; no OS-specific dependencies. |
| NFR-013 | Maintainability | Resource registry drives CRUD, permission and scope; new entities added with minimal code. |
| NFR-014 | Localisation | Dates/times stored as UTC or dates with site timezone; UI strings ready for translation (Phase 2). |
