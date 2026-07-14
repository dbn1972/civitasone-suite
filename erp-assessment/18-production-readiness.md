# 18 — Production Readiness Scorecard (§30)

**Synthesised from:** All 13 lane deliverables (02–14)  
**Date:** 2026-07-12  
**Branch:** `court-management-service`  
**Method:** Evidence-grounded scoring; no 10/10 without complete positive evidence

All scores are /10. Deductions are itemised. Where a lane is missing or a dimension was not fully assessed, this is stated explicitly.

---

## §30.1 — Functional Completeness

**Score: 7 / 10**

| Status | Count | Services |
|--------|-------|---------|
| COMPLETE | 10 | court, meeting, visitor, knowledge, ml, plugin, install, gateway, queue, theme |
| NEAR-COMPLETE | 7 | analytics, inventory, legal, location, project, stock, workflow |
| PARTIAL | 17 | admin, asset, audit, billing, citizen, contract, crm, finance, helpdesk, hrms, notification, payroll, policy, procurement, report, telephony, tenant |
| HIGH-RISK | 3 | estab (20% fail), grant (63% fail), identity (24% fail) |
| STUB | 1 | metadata (zero API surface) |

**Tests executed:** 10,671 total; 10,176 pass (95.4%), ~299 fail (2.8%), ~196 skip (1.8%)  
**Deductions:** −1 for 3 HIGH-RISK services critical to government operations (grant, identity, estab); −1 for metadata complete stub and notification email crash; −1 for 17 PARTIAL services with known production-blocking defects  
**Evidence lane:** 03-module-inventory, 05b-existing-test-assessment

---

## §30.2 — Business-Rule Correctness

**Score: 7 / 10**

**Tests passed:** All pure-domain engines verified:
- Finance: 12/14 invariants green (bigint arithmetic, double-entry, period close, reversal, immutability, HoA/GFR rules)
- Payroll: 90/90 oracle field comparisons across 8 statutory cases; PF ceiling, TDS slabs, LOP, protected-net floor all correct
- HRMS: leave rules, disciplinary state machine, pension CCS rules, APAR grading, reservation engine — all domain tests pass
- Workflow: XOR/AND, call-activity, DLQ, assignment strategies, SLA escalation, BPMN-DMN — all pass
- Court: case lifecycle, hearing, appeal, evidence SHA-256, cause-list — all 285 tests pass
- Meeting: quorum, voting (STV/weighted), statutory frequency, tenure expiry — 1,147/1,147 pass

**Deductions:** −1 for systematic under-testing of closed-period enforcement, amendment/reversal lifecycles, and concurrent-update safety at integration level; −1 for citizen service real functional bugs (idempotency gate not firing, CSV-injection neutralization broken) and asset PATCH/DELETE returning 404 (routes not registered); −1 for integration-layer consumer failures in 7/9 clusters (RLS write-path gap)  
**Evidence lane:** 06-functional-test-catalogue

---

## §30.3 — HRMS

**Score: 6 / 10**

**Tests passed:** 823/904 (22 failed, 59 skipped)  
**Working:** Employee lifecycle, leave rules (10 types, all eligibility, sandwich rule, EL accumulation), disciplinary state machine, APAR grading, reservation engine, pension CCS Rules, FnF, CQRS consumers, NACH/APBS, service book  
**Broken:** Geo-attendance E2E (7/9 fail — `expected 500 to be 200`); Disciplinary Rule 14 major-penalty imposition gate (3/3 fail); leave balance concurrency under network partition (domain-only, not integration); LOP consumer queue-path broken  
**Skipped:** 59 tests (geo-attendance E2E, HR ecosystem E2E — require live DB)  
**Gaps:** Pay-revision effective-date test absent; half-day leave application untested; 45/50 employees missing bank account (dev DB); all 50 missing pay_structure_id  
**Evidence lane:** 06-functional-test-catalogue, 05b-existing-test-assessment

---

## §30.4 — Payroll

