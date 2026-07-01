# CivitasOne — Deep Integration Test Gap Report

**Date:** 2026-07-01
**Scope:** All 33 services, 12 shared packages, cross-service event chains
**Method:** Code inspection + existing test execution (21 integration test files, 123 tests)

---

## 1. Executive Summary

**Integration Readiness Score: 72/100** (Acceptable but risky for large scale)

The platform has a **strong foundation** — 21 cross-service integration tests covering the critical event chains (finance↔payroll, procurement→finance, citizen↔estab, workflow dispatch). However, significant gaps exist in org-structure validation, cache/failure testing, and the newly-added ERP hierarchy layer.

| Area | Score | Verdict |
|------|-------|---------|
| Module-to-module event chains | 78/100 | Good — 19/21 integration files pass |
| API contract coverage | 65/100 | Weak — only gateway/screens contracts exist |
| Database consistency | 70/100 | Per-service tests strong; cross-DB consistency untested |
| Cache integration | 55/100 | Only circuit-breaker tested; no invalidation tests |
| Queue/event processing | 82/100 | Strong — harness-based chain tests cover critical flows |
| Auth/authz cross-module | 60/100 | Each service tests own auth; cross-service token propagation untested |
| Failure/resilience | 68/100 | failure-paths.test.ts exists but covers only 3 scenarios |
| New org-structure layer | 35/100 | Only 8 finance-internal tests; no cross-service org validation |
| CI/CD integration | 75/100 | CI runs unit+contract; integration suite exists but not blocking |

---

## 2. Critical Integration Flows — Coverage Status

| # | Flow | Services | Existing Test | Gap |
|---|------|----------|:---:|-----|
| 1 | **Payroll→Finance GL posting** | payroll→finance | ✅ `finance-chains.test.ts` | — |
| 2 | **GRN→Vendor bill→GL** | procurement→finance | ❌ FAILING | `cross-domain-chains.test.ts` line 1 — payload schema mismatch |
| 3 | **Citizen RTI→eOffice** | citizen→estab | ✅ `citizen-escalation-chains.test.ts` | — |
| 4 | **eOffice file decision callbacks** | estab→finance/hrms/procurement/grant | ⚠️ Partial | Only finance sanction tested; hr_transfer/promotion/disciplinary untested |
| 5 | **Workflow dispatch→estab approval** | workflow→estab | ✅ `workflow-sla-chains.test.ts` | — |
| 6 | **Project milestone→grant disbursement** | project→grant | ✅ `project-grant-chains.test.ts` | — |
| 7 | **Leave/attendance→payroll LOP** | hrms→payroll | ✅ `payroll-chains.test.ts` | — |
| 8 | **PO budget check (HTTP)** | procurement→finance | ✅ `circuit-breaker.test.ts` | — |
| 9 | **Tenant onboard→HRMS leave types** | tenant→hrms | ✅ `cross-domain-chains.test.ts` | — |
| 10 | **Employee→Legal Entity→Payroll GL** | hrms→finance | ❌ MISSING | NEW: employee.legalEntityId flows to payroll journal |
| 11 | **Org-structure validation (cost center LE mismatch)** | finance internal | ✅ `org-structure.test.ts` | Only unit-level; no cross-service test |
| 12 | **Department hierarchy enforcement** | hrms | ❌ MISSING | No test for POST /v1/hrms/departments level validation |
| 13 | **Legal entity on vouchers** | finance | ⚠️ Partial | `org-structure.test.ts` tests domain; no GL posting test with LE |
| 14 | **Procurement EMD/PBG→Treasury** | procurement→finance | ❌ MISSING | EMD collect/forfeit/refund not integration-tested |
| 15 | **Grant UC→Finance reconciliation** | grant→finance | ✅ `finance-chains.test.ts` | — |

---

## 3. Missing Integration Tests — Prioritized Violations

