# 00 — Final Verdict (§31)
# CivitasOne Suite — Principal Test Architect Synthesis

**Date:** 2026-07-12  
**Branch assessed:** `court-management-service`  
**Lanes completed:** 13 of 13 (02–14 all delivered; no missing lanes)  
**Assessed by:** Principal Test Architect (ERP Testing Board synthesis)  
**Test corpus:** 10,671 automated tests across 38 services (10,176 pass / ~299 fail / ~196 skip)

---

## §31 Classification

> **DEV ONLY — NOT PRODUCTION READY**

This system is not eligible for a controlled pilot with real government data in its current state.  
It is not eligible for any multi-tenant production deployment.

The classification is driven by two structural disqualifiers that are independently fatal:

1. **P0 Security: Full cross-tenant bypass** — `gateway-service/src/jwt-edge.ts:63` forwards attacker-supplied `x-tenant-id` header unchanged; combined with `packages/db/src/tenant-tx.ts:57` sourcing the PostgreSQL RLS GUC from the same header on 25/38 services, any authenticated user can read or write any other tenant's complete dataset. This single vulnerability negates the DB isolation architecture for the entire fleet.

2. **No backup / PITR** — No `pg_dump` automation, no streaming replica, no WAL archival, Terraform RDS module commented out. A single disk failure or accidental DROP TABLE causes total data loss with no recovery path. Unacceptable for a government ERP holding tax, payroll, and citizen records.

Until both disqualifiers are removed (estimated 14 days of focused engineering), the correct environment for this system is a **developer workstation with synthetic data only**.

---

## §31 — Direct Answers to the 18 Assessment Questions

---

### Q1 — Overall production readiness: what is the verdict and why?

**Verdict: Not production ready. Score: 4/10.**

The domain logic substrate is genuinely strong — finance double-entry is proven, payroll arithmetic matches a statutory oracle on 90/90 comparisons, court-service is exemplary, workflow engine passes 537/539 tests. The architecture (DB-per-service, CQRS, transactional outbox, FORCE RLS) is sound and directionally excellent.

However, three P0 security vulnerabilities, no backup infrastructure, broken critical services (grant, identity, estab), and a missing cross-service payroll→finance GL journal together represent a system that cannot safely hold real government data at this time.

The gap between "strong domain logic" and "production ready" is bridgeable in 30–90 days of focused remediation.

---

### Q2 — Is tenant isolation proven end-to-end?

**Partially proven — materially improved this cycle, not yet uniform.**

**What IS proven (executed evidence, real NOBYPASSRLS role):**
- DB isolation is fail-closed: FORCE RLS + NOBYPASSRLS on every per-service DB login; no cross-tenant data leak found in any probe.
- Wave 1 central write-fix: all ~30 services' consumer writes now establish tenant context via `withTenantConsumer→runWithTenant`. Live-proven: bare write (no GUC) = RLS rejected → write with tenant GUC = success.
- 12 services have JWT-source read-path fix proven: tenant A GUC = 1 row → tenant B GUC = 0 rows (isolation holds for finance, billing, notification, workflow, hrms, identity, payroll, court, visitor, meeting, analytics).

**What is NOT proven:**
- **SEC-P0-01 + SEC-P0-02 together** = any authenticated user can forge `x-tenant-id: <victim-uuid>` in the request header. The gateway conditionally forwards it; 25 of 38 services use this header to set the PostgreSQL RLS GUC. Combined attack vector: full DB-layer cross-tenant read/write for any legitimate session token. This is unambiguously the highest-priority fix in the entire codebase.
- ~23 services still need Wave 2 read + JWT-hook fix. Their reads return empty (fail-closed, not a leak), but cross-tenant probes are not yet positively proven for those services.
- `workflow_svc` DB role has `BYPASSRLS` (infra misconfig). Code fix correct but DB role not yet set to `NOBYPASSRLS`.
- Route-level bare `db.execute()` writes (finance: 3, hrms: 61, identity: 16) bypass the GUC-setting wrapper.

---

### Q3 — Do payroll, finance, and inventory reconcile?

**Finance: YES with caveats. Payroll: MOSTLY (ECR exception). Inventory: YES with missing migrations.**