**Score: 7 / 10**

**Tests passed:** 739/759 (12 failed, 8 skipped)  
**Oracle verification:** Independent oracle confirmed 90/90 field matches across 8 statutory test cases (basic+DA, PF, TDS, LOP, protected-net floor, gratuity, pension, off-cycle)  
**Working:** Tax engine (new/old regime), NACH adapter (all 67 bank-transfer tests), Form 16 (PDF + bulk), LTC, separation/gratuity, statutory PF/ESI/TDS/GPF/NPS deduction registers, maker-checker enforcement, payroll→finance GL emission  
**Broken:** ECR wage column defect (basic only, not basic+DA — EPFO filing rejection for all 7th CPC employees); LOP consumer queue-path failure; 6 test files fail with RLS 42501  
**Deductions:** −2 for ECR P0 defect (EPFO compliance filing broken) and LOP consumer failure; −1 for RLS test harness gaps masking integration coverage  
**Evidence lane:** 11-payroll-reconciliation

---

## §30.5 — Finance

**Score: 8 / 10**

**Tests passed:** 664/673 (9 failures confined to `finance-core.test.ts`)  
**All 14 invariants result:** 12/14 green (I1–I9, I10–I14 all pass); 2 blocked by instruments/repo.ts RLS bypass  
**Working:** Double-entry (BigInt), GL immutability (REVOKE + trigger), period close controls (hard/soft close), reversal as contra-creation, journal idempotency (2-layer: outbox + PK), bigint paise precision, HoA 18-digit structure, GFR Rules 10+11, maker-checker, subledger recon, balance sheet equation  
**Broken:** Instruments/repo.ts bypasses db.transaction() → all instrument INSERTs rejected by FORCE RLS (5 tests fail); test data gap (finance-core.test.ts expects pre-seeded tenant, none provided)  
**Critical integration gap:** Salary GL journal never posts (payroll.run.finalized topic broken — BL-03); 50 bigint-test rows distort all GL aggregates in dev DB  
**Evidence lane:** 10-financial-reconciliation

---

## §30.6 — Procurement

**Score: 6 / 10**

**Tests passed:** 359/381 (8 failed, 14 skipped)  
**Working:** GFR two-bid tender lifecycle (create→publish→bid→tech-eval→open-financial→award L1), sealed financial-bid integrity, blacklisted bidder exclusion, SOD enforcement, award idempotency, cross-tenant isolation, finance commitment gate, GFR financial bands, GeM adapter, central debarment check, vendor PII encryption, contract lifecycle, eSign, clauses, templates, obligations, approval matrix  
**Broken:** GRN consumer not writing under RLS; PO budget-exceeded path event not reaching outbox; 14 tests skipped  
**Gaps:** PO amendment lifecycle untested; tender cancellation untested; GRN partial receipt untested; contract breach remedies untested  
**Evidence lane:** 06-functional-test-catalogue

---

## §30.7 — Inventory

**Score: 6 / 10**

**Tests passed:** 417/427 (5 failed, 5 skipped) — inventory-service; stock 122/124; asset 156/174  
**Working:** WAVG engine (bigint, integer floor), FIFO engine (property-tested, 8 fast-check tests), cycle count (25 pure tests), three-way match (22 tests — PO/GRN/invoice variance), batch/lot tracking, demand forecast, costing boundary, canonical model, real-DB consumer proof (4/4 with civitas_admin)  
**Broken/Missing:** 3 inventory tables not migrated (`cycle_counts`, `cost_layers`, `warehouses`) — routes return 500; stock-service CQRS entry consumer broken (RLS); asset register consumer RLS cascade (8 GL test failures)  
**Evidence lane:** 12-data-quality-report

---

## §30.8 — Asset

**Score: 4 / 10**

