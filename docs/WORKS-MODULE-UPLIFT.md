# Implementation Plan

## Overview

Full UI uplift of the Works & Billing module (`/works/**`) across seven sprints (W1–W7). All work is in `apps/web/src/app/(app)/works/**`. The service layer (`services/works-service`) was already production-ready (405 tests passing); this plan covers the frontend only.

All tasks complete. Merged to `main` via PRs #659–#663.

---

## Tasks

### W1 — P0 Bug Fixes (PR #659, +3 847 / -612)

- [x] 1. Fix broken `fetchJson` calls across works list pages
  - Replace any `fetch()` calls that lacked error handling with the `fetchJson<unknown, T>()` loader pattern used across the rest of the app (`telemetryKey`, `mapResponse`, default fallback)
  - Ensure list pages render the `DataSourceBadge` when `source === "error"` rather than crashing
  - _Covers: proposals, tenders, boq, contractors, approvals, billing, execution, closure_

- [x] 2. Fix `formatMoney` usage — bigint paise strings
  - Audit every amount display; replace raw division by 100 with `formatMoney(string)` from `@/lib/formatters`
  - Inputs use `Math.round(parseFloat(rs) * 100).toString()` before sending to the API
  - _Covers: proposals, tenders, boq, billing_

- [x] 3. Fix status badge rendering on all DataTable `cellType: "status"` columns
  - Confirm DataTable maps status strings correctly; fix any columns using the wrong `cellType`

- [x] 4. Add missing `loading.tsx` skeleton stubs to all works sub-routes
  - Works hub (`/works`), and each module directory that lacked a loading boundary

- [x] 5. Wire `works/page.tsx` hub to live dashboard KPI endpoint
  - Fetch `GET /api/v1/works/dashboard` → `{ totalWorks, activeWorks, closedWorks, byStatus }`
  - Render four `KpiCard` tiles (Total Works, Active, Closed, Draft) above the navigation tile grid
  - _Commit: 95f050d5_

---

### W2 — Create Forms (PR #659)

- [x] 6. Proposal create form — `works/proposals/new/page.tsx`
  - Fields: workNumber, description, category (select: civil/electrical/mechanical/others), estimatedCostMinor (₹ input → paise), divisionId
  - POST `/api/proxy/v1/works/proposals`; toast + redirect to `/works/proposals` on 202

- [x] 7. Pre-tender / Tender create form — `works/tenders/new/page.tsx`
  - Fields: workId (UUID), tenderType (select), tenderCategory (select), estimatedCostMinor
  - POST `/api/proxy/v1/works/tenders/pre-tender`; toast + redirect on 202

- [x] 8. BoQ item create form — `works/boq/new/page.tsx`
  - Fields: workId, itemCode, itemDescription, unit, rate (₹ → paise), quantity, scopeId, srItemId
  - POST `/api/proxy/v1/works/boq`; toast + redirect to `/works/boq` on 202

- [x] 9. Contractor create form — `works/contractors/new/page.tsx`
  - Fields: name, pan (optional), gstNumber (optional), registeredAddress (optional), class (select from contractor-classes master), licenseNumber, licenseExpiry
  - POST `/api/proxy/v1/works/contractors`; toast + redirect on 202

- [x] 10. AA create form — `works/approvals/new/page.tsx`
  - Fields: workId, aaNumber, aaDate, aaAuthorityId, approvedAmountMinor (₹ → paise), approvalType (select), remarks
  - POST `/api/proxy/v1/works/approvals/aa`; toast + redirect on 202

- [x] 11. TS create form — `works/approvals/ts-new/page.tsx`
  - Fields: workId, tsNumber, tsDate, tsAuthorityId, tsAmountMinor (₹ → paise), sanctionType (select), remarks
  - POST `/api/proxy/v1/works/approvals/ts`; toast + redirect on 202

---

### W3 — Detail Pages + Row Navigation (PR #659)

