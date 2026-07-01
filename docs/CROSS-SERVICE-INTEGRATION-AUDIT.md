# Cross-Service Integration Audit Report

**Date:** 2025-01  
**Scope:** All 33 microservices in CivitasOne Suite  
**Methodology:** Static analysis of topics.ts, consumer.ts, queue.publish calls, HTTP client calls, and tests/ directories

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total cross-service integration flows** | 62 |
| **Flows WITH integration tests** | 24 |
| **Flows WITHOUT integration tests (gaps)** | 38 |
| **Critical gaps (financial/auth/data-loss risk)** | 11 |

---

## Integration Flows Inventory

### Category A: SQS Event-Driven Flows (Producer → Consumer via Queue)

#### A1. Finance ↔ Payroll

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 1 | payroll → finance | SQS event | `payroll.run.approved` | `{ runId, month, totalGrossMinor, totalNetMinor }` | ✅ `tests/integration/finance-chains.test.ts` |
| 2 | finance → payroll | SQS event | `finance.payment.made` | `{ payrollRunId, outcome }` | ✅ `tests/integration/payroll-chains.test.ts` |
| 3 | workflow → payroll | SQS dispatch | `payroll.run.approve` | `{ id }` (workflow terminal dispatch) | ❌ **GAP** |

#### A2. HRMS ↔ Payroll

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 4 | hrms → payroll | SQS event | `hrms.leave.approved` | `{ employeeId, daysApplied, fromDate }` | ✅ `tests/integration/payroll-chains.test.ts` |
| 5 | hrms → payroll | SQS event | `hrms.attendance.marked` | `{ employeeId, attendanceDate, status }` | ✅ `tests/integration/payroll-chains.test.ts` |
| 6 | hrms → payroll | SQS event | `hrms.employee.created` | `{ employeeId, ... }` | ❌ **GAP** |
| 7 | hrms → payroll | SQS event | `hrms.employee.separated` | `{ employeeId, effectiveDate, dateOfJoining, basicMinor }` | ✅ `tests/integration/payroll-chains.test.ts` (gratuity) |

#### A3. HRMS ↔ Estab (eOffice Decision Callbacks)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 8 | estab → hrms | SQS callback | `hrms.transfer.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **GAP** |
| 9 | estab → hrms | SQS callback | `hrms.promotion.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **GAP** |
| 10 | estab → hrms | SQS callback | `hrms.disciplinary.file_decided` | `{ fileId, refId, decision, decidedBy }` | ✅ `services/hrms-service/tests/disciplinary-rule14.test.ts` |
| 11 | hrms → workflow | SQS command | `workflow.instance.create` | `{ id, tenantId, definitionCode, refType: "leave_app", refId }` | ✅ `services/hrms-service/src/modules/leave/consumer.test.ts` |
| 12 | hrms → estab | SQS command | `estab.file.from_module` (via submitApproval topics) | `{ fileId, refType: "hr_transfer"|"hr_promotion"|"hr_disciplinary", refId }` | ❌ **GAP** (no cross-service test for the raise) |

#### A4. Finance ↔ Procurement

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 13 | procurement → finance | SQS event | `procurement.grn.accepted` | `{ grnId, poRef, vendorId, grossMinor, items[] }` | ✅ `tests/integration/cross-domain-chains.test.ts` |
| 14 | procurement → finance | SQS command | `finance.gl.post` | `{ id, tenantId, type, lines[{accountCode, debitMinor, creditMinor}] }` | ❌ **GAP** (only tested via GRN→asset→GL chain) |
| 15 | procurement → workflow | SQS command | `workflow.instance.create` | `{ id, definitionCode: "procurement_indent_approval"|"procurement_po_approval", refType, refId }` | ❌ **GAP** |
| 16 | workflow → procurement | SQS dispatch | `procurement.indent.approve` | `{ id }` | ❌ **GAP** |
| 17 | workflow → procurement | SQS dispatch | `procurement.po.approve` | `{ id }` | ❌ **GAP** |
| 18 | estab → procurement | SQS callback | `procurement.po.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **GAP** |

#### A5. Finance ↔ Procurement (HTTP)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 19 | procurement → finance | HTTP GET | `GET /v1/finance/sanctions/{id}/available` | Request: sanctionId, tenantId. Response: `{ available: string }` | ❌ **CRITICAL GAP** |

#### A6. Payroll → HRMS (HTTP)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 20 | payroll → hrms | HTTP GET | `GET /v1/hrms/internal/payroll-input?month=` | Request: tenantId, month. Response: `HrmsPayrollInput { employees[], lopDays }` | ❌ **CRITICAL GAP** |

