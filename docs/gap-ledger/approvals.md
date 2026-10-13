# Detailed gap file — module `approvals`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 8



---
## /approvals  —  `approvals/home.html`

- **Source:** `apps/web/src/app/(app)/approvals/page.tsx`
- **Design reference:** `redesign/approvals/home.html`

### GAP-APPROVALS-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Only the first page is ever loaded: getMyApprovals() is called with defaults page 1, limit 15 (page.tsx:8; loaders.ts:5357-5362) and the client table pages only that array (ApprovalsTable.tsx:59-60), so Pending / Overdue / Action Required are capped at 15 and further tasks are unreachable — an approver with 40 items sees '15'.
- **Verified evidence:** page.tsx:8 calls getMyApprovals() with defaults; loaders.ts:5357 defaults page=1,pageSize=15 and sends limit=15&offset=0 to /api/v1/workflow/tasks (loaders.ts:5358-5362). ApprovalsTable.tsx:76 DataTable pageSize=15 only pages the array it was given. page.tsx:33,36 use approvals.length for Pending/Action Required and it is capped at 15; no total or next-page is read. Whether the workflow API returns a total is cannot-verify (workflow-service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/approvals/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/approvals/_components/ApprovalsTable.tsx`
- **Fix steps:**
  1. In loaders.ts getMyApprovals, read a total/count from the response envelope if the API returns one (confirm with workflow-service owner) and return {items,total}; otherwise raise the fetch to limit=200 (already the Math.min cap) as an interim.
  2. In page.tsx accept searchParams.page, pass it to getMyApprovals, and compute Pending from total, not approvals.length.
  3. Give ApprovalsTable server-side paging (Prev/Next links using searchParams) or pass total to DataTable so it shows 'x of N'.
  4. Show an 'showing first N of M' notice when total > rows loaded.
- **Acceptance:**
  - Unit test: mock API with 40 tasks -> Pending stat shows 40 and page 3 is reachable.
  - Manual: approver with 40 pending items sees all 40 across pages, none silently dropped.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals inbox: a silent cap hides pending items and can delay approvals; low regression risk.

### GAP-APPROVALS-HOME-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead links: default link is '/workflow/tasks' (loaders.ts:5410) and finance bills link to '/finance/bills/<id>' (loaders.ts:5406); neither route exists under apps/web/src/app/(app), so any task with an unmapped refType (works, crm, billing, asset…) or a finance bill 404s from the inbox.
- **Verified evidence:** loaders.ts:5406 maps finance_bill to /finance/bills/<id> and loaders.ts:5410 default returns /workflow/tasks. Neither exists: (app)/finance has no bills dir (bills live at (app)/finance/expenditure/bills/[id]); (app)/workflow has only list, instances/[id], definitions, designer. Line numbers in the observation are correct. Existing targets do exist: /hr/leave/approvals, /hr/payroll, /procurement/indents/[id], /procurement/orders/[id], /estab/files/[id]. Any other refType (works, crm, asset, grants...) falls to the default and 404s.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/workflow/tasks/[id]/page.tsx (new, optional)`
- **Fix steps:**
  1. Change finance_bill case to /finance/expenditure/bills/${refId}.
  2. Replace default with an existing generic target, e.g. /workflow/instances/${instanceId} if the task payload carries the instance id (verify the field), else /workflow/list; do not emit a route that does not exist.
  3. Extract buildApprovalLink to a pure function with a route table and add a unit test that every returned path matches a real app route.
  4. Add cases for other refTypes only after their detail routes are confirmed.
- **Acceptance:**
  - Unit test: buildApprovalLink('finance_bill','x') returns /finance/expenditure/bills/x.
  - Manual: click each row type in the inbox; none returns 404.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Approvers reaching the wrong or missing page may not act; approval routes themselves unchanged.
- **Depends on:** GAP-APPROVALS-HOME-07

### GAP-APPROVALS-HOME-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load shows real zeros: on source 'error' the stats still render Pending 0 / Overdue 0 (page.tsx:30-33) beside the error card — the number 0 contradicts 'Couldn't load' and a hurried approver may read it as 'nothing to do'. Sibling pages null-gate to '—'.
- **Verified evidence:** On source==='error' page.tsx renders StatCards with Pending=approvals.length=0 and Overdue=0 (page.tsx:33-36; the observation's 30-33 are slightly off) alongside the EmptyState error (page.tsx:40-46). No null gating.
- **Files to change:** `apps/web/src/app/(app)/approvals/page.tsx`
- **Fix steps:**
  1. In page.tsx compute const failed = source==='error' and pass value={failed ? '—' : n} to Pending, Overdue, Modules, Action Required StatCards.
  2. Replace the EmptyState error card with <RefreshErrorState> (ds/RefreshErrorState.tsx) with backHref='/dashboard'.
  3. Keep DataSourceBadge in actions.
- **Acceptance:**
  - Component test: source='error' -> no stat renders '0'; all show '—'.
  - Manual: stop workflow-service; page shows dashes plus retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-APPROVALS-HOME-07

### GAP-APPROVALS-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** 'How this works' help link points to /help/approvals (page.tsx:23) but helpContent.ts defines no 'approvals' slug (finance, procurement, hr, payroll, estab, grants, projects, citizen, tenant-admin), so the link 404s via notFound().
- **Verified evidence:** PageHeader help='approvals' (page.tsx:19) builds /help/${help} (PageHeader.tsx:48). lib/helpContent.ts defines slugs finance, procurement, hr, payroll, estab, grants, projects, citizen, tenant-admin only (lines 57-324); help/[module]/page.tsx calls notFound() for unknown slugs. error.tsx:15 also uses helpHref='/help/approvals'.
- **Files to change:** `apps/web/src/lib/helpContent.ts`, `apps/web/src/app/(app)/approvals/page.tsx`, `apps/web/src/app/(app)/approvals/error.tsx`
- **Fix steps:**
  1. Add an 'approvals' HelpModule to HELP_MODULES in lib/helpContent.ts (what it is, how to approve, terms), OR
  2. point help/helpHref to an existing slug, or drop the prop.
  3. Add a test iterating every help= / helpHref= slug in app to assert getHelpModule(slug) exists.
- **Acceptance:**
  - Manual: click 'How this works' on /approvals -> guide renders.
  - Unit: getHelpModule('approvals') is defined.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-APPROVALS-HOME-05  ·  MEDIUM  ·  partly  ·  theme LABELS (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Module chip falls back to the raw refType prefix, css-capitalised (ApprovalsTable.tsx:58,100-112): 'works', 'crm' or a typo appears as a raw code; MODULE_LABELS lacks works, crm, helpdesk, legal, grants and uses 'hrms'/'hr' inconsistently.
- **Verified evidence:** ApprovalsTable.tsx:58 uses MODULE_LABELS[item.module] ?? item.module and the chip has textTransform capitalize (line 104), so unknown prefixes show as e.g. 'Works'. MODULE_LABELS (13-24) lacks works, crm, helpdesk, legal, grants and has both 'hrms' and no 'hr'; module derives from refType.split('_')[0] (loaders.ts:5379), and the known refType leave_app yields 'leave', so 'hrms' is likely unreachable. No next-intl use here; strings are hardcoded English. Overstated: fallback is capitalised text, not a raw code.
- **Files to change:** `apps/web/src/app/(app)/approvals/_components/ApprovalsTable.tsx`
- **Fix steps:**
  1. Extend MODULE_LABELS with works, crm, helpdesk, legal, grants, hr; remove dead hrms.
  2. Fall back to humanizeStatus(item.module) from lib/formatters.ts instead of raw prefix.
  3. Add a text label to overdue marker (see -07) rather than only an emoji.
- **Acceptance:**
  - Unit: refType 'works_bill' renders 'Works'.
  - Unit: unknown prefix renders humanized text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-APPROVALS-HOME-06  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Pending and Action Required are the same number (page.tsx:30,33) — a redundant tile; Modules counts distinct raw prefixes. Overdue uses Date.now on the server render (page.tsx:10-12) while the table recomputes on the client (ApprovalsTable.tsx:61) so the two can disagree across midnight or with a stale cache.
- **Verified evidence:** True: Pending and Action Required both use approvals.length (page.tsx:34,36); Modules counts distinct prefixes (page.tsx:14); overdue computed server-side with Date.now (page.tsx:10-12) and again client-side (ApprovalsTable.tsx:61), and useSeededResource may swap in cached data (resource.ts:241-248) so counts can diverge from rows. Dates use toLocaleDateString('en-IN') with no timeZone (ApprovalsTable.tsx:30); lib/formatters formatIndianDate gives dd/MM/yyyy, not 'dd Mon yyyy'.
- **Files to change:** `apps/web/src/app/(app)/approvals/page.tsx`, `apps/web/src/app/(app)/approvals/_components/ApprovalsTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace the duplicate 'Action Required' tile with something distinct (e.g. Due today / Overdue > 7d) or drop it.
  2. Compute overdue in one shared helper used by both page stats and table rows, from the client data (move stats into a client component sharing the seeded data).
  3. Use formatIndianDate (add a timeZone:'Asia/Kolkata' option) instead of local formatDate.
- **Acceptance:**
  - Unit: overdue count equals number of rows flagged isOverdue.
  - Manual: tiles show four distinct metrics.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; tile choice needs product decision.
- **Depends on:** GAP-APPROVALS-HOME-03

### GAP-APPROVALS-HOME-07  ·  MEDIUM  ·  partly  ·  theme SORT (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** No decision affordance or confirmation here: approving happens in each module, so the inbox cannot confirm what was approved; Retry is an <a href='/approvals'> full navigation (page.tsx:42) not a refresh, and Due/Assigned are sortable as strings ('3d ago', '12 Sep 2026' — ApprovalsTable.tsx:47-53,81-97).
- **Verified evidence:** Inbox linking to modules for decisions is by design (rows link via link; approving elsewhere) so no ConfirmDialog belongs here. Real parts: Retry is <Link href='/approvals'> (page.tsx:44) to the same URL, not a router.refresh (RefreshErrorState exists in ds/); Assigned/Due sort on display strings (columns keyed assignedDisplay/dueDateDisplay, ApprovalsTable.tsx:112,117) and compareValues (DataTable.tsx:169) falls to localeCompare numeric, so 'Today','3d ago','12 Sep 2026' sort wrongly. Also rowLinkKey='link' without rowLinkPrefix does nothing (DataTable.tsx:212); the first-column Link handles navigation.
- **Files to change:** `apps/web/src/app/(app)/approvals/page.tsx`, `apps/web/src/app/(app)/approvals/_components/ApprovalsTable.tsx`
- **Fix steps:**
  1. Use RefreshErrorState for the error branch (with -03).
  2. Add sort keys: make columns key 'assignedAt' and 'dueDate' (raw ISO) with render functions for the display text, so compareValues sorts by string ISO or convert to epoch number fields.
  3. Remove the ineffective rowLinkKey prop.
- **Acceptance:**
  - Component test: sorting Assigned ascending orders by timestamp.
  - Manual: Retry re-fetches without full reload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; ignore the ConfirmDialog/maker-checker part of the suggested fix, not applicable to a list page.
- **Depends on:** GAP-APPROVALS-HOME-03

### GAP-APPROVALS-HOME-08  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx hard-codes a 4-column grid inline (loading.tsx:6) with no responsive collapse.
- **Verified evidence:** loading.tsx:6 uses inline gridTemplateColumns repeat(4,1fr) with no media query, so it does not collapse on mobile. StatGrid (real page) is a ds component with its own responsive CSS presumably; skeleton just differs.
- **Files to change:** `apps/web/src/app/(app)/approvals/loading.tsx`
- **Fix steps:**
  1. Wrap skeleton cards in the StatGrid component or a class from civitas-ds.css instead of inline grid.
  2. Keep skeleton counts matching the page (4 cards).
- **Acceptance:**
  - Manual: at 375px width, skeleton and real page have same column layout.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