- [x] 12. Proposals detail page — `works/proposals/[id]/page.tsx`
  - Server component; GET `/api/v1/works/proposals/:id` (direct endpoint); KPI cards + details `<dl>` Card
  - Renders `<ProposalActions>` client component (DAO finalize button)

- [x] 13. Tenders detail page — `works/tenders/[id]/page.tsx`
  - Parallel fetch: quotations list + tender list (filter by id); stat grid (quotation count, lowest bid, awarded count, status)
  - DataTable of quotations; renders `<TenderActions>`

- [x] 14. BoQ detail page — `works/boq/[workId]/page.tsx`
  - Parallel fetch: BoQ items + recapitulation; stat grid; items DataTable; recapitulation summary table
  - "Add item" link to `/works/boq/new?workId=...`

- [x] 15. Contractor detail page — `works/contractors/[id]/page.tsx`
  - Fetch contractor list, filter by id (no GET-by-id endpoint); stat grid; details Card
  - Star display helper for existing rating; placeholder wired for W7.1 rating form

- [x] 16. AA detail page — `works/approvals/aa/[id]/page.tsx`
  - No GET-by-id: fetch `GET /api/v1/works/approvals/aa?pageSize=100`, filter by params.id; `notFound()` if absent
  - KPI cards (Approved Amount, Status, Approval Type); details Card; `<ApprovalFinalizeButton type="aa">`

- [x] 17. TS detail page — `works/approvals/ts/[id]/page.tsx`
  - Same list-filter pattern as AA; TS-specific fields (tsNumber, tsDate, tsAuthorityId, tsAmountMinor, sanctionType)
  - `<ApprovalFinalizeButton type="ts">`

- [x] 18. Billing detail page — `works/billing/[workId]/page.tsx`
  - GET `/api/v1/works/billing/:workId/bills`; stat grid (total bills, total gross, finalized, submitted); bills DataTable
  - Renders `<BillingActions>` client component; "Issue MB" link

- [x] 19. Execution detail page — `works/execution/[workId]/page.tsx`
  - Parallel fetch: scopes + issues per workId; stat grid (total scopes, open issues, closed issues)
  - Two DataTables (scopes / issues); action links: Record Progress, Raise Issue, Add Photo (W6)
  - Renders `<ExecutionActions>` client component

- [x] 20. ApprovalsTable row navigation — `works/approvals/ApprovalsTable.tsx`
  - Add `rowHref` function to DataTable: tab-aware → `/works/approvals/aa/:id` or `/works/approvals/ts/:id`

---

### W4 — State-Machine Action Buttons (PR #660, +1 481 / -3)

- [x] 21. ProposalActions — `works/proposals/[id]/ProposalActions.tsx`
  - "DAO Finalize" danger ConfirmDialog; POST `/api/proxy/v1/works/proposals/:id/dao-finalize`
  - Hidden when `status === "dao_finalized"`

- [x] 22. TenderActions — `works/tenders/[id]/TenderActions.tsx`
  - **Add Quotation**: method select (item_rate / percentage_rate); conditional fields (quotedAmountMinor or quotedPercentage + aboveOrBelowOrAtPar); POST `.../quotation`
  - **Create Award**: contractorName, acceptedAmountMinor, optional (agreementNumber, workOrderNumber, workPeriodDays, billMode); POST `.../award`
  - **DAO Finalize Award** + **DO Finalize Award** buttons when awardId present

- [x] 23. BillingActions — `works/billing/[workId]/BillingActions.tsx`
  - **Bill Finalize Stepper**: lists actionable bills (where next status exists in `BILL_SEQUENCE`); per-bill "→ Next Status" button; POST `.../bills/:billId/finalize { nextStatus }`
  - **MB Finalizer**: manual UUID text input + status select; POST `.../mb/:mbId/finalize { nextStatus }`

- [x] 24. ExecutionActions — `works/execution/[workId]/ExecutionActions.tsx`
  - **Physical Completion Certificate**: optional date input; POST `.../execution/physical-complete { workId, completionDate? }`
  - **Work Closure**: closureType select (completion/closed/dropped); danger ConfirmDialog; POST `.../execution/close { workId, closureType }`

