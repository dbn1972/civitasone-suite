# D04 — Module Inventory (District Governance Lens)
_Lane L01 · Generated 2026-07-13 · Branch: court-management-service_

> **EXTENDS** `03-module-inventory.md` (do not re-read that file for basic facts — this document adds district-specific columns). Maturity column is carried forward from the prior inventory; district-lens columns are new evidence gathered on 2026-07-13.

---

## Column Definitions

- **Tenant-aware**: Y = FORCE RLS + GUC on all paths; P = FORCE RLS present, but read path or route-write not fully wired (cite 08-tenant-isolation-report.md); N = no RLS
- **Office-aware**: Y = formal `officeId`/`officeCode`/`officeType` column in schema; P = has `departmentId`, `station`, or `orgUnit` (partial); N = none
- **Jurisdiction-aware**: Y = formal `jurisdictionId` FK or `adminUnitId` linked to location hierarchy; P = `district`/`block`/`zone` as free-text or loosely typed ref; N = none
- **State-configurable**: Y = feature-flags or config-registry drives behaviour (no hardcoded state structure); P = partial (some config paths, some hardcoded); N = hardcoded logic/roles
- **Indep-deployable**: Y = self-contained service; N = deployment dependency found (e.g. DB owned by wrong role)
- **Coupling-risk**: L=Low M=Medium H=High Crit=Critical
- **Maturity** (from 03-module-inventory.md test execution): Complete / Near-Complete / Partial / Stub / High-Risk

---

## Service Inventory Table (District Lens)

