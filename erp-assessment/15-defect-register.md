# 15 — Consolidated Defect Register

**Synthesised from:** Lanes L01–L09 (02-architecture-discovery through 14-growth-forecast)  
**Date:** 2026-07-12  
**Branch:** `court-management-service`  
**Total defects catalogued:** 68 (22 P0/P1 → Top 20 lead; 46 P2/P3 follow)

---

## TOP 20 Defects (P0 and P1)

| Rank | ID | Priority | Service | Finding | Evidence | Impact | Fix |
|------|-----|----------|---------|---------|----------|--------|-----|
| 1 | SEC-P0-01 | **P0** | gateway-service | Gateway does not overwrite client-supplied `x-tenant-id` with JWT `tid` claim; any authenticated user can forge the header and access any tenant's data | `gateway-service/src/jwt-edge.ts:63` — conditional `if (!req.headers["x-tenant-id"])` | Full cross-tenant read/write for all 38 services; exploitable by any authenticated user | Change conditional to unconditional overwrite: `(req.headers as Record<string,string>)["x-tenant-id"] = payload.tid` always |
| 2 | SEC-P0-02 | **P0** | packages/db (25 services) | `createTenantTxHook` sources PostgreSQL RLS GUC from raw `x-tenant-id` header, not JWT; combined with SEC-P0-01 = full DB-layer bypass on 25 services | `packages/db/src/tenant-tx.ts:57`; 25 services confirmed: admin, analytics, asset, audit, citizen, contract, crm, estab, grant, helpdesk, install, inventory, knowledge, legal, location, ml, plugin, policy, procurement, project, queue, report, stock, telephony, tenant, theme | RLS isolation neutralised fleet-wide when SEC-P0-01 exploited | Pass `getJwtTenantId` callback to `createTenantTxHook`; use JWT claim exclusively in production |
| 3 | SEC-P0-03 | **P0** | plugin-service | Plugin runtime executes arbitrary user-supplied JavaScript via `new Function()` with full Node.js process access | `plugin-service/src/modules/runtime/engine.ts:132`; zod validator only checks `z.string().min(1).max(512)` | Server-side RCE for any authenticated tenant user when `PLUGIN_RUNTIME_ENABLED=true` | Replace `new Function()` with existing `sandbox/runtime.ts` worker_threads implementation |
| 4 | BL-03 | **P0** | finance-service / payroll-service | `payroll.run.finalized` topic consumed by finance GL consumer but never emitted by payroll-service; payroll produces `payroll.run.disbursed` | `finance/src/topics.ts` CONSUMED_EVENTS vs `payroll/src/topics.ts` EVENTS; grep confirmed | Salary GL journal never posts; finance ledger is permanently missing all payroll cost entries | Align topic: either rename payroll emission to `payroll.run.finalized` or update finance consumer to subscribe to `payroll.run.disbursed` |
| 5 | GR-FAIL | **P0** | grant-service | 63% failure rate (29/46 tests); all 4 approval-gated disbursement paths fail; cross-tenant budget reservation broken | `tests/flows.test.ts` 22/24 fail (`expected [] to have a length of 1`); `tests/disbursement-approval.test.ts` 4/4 paths fail | Government fund release to beneficiaries impossible; grant disbursement is completely non-functional | Fix grant consumer to correctly write disbursement rows under FORCE RLS; wire `runWithTenant` in approval-gated consumer paths |
| 6 | ID-FAIL | **P0** | identity-service | 24% failure rate (14/59); tombstone/delete operations broken; cross-tenant RLS isolation tests fail | `tests/rls-isolation.test.ts` multiple failures; `expected tombstone?.operation to be "delete"` | Platform security perimeter broken; user deletion non-functional; cross-tenant data leak possible in auth flows | Fix tombstone consumer to write under correct tenant context; resolve RLS isolation test failures |
| 7 | SEC-P1-06 | **P0** | payroll-service | Raw SQL INSERT for pensioner records bypasses `encryptedText` Drizzle transform; PAN and bank account numbers stored in plaintext | `payroll-service/src/modules/payroll/routes.ts:156-170`; `encryptedText` columns present in schema | PAN and bank account (DPDP sensitive PII) written unencrypted to DB; DPDP Act violation | Replace raw `sql\`` with Drizzle ORM insert so `encryptedText` AES-GCM transform applies |
| 8 | PAY-DEF01 | **P0** | payroll-service | ECR (EPFO challan return) wage column uses `basicMinor` only, not `basic+DA`; EPFO pensionable wage is `min(basic+DA, 15000)` | `ecr-routes.ts:53-55`; independent oracle confirmed: for basic=12000, DA=5000 → ECR shows 12000, contribution computed on 15000 | EPFO challan reconciliation mismatch for all 7th CPC government employees; ECR filing rejection | Replace `slip.basicMinor` with `slip.basicMinor + slip.daMinor` (one-line fix) |
| 9 | NOTIF-CRASH | **P1** | notification-service | `src/modules/email/smtp-sender.js` is absent from source tree; email channel fails at service startup | `Error: Failed to load url ../src/modules/email/smtp-sender.js` in test output; file confirmed absent | Email channel crashes at startup; all email notifications silently fail in production | Create the missing `smtp-sender.js` module (or restore from git history) |
| 10 | ANALYTICS-BIGINT | **P1** | analytics-service | `query-consumer` passes decimal string `"250.00"` to a `bigint` column; monetary fact ingestion crashes | `PostgresError: invalid input syntax for type bigint: "250.00"` in `query-consumer.test.ts` | Any monetary fact event (finance, payroll) crashes the analytics consumer; financial KPIs permanently zero | Cast amount to `BigInt(Math.round(Number(amount)))` before insert; or fix schema column to `numeric` |
| 11 | ESTAB-FAIL | **P1** | estab-service | 20% failure rate (68/339); DSP sequence numbering returns `undefined`; NAI archival status not set; eOffice approval not wiring; 19 of 26 test files fail | `expected undefined to be 'DSP/2026/000001'`; `expected undefined to be 'nai_due'`; consumer writes nothing in 19 files | Entire document management (eOffice file lifecycle, DSP dispatch, NAI archival) non-functional | Fix DSP number generator (sequence consumer); wire eOffice approval callbacks; fix NAI workflow consumer |
| 12 | METADATA-STUB | **P1** | metadata-service | Complete stub: 5 DB tables, zero HTTP routes, no topics.ts, no worker, no gateway route | `find src -name routes.ts` → 0 results; no assigned port | Custom entity/field management has no API surface; tenants cannot create custom fields or entities | Implement routes.ts, topics.ts, worker, and register gateway route; minimum viable: GET/POST entity definitions |
| 13 | SEC-P1-01 | **P1** | payroll-service | Employee can read any co-worker's payslip PDF; `enforceEmployeeOwnership()` missing on payslip route | `payroll-service/src/modules/payslip-pdf/routes.ts:79-89`; `employee` role included in READER_ROLES without ownership check | IDOR: employee can download gross pay, net pay, PAN, bank IFSC, UAN of any co-worker | Add `enforceEmployeeOwnership(ctx, slip?.employeeNo)` after `requireRole` |
| 14 | SEC-P1-09 | **P1** | visitor-service / meeting-service | Hardcoded plaintext passwords for BYPASSRLS DB roles committed to git | `visitor-service/migrations/0009_scanner_role.sql:27`; `meeting-service/migrations/0007_*.sql:28` | Attacker with git access gets credentials that bypass all RLS policies entirely | Generate passwords from secrets manager at migration time; remove all `_dev_pw` literals from migrations |
| 15 | DQ-HRMS-P0 | **P1** | hrms-service | All 50 employees in dev DB missing `pay_structure_id`; payroll engine cannot compute gross for any run | `SELECT count(*) FROM hrms.hrms_employees WHERE pay_structure_id IS NULL` → 50/50 | Payroll cannot run for any employee in the seeded environment; blocks all payroll testing | Seed `pay_structure_id` for test employees; add NOT NULL constraint with migration guard |
| 16 | DQ-FIN-BIGINT | **P1** | finance-service | 50 test bigint-overflow rows in `gl.finance_ledger` (`debit_minor = 10^12` paise = ₹10,000 crore each); all GL aggregate queries are distorted | `SELECT count(*) FROM gl.finance_ledger WHERE debit_minor > 1000000000000` → 50 rows; voucher_no `"BIGINT-TEST-V001-*"` | Trial balance, P&L, balance sheet, budget utilisation reports all show wildly incorrect totals | Delete the 50 bigint-test rows from production-like environments; add CHECK constraint `debit_minor < 10^12` |
| 17 | DQ-PAY-RUN | **P1** | payroll-service | Payroll run 2024-12 header `total_gross_minor = ₹2,90,000` but slip sum = `₹3,20,000` (−₹30,000 discrepancy) | `SELECT r.total_gross_minor - SUM(s.gross_minor) FROM payroll_runs r JOIN payroll_slips s` → 1 row, discrepancy = −3,000,000 paise | DDO/PAO reconciliation fails; PFMS treasury feed mismatch; budget utilisation under-reported | Recompute and update run totals from slip sum; add a DB constraint/trigger to enforce `run.total == SUM(slips)` |
| 18 | INV-MIGRATIONS | **P1** | inventory-service | `cycle_counts`, `cost_layers`, `warehouses` tables not present in `civitas_inventory` DB despite being in Drizzle schema | `SELECT tablename FROM pg_tables WHERE schemaname='inventory'` → missing 3 tables; confirmed 500 on routes | Cycle count, FIFO cost-layer, and warehouse routes return 500 in any environment using standard migrations | Apply missing migrations; or generate and run `drizzle-kit push` for the missing tables |
| 19 | SEC-P1-07 | **P1** | telephony-service | SSRF via unvalidated `RecordingUrl` from Twilio webhook; fetched to arbitrary URL without allowlist | `telephony-service/src/modules/webhooks/routes.ts:143` + `recordings/consumer.ts:100`; no scheme/host validation | SSRF to internal network / AWS metadata endpoint via forged or replayed Twilio webhook | Validate `recordingUrl` against Twilio domain allowlist (`*.twilio.com`) before enqueuing |
| 20 | ASSET-CONSUMER | **P1** | asset-service | Register consumer fails with RLS violation on every asset creation; cascades to 8 GL/depreciation test failures | `PostgresError: new row violates row-level security policy for table "asset_assets"` in 3 consumer tests; gl.test.ts 8 cascade failures | Fixed-asset capitalisation and disposal flows completely broken; no asset can be recorded | Ensure consumer calls `runWithTenant(tenantId)` before `db.transaction()`; same fix class as finance instruments |