- [x] 25. ApprovalFinalizeButton — `works/approvals/ApprovalFinalizeButton.tsx`
  - Shared client component for AA and TS; props `{ id, type: "aa" | "ts", status }`
  - Hidden when `status !== "draft"`; POST `/api/proxy/v1/works/approvals/:type/:id/finalize`

---

### W5 — Masters Registry + Reports Dashboard (PR #661, +888 / -0)

- [x] 26. Masters registry page — `works/masters/page.tsx`
  - Server component; reads `searchParams.type` (default "authorities"); validates against 17-prefix `MASTER_TYPES` tuple
  - Two-column layout: left `<nav>` with 17 type links (active highlighted); right: `<MasterCreateForm>` above `Card + DataTable`
  - Fetch `GET /api/v1/works/masters/:type?pageSize=100`; map to `{ shortId, name, code, active }`

- [x] 27. MasterCreateForm — `works/masters/MasterCreateForm.tsx`
  - "use client" toggle-open form; 17 master types in `FIELD_MAP` with per-type fields (text/money/checkbox/UUID-ref)
  - Money fields: `parseFloat(value) * 100` → paise string; UUID-ref fields: text input with "Paste UUID" placeholder
  - POST `/api/proxy/v1/works/masters/:masterType` → 202; toast "Created. Changes will reflect shortly." + `router.refresh()` after 600 ms

- [x] 28. Reports dashboard page — `works/reports/page.tsx`
  - Server component; reads `searchParams` (fromDate, toDate, divisionId)
  - Parallel `Promise.all` of 3 endpoints: `/v1/works/reports/summary`, `/v1/works/reports/status`, `/v1/works/reports/works`
  - KPI strip (Total/Active/Closed StatCards) + Status Breakdown DataTable (sorted by count desc, humanized labels) + Works Register DataTable (filterable, sortable, exportable; money via `formatMoney`, dates via `formatIndianDate`)

- [x] 29. ReportFilters — `works/reports/ReportFilters.tsx`
  - "use client"; fromDate + toDate date inputs + divisionId text input
  - Apply: `router.push("/works/reports?" + params.toString())`; Clear: `router.push("/works/reports")`
  - `useTransition` for loading state; inputs disabled during navigation

- [x] 30. Hub tiles — `works/page.tsx`
  - Added Masters Registry (📚) and Reports (📊) tiles to the navigation grid

---

### W6 — Issues Register + Photo Registration (PR #662, +641 / -0)

- [x] 31. Raise Issue form — `works/execution/issues/new/page.tsx`
  - "use client"; reads `?workId=` via `useSearchParams` (Suspense boundary) to pre-fill workId field
  - Fields: workId (UUID), issueTypeId (UUID, optional), description (textarea, required, max 2048)
  - POST `/api/proxy/v1/works/execution/issues`; toast + redirect to `/works/execution/:workId` on success
  - Fixes broken "Raise issue" link from W3 execution detail page

- [x] 32. Issues register — `works/execution/issues/page.tsx`
  - Server component; GET `/api/v1/works/execution/issues?pageSize=100`; handles both array and `{ data: [...] }` shapes
  - StatGrid (total / open / closed); DataTable in Card
  - Renders `<IssueCloseForm>` below the table

- [x] 33. IssueCloseForm — `works/execution/issues/IssueCloseForm.tsx`
  - "use client"; UUID text input + danger ConfirmDialog
  - POST `/api/proxy/v1/works/execution/issues/:id/close`; toast + `router.refresh()` after 600 ms

- [x] 34. Photo registration form — `works/execution/photos/new/page.tsx`
  - "use client"; reads `?workId=` via `useSearchParams` to pre-fill workId
  - Fields: workId, fileKey (S3/MinIO object key, required), description (optional textarea), latitude/longitude (optional number inputs)
  - POST `/api/proxy/v1/works/execution/photos` with `source: "web"`; toast + redirect after 600 ms

