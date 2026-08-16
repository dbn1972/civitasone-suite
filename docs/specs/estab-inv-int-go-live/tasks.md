# Implementation Plan

## Overview

Closes the gaps identified in `docs/SPRINT-READINESS-ESTAB-INV-INT.html` across Establishment,
Inventory & Stock, and the Procurement integration chain, ahead of go-live. 40 tasks across four
sprints (21-24): P0 functional completeness, WCAG AA + UX polish, an E2E test suite, and go-live
gates. All work targets the monorepo at the root of this repository.

## Tasks

Tasks are ordered so shared foundations (DB migrations, service modules, redirects) land before
the UI layers that depend on them. Each task is self-contained, references its requirement(s),
names exact file paths, and ends in a typecheck- or test-verifiable state. Start each task on a
feature branch; open a PR when the task's acceptance test passes.

---

## Sprint 21 — P0 Functional Gaps (Aug 18 – Aug 29)

- [x] 1. Add `inventory.store_receipt_notes` DB migration
  - Create migration file in `services/inventory-service/src/db/migrations/`
  - Add table to `db/schema.sql` and `services/inventory-service/src/modules/srn/schema.ts`
  - Columns: `id uuid PK`, `tenant_id uuid NOT NULL`, `grn_id uuid NOT NULL REFERENCES grn.procurement_grns(id)`, `store_officer_id uuid NOT NULL`, `received_at timestamptz`, `remarks text`, `status text CHECK (status IN ('draft','signed'))`, `created_at timestamptz DEFAULT now()`
  - Enable RLS; add policy `tenant_id = current_setting('app.tenant_id')::uuid`
  - Run `pnpm --filter inventory-service db:migrate` to verify migration applies cleanly
  - _Requirements: 1.1_

- [x] 2. Build SRN service module
  - Create `services/inventory-service/src/modules/srn/` with: `schema.ts`, `domain.ts`, `commands.ts`, `repo.ts`, `routes.ts`, `validators.ts`
  - `domain.ts`: `canCreateSrn(grn: GrnRow): boolean` — true when `grn.status === 'accepted'`
  - `repo.ts`: `createSrn(tenantId, input)` · `findByGrnId(tenantId, grnId)`
  - `routes.ts`: `POST /v1/inventory/srn` · `GET /v1/inventory/srn/:grnId`
  - Wire into `services/inventory-service/src/app.ts` plugin registration
  - `services/inventory-service/tests/srn.test.ts`: create, find-by-grn, RLS isolation
  - _Requirements: 1.1, 5.2_

- [x] 3. Wire SRN gate into three-way-match consumer
  - In `services/inventory-service/src/modules/matching/consumer.ts`, check for an existing SRN (`findByGrnId`) before publishing `payment.released` event
  - If no SRN found, publish `payment.blocked` with `reason: 'SRN_MISSING'`
  - Add test in `services/inventory-service/tests/three-way-match.test.ts` for the SRN-missing block path
  - _Requirements: 1.1_

- [ ] 4. Build SRN web pages
  - `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/page.tsx` — form: store officer name (pre-filled from session), received date, remarks, sign button
  - `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx` — read view showing SRN details
  - Server loader calls `GET /v1/inventory/srn/:grnId`; form action calls `POST /v1/inventory/srn`
  - Add link to SRN from `/procurement/grn/[id]/page.tsx` (below acceptance status)
  - _Requirements: 1.1_

- [ ] 5. Add GRN amendment endpoint
  - In `services/procurement-service/src/modules/grn/routes.ts`: add `PATCH /v1/procurement/grns/:id`
  - `domain.ts`: `canAmendGrn(grn): boolean` — only when `status` is `draft` or `under_inspection`
  - Return 409 with `{ code: 'GRN_NOT_AMENDABLE' }` when guard fails
  - `services/procurement-service/tests/grn-amendment.test.ts`: happy path + 409 guard
  - _Requirements: 1.2, 5.3_

