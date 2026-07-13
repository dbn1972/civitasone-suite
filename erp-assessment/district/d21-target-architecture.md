# D21 — Target Architecture

**Lane:** L08 · **Date:** 2026-07-13  
**Role:** SaaS/Multi-Tenancy Architect + Platform Engineer  
**Source branch:** `court-management-service` · repo `/tmp/cms-wt`

> **Prerequisites:** `d16-district-federation-model.md` (federation model — read first), `d02-current-architecture.md` (runtime stack), `08-tenant-isolation-report.md` (RLS 7/10), `d15-security-domain-matrix.md` (domain isolation gaps).

---

## 1. Target Layered Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  L1 NATIONAL / MINISTRY INTEGRATION LAYER                                  │
│  PFMS · iGOT Karmayogi · NIC NeSDA · DigiLocker · UIDAI · GSTN · eCourts  │
│  Ministry analytics cell (cloud); cross-state event fan-out                 │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │  Event bus (SQS/Kafka) + API (HTTPS mTLS)
┌──────────────────────────▼──────────────────────────────────────────────────┐
│  L2 STATE INTEGRATION LAYER                                                 │
│  State Treasury (IFMS/iBank) · eDistrict portal · CCTNS (police ICJS)      │
│  DigiLocker state gateway · NIC PFMS state node · State GIS                 │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │  gov-adapters package (pfms.ts, gstn.ts, nach.ts, traces.ts)
                           │  ABSENT: cctns-adapter, lfms-adapter, digilocker-adapter
┌──────────────────────────▼──────────────────────────────────────────────────┐
│  L3 STATE CONTROL PLANE  (one cell per state)                               │
│  tenant-service · install-service · admin-service · policy-service          │
│  audit-service · location-service · analytics-service (state aggregation)   │
│  Keycloak state realm (IdP for all district cells)                          │
│  Cell Registry · Office Registry · LGD Hierarchy · Module Catalogue         │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │  Cell DNS / per-cell Keycloak realm federation
             ┌─────────────┼──────────────────┬────────────────────┐
             │             │                  │                    │
┌────────────▼───┐  ┌──────▼───────┐  ┌──────▼─────┐  ┌─────────▼──────────┐
│ SHARED DISTRICT│  │ LARGE DISTRICT│  │   POLICE   │  │     TREASURY       │
│ CELL           │  │ DEDICATED CELL│  │ DEDICATED  │  │   DEDICATED CELL   │
│ (~100 districts│  │ (1 district   │  │    CELL    │  │    (state-wide)    │
│ pool-tier)     │  │ pool-tier)    │  │ (silo-tier)│  │    (silo-tier)     │
└────────────┬───┘  └──────┬────────┘  └──────┬─────┘  └─────────┬──────────┘
             │             │                  │                    │
         ────────────────────────────────────────────────────────────────
         L4 DISTRICT FEDERATION (per district, per cell)
             │
   ┌─────────┴──────────────────────────────────────────┐
   │  DEPARTMENT SECURITY DOMAINS (per-dept tenant)     │
   │  Collectorate · Revenue · Health · Education       │
   │  RD/Rural · Urban/ULB · Coordination (read-model)  │
   │  Police (→ Police Cell) · Treasury (→ Treasury Cell)│
   └────────────────────────────────────────────────────┘
             │
   ┌─────────┴─────────────────────────────────────────┐
   │  L5 SUBORDINATE OFFICES (via Office Registry)     │
   │  SDM · Tehsil · Block/BDO · Police Station        │
   │  ULB Ward Office · Panchayat                      │
   │  (same tenant as parent dept, scoped by officeId) │
   └───────────────────────────────────────────────────┘