| # | Service | Business Capability | DB (`civitas_*`) | #Tables | APIs (routes) | Events Produced | Events Consumed | Redis | Tenant-aware (Y/P/N) | Office-aware (Y/P/N) | Jurisdiction-aware (Y/P/N) | State-configurable (Y/P/N) | Indep-deployable | Coupling Risk | Maturity |
|---|---------|---------------------|-----------------|---------|--------------|----------------|----------------|-------|----------------------|----------------------|---------------------------|---------------------------|-----------------|---------------|----------|
| 1 | **admin-service** | Control-plane: tenant mgmt, feature flags, config, webhooks, API keys, break-glass, backup | civitas_admin | 17 | 64 | ~8 CMDS / ~5 EVENTS | none | Y | **P** — FORCE RLS present; read path fix pending (08-report Wave 2) | N | N | **P** — feature-flags table exists; module-guard unwired | Y | M | Partial |
| 2 | **analytics-service** | KPI dashboards, fact ingestion, scheduled exports, cross-service metrics | civitas_analytics | 9 | 25 | ~8 CMDS / ~5 EVENTS | finance/hrms facts | Y | **P** — RLS GUC not recognised on test DB (`unrecognized configuration parameter "app.tenant_id"`); partially proven | N | N | N | Y | M | Near-Complete |
| 3 | **asset-service** | Fixed-asset register, lifecycle (acquisition→disposal), depreciation, insurance | civitas_asset | 21 | 39 | ~8 CMDS / ~6 EVENTS | estab disposal decision | Y | **P** — Wave 2 read-path fix pending | **P** — `orgUnit varchar(64)` in register schema [`register/schema.ts`] | N | N | Y | M | Partial |
| 4 | **audit-service** | Internal/statutory audit, para state-machine, CAG categories, vigilance | civitas_audit | 17 | 38 | ~7 CMDS / ~3 EVENTS | none | Y | **P** — Wave 2 read-path; cross-tenant RLS test failures | N | N | N | Y | M | Partial |
| 5 | **billing-service** | SaaS billing, subscriptions, GST e-invoice, payment gateways | civitas_billing | 14 | 39 | ~10 CMDS / ~13 EVENTS | tenant events | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 6 | **citizen-service** | Grievance portal, RTI Act 2005 deadline, SLA rules, AI routing, CPGRAMS stub | civitas_citizen | 18 | 44 | ~8 CMDS / ~19 EVENTS | identity events | Y | **P** — Wave 2 read-path fix pending; 8/15 authz tests fail | N | **P** — `sla-rules` module references `jurisdiction_id` [`sla-rules/repo.ts`] | N | Y | M-H | Partial |
| 7 | **contract-service** | Contract lifecycle, clauses, templates, e-sign, obligations, rate-contracts | civitas_contract | 15 | 52 | ~9 CMDS / ~13 EVENTS | procurement events | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 8 | **court-service** ★ | Court registry (§5–§35.5 CPC/NIC): case registration (CNR UUIDv5), hearings, orders (maker-checker + DSC), appeals, notices, evidence (SHA-256), cause-list, certified copies, DPDP PII AES-256-GCM | civitas_court | **22** | 73 | 39 CMDS / 36 EVENTS | **0 consumed** (`CONSUMED_EVENTS={} as const`) | Y (scheduler) | **Y** — FORCE RLS proven (court/visitor/meeting = the 3 pre-Wave-2 proofs); GUC in `shared/db.ts` | N | **P** — `courts.jurisdiction` is `text` free-form (not a FK to location hierarchy) [`court-registry/schema.ts:31`]; `courts.parentCourtId` for internal hierarchy | **P** — `config_entries` table (§47 config keystone) present; court type/jurisdiction configurable | **N** — `civitas_court` DB owned by `civitas_admin`, not `court_svc` [VERIFIED: `\l`] ⚠ P0 security gap | L | Complete |
| 9 | **crm-service** | Contacts, leads, deals, pipeline, activities | civitas_crm | 7 | 31 | ~6 CMDS / ~19 EVENTS | identity events | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 10 | **estab-service** | eOffice, NAI archival, committee, DFA, eSign, facilities, handover, DSP numbering | civitas_estab | 42 | 117 | ~15 CMDS / ~15 EVENTS | workflow/committee decisions | Y | **P** — Wave 2 read-path fix pending; 20% test-fail | N | N | N | Y | H | High-Risk |
| 11 | **finance-service** | Budget, GL (journal/reverse), treasury, payments (PFMS/TRACES), GST, TDS, period-close, HOA codes | civitas_finance | 39 | 115 | ~25 CMDS / 8 EVENTS | payroll runs, procurement GRN, grant UC, audit para, ML anomaly | Y (1 scheduled) | **P** — 8 services' read path fixed (08-report Phase B); 3 route-writes via bare `db.execute` still pending | **P** — `org.legal_entities` has `ddoCode`, `paoCode`, `treasuryCode`; `org.costCenters` has `departmentId` [`org-structure/schema.ts`] | N — cost centres reference departments, not administrative units | **P** — HOA code + demandNo configurable; fiscalYearStart configurable; DDO/PAO hardcoded per-entity | Y | L-M | Partial |
| 12 | **gateway-service** | API gateway: prefix routing, JWT edge, circuit-breaker, module-guard (unwired) | (none — infra) | 0 | 0 | none | none | N | N/A (infra) | N | N | **P** — routes per service registered; module-guard BUILT UNWIRED | Y | L | Complete (infra) |
| 13 | **grant-service** | Grant scheme, application, beneficiary onboarding, approval-gated disbursement, UC | civitas_grant | 16 | 29 | ~8 CMDS / ~17 EVENTS | finance/eOffice approval events | Y | **P** — Wave 2 read-path pending; 63% test-fail (all disbursement paths) | N | N | N | Y | H | High-Risk |
| 14 | **helpdesk-service** | ITSM ticketing, SLA engine, CMDB, ML breach prediction | civitas_helpdesk | 5 | 22 | ~5 CMDS / ~10 EVENTS | citizen/employee events | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 15 | **hrms-service** | Employee lifecycle, leave, attendance (geo-fence), appraisal, recruitment, pension, disciplinary (Rule 14) | civitas_hrms | 50 | 246 | ~40 CMDS / ~9 EVENTS | payroll run approved | Y | **P** — Phase B read path fixed (08-report); 61 route-writes via bare `db.execute` pending | **P** — `hrmsDepartments.govtTier ('central'\|'state'\|null)`, `hrmsEmployees.station varchar(128)`, `departmentId` [`employee/schema.ts`]; no `officeId` | N — `station` is varchar not a FK to admin units | **P** — `type` and `govtTier` on dept are edition-configurable vocab; pay-matrix per-edition | Y | M | Partial |
| 16 | **identity-service** | Users, RBAC roles, MFA, WebAuthn, SAML/SCIM, sessions, break-glass | civitas_identity | 16 | 57 | ~10 CMDS / ~14 EVENTS | none | Y | **P** — Phase B read path fixed (08-report); 16 route-writes via bare `db.execute` pending; 24% test-fail | N — `users` table: `tenantId, email, name, empCode` only — **no `officeId`, no `postingId`, no `jurisdictionId`** [`users/schema.ts`] | N | **P** — roles/permissions configurable; break-glass approved via `platform_admin` (hardcoded role) | Y | H | High-Risk |
| 17 | **install-service** | Installation orchestrator: provisioning stages, per-tenant DB creation, bootstrap | civitas_install | 5 | 8 | ~4 CMDS / ~6 EVENTS | provision complete | Y | **Y** — FORCE RLS present | N | N | N | Y | L | Complete |
| 18 | **inventory-service** | Item catalog (canonical), stores, stock movements, batches, FIFO/WACM costing, 3-way match | civitas_inventory | 15 | 38 | ~8 CMDS / ~14 EVENTS | procurement GRN | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | L-M | Near-Complete |
| 19 | **knowledge-service** | Document management, versioning, AI search (Meilisearch), retention policy | civitas_knowledge | 6 | 32 | ~7 CMDS / ~16 EVENTS | none | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | L | Complete |
| 20 | **legal-service** | Legal cases, hearings, counsel, eCourts integration stub, opinions, settlements | civitas_legal | 20 | 49 | ~12 CMDS / ~7 EVENTS | contract/court events | Y | **P** — Wave 2 read-path fix pending | N | **P** — eCourts integration stub references external court jurisdiction | N | Y | L | Near-Complete |
| 21 | **location-service** | Location hierarchy (state→district→block→gp→ward→zone), geofence, jurisdiction mapping, routing | civitas_location | 5 | 28 | ~7 CMDS / ~10 EVENTS | none | Y | **Y** — FORCE RLS; `tenantId` on all tables | **P** — `jurisdictions.officeId UUID` present but no office registry service [`jurisdiction/schema.ts:8`] | **Y** — `administrative_units` with typed hierarchy; `jurisdictions(officeId, unitId, level)` [`hierarchy/schema.ts`, `jurisdiction/schema.ts`] — BUT missing: `tehsil`, `division`, `ulb`, `police_station` enum values | N | Y | L | Near-Complete |
| 22 | **meeting-service** | Board/committee governance, agenda, voting (STV/weighted), VC, decisions, minutes | civitas_meeting | 24 | 125 | ~45 CMDS / ~50 EVENTS | employee tenure events | Y | **Y** — FORCE RLS proven pre-Wave-2; GUC in `shared/db.ts` | N | N | N | Y | L | Complete |
| 23 | **metadata-service** | Custom entity definitions, field definitions, layout, validation rules | civitas_??? | **5 (stub)** | **0** | **none** (no `topics.ts`) | none | **No** | **N** — schema has 5 FORCE RLS stmts but no GUC plumbing; no HTTP surface | N | N | N | **N** — no routes, no worker, no gateway entry ⚠ Stub | H | Stub |
| 24 | **ml-service** | Model registry, training orchestration, feature store, inference, evaluation, predictions | civitas_??? (no DB entry found) | 5 | 11 | ~8 CMDS / ~20 EVENTS | finance transactions, hrms events | Y | **P** — 5 FORCE RLS in 1 migration; GUC plumbing minimal | N | N | N | Y | L | Complete |
| 25 | **notification-service** | Multi-channel (email/SMS/push/in-app), templates, bulk dispatch, ML delivery window | civitas_notification | 10 | 25 | ~6 CMDS / ~18 EVENTS | domain events cross-service | Y | **P** — Phase B read path fixed (08-report); `smtp-sender.js` missing (production startup crash) | N | N | N | Y | M-H | Partial |
| 26 | **payroll-service** | Payroll run, payslip PDF, Form 16 + DSC, PF/ESI/TDS/PT statutory returns, NACH, FnF | civitas_payroll | 28 | 53 | ~15 CMDS / ~11 EVENTS | hrms.employee events | Y | **P** — Phase B read path fixed (08-report); topic mismatch BL-03 (payroll→finance GL silent-fail) | N | N | N | Y | M | Partial |
| 27 | **plugin-service** | Plugin registry, sandbox JS, runtime hook system | civitas_plugin | 5 | 17 | ~5 CMDS / ~8 EVENTS | none | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | L | Complete |
| 28 | **policy-service** | RBAC role mgmt, ABAC attribute bindings, role-feature entitlements, policy eval | civitas_policy | 6 | 21 | ~5 CMDS / ~9 EVENTS | none | Y | **P** — Wave 2 read-path fix pending; access-control mutation audit gap | N | N | N | Y | M | Partial |
| 29 | **procurement-service** | Indent, RFQ, tender, auction, GeM, PO, GRN, 3-way match, vendor blacklist, GFR | civitas_procurement | 24 | 65 | ~20 CMDS / ~26 EVENTS | finance GL, inventory | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 30 | **project-service** | WBS/scheme, progress tracking, geo-tagging, delay forecast (AI), evidence upload | civitas_project | 17 | 37 | ~10 CMDS / ~15 EVENTS | finance/grant events | Y | **P** — Wave 2 read-path fix pending | N | **P** — geo-tagging module; `geo` schema references lat/lng + location codes | N | Y | L | Near-Complete |
| 31 | **queue-service** | Message queue infra (adapters: memory/SQS/Kafka/RabbitMQ), DLQ, observability | (none — infra) | 0 | 0 | none | none | N | N/A (infra) | N | N | **P** — adapter pattern (configurable) | Y | L | Complete (infra) |
| 32 | **report-service** | MIS reports, KPI dashboards, scheduled jobs, PDF/Excel | civitas_report | 4 | 20 | ~5 CMDS / ~9 EVENTS | none | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 33 | **stock-service** | Stock ledger, GRN receipts, issue transactions, warehouse mgmt, e-way bill | civitas_stock | 11 | 19 | ~5 CMDS / ~1 EVENT | procurement events | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | L | Near-Complete |
| 34 | **telephony-service** | IVR design, inbound/outbound calls, DID mgmt, recording + transcription, agent queue | civitas_telephony | 7 | 31 | ~8 CMDS / ~16 EVENTS | none | Y | **P** — Wave 2 read-path fix pending | N | N | N | Y | M | Partial |
| 35 | **tenant-service** | Tenant CRUD, subscription plan mgmt, quota enforcement, settings | civitas_tenant | 6 | 39 | ~8 CMDS / ~19 EVENTS | none | Y | **P** — Wave 2 read-path fix pending | N | **P** — `tenants.region`, `tenants.residency` (string fields, not linked to admin-units) | **P** — `edition`, `orgCategory`, `isolationTier` configurable; `settings` JSONB; BUT no `officeType`, no `lgdCode`, no `parentTenantId` [`tenant/schema.ts`] | Y | L-M | Partial |
| 36 | **theme-service** | Branding design tokens, CSS theme templates, white-label per tenant | civitas_theme | 5 | 9 | ~3 CMDS / ~3 EVENTS | none | Y | **P** — Wave 2 read-path fix pending | N | N | **Y** — themes are per-tenant configurable; no hardcoded state structure | Y | L | Complete |
| 37 | **visitor-service** | VMS, digital passes (QR/JWT + AES-256-GCM), check-in/out, blacklist, turnstile, DPDP purge | civitas_visitor | 28 | 88 | ~35 CMDS / ~50 EVENTS | identity events | Y | **Y** — FORCE RLS proven pre-Wave-2; GUC in `shared/db.ts` | N | N | N | Y | L | Complete |
| 38 | **workflow-service** | BPMN process engine, DMN decision tables, human task assignment/delegation, simulation | civitas_workflow | 15 | 72 | ~15 CMDS / ~11 EVENTS | trigger events from cross-service | Y | **P** — Phase B read path fixed (08-report); `workflow_svc` role has BYPASSRLS (infra misconfig) | N | N | **P** — DMN decision tables allow state-configurable routing | Y | L | Near-Complete |

