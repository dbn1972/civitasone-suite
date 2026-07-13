# D00 — Final Verdict: CivitasOne District Governance Platform Assessment

**Lane L10 · Review Board Chair · 2026-07-13 · Branch: court-management-service**

> This document is the authoritative output of the District Governance Architecture Review Board. It synthesises all prior lane deliverables (d02–d28) and the base ERP assessment files (00-final-verdict.md, 07-integration-matrix.md, 08-tenant-isolation-report.md). All claims are evidence-cited.

---

## §35 — 21 Architecture Questions: Direct Answers

### Q1. Can a District Collector (DC) use this platform today for their internal ERP needs?

**Partially — with significant caveats.** The generic modules (eOffice, HRMS, payroll, finance, procurement, workflow, meetings, knowledge, legal, citizen grievance stub, asset/stock, notification) are feature-complete and tested. A DC can use CivitasOne for internal file movement, HRMS/payroll of collectorate staff, financial vouchers and budget, and procurement. **HOWEVER:** (a) no org-model means the DC cannot scope their jurisdiction — an SDM can see all district data; (b) no backup means any data loss is permanent; (c) CPGRAMS is a stub; (d) coordination workflows (force-requisition, Sec-144, disaster) are absent; (e) certificate issuance (domicile, income, caste, OBC) is absent. Current classification: **Collectorate-internal-ERP, NOT district-governance platform.**

### Q2. Can the SP use this platform for police administration today?

**No.** The police hierarchy is not representable — `police_station`, `circle`, `range`, `beat` unit types are absent from `hierarchy.administrative_units` (which is itself not migrated to the DB). There is no police-admin service. Duty-roster, arms-register, deployment management, and station inspection modules do not exist. The single shared Redis/S3/Meilisearch cluster has no domain isolation — police data and civil data would share a cache namespace. The platform cannot be used for any police-specific function today. [Evidence: d06 §1, d10 §2A-B, d15 §B.1]

### Q3. Can SDM / Tehsil offices be configured on this platform today?

**No.** The `subdivision` and `tehsil` unit types are absent from the enum in `hierarchy.administrative_units`, which is itself not migrated to the live DB. `RequestContext` contains no `officeId` or `jurisdictionId` — RLS cannot scope an SDM to their sub-division. Revenue court presets exist in `court-service/src/modules/config-registry/presets.ts` but cannot be activated without an office entity. [Evidence: d11 §3–5, d23b §1.2, `packages/types/src/index.ts:71`]

### Q4. Can Block Development Officers (BDOs) and Gram Panchayats be served?

**Only generically.** `block` and `gp` unit types exist in TypeScript code but are not in the DB. Generic HRMS, finance, and eOffice work for any department, so a BDO using CivitasOne as an internal ERP would be functionally similar to the Collectorate. However: no scheme-registry, no PFMS inbound, no Mgnregs/NREGS integration, no geo-tagged project monitoring linked to GP units. The platform does not meet RD department requirements. [Evidence: d12 §3–5]

### Q5. Can multiple line departments (Health, Education, PWD, Agriculture) be onboarded simultaneously?

**With manual effort — yes, but not at scale.** 15 generic platform modules are available. However: (a) module-guard is unwired so entitlement enforcement is absent; (b) metadata-service is a stub with 0 routes, meaning department-specific vocabulary is hardcoded in TypeScript; (c) no automated onboarding wizard exists; (d) per-department KMS is absent (`kmsKeyRef = NULL`). Manual onboarding of up to 5 departments is feasible with current tooling; 20+ departments or multi-state requires metadata-service and automated provisioning. [Evidence: d13 §4, `gateway-service/src/module-guard.ts:12-14`]

### Q6. Is the CQRS implementation correct and complete?

