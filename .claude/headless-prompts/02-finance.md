You are building the Finance module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files for field/workflow requirements):
- ~/CivitasOne/erpnext-develop/finance-module/web/
  Key screens: dashboard.html, chart-of-accounts.html, budget-formulation.html, budget-form.html,
  fund-accounting.html, demand-grants.html, sanctions.html (if present), bill-processing.html,
  bill-detail.html, general-ledger.html, financial-statements.html, cash-bank.html,
  e-payments.html, eft.html, gem-einvoice.html, challans.html, challan-detail.html,
  deposits.html, debt.html, audit-paras.html, advances.html, dbt-beneficiaries.html

ERPNext reference: ~/CivitasOne/erpnext-develop/erpnext/accounts/doctype/ (learn field names, validation rules)

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.3

Service: services/finance-service (database: civitas_finance, prefix: finance_)
DB role password: finance_dev_pw

## Modules inside finance-service (L2 schemas)
src/modules/
  budget/   — heads, budgets, demands, schemes, sanctions
  gl/       — journals, ledger, financial statements
  treasury/ — banks, challans, deposits, debt, guarantees
  payments/ — bills, EFT/NEFT payments, DBT, PFMS, GeM e-invoice
  audit/    — audit paras, compliance

## Step 1 — Migration
Write services/finance-service/migrations/0001_init.sql
Tables (use finance schema prefix for each L2 module schema):
  Schema budget: finance_heads, finance_budgets, finance_demands, finance_schemes, finance_sanctions
  Schema gl: finance_journals, finance_ledger
  Schema treasury: finance_banks, finance_challans, finance_deposits, finance_debt, finance_guarantees
  Schema payments: finance_bills, finance_payments, finance_pfms
  Schema audit: finance_audit_paras

Critical constraints:
- Money fields: bigint (paise), always paired with currency char(3) default 'INR'
- finance_heads: code text unique (LMMHA format), level int (0=major,1=minor,2=sub)
- finance_journals: lines jsonb (array of {account_code, debit_minor, credit_minor}) — must balance
- finance_bills: 3-way match fields: po_ref text (opaque "procurement_po:UUID"), grn_ref text
- finance_payments: mode varchar check in ('NEFT','RTGS','IMPS','DBT','PFMS','cheque')
- audit_events trigger on finance_bills status change (via outbox)

## Step 2 — CQRS routes + consumers
Use tenant-service as template. Key command flows:

Budget module:
  POST /finance/budgets              → finance.budget.create (validate: head exists, FY format)
  PATCH /finance/budgets/:id/re      → finance.budget.re_appropriation
  GET  /finance/budgets?headId=&fy=  → cache → repo (aggregated utilisation)
  GET  /finance/sanctions/:id/available → CRITICAL: procurement calls this to check budget before PO
  POST /finance/sanctions            → finance.sanction.create

GL module:
  POST /finance/journals             → finance.gl.post (validate: lines balance, debit=credit)
  GET  /finance/ledger?headId=&from=&to= → paginated, sorted by posting_date
  GET  /finance/statements/trial-balance  → aggregated from ledger

Payments module:
  POST /finance/bills                → finance.bill.create (3-way match validation in consumer)
  PATCH /finance/bills/:id/approve   → finance.bill.approve (multi-stage: section→accounts→pay)
  POST /finance/payments/eft         → finance.payment.initiate (EFT/NEFT/RTGS)
  GET  /finance/payments/:id         → cache → repo
  POST /finance/gem/einvoice/match   → match GeM invoice to PO

Treasury:
  POST /finance/challans             → finance.challan.create
  GET  /finance/banks/:id/balance    → cache → repo
  POST /finance/deposits             → finance.deposit.create

## Step 3 — Domain rules (enforce in domain.ts + consumer.ts)
- Budget cannot be exceeded: consumer checks finance_budgets.allocated_minor before writing bill
- Journal must balance: sum(debit_minor) == sum(credit_minor) — reject in zod validator
- Bill 3-way match: consumer validates po_ref exists + grn_ref matches po — publishes finance.bill.mismatch event if not
- Payment only after bill.status = 'passed'
- Sanction available check: finance_sanctions.amount_minor - SUM(bills against it) must be positive

## Step 4 — Events emitted (via @civitasone/events via outbox)
finance.sanction.approved → consumed by procurement (budget check)
finance.bill.passed       → consumed by procurement (payment confirmation)
finance.payment.made      → consumed by procurement (vendor payment confirmation)
finance.gl.posted         → consumed by audit-service

## Step 5 — Tests
tests/finance.test.ts:
- Journal balance validation (pure): balanced journals pass, unbalanced reject
- Budget exceeded check (pure): bill amount > available budget → domain throws
- Bill 3-way match: missing GRN ref → consumer emits finance.bill.mismatch not finance.bill.created
- CQRS wiring: POST /finance/bills → SQS → consumer → DB (MemoryQueue + MemoryCache)

## Step 6 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=finance_dev_pw -i civitasone-postgres \
  psql -U finance_svc -d civitas_finance < services/finance-service/migrations/0001_init.sql
cd services/finance-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Flag if any ERPNext field from the accounts/doctype contradicts the schema.