---

## District-Lens Summary Statistics

### Office-Aware: 5 / 38 (13%)

| Service | Evidence | Grade |
|---------|----------|-------|
| finance-service | `org.legal_entities.ddoCode`, `paoCode`, `treasuryCode`; `costCenters.departmentId` | P |
| hrms-service | `hrmsDepartments.govtTier`, `hrmsEmployees.station`, `departmentId` | P |
| location-service | `jurisdictions.officeId UUID` (no registry) | P |
| asset-service | `register.orgUnit varchar(64)` | P |
| court-service | `courts.establishmentCode varchar(64)` | P |

**Finding**: No service has a formal, FK-linked `officeId` pointing to a canonical office registry. `officeId` in `location.jurisdictions` is an opaque UUID with no registry behind it. **An office registry service does not exist.** [VERIFIED by grep across all schemas]

### Jurisdiction-Aware: 3 / 38 (8%)

| Service | Evidence | Grade |
|---------|----------|-------|
| location-service | `administrative_units(type: state\|district\|block\|gp\|ward\|zone)` + `jurisdictions(officeId, unitId, level)` | Y |
| citizen-service | `sla-rules/repo.ts` references `jurisdiction_id` | P |
| court-service | `courts.jurisdiction text` (free-form, no FK) | P |

**Finding**: Jurisdiction awareness is present structurally only in location-service, and even there the `administrative_units` type enum is missing `tehsil`, `division`, `ulb`, `police_station` — the four most critical levels for district administration. [VERIFIED: `location-service/src/modules/hierarchy/schema.ts`]

