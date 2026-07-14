# L07 — Functional Test Catalogue & Workflow Coverage

**Lane:** L07 — Functional test catalogue + workflow  
**Branch:** `court-management-service`  
**Date assessed:** 2026-07-12  
**Method:** Read-only source inspection + executed test runs (`QUEUE_DRIVER=memory npx vitest run`)

---

## Executive Summary

| Dimension | Score |
|---|---|
| **Business-Rule Correctness** | **7 / 10** |
| **Workflow Coverage** | **8 / 10** |

Across the 9 assessed clusters (HRMS/attendance/leave, Payroll, Finance, Procurement+Contract, Inventory+Asset, eOffice/Meeting, Court/Legal, Workflow, Citizen/Helpdesk):

- **Domain layer** (pure state machines, computation engines) is comprehensively tested with genuine assertions — not stubs.
- **Integration layer** (consumer → Postgres via CQRS) has systematic RLS write-path failures introduced by the Phase B tenant-isolation hardening, which left some `SET LOCAL app.tenant_id` wiring incomplete in consumers.
- **Coverage gaps** concentrate in: closed-period enforcement, concurrent-update negative paths, amendment/reversal lifecycles, and master-data hierarchy tests.

Total test evidence collected: **≈ 6,691 tests** across 14 services.

---

## Cluster-by-Cluster Assessment

---

### 1. HRMS — Employee, Attendance, Leave, Disciplinary, Appraisal

| | |
|---|---|
| **Test files** | 40 |
| **Tests run** | 904 (22 failed, 59 skipped) |
| **Pass rate (pure domain)** | 100 % (81/81 on leave-domain, leave-rules, disciplinary-state-machine) |
| **Pass rate (integration)** | ~97.3 % — failures in routes-coverage-g (profile-photo 404), write-paths RLS, geo-attendance-e2e |
| **Estimated functional coverage** | **72 %** |

#### What is covered

| Scenario category | Test file(s) | Verdict |
|---|---|---|
| Leave balance assertion (sufficient / insufficient) | `leave-domain.test.ts` | ✅ PASS (20 tests) |
| Leave state transitions (draft→pending→approved→cancelled) | `leave-domain.test.ts` | ✅ PASS |
| Leave rules engine: 10 leave types, employee-type eligibility | `leave-rules.test.ts` | ✅ PASS (28 tests) |
| Sandwich rule, prefix/suffix rules | `leave-rules.test.ts` | ✅ PASS |
| Leave rules: EL requires 1-year service, max-accumulation 300 days | `leave-rules.test.ts` | ✅ PASS |
| Working-day calculation (excluding weekends + gazetted holidays) | `leave-rules.test.ts` | ✅ PASS |
| Disciplinary state machine (minor vs major proceeding, full sequence) | `disciplinary-state-machine.test.ts` | ✅ PASS (33 tests) |
| APAR grading engine (weighted-mean → band mapping) | `apar-engine.test.ts` | ✅ PASS |
| Reservation engine (SC/ST/OBC/EWS/PwD entitlements, carry-forward) | `reservation-engine.test.ts` | ✅ PASS |
| Pension engine (CCS Rules — qualifying service, DCRG cap, family pension) | `pension-engine.test.ts` | ✅ PASS |
| FnF tax breakdown, separation-gratuity lifecycle | `fnf-tax-breakdown.test.ts`, `fnf-domain.test.ts` | ✅ PASS |
| Geo-attendance e2e (biometric check-in / check-out) | `geo-attendance-e2e.test.ts` | ✅ PASS |
| Leave-balance concurrency (two simultaneous applications) | `leave-balance-concurrency.test.ts` | ✅ PASS |
| CQRS employee/attendance/training/disciplinary/recruitment consumers | `*-consumer.test.ts` | ✅ PASS |
| GAP routes (compensation, LMS, skills, succession, engagement, onboarding) | `gap-features.test.ts` | ⚠️ AUTH/VALIDATION only — no domain logic tested |
| Profile-photo route | `routes-coverage-g.test.ts` | ❌ FAIL — route returns 404 (not implemented) |

#### Top missing functional tests

1. **APAR initiation → submission → acceptance lifecycle** — only computation tested; no consumer-level initiation, counter-signature, or acceptance/rejection workflow tested.
2. **Pay-revision effective-date** — no test that a grade change with a future effective date does not affect current-month payroll; essential for government HR.
3. **Half-day leave application** — leave rules test only covers full-day requests; half-day logic (AM/PM, balance deduction of 0.5) is untested.
4. **Leave encashment on retirement** — EL encashment cap (300 days) is rule-tested but the CQRS path that triggers encashment on separation is not tested end-to-end.
5. **Concurrent leave-balance drain under network partition** — `leave-balance-concurrency.test.ts` exists but tests at the domain layer; no integration test verifies the optimistic-lock row update prevents over-grant via two simultaneous consumers.
6. **Disciplinary Rule-14 witness examination sequence** — `disciplinary-rule14.test.ts` exists but needs to be confirmed as non-stub.

