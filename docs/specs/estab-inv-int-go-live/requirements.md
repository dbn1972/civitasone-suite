# Requirements Document

## Introduction

The sprint readiness assessment (`docs/SPRINT-READINESS-ESTAB-INV-INT.html`) identified
concrete gaps across three modules — Establishment, Inventory & Stock, and the Procurement
integration chain — that must be closed before the platform can go live. This document turns
those findings into verifiable requirements that Kiro agents and Cursor can act on directly.

**Assessment scores (current state):**

| Module | UX/100 | WCAG/100 | Unit+Int | E2E | Go-live |
|---|---|---|---|---|---|
| Establishment | 71 | 66 | 83% | 0% | 76% |
| Inventory | 63 | 61 | 81% | 0% | 58% |
| Integration chain | 68 | 63 | 74% | 18% | 63% |

---

## 1. P0 — Functional Completeness

### 1.1 Store Receipt Note (SRN)

The platform must implement a Store Receipt Note workflow. GFR Rule 149 requires a signed SRN
before any payment against a GRN can be authorised.

- New DB table `inventory.store_receipt_notes` (columns: id, tenantId, grnId, storeOfficerId,
  receivedAt, remarks, status; RLS on tenantId).
- Alembic/Drizzle migration file added and `db/schema.sql` updated.
- `services/inventory-service/src/modules/srn/` module with `routes.ts`, `schema.ts`,
  `commands.ts`, `domain.ts`, `repo.ts`.
- API: `POST /v1/inventory/srn` · `GET /v1/inventory/srn/:grnId`.
- Web: form at `/procurement/grn/[id]/srn/new`, read view at `/procurement/grn/[id]/srn`.
- The three-way-match consumer must gate payment-block release on `srn.created` event alongside
  GRN acceptance.
- Unit tests: srn lifecycle, RLS isolation.

### 1.2 GRN Partial-Delivery Amendment

A GRN must be editable after creation to record partial delivery.

- `PATCH /v1/procurement/grns/:id` — updates `receivedQty` + `acceptedQty` per line item while
  status is `draft` or `under_inspection`; returns 409 when already `accepted`.
- Web: edit form rendered on `/procurement/grn/[id]` when GRN is in an editable state.
- Tests: happy-path update, state-guard 409.

### 1.3 Consumables Domain + Repository

`services/estab-service/src/modules/consumables/` is missing `domain.ts` and `repo.ts`.

- `domain.ts`: `isReorderRequired(balance, reorderLevel): boolean`.
- `repo.ts`: `getBalance(tenantId, itemId)` · `upsertBalance(tenantId, itemId, delta)`.
- Migration: new table `files.estab_consumables` (tenantId, itemId, balance, reorderLevel,
  unit, updatedAt) with RLS.
- Tests: stock-out boundary at threshold, delta accumulation.

### 1.4 Records Category Placeholder

`services/estab-service/src/modules/records/consumer.ts` line ~255 hardcodes
`recordCategory: "B"`. Replace with a value derived from `fileType` and
`classificationLevel` using a lookup table or switch expression. Add a unit test.

### 1.5 Cycle-Count Supervisor Approval UI

Backend `PATCH /v1/inventory/cycle-counts/:id/approve` and `.../reject` exist but have no UI.
Add an action panel to `/inventory/list` or a dedicated `/inventory/cycle-counts/[id]` page
with Approve and Reject buttons. Wire to existing endpoints.

### 1.6 Goods-Return QC Verdict Screen

`inventory.goods_returns` has `qcStatus` and `disposition` columns and the PATCH endpoint
exists, but there is no UI. Add a QC action panel to `/inventory/goods-returns/[id]` for
recording verdict (pass/fail) and disposition (return-to-vendor / scrap / accept-with-penalty).

### 1.7 Legacy Stock Routes Redirect