**Tests passed:** 156/174 (16 failed, 2 skipped)  
**Working:** Impairment domain (16/16 — IAS 36, CGU aggregation, gain/loss), depreciation formula (SLM + WDV, pure math), GL schema and domain logic (correct), insurance module (complete), RLS isolation read tests (6/6)  
**Broken:** Register consumer RLS violation cascades to 8 GL/depreciation test failures; PATCH/DELETE routes return 404 (not registered); verification routes return 500 (3 migration columns missing); disposal route 500; `dep_method` mismatch (SLM vs WDV) in seed data; `accumulated_dep` diverges from posted entries  
**Deductions:** −4 for consumer cascade blocking all capitalisation, depreciation posting, and disposal flows; −1 for verification route 500; −1 for data integrity defects  
**Evidence lane:** 12-data-quality-report, 06-functional-test-catalogue

---

## §30.9 — eOffice (estab-service)

**Score: 3 / 10**

**Tests passed:** 271/339 (68 failed — 20% failure rate; 19 of 26 test files fail)  
**Working:** eSign (correctly wired to external), committee formation routes, facilities management routes, DFA reference setup  
**Broken:** DSP sequence numbering returns `undefined` (not `'DSP/2026/000001'`); NAI archival status not set; eOffice approval not wiring (consumers write nothing); file archival and correspondence lifecycle broken  
**Impact:** Entire document management, dispatch, and eOffice approval workflow is non-functional. This blocks procurement sanction routing, HR promotion/transfer approvals, and grant disbursement approval routing.  
**Evidence lane:** 03-module-inventory, 05b-existing-test-assessment

---

## §30.10 — Court / Legal

**Score: 7 / 10**

**Tests passed:** Court: 285/322 (0 failed, 37 skipped E2E); Legal: 248/267 (1 failed, 18 skipped)  
**Working:** Case lifecycle state machine, hearing scheduling, appeal state machine (8 tests), evidence SHA-256 chain, scrutiny domain, cause-list materialisation, order issuance, compliance directions, court registry (establishment code), party roles, filing fee conservation, eCourts adapter, limitation clock (property test), public lookup E2E, certified copies, DPDP PII at rest (AES-256-GCM)  
**Broken/Skipped:** E2E write-path tests permanently skipped (require live Postgres + Redis); `court.order.issued` + `court.notice.issued` not consumed by legal-service or notification-service; legal-service reminder route returns 404  
**Evidence lane:** 06-functional-test-catalogue, 03-module-inventory

---

## §30.11 — Workflow

**Score: 8 / 10**

**Tests passed:** 537/539 (2 failed)  
**Working:** Sequential/XOR/AND/parallel, call-activity (cycle detection, max depth), DLQ retry (5 attempts), round-robin/least-loaded/hierarchy assignment, SLA escalation sweeper, pre-breach reminders, deemed-approval timer, delegations, BPMN-DMN simulation (12 property tests), condition evaluation, graph validation, history tracking  
**Broken:** `r13-unknown-definition` DB constraint mismatch (status enum mismatch); `provisioning-catalog` POST returns non-201  
**Gaps:** Definition versioning during live instances untested; return/rework/resubmit cycle not integration-tested; conditional escalation to different role based on threshold untested  
**Evidence lane:** 06-functional-test-catalogue

---

## §30.12 — Cross-Module Integration

**Score: 4 / 10**

**Evidence:**
- 6 broken topic linkages (BL-01 to BL-06) causing silent data loss in GL, analytics, notifications
- ~124 orphaned domain events (produced but no consumer registered)
- 6 domain duplication clusters (warehouse, stock ledger, court case, RTI, tenant, audit para)
- 3 access-control audit gaps (CERT-In/DPDP §5)
- Schema registry not wired at runtime; schema evolution unconstrained
- Only ~35% of intended event signal coverage is wired
- Best-integrated subsystem: eOffice callback bus (15 ref_types, all fail-closed) — if eOffice itself weren't broken
- Integration tests: 124/131 pass (cross-domain chains confirmed for 5 key flows)  
**Evidence lane:** 04-dependency-map, 07-integration-matrix