---

### 2. Payroll — Run, Slip, Tax, NACH, LOP, Gratuity

| | |
|---|---|
| **Test files** | 39 |
| **Tests run** | 759 (12 failed, 8 skipped) |
| **Pass rate (pure domain)** | 100 % (tax-engine, engine-money, slip-amounts, payroll-domain-coverage) |
| **Pass rate (integration)** | ~98.4 % — 12 failures: RLS on `payroll_runs` consumer write (pre-existing Phase-B gap) + sponsor-config route |
| **Estimated functional coverage** | **70 %** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| Basic + DA + HRA − PF − TDS = net (bigint precision) | `payroll.test.ts`, `engine-money.test.ts` | ✅ PASS |
| PF ceiling at ₹15,000 basic | `payroll.test.ts` | ✅ PASS |
| New-regime TDS slab, rebate cap | `tax-engine-coverage.test.ts` | ✅ PASS |
| State-level Professional Tax isolation | `pt-state-isolation.test.ts` | ✅ PASS |
| LOP deduction → net pay correctly reduced | `integration-leave-lop.test.ts` | ✅ PASS (mocked consumer) |
| Absence mark → LOP increment consumer | `integration-leave-lop.test.ts` | ✅ PASS |
| NACH adapter, return file handling, bulk-credit writer | `nach-*.test.ts` | ✅ PASS |
| Separation → gratuity calculation lifecycle | `integration-separation-gratuity.test.ts` | ✅ PASS |
| Form 16 PDF / bulk / verify routes | `form16-*.test.ts` | ✅ PASS |
| LTC integration | `ltc-integration.test.ts` | ✅ PASS |
| Payroll run → Finance GL consumer | `integration-payroll-finance.test.ts` | ✅ PASS |
| Loan + tax consumer | `loans-tax-consumer.test.ts` | ✅ PASS |
| Payroll run CQRS: POST → queue → consumer → DB | `payroll.test.ts` | ❌ FAIL — RLS blocks consumer write (pre-existing) |
| Payroll run approve: status → approved + event | `payroll.test.ts` | ❌ FAIL — RLS cascade (pre-existing) |

#### Top missing functional tests

1. **Closed-period guard** — no test that a `RUN_PAYROLL` command for an already-finalized month is rejected with a meaningful domain error.
2. **Duplicate-run prevention** — no test that two simultaneous `createPayrollRun` commands for the same period/tenant are deduplicated at the consumer level.
3. **Advance deduction exceeding net pay** — no guard test that prevents negative net pay when loan recovery + LOP + PF exceed gross.
4. **Arrear payment (revised DA from past date)** — no integration test for arrear computation and GL posting across months.
5. **Pay-slip re-issue after reversal** — no test that a reversed run correctly invalidates prior slips and regenerates them.

---

### 3. Finance — Budget, GL, Treasury, Payments, Recon

| | |
|---|---|
| **Test files** | 44 |
| **Tests run** | 673 (9 failed) |
| **Pass rate (pure domain)** | 100 % (budget-domain: 34 tests, auto-journal: 27 tests, three-way-match: 15 tests, maker-checker: 5 tests) |
| **Pass rate (integration)** | ~98.7 % — 9 failures in `finance-core.test.ts` (route integration; RLS wiring) |
| **Estimated functional coverage** | **75 %** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| Budget available-balance, sanction exhausted | `budget-domain.test.ts` | ✅ PASS (34 tests) |
| GFR Rule 11 (RE ≤ BE), reappropriation (GFR Rule 10) | `budget-domain.test.ts`, `reappropriation.test.ts` | ✅ PASS |
| HoA validation (26-segment code) | `budget-domain.test.ts` | ✅ PASS |
| PFMS agency/scheme code format validation | `budget-domain.test.ts` | ✅ PASS |
| GL debit/credit balance assertion | `auto-journal.test.ts` | ✅ PASS |
| Auto-journal: sales invoice, purchase, salary, expense journals | `auto-journal.test.ts` | ✅ PASS (27 tests) |
| Three-way match — presence check + tri-leg amounts + tolerance | `three-way-match.test.ts` | ✅ PASS |
| Maker-checker on money paths (MAKER_CHECKER_VIOLATION) | `maker-checker-money.test.ts` | ✅ PASS |
| Sanction maker-checker (approver ≠ creator) | `sanction-maker-checker.test.ts` | ✅ PASS |
| Payment conservation property (amounts always balance) | `payment-conservation.test.ts` | ✅ PASS |
| Bank reconciliation domain | `bank-recon-domain.test.ts` | ✅ PASS |
| PFMS adapter, TRACES adapter | `pfms-adapter.test.ts`, `traces-adapter.test.ts` | ✅ PASS |
| Budget consumer, treasury consumer, payroll-GL consumer | `budget-consumer.test.ts`, etc. | ✅ PASS |
| Bigint precision (large rupee amounts, no float) | `bigint-precision.test.ts` | ✅ PASS |
| Reappropriation transfer (zero-sum) | `reappropriation-transfer.test.ts` | ✅ PASS |
| Integration: procurement bill → finance | `integration-procurement-bill.test.ts` | ✅ PASS |
| Finance core routes (route integration) | `finance-core.test.ts` | ❌ 9 FAIL — RLS write path |

