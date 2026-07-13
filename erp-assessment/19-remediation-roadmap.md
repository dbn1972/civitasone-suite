# 19 — Remediation Roadmap

**Synthesised from:** Lanes L01–L09 + §30 Scorecard  
**Date:** 2026-07-12  
**Branch:** `court-management-service`

---

## Roadmap Overview

| Phase | Timeline | Gate | Target Score |
|-------|----------|------|-------------|
| **MUST-FIX before any pilot** | 0–21 days | Zero P0s; grant/identity/estab unblocked; backup exists | OVERALL 6/10 |
| **MUST-FIX before production** | 21–90 days | All P1s resolved; Wave 2 tenant isolation; integration gaps closed | OVERALL 7/10 |
| **30-day sprint** | Days 1–30 | Security P0s + critical service defects + backup | Security ≥6 |
| **90-day sprint** | Days 31–90 | P1 defects + test automation T2 + performance + integration | OVERALL ≥7 |
| **180-day sprint** | Days 91–180 | Scale readiness + observability + T3/T4 tests + data partitioning | OVERALL ≥8 |

---

## Phase 1 — Before Any Controlled Pilot (Days 1–21)

These items are **hard blockers**. No pilot with real government data should proceed until all items in this phase are resolved.

### P0 Security Fixes (Days 1–3, Sprint 1)

| # | Fix | File | Effort | Assignee area |
|---|-----|------|--------|--------------|
| 1 | **SEC-P0-01**: Unconditionally overwrite `x-tenant-id` from JWT in gateway | `gateway-service/src/jwt-edge.ts:63` | 1 line + test | Gateway team |
| 2 | **SEC-P0-02**: Pass JWT-sourced tenantId to `createTenantTxHook`; apply to all 25 affected services | `packages/db/src/tenant-tx.ts:57`; service-by-service app.ts | 2–3 days | Platform team |
| 3 | **SEC-P0-03**: Replace `new Function(handler)` with existing `sandbox/runtime.ts` worker_threads implementation | `plugin-service/src/modules/runtime/engine.ts:132` | 0.5 day + test | Plugin team |
| 4 | **Add regression tests** (T1-01 through T1-03 from automation backlog) | gateway/tests, packages/db/tests, plugin-service/tests | 1 day | QA |

### Critical Service Defect Fixes (Days 3–14, Sprint 2)

| # | Fix | Effort | Risk if deferred |
|---|-----|--------|-----------------|
| 5 | **Identity-service**: Fix tombstone/delete and RLS isolation test failures | 2 days | Platform security perimeter broken |
| 6 | **Grant-service**: Fix approval-gated disbursement consumer (runWithTenant + consumer write path) | 3 days | Government fund release non-functional |
| 7 | **Notification-service**: Create missing `smtp-sender.js` module | 0.5 day | Email channel crashes at startup |
| 8 | **Analytics-service**: Fix BigInt decimal mismatch (`"250.00"` → `BigInt(Math.round(...))`) | 0.5 day | All monetary fact ingestion crashes |
| 9 | **Estab-service**: Fix DSP sequence consumer + NAI archival + eOffice approval wiring | 3 days | Document management non-functional |
| 10 | **Finance instruments**: Wrap `instruments/repo.ts` operations in `db.transaction()` | 0.5 day | Cheque/DD lifecycle broken in production |
| 11 | **Payroll ECR**: Fix wage column to use `basicMinor + daMinor` | 1 line | EPFO filing rejection for all employees |
| 12 | **Payroll LOP consumer**: Debug `hrms.leave.approved` → `lop_ledger` queue-path failure | 1 day | LOP deductions wrong under real queue |
| 13 | **GL test data**: Delete 50 bigint-test rows from `gl.finance_ledger`; add CHECK constraint | 0.5 day | All financial reports distorted |
| 14 | **Payroll run totals**: Fix run 2024-12 total_gross_minor vs slip sum discrepancy | 0.5 day | PFMS reconciliation fails |
| 15 | **Broken topic BL-03**: Align `payroll.run.finalized` vs `payroll.run.disbursed` across finance + payroll | 1 day | Salary GL journal never posts |

