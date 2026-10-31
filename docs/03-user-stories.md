# Smart TAKT Board — User Stories

Priority: M = Must, S = Should, C = Could, W = Won't (this release). Each story lists acceptance criteria (AC).

## Epic: Operator

**US-OP-01 (M)** As an operator, I want to sign in with my company code, email and password so that I reach only my work area.
- AC: Valid credentials open the Home page; invalid ones show a generic error; navigation shows only permitted items.

**US-OP-02 (M)** As an operator, I want to create a production log for my machine and shift so that output is recorded.
- AC: Machine list contains only my machines; operation, shift and date are selectable; planned time and ideal cycle are pre-filled; good and rework counts are required numbers.

**US-OP-03 (M)** As an operator, I want to add downtime events with a reason and duration to a log so that stoppages are captured.
- AC: Reasons come from the tenant's downtime list; duration must be positive; planned reasons are marked.

**US-OP-04 (M)** As an operator, I want to add scrap events with reason, quantity and notes so that rejects are explained.
- AC: Quantity positive; notes optional and appear as Operator Notes in the Quality report.

**US-OP-05 (S)** As an operator, I want to see my recent logs and their approval status so that I know if corrections are needed.
- AC: List shows date, machine, status; rejected logs are highlighted with the approver's note.

**US-OP-06 (S)** As an operator, I want to edit a draft or rejected log so that I can fix mistakes.
- AC: Approved logs are read-only for operators.

**US-OP-07 (C)** As an operator, I want a tablet-friendly entry form so that I can use it at the line.
- AC: Controls are touch-sized; layout is usable at 768 px width.

## Epic: Lead

**US-LD-01 (M)** As a lead, I want to see all machines in my line and their current-shift OEE so that I can steer the shift.
- AC: Line view lists every machine in my line with A, P, Q, OEE and status colour.

**US-LD-02 (M)** As a lead, I want to approve or reject submitted logs for my line so that analytics use verified data.
- AC: Approve/reject buttons only for logs in my scope; status and approver recorded; action audited.

**US-LD-03 (M)** As a lead, I want to enter or correct logs on behalf of operators so that missed entries are filled.
- AC: Create/edit allowed on all machines in my line.

**US-LD-04 (S)** As a lead, I want the top downtime and scrap causes for my line today so that I can act immediately.
- AC: Pareto filtered to my line and current date.

## Epic: Supervisor

**US-SV-01 (M)** As a supervisor, I want to see all lines under my supervision in one view so that I can compare them.
- AC: Dashboard lists each line with OEE, output vs plan and top loss.

**US-SV-02 (M)** As a supervisor, I want to see the line balance against takt so that I can reassign work.
- AC: Yamazumi chart with takt line; operators above takt are flagged with overload seconds.

**US-SV-03 (S)** As a supervisor, I want to review pending approvals across my lines so that none are stale.
- AC: Pending list filtered by line with ageing.

**US-SV-04 (W)** As a supervisor, I want to manage staffing on assembly lines so that stations are covered.
- AC: Deferred to Phase 2 (FR-P2-001).

**US-SV-05 (W)** As a supervisor, I want escalation alerts when output drops below 90% of plan so that I can respond.
- AC: Deferred to Phase 2 (andon, FR-P2-002).

## Epic: Manager (part/component owner)

**US-MG-01 (M)** As a manager, I want to see OEE for all machines running my part's operations so that I own the result.
- AC: Scope type "part" limits data to machines that have operations on that part.

**US-MG-02 (M)** As a manager, I want a Quality report for my part so that I can target the top defects.
- AC: Pareto with cumulative line and Rejects Log with the required columns.

**US-MG-03 (S)** As a manager, I want the loss breakdown (downtime, speed, quality) so that I can prioritise improvement.
- AC: Loss chart in hours for the selected range.

## Epic: Plant Manager / GM

**US-GM-01 (M)** As a plant manager, I want a plant dashboard with OEE, output vs plan, scrap rate and downtime so that I run the plant daily.
- AC: Tiles coloured against configured targets; filterable by line and date range.

**US-GM-02 (M)** As a plant manager, I want machine rankings and the bottleneck highlighted so that I focus investment.
- AC: Ranking sorted by OEE; bottleneck badge on the worst machine of each line.

**US-GM-03 (M)** As a plant manager, I want to see inventory days of cover and incoming shipments for my plant so that I avoid stoppages.
- AC: Inventory list limited to my site(s); risk flags for low cover.

**US-GM-04 (S)** As a plant manager, I want to export reports to CSV so that I can share them.
- AC: Export respects filters and scope.

## Epic: Executive

**US-EX-01 (M)** As an executive, I want a cross-plant dashboard so that I understand process performance at a glance.
- AC: OEE, A, P, Q, scrap, downtime, site comparison, trend, loss breakdown.

**US-EX-02 (M)** As an executive, I want to see parts at risk of stock-out and delayed shipments so that I can plan cost and manage delays.
- AC: Risk summary with counts and top parts; drill-through to Inventory and Shipments.

**US-EX-03 (S)** As an executive, I want to compare supplier plants with internal plants so that I see third-party performance.
- AC: Site comparison includes supplier sites when in scope.

**US-EX-04 (S)** As an executive, I want unit cost and PO value hidden or shown according to my role so that sensitive data is controlled.
- AC: Field-level security hides cost fields when configured.

## Epic: Quality Engineer