| ID | Module | Integration Point | Severity | Risk | Recommended Test |
|---|---|---|:---:|---|---|
| V1 | **finance↔hrms** | Employee legalEntityId propagation to salary journal | **Critical** | Wrong company books | Test: payroll run with employee having legalEntityId → journal has matching legal_entity_id |
| V2 | **procurement→finance** | GRN→bill chain (currently FAILING) | **Critical** | Vendor payments blocked | Fix payload schema in cross-domain-chains.test.ts |
| V3 | **estab→hrms** | Transfer/promotion/disciplinary decision callbacks | **High** | HR decisions silently lost | Test: file approved → callback reaches hrms → transfer/promotion applied |
| V4 | **finance** | GL journal with mismatched LE/CC rejects | **High** | Funds posted to wrong entity | Test: postJournal with CC belonging to different LE → throws |
| V5 | **hrms** | Department hierarchy level enforcement | **High** | Invalid org tree creation | Test: POST section under ministry (level violation) → 400 |
| V6 | **procurement→finance** | EMD/PBG collect→treasury deposit | **Medium** | EMD accounting gap | Test: emd.collect → finance challan/deposit created |
| V7 | **all services** | Cache invalidation after org-structure change | **Medium** | Stale dept names | Test: update department → dependent service caches refreshed |
| V8 | **payroll→hrms** | HRMS unavailable during payroll-input fetch | **Medium** | Silent empty payrun | Test: HRMS down → payroll run fails with HRMS_UNAVAILABLE |
| V9 | **estab** | eOffice SDK source_ref_type not in DECISION_CONSUMED_REF_TYPES | **Medium** | File raised but decision lost | Test: raise file with unsupported type → rejected (R21) |
| V10 | **workflow** | Fork-bomb cycle detection in call-activities | **Medium** | Infinite loop | Test: A calls B calls A → rejected at MAX_CALL_DEPTH |
| V11 | **all services** | Cross-service auth token propagation (x-internal / x-service-secret) | **High** | Unauthorized access or false rejections | Test: internal service call with valid/invalid secrets |
| V12 | **finance** | Period-close blocks journal posting across services | **Medium** | Post-close data corruption | Test: payroll.run.approved on hard-closed period → rejected |
| V13 | **grant→estab** | Disbursement submit approval → eFile → decision callback | **High** | Disbursement approval stuck | Test: end-to-end grant disbursement approval chain |
| V14 | **legal→procurement** | contract_review.cleared unblocks PO | **Medium** | PO stuck waiting legal | Test: publish legal.contract_review.cleared → PO consumer unblocks |
| V15 | **tenant onboard** | New tenant → workflow definitions provisioned | **Low** | Missing workflow templates | Test: tenant.created → workflow provisions default defs |

---

## 4. Newly-Added ERP Org Structure — Untested Cross-Service Flows

The recent org-structure additions (Legal Entity, Cost Center, Profit Center, Operating Unit, dept hierarchy) have **zero cross-service integration tests**:

| Flow | Expected Behavior | Test Status |
|------|-------------------|:-----------:|
| Employee with `legal_entity_id` → payroll run → salary journal has `legal_entity_id` | Salary posts to correct company books | ❌ UNTESTED |
| Employee with `cost_center_id` → salary journal has `cost_center_id` | Salary cost-allocated correctly | ❌ UNTESTED |
| PO with `legal_entity_id` → GRN → vendor bill → GL has `legal_entity_id` | Purchase costs on correct entity | ❌ UNTESTED |
| Department with `type=section, level=4` cannot parent `type=ministry, level=0` | Hierarchy enforcement | ❌ UNTESTED (only route-level, no integration) |
| Change employee's `cost_center_id` → next payroll uses new CC | Dynamic cost allocation | ❌ UNTESTED |

---

## 5. What's Working Well (Do Not Regress)

