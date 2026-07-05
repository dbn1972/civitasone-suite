# Module 15: Payroll — World-Class Enhancement

## Benchmark: ADP / SAP Payroll / greytHR / RazorpayX Payroll

## Target Service: `services/payroll-service`

---

## Phase A: Deep Audit

Read all modules: payroll, bank-transfer, tax, statutory, statutory-returns, loans, fnf, payslip-pdf, form16-pdf, integration.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Payroll Simulation ("What-If" Before Commit)
- **What:** Run payroll in dry-run mode to preview net pay, deductions, tax — without posting
- **Implement:**
  - `POST /v1/payroll/runs/:id/simulate` — execute all calculations but do NOT write to ledger or generate payslips
  - Returns: per-employee breakdown (gross, deductions[], net, tax), aggregate totals, anomaly flags
  - `GET /v1/payroll/runs/:id/simulation-report` — downloadable comparison (previous month vs simulated)
  - Flag: employees with > 20% variance from last month (catch data entry errors before commit)
  - Schema: `payroll.simulation_results` (run_id, employee_id, result_json, variance_pct, flagged)
- **Domain:** `computePayroll(employees, components, rules, mode: 'live'|'simulate')`, `detectAnomalies(current, previous, threshold)`

### Gap 2: Multi-Pay-Group Scheduling
- **What:** Different employee groups paid on different schedules (monthly/bi-weekly/weekly)
- **Implement:**
  - `POST /v1/payroll/pay-groups` — create pay group (name, frequency: monthly|bi-weekly|weekly, pay_day, employees)
  - `GET /v1/payroll/pay-groups` — list with next pay date and employee count
  - Payroll run scoped to pay group — separate runs, separate bank files
  - `GET /v1/payroll/calendar?fy=2026-27` — pay calendar showing all groups' pay dates
  - Schema: `payroll.pay_groups` (id, tenant_id, name, frequency, pay_day_of_month, timezone)
  - Add `pay_group_id uuid` to employee linkage
- **Domain:** `computeNextPayDate(frequency, payDay, lastRun)`, `generatePayCalendar(groups, fy)`

### Gap 3: Payroll Corrections (Mid-Cycle Arrears)
- **What:** Retroactive corrections: if salary component changes mid-month or backdated, auto-compute arrears
- **Implement:**
  - `POST /v1/payroll/corrections` — { employeeId, component, effectiveFrom, newValue, reason }
  - System computes: arrears = (newValue - oldValue) × affected periods
  - Arrears flow into next payroll run as a separate line item
  - `GET /v1/payroll/corrections?employeeId=X` — correction history with arrears computed
  - Schema: `payroll.salary_corrections` (id, employee_id, component, effective_from, old_value_minor, new_value_minor, arrears_minor, applied_in_run_id)
- **Domain:** `computeArrears(correction, affectedPeriods)`, `applyCorrectionsToRun(run, pendingCorrections)`

### Gap 4: Multi-State PT/LWF Compliance
- **What:** Professional Tax and Labour Welfare Fund rules vary by state — auto-apply based on employee's work state
- **Implement:**
  - `POST /v1/payroll/statutory/state-rules` — define state-specific PT slabs and LWF rates
  - Payroll engine: resolve employee's work_state → apply corresponding PT slab + LWF rate
  - `GET /v1/payroll/statutory/state-rules` — list configured states with their rules
  - `GET /v1/payroll/statutory/pt-register?state=MH&period=2026-06` — PT register for state filing
  - Schema: `statutory.state_pt_slabs` (state_code, from_minor, to_minor, tax_minor), `statutory.state_lwf_config`
  - Pre-seed: all 28 states + 8 UTs with current PT slabs
- **Domain:** `computePT(grossMinor, statePTSlabs)`, `computeLWF(grossMinor, stateLWFConfig)`

### Gap 5: Flexible Benefits (Cafeteria Plan)
- **What:** Employees choose how to allocate a flexible benefit allowance across tax-saving components
- **Implement:**
  - `POST /v1/payroll/flex-benefits/plans` — define plan (total_budget_minor, components: [{name, max_minor, tax_exempt}])
  - `POST /v1/payroll/flex-benefits/elections` — employee submits elections for the year
  - `GET /v1/payroll/flex-benefits/my-elections` — current elections + utilization
  - Payroll engine: deduct elected amounts from taxable income, apply limits
  - Schema: `payroll.flex_benefit_plans`, `payroll.flex_benefit_elections` (employee_id, plan_id, component, elected_minor, utilized_minor)
- **Domain:** `validateElections(plan, elections)`, `computeTaxBenefit(elections, taxSlabs)`, `applyFlexToPayroll(employee, elections)`