---

## §30.13 — Multi-Tenancy

**Score: 7 / 10**

**Evidence:**
- DB-per-service isolation: confirmed, zero cross-prefix SQL joins
- FORCE RLS present in 35/38 services with domain logic
- `app.tenant_id` GUC plumbing verified correct in `shared/db.ts`
- Cache keys tenant-scoped: `{service}:{tenantId}:{resource}:{id}` (packages/cache)
- Queue: FIFO MessageGroupId = tenantId; consumers run in `runWithTenant(msg.tenantId)`
- Tenant editions (Small Office/PSU/Govt Dept) implemented via theme + entitlements  
**Gaps:** Tenant router (pool/silo/shard) is implemented but unwired; per-tenant rate limiting dormant (module-guard not wired); analytics GUC RLS unrecognized on test DB  
**Evidence lane:** 08-tenant-isolation-report, 07-integration-matrix

---

## §30.14 — Tenant Isolation (DB layer)

**Score: 7 / 10**

**Evidence:**
- FORCE RLS + fail-closed policy confirmed on all tenant tables
- Central write-fix (Wave 1): all ~30 services' consumer writes now establish tenant context via `withTenantConsumer→runWithTenant` — live-proven as NOBYPASSRLS role
- JWT-source fix live-proven for 12 services (finance, billing, notification, workflow, hrms, identity, payroll + court/visitor/meeting + analytics): bare read = 0 rows → scoped read + tenant-A GUC = 1 row → tenant-B GUC = 0 rows (isolation holds)
- Cross-tenant access probe: no fail-open found in fixed services  
**Residual gaps:** ~23 services still need read + JWT-hook fix (Wave 2); route-writes via bare db.execute (finance 3, hrms 61, identity 16); workflow_svc role has BYPASSRLS (infra misconfig)  
**Evidence lane:** 08-tenant-isolation-report

---

## §30.15 — Redis Isolation

**Score: 7 / 10**

**Evidence:**
- Cache package: tenant-prefixed keys, TTL clamped [1s, 3600s], stampede protection, no cross-tenant collision paths found
- All direct Redis keys include tenantId in name
- Financial/payroll data: all cached with tenant prefix, 60s TTL, no permanent records in Redis
- Audit hash chain: not stored in Redis (DB only)  
**Gaps:** `visitor:{tid}:pass:{passId}:direction` anti-passback keys with no TTL (accumulate forever); `visitor:{tid}:revoked` SADD grows unbounded; rate-limit keys have no env prefix (staging/prod collision risk if shared Redis)  
**Evidence lane:** 07-integration-matrix

---

## §30.16 — Authorization

**Score: 5 / 10**

**Evidence (positives):**
- JWT algorithm enforcement: RS256 explicit allowlist; HS256 blocked; alg:none rejected; expiry enforced; no ignoreExpiration anywhere
- Internal header stripping at gateway: x-internal, x-service-secret stripped from all external inbound requests
- Mass assignment: blocked — all mutation routes use explicit Zod schemas
- Role-check discipline generally sound in majority of services
- RBAC role checks tested in 7/38 services at 403 level  
**Gaps:** SEC-P0-01 = any authenticated user can bypass tenant isolation via forged header; SEC-P1-01 (payslip IDOR), SEC-P1-02 (ML no role check), SEC-P1-03 (CRM deal DELETE wrong role), SEC-P1-04 (theme GET header-only), SEC-P1-05 (SCIM tenant from header); ABAC defaulting to "off"  
**Evidence lane:** 09-security-report

---

## §30.17 — Auditability

**Score: 7 / 10**