**Foundation is correct; coverage is ~70%.** The route→zod→queue.publish→202→consumer→outbox→DB→cache-refresh pattern is correctly implemented in the services reviewed (finance, procurement, HRMS, payroll, court). Transactional outbox (`packages/outbox`) and idempotent inbox (`_inbox.processed`, markProcessed-first) are correctly designed. **Gaps:** (a) `payroll.run.disbursed` vs `payroll.run.finalized` topic mismatch breaks finance GL consumer; (b) 27 court service events have no registered consumer; (c) `billing.invoice.settled` → finance revenue topic broken. [Evidence: d02 §4, 07-integration-matrix.md §BL-01 through BL-07]

### Q7. Is tenant isolation strong enough for district government use?

**Not yet.** SEC-P0 gateway bypass is fixed (`2ba2911`). Wave 1 is complete. But: (a) Wave 2 read-path is pending on ~23 services (headers vs JWT verified for reads); (b) `workflow_svc` has BYPASSRLS; (c) police and civil data share Redis/S3/Meilisearch with only a key prefix for separation; (d) `kmsKeyRef = NULL` — no per-tenant encryption at rest. Tenant isolation is fail-closed (no known leak) but is not production-grade for government data classified as Sensitive or Confidential. [Evidence: 08-tenant-isolation-report.md §Residual, d15 §B.1]

### Q8. Is the organisation model implemented for district governance?

**No — this is the single most critical structural gap.** The org model (offices, positions, postings, jurisdiction assignments, delegation) is the foundational P0 blocker from which all other district-platform capabilities cascade. `hierarchy.administrative_units` exists in TypeScript schema files but is NOT MIGRATED to the live PostgreSQL database. `RequestContext` (`packages/types/src/index.ts:71`) contains only `tenantId + actorId + actorType + roles[] + correlationId` — no `officeId`, `positionId`, or `jurisdictionId`. Every district-scoped access decision, every office-specific workflow routing, every jurisdiction-fenced data view is blocked until this is built and migrated. [Evidence: d05 §2, d23b §1.2]

### Q9. Is the ABAC / policy engine sufficient for district governance access decisions?

**No.** `evaluateDecision()` in `policy-service/src/modules/evaluate/domain.ts` performs role-based checks only — it never reads the `abac.rules` table. The rules table has 3 rows (all permitting all routes for the admin role), which confirms it was created but never operationalised. District governance requires attribute-based decisions incorporating `officeId`, `positionId`, `jurisdictionId`, `govLevel`, `postalCode`, and `purpose-code` — 12 decision inputs that are architecturally absent. [Evidence: d23b §1.3, `policy-service/src/modules/evaluate/domain.ts`]

### Q10. Is the event/integration architecture ready for district-state-ministry integration?

**Backbone is ready; envelope and topics are not.** The transactional outbox, idempotent consumers, DLQ, and schema registry are architecturally sound. However: (a) the event envelope is missing 8 district-platform fields (`officeId`, `jurisdictionId`, `govLevel`, `district` LGD code, `state` ISO code, `department`, `classification`, `retentionPolicy`); (b) 45 new district event topics are needed across 9 domains (coordination, disaster, police, scheme/ministry, election, grievance, hierarchy, reporting, exchange); (c) 6 existing integration linkages are broken (topic name mismatches). [Evidence: d19 §1–3, d20 §1–26]

### Q11. Are government-specific integrations (PFMS, CPGRAMS, CCTNS, LGD, DigiLocker) present?

**Partially — 4 of 11 adapters exist.** Present: GSTN verification, NACH disbursement, PFMS outbound payment (`pfms-adapter.ts`), TRACES TDS. Missing: PFMS inbound (fund releases from ministry), CPGRAMS inbound routing, CCTNS read-only approved adapter (CCTNS data must NOT enter CivitasOne per MHA Policy 2.0), LGD master data sync, DigiLocker pull/push, ICJS read-only integration, state IFMS. Each missing adapter blocks a statutory workflow. [Evidence: d20 §GI-01–GI-05, `services/*/src/adapters/` directory scan]

### Q12. Is the security architecture suitable for police and treasury data?