**Finance (8/10):** All 14 financial invariants are testable; 12/14 executed green. Double-entry (bigint, balanced per journal), GL immutability (REVOKE UPDATE/DELETE + status-transition trigger), period close controls (hard/soft), reversal as contra-creation, journal idempotency (outbox + PK), HoA 18-digit structure, GFR Rules 10+11, maker-checker, subledger recon, balance sheet equation — all proven. Caveats: instruments/repo.ts bypasses `db.transaction()` blocking all cheque/DD lifecycle; salary GL journal never posts (BL-03 broken topic); 50 bigint-test rows distort all GL aggregates in the dev DB.

**Payroll (7/10):** Independent oracle confirmed 90/90 field matches across 8 statutory cases. Bank transfer (67 tests), Form 16 PDF, deduction registers (PF/ESI/TDS/GPF/NPS), protected-net floor, LOP — all correct. **Exception:** ECR wage column uses `basicMinor` only — EPFO pensionable wage must be `min(basic+DA, 15,000)`. For a government employee on basic ₹12,000 + DA ₹5,000, ECR reports ₹12,000 vs the ₹15,000 correct figure, causing EPFO challan rejection for every 7th CPC employee. This is a one-line fix. **Exception:** LOP consumer queue-path broken (mock-path passes; real queue path fails).

**Inventory (6/10):** Invariant `Σqty_in − Σqty_out == closing_balance` proven in both pure-replay and real-DB consumer forms. WAVG (bigint floor), FIFO (8 property tests via fast-check), 3-way match — correct. **Caveat:** 3 tables not migrated (`cycle_counts`, `cost_layers`, `warehouses`) — those routes return HTTP 500. Stock CQRS entry consumer write path blocked by RLS.

---

### Q4 — Are procurement financial controls GFR-compliant?

**Structurally yes; integration layer incomplete.**

**Working:** GFR two-bid tender lifecycle (tech-eval → sealed financial bid → open → L1 award), sealed bid integrity, blacklisted bidder exclusion from L1, SOD enforcement (award approver ≠ creator ≠ evaluator), finance commitment gate (PO only if funds available), GFR financial bands (comparative statement), award idempotency, GeM adapter, central debarment check, vendor PII encryption, three-way match domain (PO/GRN/invoice variance with tolerance). All verified with executed tests.

**Not working / gaps:** GRN consumer write path blocked by RLS (3-way match cannot post GL entries in integration); PO amendment lifecycle untested (change-orders); tender cancellation / no-valid-bids path untested; GRN partial receipt untested; `inventory.stock.low` → procurement indent not wired (auto-reorder missing). Score: 6/10.

---

### Q5 — Is the audit trail complete for statutory/regulatory compliance (CERT-In / DPDP)?

**Chain is structurally sound and tamper-evident; content is incomplete for financial mutations.**

**Working:** SHA-256 hash chain with per-tenant advisory lock (tamper-evident, confirmed end-to-end for 5-hop finance GL chain and identity session revoke). 180-day CERT-In retention. Idempotent consumer (`markProcessed` → ON CONFLICT DO NOTHING). 262+ audit emission sites across all services. Monthly partition with auto-create 3 months ahead (prevents table bloat).

**Critical gaps:**
- Finance GL, budget, treasury, payroll consumers do NOT emit `oldValue`/`newValue` — field-level diffs missing for every financial mutation. A regulator cannot determine what changed.
- Actor roles not captured in audit payload.
- Break-glass events (`admin.breakglass.opened/closed`), RBAC mutations (`identity.rbac.role.assigned`), and policy binding changes not forwarded to the audit sink (CERT-In §4 and DPDP §5 compliance gap).
- Plugin hook executions not audited.

Score: 7/10.

---

### Q6 — Is the security posture acceptable for a multi-tenant government deployment?

**No. Three P0 vulnerabilities are independently disqualifying. Score: 3/10.**

**P0-01 (gateway header bypass):** Conditional `if (!req.headers["x-tenant-id"])` at `gateway-service/src/jwt-edge.ts:63` means any authenticated user can access any other tenant's complete dataset. Repro confirmed.

