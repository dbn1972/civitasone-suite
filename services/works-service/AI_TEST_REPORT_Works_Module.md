# Works Module — AI Test Pack Execution Report

**Date:** 2026-08-08  
**Branch:** `fix/works-ai-pack-gaps`  
**Service:** `@civitasone/works-service`  
**Pack:** Works_Module_Test_Pack (8 prompts + AI_Test_Execution master)

---

## Summary

Executed the full Works Module Test Pack against `services/works-service`. Extended the existing 349-test suite with **35 new focused tests** across 6 new files plus shared fixtures, then closed **all 6 human-review gaps** with production fixes and **21 additional regression tests**. Final run: **405 passed / 0 failed** in 22 test files.

---

## Commands Run

```bash
cd services/works-service && pnpm test
# Test Files  22 passed (22)
# Tests       405 passed (405)
```

Baseline before this session: 349 passed (15 files).  
After AI pack extension: 384 passed (21 files).  
After gap fixes: **405 passed (22 files)**.

---

## Human-Review Gaps — Status

| # | Gap | Status | Evidence |
|---|-----|--------|----------|
| 1 | Finance hand-off on bill DO-finalization | **FIXED** | `billing/consumer.ts` emits `finance.bill.create` (via `FINANCE_HANDOFF.billCreate` in `topics.ts`) when `nextStatus === do_finalized`; refs `works_bill:{id}`, `works_award:{awardId}` |
| 2 | Bill amount vs award ceiling | **FIXED** | `billAmountExceedsAward()` in `billing/domain.ts`; enforced in `billing/routes.ts` (422) + `billing/consumer.ts` (FR-BIL-012) |
| 3 | BoQ duplicate-line guard | **FIXED** | `isDuplicateBoqLine()` in `boq/domain.ts`; enforced in `boq/consumer.ts` on `boqAddItem` (workId + itemCode/description key) |
| 4 | issueClose workflow | **FIXED** | `execution/consumer.ts` + `EVENTS.issueClosed`; route `POST /v1/works/execution/issues/:id/close`; `closeIssueCommand` in `commands.ts` |
| 5 | Reporting filters/pagination | **FIXED** | `reporting/validators.ts` (`fromDate`, `toDate`, `divisionId`, `page`, `pageSize`); filters on `/summary` + `/status`; new paginated `GET /v1/works/reports/works` |
| 6 | Bid confidentiality | **FIXED** | `canViewBidDetails` / `redactQuotation` in `tender/domain.ts`; `GET /v1/works/tenders/:tenderId/quotations` redacts for `works_viewer` |

---

## Files Created / Changed (gap-fix pass)

| File | Action |
|------|--------|
| `src/topics.ts` | Added `issueClosed`, `FINANCE_HANDOFF.billCreate` |
| `src/modules/billing/domain.ts` | `billAmountExceedsAward`, `isTerminalBillStatus` |
| `src/modules/billing/consumer.ts` | Award ceiling + finance hand-off on DO-finalize |
| `src/modules/billing/routes.ts` | Pre-enqueue award ceiling guard |
| `src/modules/boq/domain.ts` | `boqLineKey`, `isDuplicateBoqLine` |
| `src/modules/boq/consumer.ts` | Duplicate-line rejection |
| `src/modules/execution/consumer.ts` | `issueClose` consumer |
| `src/modules/execution/commands.ts` | `closeIssueCommand` |
| `src/modules/execution/routes.ts` | Issue close route |
| `src/modules/reporting/validators.ts` | **Created** — report filter schema |
| `src/modules/reporting/routes.ts` | Filters + paginated works register |
| `src/modules/proposal/repo.ts` | Filter-aware counts + `listProposalsForReport` |
| `src/modules/execution/repo.ts` | Filter-aware `countClosures` |
| `src/modules/tender/domain.ts` | Bid confidentiality helpers |
| `src/modules/tender/routes.ts` | Quotations list with redaction |
| `tests/works-ai-pack-gaps.test.ts` | **Created** — 21 regression tests for all 6 gaps |
| `tests/billing-domain.test.ts` | FR-BIL-012 domain tests |
| `tests/all-routes.test.ts` | Tender repo mock for award ceiling route path |
| `tests/orphan-consumers.test.ts` | Award/bills mocks for billCreate |
| `tests/consumers.test.ts` | Select `.limit()` mock for billCreate |
| `tests/reporting-aggregates.test.ts` | Updated filter-aware repo call assertions |

---

## Pack Requirement Mapping (updated gaps)

### 02 — Work Billing (`billing/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Finance hand-off event | `works-ai-pack-gaps.test.ts` | `billing/consumer.ts` → `finance.bill.create` on `do_finalized` |
| Bill cannot exceed approved work (money) | `works-ai-pack-gaps.test.ts`, `billing-domain.test.ts` | `billing/domain.ts:38-45`, `billing/routes.ts`, `billing/consumer.ts` |

### 03 — BOQ (`boq/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Duplicate line prevention | `works-ai-pack-gaps.test.ts` | `boq/domain.ts:66-84`, `boq/consumer.ts:19-31` |

### 04 — Work Execution (`execution/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Issue lifecycle (open→close) | `works-ai-pack-gaps.test.ts` | `execution/routes.ts:93-99`, `execution/consumer.ts:48-72`, `topics.ts:41,92` |

### 07 — Works Reporting (`reporting/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Date range filters | `works-ai-pack-gaps.test.ts` | `reporting/validators.ts`, `reporting/routes.ts` |
| Pagination on reports | `works-ai-pack-gaps.test.ts` | `GET /v1/works/reports/works` |

### 08 — Tender & Award (`tender/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Bid confidentiality | `works-ai-pack-gaps.test.ts` | `tender/domain.ts:59-84`, `tender/routes.ts:24-38` |

---

## Remaining Policy Blockers

- **Finance vendor resolution:** `finance.bill.create` uses opaque `works_award:{awardId}` as `vendorId` until a contractor→vendor master mapping exists in finance/procurement. Finance-service may require a registered vendor UUID in production (configurable via `WORKS_FINANCE_DEFAULT_HEAD_ID` / `FINANCE_DEFAULT_HEAD_ID`).
- **Pre-bid opening confidentiality:** Redaction is role-based (`works_viewer` vs operators); time-gated redaction before tender opening is not implemented (no opening-date gate in read path).
- **Concurrent BoQ optimistic lock:** Still N/A — version field exists on schema but consumer does not enforce optimistic concurrency.

---

## Risks

- All new route/consumer tests use mocked DB/queue — no live Postgres RLS or integration stack run in this session.
- Finance hand-off not validated end-to-end against live finance-service consumer (unit/outbox assertion only).
- Concurrent finalization relies on guarded SQL `WHERE status = expected` in tender award consumer but not verified under race conditions.

---

## Quality Status

**Pass** — all 405 unit/route/consumer tests green. All 6 human-review gaps closed with code + test evidence.