#### A7. Finance ↔ Estab (eOffice Decision Callbacks)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 21 | estab → finance | SQS callback | `finance.sanction.file_decided` | `{ fileId, refId, decision, decidedBy }` | ✅ `services/estab-service/tests/file-approve-noting-chain.test.ts` |
| 22 | estab → finance | SQS callback | `finance.payment.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **CRITICAL GAP** |
| 23 | estab → finance | SQS callback | `finance.reappropriation.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **GAP** |

#### A8. Finance ↔ Grant

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 24 | grant → finance | SQS event | `grant.uc.submitted` | `{ ucId, applicationId, disbursementId, utilisedMinor }` | ✅ `tests/integration/finance-chains.test.ts` |
| 25 | finance → grant | SQS event | `finance.payment.made` | `{ payrollRunId?, outcome }` | ✅ `services/grant-service/tests/flows.test.ts` |
| 26 | estab → grant | SQS callback | `grant.disbursement.file_decided` | `{ fileId, refId, decision, decidedBy }` | ✅ `services/grant-service/tests/disbursement-approval.test.ts` |

#### A9. Audit ↔ Finance

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 27 | audit → finance | SQS event | `audit.para.pending_recovery` | `{ paraId, deptRef, amountInvolvedMinor }` | ✅ `tests/integration/finance-chains.test.ts` |

#### A10. Procurement → Asset / Stock

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 28 | procurement → asset | SQS event | `procurement.grn.accepted` | `{ grnId, poRef, items[].itemType="fixed_asset" }` | ✅ `tests/integration/procurement-asset-chains.test.ts` |
| 29 | procurement → stock | SQS event | `procurement.grn.accepted` | `{ grnId, poRef, items[].itemType="consumable", warehouseId }` | ✅ `tests/integration/procurement-stock-chains.test.ts` |