- [ ] 6. Add GRN edit form to web
  - `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`: render an edit form when `grn.status` is `draft` or `under_inspection`; read-only view otherwise
  - Form fields: per-line `receivedQty` and `acceptedQty`; submit calls `PATCH /v1/procurement/grns/:id`
  - _Requirements: 1.2_

- [ ] 7. Implement consumables domain + repo + migration
  - Migration: `files.estab_consumables (id, tenant_id, item_id, item_name, balance numeric, reorder_level numeric, unit text, updated_at)` with RLS
  - `services/estab-service/src/modules/consumables/domain.ts`: `isReorderRequired(balance, reorderLevel): boolean`
  - `services/estab-service/src/modules/consumables/repo.ts`: `getBalance(tenantId, itemId)` · `upsertBalance(tenantId, itemId, delta)`
  - `services/estab-service/tests/consumables.test.ts`: boundary tests + delta accumulation
  - _Requirements: 1.3, 5.1_

- [ ] 8. Fix records category placeholder
  - `services/estab-service/src/modules/records/consumer.ts` ~line 255: replace `recordCategory: "B"` with a derived value
  - Add a `getRecordCategory(fileType: string, classificationLevel: string): string` helper (e.g. "A" for Top Secret, "B" for Secret, "C" for Confidential, "D" for general)
  - Unit test asserting each classification maps to the correct category letter
  - _Requirements: 1.4_

- [ ] 9. Cycle-count supervisor approval UI
  - `apps/web/src/app/(app)/inventory/cycle-counts/[id]/page.tsx` (create if absent)
  - Render current cycle count details (systemQty, physicalQty, variance) and two action buttons: Approve (`PATCH /v1/inventory/cycle-counts/:id/approve`) and Reject
  - Add link from `/inventory/list` to cycle-count detail when status is `pending`
  - _Requirements: 1.5_

- [ ] 10. Goods-return QC verdict screen
  - `apps/web/src/app/(app)/inventory/goods-returns/[id]/page.tsx` (create if absent)
  - Render GRN reference, item details, and a QC form: verdict (pass/fail radio), disposition (select: return-to-vendor / scrap / accept-with-penalty), inspector notes
  - Submit calls `PATCH /v1/inventory/goods-returns/:id` with `{ qcStatus, disposition, remarks }`
  - _Requirements: 1.6_

- [ ] 11. Redirect legacy `/stock/*` routes to `/inventory/*`
  - In `apps/web/next.config.js`, add a `redirects()` array:
    - `{ source: '/stock', destination: '/inventory', permanent: true }`
    - `{ source: '/stock/list', destination: '/inventory/list', permanent: true }`
    - `{ source: '/stock/ledger', destination: '/inventory/reconcile', permanent: true }`
    - `{ source: '/stock/dashboard', destination: '/inventory', permanent: true }`
    - `{ source: '/stock/:path*', destination: '/inventory/:path*', permanent: true }`
  - Verify 301 response on `/stock` in the dev server
  - _Requirements: 1.7_

---

## Sprint 22 — WCAG AA + UX Polish (Sep 1 – Sep 12)

- [ ] 12. Add skip-to-main link to all three module layouts
  - Edit `apps/web/src/app/(app)/estab/layout.tsx`, `inventory/layout.tsx`, `procurement/layout.tsx`
  - Insert as first child of the layout root:
    ```tsx
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-navy focus:px-3 focus:py-1 focus:rounded">
      Skip to main content
    </a>
    ```
  - Add `id="main-content"` to `<main>` in each layout or page
  - _Requirements: 2.1_

- [ ] 13. Fix file status badge contrast
  - Search `apps/web/src/app/(app)/estab/` for `#FF6B00` or equivalent; replace with `#C55200`
  - Add a unit test in `apps/web/src/lib/__tests__/contrast.test.ts` using the WCAG relative-luminance formula to assert `contrast('#C55200', '#FFFFFF') >= 4.5`
  - _Requirements: 2.2_

- [ ] 14. Keyboard row selection on estab/files table
  - `apps/web/src/app/(app)/estab/files/list/FilesTable.tsx`
  - Add `role="grid"` on `<table>`, `role="row"` + `tabIndex={0}` on `<tr>`, `onKeyDown` on each row:
    ```tsx
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') router.push(`/estab/files/${file.id}`) }}
    ```
  - _Requirements: 2.3_