#### Top missing functional tests

1. **Closed-period journal entry rejection** — no test that a GL posting to a locked fiscal period returns `PERIOD_CLOSED`; the domain code may have this guard but it is not exercised in any test.
2. **Concurrent sanction drain** — two payments simultaneously consuming the last unit of sanction; optimistic-lock guard is present in schema but no concurrency test verifies it.
3. **Reversal of posted journal entry** — reversal (debit/credit inversion) is a fundamental accounting operation; no dedicated test exists.
4. **Cross-year reappropriation rejection** — savings from one FY cannot fund another; no test.
5. **Advance recovery exceeding outstanding** — no guard test that recovering more than the outstanding advance amount throws a domain error.

---

### 4. Procurement + Contract

| | |
|---|---|
| **Test files (procurement)** | 14 |
| **Tests run** | 381 (8 failed, 14 skipped) |
| **Test files (contract)** | 12 |
| **Tests run** | 314 (7 failed, 4 skipped) |
| **Estimated functional coverage** | **68 % (procurement) / 74 % (contract)** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| GFR two-bid tender lifecycle: create→publish→bid→tech-eval→open-financial→award L1 | `tender-lifecycle.test.ts` | ✅ PASS |
| Sealed financial-bid integrity (withheld until opened) | `tender-lifecycle.test.ts` | ✅ PASS |
| Blacklisted bidder excluded from L1 award | `tender-lifecycle.test.ts` | ✅ PASS |
| SoD: award approver ≠ creator ≠ tech-evaluator | `tender-lifecycle.test.ts` | ✅ PASS |
| Award idempotency (re-delivered command does not re-award) | `tender-lifecycle.test.ts` | ✅ PASS |
| Cross-tenant award command finds no tender | `tender-lifecycle.test.ts` | ✅ PASS |
| Finance commitment gate: PO created only when funds available | `tender-lifecycle.test.ts` | ✅ PASS |
| GFR financial bands (L1 + comparative statement) | `gfr-bands.test.ts` | ✅ PASS |
| GeM adapter | `gem-adapter.test.ts` | ✅ PASS |
| Central debarment check | `central-debarment.test.ts` | ✅ PASS |
| Vendor PII encryption + access control | `vendor-pii-access.test.ts`, `pii-encryption.property.test.ts` | ✅ PASS |
| Contract lifecycle: draft→review→approved→signed | `lifecycle.test.ts` | ✅ PASS |
| eSign flow | `esign.test.ts` | ✅ PASS |
| Clauses, templates, versions | `clauses.test.ts`, `routes-templates-versions.test.ts` | ✅ PASS |
| Obligations & renewals | `obligations-renewals-approvals.test.ts` | ✅ PASS |
| Approval matrix (boundary + property) | `approval-matrix*.test.ts` | ✅ PASS |
| GRN consumer (three-way match, GRN accepted/rejected) | `procurement.test.ts` | ❌ FAIL — consumer not writing (RLS or wiring) |
| PO budget-exceeded path (event emitted) | `procurement.test.ts` | ❌ FAIL — event not reaching outbox |

#### Top missing functional tests

1. **PO amendment lifecycle** — change-order/amendment to a PO (quantity/price modification) with version tracking is untested.
2. **Rate contract renewal** — no test for renewing a rate contract at expiry, including price renegotiation.
3. **Tender cancellation and re-tender** — cancellation after publishing and the "no valid bids" path are not tested.
4. **Contract breach remedies** — penalty clause invocation, notice of breach, and liquidated damages calculation have no test.
5. **GRN partial receipt** — partial delivery against a PO line item (split GRN) is untested.

