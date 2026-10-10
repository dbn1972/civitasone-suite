# SmartTransfer OS — ER model

> Spec §4 (Universal domain model) and §19 deliverable 7. Baseline: `origin/main` `9d4fa95e5`.
>
> **Reading rules (CLAUDE.md §3, docs/ARCHITECTURE.md §5):** this is a *logical* model. Entities are grouped by
> **owning service**. There are **no cross-service foreign keys**: SmartTransfer references Workforce Core / location
> entities **by opaque id + as-of version only** (shown as dotted relationships labelled `by id`). Every entity carries
> the standard columns `id, tenant_id, created_at, updated_at, created_by, updated_by, version` (CLAUDE.md §3.6); these
> are omitted from the diagrams for readability. Every table is **FORCE RLS** on `tenant_id`.
>
> Entities marked **(BUILD)** do not exist on `origin/main` and are delivered by later M01 PRs (07, 09, 12). Entities
> marked **(EXISTS)** are current rows cited by `path:line`.

## 1. Workforce Core (module profile of `hrms-service`, own schema)

Owns people, posts, occupancy, cadre and the office tree ([ADR-0001](adr/0001-post-and-occupancy-owner.md),
[ADR-0002](adr/0002-office-hierarchy-owner.md), [ADR-0003](adr/0003-cadre-master-owner.md),
[ADR-0023](adr/0023-standalone-packaging.md)). New tables live in their own schema so they are liftable later.

```mermaid
erDiagram
  GOVERNMENT_ORGANISATION ||--o{ DEPARTMENT : contains
  DEPARTMENT ||--o{ ORG_UNIT : contains
  ORG_UNIT ||--o{ OFFICE : contains
  OFFICE ||--o{ ESTABLISHMENT : "sanctioned for"
  ESTABLISHMENT ||--o{ POST : "sanctions"
  OFFICE ||--o{ POST : "located at"
  CADRE ||--o{ POST : "classifies"
  DESIGNATION ||--o{ POST : "titled by"
  POST ||--o{ POSITION_REQUIREMENT : requires
  POST ||--o{ POST_OCCUPANCY : "held via"
  EMPLOYEE ||--o{ POST_OCCUPANCY : "holds"
  EMPLOYEE ||--o{ POSTING_LEDGER : "has history"
  POST ||--o{ POSTING_LEDGER : "referenced by"
  EMPLOYEE ||--|| EMPLOYMENT_RELATIONSHIP : "has"
  EMPLOYEE }o--|| SERVICE_CATEGORY : "classified as"
  EMPLOYEE }o--|| CADRE : "belongs to"
  EMPLOYEE }o--|| DESIGNATION : "designated as"
  EMPLOYEE }o--|| RANK_GRADE : "at"
  EMPLOYEE ||--o{ QUALIFICATION : "holds"
  EMPLOYEE ||--o{ SKILL_COMPETENCY : "has"
  EMPLOYEE ||--o{ ELIGIBILITY_ATTRIBUTE : "carries"
  EMPLOYEE ||--o{ TRADE_SPECIALISATION : "trained in"
  EMPLOYEE ||--o{ EMPLOYEE_HOLD : "blocked by"
  EMPLOYEE }o--o{ REPORTING_RELATIONSHIP : "reports via"
  POSTING_LEDGER ||--o{ SERVICE_TENURE : "derives"
  OFFICE ||--o{ STAFFING_REQUIREMENT : "needs minimum"
  OFFICE }o--|| GEOGRAPHIC_JURISDICTION : "within (by id, location-service)"

  EMPLOYEE {
    uuid id PK
    string employee_no
    uuid department_id "EXISTS employee/schema.ts:41-109"
    uuid designation_id
    uuid location_id "no FK today"
    string station "free text today"
    string hra_city_class "EXISTS employee/schema.ts:54, unwritten"
  }
  POST {
    uuid id PK "BUILD ST-M01-07"
    uuid office_id
    uuid cadre_id
    uuid designation_id
    string grade_pay_level
    string reservation_tag
    string status "sanctioned|frozen|abolished"
  }
  POST_OCCUPANCY {
    uuid id PK "BUILD ST-M01-07"
    uuid post_id
    uuid employee_id
    string charge_type "substantive|acting|additional|in_charge"
    date effective_from
    date effective_to "null = open"
    string order_ref
  }
  POSTING_LEDGER {
    uuid id PK "BUILD ST-M01-07"
    uuid employee_id
    uuid office_id
    uuid post_id
    date effective_from
    date effective_to
    string order_ref
  }
  CADRE {
    uuid id PK "BUILD ST-M01-07"
    uuid parent_cadre_id
    string name
    string external_code "Mode B mapping"
  }
  STAFFING_REQUIREMENT {
    uuid id PK "BUILD ST-M01-07"
    uuid office_id
    uuid cadre_id
    uuid designation_id
    int minimum_count
    date effective_from
    date effective_to "null = open"
  }
  GEOGRAPHIC_JURISDICTION {
    uuid id PK "EXISTS location-service jurisdiction/routes.ts:12-35, owned by location-service, referenced by id"
    string lgd_code
    string level "district|division|block"
    uuid parent_id
  }
  EMPLOYEE_HOLD {
    uuid id PK "EXISTS lifecycle/schema.ts:212-232"
    uuid employee_id
    string hold_type
    string status
    date effective_from
    date effective_to
  }
```