- [ ] 15. Add ARIA live region to NotificationsPanel
  - `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`
  - Wrap the notification list with `<div aria-live="polite" aria-atomic="false">`
  - _Requirements: 2.4_

- [ ] 16. Quarter allotment table caption
  - `apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx`
  - Add `<caption className="sr-only">Quarter allotments — current financial year</caption>` as first child of `<table>`
  - _Requirements: 2.5_

- [ ] 17. DFA wizard step-change announcement
  - In `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx` (or wherever the wizard step state lives)
  - Add a visually-hidden `<span aria-live="assertive" aria-atomic="true">{currentStepTitle}</span>` that updates on step advance
  - _Requirements: 2.6_

- [ ] 18. Add chart alternative data tables
  - For the forecast chart on `/inventory`: add a `<table className="sr-only">` sibling with the same time-series data
  - For the vendor scorecard radar on `/procurement/vendors/[id]/scorecard`: add a `<table className="sr-only">` with dimension scores
  - Both tables must be reachable by keyboard (sr-only class, not display:none)
  - _Requirements: 3.1_

- [ ] 19. Movement type chips ARIA
  - `apps/web/src/app/(app)/inventory/MovementsTable.tsx`
  - Add `role="status"` and `aria-label={\`Movement type: ${movementType}\`}` to each chip
  - _Requirements: 3.2_

- [ ] 20. Inventory reconcile variance encoding
  - `apps/web/src/app/(app)/inventory/reconcile/StockLedgerTable.tsx` (or equivalent)
  - Prepend ▲ to positive variance values and ▼ to negative values alongside the existing colour
  - _Requirements: 3.3_

- [ ] 21. DispatchPOActions modal focus trap
  - `apps/web/src/app/(app)/procurement/orders/[id]/DispatchPOActions.tsx`
  - Import and apply `FocusTrap` from `focus-trap-react` (add if not already a dependency)
  - Ensure `Escape` key calls the close handler and returns focus to the trigger button
  - _Requirements: 3.4_

- [ ] 22. CreateGRNForm required-field ARIA
  - `apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`
  - Add `aria-required="true"` to each required input/select
  - Assign unique `id` to each error message and point the input to it via `aria-describedby`
  - _Requirements: 3.5_

- [ ] 23. LineItemsEditor delete button label
  - `apps/web/src/app/(app)/procurement/_components/LineItemsEditor.tsx`
  - Change `<button onClick={...}>×</button>` to `<button aria-label={\`Remove line item ${n + 1}\`} onClick={...}>×</button>`
  - _Requirements: 3.6_

- [ ] 24. Empty-state illustrations on three estab pages
  - `apps/web/src/app/(app)/estab/files/list/page.tsx`: pass `emptyIcon="📁"` `emptyTitle="No files yet"` `emptyMessage="Create a new file to begin managing correspondence."` `emptyAction={<Link href="/estab/workspace">Create file</Link>}` to DataTable
  - `apps/web/src/app/(app)/estab/meetings/page.tsx`: `emptyIcon="📅"` `emptyTitle="No meetings scheduled"` `emptyMessage="Schedule a committee or departmental meeting."` `emptyAction={<Link href="/estab/meetings/new">Schedule meeting</Link>}`
  - `apps/web/src/app/(app)/estab/vehicles/page.tsx`: `emptyIcon="🚗"` `emptyTitle="No vehicles registered"` `emptyMessage="Add a vehicle to begin fleet management."` `emptyAction={<Link href="/estab/vehicles/new">Add vehicle</Link>}`
  - _Requirements: 4.1_

- [ ] 25. Mobile table overflow fix
  - Search `apps/web/src/app/(app)/estab/`, `apps/web/src/app/(app)/inventory/`, `apps/web/src/app/(app)/procurement/` for `<table` and `<DataTable` components
  - Ensure every table is wrapped in `<div style={{ overflowX: 'auto' }}>` or equivalent Tailwind `overflow-x-auto` container
  - Manual verify at 375 px viewport in Chrome DevTools
  - _Requirements: 4.2_

