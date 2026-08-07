# 02 · Finance group — finance · billing · revenue · grants

See `00-MASTER-RUNBOOK.md` for conventions. Money is bigint minor units (paise) everywhere; any float on a money path is a defect.

## Known defects in this group (EXPECT-FAIL)

| Ref | Defect | Evidence |
|---|---|---|
| FIN-D1 | ~23 finance sub-pages call GETs that don't exist (cashbook, deposits, receipts, revenue heads/fees/challans, DBT, deductions, payment-advice, guarantees, schemes, budget demand-grants/revised-estimates/outcomes/allocations/funds, GEM e-invoice, TDS returns, user-charges, audit-paras, debt, licenses, treasury investments) → permanent empty tables | `_data/loaders.ts:1507-1806` |
| FIN-D2 | "+ New Sanction"/"+ New Bill" post `{reason,status}` but validators require full domain body → always 400 | `FinanceActions.tsx:157,176` |
| FIN-D3 | EFT quick actions (PFMS sync / Release EFT / Pay bill) post short bodies → always 400 | `FinanceActions.tsx:61,75,135` |
| FIN-D4 | No `POST /v1/finance/accounts` — CoA limited to onboarding seed; "new account" page can only map HoA codes | chart-of-accounts/new/page.tsx |
| FIN-D5 | Budget guard skipped when no allocation row exists (`if (alloc)`) — expenditure without appropriation | `payments/consumer.ts:122,159` |
| FIN-D6 | revenue/billing events (`revenue.receipt.captured`, `revenue.refund.processed`, invoices) never consumed by finance → collections absent from GL/trial balance | `finance topics.ts:99-121` |
| FIN-D7 | GST computed in float rupees before paise conversion (≤1 paisa drift) | `simplified/commands.ts:24,56` |
| GRT-D1 | Grant release "Approve" posts to non-existent route | `ReleasesTable.tsx:72` |
| GRT-D2 | Releases list treats rupees as paise → amounts 100× too small vs detail page | `ReleasesTable.tsx:42` |
| BIL-D1 | Subscription activate/cancel and invoice issue/pay have no UI (API-only) | SubscriptionsTable.tsx |

## Checkpoints

### Finance — GL & period control
1. [BROWSER] `/finance/journal-entry`: post a balanced 2-line JV → 202 → appears in general ledger; JV PDF downloads.
2. [API] Unbalanced JV (Dr≠Cr) → rejected in consumer (JOURNAL_UNBALANCED), never posted; `GET /v1/finance/statements/trial-balance/balanced` stays true.
3. [BROWSER] `/finance/period-close`: soft-close → non-adjustment JV into period rejected (PERIOD_SOFT_CLOSED); hard-close → reopen.
4. [CODE] GL invariants: bigint balance assertion (`gl/domain.ts:15`), gapless voucher numbering, deterministic journal idempotency keys — cite lines in evidence.

### Finance — sanctions, bills, payments (maker-checker)
1. [API] Full-body `POST /v1/finance/sanctions` (sanctionNo, purpose, headId, amountMinor) as officer A → approve as A → SoD rejection; approve as B → approved.
2. [API] Bill against the sanction beyond amountMinor → SANCTION_EXHAUSTED; within limit → 3-way-match path.
3. [BROWSER] **EXPECT-FAIL (FIN-D2):** "+ New Sanction" and "+ New Bill" buttons → 400 VALIDATION_FAILED every time.
4. [BROWSER] **EXPECT-FAIL (FIN-D3):** treasury EFT quick actions → 400.
5. [CODE] **EXPECT-FAIL (FIN-D5):** create bill on a head with no allocation row for the FY → posts with no OVER_APPROPRIATION guard. Then create an allocation smaller than the bill → guard fires. Both behaviours must be captured as evidence.
6. [BROWSER] `/finance/pfms` payment advice / salary bill / sign batch forms; `/finance/reconciliation` run + exception action (wired).

### Finance — coverage honesty
1. [UX] **EXPECT-EMPTY (FIN-D1):** walk finance/revenue/*, treasury/*, statutory/*, budget/demand-grants etc. — record each as blocked-by-missing-endpoint, not as data defects.
2. [BROWSER] **(FIN-D4)** `/finance/chart-of-accounts/new` — only HoA mapping possible; log CoA authoring as a product decision needing sign-off.
3. [CODE] **(FIN-D7)** cite the float GST computation; assert all schema money columns are bigint minor (no `real`/`doublePrecision` on money — verified true this sweep).

### Billing
1. [API] plans → subscriptions → usage → `invoices/generate` → `issue` → `pay`; paidMinor arithmetic in bigint.
2. [BROWSER] `/billing/plans/new` form; `/billing/invoices/[id]` Generate IRN → Cancel IRN; `/billing/gstn` verify + return panels.
3. [UX] **(BIL-D1)** record activate/cancel/issue/pay as API-only steps in the UAT script.
4. [CODE] **(FIN-D6)** confirm no finance consumer for billing invoice events — SaaS revenue absent from GL.

### Revenue
1. [BROWSER] assessee create → detail tabs (DCB/demands/bills/receipts/instalments) all load.
2. [BROWSER] assessment create → revise → remit → remit-decide as different user; decide-as-raiser rejected (maker-checker).
3. [BROWSER] bill generate from unpaid demand → receipt against demand → DCB running balance drops by amountMinor.
4. [BROWSER] refunds and write-offs: raise as A, decide as B; A-decides-own rejected.
5. [API] rate config (heads/slabs/penalty/rebate) round-trip to `/revenue/config`.
6. [CODE] **EXPECT-FAIL (FIN-D6):** no `revenue.receipt.captured` consumer in finance — collections never reach trial balance. Flag as accounting-completeness blocker for any tenant using revenue + finance together.
7. [BROWSER] `/revenue/bbps` fetch-bill → pay-bill.

### Grants
1. [API+BROWSER] scheme → criteria → application → score → approve → installments → Disburse (button wired, 202).
2. [BROWSER] **EXPECT-FAIL (GRT-D1):** releases Approve → 404; verify the release row itself appears after disbursement.
3. [UX] **EXPECT-FAIL (GRT-D2):** compare one amount on `/grants/releases` vs `/grants/disbursements/[id]` — record the 100× discrepancy with exact figures.
4. [API] UC submit → validate/reject → validation-status; [CODE] finance consumes `grant.uc.submitted` (`integrations/consumer.ts:242`).
5. [UX] Zero web tests exist for grants pages — treat as highest-regression lane; add exploratory passes.
6. [CODE] Releases list N+1 (3 sequential lookups per row, `disbursement/queries.ts:26-46`) — perf probe with 200 rows.