### State-Configurable: 6 / 38 (16%)

| Service | Evidence | Grade |
|---------|----------|-------|
| theme-service | Per-tenant configurable tokens | Y |
| admin-service | feature_flags table; config table | P |
| gateway-service | module-guard reads from admin (unwired) | P |
| tenant-service | edition, orgCategory, isolationTier, settings JSONB | P |
| finance-service | HOA code, demandNo, fiscalYearStart configurable | P |
| workflow-service | DMN decision tables (state-configurable routing) | P |

**Finding**: 32/38 services have hardcoded role lists (e.g. `["platform_admin", "super_admin"]`), hardcoded enum values, and hardcoded business rules. State-specific customisation (e.g. different nomenclature for Maharashtra vs Uttar Pradesh) requires code changes, not configuration. **This is the P1 gap for multi-state rollout.**

### Tenancy Depth (Org Model)

**Current**: `Tenant → Department (hrms only) → User` — **flat, no inter-tenant parent-child**

**Required for District Platform**: `Ministry → State Secretariat → DGP/Commissioner → Division → District → SDM/SP → Tehsil/Block → Panchayat/Police Station`

All 12 levels of this hierarchy must be representable as either:
1. `tenant` rows with `parentTenantId` + `officeType` + `lgdCode` (federated-tenant model), OR
2. A separate `org-node` service that models the hierarchy independently of tenant provisioning