#### A11. Asset → Finance (GL)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 30 | asset → finance | SQS command | `finance.gl.post` (acquisition) | `{ id, type: "asset_acquisition", lines[{accountCode, debitMinor, creditMinor}] }` | ✅ `tests/integration/procurement-asset-chains.test.ts` |
| 31 | asset → finance | SQS command | `finance.gl.post` (depreciation) | `{ id, type: "depreciation", periodStart, periodEnd, lines[] }` | ✅ `tests/integration/asset-depreciation-chains.test.ts` |
| 32 | asset → finance | SQS command | `finance.gl.post` (disposal) | `{ id, type: "asset_disposal", lines[] }` | ❌ **GAP** |
| 33 | asset → finance | SQS command | `finance.gl.post` (maintenance) | `{ entryId, type: "maintenance", lines[] }` | ❌ **GAP** |
| 34 | estab → asset | SQS callback | `asset.disposal.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **GAP** |

#### A12. Workflow ↔ All (Approval Engine)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 35 | workflow → hrms | SQS dispatch | `hrms.leave.approve` | `{ id }` | ❌ **GAP** |
| 36 | workflow → estab | SQS dispatch | `estab.file.approve` | `{ fileId }` | ❌ **GAP** |
| 37 | workflow → estab | SQS dispatch | `estab.file.reject` | `{ fileId }` | ❌ **GAP** |
| 38 | workflow → estab | SQS dispatch | `estab.file.level_approved` | `{ fileId }` | ❌ **GAP** |
| 39 | workflow → asset | SQS dispatch | `asset.dispose.approve` | `{ pendingId }` | ❌ **GAP** |
| 40 | workflow → notification | SQS event | `notification.send` (SLA escalation) | `{ recipient, template, variables }` | ✅ `tests/integration/workflow-sla-chains.test.ts` |
| 41 | estab → workflow | SQS command | `workflow.instance.create` | `{ id, definitionCode: "file_noting", refType: "estab_file", refId }` | ❌ **GAP** |

#### A13. Tenant → All (Provisioning)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 42 | tenant → hrms | SQS event | `tenant.tenant.created` | `{ tenantId }` | ✅ `tests/integration/cross-domain-chains.test.ts` |
| 43 | tenant → workflow | SQS event | `tenant.tenant.created` | `{ tenantId }` | ❌ **GAP** |
| 44 | tenant → install | SQS event | `tenant.tenant.isolation_changed` | `{ tenantId, tier }` | ❌ **GAP** |

#### A14. Identity → All (Sync Feeder — 30+ topics consumed)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 45 | all → identity | SQS event | 30+ topics (see feeder.ts) | Various event payloads → changelog rows | ✅ `services/identity-service/tests/sync.protocol.test.ts` (unit-level) |

#### A15. Project → Grant

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 46 | project → grant | SQS event | `project.milestone.completed` | `{ milestoneId, projectId, name }` | ✅ `tests/integration/project-grant-chains.test.ts` |

#### A16. Citizen ↔ Estab (RTI)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 47 | citizen → estab | SQS event | `citizen.rti.filed` | `{ rtiId, applicantName, subject }` | ❌ **GAP** |
| 48 | estab → citizen | SQS event | `estab.rti.responded` | `{ rtiId, response }` | ❌ **GAP** |

#### A17. Legal → Procurement

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 49 | legal → procurement | SQS event | `legal.contract_review.cleared` | `{ reviewId, contractRef }` | ❌ **GAP** |
| 50 | estab → legal | SQS callback | `legal.opinion.file_decided` | `{ fileId, refId, decision, decidedBy }` | ❌ **GAP** |

#### A18. Notification ← All (Fan-in)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 51 | legal → notification | SQS command | `notification.send` | `{ recipient, template: "hearing_reminder", variables }` | ❌ **GAP** |
| 52 | hrms → notification | SQS command | `notification.send` | `{ recipient, type: "hrms.kudos.received" etc }` | ❌ **GAP** |
| 53 | billing → notification | SQS command | `notification.alert.send` | `{ alert: "invoice_issued", invoiceId }` | ❌ **GAP** |
| 54 | admin → notification | SQS command | `notification.alert.send` | `{ alert: "break_glass_opened", tenantId, ticketId }` | ❌ **GAP** |
| 55 | citizen → notification | SQS event | `notification.send` (SLA breach) | `{ recipient, template }` | ✅ `tests/integration/citizen-escalation-chains.test.ts` |
| 56 | helpdesk → notification | SQS event | `notification.send` (SLA sweep) | `{ recipient, template }` | ❌ **GAP** |
| 57 | audit → notification | SQS command | `notification.send` | `{ recipient, template: "observation_raised" }` | ❌ **GAP** |

#### A19. Audit ← All (Fan-in)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 58 | all → audit | SQS event | `audit.event.record` | `{ service, action, resourceType, resourceId, outcome }` | ✅ Implicitly tested in all chain tests (audit emit verified) |

#### A20. Analytics (Inbound Projections)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 59 | finance → analytics | SQS event | `finance.payment.released` | `{ ... }` | ❌ **GAP** |
| 60 | grant → analytics | SQS event | `grants.release.processed` | `{ ... }` | ❌ **GAP** |
| 61 | procurement → analytics | SQS event | `procurement.po.approved` | `{ poId, poNo, vendorId, totalMinor }` | ❌ **GAP** |

#### A21. Stock → Finance (GL)

| # | Source → Target | Mechanism | Topic/Route | Data Contract | Test? |
|---|----------------|-----------|-------------|---------------|-------|
| 62 | stock → finance | SQS command | `finance.gl.post` | `{ entryId, entryType, totalMinor, type: "stock_entry" }` | ❌ **GAP** |

---

## Gateway HTTP Routing (Contract Tests)

The gateway contract test (`tests/contract/gateway.contract.test.ts`) validates that all 33 services' routes resolve correctly through the gateway proxy — this is a route-level contract, not a data-contract test.

The `cross-process.localstack.test.ts` validates real SQS delivery between two independent queue instances (infrastructure-level, not business-logic).

---

## Critical Gaps Analysis

### P0 — Financial Data Loss / Corruption Risk

| Gap | Flow | Risk | Impact |
|-----|------|------|--------|
| **CRITICAL-1** | procurement → finance HTTP (`GET /sanctions/{id}/available`) | Budget check failure mode is untested. If finance returns malformed JSON or a stale `available` value, POs could approve over-budget. | Over-commitment of government funds |
| **CRITICAL-2** | payroll → hrms HTTP (`GET /internal/payroll-input`) | Payroll run can proceed with stale/missing employee data. `HrmsUnavailableError` path untested cross-service. | Incorrect salary computation |
| **CRITICAL-3** | finance.payment.file_decided (estab → finance) | Payment eFile approval callback untested. A lost callback = approved payment never released. | Blocked government payments |
| **CRITICAL-4** | workflow → payroll.run.approve | Workflow terminal dispatch for payroll approval untested. Wrong payload = auto-approved payroll runs. | Unauthorized payroll disbursement |
| **CRITICAL-5** | workflow → procurement dispatch (indent/PO approve) | Workflow terminal dispatch for procurement untested. | Unauthorized procurement approvals |
| **CRITICAL-6** | asset disposal GL (asset → finance.gl.post for disposal/maintenance) | Disposal GL journal untested. Incorrect debit/credit = misstated asset book values. | Financial misstatement |
| **CRITICAL-7** | stock → finance GL post | Stock entry GL hook untested. Inventory value changes not reflected in GL. | Asset/inventory mismatch in books |

### P1 — Authorization / Identity Risk

| Gap | Flow | Risk |
|-----|------|------|
| **CRITICAL-8** | hrms.transfer.file_decided | Transfer decision callback untested — an employee transfer might not complete |
| **CRITICAL-9** | hrms.promotion.file_decided | Promotion decision callback untested — promotions could stall |
| **CRITICAL-10** | tenant → workflow (provisioning) | New tenant gets no workflow definitions — all approvals would fail |
| **CRITICAL-11** | tenant → install (isolation_changed) | Silo migration for high-value tenant untested |

---

## Tested Flows Summary (24 flows with integration coverage)

| Test File | Chains Covered |
|-----------|----------------|
| `tests/integration/finance-chains.test.ts` | payroll→finance GL, grant→finance UC reconcile, audit→finance recovery |
| `tests/integration/payroll-chains.test.ts` | hrms.leave→payroll LOP, hrms.attendance→payroll LOP, hrms.separated→gratuity, finance.paid→payroll mark |
| `tests/integration/cross-domain-chains.test.ts` | procurement.grn→finance bill, tenant.created→hrms leave types |
| `tests/integration/procurement-asset-chains.test.ts` | procurement.grn→asset register + acquisition GL |
| `tests/integration/procurement-stock-chains.test.ts` | procurement.grn→stock receipt + valuation |
| `tests/integration/project-grant-chains.test.ts` | project.milestone→grant disbursement release |
| `tests/integration/asset-depreciation-chains.test.ts` | asset.dep.run→finance GL depreciation journal |
| `tests/integration/workflow-sla-chains.test.ts` | workflow SLA breach→notification + escalation + audit |
| `tests/integration/citizen-escalation-chains.test.ts` | citizen grievance SLA→notification + escalation |
| `services/hrms-service/tests/disciplinary-rule14.test.ts` | estab→hrms disciplinary decision callback |
| `services/estab-service/tests/file-approve-noting-chain.test.ts` | estab→finance sanction decision callback |
| `services/grant-service/tests/disbursement-approval.test.ts` | estab→grant disbursement decision callback |
| `services/identity-service/tests/sync.protocol.test.ts` | identity sync feeder (unit coverage) |
| `services/hrms-service/src/modules/leave/consumer.test.ts` | hrms→workflow instance create (unit) |

---

## Recommendations (Priority Order)

### Immediate (Sprint 0) — Financial Integrity

1. **Add HTTP contract test: procurement ↔ finance sanctions check** — Mock finance-service response shapes and test procurement consumer behavior for `200 OK`, `4xx/5xx`, timeout, and malformed JSON.
2. **Add HTTP contract test: payroll ↔ hrms payroll-input** — Same approach for `HrmsUnavailableError` vs genuine empty-employee responses.
3. **Add cross-service chain test: finance.payment.file_decided** — Replicate the pattern from `finance-chains.test.ts` with the eOffice callback.
4. **Add workflow dispatch chain tests: payroll.run.approve + procurement approvals** — Verify the `dispatchDomainApprove` map delivers the correct payload to downstream consumers.

### Short-term (Sprint 1-2) — Auth & Provisioning

5. **Add tenant → workflow provisioning chain test** — Verify workflow seeds default definitions on `tenant.tenant.created`.
6. **Add tenant → install isolation chain test** — Verify silo migration triggers on `tenant.tenant.isolation_changed`.
7. **Add hrms transfer/promotion file_decided chain tests** — Complete the eOffice callback coverage for HR lifecycle actions.

### Medium-term (Sprint 3-4) — Fan-out Coverage

8. **Add notification fan-in contract tests** — Verify all services publishing `notification.send` produce valid payloads.
9. **Add analytics inbound projection tests** — Verify the 3 analytics INBOUND topics are correctly shaped.
10. **Add stock → finance GL chain test** — Mirror the asset→GL pattern.

---

## Architecture Observations

1. **eOffice-SDK callback contract is well-designed** — `DECISION_CONSUMED_REF_TYPES` + `isDecisionConsumed()` fail-closed guard prevents lost decisions. Strong pattern.
2. **Audit fan-in is implicitly tested** — Every chain test asserts `audit.event.record` emission, providing broad coverage.
3. **Workflow DISPATCH map is a single point of failure** — The `dispatchDomainApprove` map in `tasks/consumer.ts` routes all terminal approvals. A mismap here silently loses an approval. Needs its own dedicated test.
4. **HTTP calls are limited to 2 internal routes** — Good discipline. Both are finance-related budget checks. Both are critical and both lack cross-service tests.
5. **Identity sync feeder subscribes to 30+ topics** — High fan-in but unit-tested only. A contract test verifying payload shape compliance across all producers would catch schema drift early.

---

*Generated by integration architecture audit. Review with service owners before sprint planning.*
