# Module 02: Finance — World-Class Enhancement

## Benchmark: SAP S/4HANA Finance / Oracle Financials Cloud / Tally Prime

## Target Service: `services/finance-service`

---

## Phase A: Deep Audit

Read the COMPLETE current state of all 25 modules:

```
services/finance-service/src/modules/
├── gl/           — General Ledger (journal post, reverse)
├── budget/       — Budget, sanctions, re-appropriation
├── treasury/     — Challan, deposits, refund/forfeit/adjust
├── payments/     — Bills, payment initiation, EFT, GEM invoice match
├── hoa/          — Head of Account master
├── gst/          — GST compliance
├── tds/          — TDS deduction
├── pfms/         — PFMS integration
├── bank-recon/   — Bank reconciliation
├── cashbook/     — Cashbook
├── subledger/    — Sub-ledger
├── fixed-asset/  — Fixed asset accounting
├── financial-statements/ — Balance sheet, P&L, trial balance
├── instruments/  — Financial instruments
├── period-close/ — Period/year-end close
├── recurring/    — Recurring entries
├── simplified/   — MSME auto-journal
├── masters/      — Cost centers, departments
├── org-structure/— Org hierarchy for finance
├── reports/      — Report generation
├── dashboard/    — KPI dashboard
├── integrations/ — External integrations
├── voucher-print/— Voucher/cheque printing
└── tenant-onboard/— Finance setup on tenant provision
```

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Multi-Currency Revaluation
- **What:** Month-end revaluation of foreign-currency balances → unrealized gain/loss journal
- **Implement:**
  - `POST /v1/finance/revaluation/run` — `{ fy, period, exchangeRates: [{currency, rate}] }`
  - Consumer: for each foreign-currency balance, compute unrealized gain/loss, auto-post GL journal
  - `GET /v1/finance/revaluation/history` — list past revaluation runs
- **Schema:** `gl.revaluation_runs` (id, tenant_id, fy, period, rates_snapshot, posted_journal_ids, status, created_at/by)
- **Domain:** `computeRevaluationGainLoss(balanceMinor, originalRate, currentRate, currency)`

### Gap 2: Commitment Accounting (Encumbrance)
- **What:** Reserve budget at PO creation (committed), reduce on payment (actual). Prevents overspend.
- **Implement:**
  - New fields on `budget.finance_budgets`: `committed_minor bigint DEFAULT 0`, `actual_minor bigint DEFAULT 0`
  - On PO approval event (`procurement.po.approved`): increment committed_minor
  - On payment event (`finance.payment.made`): decrement committed → increment actual
  - `GET /v1/finance/budget/:id/utilization` — returns { allocated, committed, actual, available }
  - Budget check at sanction: available = re_minor - committed_minor - actual_minor
- **Consumer:** New consumer subscribing to `procurement.po.approved`

### Gap 3: Revenue Recognition (IND-AS 115)
- **What:** Recognize revenue over time (performance obligations) vs at a point in time
- **Implement:**
  - `POST /v1/finance/revenue/contracts` — create revenue contract with performance obligations
  - `POST /v1/finance/revenue/contracts/:id/recognize` — trigger period-end recognition
  - Schema: `gl.revenue_contracts` (id, tenant_id, contract_ref, total_minor, recognized_minor, method, start_date, end_date)
  - Schema: `gl.revenue_obligations` (id, contract_id, description, standalone_price_minor, recognized_minor, status)
- **Domain:** `computeRecognition(method: 'straight_line'|'percentage_completion'|'output', period, contract)`

### Gap 4: Lease Accounting (IND-AS 116)
- **What:** Right-of-use asset + lease liability on balance sheet for all leases > 12 months
- **Implement:**
  - `POST /v1/finance/leases` — create lease (term, payments, discount_rate, start_date)
  - `POST /v1/finance/leases/:id/calculate` — compute ROU asset, liability, depreciation schedule, interest schedule
  - Monthly consumer: post depreciation (ROU) + interest expense + liability reduction journals
  - Schema: `gl.lease_contracts`, `gl.lease_schedules`
- **Domain:** `computeLeaseNPV(payments[], discountRateBps, termMonths)`, `generateAmortizationSchedule()`