---

## Full Defect Register — P2 Defects (21–50)

| ID | Priority | Service | Finding |
|----|----------|---------|---------|
| SEC-P2-01 | P2 | gateway-service | `POLICY_ENFORCE` defaults to `"off"`; all ABAC rules skipped in default deploy |
| SEC-P2-02 | P2 | identity-service | No JWT blacklist on session revocation; stolen token valid until `exp` |
| SEC-P1-02 | P2 | ml-service | No `requireRole` on prediction history and inference endpoints |
| SEC-P1-03 | P2 | crm-service | Deal DELETE uses `crm_user` role; should require admin |
| SEC-P1-04 | P2 | theme-service | GET brand endpoints resolve tenant from raw header → cross-tenant brand read |
| SEC-P1-05 | P2 | identity-service | SCIM tenant from header only; SCIM token holder can operate on any tenant |
| SEC-P1-08 | P2 | legal-service | SSRF via `downloadUrl` from eCourts API response; no hostname allowlist |
| SEC-P1-10 | P2 | 28 services | Hardcoded `*_dev_pw` passwords and PII master key as vitest env var defaults |
| SEC-P1-11 | P2 | payroll-service | `fetchPendingPayrollRuns` omits `x-service-secret`; 401 silently returns 0 |
| BL-01 | P2 | analytics-service | `finance.payment.released` never emitted; analytics payment KPI perpetually zero |
| BL-02 | P2 | analytics-service | `grants.release.processed` never emitted (namespace mismatch); grant KPI zero |
| BL-04 | P2 | meeting-service | `hrms.employee.updated` never emitted; committee membership cache stale |
| BL-05 | P2 | payroll-service | `hrms.claim.approved` never emitted; LTC claim payouts never triggered |
| BL-06 | P2 | notification-service | `citizen.request.created` never emitted; citizen request notifications dropped |
| INT-01 | P2 | packages/events | `SchemaRegistry` not wired at publish/consume time; schema evolution unconstrained |
| INT-02 | P2 | plugin-service | `plugin-runtime/consumer.ts` writes to DB without `markProcessed`; duplicate hook fires |
| INT-03 | P2 | hrms↔payroll | Bidirectional HTTP mutual availability dependency; payroll→hrms lacks circuit breaker |
| PAY-DEF02 | P2 | payroll-service | LOP consumer assertion failure (`hrms.leave.approved` → `lop_ledger` broken on queue path) |
| PAY-DEF05 | P2 | payroll-service | Sponsor-bank-config GET returns 200 on empty instead of 404 NOT_FOUND |
| AUD-01 | P2 | finance/hrms/payroll | Finance GL, HRMS, payroll consumers do not supply `oldValue`/`newValue` in audit payload; field-level diffs missing | 
| AUD-02 | P2 | all services | Actor roles never captured in audit payload; requires runtime RBAC query to reconstruct |
| RED-01 | P2 | visitor-service | `visitor:{tid}:pass:{passId}:direction` stored with no TTL; keys accumulate forever |
| RED-02 | P2 | visitor-service | `visitor:{tid}:revoked` SADD grows unbounded; no purge on pass expiry |
| DQ-DM-WH | P2 | inventory+stock | Warehouse master duplication (two diverging masters, no sync event) |
| DQ-COURT-3 | P2 | estab+legal+court | Court case triple-tracking with no cross-service sync |
| DQ-RTI-3 | P2 | citizen+estab+hrms | RTI triple-tracking; hrms RTI entirely unwired to citizen/estab |
| DQ-ASSET-DM | P2 | asset-service | `accumulated_dep` diverges from posted dep entries (Dell Laptop +316,942p; Conference Table +1,000,000p) |
| DQ-ASSET-METHOD | P2 | asset-service | `dep_method=SLM` in register but `method=WDV` in schedule; statutory reporting error |
| DQ-ORF-CONTRACT | P2 | contract-service | 2 orphan milestones referencing absent contracts |
| WFLOW-BUG1 | P2 | workflow-service | `r13-unknown-definition` DB constraint violated (status enum mismatch in schema migration) |
| HRMS-GEO | P2 | hrms-service | Geo-attendance check-in returns 500 on `POST /v1/hrms/attendance/geo-checkin` (7/9 tests fail) |
| HRMS-DISC | P2 | hrms-service | Disciplinary Rule 14 major-penalty imposition gate fails (3/3 test cases fail) |
| CITIZEN-FAIL | P2 | citizen-service | 8/15 cross-tenant authz tests fail; 8/26 lifecycle tests timeout; CSV-injection neutralization broken |
| AUDIT-PARA | P2 | audit-service | Core para observation recording fails; RLS isolation 2/5 tests fail |
| BILLING-FAIL | P2 | billing-service | Subscription/plan lifecycle broken; 12 test failures |
| PROC-GRN | P2 | procurement-service | GRN consumer not writing under RLS; three-way match incomplete |
| CONTRACT-RLS | P2 | contract-service | RLS isolation 2 tests fail; lifecycle 3 tests fail |
| POLICY-ABAC | P2 | policy-service | ABAC evaluation edge cases fail; 10 tests skipped |
| INV-MISS-CB | P2 | inventory-service | inventory→ml-service synchronous call has no circuit breaker |
| HRMS-BANK | P2 | hrms-service | 45/50 employees missing `bank_account_no`; salary disbursement impossible for 90% of workforce |

