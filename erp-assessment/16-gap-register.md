# 16 — Gap Register

**Synthesised from:** Lanes L01–L09  
**Date:** 2026-07-12  
**Branch:** `court-management-service`

Gaps are requirement or coverage deficiencies that are NOT the same as code bugs — they represent missing features, incomplete integrations, untested scenarios, and architectural omissions.

---

## G1 — Missing Service Capability Gaps

| Gap ID | Service | Description | Category | Severity |
|--------|---------|-------------|----------|----------|
| G-CAP-01 | metadata-service | Zero API surface: 5 DB tables exist but no routes, no consumers, no topics.ts, no worker, no gateway registration. Custom entity/field management is completely inaccessible. | Feature missing | Critical |
| G-CAP-02 | hrms-service | Profile photo route returns 404 — route not implemented | Feature stub | High |
| G-CAP-03 | asset-service | PATCH and DELETE asset routes return 404 — routes not registered in router | Feature stub | High |
| G-CAP-04 | grant-service | CPGRAMS stub adapter exists; no contract test confirming outbound payload shape to national grievance portal | Integration stub | High |
| G-CAP-05 | payroll-service | ECR content test absent; pipe-delimited file output never asserted at column level | Test gap | High |
| G-CAP-06 | workflow-service | `provisioning-catalog` POST returns non-201 — catalog seeding broken | Feature partial | Medium |
| G-CAP-07 | notification-service | Email channel crash at startup (`smtp-sender.js` missing); SMS/push/in-app unverified for production delivery | Feature missing | Critical |
| G-CAP-08 | billing-service | GST e-invoice integration exists; no contract test against NIC sandbox API | Integration stub | Medium |
| G-CAP-09 | telephony-service | AI transcription adapter wired; no end-to-end content test | Integration partial | Low |
| G-CAP-10 | legal-service | eCourts integration adapter exists; no live contract test; `downloadUrl` SSRF not guarded | Integration partial | High |

---

## G2 — Cross-Service Integration Gaps

| Gap ID | Producer | Consumer | Missing Event | Business Impact | Severity |
|--------|---------|---------|---------------|-----------------|----------|
| G-INT-01 | finance | analytics | `finance.payment.released` (never emitted; only `finance.payment.made` exists) | Analytics payment KPI always zero | High |
| G-INT-02 | grant | analytics | `grants.release.processed` (namespace + entity mismatch) | Grant disbursement KPI always zero | High |
| G-INT-03 | payroll | finance | `payroll.run.finalized` (never emitted; only `payroll.run.disbursed`) | Salary GL journal never posts; finance ledger missing payroll costs | Critical |
| G-INT-04 | hrms | meeting | `hrms.employee.updated` (never emitted) | Committee membership cache stale after employee profile changes | Medium |
| G-INT-05 | hrms | payroll | `hrms.claim.approved` (never emitted) | LTC claim payouts never triggered in payroll | Medium |
| G-INT-06 | citizen | notification | `citizen.request.created` (never emitted) | Citizen request creation notifications silently dropped | Medium |
| G-INT-07 | billing | finance | `billing.invoice.paid` → finance GL consumer missing | Revenue not booked; accounts receivable settlement broken | High |
| G-INT-08 | asset | finance | `asset.asset.created` → finance GL consumer missing | Asset capitalisation journal never posted | High |
| G-INT-09 | identity | policy + notification | `identity.user.created` consumer missing in both services | No default role binding on new user; no welcome notification | Medium |
| G-INT-10 | inventory | procurement | `inventory.stock.low` consumer missing | Low-stock signal never triggers indent/reorder | High |
| G-INT-11 | contract | procurement + legal | `contract.contract.signed` consumer missing | Contract activation invisible to downstream services | Medium |
| G-INT-12 | court | legal + notification | `court.order.issued`, `court.notice.issued` → legal and notification consumers absent | Court orders invisible to legal-service; parties not notified | High |
| G-INT-13 | admin | audit | `admin.breakglass.opened/closed` not forwarded to audit sink | Break-glass access not in compliance audit trail (CERT-In gap) | High |
| G-INT-14 | identity | audit | RBAC mutations (`identity.rbac.role.assigned`) have no audit consumer registration | Access-control changes not audited (CERT-In, DPDP §5) | High |
| G-INT-15 | policy | audit | `policy.binding.created/revoked` not forwarded to audit sink | Policy changes not audited | High |
| G-INT-16 | court | — | `CONSUMED_EVENTS = {}` — court receives zero inbound events from any service | Court cannot react to external decisions (e.g. legal opinions, file approvals) | Medium |