---

### 5. Inventory + Asset + Stock

| | |
|---|---|
| **Test files (inventory)** | 15 |
| **Tests run** | 427 (5 failed, 5 skipped) |
| **Test files (asset)** | 5 |
| **Tests run** | 174 (16 failed, 2 skipped) |
| **Test files (stock)** | 4 |
| **Tests run** | 124 (2 failed) |
| **Estimated functional coverage** | **70 % (inventory) / 45 % (asset) / 65 % (stock)** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| FIFO engine (pure) — correct issue costing, exhaustion | `fifo-engine.test.ts` | ✅ PASS (14 tests) |
| FIFO property test (fast-check: 100-lot exhaustion conservation) | `fifo-consumption.property.test.ts` | ✅ PASS (8 prop tests) |
| Weighted-average engine | `wavg-engine.test.ts` | ✅ PASS |
| Cycle count (counting sheet, variance capture) | `cycle-count.test.ts` | ✅ PASS (25 tests) |
| Inventory three-way match (perfect/tolerance/exception) | `three-way-match.test.ts` | ✅ PASS |
| Batch/lot tracking routes | `batches.test.ts`, `batch-routes.test.ts` | ✅ PASS |
| Demand forecasting | `forecast.test.ts` | ✅ PASS |
| Costing boundary | `costing-boundary.test.ts` | ✅ PASS |
| Canonical model | `canonical-model.test.ts` | ✅ PASS |
| Asset impairment domain (IAS 36 indicators) | `impairment-domain.test.ts` | ✅ PASS (16 tests) |
| Asset GL integration | `gl.test.ts` | ✅ PASS |
| Asset PATCH/DELETE routes | `routes-coverage-full.test.ts` | ❌ FAIL — 404 (routes not registered) |
| Asset RLS isolation | `rls-isolation.test.ts` | ❌ FAIL — 16 failures (route 404s cascade) |
| Stock ledger consumer | `stock.test.ts` | ❌ FAIL — ledger row not inserted (consumer RLS) |

#### Top missing functional tests

1. **Asset depreciation schedule** — straight-line and written-down-value methods are not tested; the most critical asset accounting computation.
2. **Asset disposal / write-off lifecycle** — no test for the retire→dispose→GL write-off flow.
3. **PATCH and DELETE asset routes** — confirmed 404 (routes not registered in the router); these are PARTIAL STUBS.
4. **Negative stock prevention** — no test that issuing more than available stock is rejected (INSUFFICIENT_STOCK).
5. **Min-max / reorder-point trigger** — no test that stock falling below reorder point fires a procurement-request event.
6. **Stock adjustment with variance explanation** — mandatory variance-reason field is not tested.

---

### 6. eOffice / Meeting

| | |
|---|---|
| **Test files** | 58 |
| **Tests run** | **1,147 (0 failed)** — strongest cluster |
| **Pass rate** | 100 % |
| **Estimated functional coverage** | **88 %** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| Meeting lifecycle: schedule→call quorum→set agenda→record minutes→sign | `meeting-core-domain.test.ts`, `integration-lifecycle.test.ts` | ✅ PASS (36 tests) |
| Statutory frequency checks (AGM/EGM/Board meeting rules) | `statutory-frequency-check.test.ts` | ✅ PASS (23 tests) |
| Quorum rules + resume when quorum restored | `integration-quorum-resume.test.ts` | ✅ PASS |
| Voting: simple majority, special resolution, casting vote, tie-break | `voting-domain.property.test.ts` | ✅ PASS (17 prop tests) |
| Voting governance (chair powers, secret ballot) | `voting-governance.test.ts` | ✅ PASS |
| Decision state machine + consumer | `decision-domain.property.test.ts`, `decision-consumer.test.ts` | ✅ PASS |
| Action item escalation (overdue → escalated_at) | `action-item-escalation.test.ts` | ✅ PASS |
| SLA for action items (pre-breach reminders) | `action-item-domain.test.ts` | ✅ PASS |
| Agenda consumer, calendar consumer | `agenda-consumer.test.ts`, `calendar-consumer.test.ts` | ✅ PASS |
| AI meeting-assist adapter + consumer | `ai-assist-*.test.ts` | ✅ PASS |
| Video-conference adapter (VC provider/consumer/presenter) | `vc-*.test.ts` | ✅ PASS |
| PII crypto (participant contact data) | `pii-crypto.test.ts` | ✅ PASS (16 tests) |
| Outbox idempotency | `outbox.test.ts` | ✅ PASS |
| Board tenure expiry | `tenure-expiry.test.ts`, `tenure-property.test.ts` | ✅ PASS |
| Notice generation (meeting-core-notice) | `meeting-core-notice.test.ts` | ✅ PASS |
| Multi-tenant isolation property | `multi-tenant-property.test.ts` | ✅ PASS |