[PROPOSED] Recommendation: federated-tenant model is architecturally simpler (reuses all existing RLS + CQRS plumbing), but requires the 4 schema additions in `d02-current-architecture.md §6.1`.

---

## Top District-Readiness Blockers (Implementation-Ready)

| # | Priority | Service | Gap | Fix |
|---|----------|---------|-----|-----|
| 1 | **P0** | court-service | DB owned by `civitas_admin` not `court_svc` — can bypass FORCE RLS on DDL | `ALTER DATABASE civitas_court OWNER TO court_svc;` + `REASSIGN OWNED BY civitas_admin TO court_svc IN civitas_court;` (after migrating) |
| 2 | **P0** | tenant-service | No `parentTenantId`, `officeType`, `lgdCode`, `adminUnitId` | DDL in `d02 §6.1`; new migration in `tenant-service/migrations/` |
| 3 | **P0** | location-service | Admin unit type enum missing `tehsil`, `division`, `ulb`, `police_station` | `ALTER TYPE hierarchy.unit_type ADD VALUE …` (Postgres enum add-only, no rewrite needed) |
| 4 | **P0** | identity-service | `users` table has no `officeId`, `postingId`, `jurisdictionId` | New `posting` module in `hrms-service` or `identity-service`; users bind via HRMS posting |
| 5 | **P0** | court-service | `courts.jurisdiction` is free-text, not a FK to location hierarchy | Change to `jurisdiction_unit_id UUID` (opaque ref to location-service) |
| 6 | **P0** | court-service | `CONSUMED_EVENTS = {}` — 0 inbound; 27 events unconsumed downstream | Wire `court.order.issued` → legal/notification; `court.notice.issued` → notification |
| 7 | **P1** | workflow_svc DB role | `workflow_svc` has BYPASSRLS — bypasses all RLS policies | `ALTER ROLE workflow_svc NOBYPASSRLS;` (infra bootstrap) |
| 8 | **P1** | All 32 services | Hardcoded role lists + hardcoded enum vocabulary | Phase: metadata-service routes first (unlock config-driven vocabulary); then inject via `admin.feature_flags` / `tenant.settings` |
| 9 | **P1** | metadata-service | Complete stub — 5 tables, 0 routes, no gateway entry | Priority: build routes.ts + consumer.ts + topics.ts + worker; add gateway entry at `/api/v1/metadata` port 3036 |
| 10 | **P1** | payroll + finance | BL-03: `payroll.run.finalized` (payroll) ≠ `payroll.run.finalized` (finance consumes) — payroll emits `runDisbursed` | In `payroll/src/topics.ts` add `runFinalized = "payroll.run.finalized"`; emit after bank transfer confirmation |
| 11 | **P1** | notification-service | `smtp-sender.js` missing — service crashes at startup on email channel | Create `src/modules/email/smtp-sender.ts` (nodemailer wrapper) |
| 12 | **P2** | All services | No inter-tenant delegation model | New table `rbac.inter_tenant_grants` (DDL in `d02 §6.1`); new `policy-service` evaluation path for cross-tenant scope checks |
| 13 | **P2** | packages/gov-adapters | Missing LGD API, DigiLocker, UMANG adapters | Add `lgd.ts`, `digilocker.ts`, `umang.ts` to `packages/gov-adapters/src/` |
| 14 | **P2** | tenant-service | `TenantRouter` built but no cell-registry, no placement engine | Build `packages/cell-registry` (lookup table: lgdCode → cell DSN); wire in `TenantRouter.resolver` |
| 15 | **P3** | grant-service | 63% test failure rate — all disbursement approval paths broken | Fix before state-rollout; not blocking district pilot if grant disbursements excluded from scope |