### Backup Infrastructure (Days 7–14, Sprint 2, parallel)

| # | Fix | Effort | Risk if deferred |
|---|-----|--------|-----------------|
| 16 | **PITR**: Enable `wal_level=replica`, `archive_mode=on`, WAL archival to S3 or local Barman | 2 days (infra) | Total data loss on DB failure |
| 17 | **Streaming replica**: Add PostgreSQL hot-standby replica to docker-compose.prod.yml and Helm | 1 day (infra) | No failover; single-point of failure |
| 18 | **Nightly backup**: `pg_basebackup` cron to S3 for each service DB | 1 day (infra) | RPO = since last manual backup |
| 19 | **Uncomment Terraform RDS module**: configure `backup_retention_period = 7` for AWS path | 0.5 day (infra) | AWS deployments have no automated backup |

### Hardcoded Credentials Cleanup (Days 3–7, Sprint 1)

| # | Fix | Effort |
|---|-----|--------|
| 20 | Remove plaintext passwords from `visitor-service/migrations/0009_scanner_role.sql` and `meeting-service/migrations/0007_*.sql` for BYPASSRLS roles; generate from secrets manager | 1 day |
| 21 | Remove all `*_dev_pw` and PII master key fallbacks from all 28 vitest.config.ts files; fail fast on missing env vars | 1 day |

---

## Phase 2 — Before Production (Days 21–90)

Items in this phase are required for a multi-tenant government production deployment. A controlled single-tenant pilot may proceed after Phase 1, but production with multiple tenants requires all of Phase 2.

### Wave 2 Tenant Isolation (Days 21–35)

| # | Fix | Scope | Effort |
|---|-----|-------|--------|
| 22 | **Wave 2 read-path fix**: Apply JWT-source hook to remaining 23 services' bare `db.select()` reads | 23 services | 3–4 days |
| 23 | **Route-write fix**: Wrap bare `db.execute()` in `db.transaction()` for finance (3), hrms (61), identity (16) route-level writes | 3 services | 2 days |
| 24 | **workflow_svc BYPASSRLS**: Set `NOBYPASSRLS` on workflow_svc DB role in bootstrap | `infra/db/bootstrap/` | 0.5 day |
| 25 | **Cross-tenant sweep tests**: Add T2-09 (23 services, NOBYPASSRLS role probe) | `tests/integration/` | 2 days |

### Authorization Gaps (Days 21–35)

| # | Fix | Effort |
|---|-----|--------|
| 26 | **SEC-P1-01** (Payslip IDOR): Add `enforceEmployeeOwnership()` to payslip PDF route | 0.5 day |
| 27 | **SEC-P1-02** (ML no role): Add `requireRole(ctx, ML_ADMIN_ROLES)` to predictions + inference routes | 0.5 day |
| 28 | **SEC-P1-03** (CRM deal DELETE): Change to `ADMIN_ROLES`; add ownership pre-fetch to deal PATCH | 0.5 day |
| 29 | **SEC-P1-04** (Theme GET): Replace `resolveTenantId(req)` with `resolveContext(req).tenantId` | 1 hour |
| 30 | **SEC-P1-05** (SCIM): Bind SCIM token to `SCIM_TENANT_ID`; reject header overrides | 0.5 day |
| 31 | **SEC-P2-01** (ABAC default off): Change `POLICY_ENFORCE` default to `"audit"`; document for production | 0.5 day |
| 32 | **SEC-P2-02** (JWT blacklist): Implement Redis set of revoked `jti`/`sid`; check in `verifyJwt()` | 1 day |

### Integration Gap Closure (Days 35–60)