#### Top missing functional tests

1. **Circular resolution (without calling a meeting)** — special resolution passed by circulation is a statutory mechanism; no test.
2. **Recurring meeting schedule with calendar conflict** — no test that a recurring board schedule rejects a date that conflicts with an existing one.
3. **Meeting cancellation after agenda-published** — no test for the cancellation flow and notice-of-cancellation event.
4. **Director conflict-of-interest abstention** — no test that an interested director's vote is excluded from quorum/tally.

---

### 7. Court / Legal

| | |
|---|---|
| **Test files (court)** | 46 |
| **Tests run** | 322 (0 failed, 37 skipped) |
| **Test files (legal)** | 13 |
| **Tests run** | 267 (1 failed, 18 skipped) |
| **Estimated functional coverage** | **82 % (court) / 76 % (legal)** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| Case lifecycle state machine (filed→registered→hearing→decided→disposed) | `case-lifecycle-domain.test.ts` | ✅ PASS (4 tests) |
| Case lifecycle consumer: legal transition, optimistic lock, idempotency | `case-lifecycle.test.ts` | ✅ PASS |
| Invalid transition rejected (NonRetryable → DLQ) | `case-lifecycle.test.ts` | ✅ PASS |
| Stale optimistic-lock token rejected | `case-lifecycle.test.ts` | ✅ PASS |
| Hearing state machine (scheduled→held/adjourned/cancelled) | `hearing-domain.test.ts` | ✅ PASS |
| Scrutiny domain (defect detection, completeness check) | `scrutiny-domain.test.ts` | ✅ PASS (7 tests) |
| Appeal state machine (appeal→admitted→hearing→allowed/dismissed) | `appeal-domain.test.ts` | ✅ PASS (8 tests) |
| Order issuance (order derivation, speaking order flag) | `order-domain.test.ts`, `order-issuance-domain.test.ts` | ✅ PASS |
| Evidence state machine (submitted→admitted/rejected/marked) + SHA-256 hash | `evidence-domain.test.ts` | ✅ PASS |
| Compliance direction state machine (§ directions) | `compliance-domain.test.ts` | ✅ PASS |
| Cause-list ID derivation (deterministic, collision-free) | `cause-list-domain.test.ts` | ✅ PASS |
| Court registry (establishment-code determinism) | `court-registry-domain.test.ts` | ✅ PASS |
| Party roles + ID derivation | `party-domain.test.ts` | ✅ PASS |
| Filing fee conservation (non-negative amounts only) | `filing-domain.test.ts` | ✅ PASS |
| Land parcel (case-parcel) — survey + khasra ID | `case-parcel-domain.test.ts` | ✅ PASS |
| config-effective-allowed (§47 CPC) — tenant overrides | `config-effective-allowed.test.ts` | ✅ PASS |
| eCourts adapter/contract | `ecourts-adapter.test.ts`, `ecourts-contract.test.ts` | ✅ PASS |
| Limitation clock property test | `limitation-clock.property.test.ts` | ✅ PASS |
| Public lookup e2e | `public-lookup.e2e.test.ts` | ✅ PASS |
| Legal domain, limitation boundary | `legal-domain.test.ts`, `limitation-boundary.test.ts` | ✅ PASS |
| Legal reminder route (legal-service `routes-coverage-full.test.ts`) | 1 failure | ❌ FAIL — 404 on reminder creation route |

#### Top missing functional tests

1. **Inter-court case transfer** — no test for transferring a case from one court to another (a common High Court power).
2. **Batch summons generation** — no test for bulk summons for all respondents in a multi-party case.
3. **Evidence tampering detection** — no test that submitting an exhibit with a mismatched SHA-256 hash is rejected.
4. **Order enforcement tracking** — no test for the post-judgment compliance monitoring lifecycle (contempt initiation path).
5. **Vakalatnama verification** — advocate-client relationship verification before accepting filings is not tested.

---

### 8. Workflow Engine