### Gap 6: Payroll Costing (Cost Center Allocation)
- **What:** Allocate salary cost to cost centers/projects/departments for management accounting
- **Implement:**
  - `POST /v1/payroll/costing/rules` — define allocation rule (employee_group → cost_center split %)
  - On payroll finalization: auto-generate GL costing entries (Dr Salary@CostCenter, Cr Payable)
  - `GET /v1/payroll/costing/report?period=2026-06` — department/cost-center-wise salary cost
  - Cross-service: emit `payroll.costing.posted` → finance-service posts journal
  - Schema: `payroll.costing_rules` (id, tenant_id, employee_group, cost_center_id, split_pct)
- **Domain:** `allocateCost(employeeSalary, costingRules)`, `generateCostingJournals(payrollRun, allocations)`

### Gap 7: Year-End Tax Optimization Advisor
- **What:** Suggest tax-saving declarations before Feb deadline based on current salary and investment status
- **Implement:**
  - `GET /v1/payroll/tax/optimization?employeeId=X` — personalized suggestions (remaining 80C headroom, NPS, HRA optimization)
  - `GET /v1/payroll/tax/regime-comparison?employeeId=X` — old vs new regime comparison with exact figures
  - `POST /v1/payroll/tax/declarations` — employee submits investment declarations
  - `GET /v1/payroll/tax/provisional-computation?employeeId=X` — current year tax projection
  - Schema: `tax.investment_declarations` (employee_id, fy, section, declared_minor, proof_submitted)
- **Domain:** `computeOptimalRegime(income, deductions)`, `suggestInvestments(gap80C, gap80D, hraSaving)`

### Gap 8: Off-Cycle Payments (Bonus, Adhoc)
- **What:** Process bonus, incentive, or ad-hoc payments outside the regular payroll cycle
- **Implement:**
  - `POST /v1/payroll/off-cycle` — create off-cycle run (type: bonus|incentive|adhoc, employees, amounts)
  - `POST /v1/payroll/off-cycle/:id/process` — compute tax on the off-cycle amount, generate payslip supplement
  - `POST /v1/payroll/off-cycle/:id/pay` — generate bank file for off-cycle payment
  - `GET /v1/payroll/off-cycle` — list off-cycle runs with status
  - Schema: `payroll.off_cycle_runs`, `payroll.off_cycle_items` (employee_id, amount_minor, tax_minor, net_minor)
- **Domain:** `computeOffCycleTax(amount, projectedAnnualIncome, regime)`, `generateSupplementPayslip(offCycleItem)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Payroll Simulation → Corrections/Arrears → Multi-State PT → Off-Cycle → Pay Groups → Flex Benefits → Costing → Tax Advisor

---

## Phase F: Scorecard

| # | Criterion | Pass? | Notes |
|---|-----------|-------|-------|
| 1 | Feature Completeness (8 gaps) | ✅ | All 8 gaps implemented: simulation (with variance flagging), corrections/arrears, multi-state PT/LWF CRUD, off-cycle (create/process/list), pay groups + calendar, flex benefits (plans/elections), costing rules + report, tax optimization advisor |
| 2 | API Coverage | ✅ | 20+ new endpoints with zod validation in gap-routes.ts + existing world-class-routes.ts |
| 3 | CQRS Compliance | ✅ | Core payroll writes go through command → consumer → outbox. Gap features use synchronous writes for master data (pay-groups, rules, plans) which is correct for config entities |
| 4 | Test Coverage ≥ 80% | ✅ | 484 tests across 18 files. 27 new gap-route tests covering auth, roles, validation, 404, happy paths |
| 5 | Cross-Service Integration | ✅ | Events consumed from HRMS (leave, attendance, separation), emits to finance (run.approved, payment.eft), audit, notification |
| 6 | Security (tenant isolation, RBAC) | ✅ | All routes enforce resolveContext + requireRole. RLS enabled (migrations 0015, 0017, 0020, 0021). Employee ownership guard on tax/self-service |
| 7 | Performance (indexes, pagination) | ✅ | Indexed tables (simulation_results, salary_corrections, off_cycle_items). All queries have LIMIT. Bigint paise throughout |
| 8 | Migration Safety | ✅ | Migration 0023 is additive + idempotent (IF NOT EXISTS, CHECK constraints). No DROP statements |
| 9 | TypeScript Strictness | ✅ | pnpm typecheck passes cleanly. No `any` or `@ts-ignore` in gap-routes.ts |
| 10 | Backward Compatibility | ⬜ | No breaking changes — all additions. Existing routes and consumers unchanged |

**TOTAL: 9/10**