| # | Fix | Effort |
|---|-----|--------|
| 33 | **BL-01 + BL-02**: Fix analytics INBOUND topic keys to match finance/grant emissions | 1 day |
| 34 | **G-INT-07**: Add `billing.invoice.paid` → finance GL consumer | 1 day |
| 35 | **G-INT-08**: Add `asset.asset.created` → finance GL consumer | 1 day |
| 36 | **G-INT-10**: Add `inventory.stock.low` → procurement indent consumer | 1 day |
| 37 | **G-INT-13/14/15**: Route break-glass, RBAC mutations, and policy binding events to audit sink | 2 days |
| 38 | **G-INT-12**: Wire `court.order.issued` and `court.notice.issued` → legal-service and notification consumers | 1 day |
| 39 | **BL-04/BL-05/BL-06**: Emit `hrms.employee.updated`, `hrms.claim.approved`, `citizen.request.created` | 1 day |
| 40 | **Schema registry**: Wire `validatePayload()` in all queue publish + subscribe sites | 2 days |

### Asset + Inventory + Data Quality (Days 35–60)

| # | Fix | Effort |
|---|-----|--------|
| 41 | **Asset consumer**: Add `runWithTenant(tenantId)` in test harness; fix cascade GL failures | 1 day |
| 42 | **Inventory migrations**: Apply missing `cycle_counts`, `cost_layers`, `warehouses` tables | 0.5 day |
| 43 | **Asset verification**: Apply missing 3 migration columns (`version`, `created_by`, `updated_by`) to `lifecycle.physical_verifications` | 0.5 day |
| 44 | **Asset dep_method**: Correct Dell Laptop XPS15 schedule method to match register (SLM) | 0.5 day |
| 45 | **Stock consumer**: Fix CQRS entry consumer RLS (same class as asset: `runWithTenant`) | 0.5 day |
| 46 | **HRMS data**: Seed `pay_structure_id` for test employees; seed bank accounts | 0.5 day |
| 47 | **Contract orphan milestones**: Clean orphan records; add FK constraint or soft-reference guard | 0.5 day |

### Audit Completeness (Days 60–75)

| # | Fix | Effort |
|---|-----|--------|
| 48 | **AUD-01**: Add `oldValue`/`newValue` to finance GL, budget, treasury, payroll run audit emissions | 2 days |
| 49 | **AUD-02**: Capture `ctx.roles` in audit payload for all 38 service consumers | 1 day |
| 50 | **AUD-03**: Add audit emission to plugin-runtime consumer | 0.5 day |

### Performance (Days 60–90)

| # | Fix | Effort |
|---|-----|--------|
| 51 | **N+1 payroll**: Hoist DA rate and PT slabs resolution outside per-employee loop; cache results | 1 day |
| 52 | **Payroll worker scaling**: Configure `replicaCount = 3` in Helm with HPA on SQS queue depth; use FIFO per-run MessageGroupId | 2 days (infra) |
| 53 | **Redis Sentinel**: Wire actual Sentinel config in production compose and Helm values | 1 day (infra) |
| 54 | **inventory→ml circuit breaker**: Wrap `forecast/ml-client.ts` with `@civitasone/circuit-breaker` | 0.5 day |
| 55 | **payroll→hrms circuit breaker**: Add circuit breaker to `hrms-client.ts` | 0.5 day |

### Test Automation Tier 2 (Days 60–90)

- T2-01 through T2-13 as defined in 17-automation-backlog.md (13 tests, ~15 developer-days total)

---

## 30-Day Plan (Priority sequence)

| Day | Focus | Deliverables |
|-----|-------|-------------|
| 1–3 | Security P0 sprint | SEC-P0-01, SEC-P0-02, SEC-P0-03 fixed; regression tests added |
| 3–7 | Credentials cleanup | BYPASSRLS hardcoded passwords removed; dev env fallbacks removed |
| 7–14 | Critical services | Identity, grant, notification, analytics, estab defects fixed; BL-03 topic aligned |
| 7–14 (parallel) | Backup infrastructure | PITR, streaming replica, nightly backup configured |
| 14–21 | Finance + payroll | ECR wage column, LOP consumer, instruments repo, GL test data cleaned |
| 14–21 (parallel) | Test automation T1 | T1-01 through T1-07 implemented (7 T1 tests) |