**No.** Police and treasury data have distinct security domain requirements (separate network zones, dedicated hardware, per-domain CMK, separate audit trail). CivitasOne uses a single shared infrastructure stack. `kmsKeyRef = NULL` for all tenants. No `security_domain` column on HRMS departments. Single Redis, S3, and Meilisearch shared across all tenants. Without dedicated Police and Treasury cells, these domains cannot be safely hosted. [Evidence: d15 §B.1, d16 §5, 08-tenant-isolation-report.md]

### Q13. Is the deployment architecture suitable for 640 districts at scale?

**Not yet — the cell model is designed but not provisioned.** The recommended Hybrid Federated model (Option D: per-dept-per-district pool cells + Police/Treasury silo cells + state control plane cell) is architecturally sound and implementable. However: (a) the tenant-router (`packages/db/src/tenant-router.ts`) is built but unwired — all 38 services use a singleton `DATABASE_URL`; (b) no cell registry table exists in any live DB; (c) no automated district provisioning wizard; (d) Terraform production modules are commented out; (e) no backup/PITR configured. Current state is a single Docker container. [Evidence: d23 §2, d21 §2, `infra/aws/envs/production/main.tf:12-15`]

### Q14. Are disaster response and emergency management capabilities present?

**Absent.** `grep -r "disaster\|SDRF\|SEC144\|force.requisition" services/*/src` returns 0 results in the codebase. No disaster-service or disaster module exists. No coordination-service for DM-SP workflows. SDRF fund release cannot be tracked. Force-requisition order cannot be issued digitally. Sec-144 order cannot be tracked. NDMA relief integration absent. This is a critical gap for district governance where disaster response is a statutory duty. [Evidence: d09 §2.1–2.5, d17 §2]

### Q15. Is court-service (revenue courts, magisterial courts) complete for district use?

**Mostly complete as an internal registry; not jurisdiction-scoped.** court-service has: BPMN-driven case workflow, evidence tamper chain, cause list generation, fee e-payment stub, preset config-registry for Revenue Court / Magistrate / CJM / Motor Accident / Consumer / SDM, and a `firNo` opaque reference field. **Gap:** Without the org model (`officeId`/`positionId`), a court cannot be scoped to an office — a CJM could see cases from all courts. CCTNS/ICJS integration must be read-only adapter only (statutory constraint). [Evidence: d11 §7, d10 §A07, `court-service/src/modules/config-registry/presets.ts`]

### Q16. Is the analytics and reporting architecture suitable for district governance dashboards?

**Adequate for single-tenant; inadequate for cross-district aggregation.** analytics-service works at tenant level. For district governance, dashboard aggregation must cross: (a) all departments in a district (cross-tenant in current model); (b) all districts in a division/state (cross-cell); (c) scheme progress aggregates from BDO/GP upward to ministry. None of these aggregation paths are implemented. report-service has no `govLevel` parameter. `analytics_svc` has a known RLS test failure (`unrecognized configuration parameter "app.tenant_id"`). [Evidence: d04 §row 2, d17 §5]

### Q17. Are the data governance and DPDP compliance requirements met?

**No.** Critical gaps: (a) grant-service Aadhaar and bank account PII stored in plaintext (grep confirms zero `encryptedText` calls in grant-service); (b) `kmsKeyRef = NULL` — all data under a shared dev key; (c) no purpose-code enforcement (DPDP §4 purpose limitation architecturally absent); (d) no data-sharing agreement governance table; (e) no field-level data classification on schema columns; (f) uniform 180-day retention insufficient for legal/election/revenue records (7+ years required). [Evidence: d14 §5, d15 §C.1, `packages/types/src/index.ts:883`]

### Q18. What is the current test coverage and quality posture?