**Occupancy invariant (hard):** at most one `POST_OCCUPANCY` row with `charge_type = 'substantive'` and
`effective_to IS NULL` per `(tenant_id, post_id)`. This mirrors the prior-art partial unique index
`uniq_postings_substantive` on `hierarchy.postings` (`location-service/migrations/0005a_org_model.sql:159-161`),
enforced on the new `post_occupancy` table in ST-M01-07.

**Legacy fragments** being made derived/retired under D-ST-01: `manpower.plans` (`manpower-planning/schema.ts:8-27`),
`reservation.hrms_sanctioned_posts` (migration `0022:194`), `tenant.positions` (`positions/schema.ts:5-20`),
and `hierarchy.positions/postings` (prior art). See [ADR-0001](adr/0001-post-and-occupancy-owner.md).

## 2. SmartTransfer (movement entities, `services/smarttransfer-service`)

Owns only the movement entities and references Workforce Core / location by opaque id + as-of version
([ADR-0010](adr/0010-hrms-write-boundary.md); M00 §6.2). Built from ST-M01-12 onward.

```mermaid
erDiagram
  TRANSFER_CYCLE ||--o{ CYCLE_WINDOW : "has"
  TRANSFER_CYCLE ||--o{ TRANSFER_REQUEST : "collects"
  TRANSFER_CYCLE ||--o{ EMPLOYEE_PREFERENCE : "collects"
  TRANSFER_CYCLE ||--o{ SNAPSHOT_MANIFEST : "freezes"
  TRANSFER_CYCLE ||--o{ ALLOCATION_SCENARIO : "explores"
  MOVEMENT_POLICY ||--o{ POLICY_PACK : "versioned as"
  POLICY_PACK ||--o{ TRANSFER_CYCLE : "locked into"
  MOVEMENT_TYPE ||--o{ TRANSFER_REQUEST : "typed as"
  TRANSFER_REQUEST ||--o{ EMPLOYEE_PREFERENCE : "ranked by"
  EMPLOYEE_PREFERENCE ||--o{ PREFERENCE_ITEM : "contains"
  TRANSFER_REQUEST ||--o{ ELIGIBILITY_EVALUATION : "evaluated by"
  ALLOCATION_SCENARIO ||--o{ ALLOCATION_RUN : "run as"
  SNAPSHOT_MANIFEST ||--o{ ALLOCATION_RUN : "input to"
  ALLOCATION_RUN ||--o{ RECOMMENDED_ASSIGNMENT : "produces"
  RECOMMENDED_ASSIGNMENT ||--o{ EXCEPTION_REQUEST : "contested by"
  RECOMMENDED_ASSIGNMENT ||--o{ APPROVAL : "approved by"
  APPROVAL ||--o{ MOVEMENT_ORDER : "authorises"
  MOVEMENT_ORDER ||--o| RELIEVING_RECORD : "relieved via"
  MOVEMENT_ORDER ||--o| JOINING_RECORD : "joined via"
  MOVEMENT_ORDER ||--o{ REPRESENTATION_APPEAL : "appealed via"
  MOVEMENT_ORDER ||--o| RECONCILIATION_RECORD : "reconciled via"
  ALLOCATION_RUN ||--o{ DECISION_EVIDENCE : "evidenced by"
  RECOMMENDED_ASSIGNMENT ||--o{ DECISION_EVIDENCE : "justified by"

  TRANSFER_CYCLE {
    uuid id PK
    string status "draft|open|frozen|allocating|published|closed"
    uuid policy_pack_id "by id (own pack)"
  }
  TRANSFER_REQUEST {
    uuid id PK
    uuid cycle_id
    uuid employee_id "by id (Workforce Core)"
    uuid movement_type_id
    string status "draft|submitted|under_review|returned|withdrawn|allocated|rejected"
  }
  EMPLOYEE_PREFERENCE {
    uuid id PK
    uuid cycle_id
    uuid employee_id "by id"
  }
  PREFERENCE_ITEM {
    uuid id PK
    uuid preference_id
    uuid post_id "by id (Workforce Core)"
    int rank
  }
  SNAPSHOT_MANIFEST {
    uuid id PK
    string content_hash "sha256 over canonical order"
    uuid policy_pack_id
    timestamptz taken_at
  }
  ALLOCATION_RUN {
    uuid id PK
    uuid snapshot_id
    string seed
    string solver_version
    string input_hash
    string output_hash "plan hash, replay check"
    string status "requested|running|completed|failed|cancelled"
  }
  RECOMMENDED_ASSIGNMENT {
    uuid id PK
    uuid run_id
    uuid employee_id "by id"
    uuid post_id "by id"
    jsonb constraint_justification
  }
  MOVEMENT_ORDER {
    uuid id PK
    uuid assignment_id
    string order_number "packages/numbering"
    string status "drafted|issued|cancelled"
    string efile_id "by id (estab linkage)"
    string signing_state "unsigned|signed"
  }
  RELIEVING_RECORD {
    uuid id PK
    uuid order_id
    date relieved_on
  }
  JOINING_RECORD {
    uuid id PK
    uuid order_id
    date joined_on
  }
  REPRESENTATION_APPEAL {
    uuid id PK
    uuid order_id
    string status "submitted|under_review|upheld|rejected|withdrawn"
  }
  DECISION_EVIDENCE {
    uuid id PK
    uuid run_id
    string snapshot_hash
    string policy_pack_hash
    string solver_version
    string seed
  }
```