```

---

## 2. Architecture Principles — Current vs Target

| Principle | Status | Evidence / Gap |
|---|---|---|
| **API-first** | **PRESENT** | 44 routes in gateway registry; every service exposes Fastify REST [VERIFIED: `d02-current-architecture.md §2`] |
| **Event-driven** | **PRESENT** | 62 active event pairs; transactional outbox (`packages/outbox`, `_outbox.messages`); idempotent consumers (`_inbox.processed` markProcessed-first) [VERIFIED: `08-tenant-isolation-report.md §How tenant context established`] |
| **Domain-owned data** | **PRESENT** | Per-service DB, no cross-DB grants, no cross-schema JOINs [VERIFIED: `d02-current-architecture.md §1 table`]; CI greps enforced [CLAUDE.md §3] |
| **No cross-service DB access** | **PRESENT** | Zero cross-prefix Drizzle imports found [VERIFIED: `04-dependency-map.md §2`]; `CLAUDE.md §4` forbids it |
| **Contract versioning** | **PARTIAL** | `packages/events/src/schema-registry.ts` built — validates at publish+consume, enforces additive-only schema changes [VERIFIED: full file read]; BUT: "In-memory registry (production: backed by DB/cache for distributed access)" — not distributed, lost on restart [VERIFIED: `schema-registry.ts:35` comment] |
| **Transactional outbox** | **PRESENT** | `packages/outbox` + `_outbox.messages` per service + relay worker [VERIFIED: `d02-current-architecture.md`] |
| **Idempotent consumers** | **PRESENT** | `_inbox.processed` markProcessed-first pattern; central `withTenantConsumer` wraps all consumers [VERIFIED: `08-tenant-isolation-report.md §Remediation executed`] |
| **DLQ + redrive** | **PRESENT** | `infra/aws/modules/sqs/main.tf` — per-topic DLQ, `max_receive_count=5`, CloudWatch alarms [VERIFIED: `infra/aws/envs/production/main.tf:25-29`] |
| **Retry + backoff** | **PARTIAL** | SQS visibility timeout is the de-facto retry; no explicit exponential backoff in consumer code; no jitter [GAP: consumer.ts files do not implement custom retry] |
| **Circuit-breakers** | **PARTIAL** | `packages/circuit-breaker` built (consecutive-failure state machine) [VERIFIED: `packages/circuit-breaker/dist/index.d.ts:6-16`]; used in module-guard for admin calls [VERIFIED: `gateway-service/src/module-guard.ts:17-18`] and ML adapters; NOT used systematically across all 12 inter-service HTTP call-sites [VERIFIED: `d02-current-architecture.md §1`] |
| **Timeouts** | **PARTIAL** | Gateway has upstream proxy timeouts; not verified for all 12 intra-service HTTP call-sites |
| **Bulkheads** | **ABSENT** | No explicit connection-pool limits per tenant domain; single postgres-js pool per service; no max-in-flight limit per tenant [GAP: all pool tenants share one PG connection pool] |
| **Schema registry** | **PARTIAL** | In-memory per-process; not distributed; no persistence across restarts; no cross-service schema lookup at runtime [VERIFIED: `schema-registry.ts:35` inline note] |
| **Correlation IDs** | **PRESENT** | `correlationId` in every request/log/event [CLAUDE.md §6.12]; `x-correlation-id` header propagated by gateway |
| **Tenant context** | **PRESENT (partial)** | `tenantId` from JWT `tid` claim → RLS GUC set for fixed 12 services; ~23 services still using bare `db.select()` (fail-closed) [VERIFIED: `08-tenant-isolation-report.md §Residual gaps`] |
| **Jurisdiction context** | **ABSENT** | `officeId` / `jurisdictionId` NOT propagated in request context today; `jurisdiction.jurisdictions` exists in location-service but no HTTP header carries jurisdiction [VERIFIED: no `x-office-id` or `x-jurisdiction-id` header in gateway middleware] |
| **Purpose-based access** | **ABSENT** | No data-purpose/consent tracking in the API layer beyond citizen-service consent module; no purpose headers; no policy-service purpose checks |
| **Field-level disclosure** | **ABSENT** | RBAC is endpoint-level only; no field-level access policy; PII fields encrypted at rest but not filtered on read by role |

---

## 3. Service-to-Layer Assignment (Target)

### 3.1 State Control Plane Layer (L3)

| Service | Role | Status |
|---|---|---|
| tenant-service | Tenant/org registry; cell placement coordination | PARTIAL — missing federation columns (lgd codes, parent_tenant_id, cell_id) |
| install-service | Cell provisioning; silo provisioning; install wizard | PARTIAL — silo provisions to empty DB; no cell registry; no pool→silo migration |
| admin-service | Module catalogue; feature flags; editions | PARTIAL — module-guard built but unwired |
| policy-service | RBAC/ABAC evaluation; cross-district role templates | PRESENT — has role/binding/permission tables |
| audit-service | Central audit trail; CAG para state machine | PRESENT |
| location-service | LGD hierarchy; admin units; jurisdiction; **[NEW] office registry** | PARTIAL — officeId referenced in jurisdiction.jurisdictions but no office table |
| analytics-service | State-level cross-district aggregation | PRESENT — facts consumer built |

### 3.2 District Federation Layer (L4) — Per District

| Domain | Services Used | Tenant Tier | Cell |
|---|---|---|---|
| Collectorate | workflow, citizen, legal, hrms (district staff), notification | pool | Shared District |
| Revenue / Land | finance (DDO), procurement (limited), hrms, workflow | pool | Shared District |
| Health | hrms (health staff), procurement (drug), grant, citizen | pool | Shared District |
| Education | hrms (teacher), grant, citizen | pool | Shared District |
| Rural Development | grant, project, finance, hrms | pool | Shared District |
| Urban / ULB | finance (property tax), citizen, workflow | pool | Shared District |
| Police | hrms (police staff), payroll (police pay), court (case management), workflow, notification | **silo** | Police Dedicated |
| Treasury | finance (budget/GL/payments), procurement, payroll (govt payroll), audit | **silo** | Treasury Dedicated |
| Coordination | analytics (projection only), workflow (multi-dept), notification (broadcast) | pool | Shared District |

### 3.3 Integration Layer (L2 — External Systems)

| External System | Adapter Status | Direction |
|---|---|---|
| PFMS | `packages/gov-adapters/pfms.ts` [VERIFIED] | Outbound (disbursement) |
| GSTN | `packages/gov-adapters/gstn.ts` [VERIFIED] | Outbound (e-invoice) |
| NACH | `packages/gov-adapters/nach.ts` [VERIFIED] | Outbound (bank transfer) |
| TDS/TRACES | `packages/gov-adapters/traces.ts` [VERIFIED] | Bidirectional |
| CCTNS / ICJS | **ABSENT** — no adapter | Police FIR/investigation must integrate, not duplicate [HARD RULE per prompt] |
| LGD API | **ABSENT** | Required for LGD code validation/sync in location-service |
| DigiLocker | **ABSENT** | Required for citizen document verification |
| eCourts / NJDG | **ABSENT** | Required for court-service case status sync |
| eDistrict | **ABSENT** | Required for citizen-service application integration |
| State IFMS/iBank | **ABSENT** | Required for treasury reconciliation |

---

## 4. New Architectural Components Required (P0/P1)

### 4.1 Jurisdiction Context Propagation [P0]

**Gap:** No `officeId` / `jurisdictionId` in request context today.

**Target:**
```
JWT (tid=tenantId) → gateway
  + x-office-id header (set by client from session)
  → gateway validates: office belongs to tenant (policy-service lookup)
  → propagated as x-office-id to all upstream services
  → services filter data by officeId where applicable