**Mixed.** Most services pass their own unit/integration tests. Known failures: grant-service 63% test failure (disbursement consumer broken); analytics-service RLS test failure; notification-service startup crash (`smtp-sender.js` missing). No E2E test suite against a staging environment. No performance/load test results. No DR drill. Court-service has 11/11 tests passing with evidence tamper chain and cause list tests. Finance, HRMS, payroll, procurement all have high pass rates. [Evidence: erp-assessment/03-module-inventory.md, d02 §5]

### Q19. Can the platform be adopted by multiple Indian states simultaneously?

**No — not at current maturity.** The platform is not multi-state-ready because: (a) 32/38 services hardcode state government terminology (`STATE_GOVT_TYPES`, ministry labels, role names) as TypeScript constants; (b) metadata-service is a stub with 0 routes — no vocabulary configuration mechanism; (c) no state-specific hierarchy seed data mechanism; (d) no per-state Keycloak realm; (e) no automated district provisioning; (f) the tenant-router is unwired. Multi-state requires metadata-service + tenant-router + cell-registry + per-state onboarding automation. [Evidence: d09b §3, d13 §3, `hrms-service/src/modules/employee/dept-domain.ts`]

### Q20. What is the minimum viable path to a limited district pilot?

**Phase-0 must complete first (8–12 months, 6-engineer team).** Minimum path:
1. Migrate org model to DB + seed 1 district hierarchy
2. Enrich JWT with `officeId` + wire ABAC
3. Enable RDS backup/PITR
4. Complete Wave 2 RLS read-path
5. Fix `workflow_svc` BYPASSRLS
6. Fix 6 broken event topic linkages
7. Fix grant-service disbursement consumer
8. Build CPGRAMS inbound adapter
9. Build coordination-service skeleton (disaster + force-requisition only)
10. Provision Collectorate pilot cell (shared pool tier)

Then: Phase-1 Collectorate ERP configuration (3–4 months). Earliest date for a limited-district pilot with one Collectorate: **~12 months** from today (2027-07). [Evidence: d26 §Phase-0, d27 §Phase-Summary]

### Q21. What is the recommended district federation model?

**Option D — Hybrid Federated.** One tenant per department per district (pool tier, ~100 districts/shared cell). Police in dedicated silo cells (one per state, isolated network zone, dedicated CMK). Treasury in dedicated silo cells (one per state). State control plane as a parent-tenant cell that aggregates events and hosts the cell registry + onboarding wizard. LGD codes as canonical geographic identifiers. `parentTenantId` FK on `tenant.tenants` for the state→district hierarchy. This model provides the right balance of cost (pool tier for generic departments) vs. security (silo for police and treasury) vs. scalability (shared cell provisioning). [Evidence: d16 §4D, d21 §3]

---

## §37 — START-EXECUTION Outputs

### Top-25 Architectural Gaps (Ranked by Priority and Blast Radius)

