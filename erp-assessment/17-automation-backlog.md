# 17 — Test Automation Backlog

**Synthesised from:** Lanes L01 (test assessment) + L07 (functional test catalogue) + L04/L05 (recon lanes)  
**Date:** 2026-07-12  
**Priority logic:** Risk × Business criticality × Blast radius of failure if untested

Tests are ordered highest-value first. Each entry is executable — it specifies the service, file name, test approach, and exact scenario to cover.

---

## Tier 1 — P0 Blockers (Must exist before any pilot)

### T1-01 · Security: Gateway x-tenant-id Overwrite Regression Test
- **Module:** gateway-service | **Risk:** P0 (cross-tenant access)
- **File:** `services/gateway-service/tests/security.test.ts` (extend existing)
- **Test:** Send a valid JWT for tenant A with `x-tenant-id: TENANT_B_UUID` header. Assert response contains TENANT_A data only. Assert gateway response headers contain `x-tenant-id: TENANT_A_UUID`. This prevents regression of SEC-P0-01.
- **Evidence needed:** Currently `security.test.ts` verifies header stripping for `x-internal` but does NOT verify the JWT-derived tenant overwrite.

### T1-02 · Security: RLS GUC Sources JWT (Not Header) Integration Test
- **Module:** packages/db | **Risk:** P0 (DB isolation bypass)
- **File:** New `packages/db/tests/tenant-isolation-jwt.test.ts`
- **Test:** Spin a Fastify app with `createTenantTxHook`. Send request with JWT for tenant A and `x-tenant-id: TENANT_B_UUID`. Execute `SELECT current_setting('app.tenant_id')` inside a transaction. Assert result is TENANT_A (from JWT), not TENANT_B. Proves SEC-P0-02 fix.

### T1-03 · Security: Plugin Sandbox Isolation Test
- **Module:** plugin-service | **Risk:** P0 (RCE)
- **File:** `services/plugin-service/tests/sandbox-isolation.test.ts` (new)
- **Test:** Register a hook with `handlerPath` containing `require('child_process').execSync('id')`. Execute the hook via plugin-runtime. Assert the execution is contained to the worker thread, that no child process output appears in the host, and that the hook returns a domain-constrained result or errors safely.

### T1-04 · Finance: Payroll GL Journal Posts Correctly (BL-03 Fix Verification)
- **Module:** finance-service ↔ payroll-service | **Risk:** P0 (financial ledger integrity)
- **File:** `services/finance-service/tests/integration-payroll-gl.test.ts` (new)
- **Test:** Publish a `payroll.run.finalized` event (or whichever topic name the fix adopts). Assert the GL consumer writes `DR Salaries Expense` + `CR Salary Payable` + `CR EPF Payable` correctly. Verify outbox row is inserted with correct topics.

### T1-05 · Grant: Approval-Gated Disbursement (All 4 Paths)
- **Module:** grant-service | **Risk:** P0 (government funds)
- **File:** `services/grant-service/tests/disbursement-approval.test.ts` (fix and expand)
- **Test:** Each of the 4 approval paths (single-approver, multi-stage, SOD-enforced, budget-reservation-gated). Assert: (a) `grant_disbursements` row written with `status=approved`, (b) `finance.payment.request` event emitted, (c) budget reservation decremented, (d) cross-tenant disbursement command rejected.

### T1-06 · Identity: RLS Isolation + Tombstone/Delete
- **Module:** identity-service | **Risk:** P0 (security perimeter)
- **File:** `services/identity-service/tests/rls-isolation.test.ts` (fix failures)
- **Test:** (a) Create user in tenant A; assert tenant B query returns 0 rows. (b) Delete user; assert tombstone row is written with `operation = "delete"` and original row is gone. (c) Re-create with same ID; assert idempotency gate fires.