- ✅ `finance-chains.test.ts` — payroll→GL, grant UC, audit recovery (3 critical chains)
- ✅ `payroll-chains.test.ts` — leave→LOP, attendance→LOP, separation→gratuity, payment→paid (4 chains)
- ✅ `workflow-sla-chains.test.ts` — SLA breach, deemed approval, escalation
- ✅ `citizen-escalation-chains.test.ts` — RTI filing end-to-end
- ✅ `project-grant-chains.test.ts` — milestone→disbursement
- ✅ `circuit-breaker.test.ts` — procurement→finance HTTP resilience
- ✅ `concurrent-writes.test.ts` — duplicate event handling, idempotency
- ✅ `failure-paths.test.ts` — DB failure, queue failure, partial failure (3 scenarios)
- ✅ Per-service test suites — 1,750+ tests across 32 services, all green

---

## 6. CI/CD Integration Status

| Check | Status |
|-------|--------|
| Integration tests run on every PR? | ⚠️ Defined in ci.yml but `test:integration` is separate from `test` |
| Critical integration tests blocking merge? | ❌ Not blocking (only unit tests block) |
| Integration tests in CI use real DB? | ✅ Docker Compose (Postgres, Redis, LocalStack) |
| Test failures easy to debug? | ✅ Vitest output + structured logs |
| Flaky test detection? | ⚠️ No retry/quarantine mechanism |
| Contract tests in CI? | ⚠️ 2 contract files exist but not on critical path |

---

## 7. Recommendations — Priority Order

1. **Fix V2** (GRN→bill chain, currently FAILING) — likely a payload field rename from recent schema changes
2. **Add V1** (employee legal entity → payroll → GL) — validates the new ERP org structure actually flows
3. **Add V3** (eOffice decision callbacks for HR) — 3 untested critical paths (transfer/promotion/disciplinary)
4. **Add V4** (LE/CC mismatch in GL posting context) — validates enforcement actually blocks bad data
5. **Add V11** (cross-service auth) — validates x-internal / x-service-secret propagation works
6. **Make integration tests merge-blocking in CI** — upgrade from "run separately" to "gate PRs"

---

## 8. Integration Readiness Score Breakdown

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| Module coverage (33 services) | 70 | 21 integration files cover ~15 services; 18 services have no cross-service test |
| Critical journey coverage | 80 | 7/10 critical journeys tested |
| API integration coverage | 65 | Only internal HTTP calls tested (procurement→finance); no public API contract suite |
| Database integration coverage | 75 | Each service tests own DB; no cross-DB consistency checks |
| Cache integration coverage | 55 | Only circuit-breaker; no invalidation/stale-data tests |
| Queue/event integration coverage | 82 | Strong harness pattern; 19 chain files |
| Admin integration coverage | 40 | No admin flow integration tests |
| Security/authorization coverage | 60 | Per-service auth tested; cross-service propagation untested |
| Failure-path coverage | 68 | 3 failure scenarios tested; missing: DB fail during GL, queue dead-letter, cache fail |
| CI/CD integration | 70 | Integration tests exist but don't block merge |
| Test isolation and reliability | 85 | Harness pattern is excellent; 1 flaky test identified (grant UC gate) |
| **Overall Integration Readiness** | **72** | **Acceptable but risky for large scale** |

---

## 9. Files Changed / Implemented

No files modified in this audit. This is a gap report only.

---

## 10. How to Run the Integration Tests

```bash
# Run all integration tests (requires docker compose up)
npx vitest run tests/integration/

# Run specific chain
npx vitest run tests/integration/finance-chains.test.ts

# Run contract tests
npx vitest run tests/contract/

# Run all per-service tests
pnpm test
```

---

## 11. Remaining Risks

1. **The 1 failing integration test (GRN→bill)** means the procurement→finance accounting chain is actually broken in CI right now
2. **No org-structure cross-service tests** means the entire Legal Entity/Cost Center layer could silently fail to propagate
3. **18 services have zero cross-service integration tests** — if they break compatibility, nothing catches it until production
4. **Decision callbacks for HR transfers/promotions** are documented in eoffice-sdk but never integration-tested — a silent decision loss would leave employees in limbo