| Rank | Gap ID | Description | Impact if Not Fixed |
|---|---|---|---|
| 1 | G-01 | `hierarchy.administrative_units` not migrated to DB | All 12+ district levels unrepresentable; every downstream gap is blocked |
| 2 | G-02 | `offices` / `positions` / `postings` entities absent | No office-scoped access; no RLS jurisdiction fence |
| 3 | G-03 | `RequestContext` carries no `officeId`, `positionId`, `jurisdictionId` | RLS policies cannot enforce office scope; ABAC inputs absent |
| 4 | G-04 | Zero backup / PITR / WAL archiving | Any disk failure = permanent loss of 35 databases |
| 5 | G-05 | `workflow_svc` BYPASSRLS | workflow-service reads all tenants' workflow state without restriction |
| 6 | G-06 | `civil.tenants.kmsKeyRef = NULL` — no per-tenant encryption at rest | Shared dev key protects all government data |
| 7 | G-07 | Police/Treasury domain not isolated (shared Redis/S3/Meilisearch/PG cluster) | Police confidential data shares namespace with civil data |
| 8 | G-08 | Wave 2 RLS read-path pending on ~23 services | Tenant header spoofing risk on ~23 services' read paths |
| 9 | G-09 | Coordination-service absent (force-requisition, Sec-144, disaster, election) | Statutory DM–SP workflows impossible |
| 10 | G-10 | ABAC rules table dead — `evaluateDecision()` never reads `abac.rules` | All access decisions are role-only; no attribute, position, or jurisdiction control |
| 11 | G-11 | Tenant-router unwired — all services use singleton `DATABASE_URL` | Cell-based scaling impossible; pool/silo/shard routing non-functional |
| 12 | G-12 | Module-guard unwired at gateway | All authenticated users can call all modules regardless of edition entitlements |
| 13 | G-13 | Event envelope missing 8 district-platform fields | District events cannot be geo-classified, jurisdiction-routed, or retained by policy |
| 14 | G-14 | 45 new event topics absent (coordination, disaster, police, scheme, election, grievance) | District coordination workflows have no event backbone |
| 15 | G-15 | 6 broken event linkages (payroll→finance, billing→finance, court→?) | Finance GL missing payroll cost; revenue not posted; court events unconsumed |
| 16 | G-16 | Metadata-service stub (0 routes, 0 gateway entry) | 32/38 services hardcode state terminology — multi-state impossible |
| 17 | G-17 | Grant-service PII plaintext (Aadhaar, bank account) — DPDP §4 | Statutory violation; beneficiary data exposed to SQL read |
| 18 | G-18 | Grant-service 63% test failure (disbursement consumer broken) | PFMS UC submission and SDRF payments non-functional |
| 19 | G-19 | Notification-service startup crash (`smtp-sender.js` missing) | Email delivery dead for all tenants |
| 20 | G-20 | PFMS inbound adapter absent | Ministry fund releases to districts cannot be tracked |
| 21 | G-21 | CPGRAMS inbound routing stub | Citizen grievances cannot be routed to correct department/officer |
| 22 | G-22 | `ministry` field is free-text string — no canonical ministry entity | Cross-district scheme aggregation impossible; ministry dashboards absent |
| 23 | G-23 | No parent-tenant model — cross-district/state aggregation impossible | State and ministry reporting chains technically infeasible |
| 24 | G-24 | Court-service DB owned by `civitas_admin` (superuser) — FORCE RLS bypass possible | Court case data not protected by RLS |
| 25 | G-25 | Schema registry in-memory — lost on restart | Breaking schema changes accepted silently after any restart |

### Recommended District Federation Model (One Line)

> **Option D — Hybrid Federated:** one pool-tier tenant per department per district (~100 districts/shared cell), Police and Treasury in dedicated silo cells per state (isolated PG + Redis + S3 + CMK + Keycloak realm), state control plane as parent-tenant cell with cell-registry + onboarding wizard; LGD codes as canonical geographic identifiers throughout.

### Recommended State + Ministry Integration Model (One Line)

> **Aggregation-up, federation-down:** state control plane cell aggregates district domain events via parent-tenant event router; ministry receives aggregated scheme progress and UC chain via scheme-registry push adapters (PFMS, NIC portal); no direct OLTP access by ministry to district DB; all cross-jurisdiction data exchange governed by data-sharing agreement table with `legalAuthority`, `fieldsShared`, and `purposeCode` fields.

### Explicit P0 List (Must-Complete Before Any District Pilot)