### T1-07 · Payroll: ECR Wage Column Content Test
- **Module:** payroll-service | **Risk:** P0 (EPFO compliance)
- **File:** `services/payroll-service/tests/ecr-content.test.ts` (new)
- **Test:** Seed 3 PF records for employees with `basic=12000, DA=5000` (DA elevates above 15k ceiling), `basic=8000, DA=4000` (below ceiling), and `basic=20000, DA=10000` (above ceiling). Call ECR endpoint. Parse pipe-delimited output. Assert column 3 (`epfWages`) = `min(basic+DA, 15000)` for each employee. Asserts DEF-01 is fixed.

---

## Tier 2 — High Value (Required before production, execute within 30 days)

### T2-01 · Finance: Closed Period Rejects GL Posting
- **Module:** finance-service | **Risk:** H (financial integrity)
- **File:** `services/finance-service/tests/period-close-guard.test.ts` (new)
- **Test:** Hard-close a period via the period-close endpoint. Publish `gl.journalPost` command for that period. Assert consumer throws `PERIOD_CLOSED`; assert no journal row written; assert `gl_periods` row has `status=hard_close`. Tests I4 under the real CQRS consumer path (currently only mocked).

### T2-02 · Finance: Concurrent Sanction Drain (Optimistic Lock)
- **Module:** finance-service | **Risk:** H (double-spend)
- **File:** `services/finance-service/tests/concurrent-sanction.test.ts` (new)
- **Test:** Seed a sanction with balance = 1000 paise. Publish two simultaneous `payment.bill.create` commands each requesting 700 paise. Assert exactly one succeeds (`202` + row written) and one fails with `INSUFFICIENT_SANCTION` or is blocked by optimistic lock. Requires real Postgres.

### T2-03 · Payroll: Closed-Period Guard
- **Module:** payroll-service | **Risk:** H (duplicate payroll)
- **File:** `services/payroll-service/tests/closed-period-guard.test.ts` (new)
- **Test:** Create and finalize a payroll run for `2026-01`. Attempt to create another run for `2026-01`. Assert second command returns `PERIOD_CLOSED` or `RUN_ALREADY_FINALIZED`; assert only one `payroll_runs` row exists.

### T2-04 · HRMS→Payroll: LOP Consumer Integration
- **Module:** hrms-service → payroll-service | **Risk:** H (wrong deductions)
- **File:** `services/payroll-service/tests/integration-hr.test.ts` (fix DEF-02)
- **Test:** Publish `hrms.leave.approved` via real queue (not mock). Assert `payroll.lop_ledger` row inserted for the correct tenant + employee + month. Assert `getLopForMonth` returns the correct days count. Fix the queue-path consumer that currently fails.

### T2-05 · Inventory: Negative Stock Prevention
- **Module:** inventory-service | **Risk:** H (inventory integrity)
- **File:** `services/inventory-service/tests/negative-stock.test.ts` (new)
- **Test:** Seed store with 10 units. Publish issue command for 11 units. Assert consumer throws `INSUFFICIENT_STOCK`; assert `stock_balances.on_hand_qty` remains 10; assert no ledger row written for the over-issue.

### T2-06 · Asset: Registration Consumer (Fix RLS, Verify GL)
- **Module:** asset-service | **Risk:** H (fixed-asset accounting)
- **File:** `services/asset-service/tests/asset.test.ts` (fix 3 failing tests)
- **Test:** Call `runWithTenant(tenantId)` in test setup before publishing `asset.asset.create`. Assert `asset_assets` row written, `_inbox.processed` row written, and `finance.gl.post` emitted with Dr acquisitionCost / Cr asset-payable. Extends existing test harness.

### T2-07 · Workflow: Definition Versioning During Live Instances
- **Module:** workflow-service | **Risk:** H (production deploy safety)
- **File:** `services/workflow-service/tests/definition-versioning.test.ts` (new)
- **Test:** Start an instance pinned to definition v1. Publish a new definition v2 (incremented version). Assert in-flight instance continues on v1. Assert new instances start on v2. Assert `instances.definition_version` field is preserved on the in-flight instance.