## 3. Cross-service reference boundary (by id, never FK)

```mermaid
flowchart LR
  subgraph ST[SmartTransfer DB RLS]
    REQ[transfer_request]
    PREF[preference_item]
    ASG[recommended_assignment]
    ORD[movement_order]
  end
  subgraph WC[Workforce Core schema in hrms-service]
    EMP[employee]
    POST[post]
    OCC[post_occupancy]
    LEDGER[posting_ledger]
    HOLD[employee_hold]
  end
  REQ -. "employee_id (by id, as-of)" .-> EMP
  PREF -. "post_id (by id, as-of)" .-> POST
  ASG -. "employee_id / post_id" .-> EMP
  ORD -. "applyPosting command (idempotent on order id)" .-> OCC
  OCC --> LEDGER
  HOLD -. "read by eligibility (D-ST-16, OPEN)" .-> REQ
```

Writes from SmartTransfer into Workforce Core happen **only** through the `applyPosting` command
([ADR-0010](adr/0010-hrms-write-boundary.md)); reads are through `getOrLoad` over internal HTTP or a frozen snapshot
(M00 §6.1–§6.2). No money fields appear in C0; any that are added later (e.g. a payroll reconciliation record under
D-ST-13/14, **OPEN**) must be `bigint` minor units + ISO 4217 (CLAUDE.md §3.11).