- [ ] 26. File movement timeline component
  - Create `apps/web/src/app/(app)/estab/files/[id]/MovementTimeline.tsx`
  - Render `estab_file_movements` as a vertical timeline: date chip → action verb → from-officer → to-officer arrow → status badge
  - Replace the existing flat list on `apps/web/src/app/(app)/estab/files/[id]/page.tsx` with `<MovementTimeline movements={movements} />`
  - _Requirements: 4.3_

---

## Sprint 23 — E2E Suite (Sep 15 – Sep 26)

- [ ] 27. Establishment file journey E2E spec
  - `tests/e2e-live/specs/estab-file-journey.spec.ts`
  - Steps: login as estab officer → create new file via `/estab/workspace` → add noting → submit for DFA → login as approver → approve → verify dispatch status
  - Use existing `tests/e2e-live/` config and `baseURL` from env
  - _Requirements: 6.1_

- [ ] 28. Establishment quarters journey E2E spec
  - `tests/e2e-live/specs/estab-quarters-journey.spec.ts`
  - Steps: apply for quarter → allotment officer grants allotment → applicant occupies → vacate
  - _Requirements: 6.1_

- [ ] 29. Inventory receipt journey E2E spec
  - `tests/e2e-live/specs/inventory-receipt-journey.spec.ts`
  - Steps: create GRN → accept → navigate to `/inventory/balances` → verify item balance increased → if item was below reorder level, verify it cleared from low-stock list
  - _Requirements: 6.2_

- [ ] 30. Inventory cycle-count E2E spec
  - `tests/e2e-live/specs/inventory-cycle-count.spec.ts`
  - Steps: store officer initiates cycle count → enters physical qty → supervisor navigates to `/inventory/cycle-counts/:id` → approves → verify ledger updated
  - _Requirements: 6.2_

- [ ] 31. Full procurement chain E2E spec (includes SRN)
  - `tests/e2e-live/specs/procurement-full-chain.spec.ts`
  - Steps: raise indent → create PO → dispatch PO → create GRN → accept GRN → create SRN → verify three-way match passes → verify payment released event emitted
  - _Requirements: 6.3_

- [ ] 32. Three-way-match mismatch E2E spec
  - `tests/e2e-live/specs/threeway-mismatch.spec.ts`
  - Steps: create PO for qty 100 → create GRN for qty 60 → verify three-way match flags mismatch → verify payment.blocked event with reason `QTY_MISMATCH`
  - _Requirements: 6.3_

- [ ] 33. Enable LocalStack three-way-match in CI nightly
  - Edit `.github/workflows/nightly.yml` (or equivalent): add LocalStack service container step and run `tests/integration/three-way-match-live.test.ts`
  - _Requirements: 7.2_

- [ ] 34. Add ARIA-visible data tables alongside charts
  - This is the test-verifiable side of task 18: write Playwright `expect(page.getByRole('table'))` assertions on the forecast and scorecard pages
  - _Requirements: 3.1_

---

## Sprint 24 — Go-live Gates (Sep 29 – Oct 10)

- [ ] 35. IDOR security integration tests
  - `tests/security/idor-estab.test.ts`:
    - `GET /v1/estab/files/:id` with a different tenant's file id → expect 403
    - `GET /v1/estab/quarters/allotments/:id` cross-tenant → expect 403
  - `tests/security/idor-inventory.test.ts`:
    - `GET /v1/inventory/movements/:id` cross-tenant → expect 403
    - `GET /v1/inventory/cycle-counts/:id` cross-tenant → expect 403
  - _Requirements: 7.4_

- [ ] 36. Performance baseline + Lighthouse CI gate
  - Add `lighthouserc.js` at repo root: assert LCP < 2500 ms, TBT < 300 ms on `/estab/files/list` and `/inventory/list`
  - Add Lighthouse CI step to the nightly GitHub Actions job
  - _Requirements: 7.3_