- [x] 35. Execution detail — add "📷 Add photo" ghost link
  - Added as third action link alongside Record Progress and Raise Issue in `works/execution/[workId]/page.tsx`

---

### W7 — Contractor Rating, Proposal Extra Actions, Billing Measurements (PR #663, +880 / -71)

- [x] 36. ContractorRatingForm — `works/contractors/[id]/ContractorRatingForm.tsx`
  - "use client"; props `{ contractorId, currentRating, ratingCount }`
  - 5-star hover-preview and click-select UI (★ filled in `var(--accent)` / ☆ empty in `var(--muted)`)
  - "Submit Rating" disabled until star selected; ConfirmDialog on submit
  - PATCH `/api/proxy/v1/works/contractors/:id/rate` with `{ rating: 1–5 }`; toast + `router.refresh()` after 600 ms
  - Replaces the "W4 — coming soon" placeholder on contractor detail page

- [x] 37. ProposalExtActions — `works/proposals/[id]/ProposalExtActions.tsx`
  - "use client"; one-open-at-a-time accordion with three sections (state: `openSection: string | null`)
  - **Split Proposal**: description textarea → POST `/api/proxy/v1/works/proposals/split { parentWorkId, description }`
  - **Map COA**: majorHead (required, max 16) + 5 optional heads → POST `.../proposals/coa`
  - **Map Office**: divisionId (UUID required) + subDivisionId + sectionId + isNodal checkbox → POST `.../proposals/office-mapping`
  - Per-section busy/error state; toast on success + close section
  - Wired into `works/proposals/[id]/page.tsx` below existing `<ProposalActions>`

- [x] 38. Record Measurement form — `works/billing/measurements/new/page.tsx`
  - "use client"; reads `?mbId=`, `?boqItemId=`, `?workId=` from searchParams (Suspense boundary)
  - Fields: mbId (UUID, required), boqItemId (UUID, required), quantity (required, positive); optional dimension fields (No./L/B/D in a `<fieldset>`); remarks textarea
  - POST `/api/proxy/v1/works/billing/measurements`; toast + redirect to `/works/billing/:workId` after 600 ms
  - "✛ Record measurement" ghost link added to billing detail page header actions

---

## Coverage map (API routes → UI)