| P0 # | Action | Owner Service | Effort |
|---|---|---|---|
| P0-01 | Migrate `hierarchy.*` to DB; run `unit_types` lookup migration | packages/db, all services | 2 sprints |
| P0-02 | Build offices/positions/postings DDL + seed collectorate hierarchy | admin-service | 3 sprints |
| P0-03 | Enrich JWT with `officeId` + `positionId` + wire ABAC evaluator | identity-service, policy-service | 2 sprints |
| P0-04 | Enable RDS backup + WAL archiving + PITR; run first restore drill | infra/aws (Terraform uncomment) | 1 sprint |
| P0-05 | Complete Wave 2 RLS read-path on ~23 services | All services (systematic) | 3 sprints |
| P0-06 | Fix `workflow_svc` BYPASSRLS to NOBYPASSRLS | infra/db | 0.5 sprint |
| P0-07 | Fix `civitas_court` DB owner: `REASSIGN OWNED BY civitas_admin TO court_svc` | infra/db | 0.5 sprint |
| P0-08 | Fix 6 broken event topic linkages (payroll→finance, billing→finance, etc.) | payroll-service, billing-service | 1 sprint |
| P0-09 | Fix grant-service disbursement consumer (63% test failure) | grant-service | 1 sprint |
| P0-10 | Fix notification-service startup crash (`smtp-sender.ts` missing) | notification-service | 0.5 sprint |
| P0-11 | Extend event envelope with 8 district-platform fields | packages/events | 1 sprint |
| P0-12 | Wire tenant-router in 38 services; build cell registry table | packages/db, all services | 3 sprints |
| P0-13 | Wire module-guard against `admin.admin_module_configs` | gateway-service | 1 sprint |
| P0-14 | Build coordination-service skeleton (disaster + force-requisition modules) | new service | 4 sprints |
| P0-15 | Add `security_domain` column to HRMS departments; block police→civil reads | hrms-service, policy-service | 1 sprint |
| P0-16 | Build CPGRAMS inbound adapter | new adapter | 1 sprint |
| P0-17 | Encrypt PII fields in grant-service (Aadhaar, bank account) — DPDP §4 | grant-service | 1 sprint |
| P0-18 | Provision Police Dedicated Cell (isolated PG + Redis + S3 + Keycloak realm) | infra/aws | 2 sprints |

**P0 total: ~28 engineer-sprints (minimum, ±40%)**

---

## §36 — Final Classification

### Classification: **COLLECTORATE-INTERNAL-ERP-ONLY**

CivitasOne is **NOT a district-governance platform** at current maturity. It is **NOT ready for district-level government deployment** in any capacity that involves multi-office scoping, police administration, inter-department coordination, disaster response, scheme monitoring, or ministry integration.

### World-Class District Governance Criteria Checklist

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Multi-level administrative hierarchy (12+ levels) representable in live DB | **FAIL** | `hierarchy.*` not migrated; enum has 6 types only; `tehsil`/`subdivision` absent |
| 2 | Office-scoped identity (officeId in JWT + RLS jurisdictionFence) | **FAIL** | `RequestContext` has no `officeId` [`packages/types/src/index.ts:71`] |
| 3 | Production-grade disaster recovery (backup, PITR, tested restore) | **FAIL** | Zero backup; Terraform RDS module commented out |
| 4 | Police domain isolation (dedicated cell, domain-level CMK, separate network zone) | **FAIL** | Single shared cluster; no Police silo cell |
| 5 | DPDP-compliant data governance (purpose-code, PII encrypted at field level) | **FAIL** | Grant-service PII plaintext; no purpose-code enforcement |
| 6 | Coordination domain (DM–SP workflows, disaster, force-requisition) | **FAIL** | coordination-service absent |
| 7 | Scheme and ministry integration (PFMS inbound, scheme-registry, UC chain) | **FAIL** | PFMS inbound absent; ministry is free-text |
| 8 | CPGRAMS grievance routing to office | **FAIL** | CPGRAMS stub only |
| 9 | Certificate issuance (domicile, income, caste, OBC) | **FAIL** | No certificate-issuance module |
| 10 | Multi-state vocabulary configurability (metadata-service driven) | **FAIL** | metadata-service stub; 32/38 services hardcode vocabulary |
| 11 | Cell-based deployment (tenant-router wired, cell registry live) | **FAIL** | Tenant-router unwired; no cell registry |
| 12 | State and ministry aggregated dashboards (cross-cell) | **FAIL** | No cross-tenant aggregation; no cross-cell read-model |
| 13 | ABAC/policy with position and jurisdiction as first-class inputs | **FAIL** | `abac.rules` dead; evaluateDecision role-only |
| 14 | Module entitlement enforcement (module-guard wired) | **FAIL** | module-guard unwired; TODO comment in place |
| 15 | LGD-canonical geographic identifiers (live DB FK integrity) | **PARTIAL** | LGD field exists in schema but DB tables not migrated; no LGD API sync |
| 16 | Transactional CQRS + idempotent consumer + outbox (sound architecture) | **PASS** | packages/outbox + `_inbox.processed` markProcessed-first correctly implemented |
| 17 | Government-domain ERP for internal Collectorate use (finance/HRMS/payroll/procurement/eOffice) | **PASS** | 15 generic modules complete; 80%+ test pass rate on core services |