### Gap 5: E-Invoice (NIC GST IRN Generation)
- **What:** Generate IRN (Invoice Reference Number) via NIC API for B2B invoices > threshold
- **Implement:**
  - `POST /v1/finance/einvoice/generate` — takes invoice data, calls NIC API, returns IRN + QR + signed JSON
  - `POST /v1/finance/einvoice/cancel` — cancel within 24h window
  - `GET /v1/finance/einvoice/:id/status` — check IRN status
  - Schema: `gst.einvoice_records` (id, tenant_id, invoice_id, irn, ack_no, signed_invoice, qr_data, status)
- **Integration:** Use `@civitasone/circuit-breaker` for NIC API calls (retry + fallback)

### Gap 6: Cash Flow Forecasting
- **What:** Project future cash position based on committed payments, recurring entries, and historical patterns
- **Implement:**
  - `GET /v1/finance/treasury/forecast?horizon=90` — returns daily projected balance for next N days
  - Sources: pending payments, recurring journal schedules, historical inflow/outflow averages
- **Domain:** `forecastCashFlow(currentBalance, pendingPayments[], recurringEntries[], horizon)`

### Gap 7: Intercompany Elimination & Consolidation
- **What:** For multi-entity (PSU with subsidiaries), eliminate intercompany transactions and produce consolidated financials
- **Implement:**
  - `POST /v1/finance/consolidation/run` — { entities: [tenantId1, tenantId2], period }
  - Identifies intercompany GL entries (matching account codes across entities), eliminates them
  - Produces consolidated trial balance, P&L, balance sheet
  - Schema: `gl.consolidation_runs`, `gl.elimination_entries`
- **Note:** This is a platform-admin-level feature (cross-tenant read via service-secret)

### Gap 8: Configurable Fiscal Calendar
- **What:** Support non-April-to-March fiscal years (some PSUs follow Jan-Dec or Jul-Jun)
- **Implement:**
  - Tenant setting: `fiscal_year_start_month` (1-12, default 4)
  - All period-close, budget allocation, financial statement queries respect this setting
  - `GET /v1/finance/fiscal-calendar` — returns periods with open/closed status for tenant's FY

---

## Phase C: Implementation Order

1. Commitment Accounting (Gap 2) — schema + consumer (high impact, enables budget control)
2. E-Invoice NIC (Gap 5) — compliance deadline, medium effort
3. Cash Flow Forecasting (Gap 6) — read-only analytics, no schema change
4. Multi-Currency Revaluation (Gap 1) — schema + consumer + GL posting
5. Configurable Fiscal Calendar (Gap 8) — tenant setting + query refactor
6. Revenue Recognition (Gap 3) — new module
7. Lease Accounting (Gap 4) — new module
8. Consolidation (Gap 7) — complex, platform-admin feature

---

## Phase D: Testing Requirements

- `tests/revaluation.test.ts` — exchange rate scenarios, gain/loss calculation
- `tests/commitment-accounting.test.ts` — PO commitment, payment actual, budget check
- `tests/revenue-recognition.test.ts` — straight-line, percentage-completion methods
- `tests/lease-accounting.test.ts` — NPV, amortization schedule, journal posting
- `tests/einvoice.test.ts` — NIC API mock, IRN generation, cancellation
- `tests/cash-flow-forecast.test.ts` — projection accuracy with known inputs
- `tests/fiscal-calendar.test.ts` — non-April FY period queries
- Route coverage for all new endpoints (happy + validation + auth)

---

## Phase E: Integration Checklist

- [ ] `topics.ts` — add `CONSUMED_EVENTS.poApproved` for commitment accounting
- [ ] `worker.ts` — register new consumers (commitment, revaluation scheduler)
- [ ] `app.ts` — register new route modules
- [ ] `shared/db.ts` — import new schemas
- [ ] Cross-service: consume `procurement.po.approved`, `procurement.grn.accepted`
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @civitasone/finance-service test` passes

---

## Phase F: Scorecard

| # | Criterion | Pass? | Notes |
|---|-----------|-------|-------|
| 1 | Feature Completeness (8 gaps) | | |
| 2 | API Coverage | | |
| 3 | CQRS Compliance | | |
| 4 | Test Coverage ≥ 80% | | |
| 5 | Cross-Service Integration | | |
| 6 | Security | | |
| 7 | Performance | | |
| 8 | Migration Safety | | |
| 9 | TypeScript Strictness | | |
| 10 | Backward Compatibility | | |

**TOTAL: _/10**