- [ ] 37. GeM production configuration
  - Set `GEM_ENABLED=true`, `GEM_BASE_URL`, `GEM_API_KEY` in the production PM2 environment (`.env.production` or AWS SSM Parameter Store)
  - Smoke test: `curl /v1/procurement/gem/items` returns items with `meta.integrationDisabled` absent
  - _Requirements: 7.1_

- [ ] 38. GIGW 3.0 compliance checklist
  - Create `docs/GIGW-COMPLIANCE-CHECKLIST.md`
  - Map each GIGW 3.0 checkpoint (Section 2–9) to the implementing file path or a documented waiver
  - _Requirements: 7.5_

- [ ] 39. Restore-drill verification for estab + inventory schemas
  - Add a restore-drill test entry in `tests/ops/restore-drill.test.ts` for the `files`, `quarters`, `spaces`, and `inventory` PG schemas
  - Confirm the drill is included in the nightly ops test run
  - _Requirements: 7.5 (operational gate)_

- [ ] 40. Staging full-data smoke run sign-off
  - Seed staging tenant with ≥ 500 estab files, ≥ 1 000 inventory items, ≥ 200 procurement POs
  - Run the full E2E suite (`tests/e2e-live/`) against staging; all specs must pass
  - Record pass/fail in `docs/STAGING-SIGN-OFF-SPRINT24.md`
  - _Requirements: all_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "5", "7", "8", "9", "10", "11"] },
    { "id": 2, "tasks": ["3", "6"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26"] },
    { "id": 5, "tasks": ["27", "28", "29", "30", "31", "32", "33", "34"] },
    { "id": 6, "tasks": ["35", "36", "37", "38", "39"] },
    { "id": 7, "tasks": ["40"] }
  ]
}
```

Notes on the graph:
- Wave 0-3 (Sprint 21): 1 → 2 → 3 → 4 is the SRN chain (migration → module → payment
  gate → web pages). 5 → 6 is the GRN amendment chain. 7-11 have no dependencies
  within this spec and can run in parallel with the SRN/GRN chains.
- Wave 4 (Sprint 22): all WCAG/UX tasks are independent of each other and of
  Sprint 21; 18 and 34 are paired (component + its Playwright assertion) but 34
  is deferred to wave 5 since it's an E2E-suite task.
- Wave 5 (Sprint 23 E2E): 27/28 exercise estab features only; 29/30 depend on 7
  and 9; 31/32 depend on the full SRN + GRN amendment chain (1-6); 33 is
  infra-only; 34 depends on 18.
- Wave 6-7 (Sprint 24): go-live gates depend on all prior sprints being merged.
  40 (staging sign-off) runs last, after 35-39.

## Notes

- Task 1-3 are implemented, committed, and pushed via PR #644
  (`kiro/estab-inv-int-go-live` branch, not yet merged — pending CI/review):
  `inventory.store_receipt_notes` migration, the `srn` CQRS module,
  and the SRN gate in `matching/consumer.ts` (payment.released only when the
  three-way match is clean AND the SRN is signed; payment.blocked with
  `SRN_MISSING` or `MATCH_EXCEPTION` otherwise). Verified: `tsc --noEmit`
  clean, `services/inventory-service/tests/srn.test.ts` (8 cases) + full
  service suite (555/556; the 1 failure is a pre-existing unrelated HRMS
  seed-data issue).
- `.kiro/specs/estab-inv-int-go-live/` (this copy) is gitignored — it is not
  the source of truth for anyone working from a plain git checkout.
  `docs/specs/estab-inv-int-go-live/` is the git-tracked mirror and must be
  kept in sync manually after each task's checkbox changes here, since there
  is currently no automated sync between the two.
- Per `.kiro/steering/git-workflow.md`: work happens in
  `wt/kiro-estab-inv-int-go-live` on branch `kiro/estab-inv-int-go-live`, never
  directly on `main`. Each task's PR should be reviewed and CI-green before
  merge; if CI is red for reasons unrelated to the task (e.g. a pre-existing
  pipeline infra issue), that must be verified against `main`'s own CI before
  requesting a merge decision.