Routes under `/stock/*` must redirect to `/inventory/*`. Add Next.js redirects in
`apps/web/next.config.js` (or middleware): `/stock` → `/inventory`,
`/stock/list` → `/inventory/list`, `/stock/ledger` → `/inventory/reconcile`,
`/stock/dashboard` → `/inventory`. The stock-service proxy layer can remain.

---

## 2. WCAG 2.2 AA — Establishment Module

### 2.1 Skip-to-Main Link

Every module layout must contain a skip link as the first focusable element:
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 z-50 ...">
  Skip to main content
</a>
```
The `<main>` element on each page must carry `id="main-content"`.

Files: `apps/web/src/app/(app)/estab/layout.tsx`,
`apps/web/src/app/(app)/inventory/layout.tsx`,
`apps/web/src/app/(app)/procurement/layout.tsx`.

### 2.2 File Status Badge Contrast

The badge colour `#FF6B00` on white yields 3.8:1 (fails AA). Replace with `#C55200`
(4.7:1 on white). Add a contrast unit test using the WCAG luminance formula.

File: wherever the status badge colour constant is defined (search for `#FF6B00` or
`ff6b00` in `apps/web/src/app/(app)/estab/`).

### 2.3 Table Keyboard Row Selection — estab/files

`apps/web/src/app/(app)/estab/files/list/FilesTable.tsx`: add `role="grid"` on the
table, `role="row"` on `<tr>`, `tabIndex={0}` on each row, and `onKeyDown` handlers
for Enter/Space to navigate to the file detail route.

### 2.4 NotificationsPanel ARIA Live Region

`apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`: wrap the
notification list in `<div aria-live="polite" aria-atomic="false">`.

### 2.5 Quarter Allotment Table Caption

`apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx`: add
`<caption className="sr-only">Quarter allotments — current financial year</caption>`.

### 2.6 DFA Step Announcement

When the DFA wizard advances, announce the new step title via an
`aria-live="assertive"` region. Add a visually-hidden `<span>` that updates on
step change.

---

## 3. WCAG 2.2 AA — Inventory & Integration

### 3.1 Chart Alternative Tables

`/inventory` forecast chart and `/procurement/vendors/[id]/scorecard` radar chart must
each include a `<table className="sr-only">` with the same data (not `display:none`).

### 3.2 Movement Type Chips

`apps/web/src/app/(app)/inventory/MovementsTable.tsx`: add `role="status"` and
`aria-label="Movement type: {type}"` to each chip.

### 3.3 Inventory Reconcile — Shape + Colour Encoding

Variance values in the reconcile table: prefix with ▲ for positive, ▼ for negative
(satisfies WCAG §1.4.1 use-of-colour). File: `apps/web/src/app/(app)/inventory/reconcile/`.

### 3.4 DispatchPOActions Modal Focus Trap

`apps/web/src/app/(app)/procurement/orders/[id]/DispatchPOActions.tsx`: add focus trap
(use `focus-trap-react` or `@radix-ui/react-dialog` which already traps focus). Escape
key must close and restore focus to the trigger button.

### 3.5 CreateGRNForm Required Field ARIA

`apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`: add `aria-required="true"`
to required inputs; associate error messages via `aria-describedby`.

### 3.6 LineItemsEditor Delete Button Label

`apps/web/src/app/(app)/procurement/_components/LineItemsEditor.tsx`: add
`aria-label={\`Remove line item ${n}\`}` to each delete button.

---

## 4. UX Polish

### 4.1 Empty-State Illustrations

Pass `emptyIcon`, `emptyTitle`, `emptyMessage`, and `emptyAction` to the DataTable
(or equivalent) on:
- `apps/web/src/app/(app)/estab/files/list/page.tsx`
- `apps/web/src/app/(app)/estab/meetings/page.tsx`
- `apps/web/src/app/(app)/estab/vehicles/page.tsx`

### 4.2 Mobile Table Overflow

Wrap every table in a `<div style={{ overflowX: "auto" }}>` container across estab,
inventory, and procurement. Verify at 375 px viewport.