| API route | UI coverage |
|---|---|
| `GET /v1/works/dashboard` | Works hub KPI strip (task 5) |
| `POST /v1/works/proposals` | Proposals create form (task 6) |
| `GET /v1/works/proposals` | Proposals list page (pre-existing) |
| `GET /v1/works/proposals/:id` | Proposals detail page (task 12) |
| `POST /v1/works/proposals/:id/dao-finalize` | ProposalActions (task 21) |
| `POST /v1/works/proposals/split` | ProposalExtActions (task 37) |
| `POST /v1/works/proposals/coa` | ProposalExtActions (task 37) |
| `POST /v1/works/proposals/office-mapping` | ProposalExtActions (task 37) |
| `GET /v1/works/work-orders` | Work Orders list page (pre-existing) |
| `GET /v1/works/approvals/aa` | AA list + AA detail (tasks 16, 20) |
| `POST /v1/works/approvals/aa` | AA create form (task 10) |
| `POST /v1/works/approvals/aa/:id/finalize` | ApprovalFinalizeButton (task 25) |
| `GET /v1/works/approvals/ts` | TS list + TS detail (tasks 17, 20) |
| `POST /v1/works/approvals/ts` | TS create form (task 11) |
| `POST /v1/works/approvals/ts/:id/finalize` | ApprovalFinalizeButton (task 25) |
| `GET /v1/works/boq/:workId` | BoQ detail page (task 14) |
| `POST /v1/works/boq` | BoQ create form (task 8) |
| `POST /v1/works/boq/recapitulate` | (via BoQ detail trigger; no standalone UI) |
| `GET /v1/works/tenders` | Tenders list page (pre-existing) |
| `POST /v1/works/tenders/pre-tender` | Tender create form (task 7) |
| `GET /v1/works/tenders/:tenderId/quotations` | Tenders detail page (task 13) |
| `POST /v1/works/tenders/quotation` | TenderActions (task 22) |
| `POST /v1/works/tenders/award` | TenderActions (task 22) |
| `POST /v1/works/tenders/award/:id/dao-finalize` | TenderActions (task 22) |
| `POST /v1/works/tenders/award/:id/do-finalize` | TenderActions (task 22) |
| `GET /v1/works/contractors` | Contractors list page (pre-existing) |
| `POST /v1/works/contractors` | Contractor create form (task 9) |
| `PATCH /v1/works/contractors/:id/rate` | ContractorRatingForm (task 36) |
| `GET /v1/works/execution/progress` | Execution list page (pre-existing) |
| `POST /v1/works/execution/progress` | Record Progress form (pre-existing) |
| `GET /v1/works/execution/:workId/scopes` | Execution detail page (task 19) |
| `GET /v1/works/execution/:workId/issues` | Execution detail page (task 19) |
| `GET /v1/works/execution/issues` | Issues register (task 32) |
| `POST /v1/works/execution/issues` | Raise Issue form (task 31) |
| `POST /v1/works/execution/issues/:id/close` | IssueCloseForm (task 33) |
| `POST /v1/works/execution/photos` | Photo registration form (task 34) |
| `POST /v1/works/execution/physical-complete` | ExecutionActions (task 24) |
| `POST /v1/works/execution/close` | ExecutionActions (task 24) |
| `GET /v1/works/billing/:workId/bills` | Billing detail page (task 18) |
| `POST /v1/works/billing/mb` | Issue MB form (pre-existing) |
| `POST /v1/works/billing/bills/:id/finalize` | BillingActions (task 23) |
| `POST /v1/works/billing/mb/:id/finalize` | BillingActions (task 23) |
| `POST /v1/works/billing/measurements` | Record Measurement form (task 38) |
| `POST /v1/works/billing/account-compile` | (admin-only; no UI — DAO/DO console action) |
| `GET /v1/works/masters/:prefix` | Masters registry (task 26) |
| `POST /v1/works/masters/:prefix` | MasterCreateForm (task 27) |
| `GET /v1/works/reports/summary` | Reports dashboard (task 28) |
| `GET /v1/works/reports/status` | Reports dashboard (task 28) |
| `GET /v1/works/reports/works` | Reports dashboard (task 28) |
| `GET /v1/works/closure` | Closure list page (pre-existing) |

---

## Known gaps / follow-ups

| # | Item | Priority |
|---|------|----------|
| F1 | Employee list pagination `total` comes from `filtered.length` ≤ 50 → pagination nav never appears; needs API total count | Medium |
| F2 | `GET /v1/works/approvals/aa` and `.../ts` detail pages fetch full paginated list (pageSize=100) and filter client-side; breaks silently when >100 approvals exist | Low |
| F3 | No GET-by-id for Contractors (detail page fetches full list, filters by id); same cap issue above 200 contractors | Low |
| F4 | `POST /v1/works/billing/account-compile` has no UI; DAO/DO role-only action with month/year inputs; candidate for W8 | Low |
| F5 | Photo upload is fileKey-only (S3 key must be copied manually); a presigned-URL upload widget would complete the flow end-to-end | Medium |
| F6 | Masters registry DataTable shows shortId, name, code, active — no edit or deactivate actions yet | Low |

---

## Merge history

| PR | Commit | Sprint | +lines / -lines |
|---|---|---|---|
| #659 | `95f050d5` | W1–W3 | +3 847 / -612 |
| #660 | `2edb9f0d` | W4 | +1 481 / -3 |
| #661 | `20b9ff72` | W5 | +888 / -0 |
| #662 | `aeb9f666` | W6 | +641 / -0 |
| #663 | `53b34e94` | W7 | +880 / -71 |

Total: **+7 737 / -686** across 5 PRs, 38 tasks.