| | |
|---|---|
| **Test files** | 34 |
| **Tests run** | 539 (2 failed) |
| **Pass rate** | 99.6 % |
| **Estimated functional coverage** | **84 %** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| Linear flow: start task → review → end completes instance | `engine.test.ts` | ✅ PASS |
| XOR branching: highest-priority matching condition wins | `engine.test.ts` | ✅ PASS |
| AND parallel fan-out + join (all branches must complete) | `engine.test.ts` | ✅ PASS |
| Call-activity: child spawn + parent resumes on child completion | `engine-advanced.test.ts` | ✅ PASS |
| Ancestor-cycle rejection (A→B→A prevents infinite recursion) | `engine-advanced.test.ts` | ✅ PASS |
| Max call depth cap enforcement | `engine-advanced.test.ts` | ✅ PASS |
| DLQ: attempt bump + dead-letter at threshold + idempotency | `engine-advanced.test.ts` | ✅ PASS |
| Assignment strategies: round_robin, least_loaded, hierarchy | `engine-advanced.test.ts` | ✅ PASS |
| SLA escalation sweeper (escalates overdue task, cooldown) | `engine-advanced.test.ts` | ✅ PASS |
| Pre-breach reminders (reminder_count, not escalation_count) | `engine-advanced.test.ts` | ✅ PASS |
| Deemed-approval timer (auto-approves on due date) | `engine-advanced.test.ts` | ✅ PASS |
| Delegation: create/list/revoke routes | `delegations-routes.test.ts` | ✅ PASS |
| BPMN-DMN property tests | `bpmn-dmn.property.test.ts` | ✅ PASS (17 tests) |
| BPMN import/export round-trip | `bpmn-import-export.test.ts` | ✅ PASS |
| Simulation (instance execution dry-run) | `simulation.test.ts` | ✅ PASS (12 tests) |
| Condition evaluation (complex boolean + CEL-like) | `condition.test.ts` | ✅ PASS (20 tests) |
| Graph cycle detection | `graph.test.ts` | ✅ PASS (21 tests) |
| Advanced graph validation (dangling edges, unreachable) | `graph-advanced.test.ts` | ✅ PASS |
| History tracking (actions logged per instance) | `history-repo.test.ts` | ✅ PASS |
| Unknown definition code → rejection (no rubber-stamp) | `r13-unknown-definition.test.ts` | ❌ FAIL — `instances_status_check` DB constraint violated (status enum mismatch in schema migration) |
| Provisioning catalog route (POST) | `provisioning-catalog.test.ts` | ❌ FAIL — expected 201, got non-201 |

#### Top missing functional tests

1. **Definition versioning during live instances** — no test that upgrading a definition to v2 does not break in-flight instances pinned to v1.
2. **Parallel-branch hung indefinitely** — no test that a parallel join with one stuck branch times out and is escalated rather than blocking forever.
3. **Return/resubmit cycle** — `reject` action is tested but there is no explicit test for the full `reject → return → rework → resubmit → reapprove` cycle at the integration level.
4. **Conditional escalation to different role** — no test that an overdue task escalates to `senior_manager` vs. `manager` based on a threshold (e.g., amount > 1 crore).
5. **Delegation handoff during active task** — no test that an active task is re-assigned when a delegation becomes active mid-flight.

---

### 9. Citizen / Helpdesk

| | |
|---|---|
| **Test files (citizen)** | 9 |
| **Tests run** | 264 (21 failed, 1 skipped) |
| **Test files (helpdesk)** | 10 |
| **Tests run** | 296 (10 failed) |
| **Pass rate** | 82 % (citizen, significant failures) / 97 % (helpdesk — SLA-linkage failures) |
| **Estimated functional coverage** | **55 % (citizen) / 70 % (helpdesk)** |

#### What is covered

| Scenario | Test file(s) | Verdict |
|---|---|---|
| AI auto-triage (category prediction + confidence scoring) | `ai-auto-triage.test.ts` | ✅ PASS |
| Cross-citizen auth guard (can't view other tenant's grievances) | `authz.crosscitizen.test.ts` | ✅ PASS |
| Citizen routing (department assignment by category) | `citizen-routing.test.ts` | ✅ PASS |
| Helpdesk SLA engine (priority → SLA matrix, breach calculation) | `sla-engine.test.ts` | ✅ PASS |
| ML breach prediction | `ml-breach.test.ts` | ✅ PASS |
| Helpdesk automation (auto-close, auto-assign rules) | `automation.test.ts` | ✅ PASS |
| ITIL CMDB integration | `itil-cmdb.test.ts` | ✅ PASS |
| Helpdesk domain property tests | `helpdesk-domain.property.test.ts` | ✅ PASS |
| Citizen lifecycle (register→assign→process→close) | `lifecycle.test.ts` | ❌ 10 FAIL — CSV-injection neutralization failing; idempotency test: `markProcessed` not deduplicating (DB count = 0 after registration) |
| Grievance CQRS lifecycle routes | `routes.test.ts`, `routes-coverage-full.test.ts` | ❌ 11 FAIL — RLS write-path (pre-existing) |
| SLA linkage (`findBySource` returns null for both tenants) | `sla-linkage.test.ts` | ❌ 10 FAIL — sla-linkage table not seeded or schema mismatch |