### 4.3 File Movement Timeline

`apps/web/src/app/(app)/estab/files/[id]/page.tsx`: render file movement history as a
vertical timeline (date · action · from-officer → to-officer · status change), not a
flat list. Keep the existing data loader; only the rendering component changes.

---

## 5. Test Coverage Gaps

### 5.1 Consumables Tests
New file: `services/estab-service/tests/consumables.test.ts`
— domain stock-out boundary; repo balance delta accumulation.

### 5.2 SRN Tests
New file: `services/inventory-service/tests/srn.test.ts`
— SRN create → attach-to-grn → query-by-grn → three-way-match-release.

### 5.3 GRN Amendment Tests
New file: `services/procurement-service/tests/grn-amendment.test.ts`
— partial-delivery update; 409 on accepted GRN; RLS.

---

## 6. E2E Suite

### 6.1 Establishment Journeys
- `tests/e2e-live/specs/estab-file-journey.spec.ts`:
  create file → noting → DFA approval → dispatch.
- `tests/e2e-live/specs/estab-quarters-journey.spec.ts`:
  apply → allotment decision → occupy → vacate.

### 6.2 Inventory Journeys
- `tests/e2e-live/specs/inventory-receipt-journey.spec.ts`:
  create GRN → accept → balance verified → low-stock clears.
- `tests/e2e-live/specs/inventory-cycle-count.spec.ts`:
  initiate → physical count → supervisor approve → ledger updated.

### 6.3 Integration Chain
- `tests/e2e-live/specs/procurement-full-chain.spec.ts`:
  indent → PO → dispatch → GRN → SRN → three-way-match passes → payment released.
- `tests/e2e-live/specs/threeway-mismatch.spec.ts`:
  GRN qty < PO qty → mismatch flagged → payment blocked.

---

## 7. Go-Live Infrastructure

### 7.1 GeM Integration  
Set `GEM_ENABLED=true`, `GEM_BASE_URL`, `GEM_API_KEY` in production `.env`.
Smoke test: `GET /v1/procurement/gem/items` returns live catalogue.

### 7.2 LocalStack Three-Way Match in CI
Enable `tests/integration/three-way-match-live.test.ts` in the nightly CI job using
`infra/localstack/docker-compose.yml`.

### 7.3 Performance Budget
LCP < 2.5 s on `/estab/files/list` and `/inventory/list` at simulated 4G.
Gate via Lighthouse CI in the nightly job.

### 7.4 IDOR Security Tests
New: `tests/security/idor-estab.test.ts` — cross-tenant 403 on files, allotments.
New: `tests/security/idor-inventory.test.ts` — cross-tenant 403 on movements, cycle-counts.

### 7.5 GIGW 3.0 Sign-off
Produce `docs/GIGW-COMPLIANCE-CHECKLIST.md` mapping each GIGW 3.0 checkpoint to its
implementing file or documented waiver.

---

## Acceptance Criteria Summary

| Req | Gate |
|---|---|
| 1.1 | SRN creates; payment blocked without SRN; released with SRN present |
| 1.2 | PATCH /v1/procurement/grns/:id updates qty; 409 if accepted |
| 1.3 | consumables.test.ts passes; domain + repo files present |
| 1.4 | No hardcoded "B" in records/consumer.ts; unit test passes |
| 1.5 | Cycle-count approve UI calls backend; status changes to approved |
| 1.6 | QC verdict panel writes qcStatus + disposition |
| 1.7 | /stock/* returns 301 to /inventory/* |
| 2.1 | Skip link visible on keyboard focus on all three layouts |
| 2.2 | Badge contrast ≥ 4.5:1 (contrast test passes) |
| 2.3 | Arrow-key + Enter/Space navigation on files table |
| 3.4 | Focus trapped in DispatchPOActions; Escape restores focus |
| 6.1 | estab-file-journey.spec.ts passes on staging |
| 6.3 | procurement-full-chain.spec.ts passes including SRN gate |