**30-day exit criteria:** All P0 defects resolved; grant/identity/notification/analytics unblocked; backup/PITR in place; T1 tests added → **OVERALL score: 6/10**

---

## 90-Day Plan (Cumulative from day 0)

| Period | Focus | Deliverables |
|--------|-------|-------------|
| Days 1–30 | Phase 1 (above) | P0 security, critical services, backup |
| Days 31–45 | Wave 2 isolation + auth gaps | 23-service read path fix; SEC-P1-01 through P1-05 |
| Days 46–60 | Integration gaps | BL-01/02, G-INT-07/08/10/12/13/14/15, schema registry |
| Days 61–75 | Asset + inventory + data quality | Consumer fixes, missing migrations, data cleanup |
| Days 76–90 | Audit + performance + T2 tests | old/new values, N+1 fix, Redis Sentinel, T2 automation |

**90-day exit criteria:** All P0+P1 defects resolved; all critical integration gaps closed; Wave 2 isolation proven; T1+T2 automation complete; audit field-level diff present → **OVERALL score: 7/10; Security ≥6/10**

---

## 180-Day Plan (Cumulative from day 0)

| Period | Focus | Deliverables |
|--------|-------|-------------|
| Days 1–90 | Phase 1 + Phase 2 (above) | See 90-day plan |
| Days 91–120 | Scalability foundations | `hrms_attendance` partitioned; `gl_entries` partitioned; TenantRouter wired for first silo tenant; outbox relay tuned (batch=1000, interval=100ms) |
| Days 121–150 | Metadata service + domain cleanup | Implement metadata-service routes + worker; resolve warehouse/stock duplication (single master); resolve court-case triple-tracking |
| Days 151–180 | T3 test automation + observability | 25 T3 tests; DLQ monitoring/alerting; runbooks; readinessProbe/livenessProbe in Helm; ABAC fully enforced |

**180-day exit criteria:** Scale to 50k-employee tenant proven; all duplication clusters resolved; metadata service functional; T3 automation complete; ABAC enforced → **OVERALL score: 8/10**

---

## What Prevents 10/10

Even after 180 days of remediation, the following systemic issues would require additional architectural work to reach 10/10:

| Dimension | Current blocker | Required for 10/10 |
|-----------|----------------|-------------------|
| Security | 3 P0 + 11 P1 findings | All P0+P1+P2 fixed; penetration test clean; external VAPT report |
| Scalability | Single worker; no cell deployment; no analytics warehouse | Horizontal workers + per-run FIFO; cell-0 deployed; ClickHouse/BigQuery for analytics |
| Backup/Restore | No automation today | PITR + streaming replica + tested restore runbook + RTO ≤30 min documented |
| eOffice | 20% failure rate; DSP/NAI/approval broken | All 26 test files pass; eOffice approval wiring complete |
| Cross-module integration | 124 orphaned events; 6 broken linkages | All critical wires closed; schema registry enforced in CI |
| Audit completeness | old/new values absent for financial mutations | All consumers emit field-level diffs |
| ABAC enforcement | POLICY_ENFORCE defaults to off | ABAC on by default in production; policy coverage ≥90% of endpoints |
| Test automation | E2E suites permanently skipped; DB mocked in 23/38 services | E2E suites running in CI with live Postgres; DB mocked → real-DB for top 20 services |
| Metadata service | Complete stub | Fully implemented with routes, consumers, worker, tests |
| Saga / compensation | No distributed saga | DLQ events have automated compensating transactions or dead-letter alerting with runbook |