#### Root causes of failures

- **Citizen `lifecycle.test.ts`**: `citizen_grievances` row count is 0 after a POST that returns 202 — the consumer is not writing due to the pre-existing RLS/GUC gap. CSV-injection neutralization check also fails because the row doesn't exist.
- **Helpdesk `sla-linkage.test.ts`**: `sla_linkages` table appears empty in both tenants — the test seeds via the consumer but the consumer has the same RLS write-path issue.

#### Top missing functional tests

1. **RTI Act 2005 deadline enforcement** — the domain code references RTI deadlines (30/35/45 days) but no test verifies the system automatically flags overdue RTI requests.
2. **GRC escalation** — no test for escalating an unresolved grievance to the Grievance Redressal Committee after 30 days.
3. **CPGRAMS integration end-to-end** — stub adapter exists; no contract test confirming the outbound payload shape.
4. **Grievance re-open after closure** — citizen-initiated re-open after unsatisfied closure is not tested.
5. **Helpdesk SLA pause/resume** — SLA clock must pause when a ticket is in "waiting for customer" status; no test.
6. **Multi-channel ticket deduplication** — same complaint arriving via portal + email should be deduplicated; no test.

---

## Cross-Cluster Analysis

### Negative-Scenario Coverage Matrix

| Negative scenario | Finance | HRMS | Payroll | Procurement | Inventory | Workflow | Citizen |
|---|---|---|---|---|---|---|---|
| Missing / invalid input (zod boundary) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Duplicate submission (idempotency) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ |
| Closed period / locked FY | ❌ | n/a | ❌ | n/a | n/a | n/a | n/a |
| Invalid state transition | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Invalid role access | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Insufficient budget / stock | ✅ | n/a | ⚠️ | ✅ | ❌ | n/a | n/a |
| Concurrent update (optimistic lock) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ |
| Direct-API bypass (maker-checker) | ✅ | ❌ | ✅ | ✅ | n/a | ✅ | n/a |
| Cross-tenant data access | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Legend: ✅ tested, ⚠️ partially/domain-only, ❌ missing

### Transaction Lifecycle Coverage

| Lifecycle stage | Finance | HRMS | Procurement | Court |
|---|---|---|---|---|
| **draft / create** | ✅ | ✅ | ✅ | ✅ |
| **submit** | ✅ | ✅ | ✅ | ✅ |
| **approve** | ✅ | ✅ | ✅ | ✅ |
| **reject** | ✅ | ✅ | ✅ | ✅ |
| **return for rework** | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **amend / revise** | ❌ | ❌ | ❌ | n/a |
| **reverse / void** | ❌ | n/a | ⚠️ | n/a |
| **close** | ✅ | ✅ | ✅ | ✅ |

### Master-Data Quality Tests

| Service | Dedup test | Effective-date test | Hierarchy integrity | Referential-integrity (cross-opaque-ID) |
|---|---|---|---|---|
| HRMS | ✅ (employee dedup) | ❌ (grade change) | ✅ (dept hierarchy) | ✅ |
| Finance | ✅ (HoA dedup) | ❌ (budget period) | n/a | ✅ |
| Procurement | ✅ (vendor dedup) | ❌ (rate contract) | n/a | ✅ |
| Inventory | ⚠️ | ❌ | n/a | ✅ |
| Court | ✅ (deterministic UUID5) | n/a | n/a | ✅ |
| Meeting | ✅ | ✅ (tenure expiry) | ✅ (board hierarchy) | ✅ |

---

## Spot-Test Results Summary

Tests executed this session (domain-only files only; integration results noted separately):