```

**Why:** A tehsildar's request must see only their tehsil's records within the `district_revenue` tenant, not all tehsils in the district. RLS (by `tenant_id`) is insufficient — `office_id` scoping is needed.

### 4.2 Distributed Schema Registry [P1]

**Gap:** `schema-registry.ts` is in-memory per-process; lost on restart; not shared across 38 service instances.

**Target:** Schema registry backed by `admin-service` DB table (`config.schema_registry`) or Redis. Services register on startup; registry validates at publish+consume against the distributed store.

### 4.3 Federation Event Bus [P2]

**Gap:** Single SQS queue set shared by all tenants; no per-cell event routing.

**Target:** Each cell has its own queue set (SQS prefix per cell). State control-plane has a federation router that fans out cross-district events (coordination alerts, election duty orders, disaster declarations) to relevant district cells.

### 4.4 Coordination Read-Model [P2]

**Gap:** No cross-domain projection; DM has no way to see Police + Health + Finance coordination state without accessing each domain's raw data.

**Target:** A `coordination-service` (or extension to `analytics-service`) that:
- Subscribes to `classification: COORDINATION` events from all domain tenants in a district
- Projects minimum-necessary fields into `district_coordination` tenant
- Exposes read-only API with purpose-label headers (`X-Access-Purpose: disaster-coordination`)
- Produces no raw PII; strips all PII before projection

### 4.5 Per-Cell Backup and PITR [P0]

**Gap:** No PITR, no backup config anywhere in infra [VERIFIED: `infra/aws/envs/production/main.tf` — `module "rds"` commented out; no `pg_dump`, no WAL archiving]. RPO effectively unbounded.

**Target:** Per cell, WAL archiving to S3 + point-in-time recovery. RDS with automated backups OR Postgres WAL-E/pgBackRest to S3. (Detailed in `d23-deployment-tenancy.md`.)

---

## 5. Priority Checklist for Implementation

| Priority | Component | Owner Service | Effort |
|---|---|---|---|
| **P0** | Wire tenant-router into all 38 services (replace module-level singleton) | packages/db + all services | Large |
| **P0** | Wire module-guard in gateway (remove TODO comment in `module-guard.ts:12-14`) | gateway-service | Small |
| **P0** | Cell registry + tenant_cell_placements DDL + APIs | install-service | Medium |
| **P0** | Office registry DDL + APIs (location-service) | location-service | Medium |
| **P0** | Tenant table federation columns DDL (migration) | tenant-service | Small |
| **P0** | Backup/PITR for every cell PG cluster | infra/aws | Large |
| **P1** | Per-domain KMS CMK derivation in pii-crypto (use kmsKeyRef from tenant row) | packages/db / all PII services | Medium |
| **P1** | Jurisdiction context header (x-office-id) propagation through gateway | gateway-service + all services | Medium |
| **P1** | Police silo cell provisioning (dedicated PG + Redis + S3) | infra/aws + install-service | Large |
| **P1** | Treasury silo cell provisioning | infra/aws + install-service | Large |
| **P1** | Keycloak per-cell realm federation (district cell → state Keycloak IdP) | infra/onprem | Large |
| **P1** | Distributed schema registry (back by DB/Redis, not in-memory) | packages/events + admin-service | Medium |
| **P1** | CCTNS adapter stub (gov-adapters/cctns.ts) with integration contract | packages/gov-adapters | Medium |
| **P2** | Coordination read-model projection | analytics-service or new coordination-service | Large |
| **P2** | Federation event bus routing (per-cell SQS prefix + cross-cell fan-out) | queue-service | Large |
| **P2** | Purpose-based access (purpose header + policy-service purpose check) | policy-service + gateway | Large |
| **P2** | Field-level disclosure filtering (RBAC at field level) | packages/auth + all services | Very Large |
| **P3** | Ministry integration cell + cross-state analytics | analytics-service + infra | Large |
| **P3** | LGD API adapter (location-service sync) | packages/gov-adapters | Medium |
| **P4** | DigiLocker state gateway adapter | packages/gov-adapters | Medium |