**Evidence (positives):**
- SHA-256 hash chain with per-tenant advisory lock: tamper-evident, confirmed
- 180-day retention (`retainUntil = now + 180 days`): meets CERT-In §4 minimum
- Idempotent audit consumer: `markProcessed` — duplicate delivery produces exactly one record
- Chain verified end-to-end for finance GL journal post (5 hops) and identity session revoke
- 262+ audit emission sites across all services  
**Gaps:** `oldValue`/`newValue` NULL for all financial mutations (GL, budget, treasury, payroll runs) — field-level diffs missing for regulatory audit; actor role never captured in payload; plugin hook executions not audited; break-glass events not forwarded to audit sink; RBAC mutations not forwarded  
**Evidence lane:** 07-integration-matrix

---

## §30.18 — Data Quality

**Score: 6 / 10**

**Tests executed:** 35 checks across 7 DBs; 31/35 pass, 4 confirmed P1 defects  
**Passing:** GL balance integrity (no unbalanced journals), no orphan GL lines, no negative payslip net, no duplicate employee numbers, no impossible DOB/join dates, no orphan GRN without PO, inventory balance invariant  
**Failing:**
- BUG-DQ-01: Asset dep_method mismatch (SLM register / WDV schedule)
- BUG-DQ-02: Payroll run total ≠ slip sum (₹30,000 discrepancy in dev DB)
- BUG-DQ-03: 2 orphan contract milestones (no parent contract)
- BUG-DQ-04: 50 bigint-test rows in GL ledger distorting all financial reports  
**Warn-only:** accumulated_dep diverges for 2 assets; 100% of employees missing pay_structure_id; 90% missing bank account  
**Evidence lane:** 12-data-quality-report

---

## §30.19 — API Quality

**Score: 7 / 10**

**Evidence (positives):**
- All inputs validated with Zod at route boundary (confirmed by grep — no raw req.body access)
- All routes authenticated unless explicitly marked public in policy-service
- CQRS command→202 Accepted pattern consistently applied: 35/38 services
- correlationId in every envelope, every log line, every outbound event
- Structured JSON logs (Fastify pino); OpenTelemetry trace headers on outbound calls
- `/health`, `/metrics` (Prometheus) present in all services  
**Gaps:** 37 E2E test suites permanently skipped — live API behaviour for write-paths unproven; PATCH mutations returning 202 for non-existent IDs (SEC-P2-03); court-service CONSUMED_EVENTS = {} (no circuit for inbound events); analytics query consumer crashes on decimal monetary amount  
**Evidence lane:** 02-architecture-discovery, 03-module-inventory

---

## §30.20 — Security

**Score: 3 / 10**

**Critical findings (P0):**
1. SEC-P0-01: Gateway forwards client-supplied `x-tenant-id`; any authenticated user can access any tenant's data — confirmed exploitable with repro
2. SEC-P0-02: `createTenantTxHook` sources RLS GUC from header; combined with P0-01, full DB isolation bypass on 25/38 services
3. SEC-P0-03: Plugin runtime `new Function()` = server-side RCE when `PLUGIN_RUNTIME_ENABLED=true`

**P1 findings:** 11 (payslip IDOR, ML no auth, CRM wrong role, SCIM tenant bypass, PAN plaintext, SSRF × 2, hardcoded BYPASSRLS creds, hardcoded dev passwords across 28 services, inter-service auth silent failure)  
**Positives:** JWT RS256 enforcement, expiry enforced, rate limiting on auth, mass assignment blocked, SQL injection impossible (Drizzle parameterised), internal headers stripped at gateway  
**Evidence lane:** 09-security-report

---

## §30.21 — Performance

**Score: 6 / 10**

**Evidence (positives):**
- Cache architecture: `getOrLoad` with tenant-prefix, TTL clamped, stampede coalescing, read-your-writes, `invalidateAfterCommit`
- 1,453 index statements including tenant-leading composites on critical tables (payroll_slips, hrms_attendance, ml_training_runs, visitor.devices)
- PgBouncer: transaction-mode, 500 max clients, 20 pool size; correct DISCARD ALL on reset
- Circuit breaker at gateway (5-failure trip, 15s half-open)  
**Gaps:** N+1 in payroll consumer (4 DB queries + 1 HTTP per employee; DA rate/PT slabs not hoisted out of loop); payroll consumer bypasses cache (raw `db.execute`); analytics bypasses cache; single worker (500k-employee payroll run takes ~14 hours); no cache warming on deploy  
**Evidence lane:** 13-performance-report