---

## G3 — Test Coverage Gaps

### G3.1 — Missing Negative-Scenario Tests

| Gap ID | Cluster | Missing Test | Risk if Absent |
|--------|---------|-------------|----------------|
| G-TEST-01 | Finance | Closed fiscal period rejects GL posting with `PERIOD_CLOSED` | Backdated entries corrupt financial statements |
| G-TEST-02 | Finance | Concurrent sanction drain (optimistic-lock integration) | Two bills can over-draw the same sanction |
| G-TEST-03 | Finance | Reversal of posted journal entry (full integration, not domain-only) | Reversal path not integration-proven |
| G-TEST-04 | Finance | Cross-year reappropriation rejection | Savings from FY N cannot fund FY N+1 |
| G-TEST-05 | Finance | Advance recovery exceeding outstanding throws domain error | Over-recovery silently allowed |
| G-TEST-06 | Payroll | Closed-period guard (re-run finalized month rejected) | Duplicate payroll run for closed months |
| G-TEST-07 | Payroll | Duplicate-run prevention (two simultaneous `createPayrollRun` for same period) | Race condition creates two runs |
| G-TEST-08 | Payroll | Advance deduction exceeding net pay (negative net guard under load) | Negative net pay possible |
| G-TEST-09 | Payroll | Arrear payment across months (revised DA, GL posting) | Arrear accounting untested |
| G-TEST-10 | HRMS | Pay-revision effective-date (future grade change doesn't affect current payroll) | Pay leakage possible |
| G-TEST-11 | HRMS | Half-day leave application (AM/PM, 0.5-day balance deduction) | Half-day logic untested |
| G-TEST-12 | HRMS | Leave encashment on retirement end-to-end | Double-count or missed encashment |
| G-TEST-13 | Procurement | PO amendment lifecycle (change-order with version bump) | Amended PO amounts not reflected in GRN/finance |
| G-TEST-14 | Procurement | Tender cancellation and re-tender | No-valid-bids path untested |
| G-TEST-15 | Inventory | Negative stock prevention (`INSUFFICIENT_STOCK` domain error) | Inventory can go negative |
| G-TEST-16 | Inventory | Min-max/reorder-point trigger fires procurement event | Low-stock → procurement pipeline untested |
| G-TEST-17 | Asset | Depreciation schedule accumulation (SLM end-to-end with rounding) | Statutory depreciation untested in integration |
| G-TEST-18 | Asset | Asset disposal/write-off lifecycle (retire→GL write-off) | Disposal accounting untested |
| G-TEST-19 | Workflow | Definition v2 upgrade leaves in-flight v1 instances intact | Upgrade breaks live approvals |
| G-TEST-20 | Workflow | Return/rework/resubmit cycle (full integration) | Rework path not integration-proven |
| G-TEST-21 | Citizen | RTI Act 2005 deadline enforcement (30-day auto-flag) | Statutory non-compliance undetected |
| G-TEST-22 | Citizen | Grievance re-open after closure | Re-open flow untested |
| G-TEST-23 | Helpdesk | SLA clock pause/resume (waiting-for-customer status) | SLA breach incorrectly measured |
| G-TEST-24 | Court | Evidence tampering detection (SHA-256 mismatch rejection) | Tampered evidence accepted |
| G-TEST-25 | Court | Inter-court case transfer | Common High Court power untested |
| G-TEST-26 | Meeting | Circular resolution without calling a meeting | Statutory mechanism untested |
| G-TEST-27 | Meeting | Director conflict-of-interest abstention exclusion from quorum | Biased vote could pass |

### G3.2 — Missing Cross-Tenant Isolation Tests (for >23 services)

| Gap ID | Service | Gap |
|--------|---------|-----|
| G-XTEN-01 | hrms-service | 153 FORCE RLS tables; cross-tenant isolation test exists but limited |
| G-XTEN-02 | payroll-service | 74 FORCE RLS tables; no systematic cross-tenant probe with real role |
| G-XTEN-03 | procurement-service | 52 FORCE RLS tables; partial isolation only |
| G-XTEN-04 | finance-service | 113 FORCE RLS tables; verified for fixed services but route-writes gap |
| G-XTEN-05 | 23 services (Wave 2) | Bare `db.select()` reads still return empty under real NOBYPASSRLS role (fail-closed but not proven isolated) |

### G3.3 — Missing Audit Assertion Tests

| Gap ID | Services | Gap |
|--------|---------|-----|
| G-AUD-01 | 36/38 services | Audit event shape (`oldValue`/`newValue` fields) never verified in tests |
| G-AUD-02 | 36/38 services | Actor role field not captured or tested in audit payload |
| G-AUD-03 | 36/38 services | Cache invalidation never asserted in tests (35 services call `cache.invalidate()` with no test assertion) |
| G-AUD-04 | 36/38 services | Outbox relay end-to-end (only court + meeting verify outbox relay publishes) |

---

## G4 — Architecture and Compliance Gaps

| Gap ID | Area | Description | Severity |
|--------|------|-------------|----------|
| G-ARCH-01 | Scalability | TenantRouter (`packages/db/src/tenant-router.ts`) is implemented but unwired in all 38 services; pool→silo migration path blocked | High |
| G-ARCH-02 | Scalability | No horizontal worker scaling configured (replicaCount=1); payroll day noisy-tenant problem production-blocking | High |
| G-ARCH-03 | Scalability | Redis single instance; no Sentinel config wired in production compose or Helm despite CLAUDE.md requirement | High |
| G-ARCH-04 | Resilience | No pg_dump automation, no PITR, no streaming replica; Terraform RDS module commented out | Critical |
| G-ARCH-05 | Resilience | No saga/compensation pattern; DLQ events require manual recovery | Medium |
| G-ARCH-06 | Scalability | `hrms_attendance` table not partitioned; will require hours-long lock for DELETE at Year 2+ | High |
| G-ARCH-07 | Scalability | `gl.finance_ledger` not partitioned; 2.9 TB unpartitioned table projected by Year 5 | Medium |
| G-ARCH-08 | Observability | Module-guard and quota-check plugins dormant (not wired in any service's app.ts) | Medium |
| G-ARCH-09 | Integration | Schema registry (`packages/events/schema-registry.ts`) tested and implemented but wired in zero production publish/subscribe sites | Medium |
| G-ARCH-10 | Compliance | DPDP §4 PII purge: implemented in visitor and grant; not systematically implemented in HRMS (employee photos, biometrics) or payroll (PAN, bank) | High |
| G-ARCH-11 | Security | ABAC policy enforcement defaulting to "off" in gateway; fine-grained policy checks skipped in all default deployments | High |
| G-ARCH-12 | Compliance | No data retention policy or archival cron for audit events beyond 180-day DB retention (no cold storage export) | High |
| G-ARCH-13 | Compliance | No documented RTO/RPO targets in any infra file | High |

---

## G5 — Domain Duplication / Data Consistency Gaps

| Gap ID | Services | Description | Risk |
|--------|---------|-------------|------|
| G-DUP-01 | stock + inventory | Two diverging warehouse masters (`stock_warehouses` + `warehouses`); no sync event between them | Warehouse data inconsistency under concurrent writes |
| G-DUP-02 | stock + inventory | Parallel stock ledgers (`stock.stock_ledger` + `inventory.stock_ledger`); no reconciliation event | Stock accounting split across two services |
| G-DUP-03 | estab + legal + court | Three court case tables with no cross-service sync; government appearances in estab/legal flows invisible to court registry | Case tracking fragmented |
| G-DUP-04 | citizen + estab + hrms | RTI triple-tracking; hrms RTI entirely unwired to citizen/estab pipeline | RTI status invisible across services |
| G-DUP-05 | admin + tenant | Tenant master duplication; admin emits `admin.tenant.created` not consumed by anyone | Admin tenant events orphaned |
| G-DUP-06 | finance + audit | Finance maintains shadow `finance_audit_paras` alongside canonical `audit_paras`; divergence risk | Para tracking fragmented |

---

## Gap Summary by Category

| Category | Total Gaps | Critical | High | Medium | Low |
|----------|-----------|---------|------|--------|-----|
| Missing service capability | 10 | 2 | 4 | 3 | 1 |
| Cross-service integration | 16 | 1 | 8 | 6 | 1 |
| Test coverage | 27 | 0 | 15 | 10 | 2 |
| Architecture/compliance | 13 | 2 | 8 | 3 | 0 |
| Domain duplication | 6 | 0 | 3 | 3 | 0 |
| **Total** | **72** | **5** | **38** | **25** | **4** |