---

## P3 Defects (non-blocking, tech debt)

| ID | Service | Finding |
|----|---------|---------|
| SEC-P2-04 | payroll-service | APBS download embeds full 12-digit Aadhaar without DLP controls |
| SEC-P2-05 | hrms-service | Public careers endpoint accepts any string as `tenantId`; no UUID validation |
| SEC-P2-06 | visitor-service | X-Forwarded-For spoofable for evacuation IP allowlist check |
| SEC-P2-07 | gateway-service | `/internal/config` on same public port; bare-metal bypass risk |
| PERF-N1 | payroll-service | N+1: 4 DB queries + 1 HTTP per employee in payroll consumer; DA rate/PT slabs not hoisted |
| PERF-REDIS | infrastructure | Redis single instance (no Sentinel); SPOF for entire cache layer |
| PERF-WORKER | payroll-service | Single worker; 500k-employee payroll run blocks all tenants for hours |
| PERF-OUTBOX | packages/outbox | 500ms relay, 100-row batch → 2.5s event lag at 1000 TPS |
| PERF-NOINDEX | court+visitor+meeting+ml | Missing FK index migrations in 7 services |
| BACKUP | infrastructure | No pg_dump automation, no PITR, no streaming replica; Terraform RDS module commented out |
| ORPHAN-95 | 10 services | ~95 fully orphaned event topics (admin, identity, policy, install, location, theme, plugin, report, notification, analytics) |
| SCHEMA-REG | packages/events | `validatePayload()` implemented but called in zero production publish/subscribe sites |
| AUD-03 | plugin-service | Plugin hook executions not audited |
| OUTBOX-7 | newer services | court, meeting, visitor lack outbox partitioning; tables will bloat at scale |
| ANALYTICS-CACHE | analytics-service | Bypasses cache; direct DB aggregation on every query |
| HRMS-59SKIP | hrms-service | 59 tests permanently skipped (E2E geo-attendance requires live DB) |
| BILLING-NO-GL | billing-service | `billing.invoice.paid` has no finance GL consumer; revenue not booked |
| ASSET-CREATE-GL | asset-service | `asset.asset.created` has no finance GL consumer; asset capitalisation journal never posted |
| IDENTITY-MISSING | identity-service | `identity.user.created` → policy/notification missing; no default role binding |
| INVENTORY-REORDER | inventory-service | `inventory.stock.low` → procurement missing; low-stock never triggers auto-reorder |