---

## §30.22 — Scalability

**Score: 5 / 10**

**Evidence (positives):**
- Architecture: TenantRouter (pool/silo/shard) implemented; cell-based horizontal scaling designed
- Outbox partitioned in 31/38 services; audit partitioned (monthly, auto-create 3 months ahead)
- Queue abstraction (SQS/RabbitMQ/memory) enables broker swap without code change
- DB-per-service enables lift-to-dedicated without code change  
**Gaps:** TenantRouter unwired (all 38 services use singleton `createDb()`); no horizontal worker scaling (replicaCount=1); Redis single instance (no Sentinel wired despite CLAUDE.md requirement); `hrms_attendance` not partitioned (Year 2 crisis at current growth rate); `gl.finance_ledger` not partitioned; payroll day noisy-tenant production-blocking  
**Evidence lane:** 13-performance-report, 14-growth-forecast

---

## §30.23 — Reliability

**Score: 7 / 10**

**Evidence (positives):**
- Transactional outbox: DB write + outbox row in same transaction — at-least-once guaranteed
- Idempotent consumers: `markProcessed` ON CONFLICT DO NOTHING — exactly-once semantics
- DLQ: SQS max_receive_count=5, 14-day retention; `NonRetryableError` routes direct to DLQ
- 124/131 integration tests pass (cross-domain chains confirmed)
- Fan-out (multi-subscriber) working post QUE-FANOUT fix  
**Gaps:** Single worker / noisy-tenant saturates all consumers; no service-to-service circuit breaker (payroll→hrms, stock→inventory unprotected); no saga/compensation for DLQ scenarios; MemoryQueue no exponential backoff (rapid retry storm on transient DB blip); module-guard and quota-check dormant  
**Evidence lane:** 07-integration-matrix, 14-growth-forecast

---

## §30.24 — Backup / Restore

**Score: 3 / 10**

**Evidence (negatives):**
- No `pg_dump` automation found anywhere in repo (infra/aws, infra/onprem, scripts/)
- No PITR (Point-in-Time Recovery) configuration
- No streaming replica in `docker-compose.prod.yml` or Helm values
- Terraform RDS module explicitly commented out (`# module "rds" {...}` in `infra/aws/main.tf`)
- Projected restore window at Year 3 (1.6 TB): ~7 hours; Year 5 (9 TB): ~36 hours — unacceptable for government ERP  
**Evidence (positives):** AOF enabled on Redis (restart-safe for cache); outbox relay provides at-least-once event redelivery (not a DB backup substitute)  
**Lane:** 13-performance-report, 14-growth-forecast

---

## §30.25 — Test Automation

**Score: 6 / 10**

**Evidence:**
- 10,671 tests; 95.4% pass — strong baseline
- Three T1-class suites (meeting, court, visitor): property tests, cross-tenant isolation, negative paths, SOD, consumer idempotency, worker integration
- No always-pass tests; no `test.only()` in committed code; correct harness (`QUEUE_DRIVER=memory`)
- Consumer idempotency tested in 15+ services  
**Gaps:** 23/38 services mock DB — no SQL type-level verification; type bugs only surface in production; AuthZ (403 for wrong role) tested in 7/38; cross-tenant isolation explicitly tested in 9/38; audit event shape verified in 2/38; 7 court-service E2E suites permanently skipped (never run in CI); ECR content test absent; payroll duplicate-run test absent  
**Evidence lane:** 05b-existing-test-assessment

---

## §30.26 — Operational Readiness

**Score: 3 / 10**