### T2-08 · Audit: old/new Values in Financial Mutations
- **Module:** finance-service | **Risk:** H (CAG/CERT-In compliance)
- **File:** `services/finance-service/tests/audit-completeness.test.ts` (new)
- **Test:** Post a GL journal. Assert the resulting `audit.event.record` payload includes `oldValue: null` and `newValue: {lines, totalDebit, ...}`. Update a budget sanction. Assert `oldValue.status = "draft"` and `newValue.status = "approved"` in audit payload. This tests AUD-01.

### T2-09 · Cross-Tenant Isolation Sweep (Wave 2 Services)
- **Module:** 23 PARTIAL services | **Risk:** H (multi-tenancy)
- **File:** `tests/integration/cross-tenant-sweep.test.ts` (new, shared suite)
- **Test:** For each of the 23 services without proven cross-tenant isolation: seed one row for tenant A using `runWithTenant(tenantA)`. Query the same table using the real `NOBYPASSRLS` DB role with `app.tenant_id = tenantB`. Assert result is empty. Parameterised test covers all 23 services in one file.

### T2-10 · Estab: DSP Numbering + NAI Archival + eOffice Approval
- **Module:** estab-service | **Risk:** H (document management)
- **File:** `services/estab-service/tests/dsp-sequencing.test.ts` + `nai-archival.test.ts` (fix and new)
- **Test (DSP):** Create a file with `DISPATCH` type. Assert consumer writes DSP number in format `DSP/2026/000001`. Assert second dispatch in same year gets `DSP/2026/000002`. **Test (NAI):** Close a file. Assert `estab_files.status = 'nai_due'` written correctly. **Test (eOffice):** Trigger an eOffice approval callback. Assert the corresponding domain entity's status transitions.

### T2-11 · RTI Act: 30-Day Deadline Enforcement
- **Module:** citizen-service | **Risk:** H (statutory compliance)
- **File:** `services/citizen-service/tests/rti-deadline.test.ts` (new)
- **Test:** Create an RTI request with `filed_at = now - 31 days`. Run the overdue-sweep scheduler. Assert the RTI request has `status = 'overdue'` and an escalation event is emitted. Assert 29-day-old RTI is not marked overdue.

### T2-12 · Stock: CQRS Entry Consumer (RLS Fix)
- **Module:** stock-service | **Risk:** H (stock ledger)
- **File:** `services/stock-service/tests/stock.test.ts` (fix 2 failing tests)
- **Test:** Set `runWithTenant(tenantId)` in test setup before queue publish. Assert `stock_entries` row persisted, `stock_ledger` row appended, `stock_valuation_rates` updated. Assert duplicate message correctly no-ops via `markProcessed`. Fixes D-10.

### T2-13 · Billing: Invoice Paid → Finance GL Integration
- **Module:** billing-service → finance-service | **Risk:** H (revenue recognition)
- **File:** `services/finance-service/tests/integration-billing-gl.test.ts` (new)
- **Test:** Publish `billing.invoice.paid` event. Assert finance GL consumer writes `DR Accounts Receivable / CR Revenue` journal. Assert journal lines sum to zero (balanced). Closes G-INT-07.

---

## Tier 3 — Medium Value (30–90 day sprint)