**US-QE-01 (M)** As a quality engineer, I want the Rejected Parts Pareto so that I see where value is lost.
- AC: Bars with numeric labels, wrapped long reason names, cumulative % line.

**US-QE-02 (M)** As a quality engineer, I want the Rejects Log with machine, operation, scrap count, reason and operator notes so that I can investigate events.
- AC: Columns in that order, Operator Notes rightmost; sortable; CSV export.

## Epic: Supply Chain Planner

**US-SC-01 (M)** As a planner, I want to see inventory levels with days of cover so that I plan replenishment.
- AC: Columns on hand, safety stock, reorder point, avg daily usage, days of cover; sort by risk.

**US-SC-02 (M)** As a planner, I want to see material risk including incoming shipments and open-job demand so that shortages are predicted.
- AC: Projected cover = (on hand + incoming) / (usage + job demand); stock-out date shown.

**US-SC-03 (M)** As a planner, I want to create and track purchase orders so that supply is committed.
- AC: PO with lines, supplier, receiving site, due dates; status transitions.

**US-SC-04 (M)** As a planner, I want to see shipments and which are delayed so that I can intervene.
- AC: Delayed flag when ETA is later than due date or status is delayed; reason visible.

**US-SC-05 (S)** As a planner, I want a supplier scorecard so that I can manage supplier performance.
- AC: On-time delivery %, delayed count, open lines per supplier.

**US-SC-06 (S)** As a planner, I want to receive a shipment so that inventory and PO received quantity update.
- AC: Receipt creates inventory transactions and updates PO status.

## Epic: Part Lifecycle

**US-LC-01 (M)** As an executive or planner, I want to see how a finished product is built from supplier parts through each assembly step so that I can find where supply or quality problems start.
- AC: Flow shows each made part's steps, the components added at each step, stock status and late inbound.

**US-LC-02 (S)** As a planner, I want to see where a part is used so that I understand the impact of a shortage.
- AC: Where-used lists parents at every level.

**US-LC-03 (S)** As a planner, I want to maintain the components of a part and the step that adds each so that the lifecycle stays current.
- AC: Add, edit, remove; circular structures and steps of another part are rejected.

## Epic: Supplier User

**US-SP-01 (M)** As a supplier user, I want to sign in and see only my organization's data so that confidentiality is kept.
- AC: Other suppliers' and internal records are not returned by the API or UI.

**US-SP-02 (M)** As a supplier user, I want to see POs assigned to us so that I know what to ship.
- AC: PO list filtered to my org, with due dates.

**US-SP-03 (M)** As a supplier user, I want to create and update shipments (ship date, ETA, carrier, tracking, status, delay reason) so that the customer has current information.
- AC: Status changes audited; delayed status requires a reason.

**US-SP-04 (M)** As a supplier operator, I want to log production, downtime and scrap on my own machines so that my performance is transparent.
- AC: Same entry form as internal plants, scoped to my machines.

**US-SP-05 (S)** As a supplier admin, I want to maintain my organization's inventory levels so that the customer sees stock at the supplier.
- AC: Inventory edit limited to my sites.

## Epic: Tenant Administrator

**US-AD-01 (M)** As an admin, I want to create users and assign role, organization and scopes so that people see the right data.
- AC: Multiple scopes allowed; deactivation prevents login.

**US-AD-02 (M)** As an admin, I want to edit the CRED matrix of a role so that capabilities match our process.
- AC: Create/Read/Edit/Delete/Approve flags per resource; changes take effect on next request.

**US-AD-03 (M)** As an admin, I want to hide or make read-only specific fields per role so that sensitive data is protected.
- AC: Hidden fields are absent from API responses.

**US-AD-04 (M)** As an admin, I want to maintain sites, lines, machines, parts, operations and jobs so that the model reflects our plants.
- AC: CRUD with validation and custom fields.

**US-AD-05 (M)** As an admin, I want to configure scrap and downtime reasons so that reporting uses our vocabulary.
- AC: Reason has code, name, category, planned flag, active flag.

**US-AD-06 (M)** As an admin, I want to set KPI targets and thresholds so that status colours reflect our goals.
- AC: Target and warn values per metric; tiles update accordingly.

**US-AD-07 (S)** As an admin, I want to rename terminology so that the product speaks our language.
- AC: Overrides appear in menus and headings.

**US-AD-08 (M)** As an admin, I want to define custom fields on key entities so that we capture company-specific data.
- AC: Field types text, number, date, boolean, select; required enforcement.

**US-AD-09 (M)** As an admin, I want to view the audit log so that I can review who changed what.
- AC: Filter by user, resource, action, date.

**US-AD-10 (S)** As an admin, I want to define shifts so that planned time is calculated correctly.
- AC: Shift name, start, end, planned break minutes.

## Epic: Platform / Cross-cutting

**US-PL-01 (M)** As a tenant, I want my data completely separate from other tenants so that we meet confidentiality obligations.
- AC: Automated tests show no cross-tenant reads or writes.

**US-PL-02 (M)** As an operator of the platform, I want a health endpoint so that the cloud load balancer can monitor the service.
- AC: `/api/health` returns OK when the database is reachable.

**US-PL-03 (S)** As a customer, I want the UI to follow a restrained blue and grey theme with top navigation so that it feels like an enterprise SaaS product.
- AC: Header, tab bar with dropdown menus, grey background, blue accents, muted status colours.