**Score: 2 PASS, 1 PARTIAL, 14 FAIL out of 17 criteria.**

### Distance to Classifications

| Classification | Verdict | Estimated Time (6-engineer team) | Key Gating Condition |
|---|---|---|---|
| **DEV / DEMO ONLY** | Current state | — | — |
| **Collectorate-internal ERP, single office** | Achievable | 6–8 months | Org model + backup + Wave 2 RLS |
| **Limited district pilot, 1 Collectorate, generic departments** | Achievable | 12–14 months | Phase-0 + Phase-1 complete |
| **Full Collectorate + SDM/Tehsil + BDO** | Achievable | 24–28 months | Phase-0 through Phase-2 complete |
| **Police + Civil integrated district** | Achievable | 30–36 months | Phase-0 through Phase-3 complete |
| **Multi-line-dept, multi-district, state-integrated** | Achievable | 36–42 months | Phase-0 through Phase-6 complete |
| **National scale, 640 districts, ministry-integrated** | Achievable | 42–48 months | All 8 phases complete |

---

## Summary Statement

CivitasOne Suite is a **well-architected, greenfield ERP** with a sound microservices substrate, correct CQRS implementation, strong database-per-service isolation, and genuine government domain knowledge embedded across finance, procurement, HRMS, payroll, court, legal, and citizen services. The engineering quality is **above average for a government ERP build** — the CQRS/outbox pattern is correctly implemented, RLS is fail-closed, and the domain models are thoughtfully designed.

**The gap is architectural, not quality-related.** The platform was built as a **multi-tenant internal ERP** (Tenant → Department → User, 3 levels). District governance requires an **office-and-jurisdiction-scoped platform** (Ministry → State → Division → District → SDM → Tehsil → Block → GP → Village, 12+ levels) with police domain isolation, emergency coordination capability, ministry financial integration, and cross-jurisdiction data governance. These are not "features to add" — they are foundational structural additions that require Phase-0 to be built before any district pilot is viable.

**Recommendation to the Board:** Approve funding for Phase-0 (28 engineer-sprints, ₹32–52L, 8–12 months) conditioned on: (1) hiring a Domain Architect with India state-government hierarchy expertise; (2) signing data-sharing agreements with NIC for LGD/PFMS inbound API access; (3) MHA approval for CCTNS read-only adapter (read-only boundary only — FIR data must never enter CivitasOne); (4) a formal org-model design review with 3 state hierarchy experts before DDL is committed.

**Do not deploy CivitasOne to any district in production until Phase-0 is complete and a PITR-tested backup demonstrates data recovery within 4 hours.**

---

**Overall District Readiness: 3 / 10**

*Evidence base: d02, d04, d05, d06, d09, d09b, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d23b, d24, d25, d26, d27, d28, 00-final-verdict.md, 07-integration-matrix.md, 08-tenant-isolation-report.md. Direct code verification: `packages/types/src/index.ts:71`, `gateway-service/src/module-guard.ts:12-14`, `infra/aws/envs/production/main.tf:12-15`, `court-service/src/modules/config-registry/presets.ts`, `packages/cache/src/index.ts:66-70`.*