| ID | Module | Test Description | Risk |
|----|--------|-----------------|------|
| T3-01 | procurement | PO amendment lifecycle: change-order bumps version, GRN/finance see updated amounts | Medium |
| T3-02 | procurement | GRN partial receipt: split GRN against single PO line, amounts reconcile | Medium |
| T3-03 | hrms | APAR initiation→counter-signature→acceptance lifecycle (consumer-level) | Medium |
| T3-04 | hrms | Half-day leave application (AM/PM, 0.5-day balance) | Medium |
| T3-05 | payroll | Sec 192 TDS true-up spread across 12 months (not flat-divide only) | Medium |
| T3-06 | payroll | Arrear payment: revised DA posts correct GL entry for prior months | Medium |
| T3-07 | inventory | Cycle count (requires `inventory.cycle_counts` table migration) | Medium |
| T3-08 | inventory | FIFO cost-layer routes (requires `inventory.cost_layers` migration) | Medium |
| T3-09 | asset | Depreciation schedule SLM end-to-end with rounding true-up | Medium |
| T3-10 | asset | Asset disposal GL write-off (retire→proceed→gain/loss journal) | Medium |
| T3-11 | workflow | Return/rework/resubmit cycle (full integration including SLA reset) | Medium |
| T3-12 | workflow | Conditional escalation to different role (amount > threshold) | Medium |
| T3-13 | court | Evidence SHA-256 tamper detection rejection | Medium |
| T3-14 | court | Batch summons generation for multi-party cases | Medium |
| T3-15 | meeting | Circular resolution without calling a formal meeting | Medium |
| T3-16 | meeting | Director conflict-of-interest abstention exclusion from quorum tally | Medium |
| T3-17 | citizen | GRC escalation after 30-day unresolved grievance | Medium |
| T3-18 | citizen | CPGRAMS integration contract test (outbound payload shape) | Medium |
| T3-19 | helpdesk | SLA clock pause/resume (waiting-for-customer status) | Medium |
| T3-20 | notification | SMTP integration test (requires smtp-sender.js to be created first) | Medium |
| T3-21 | analytics | Finance payment KPI asserts non-zero after `finance.payment.made` event | Medium |
| T3-22 | analytics | Grant disbursement KPI asserts non-zero after `grant.disbursement.completed` | Medium |
| T3-23 | identity | SCIM tenant binding integration test (SCIM_TENANT_ID enforced) | Medium |
| T3-24 | plugin | Plugin sandbox isolation (worker_threads, no host access) | Medium |
| T3-25 | finance | Subledger GL reconciliation mismatch detection (AP/AR differs from control) | Medium |

---

## Tier 4 — Lower Value (90–180 day backlog)

| ID | Module | Test Description |
|----|--------|-----------------|
| T4-01 | payroll | NACH bank-transfer settlement date (business day skip with holiday calendar) |
| T4-02 | payroll | Supplementary run idempotency (same BONUS consumed exactly once in parallel) |
| T4-03 | hrms | Disciplinary Rule-14 witness examination sequence (full integration) |
| T4-04 | hrms | Leave concurrency (two simultaneous applications for last available day) |
| T4-05 | procurement | Tender cancellation and re-tender flow |
| T4-06 | procurement | Central debarment check integration (GeM blacklist API) |
| T4-07 | contract | Rate contract renewal with price renegotiation |
| T4-08 | contract | Contract breach penalty clause invocation |
| T4-09 | legal | Limitation clock advancement (automated date progression) |
| T4-10 | legal | Settlement lifecycle (offer → counter → agreed → GL) |
| T4-11 | visitor | Evacuation roll-call completeness (all checked-in not yet checked-out) |
| T4-12 | visitor | Anti-passback violation alert chain (tailgate → security notification) |
| T4-13 | billing | GST e-invoice NIC sandbox API contract test |
| T4-14 | report | Scheduled report delivery (cron fires, PDF sent, audit emitted) |
| T4-15 | audit | Para state machine (draft→issued→replied→settled) integration |
| T4-16 | ml | Model drift detection alert chain (ml.model.drift_detected → notification) |
| T4-17 | knowledge | AI-assisted search result relevance (Meilisearch integration) |
| T4-18 | telephony | IVR call routing (inbound → queue → agent assignment) |
| T4-19 | analytics | Fact ingestion from all 5 domain sources (finance, hrms, procurement, court, meeting) |
| T4-20 | admin | Break-glass audit trail end-to-end (open → access → close → audit record) |

---

## Summary Table

| Tier | Count | Time to implement | Status |
|------|-------|-------------------|--------|
| T1 — P0 Blockers | 7 | ≤1 week | **Must complete before any pilot** |
| T2 — High value | 13 | 2–4 weeks | **Must complete before production** |
| T3 — Medium value | 25 | 1–3 months | Complete in first production sprint |
| T4 — Lower value | 20 | 3–6 months | Backlog |
| **Total** | **65** | | |
