# Smart TAKT Board — Process Diagrams

All diagrams use Mermaid and render on GitHub and most Markdown viewers.

## 1. End-to-End Value Flow

```mermaid
flowchart LR
  S[Supplier production and ASN] --> R[Receiving and inventory]
  R --> P[Production on assembly line]
  P --> L[Operator logs output, downtime, scrap]
  L --> A[Lead approval]
  A --> M[OEE and takt analytics]
  R --> RISK[Material risk analytics]
  M --> D[Dashboards and reports]
  RISK --> D
  D --> X[Executive decisions: bottlenecks, cost, delays]
  X --> P
  X --> S
```

## 2. Shop-Floor Log Capture and Approval

```mermaid
sequenceDiagram
  actor Op as Operator
  participant UI as Web UI
  participant API as API
  participant DB as PostgreSQL
  actor Ld as Lead
  Op->>UI: Open Log Entry, pick machine, operation, shift
  UI->>API: GET machines, operations, reasons (scoped)
  API->>DB: Query with tenant and scope filters
  DB-->>API: Rows
  API-->>UI: Lists and defaults
  Op->>UI: Enter counts, downtime events, scrap events
  UI->>API: POST production log
  API->>API: Check CRED create and machine scope
  API->>DB: Insert log, downtime, scrap, audit
  API-->>UI: Log status submitted
  Ld->>UI: Open pending approvals
  UI->>API: GET logs status submitted
  Ld->>UI: Approve or reject
  UI->>API: POST approve
  API->>API: Check approve permission and scope
  API->>DB: Update status, approver, audit
  API-->>UI: Updated log
```

## 3. OEE Calculation Flow

```mermaid
flowchart TD
  A[Production logs with status submitted or approved] --> B[Join downtime events and reason planned flag]
  A --> C[Join scrap events]
  B --> D[Unplanned downtime seconds]
  A --> E[Planned time seconds]
  D --> F[Run time = planned - unplanned downtime]
  E --> F
  F --> G[Availability = run time / planned time]
  A --> H[Total count = good + rework + scrap]
  C --> H
  H --> I[Performance = ideal cycle x total / run time]
  F --> I
  H --> J[Quality = good / total]
  G --> K[OEE = A x P x Q]
  I --> K
  J --> K
  K --> L[Aggregate by summing blocks per machine, line, site, day]
  L --> M[Compare with tenant KPI targets]
  M --> N[Dashboards and reports]
```

## 4. Downtime and Scrap Escalation

Manual in Release 1 (dashboards and review); automated notification is Phase 2 (andon).

```mermaid
flowchart TD
  A[Event logged: downtime or scrap] --> B{KPI below warn threshold?}
  B -- No --> C[Normal reporting]
  B -- Yes --> D[Shown red on line view]
  D --> E[Lead reviews at shift]
  E --> F{Resolved in shift?}
  F -- Yes --> G[Comment in log notes]
  F -- No --> H[Supervisor escalation]
  H --> I{Output below 90 percent of plan or repeated cause?}
  I -- Yes --> J[Manager and Plant Manager review top loss]
  I -- No --> K[Supervisor action and reassign]
  J --> L[Improvement action tracked]
```

## 5. Supplier PO, Shipment, Receipt and Inventory

```mermaid
sequenceDiagram
  actor Pl as Planner
  actor Su as Supplier user
  participant API as API
  participant DB as PostgreSQL
  Pl->>API: Create purchase order with lines
  API->>DB: Insert PO and lines
  Su->>API: List my POs (scoped to supplier org)
  Su->>API: Create shipment (ASN) with ETA, carrier, tracking
  API->>DB: Insert shipment and lines
  Su->>API: Update status in transit or delayed with reason
  API->>DB: Update shipment, audit
  Pl->>API: View shipments and delays
  Pl->>API: Receive shipment
  API->>DB: Update PO line received, PO status
  API->>DB: Update inventory level and transaction
  Pl->>API: View material risk
```

## 6. Inventory Risk Logic

```mermaid
flowchart TD
  A[For each site and part] --> B[On hand]
  A --> C[Average daily usage]
  A --> D[Open jobs x BOM quantity per, spread to due date]
  A --> E[Incoming: open shipments and PO lines not received]
  C --> F[Daily demand = usage + job demand]
  D --> F
  B --> G[Days of cover = on hand / daily demand]
  F --> G
  B --> H[Projected cover = on hand + incoming / daily demand]
  E --> H
  G --> I{On hand below safety stock or reorder point?}
  H --> J{Projected cover below lead time or incoming delayed?}
  I -- Yes --> K[Risk: High]
  J -- Yes --> K
  I -- No --> L{Cover under threshold?}
  J -- No --> L
  L -- Yes --> M[Risk: Medium]
  L -- No --> N[Risk: Low]
  K --> O[Executive and planner risk list with stock-out date]
  M --> O
```

## 7. Tenant Onboarding and Configuration

```mermaid
flowchart TD
  A[Vendor provisions tenant] --> B[Create internal organization]
  B --> C[Seed default roles, reason codes, shifts, KPI targets]
  C --> D[Create tenant admin user]
  D --> E[Admin signs in]
  E --> F[Configure terminology, targets, custom fields]
  F --> G[Load master data: sites, lines, machines, parts, operations]
  G --> H[Add supplier organizations and parts]
  H --> I[Create users, assign role and scopes]
  I --> J[Review role CRED and field security]
  J --> K[Go live: operators start logging]
```

## 8. Authorization Decision Flow

```mermaid
flowchart TD
  A[Request with JWT] --> B[Verify token, load user, role, tenant]
  B --> C{Active user and tenant?}
  C -- No --> X[401 Unauthorized]
  C -- Yes --> D{Role has CRED permission for resource and action?}
  D -- No --> Y[403 Forbidden]
  D -- Yes --> E[Resolve record scope: tenant, org, site, line, machine, part]
  E --> F[Add tenant_id and scope filters to SQL]
  F --> G[Execute query]
  G --> H[Apply field security: remove hidden fields]
  H --> I[On write: drop hidden and read-only fields from input]
  I --> J[Audit log for create, update, delete, approve]
  J --> K[Response]
```

## 9. Turbocharger Assembly Line (from the requirements document)

Cycle times (seconds) per station; line takt about 90 s; bottlenecks are balancing and functional test.

```mermaid
flowchart TD
  IN[Machined components] --> S1[1 Incoming inspection 45s]
  S1 --> S2[2 Cleaning and prep 60s]
  S2 --> S3[3 CHRA assembly A 75s]
  S3 --> S4[4 CHRA assembly B 75s]
  S4 --> S5[5 Rotor balancing VSR 90s auto]
  S5 --> S6[6 Compressor assembly 60s]
  S6 --> S7[7 Turbine assembly 60s]
  S7 --> S8[8 Housing assembly 75s]
  S8 --> S9[9 Functional test 90s auto]
  S9 --> S10[10 Final inspection 45s]
  S10 --> S11[11 Pack and label 45s]
  S11 --> OUT[Finished turbocharger]
```

Operator assignment used for the Yamazumi view: Operator A covers stations 1-3, Operator B stations 4-6, Operator C stations 7, 8, 10 and 11; stations 5 and 9 are automated (only load/unload counts as operator work).