**P0-02 (RLS GUC from header):** `packages/db/src/tenant-tx.ts:57` sources `app.tenant_id` PostgreSQL GUC from the raw `x-tenant-id` header in 25 of 38 services. Combined with P0-01, DB-layer isolation is neutralised fleet-wide.

**P0-03 (plugin RCE):** `plugin-service/src/modules/runtime/engine.ts:132` uses `new Function(handler)` where `handler` is user-supplied JavaScript. Full server-side RCE for any authenticated user when `PLUGIN_RUNTIME_ENABLED=true`. The correct `sandbox/runtime.ts` (worker_threads) implementation exists but is not connected to the hook execution path.

**P1 findings (11):** Payslip IDOR (employee reads any co-worker's salary including PAN/bank IFSC); PAN + bank account stored in plaintext (raw SQL bypasses AES-GCM `encryptedText` transform); SSRF via Twilio `RecordingUrl` and eCourts `downloadUrl`; hardcoded BYPASSRLS credentials in git; ABAC enforcement defaulting to "off"; SCIM tenant resolved from raw header.

**Positives:** JWT RS256 algorithm enforcement, no `ignoreExpiration`, rate limiting on auth endpoints (Redis-backed 10 req/min), mass assignment blocked by explicit Zod schemas everywhere, SQL injection impossible (Drizzle parameterised), internal service headers stripped at gateway.

---

### Q7 — Is the identity and access management layer secure?

**No — identity-service itself has production-blocking defects.**

Beyond the gateway-level P0s, the identity-service has a 24% test failure rate: tombstone/delete operations broken (`expected tombstone?.operation to be "delete"` fails); cross-tenant RLS isolation tests fail. This service is the platform's security perimeter and cannot be in a broken state at go-live.

Additionally: SCIM tenant resolved from raw `x-tenant-id` header (SEC-P1-05); no JWT blacklist on session revocation (stolen token valid until `exp`); ABAC policy enforcement defaults to "off" at gateway (SEC-P2-01).

The JWT algorithm enforcement itself (RS256 explicit allowlist, HS256 blocked, `alg:none` rejected) is solid. RBAC `requireRole()` discipline is generally sound across the fleet.

---

### Q8 — Can the system sustain 1,000 TPS as required?

**Not currently. Architectural capacity exists; it is not wired.**

**Confirmed bottlenecks (code inspection, no live load test):**

*Payroll (most severe):* Single worker processes ~1–2 slips/second (4 DB queries + 1 HTTP call per employee sequentially). A 500,000-employee payroll run on a single worker takes ~14 hours. A simultaneous payroll day across 125 tenants generates ~5.6M slip commands. With one worker at 2 slips/second, this would take 32 days to clear. **This is production-blocking at government scale.**

*Outbox relay:* 100-row batch / 500ms interval = max ~200 events/second relay rate per service. At 1,000 TPS sustained, event delivery lag is ~2.5 seconds (acceptable). At payroll burst (10,000 commands / 10 seconds), outbox accumulates 10,000 rows and takes ~50 seconds to drain — downstream consumers (notification, analytics) see 50-second lag.

*Redis:* Single instance (no Sentinel wired despite CLAUDE.md requirement). Cache SPOF.

**What scales:** SQS is not a bottleneck. DB-per-service means no cross-tenant locking. PgBouncer transaction-mode correctly configured. 1,453 indexes including tenant-leading composites on critical tables.

**Path to 1,000 TPS:** Horizontal payroll workers (Helm HPA on SQS queue depth) + SQS FIFO per-run message group + hoist DA rate / PT slabs out of per-employee loop (N+1 fix) + Redis Sentinel. Estimated effort: 1 sprint.

---

### Q9 — Are HR/payroll statutory requirements (PF, TDS, ESI, ECR, Form 16) correct?

**Computation: YES. ECR output format: DEFECTIVE (one-line fix).**

Statutory correctness of computation is confirmed by independent oracle (90/90 field matches):
- 7th CPC DA formula, HRA (X/Y/Z city classification), PF ceiling at ₹15,000 basic
- EPF: 12% employee; EPS: 8.33% of pensionable wage; EDLI: 0.5%
- TDS: new-regime FY2025-26 slabs with Section 87A rebate cap
- ESI: 0.75% employee + 3.25% employer; gross ceiling ₹21,000
- GPF: 10% of basic+DA (GPF-scheme only)
- NPS: 10% employee + 14% employer (NPS-scheme)
- YTD TDS isolation (filters only `approved`/`disbursed` runs)
- Protected-net floor, negative-net guard, court attachment

**ECR defect (DEF-01, P0):** `ecr-routes.ts:53-55` uses `slip.basicMinor` for all three wage columns. Correct formula: `min(basicMinor + daMinor, 1500000)`. For a standard 7th CPC employee (basic ₹12,000, DA ₹5,000): ECR shows ₹12,000 but EPFO expects ₹15,000 → challan reconciliation mismatch → ECR filing rejection. Fix: 1 line of code.

---

### Q10 — Is eOffice/document management (estab-service) functional?

**No. 20% failure rate (68/339 tests). Score: 3/10.**

DSP sequence numbering returns `undefined` (expected `'DSP/2026/000001'`). NAI archival status not set. eOffice approval callbacks not wiring — consumers write nothing in 19 of 26 test files. File archival and correspondence lifecycle broken.

**Impact:** Every approval-routed transaction (procurement sanction, HR promotion/transfer, grant disbursement) that requires an eOffice file is blocked. This is not an edge case — it is the main approval workflow for government operations.

The eOffice SDK (`packages/eoffice-sdk/src/contracts.ts`) and 15 ref_type callbacks are architecturally complete and fail-closed. The defect is specifically in the estab-service consumer not persisting state under FORCE RLS.

---

### Q11 — Are grant disbursement flows functional?

**No. 63% failure rate (29/46 tests). Score: 2/10 in isolation.**

All 4 approval-gated disbursement paths fail (`expected [] to have a length of 1 but got 0`). Cross-tenant budget reservation broken. SOD violation test fails. The grant consumer does not write any rows under FORCE RLS.

**Business impact:** Government funds cannot be released to beneficiaries. This is a P0 defect for any government deployment. The grant scheme schema, approval state machine, and disbursement domain logic are all correctly designed — the consumer write path simply does not establish tenant context before inserting.

---

### Q12 — Is backup, PITR, and disaster recovery in place?

**No. Score: 3/10. This is a hard blocker for any production deployment.**

- No `pg_dump` automation anywhere in the repo (infra/aws, infra/onprem, scripts/).
- No PostgreSQL PITR configuration (`wal_level`, `archive_mode` not set anywhere).
- No streaming replica in `docker-compose.prod.yml` or Helm values.
- Terraform RDS module explicitly commented out (`# module "rds" {...}` in `infra/aws/main.tf`).
- No documented RTO/RPO targets.

**Consequence:** A single disk failure, accidental `DROP TABLE`, or ransomware event causes total, unrecoverable data loss for all 38 service databases. For a government ERP holding payroll, tax, and citizen records, this is unacceptable.

**Minimum requirement before any go-live:** `wal_level=replica`, `archive_mode=on`, WAL archival to S3 (or Barman on-prem), `pg_basebackup` nightly, at least one hot-standby replica. Estimated effort: 2–3 infra engineering days.

---

### Q13 — Are cross-service integration flows (events, topic linkages) complete?

**No. Score: 4/10. ~35% of intended signal coverage is wired.**

**6 broken topic linkages (confirmed by grep, not inference):**
- BL-03: finance GL consumer subscribes to `payroll.run.finalized`; payroll only emits `payroll.run.disbursed` → salary journal never posts (CRITICAL)
- BL-01/02: analytics INBOUND keys mismatch finance and grant emission topic names → payment and grant KPIs always zero
- BL-04/05/06: three missing hrms/citizen emissions

**~124 orphaned event topics** — produced but with no registered consumer anywhere in the mesh. The integration bus is fully wired for roughly 35% of its intended signal coverage.

**9 missing critical consumers:** billing.invoice.paid → finance GL (revenue not booked); asset.asset.created → finance GL (capitalisation never posted); inventory.stock.low → procurement (auto-reorder missing); court.order.issued → legal + notification (court orders invisible); access-control mutations (RBAC, policy, break-glass) → audit sink (CERT-In gap).

**6 domain duplication clusters:** warehouse master (stock + inventory diverging), stock ledger (parallel accounting), court case triple-tracking (estab + legal + court with no sync), RTI triple-tracking, tenant master duplication, finance audit para shadow.

---

### Q14 — Is the test automation suite sufficient for production sign-off?

**No, but the foundations are strong. Score: 6/10.**

**Strengths:** 10,671 tests with 95.4% pass rate; three T1 gold-standard services (meeting: 1,147 tests, court: 322 tests, visitor: 317 tests) with property-based testing, cross-tenant isolation probes, SOD, consumer idempotency; no always-pass tests; no `test.only()` in committed code; correct harness (`QUEUE_DRIVER=memory`).

**Gaps blocking production sign-off:**
- 23/38 services mock the DB — type-level defects (BigInt overflow, GUC misconfigs) only surface in production.
- Cross-tenant isolation explicitly tested in only 9/38 services — precisely where the largest FORCE RLS tables live (hrms 153 tables, payroll 74, procurement 52).
- Audit event shape verified in only 2/38 services.
- 7 court-service E2E suites permanently skipped (`describe.skip`) — live write-path never tested in CI.
- AuthZ (403 for wrong role) tested in only 7/38 services.
- ECR content test absent; payroll duplicate-run guard absent; finance closed-period integration absent.

**65 high-value tests identified in the automation backlog** (7 P0 blockers + 13 Tier 2 + 25 Tier 3 + 20 Tier 4).

---

### Q15 — Are DPDP Act PII controls (Aadhaar, PAN, biometrics) in place?

**Partially — present in some services, absent in others. Inconsistent.**

**Working:**
- `court-service`: party PII (name, DOB, contact) encrypted AES-256-GCM (`encryptedText` Drizzle type) per DPDP §4.
- `visitor-service`: face recognition data, pass data encrypted; DPDP §4 purge implemented (`DELETE` on visitor profile purge).
- `grant-service`: beneficiary Aadhaar masked per DPDP §4 in display routes.

**Gaps:**
- **SEC-P1-06:** Pensioner PAN + bank account stored in PLAINTEXT because `payroll/routes.ts:156` uses raw `sql\`` template bypassing the `encryptedText` Drizzle column transform. Direct DPDP violation.
- **SEC-P2-04:** APBS payroll download file embeds full 12-digit Aadhaar numbers without masking or DLP controls. UIDAI regulations require masking in any non-UIDAI-bound file.
- HRMS employee photos, attendance biometric hashes: no explicit DPDP §4 purge implementation found.
- No systematic DPDP purge across HRMS, payroll, or procurement services.

---

### Q16 — Is the court/legal module production-ready?

**Court-service: Near-ready with E2E gap. Legal-service: Near-complete.**

**Court-service (COMPLETE, score 7/10):** Case lifecycle (filed→registered→hearing→decided→disposed), hearing state machine, appeal state machine (8 tests), evidence SHA-256 chain, scrutiny domain, cause-list materialisation (deterministic ID), order issuance (maker-checker), compliance directions, court registry, eCourts adapter, DPDP PII at rest (AES-256-GCM), public case-status lookup (OTP/captcha-gated), certified copies — all tested. 285/322 tests pass; 37 E2E tests permanently skipped (require live Postgres + Redis). The E2E skip is the primary gap.

**Critical integration gap:** `court-service` has `CONSUMED_EVENTS = {}` — court produces 36 domain events and subscribes to zero. `court.order.issued` and `court.notice.issued` are invisible to legal-service and notification-service. Parties are not notified of orders.

**Legal-service (NEAR-COMPLETE):** 248/267 tests pass (1 fail, 18 skip). eCourts adapter, limitation clock (property test), cases, hearings, opinions, settlements. One route returns 404 (reminder creation).

---

### Q17 — Is the workflow engine production-ready?

**Near-ready. Score: 8/10.**

The workflow engine is the second-highest scoring domain service. Sequential/XOR/AND/parallel flows, call-activity with ancestor-cycle detection, max call-depth enforcement, DLQ retry (5 attempts → dead-letter), three assignment strategies (round-robin, least-loaded, hierarchy), SLA escalation sweeper with pre-breach reminders and cooldown, deemed-approval timer, delegations, BPMN-DMN property tests (17 fast-check tests), simulation, condition evaluation, graph validation — all verified with real DB (no mocks).

**Two production bugs found:** `r13-unknown-definition` DB constraint violation (status enum mismatch in migration — workflow instance rejects an unknown definition code with a DB error rather than a clean domain error); `provisioning-catalog` POST returns non-201.

**Key gaps:** Definition versioning during live instances untested (upgrade to v2 could break in-flight v1 instances — a deploy-day risk); return/rework/resubmit cycle not integration-tested at the full round-trip level; conditional escalation to different role based on threshold untested.

---

### Q18 — What single action would most improve the overall score?

**Fix SEC-P0-01: change `if (!req.headers["x-tenant-id"])` to always overwrite at `gateway-service/src/jwt-edge.ts:63`.**

One conditional → unconditional: removes the highest-severity risk in the entire system (full cross-tenant data access for any authenticated user), eliminates the combined blast radius of P0-01 + P0-02, and lifts the security score from 3/10 to approximately 5/10. Then add backup/PITR (2–3 infra days). Together these two changes shift the classification from "Dev only" to "Controlled pilot eligible."

Estimated time: 1 line of code + test = 2 hours. Combined with P0-02 and P0-03: 3 engineering days.

---

## Summary Matrix

| Question | Answer | Blocker? |
|----------|--------|----------|
| Q1: Overall production ready? | **No — Dev only** | Yes |
| Q2: Tenant isolation proven? | Partially (12/38 proven; gateway P0 bypasses all) | Yes (P0) |
| Q3: Finance/payroll/inventory reconcile? | Finance yes (caveats); Payroll yes (ECR defect); Inventory yes (missing migrations) | Partial |
| Q4: Procurement GFR controls? | Domain yes; integration incomplete | Partial |
| Q5: Audit trail complete? | Chain sound; field-level diffs absent for financial mutations | Partial |
| Q6: Security acceptable? | **No — 3 P0s, 11 P1s** | Yes (P0) |
| Q7: IAM layer secure? | No — identity-service 24% fail rate; gateway P0 | Yes (P0) |
| Q8: 1,000 TPS achievable? | Architecture yes; wiring no; payroll day is production-blocking | Partial |
| Q9: Statutory payroll correct? | Computation yes; ECR wage column defective (EPFO filing rejection) | Partial |
| Q10: eOffice functional? | **No — 20% failure; DSP/NAI/approval all broken** | Yes |
| Q11: Grant disbursement functional? | **No — 63% failure; all disbursement paths fail** | Yes |
| Q12: Backup/PITR in place? | **No — zero backup automation** | Yes |
| Q13: Integration flows complete? | No — 6 broken topics, ~124 orphaned events, ~35% coverage | Partial |
| Q14: Test automation sufficient? | No — 23 services DB-mocked; E2E permanently skipped; cross-tenant gaps | Partial |
| Q15: DPDP PII controls? | Partial — court/visitor/grant covered; payroll PAN in plaintext | Partial |
| Q16: Court/legal production-ready? | Near-ready (E2E skipped; court receives no inbound events) | Minor |
| Q17: Workflow engine production-ready? | Near-ready (8/10; 2 bugs; versioning gap) | Minor |
| Q18: Highest-value single fix? | Fix `gateway-service/src/jwt-edge.ts:63` (1 line) | — |

---

## Classification Ladder Position

| Classification | Criteria | Met? |
|---|---|---|
| Not testable | No tests exist | No — 10,671 tests exist |
| **Not production ready** | P0 security, no backup, critical service failures | **← CURRENT STATE** |
| Dev only | Safe for developer use with synthetic data | ← Also accurate |
| Controlled pilot | P0s fixed; backup/PITR; grant/identity/estab unblocked | After ~21 days |
| Production ready with critical conditions | All P1s fixed; Wave 2 tenant isolation; integration gaps | After ~90 days |
| Production ready for limited tenants | All P2s; T2 automation; audit field-level diffs | After ~120 days |
| Enterprise production ready | Scale infra wired; all duplication resolved; 180-day plan complete | After ~180 days |
| World-class | Full VAPT clean; E2E in CI; all event bus wired; PITR proven; cell deployed | 12–18 months |

---

LANE_DONE L10 score=4