**Evidence (positives):**
- Prometheus `/metrics` on all services; `pino` structured JSON logs; correlationId in all log lines
- OpenTelemetry trace headers on all outbound calls
- pm2 `ecosystem.config.js` (1 API + 1 worker per service)
- Helm chart at `infra/onprem/helm/` present (though replicaCount=1)  
**Gaps:** No backup/PITR (3/10 alone kills this); Redis single instance (cache SPOF); no readinessProbe/livenessProbe/HPA in Helm templates visible; module-guard and quota-check dormant (per-tenant rate limiting inactive); Redis Sentinel not wired; no DLQ monitoring/alerting configured; no runbooks or incident response playbooks in repo; no documented RTO/RPO targets  
**Evidence lane:** 13-performance-report, 14-growth-forecast

---

## §30.27 — OVERALL Readiness

**Score: 4 / 10**

| Category | Score | Weight | Contribution |
|----------|-------|--------|-------------|
| Security | 3 | 3 | 9 |
| Functional completeness | 7 | 2 | 14 |
| Business-rule correctness | 7 | 2 | 14 |
| Tenant isolation | 7 | 2 | 14 |
| Finance | 8 | 2 | 16 |
| HRMS | 6 | 1.5 | 9 |
| Payroll | 7 | 1.5 | 10.5 |
| Procurement | 6 | 1 | 6 |
| Inventory | 6 | 1 | 6 |
| Asset | 4 | 1 | 4 |
| eOffice | 3 | 1 | 3 |
| Court/Legal | 7 | 1 | 7 |
| Workflow | 8 | 1 | 8 |
| Cross-module integration | 4 | 1.5 | 6 |
| Authorization | 5 | 1.5 | 7.5 |
| Auditability | 7 | 1 | 7 |
| Data quality | 6 | 1 | 6 |
| Reliability | 7 | 1 | 7 |
| Performance | 6 | 1 | 6 |
| Scalability | 5 | 1 | 5 |
| Backup/Restore | 3 | 2 | 6 |
| Operational readiness | 3 | 1.5 | 4.5 |
| Test automation | 6 | 1 | 6 |
| **Totals** | | **33.5** | **181.5** |

Weighted average: 181.5 / 33.5 = **5.4 → capped at 4/10** because of the two structural disqualifiers:

1. **SEC-P0-01 + SEC-P0-02 together**: any authenticated user can access any other tenant's full dataset. A multi-tenant production deployment with this vulnerability causes a complete breach of every tenant's data the moment a single malicious user (or compromised account) is detected. This alone blocks production.

2. **No backup/PITR**: a single DB failure with no replica and no automated backup means total data loss with no recovery path. This alone blocks production for a government ERP.

A system scoring 5+ in most dimensions but 3/10 in security and 3/10 in backup/restore is not production ready. The score is 4/10, reflecting: strong domain logic foundations (pay the full 5 on that dimension) against two infrastructure/security disqualifiers that must be fixed before any production exposure.

---

## Score Summary

| # | Area | Score |
|---|------|-------|
| 1 | Functional completeness | 7 |
| 2 | Business-rule correctness | 7 |
| 3 | HRMS | 6 |
| 4 | Payroll | 7 |
| 5 | Finance | 8 |
| 6 | Procurement | 6 |
| 7 | Inventory | 6 |
| 8 | Asset | 4 |
| 9 | eOffice | 3 |
| 10 | Court/Legal | 7 |
| 11 | Workflow | 8 |
| 12 | Cross-module integration | 4 |
| 13 | Multi-tenancy | 7 |
| 14 | Tenant isolation | 7 |
| 15 | Redis isolation | 7 |
| 16 | Authorization | 5 |
| 17 | Auditability | 7 |
| 18 | Data quality | 6 |
| 19 | API quality | 7 |
| 20 | Security | **3** |
| 21 | Performance | 6 |
| 22 | Scalability | 5 |
| 23 | Reliability | 7 |
| 24 | Backup/Restore | **3** |
| 25 | Test automation | 6 |
| 26 | Operational readiness | **3** |
| **27** | **OVERALL** | **4** |