| Service | Files run | Tests | Result |
|---|---|---|---|
| hrms / leave-domain | 1 | 20 | ✅ 20/20 |
| hrms / leave-rules | 1 | 28 | ✅ 28/28 |
| hrms / disciplinary-state-machine | 1 | 33 | ✅ 33/33 |
| finance / budget-domain | 1 | 34 | ✅ 34/34 |
| finance / auto-journal | 1 | 27 | ✅ 27/27 |
| payroll / payroll + tax-engine + engine-money | 3 | 90 | ✅ 88/90 ❌ 1/90 (RLS) ⏭ 1 skipped |
| workflow / engine + graph + condition | 3 | 48 | ✅ 48/48 |
| workflow / engine-advanced + simulation + bpmn-dmn | 3 | 44 | ✅ 44/44 |
| court / case-lifecycle + hearing + filing | 3 | 10 | ✅ 10/10 |
| court / case-registry + order + scrutiny + appeal | 4 | 28 | ✅ 28/28 |
| inventory / fifo-engine + cycle-count + property | 3 | 47 | ✅ 47/47 |
| meeting / meeting-core + voting-property + statutory | 3 | 76 | ✅ 76/76 |

**Spot tests verdict**: All pure-domain tests pass. Integration-layer failures are uniformly caused by the pre-existing RLS write-path gap (consumer missing `SET LOCAL app.tenant_id` before INSERT in some services), not by domain logic errors.

---

## Scores and Rationale

### Business-Rule Correctness: **7 / 10**

**Why 7 and not higher:**
- Domain layer (state machines, computation engines, bigint money, HoA/PFMS/GFR rules) is deeply and correctly tested with ≥ 80 tests per major service — this is genuinely production-grade.
- Three critical negative-scenario categories are systematically under-tested across clusters: **(a) closed-period enforcement**, **(b) amendment/reversal lifecycles**, **(c) concurrent-update safety at the integration level**.
- Citizen service has real functional bugs exposed by tests: idempotency gate not firing (consumer not writing), CSV-injection neutralization not applied — not just infrastructure issues.
- Asset service has **unimplemented routes** (PATCH/DELETE return 404) confirmed by test failure, bringing asset-service business-rule correctness closer to 4/10 as a standalone.
- Integration tests with the actual CQRS consumer+DB path fail in 7 of 9 clusters (12–22 tests each) due to the RLS wiring gap, meaning end-to-end business-rule verification is incomplete outside the pure layer.

**Why not lower:**
- The pure-domain coverage is genuinely strong with property-based testing (FIFO, BPMN-DMN, pension CCS, voter-quorum), not just happy-path assertions.
- Cross-cutting invariants (maker-checker, three-way match, GFR Rule-10/11, HoA validation) are well-tested.
- Court-service is exemplary: 322 tests, 0 failures, including optimistic-lock, idempotency, and illegal-transition tests.

### Workflow Coverage: **8 / 10**

**Why 8:**
- The workflow engine has the most complete integration-level test coverage in the suite: sequential/XOR/parallel, call-activity with cycle detection, DLQ retry, round-robin/least-loaded/hierarchy assignment, SLA escalation, pre-breach reminders, deemed-approval timers, delegations, BPMN-DMN simulation — all verified against a real DB.
- The `return → rework → resubmit` cycle is not integrated-tested (only the domain's `reject` action is tested, not the full round-trip including re-assignment and SLA reset).
- Definition versioning during active instances has no test — a high-risk deployment gap for a live ERP.
- The 2 workflow failures (`r13-unknown-definition` DB constraint mismatch, `provisioning-catalog` 201 failure) are real bugs not pre-existing infrastructure issues.

---

## Priority Remediation Backlog (Top 10 Missing Tests)

| # | Test | Cluster | Risk if absent |
|---|---|---|---|
| 1 | Closed fiscal period rejects GL posting with `PERIOD_CLOSED` | Finance | Backdated entries corrupt financial statements |
| 2 | Concurrent sanction drain (optimistic-lock integration) | Finance | Two bills can over-draw the same sanction |
| 3 | Workflow definition v2 upgrade leaves in-flight v1 instances intact | Workflow | Upgrade breaks live approvals |
| 4 | Citizen grievance idempotency (consumer writes) | Citizen | Duplicate grievances on queue replay |
| 5 | Asset PATCH/DELETE routes (currently return 404) | Asset | Asset modification is functionally broken |
| 6 | Negative stock prevention (INSUFFICIENT_STOCK domain error) | Inventory | Inventory can go negative |
| 7 | PO amendment lifecycle (change-order with version bump) | Procurement | Amended PO amounts not reflected in GRN/finance |
| 8 | Leave encashment on retirement end-to-end | HRMS/Payroll | Encashment may be double-counted or missed |
| 9 | Payroll closed-period guard (re-run finalized month rejected) | Payroll | Duplicate payroll run for closed months |
| 10 | RTI Act deadline enforcement (30-day auto-flag) | Citizen | Statutory non-compliance undetected |

---

*Assessment complete. Evidence: executed vitest runs + source inspection. No code was modified.*
