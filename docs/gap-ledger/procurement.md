# Detailed gap file — module `procurement`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 172, BACKEND-VERIFY 44



---
## /procurement  —  `procurement/home.html`

- **Source:** `apps/web/src/app/(app)/procurement/page.tsx`
- **Design reference:** `redesign/procurement/home.html`

### GAP-PROCUREMENT-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gating: all 16 tiles (Approvals, Bid Evaluation, EMD & BG, Empanelment) render for every user; layout only checks the tenant module flag (layout.tsx:14, page.tsx:6-23). Users who get 403s deep in the tree see no hint up front.
- **Verified evidence:** procurement/page.tsx:6-23 defines 16 static tiles rendered unconditionally via LinkTiles (:30); layout.tsx only wraps children in ModuleGate moduleKey='procurement' (tenant module flag, ModuleGate.tsx). NavTile/LinkTiles have no role field. A role-check pattern exists elsewhere (hr/rti/page.tsx:37-40 using getSessionRoles + PermissionDenied). The role-to-tile map and backend 403 behaviour are not documented in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/procurement/page.tsx`, `apps/web/src/app/_components/LinkTiles.tsx`, `packages/types (NavTile: optional roles)`
- **Fix steps:**
  1. Agree a role matrix for procurement tiles (e.g. Approvals, Bid Evaluation, EMD & BG, Empanelment).
  2. Add optional `roles?: string[]` to NavTile; in page.tsx filter with getSessionRoles() from @/lib/auth/roleGuard (always allow super_admin).
  3. Optionally render disabled tiles with a 'Requires <role>' hint instead of hiding.
  4. Keep server enforcement; add PermissionDenied on the sub-pages that lack it.
- **Acceptance:**
  - Unit test: user without approver role does not see Approvals tile.
  - super_admin sees all 16.
  - Direct URL still returns 403/PermissionDenied for unauthorised users.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Hiding wrongly locks legitimate users out of navigation; matrix must match backend RBAC.

### GAP-PROCUREMENT-HOME-02  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Title comes from next-intl t("title") but subtitle is a hard-coded English string (page.tsx:29) — untranslatable in the Odia/Hindi locales.
- **Verified evidence:** procurement/page.tsx:29 passes title={t('title')} but subtitle is the literal 'Requisitions, vendors, purchase orders, and tenders with approval controls.' Also all 16 tile titles/descriptions (:7-22) are hard-coded English. Correction: locale files are en, hi, kn, ta, te (apps/web/src/messages/*.json) - there is no Odia file. The 'procurement' namespace exists (en.json:3666) with title/tenders/... keys but no subtitle.
- **Files to change:** `apps/web/src/app/(app)/procurement/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/messages/kn.json`, `apps/web/src/messages/ta.json`, `apps/web/src/messages/te.json`
- **Fix steps:**
  1. Add procurement.subtitle (and optionally tiles.<key>.title/description) to en.json and other locales.
  2. Replace the literal at :29 with t('subtitle').
  3. Convert procurementTiles into a function that takes t and builds NavTile[] from message keys.
  4. Run the i18n key-parity check if present.
- **Acceptance:**
  - Switching to hi shows Hindi subtitle.
  - All locale files contain the new keys (parity test).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; translations need sign-off.

### GAP-PROCUREMENT-HOME-03  ·  LOW  ·  partly  ·  theme NAVIGATION (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Duplicate hubs: /procurement (16 tiles) and /procurement/dashboard (8 quick links + 4 stats) overlap; the dashboard omits Annual Plans, Bid Evaluation, Reverse Auction, GeM, EMD & BG, Empanelment and Pre-Bid (dashboard/page.tsx:6-15).
- **Verified evidence:** dashboard/page.tsx:6-15 QUICK_LINKS has 8 links (Indents, Vendors, RFQ, POs, GRN, Contracts, Tenders, Approvals); the home page has 16 tiles incl. Dashboard, so 7 modules are absent from the dashboard exactly as listed (Annual Plans, Bid Evaluation, Reverse Auction, GeM, EMD & BG, Empanelment, Pre-Bid). This is an information-architecture observation, not a validation issue; the dashboard is a stats snapshot with shortcuts and the hub is the full index, so overlap is partly intentional.
- **Files to change:** `apps/web/src/app/(app)/procurement/dashboard/page.tsx`, `apps/web/src/app/(app)/procurement/page.tsx`
- **Fix steps:**
  1. Extract one shared tile registry (e.g. procurement/_components/navTiles.ts) used by both pages.
  2. Dashboard shows a 'Frequently used' subset by flag plus 'All modules' link to /procurement.
  3. Or drop the quick-links from the dashboard and link to the hub.
- **Acceptance:**
  - Adding a tile in the registry appears on the hub without editing the dashboard.
  - Dashboard has an 'All modules' link.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-HOME-01

### GAP-PROCUREMENT-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** not-found.tsx offers no action — no "Back to Procurement" link, unlike error.tsx (not-found.tsx:5-8 vs error.tsx:10-12).
- **Verified evidence:** procurement/not-found.tsx renders only <EmptyState title message> with no action (file lines 3-8), while error.tsx uses RouteError with backHref='/procurement' and backLabel 'Back to Procurement' (error.tsx:7-14). EmptyState accepts an `action` prop (used in grn/page.tsx:76).
- **Files to change:** `apps/web/src/app/(app)/procurement/not-found.tsx`
- **Fix steps:**
  1. Import Link from next/link.
  2. Pass action={<Link href='/procurement' className='btn primary'>Back to Procurement</Link>} to EmptyState.
  3. Keep copy; optionally add link to Dashboard.
- **Acceptance:**
  - Visiting /procurement/nonexistent shows a working Back to Procurement button.
  - Keyboard focusable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/approvals  —  `procurement/approvals.html`

- **Source:** `apps/web/src/app/(app)/procurement/approvals/page.tsx`
- **Design reference:** `redesign/procurement/approvals.html`

### GAP-PROCUREMENT-APPROVALS-01  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Approvals can be missed: the queue fetches /v1/workflow/tasks?status=pending&limit=50 across all modules, then filters client-side to four procurement refTypes (Panel:60, toTasks:36-41). With >50 pending tasks tenant-wide, procurement tasks past the cut-off never render and "No pending tasks" reads as all clear.
- **Verified evidence:** ProcurementApprovalsPanel.tsx:58-61 fetches /v1/workflow/tasks?status=pending&limit=50 with no refType filter; toTasks (l.36-41) filters client-side to four refTypes. Any procurement tasks beyond the first 50 tenant-wide pending tasks are never shown, and the empty state (l.197-198) says 'No pending procurement workflow tasks'. Server-side refType filter/cursor support is unverifiable (workflow-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/ProcurementApprovalsPanel.tsx`
- **Fix steps:**
  1. Confirm whether /v1/workflow/tasks supports refType (or refTypes) filtering and cursor/offset; add it server-side if not.
  2. Pass the four refTypes in the query and paginate (load more / page param) until exhausted.
  3. If no more pages exist beyond limit, show 'Showing first 50 - more not loaded' warning when response length===limit.
  4. Drop the client-side filter once server filters.
- **Acceptance:**
  - Test: mock 60 pending tasks with procurement ones at positions 55-60; they render.
  - Response length == limit shows the 'may be incomplete' notice.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals silently invisible delay payments/POs and SLA escalations.

### GAP-PROCUREMENT-APPROVALS-02  ·  HIGH  ·  confirmed  ·  theme DATA-CONSISTENCY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — mapApprovals returns [] when empty (loaders.ts); Action Required card replaced by distinct metrics; two sources (approvals table vs workflow panel) still unreconciled
- **First-pass claim:** Two unreconciled approval sources on one page: the stat cards and top table count /procurement/approvals (page.tsx:41-44) while the actionable queue reads workflow tasks; an approver can see "Pending Approvals 0" above a non-empty queue, or vice-versa. "Action Required" repeats the same number as "Pending Approvals" (page.tsx:41,44).
- **Verified evidence:** page.tsx:16,41,44 stats and the top DataTable come from getProcurementApprovals (/api/v1/procurement/approvals); the actionable queue in ProcurementApprovalsPanel comes from /v1/workflow/tasks - separate sources, no reconciliation. 'Pending Approvals' (l.41) and 'Action Required' (l.44) both = approvals.length. Extra finding: loaders.ts:625 mapApprovals returns null for an empty list, which apiClient.ts:155-158 treats as invalid_payload, so a genuinely empty approvals list renders the load ErrorState instead of 'No pending approvals'.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/procurement/approvals/page.tsx`, `apps/web/src/app/(app)/procurement/approvals/ProcurementApprovalsPanel.tsx`
- **Fix steps:**
  1. Decide the single source of truth (workflow tasks) and derive stats from it, or remove the duplicate top table.
  2. Change mapApprovals to return [] (not null) when rows is a valid empty array; return null only for a non-array payload.
  3. Replace duplicate 'Action Required' card with a distinct metric (e.g. Assigned to me) or delete it.
  4. If both must stay, label each source explicitly.
- **Acceptance:**
  - Test: payload [] -> source 'api' and EmptyState shown.
  - Manual: stats total equals queue row count on same data.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approver may act on the wrong list; touching mapApprovals affects only this loader.
- **Depends on:** GAP-PROCUREMENT-APPROVALS-01, GAP-PROCUREMENT-APPROVALS-03

### GAP-PROCUREMENT-APPROVALS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as good news in the stats: on source "error" the table shows ErrorState but the four StatCards are real zeros (page.tsx:41-48) — compare dashboard/page.tsx which renders "—".
- **Verified evidence:** page.tsx:41-44: on source==='error' approvals is [] so all four StatCards render 0/0/0/0; only the table (l.48-53) shows ErrorState plus header badge (l.35). The role-features and abac pages in the policy module already use `errored ? "—"`.
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/page.tsx`
- **Fix steps:**
  1. Compute const errored = source === 'error'.
  2. Pass value={errored ? '—' : ...} to all four StatCards.
  3. Consider hiding the stats grid entirely when errored.
- **Acceptance:**
  - Test: mock error source -> stat cards show '—'.
  - Manual: with gateway down no card shows 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PROCUREMENT-APPROVALS-02

### GAP-PROCUREMENT-APPROVALS-04  ·  MEDIUM  ·  partly  ·  theme DATA (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — dueAt date-based overdue count + raw ID column dropped; Reference cell in page table still plain text (no link)
- **First-pass claim:** "Overdue / Today" is computed by substring-matching the display string dueDisplay for "overdue" or "today" (page.tsx:18) — breaks with any localisation or wording change; the table shows raw "Approval ID" and reference codes, unlinked (page.tsx:63-68).
- **Verified evidence:** page.tsx:18 confirmed: overdue = dueDisplay.toLowerCase() includes 'overdue' or 'today' (also counts 'Due today' as overdue). dueDisplay is a server-provided display string (loaders.ts:621). Table (l.63-68) prints 'Approval ID' from id and Reference as plain text with no link. Note the queue in the Panel does link references (refLink).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/procurement/approvals/page.tsx`
- **Fix steps:**
  1. Add a dueAt ISO date to ApprovalSummary in mapApprovals (from row.dueAt/dueDate if the API returns it - verify) and compute overdue by comparing dates.
  2. Rename card 'Due today or overdue' or split into two.
  3. Hide the raw Approval ID column (or use formatInternalRef) and link Reference to the document route.
  4. Fall back to hiding the count if no date field is available.
- **Acceptance:**
  - Unit: item with dueAt yesterday counts overdue; with locale-changed display string still counts.
  - Reference cell renders a link.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong overdue count misleads escalation follow-up.
- **Depends on:** GAP-PROCUREMENT-APPROVALS-02

### GAP-PROCUREMENT-APPROVALS-05  ·  MEDIUM  ·  partly  ·  theme MISSING-LINK (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Reference link missing for procurement_po_amendment: refLink handles indent, PO and plan only (Panel:102-108) though REF_TYPES includes amendments (Panel:34), so amendment tasks show a bare id.
- **Verified evidence:** Panel refLink (l.102-111) handles indent, po and plan; amendments intentionally return null (comment l.106-109): refId is the amendment id and no per-amendment route exists. So bare id is real but deliberate; orders/[id]/amend exists but needs the PO id, which the task does not carry. Not a bug of omission in the UI alone.
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/ProcurementApprovalsPanel.tsx`
- **Fix steps:**
  1. Ask workflow/procurement for the parent PO id on amendment tasks (e.g. task payload poId) and then link to /procurement/orders/<poId>.
  2. Until then show a readable label ('PO amendment') beside the id instead of a bare UUID, and include the document name in the task.
- **Acceptance:**
  - Amendment task row shows type label.
  - With poId available the link opens the PO amend page.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-APPROVALS-06  ·  MEDIUM  ·  confirmed  ·  theme ERRORCOPY (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Approval failures show the raw response body in the dialog (msg = text || …, Panel:83-85) — a JSON/SoD error string can reach the clerk unformatted; no SoD-specific copy unlike InspectGrnForm.tsx:53-55.
- **Verified evidence:** Panel:81-86 sets msg = response text (raw body) or `${decision} failed (${status})` and passes it to ConfirmDialog errorMessage (l.222); catch (l.91-94) also uses err.message. This contradicts useFormError's rule of never showing raw server text/status. InspectGrnForm.tsx:47-54 maps code SOD_VIOLATION to human copy.
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/ProcurementApprovalsPanel.tsx`, `apps/web/src/lib/messages.ts`
- **Fix steps:**
  1. Parse the body as JSON envelope; map code SOD_VIOLATION to 'You raised this request, so a different approver must decide it.'.
  2. Otherwise use toHumanError('save',{area:'approval'}) text; never display raw text or status.
  3. Reuse useFormError.fromResponse (add SOD_VIOLATION to its CODE_TO_KIND/messages) instead of hand-rolled parsing.
  4. Keep the network-error fallback via fromException.
- **Acceptance:**
  - Test: 403 {code:'SOD_VIOLATION'} shows SoD copy.
  - Test: 500 with HTML body shows generic copy with no status/HTML.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Approve/reject is an approval-critical path; keep offline queue (fetchOrQueue) behaviour untouched.

### GAP-PROCUREMENT-APPROVALS-07  ·  LOW  ·  confirmed  ·  theme MISSING-DATA (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Row Approve/Reject buttons are the only actions; approving requires no visibility of the indent value (Task name + ref id only), so the approver must open the document first.
- **Verified evidence:** Panel columns (l.138-181) are Task name, Reference (id), Role, Actions; the ConfirmDialog description shows name and refId only. WorkflowTask type (l.11-19) carries no amount, so the value is not available without another fetch or a backend addition.
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/ProcurementApprovalsPanel.tsx`
- **Fix steps:**
  1. Ask workflow-service to include a summary (title, amount in paise, requester) on procurement tasks, or fetch the indent/PO summary per row.
  2. Add Amount and Requested by columns, formatted with formatMoney(paise).
  3. Show the same details in the ConfirmDialog description.
  4. Until then make the Reference link open in the same tab with clear 'Review document' label.
- **Acceptance:**
  - Row shows amount and requester.
  - Approve dialog restates amount.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals without seeing value is a control weakness; money must render from paise.
- **Depends on:** GAP-PROCUREMENT-APPROVALS-05


---
## /procurement/approvals/escalation  —  `procurement/approvals-escalation.html`

- **Source:** `apps/web/src/app/(app)/procurement/approvals/escalation/page.tsx`
- **Design reference:** `redesign/procurement/approvals-escalation.html`

### GAP-PROCUREMENT-APPROVALS-ESCALATION-02  ·  LOW  ·  confirmed  ·  theme COPY (was MONEY)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Overlapping bands: "Up to ₹1,00,000" and "₹1,00,000 – ₹10,00,000" both include ₹1,00,000, and "₹10,00,000" sits in both the middle and "Above" bands (page.tsx:14-16); bands are free text, not numeric, so nothing can be compared or exported.
- **Verified evidence:** escalation/page.tsx:14-16 bands are literal strings: 'Up to ₹1,00,000', '₹1,00,000 – ₹10,00,000', 'Above ₹10,00,000'; boundary values appear in two bands each. Rows are static (comment l.9-12), EscalationRow fields are strings, not numbers. Nothing verifies they match the workflow service routing.
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/escalation/page.tsx`
- **Fix steps:**
  1. Model rows with numeric minPaise/maxPaise (bigint or number) and half-open ranges [min,max).
  2. Generate labels with formatMoney (lib/formatters.ts) e.g. '₹1,00,000 and below' / 'Over ₹1,00,000 up to ₹10,00,000' / 'Over ₹10,00,000'.
  3. Add a unit test asserting bands are contiguous and non-overlapping.
  4. If backend exposes thresholds, load them instead of hard-coding.
- **Acceptance:**
  - Unit: for every boundary value exactly one band matches.
  - Rendered text shows no boundary in two bands.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Ambiguity at exactly the boundary amount could send an approval to the wrong authority if users rely on this table; confirm real GFR thresholds first.

### GAP-PROCUREMENT-APPROVALS-ESCALATION-03  ·  LOW  ·  partly  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Escalates after N working days" has no calendar reference (no holiday list or SLA owner) and there is no link to the approvals it affects other than the back link (page.tsx:36-37).
- **Verified evidence:** escalation/page.tsx:22,36-37: 'Escalates after' shows '2 working days' etc.; no holiday calendar or owner is referenced, and only the back link (backLabel) leads elsewhere. True but this is a static reference page; the calendar source cannot be verified (workflow service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/escalation/page.tsx`
- **Fix steps:**
  1. Add a footnote naming the working-day calendar used (or link to the holiday calendar page if one exists) and the SLA owner role.
  2. Add a link 'View pending approvals' to /procurement/approvals in the card footer or header actions.
- **Acceptance:**
  - Page has a link to the pending queue.
  - Footnote text names the calendar.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None; needs business input for calendar wording.

### GAP-PROCUREMENT-APPROVALS-ESCALATION-04  ·  LOW  ·  confirmed  ·  theme STYLE (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** SoD list uses inline styles instead of a DS list/Card body (page.tsx:49) — one of the few places this module bypasses the design system.
- **Verified evidence:** escalation/page.tsx:49 uses <ul style={{margin:0,paddingLeft:20,fontSize:14,lineHeight:1.7}}> inline. Low-impact style deviation.
- **Files to change:** `apps/web/src/app/(app)/procurement/approvals/escalation/page.tsx`
- **Fix steps:**
  1. Replace inline style with an existing utility/list class in the ds stylesheet (or add a .ds-list class in globals) and apply it.
- **Acceptance:**
  - Rendered list looks identical; no inline style attribute on the ul.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /procurement/bid-evaluation  —  `procurement/bid-evaluation.html`

- **Source:** `apps/web/src/app/(app)/procurement/bid-evaluation/page.tsx`
- **Design reference:** `redesign/procurement/bid-evaluation.html`

### GAP-PROCUREMENT-BID-EVALUATION-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as an empty, healthy register: stats are 0 and the table card shows "No evaluations found" under a "showing nothing" badge (page.tsx:6-10, BidEvaluationTable.tsx:50-57). Useful only if the clerk reads the small badge.
- **Verified evidence:** On fetch failure getProcurementBidEvaluations returns [] source 'error'; page.tsx:8-10,24-27 show 0 in all stat cards. The table (BidEvaluationTable.tsx:83-91, obs said 50-57) shows an amber DataSourceBadge with 'Couldn't load — showing nothing' plus, since rows empty, EmptyState 'No evaluations found' — i.e. no ErrorState/retry, and the empty message contradicts the badge. If a cache exists the cached rows show instead. error.tsx exists but only catches thrown errors.
- **Files to change:** `apps/web/src/app/(app)/procurement/bid-evaluation/page.tsx`, `apps/web/src/app/(app)/procurement/bid-evaluation/BidEvaluationTable.tsx`
- **Fix steps:**
  1. Pass provenance-derived flag to stats: show '—' when source==='error'.
  2. In the table, when provenance==='error-no-data' render <ErrorState error={toHumanError('load',{area:'bid evaluations'})}/> instead of EmptyState.
  3. Keep the badge for cached provenance only.
- **Acceptance:**
  - Test: source 'error' with no cache -> ErrorState, stat cards '—'.
  - Test: empty valid list -> EmptyState 'No evaluations found'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-BID-EVALUATION-02

### GAP-PROCUREMENT-BID-EVALUATION-02  ·  MEDIUM  ·  confirmed  ·  theme DATA-CONSISTENCY (was FAILMASK)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat cards and table use different data: stats derive from the server fetch (page.tsx:8-10) while rows come from useSeededResource, which swaps in a stale cache when the live fetch is empty or fails (resource.ts:232-249) — counts can disagree with visible rows.
- **Verified evidence:** page.tsx:6-10 computes stats from the server-fetched `evaluations`; BidEvaluationTable.tsx:54-59 renders rows from useSeededResource, which reads a cached copy when server data is empty or errored (resource.ts:232-249). With a cache hit, rows show but stats derive from the empty server list. Also `Card` import in page.tsx:1 is unused.
- **Files to change:** `apps/web/src/app/(app)/procurement/bid-evaluation/page.tsx`, `apps/web/src/app/(app)/procurement/bid-evaluation/BidEvaluationTable.tsx`
- **Fix steps:**
  1. Move the stat cards into the client component (or a small BidEvaluationStats client child) and compute them from the `rows` returned by useSeededResource.
  2. Have page.tsx only fetch and pass data/source.
  3. Remove unused Card import.
- **Acceptance:**
  - Test: server [] + cached 3 rows -> stats reflect the 3 rows.
  - Stats and table always equal for the same data.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-BID-EVALUATION-01

### GAP-PROCUREMENT-BID-EVALUATION-03  ·  MEDIUM  ·  confirmed  ·  theme METRICS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Total Bidders" is the row count (evaluations.length, page.tsx:25) so a bidder in two tenders is counted twice; "Active Evaluations" counts unique tender ref strings regardless of whether evaluation is closed (page.tsx:10).
- **Verified evidence:** page.tsx:25 Total Bidders = evaluations.length (one row per bidder-tender pair), so a bidder in two tenders counts twice; l.10 Active Evaluations = unique tender strings, with no status filter. BidEvaluation type (loaders.ts:2604-2613) has no vendor id or evaluation-closed flag; only bidder name and status strings.
- **Files to change:** `apps/web/src/app/(app)/procurement/bid-evaluation/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Rename cards to 'Tenders under evaluation' and 'Bid entries', or count unique bidder names/ids (add bidderId to type if API returns it).
  2. Define active as status not in ['Recommended','Awarded','Closed'] once statuses are confirmed with backend.
  3. Compute in the shared stats helper used by GAP-...-02.
- **Acceptance:**
  - Test: same bidder in 2 tenders counts once in 'Bidders'.
  - Closed tender excluded from Active.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; statuses list needs backend confirmation.
- **Depends on:** GAP-PROCUREMENT-BID-EVALUATION-02

### GAP-PROCUREMENT-BID-EVALUATION-04  ·  MEDIUM  ·  confirmed  ·  theme MISSING-ACTION (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — scores formatted 2dp right-aligned, L1 and tie badges; no threshold/weightage marking and no recommend/award action (needs API)
- **First-pass claim:** Scores print as String(number) with no decimals, weightage or pass/fail threshold (Table:34-36); rank is a bare number with no tie or L1 cue; there is no action to recommend or award — status is read-only (Table:67-75).
- **Verified evidence:** BidEvaluationTable.tsx:67-70 (obs said 34-36) turns scores into String(number); no decimals, weights or threshold; rank is String(e.rank) (l.70); status column cellType 'status' (l.107) is read-only and there is no action/recommend/award control on the page.
- **Files to change:** `apps/web/src/app/(app)/procurement/bid-evaluation/BidEvaluationTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Format scores with toFixed(2) (Intl.NumberFormat en-IN) and right-align.
  2. Add technical qualifying threshold and weightage in headers if backend returns them; mark below-threshold rows.
  3. Mark L1 (lowest financial) and ties with a badge next to rank.
  4. Award/recommend action: decide scope with procurement owner and backend endpoint; do not add UI until the API exists.
- **Acceptance:**
  - Snapshot: 82.5 renders '82.50'.
  - Tie ranks show a 'tie' marker.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Award actions are high-risk approvals; needs SoD and audit design.

### GAP-PROCUREMENT-BID-EVALUATION-05  ·  LOW  ·  partly  ·  theme MISSING-LINK (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Tender Ref is plain text: no link to /procurement/tenders/[id] (Table:68).
- **Verified evidence:** Tender is a plain string column (BidEvaluationTable.tsx:101, obs said 68) and DataTable rows don't link. Tender detail route /procurement/tenders/[id] exists, but BidEvaluation has only `tender: string` (a ref) and no tenderId, so a correct link needs an id the API may not return (unverifiable).
- **Files to change:** `apps/web/src/app/(app)/procurement/bid-evaluation/BidEvaluationTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm /api/v1/procurement/bid-evaluations returns tenderId; add tenderId to BidEvaluation.
  2. Add a render function on the Tender Ref column producing <Link href={`/procurement/tenders/${tenderId}`}>, falling back to text when missing.
- **Acceptance:**
  - Click on tender ref opens the tender detail page.
  - Row without tenderId shows plain text.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/contracts  —  `procurement/contracts.html`

- **Source:** `apps/web/src/app/(app)/procurement/contracts/page.tsx`
- **Design reference:** `redesign/procurement/contracts.html`

### GAP-PROCUREMENT-CONTRACTS-01  ·  HIGH  ·  confirmed  ·  theme ID-DISPLAY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Vendor / Counter-party" shows a raw vendor id: the loader maps sublabel = row.vendorId (loaders.ts:1753) and the column prints it (page.tsx:71). Clerks see ids like vnd_0142, not supplier names.
- **Verified evidence:** loaders.ts:1753 `const sublabel = toText(row.vendorId)` in mapContractsListRows (comment above says vendor name is not available from the contract API); contracts/page.tsx:71 prints it under 'Vendor / Counter-party', so raw ids show. Shared with /contracts/list. Whether GET /contract/contracts can return a vendor name is cannot-verify (contract-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In ProcurementContractsPage also call getProcurementVendors({limit:500}) via Promise.all and build an id->name Map.
  2. Map rows: sublabel = vendorNames.get(c.sublabel) ?? 'Unknown vendor' (never print the raw id).
  3. Prefer backend adding vendorName to the contract list response and read it in mapContractsListRows when present.
  4. Apply the same lookup in the /contracts/list ContractsTable.
- **Acceptance:**
  - Unit test on the mapper/page: contract with vendorId 'v1' and vendors [{id:'v1',name:'Acme'}] renders 'Acme'.
  - Unknown vendorId renders a friendly fallback, not the id.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; extra vendors fetch adds latency, failure must not blank the contracts list.

### GAP-PROCUREMENT-CONTRACTS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Templates" links to /procurement/contracts/new?template=1 (page.tsx:37) but NewContractPage takes no searchParams and CreateContractForm never reads it (contracts/new/page.tsx:4-13), so the button opens the plain form and no template exists.
- **Verified evidence:** contracts/page.tsx:37 links '?template=1'; contracts/new/page.tsx:4-13 has no searchParams and CreateContractForm.tsx has no props, so the param is dropped. No template concept exists in the form.
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/page.tsx`
- **Fix steps:**
  1. Remove the 'Templates' Link (page.tsx:37) unless a template source is confirmed.
  2. If kept, implement searchParams handling + a defined template list (needs product/backend decision).
- **Acceptance:**
  - Test: no element with href containing 'template=1' on the contracts page.
  - Manual: only '+ New Contract' remains in the header actions.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None; same root as GAP-PROCUREMENT-CONTRACTS-NEW-04.

### GAP-PROCUREMENT-CONTRACTS-03  ·  MEDIUM  ·  partly  ·  theme MISSING-FEATURE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — rowLinkKey/rowLinkPrefix link rows to /contracts/[id]; procurement list still lacks Expiry/Value columns and Expiring card link
- **First-pass claim:** "Expiring Soon" is a count with no expiry date, value or renewal action: the list has no Expiry / Value columns and rows are not links (page.tsx:69-74, no rowLinkKey); getContractById exists in the loader (loaders.ts:1775) but no route consumes it.
- **Verified evidence:** True: contracts/page.tsx:69-79 has columns label/sublabel/meta/status only, no Expiry or Value, and DataTable is given no rowLinkKey/rowLinkPrefix (DataTable.tsx:58-59,212 support them); mapContractsListRows (loaders.ts:1740-1760) drops expiry/value. Wrong: getContractById IS consumed, by apps/web/src/app/(app)/contracts/[id]/page.tsx:6,17 (detail route is /contracts/[id], not under /procurement). So rows could link there. 'expiring' is a server-supplied status string (page.tsx:19).
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Pass rowLinkKey="id" and rowLinkPrefix="/contracts/" to DataTable so the contract title links to the existing detail page.
  2. Extend mapContractsListRows to carry expiry and valueMinor (fields exist on the create body: expiry, valueMinor) if the list response returns them - verify against contract-service.
  3. Add 'Expiry' (formatIndianDate) and 'Value' (formatMoney) columns; sort expiring first.
  4. Make the 'Expiring Soon' StatCard link/filter to status=expiring.
- **Acceptance:**
  - Test: rows render an anchor to /contracts/<id>.
  - Manual: list shows expiry date and value; expiring contracts identifiable without opening each.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; list response shape for expiry/value is cannot-verify.
- **Depends on:** GAP-PROCUREMENT-CONTRACTS-01

### GAP-PROCUREMENT-CONTRACTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch: ErrorState is shown but the stats read 0 / 0 / 0 / 0 (page.tsx:44-52), unlike the dashboard which shows "—".
- **Verified evidence:** contracts/page.tsx:45-48 pass contracts.length/active/expiring/expired to StatCard unconditionally; on source==='error' data is [] so all show 0 while the card body shows ErrorState (line 54). The dashboard gates with `errored ? "—"` (dashboard/page.tsx:24,42-45). Note line 54 uses plain ErrorState (a client component with no working retry from a server page); RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx.
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/page.tsx`
- **Fix steps:**
  1. Add `const errored = source === 'error'` and pass `errored ? '—' : value` to all four StatCards.
  2. Swap ErrorState (line 54) for RefreshErrorState (already exported from ds/index) with backHref unchanged so Retry does router.refresh().
  3. Remove the redundant header DataSourceBadge or keep only one error indicator.
- **Acceptance:**
  - Test: getContracts mocked to source:'error' -> four stats show '—' and a Retry button is present.
  - Test: success path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/contracts/new  —  `procurement/contracts-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/contracts/new/page.tsx`
- **Design reference:** `redesign/procurement/contracts-new.html`

### GAP-PROCUREMENT-CONTRACTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme FORM-DEFAULT (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Wrong vendor by default: the first fetched vendor is auto-selected (Form:35 setVendorId(clean[0].id)) and the field is labelled required but is never blank, so a hurried clerk can register a contract against an unintended vendor.
- **Verified evidence:** apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx:35 does `if (clean[0]?.id) setVendorId(clean[0].id)` after the vendor fetch, so the required select (line 91) is never blank and submit check `!vendorId` (line 47) can never fire. The observation's fix text (i18n) does not match the finding. Page subtitle (new/page.tsx:9) says 'empanelled vendor' but the fetch (line 29) lists all vendors.
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx`
- **Fix steps:**
  1. Delete the `setVendorId(clean[0].id)` line in the vendor-load effect so vendorId stays "".
  2. Render a first `<option value="" disabled>Select a vendor…</option>` always; show 'Loading vendors…' only while a new `vendorsLoading` state is true.
  3. Keep the `!vendorId` guard in handleSubmit and add per-field inline error (aria-invalid + aria-describedby) for vendor.
  4. Optionally restrict the list to empanelled vendors if the vendors endpoint exposes empanelmentStatus (VendorsPage filters on v.empanelmentStatus === 'empanelled') - confirm with backend.
- **Acceptance:**
  - Component test: mock vendors fetch returning 2 vendors; select value is "" on first render and submit shows a vendor-required error without calling POST.
  - Manual: open /procurement/contracts/new, vendor dropdown shows placeholder, not the first vendor.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes an unsafe default. Contract mis-attribution to wrong vendor is the business risk being fixed.
- **Depends on:** GAP-PROCUREMENT-CONTRACTS-NEW-02

### GAP-PROCUREMENT-CONTRACTS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Vendor list failure is silent: the catch is "/* optional */" (Form:36-39), so the select shows "Loading vendors…" indefinitely (Form:92) and submit fails with a generic required-fields message.
- **Verified evidence:** CreateContractForm.tsx:30 returns silently on !res.ok and lines 36-39 swallow other errors with `/* optional */`; vendors stays [] so the select shows 'Loading vendors…' (line 92) forever. Submit then fails with the generic required-fields text (line 49) because vendorId is empty.
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx`
- **Fix steps:**
  1. Add `vendorsState: 'loading'|'ready'|'error'` state; set 'error' on !res.ok and on non-abort catch.
  2. In the select, show 'Loading vendors…' only when loading, 'Couldn't load vendors' when error, and 'No vendors found' when ready and empty.
  3. Render an inline alert with a Retry button (re-run the loader via a `reloadKey` state in the effect deps) using toHumanError('load', {area:'vendors'}).
  4. Disable the submit button while vendorsState !== 'ready'.
- **Acceptance:**
  - Test: fetch mocked to 500 -> alert with Retry is shown, select does not say 'Loading', submit disabled.
  - Test: click Retry with mock now 200 -> options render and submit enabled.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-CONTRACTS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Dates unchecked: only presence is validated (Form:47) — an expiry before the start date is accepted client-side; there is no duplicate contract-number feedback and contract no is free text.
- **Verified evidence:** CreateContractForm.tsx:47 validates only presence (`!expiry`) and value>0; nothing compares expiry to startDate (state lines 19-20), so expiry < start posts. contractNo is a plain input (line 98) with no format/uniqueness handling; non-ok POST is mapped to generic toHumanError('save') (lines 70-74) with no 409/duplicate branch. Whether contract-service rejects duplicates or bad date ranges is cannot-verify (service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx`
- **Fix steps:**
  1. Add a zod schema (or reuse lib/form-validation.ts) for the form: expiry > startDate, contractNo trimmed non-empty, valueMinor > 0.
  2. Show field-level errors with aria-invalid/aria-describedby; set `min={startDate}` on the expiry input.
  3. On POST failure read `res.status`; if 409 (or a backend duplicate code) show 'Contract number already exists' on the contract-no field; otherwise keep the generic message.
  4. Confirm with backend whether duplicate contractNo returns 409 and whether it validates dates server-side.
- **Acceptance:**
  - Test: startDate 2026-10-01, expiry 2026-09-01 -> submit blocked, error on expiry field, no fetch.
  - Test: mocked 409 -> inline duplicate error on contract no.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; server-side validation gap (if any) remains a data-integrity risk for contract dates.

### GAP-PROCUREMENT-CONTRACTS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Entry point mismatch: /contracts "Templates" links here with ?template=1 (contracts/page.tsx:37) but this page ignores it (page.tsx:4-13).
- **Verified evidence:** contracts/page.tsx:37 links to /procurement/contracts/new?template=1; contracts/new/page.tsx:4 `NewContractPage()` takes no searchParams and CreateContractForm takes no props, so the flag is ignored and no template data exists anywhere in the module.
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/page.tsx`
- **Fix steps:**
  1. Product decision: are contract templates in scope? If not, remove the 'Templates' Link at contracts/page.tsx:37.
  2. If yes, add `searchParams` to NewContractPage, pass `template` to CreateContractForm, and define a template source (backend endpoint or static presets) - do not invent one.
  3. Until built, hide rather than link (same for /contracts/new top-level page).
- **Acceptance:**
  - Manual: /procurement/contracts shows no Templates button (or it opens a form pre-filled from a real template).
  - Test: render ProcurementContractsPage, assert no link with href containing template=1.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; duplicate of GAP-PROCUREMENT-CONTRACTS-02 - fix once.
- **Depends on:** GAP-PROCUREMENT-CONTRACTS-02

### GAP-PROCUREMENT-CONTRACTS-NEW-05  ·  LOW  ·  confirmed  ·  theme MONEY

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — value is string via rupeesToMinorString, no 0 hint; vendor cap raised to 500 but still plain select, no SmartCombobox search
- **First-pass claim:** Contract value defaults to 0 and the hint shows ₹0.00 before any input (Form:18,107); dropdown is capped at 100 vendors (Form:29) with no search.
- **Verified evidence:** CreateContractForm.tsx:18 `useState(0)` so the hint (line 107) renders formatMoney(0) before input. Money uses float math `Math.round(value * 100)` at lines 46 and 107 (Number(e.target.value) at 106), against the paise rule; lib/money.ts already provides rupeesToMinorString (exact string->paise). Vendor fetch caps `?limit=100` (line 29) and the select is a plain <select> with no search; SmartCombobox exists in app/_components.
- **Files to change:** `apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx`
- **Fix steps:**
  1. Change `value` state to a string ("" default); parse with rupeesToMinorString(value) for validation and body (null => invalid).
  2. Show the formatMoney hint only when parsed minor is non-null.
  3. Send valueMinor as Number(BigInt(minor)) unless the contract API accepts a string (cannot-verify; check contract-service DTO).
  4. Replace the vendor <select> with SmartCombobox backed by `/api/proxy/v1/procurement/vendors?q=` (loader supports q) so >100 vendors are reachable.
- **Acceptance:**
  - Test: input '0.1' -> valueMinor 10; input '1.005' -> validation error; empty -> no hint.
  - Manual: with >100 vendors, typing a vendor name finds one beyond the first 100.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money path: verify body type (number vs string) against contract-service before switching.
- **Depends on:** GAP-PROCUREMENT-CONTRACTS-NEW-02


---
## /procurement/dashboard  —  `procurement/dashboard.html`

- **Source:** `apps/web/src/app/(app)/procurement/dashboard/page.tsx`
- **Design reference:** `redesign/procurement/dashboard.html`

### GAP-PROCUREMENT-DASHBOARD-01  ·  MEDIUM  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Quick-link grid is hard-coded to repeat(4, 1fr) inline (page.tsx:49): on a 390 px phone eight tiles are squeezed into four narrow columns or overflow; no responsive breakpoint.
- **Verified evidence:** dashboard/page.tsx:49 sets inline gridTemplateColumns:'repeat(4, 1fr)'. On phones this is overridden: civitas-ds.css:427 (inside @media max-width:768px) has `.g-4{grid-template-columns:1fr !important}` which beats inline style, so 390 px gets one column, not overflow. The real defect is the tablet range 769-1080 px: the .g-4 rule at civitas-ds.css:106 (2 cols) is non-important and loses to the inline style, so 8 tiles stay 4-wide. Theme tag 'PII' is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/dashboard/page.tsx`
- **Fix steps:**
  1. Remove `gridTemplateColumns: "repeat(4, 1fr)"` from the inline style at line 49 and rely on .g-4 (4 cols desktop, 2 cols <=1080, 1 col <=768).
  2. Verify at 390, 820 and 1280 px widths.
- **Acceptance:**
  - Manual: at 820 px the tiles show 2 columns; at 390 px 1 column; at 1280 px 4 columns.
  - No inline gridTemplateColumns remains in the file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PROCUREMENT-DASHBOARD-03  ·  LOW  ·  defect  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Real-time snapshot" (page.tsx:30) but the loader revalidates every 60 s (loaders.ts:2401) and the header offers no last-updated time.
- **Service:** ``  ·  **Endpoint(s):** `['GET /api/v1/procurement/dashboard']`
- **Question:** Web copy says real-time but loader revalidates every 60 s.
- **How to verify:** Read loaders.ts:2399-2405 and dashboard/page.tsx:30.
- **Test to add:** Given the header, when rendered, then no 'Real-time' text and an 'Updated at' time is shown.
- **Impact if wrong:** Minor misleading copy.
- **Web change if wrong:** Change subtitle to 'Snapshot of ...' and show last-updated.
- **Finding:** page.tsx:30 subtitle; loaders.ts:2401 revalidate 60 (per finding)

### GAP-PROCUREMENT-DASHBOARD-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Overlaps the /procurement hub: only 8 of 16 modules are linked here (page.tsx:6-15 vs page.tsx:6-23 of the hub).
- **Verified evidence:** dashboard/page.tsx:6-15 QUICK_LINKS has 8 entries; the hub procurement/page.tsx:6-23 has 16 tiles (adds Dashboard, Annual Plans, Bid Evaluation, Reverse Auction, GeM, EMD & BG, Empanelment, Pre-Bid). Dashboard omits eight modules, incl. GeM/EMD & BG/Empanelment reviewed here.
- **Files to change:** `apps/web/src/app/(app)/procurement/dashboard/page.tsx`, `apps/web/src/app/(app)/procurement/page.tsx`
- **Fix steps:**
  1. Extract the tile list from procurement/page.tsx into a shared `procurementTiles` module (e.g. procurement/tiles.ts).
  2. Use it in the dashboard (all modules, or link a 'All modules' card to /procurement) so the two lists cannot drift.
  3. Decide whether the dashboard should keep a shortened list; if so add a 'View all modules' link.
- **Acceptance:**
  - Test: dashboard and hub import the same tiles array (or dashboard renders a link to /procurement).
  - Manual: every hub module is reachable from the dashboard.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/emd-bg  —  `procurement/emd-bg.html`

- **Source:** `apps/web/src/app/(app)/procurement/emd-bg/page.tsx`
- **Design reference:** `redesign/procurement/emd-bg.html`

### GAP-PROCUREMENT-EMD-BG-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Partial failure is mis-reported: EMD and PBG are fetched together and any one failure sets source "error" (page.tsx:6-11). useSeededResource then refuses the live data (resource.ts:232) so the table can show only stale cache or the surviving half under "Couldn't load — showing nothing"; Active Guarantees and Total Active Value silently omit the failed register.
- **Verified evidence:** emd-bg/page.tsx:6-11 merges EMD and PBG results and sets source='error' if either failed. EmdBgTable.tsx:20-25 passes it to useSeededResource; resource.ts:232 `serverUsable = serverSource==='api' && ...` is false, so it reads cache (242). With no cache, state stays at initialData (the surviving register) but provenance becomes 'error-no-data', so the badge says 'Couldn't load — showing nothing' (EmdBgTable.tsx:48-53) while rows from the other register are shown. Stats (page.tsx:13-17) silently use only the surviving half. If cache exists, cached rows of BOTH registers replace live data.
- **Files to change:** `apps/web/src/app/(app)/procurement/emd-bg/page.tsx`, `apps/web/src/app/(app)/procurement/emd-bg/EmdBgTable.tsx`
- **Fix steps:**
  1. In page.tsx keep `emdSource` and `pbgSource` separate; pass both to EmdBgTable.
  2. Compute stats client-side from the rows actually rendered (or show '—' when either source errored).
  3. When one register errored, show a warning line naming it ('Bank guarantees could not be loaded') plus RefreshErrorState retry above the surviving table; never say 'showing nothing' while rows are shown.
  4. Cache each register under its own key (procurement.emd, procurement.pbg) so a partial failure falls back per register.
- **Acceptance:**
  - Test: emd ok + pbg error -> EMD rows visible, banner naming BG failure, stats show '—', no 'showing nothing' text.
  - Test: both ok -> unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money register: partial totals shown as complete is the exposure.
- **Depends on:** SHARED:seeded-resource-stats

### GAP-PROCUREMENT-EMD-BG-02  ·  HIGH  ·  confirmed  ·  theme LABEL-ACCURACY (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Money is easy to misread: Total Active Value adds EMD deposits and bank-guarantee face values into one figure (page.tsx:10,16) and "Active Guarantees" counts EMD rows too (page.tsx:13,31); an EMD is not a guarantee, so neither headline number matches its label.
- **Verified evidence:** emd-bg/page.tsx:10 concatenates emdEntries and pbgEntries; line 13 'active' counts all Active rows (used for the 'Active Guarantees' card, line 31) and line 16 sums amounts of EMD and BG together for 'Total Active Value' (line 32). EMD (earnest deposit) rows are counted as guarantees. EmdBgEntry.type (loaders.ts:2662) exists but is unused for this.
- **Files to change:** `apps/web/src/app/(app)/procurement/emd-bg/page.tsx`
- **Fix steps:**
  1. Compute stats separately: activeEmd/activePbg counts and totals from emdEntries and pbgEntries.
  2. Relabel cards: 'Active Bank Guarantees' (pbg count), 'Active EMD', and 'Total Active Security Value' with subtitle 'EMD + BG', or show two value cards.
  3. Confirm with business whether a combined total is wanted; if so label it explicitly as combined.
  4. Use formatMoney for the values.
- **Acceptance:**
  - Test: 2 active EMD + 1 active BG -> 'Active Bank Guarantees' = 1, EMD = 2.
  - Totals per instrument sum correctly in paise.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Headline financial figures change; get finance sign-off on labels.
- **Depends on:** GAP-PROCUREMENT-EMD-BG-03

### GAP-PROCUREMENT-EMD-BG-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Amounts are formatted ad hoc as ₹${(amount/100).toLocaleString("en-IN")} (Table:33, page.tsx:17) instead of formatMoney: paise trailing zeros are dropped (₹1,250.5) and rounding differs from every other procurement page.
- **Verified evidence:** EmdBgTable.tsx:33 `₹${(e.amount/100).toLocaleString('en-IN')}` and page.tsx:17 same. toLocaleString defaults to max 3 fraction digits and no minimum, so 125050 paise -> '₹1,250.5'. lib/formatters.ts:90 formatMoney(bigint|number|string) does BigInt paise math with Indian grouping and 2 decimals. The column header 'Amount (₹)' duplicates the symbol. Table export (exportable) will also carry these strings.
- **Files to change:** `apps/web/src/app/(app)/procurement/emd-bg/EmdBgTable.tsx`, `apps/web/src/app/(app)/procurement/emd-bg/page.tsx`
- **Fix steps:**
  1. Import formatMoney from '@/lib/formatters' and replace both ad-hoc expressions.
  2. Keep totalValuePaise as an integer sum; treat 0 via formatMoney(0) rather than the '₹0' literal.
  3. Rename column to 'Amount' since formatMoney already prints the symbol.
- **Acceptance:**
  - Test: amount 125050 renders '₹1,250.50' in table and stat.
  - Test: 0 renders formatMoney(0), consistent with other procurement pages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only. Check formatMoney output format and CSV export expectations.

### GAP-PROCUREMENT-EMD-BG-04  ·  MEDIUM  ·  confirmed  ·  theme CACHE-SYNC (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Stats (server prop) and rows (seeded/cached) can disagree (page.tsx:13-16 vs Table:20-25), and a genuinely empty live response is replaced by stale cached rows (resource.ts:232-249).
- **Verified evidence:** Stats are computed on the server from `entries` (page.tsx:10-16) while rows come from useSeededResource (EmdBgTable.tsx:20-25). resource.ts:232 treats an empty api result as unusable (`!isEmpty(initialData)`), so a genuine empty response falls to readCache (242) and shows non-empty cached rows; stats stay at server 0. The badge does disclose 'Showing saved data' (DataSourceBadge.tsx:65-69), so it is not silent, but the data is still wrong for a truly empty live register and the cache is never cleared.
- **Files to change:** `apps/web/src/lib/sync/resource.ts`, `apps/web/src/app/(app)/procurement/emd-bg/EmdBgTable.tsx`, `apps/web/src/app/(app)/procurement/emd-bg/page.tsx`
- **Fix steps:**
  1. In useSeededResource treat serverSource==='api' as authoritative even when empty: setData(initialData), writeCache (clears stale rows), provenance 'live'; only fall back to cache when serverSource==='error'. Check other callers of isEmpty before changing (shared hook).
  2. Move stat computation into EmdBgTable from `rows` so stats and table always agree, or pass computed stats from the hook's data.
  3. Add hook unit tests for api-empty and error+cache.
- **Acceptance:**
  - Hook test: serverSource 'api', initialData [], cache has rows -> data [] and provenance 'live'.
  - Component test: cache hit path shows stats derived from cached rows, matching the table.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared hook change affects every seeded page; regression test all callers.
- **Depends on:** SHARED:seeded-resource-stats

### GAP-PROCUREMENT-EMD-BG-05  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FEATURE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — formatIndianDate + expiry label chip and read-only subtitle; no expiring-within-30-days sort/filter, no release/extend/forfeit (decision)
- **First-pass claim:** Register is read-only with no expiry warning: Valid Until is a raw string, no days-remaining cue, and no release / extend / forfeit action or audit trail although Forfeited is a tracked status (Table:65-72).
- **Verified evidence:** EmdBgTable.tsx:65-72 columns are plain text; validity is a raw string (`validity: e.validity`, line 34), no days-remaining or expiry cue, no row actions and no link. Status 'Forfeited' is counted on the page (page.tsx:15) but nothing in the web app lets a user release/extend/forfeit; the procurement-service endpoints for such actions are not in the snapshot (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/procurement/emd-bg/EmdBgTable.tsx`
- **Fix steps:**
  1. Render validity with formatIndianDate and add an expiry chip (e.g. 'Expires in 12 days' / 'Expired') based on date diff, with text plus icon, not colour alone.
  2. Sort or filter option for 'expiring within 30 days'.
  3. Product/backend decision: define release, extend and forfeit endpoints with maker-checker and audit events before adding buttons; add ConfirmDialog with mandatory reason.
  4. Until then label the page as a read-only register in its subtitle.
- **Acceptance:**
  - Test: validity 10 days out shows 'Expires in 10 days'; past date shows 'Expired'.
  - Manual: dates render as dd Mon yyyy.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Actions move money-adjacent securities; require approval and audit design.


---
## /procurement/empanelment  —  `procurement/empanelment.html`

- **Source:** `apps/web/src/app/(app)/procurement/empanelment/page.tsx`
- **Design reference:** `redesign/procurement/empanelment.html`

### GAP-PROCUREMENT-EMPANELMENT-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch looks like an empty empanelment list: zero stats and "No empanelled vendors" under a small badge (page.tsx:8-11, Table:46-53). Empanelment gates who may be invited to RFQs, so "none" is a consequential false reading.
- **Verified evidence:** empanelment/page.tsx:6-11 uses `source` only to pass to the table; on error vendors=[] so stats read 0 and avgRating '—' (Total 0, Active 0, Expiring 0). EmpanelmentTable.tsx:46-53 shows the small amber badge and, because tableRows is empty, EmptyState 'No empanelled vendors' (line 53). With no cache this reads as 'none empanelled'.
- **Files to change:** `apps/web/src/app/(app)/procurement/empanelment/EmpanelmentTable.tsx`, `apps/web/src/app/(app)/procurement/empanelment/page.tsx`
- **Fix steps:**
  1. In EmpanelmentTable, when provenance==='error-no-data' render RefreshErrorState (toHumanError('load',{area:'empanelment'})) instead of EmptyState.
  2. Move the StatGrid into the client component (or pass an `errored` flag) so stats show '—' when provenance !== 'live'.
  3. Keep the cached-data fallback for offline.
- **Acceptance:**
  - Test: source 'error', empty cache -> Retry button visible, no 'No empanelled vendors', stats '—'.
  - Test: source 'api' with [] -> genuine empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; fixes a misleading empty state gating RFQ invitations.
- **Depends on:** SHARED:seeded-resource-stats

### GAP-PROCUREMENT-EMPANELMENT-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Rating renders `${v.rating}/5` from an unrounded number (Table:33) — 4.166666… prints in full; Avg. Rating is the mean over all rows including Expired (page.tsx:10-11).
- **Verified evidence:** EmpanelmentTable.tsx:33 `${v.rating}/5` prints the raw number (EmpanelmentEntry.rating is number, loaders.ts:2691), so 4.1666667 shows in full. page.tsx:10-11 averages ratings over all vendors including Expired ones, formatted with toFixed(1) but without '/5'.
- **Files to change:** `apps/web/src/app/(app)/procurement/empanelment/EmpanelmentTable.tsx`, `apps/web/src/app/(app)/procurement/empanelment/page.tsx`
- **Fix steps:**
  1. Format rating as `${Number(v.rating).toFixed(1)}/5` (guard non-finite -> '—').
  2. Compute average over non-Expired vendors only (or label 'Avg. rating (all)'), decide with procurement owner.
  3. Show '/5' on the stat value for consistency.
- **Acceptance:**
  - Test: rating 4.1666667 renders '4.2/5'.
  - Test: average excludes Expired vendors (if decision taken).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-EMPANELMENT-03  ·  MEDIUM  ·  confirmed  ·  theme CACHE-SYNC (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Stats (server props, page.tsx:6-11) and table rows (useSeededResource, Table:19-24) can disagree when the cache is used (resource.ts:232-249).
- **Verified evidence:** Stats are computed on the server (empanelment/page.tsx:6-11) but rows come from useSeededResource (EmpanelmentTable.tsx:19-24); when the server result is error or empty the hook shows cached rows (resource.ts:232-249) while stats stay from the empty server data. Not 'fabricated' data; it is cache/server mismatch. Badge discloses cached state.
- **Files to change:** `apps/web/src/app/(app)/procurement/empanelment/page.tsx`, `apps/web/src/app/(app)/procurement/empanelment/EmpanelmentTable.tsx`
- **Fix steps:**
  1. Derive stats inside EmpanelmentTable from the same `rows` the hook returns (move StatGrid into the client component).
  2. Apply the resource.ts fix so an authoritative empty api result is not replaced by cache.
- **Acceptance:**
  - Test: cache hit with 3 vendors while server errored -> stats show 3 total, matching table.
  - Manual: offline reload shows matching stats and table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** SHARED:seeded-resource-stats, GAP-PROCUREMENT-EMD-BG-04

### GAP-PROCUREMENT-EMPANELMENT-04  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FEATURE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Page is titled "Vendor Empanelment" (nav: "Vendor empanelment management") but is a read-only list: no empanel, renew, suspend or blacklist action and no link to /procurement/vendors; Expiring Soon relies on a server-supplied status string (page.tsx:9) with no date logic.
- **Verified evidence:** empanelment/page.tsx and EmpanelmentTable.tsx render read-only stats and a DataTable; no buttons, no rowLink, no Link to /procurement/vendors. page.tsx:9 counts `v.status === 'Expiring'` from a server string; validUntil is displayed raw and never compared with today. Empanel/renew/suspend/blacklist endpoints are cannot-verify (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/empanelment/EmpanelmentTable.tsx`, `apps/web/src/app/(app)/procurement/empanelment/page.tsx`
- **Fix steps:**
  1. Short term: add a header action linking to /procurement/vendors and link vendor names to the vendor detail page if a route exists.
  2. Format validUntil with formatIndianDate and add an expiry cue computed from the date instead of trusting the status string.
  3. Product/backend decision on empanel/renew/suspend/blacklist workflows with approval and audit; add ConfirmDialog with reason when built.
  4. Retitle subtitle as read-only until then.
- **Acceptance:**
  - Manual: page links to Vendors; expiry cue shows days remaining.
  - Test: a vendor with validUntil in 20 days is flagged expiring regardless of status string.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Empanelment gates RFQ invitations; workflow additions need audit and approval.


---
## /procurement/gem  —  `procurement/gem.html`

- **Source:** `apps/web/src/app/(app)/procurement/gem/page.tsx`
- **Design reference:** `redesign/procurement/gem.html`

### GAP-PROCUREMENT-GEM-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch looks like "no GeM orders": zero stats, "₹0" and "No GeM orders found" beneath a small badge (page.tsx:8-11, Table:48-55).
- **Verified evidence:** gem/page.tsx:8-11 on error yields items=[] so Total Orders/Delivered/In Transit are 0 and Total Value '₹0'; GemTable.tsx:48-55 shows the small amber badge then EmptyState 'No GeM orders found' when there is no cache.
- **Files to change:** `apps/web/src/app/(app)/procurement/gem/GemTable.tsx`, `apps/web/src/app/(app)/procurement/gem/page.tsx`
- **Fix steps:**
  1. In GemTable, when provenance==='error-no-data' render RefreshErrorState instead of EmptyState.
  2. Move the StatGrid into the client component or pass `errored`; show '—' for all four values when provenance !== 'live'.
  3. Format total via formatMoney only when data loaded.
- **Acceptance:**
  - Test: source 'error', empty cache -> Retry, stats '—', no 'No GeM orders found'.
  - Test: genuine empty api -> empty state with stats 0 / ₹0.00.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** SHARED:seeded-resource-stats

### GAP-PROCUREMENT-GEM-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Total Value sums all rows regardless of status (page.tsx:10), so cancelled orders inflate spend; amounts use ad-hoc ₹${(amount/100).toLocaleString("en-IN")} instead of formatMoney (Table:34, page.tsx:11).
- **Verified evidence:** gem/page.tsx:10 sums amount of every item regardless of gemStatus; page.tsx:11 and GemTable.tsx:34 use `₹${(x/100).toLocaleString('en-IN')}` (drops trailing paise zeros, e.g. ₹1,250.5) instead of formatMoney (lib/formatters.ts:90). Whether Cancelled statuses exist in the API is cannot-verify since gemStatus is a free string (loaders.ts:2647).
- **Files to change:** `apps/web/src/app/(app)/procurement/gem/page.tsx`, `apps/web/src/app/(app)/procurement/gem/GemTable.tsx`
- **Fix steps:**
  1. Use formatMoney for both the stat and the Amount column.
  2. Exclude cancelled/returned orders from Total Value (after confirming the real status vocabulary) or relabel 'Total value (all orders)'.
  3. Keep the sum as integer paise.
- **Acceptance:**
  - Test: amount 125050 renders '₹1,250.50'.
  - Test: a Cancelled order is excluded from Total Value (once vocabulary confirmed).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Spend figure changes; confirm which statuses count as spend.
- **Depends on:** GAP-PROCUREMENT-GEM-04

### GAP-PROCUREMENT-GEM-03  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FEATURE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Titled "Integration" but no sync affordance: no last-synced time, no refresh, no deep link to the GeM portal, and orders are not linked to /procurement/orders (PO status "GeM Placed" exists at orders/OrdersTable.tsx:28) or to a GRN.
- **Verified evidence:** gem/page.tsx and GemTable.tsx have no last-synced time, refresh control, portal link or row links; GemItem (loaders.ts:2641) has id/orderId/item/supplier/amount/deliveryDate/gemStatus only, no PO or GRN reference. OrdersTable.tsx:28 does define status gem_placed 'GeM Placed', but there is no field to join on. Sync endpoints are cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/gem/GemTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add a Refresh button (RefreshErrorState-style router.refresh()) and show 'Last updated' from cachedAt/fetch time.
  2. Ask backend whether gem/items can return poId/grnId and a sync timestamp; if so add loader fields and link to /procurement/orders/<id> and the GRN.
  3. Retitle to 'GeM Orders' until real sync exists.
- **Acceptance:**
  - Manual: Refresh re-fetches; last-updated visible.
  - Test (after backend): row with poId links to the PO.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; do not fabricate sync status.

### GAP-PROCUREMENT-GEM-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS-ENUM (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** gemStatus is a free string compared literally (Delivered, In Transit, Shipped, page.tsx:8-9); any other GeM state (Cancelled, Returned) is uncounted while still summed into Total Value.
- **Verified evidence:** gem/page.tsx:8-9 compares gemStatus to the literals 'Delivered', 'In Transit', 'Shipped'; any other value (Cancelled, Returned, Placed) is in neither stat but counts in Total Orders (line 25) and Total Value (line 10), so the stat cards don't reconcile. Theme 'FABRICATED' is wrong: no fake data, a status-vocabulary issue.
- **Files to change:** `apps/web/src/app/(app)/procurement/gem/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Get the authoritative GeM status list from backend and define a `GemStatus` union in loaders.ts, normalising case/space.
  2. Add counts for the remaining states (or an 'Other/In progress' card) so cards sum to Total Orders.
  3. Render unknown statuses verbatim in the table (already via cellType 'status') and log unmapped values.
- **Acceptance:**
  - Test: statuses [Delivered, Shipped, Cancelled, Placed] -> delivered 1, in transit 1, other counts shown, sum equals total.
  - Test: unknown status does not throw.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-GEM-05  ·  LOW  ·  confirmed  ·  theme CACHE-SYNC (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Stats vs rows disagree under cache (page.tsx:6-11 vs Table:19-25); a genuinely empty live response is replaced by stale cache (resource.ts:232-249).
- **Verified evidence:** Same mechanism as EMD-BG-04: server stats (gem/page.tsx:6-11) vs hook rows (GemTable.tsx:19-25); resource.ts:232 rejects an empty api result and falls back to cache (242-249). Badge shows 'Showing saved data', so partly disclosed.
- **Files to change:** `apps/web/src/lib/sync/resource.ts`, `apps/web/src/app/(app)/procurement/gem/GemTable.tsx`, `apps/web/src/app/(app)/procurement/gem/page.tsx`
- **Fix steps:**
  1. Apply the shared useSeededResource fix (authoritative empty api result).
  2. Compute stats from the hook's rows inside GemTable.
- **Acceptance:**
  - Test: api [] with cached rows -> table empty, stats 0, provenance live.
  - Test: error + cache -> stats match cached rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared hook regression risk.
- **Depends on:** GAP-PROCUREMENT-EMD-BG-04, SHARED:seeded-resource-stats


---
## /procurement/grn  —  `procurement/grn.html`

- **Source:** `apps/web/src/app/(app)/procurement/grn/page.tsx`
- **Design reference:** `redesign/procurement/grn.html`

### GAP-PROCUREMENT-GRN-01  ·  MEDIUM  ·  partly  ·  theme STATUS (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Under Inspection" GRNs are invisible in the counts: the detail page has status under_inspection (grn/[id]/page.tsx:12,21-27) but the list has no label for it (page.tsx:8-15) and Pending QC counts only quality_check or received (page.tsx:32); the row shows the raw status string.
- **Verified evidence:** grn/page.tsx STATUS_LABELS (:8-15) omits under_inspection (present in detail page.tsx:10-18 and in GRN_STATUSES apiMappers.ts:332), so row shows the raw 'under_inspection' string via fallback (:43). Pending QC (:32) counts only quality_check/received; draft and under_inspection are excluded, though the detail page treats draft and under_inspection as the inspectable states (canInspectGrn). Total GRNs still includes them, so 'invisible in counts' is overstated - they are missing only from Pending QC. Not an i18n issue: labels are hard-coded English.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/page.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/grn/statusLabels.ts`
- **Fix steps:**
  1. Create grn/statusLabels.ts exporting one STATUS_LABELS (with under_inspection: 'Under Inspection') and import it in both pages.
  2. Redefine pendingQC as statuses that await inspection: draft, under_inspection, received, quality_check (confirm with product) and rename card 'Awaiting inspection'.
  3. Check StatusPill tone for the new label (add mapping in StatusPill if it falls to the neutral default).
- **Acceptance:**
  - Unit test: list with under_inspection row shows 'Under Inspection' and counts in the pending card.
  - No raw snake_case status visible in list.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Changing the pending definition changes a dashboard number officers rely on.
- **Depends on:** GAP-PROCUREMENT-GRN-02

### GAP-PROCUREMENT-GRN-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — interim truncation notice at 500-row cap only; no server-side pagination/total/summary counts
- **First-pass claim:** Hard cap: getProcurementGRNs({ limit: 500 }) (page.tsx:29) with client-side paging and no "showing first 500" cue; stats are computed from the same truncated list (page.tsx:31-34).
- **Verified evidence:** grn/page.tsx:29 fetches getProcurementGRNs({limit:500}); stats (:31-34, :61-64) are computed from that array; DataTable pageSize={10} filterable (:83-86) filters/paginates client-side, and no truncation notice exists. Whether the API caps below 500 or returns a total count cannot be verified (procurement-service absent); loaders.ts:2498-2514 also filters q client-side.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `services/procurement-service (grns list total + status counts)`
- **Fix steps:**
  1. Backend: return {data,total} and a status-count summary for GET /procurement/grns (page, limit, q, status params).
  2. Loader: add getProcurementGRNPage returning total and counts.
  3. Page: read searchParams (page, q, status), fetch one page server-side, drive DataTable server pagination, and source stat cards from the summary counts.
  4. Interim: if grns.length===500 show 'Showing first 500 - refine filters' and label stats as partial.
- **Acceptance:**
  - With 700 GRNs stat cards show true totals.
  - Search finds a GRN outside the first 500.
  - Truncation notice appears in interim version.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Stat cards currently under-report silently for large stores.

### GAP-PROCUREMENT-GRN-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows ErrorState but the four StatCards are real zeros (page.tsx:60-70).
- **Verified evidence:** grn/page.tsx:29 gets `source`; :60-65 StatCards receive grns.length/accepted/pendingQC/rejected which are 0 on error (loader returns [] , apiClient.ts:119+); only the Card body (:68-70) shows ErrorState. Dashboard already gates stats on `errored` (procurement/dashboard/page.tsx comment UX-013). Uses ErrorState, not RefreshErrorState, so the Retry action is absent (server component).
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/page.tsx`
- **Fix steps:**
  1. Add `const errored = source === 'error'`.
  2. Pass value={errored ? '—' : n} to the four StatCards (check StatCard accepts string, as dashboard does).
  3. Swap ErrorState at :70 for RefreshErrorState (exported from ds) so Retry works.
  4. Optionally hide the '+ New GRN' empty-state path when errored (already handled by ternary).
- **Acceptance:**
  - Mock error: cards show '—', card shows retry error.
  - Success: numbers as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-GRN-04  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Match is plain text ("Matched" / "Mismatch" / "—") rather than a pill and undefined is shown as "—" here while the detail page treats the same state as a mismatch (page.tsx:42 vs grn/[id]/page.tsx:91).
- **Verified evidence:** grn/page.tsx:42 sets match to '—' when g.threeWayMatch===undefined else 'Matched'/'Mismatch' as plain string in a normal column (:94, no cellType). The detail page treats undefined as mismatch only because mapProcurementGRNDetail defaults to false (apiMappers.ts:388) - the inconsistency is a mapper issue tracked in GRN-DETAIL-02.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/page.tsx`
- **Fix steps:**
  1. Change match column to { key:'match', label:'Match', cellType:'status' } (DataTable supports cellType 'status' as used on :95).
  2. Map '—' to a neutral label 'Pending' (StatusPill 'pending'); 'Mismatch' -> status 'rejected'/'failed', 'Matched' -> 'accepted'.
  3. Align with GRN-DETAIL-02 so both pages use the same three states.
- **Acceptance:**
  - List shows coloured pills for Matched/Mismatch/Pending.
  - Same GRN shows the same state on list and detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; status must not depend on colour alone (keep text label).
- **Depends on:** GAP-PROCUREMENT-GRN-DETAIL-02


---
## /procurement/grn/[id]  —  `procurement/grn-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`
- **Design reference:** `redesign/procurement/grn-detail.html`

### GAP-PROCUREMENT-GRN-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Accept / Reject are one-click, irreversible decisions with no ConfirmDialog (InspectGrnForm.tsx:94-99) — Accept computes the three-way match that gates payment (SRN page copy), and Reject is a separate button beside an always-visible optional field; compare the approvals queue which confirms and audits reasons.
- **Verified evidence:** grn/[id]/InspectGrnForm.tsx:94-99 Accept/Reject Buttons call submit() directly (PATCH .../grns/:id/accept|reject, :43) with no ConfirmDialog. Reject requires a reason only via client check (:35-39) from an always-visible second input (:83-86); Accept has an optional remarks input (:79-82). ActionButton/ConfirmDialog with requireReason already exist in _components/ds/ActionButton.tsx and are used by SignSrnAction.tsx. Server SoD (403 SOD_VIOLATION, :53) and audit event emission are server-side and not verifiable here.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/InspectGrnForm.tsx`
- **Fix steps:**
  1. Replace the two Buttons with two <ActionButton> instances; Accept: confirmTitle 'Accept this GRN?', description explaining the three-way match is computed and payment gate affected; Reject: danger, requireReason, minReasonLength 3.
  2. Refactor submit(action) into onConfirm(reason) handlers that throw Error(message) on !res.ok so the dialog shows the SOD_VIOLATION text; keep router.refresh in onSuccess.
  3. Remove the always-visible remarks/reason inputs (reason moves into the dialog; Accept remarks via dialog reason field).
  4. Pass GRN number to the dialog description.
- **Acceptance:**
  - Component test: clicking Accept opens dialog and no fetch fires until Confirm.
  - Reject cannot be confirmed with an empty reason.
  - SOD_VIOLATION response shows the catalogued message inside the dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Accept triggers three-way match feeding payment; confirm step must not lose the SoD error copy.
- **Depends on:** GAP-PROCUREMENT-GRN-DETAIL-03

### GAP-PROCUREMENT-GRN-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Misleading header before inspection: StatusPill uses grn.threeWayMatch ? "accepted" : "rejected" (page.tsx:91-92) so every uninspected GRN shows a red "Three-way mismatch" and the field says "Not matched" (page.tsx:121), while the list shows "—" for the same state (grn/page.tsx:42).
- **Verified evidence:** grn/[id]/page.tsx:90-93 uses grn.threeWayMatch ? 'accepted' : 'rejected' with label 'Three-way mismatch', and :118-123 prints 'Not matched' in red. Root cause is mapProcurementGRNDetail (_data/apiMappers.ts:388) `threeWayMatch: typeof payload.threeWayMatch === 'boolean' ? ... : base.threeWayMatch ?? false`, coercing 'not computed' to false, whereas the list keeps undefined ('—', grn/page.tsx:42). So any uninspected GRN (draft/under_inspection) reads as mismatch.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`
- **Fix steps:**
  1. In mapProcurementGRNDetail (apiMappers.ts:388) drop `?? false` so threeWayMatch stays boolean | undefined (make GRNDetail.threeWayMatch optional in the type).
  2. In page.tsx derive `matchKnown = grn.threeWayMatch !== undefined`.
  3. Header pill: if !matchKnown render StatusPill status='pending' label='Match pending inspection'; else keep accepted/rejected.
  4. Field at :118-123: show 'Pending inspection' in neutral colour when unknown.
  5. Check other consumers of GRNDetail.threeWayMatch (grep) for the type change.
- **Acceptance:**
  - Mapper unit test: payload without threeWayMatch -> undefined.
  - Draft GRN detail shows neutral 'pending' pill, no red mismatch.
  - Inspected GRN with false shows mismatch.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Misleading red 'mismatch' on payment-relevant document; low regression risk if consumers of type are updated.
- **Depends on:** GAP-PROCUREMENT-GRN-04

### GAP-PROCUREMENT-GRN-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** SoD found out late: the creator sees enabled Accept / Reject and only learns after submit that they cannot inspect (InspectGrnForm.tsx:53-55); the page has no createdBy to pre-empt it.
- **Verified evidence:** InspectGrnForm.tsx:53-55 only maps SOD_VIOLATION after submit; header comment :8-15 says the page deliberately does not pre-empt it. page.tsx:52-56 loads no creator identity; GRNDetail carries only receivedBy (mapper apiMappers.ts:352, free text from API, not confirmed to be the creator's user id) and inspection.inspectorId. Session user id is derivable server-side from the JWT sub (pattern in srn/new/page.tsx:8-21). Whether GET /grns/:id returns createdBy cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/InspectGrnForm.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Confirm/add `createdBy` (user id) in the procurement GRN GET response; map it in mapProcurementGRNDetail.
  2. Extract the JWT-sub decode from srn/new/page.tsx into a shared helper (e.g. getSessionUserId in lib/auth) and call it in GRNDetailPage.
  3. Pass `isCreator` prop to InspectGrnForm; when true disable Accept/Reject and show the existing SoD copy up front.
  4. Keep the server 403 handler as backstop.
- **Acceptance:**
  - Test: isCreator=true renders disabled buttons and explanatory text.
  - Creator opening their own GRN cannot fire the PATCH.
  - Different officer can inspect as before.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** UI-only pre-emption; server SoD stays authoritative. Mis-mapped createdBy could wrongly block a legitimate inspector.
- **Depends on:** GAP-PROCUREMENT-GRN-DETAIL-01

### GAP-PROCUREMENT-GRN-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Amend table hides Ordered quantity: AmendGrnForm renders only item code, unit, received, accepted (AmendGrnForm.tsx:86-89) while the read-only table shows Ordered and PO item ref (page.tsx:43-51), so received can be edited without seeing what was ordered; lines without id are silently dropped (AmendGrnForm.tsx:27).
- **Verified evidence:** AmendGrnForm.tsx:85-90 headers are Item code, Unit, Received qty, Accepted qty only; no Ordered or PO item ref, although page.tsx:185 passes items (which carry orderedQty/poItemRef per mapper apiMappers.ts:369-378). The read-only DataTable with Ordered/PO item ref (page.tsx:188-194) renders only when the GRN is not amendable, so during editing the officer never sees ordered qty. Lines lacking id are silently filtered (AmendGrnForm.tsx:26-29). Validation only checks accepted<=received (:45-51); received>ordered not checked. Not a dead route - theme wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/AmendGrnForm.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`
- **Fix steps:**
  1. Extend items prop type and AmendLine with orderedQty and poItemRef; map them at :28.
  2. Add read-only 'PO item' and 'Ordered' columns to the table at :85-90.
  3. Add a validation in handleSubmit: receivedQty > orderedQty -> error naming the item (unless business allows over-delivery: decision).
  4. If any input item lacks id, show a warning listing skipped item codes instead of silent drop.
  5. Update page.tsx:185 only if types require.
- **Acceptance:**
  - Render test: Ordered column present with correct values.
  - Submit with received>ordered is blocked with message (if rule agreed).
  - Item without id produces visible warning.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Over-delivery rule is a business decision; over-strict validation could block valid amendments.

### GAP-PROCUREMENT-GRN-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Load failure vs not-found: SRN fetch result is used without its source (page.tsx:53-56), so a failed SRN lookup shows "Not created" + "Create SRN" for a GRN that may already have one.
- **Verified evidence:** grn/[id]/page.tsx:53-56 destructures `source` only from the GRN result; SRN result is `{ data: srn }`. :127-137 renders 'Not created' + 'Create SRN' when srn is null, including when getSrnByGrn failed (fetchJson returns data null, source 'error'). The header DataSourceBadge (:95) reflects only the GRN fetch.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/page.tsx`
- **Fix steps:**
  1. Destructure `{ data: srn, source: srnSource, status: srnStatus }` from getSrnByGrn.
  2. Compute srnUnknown = srnSource==='error' && srnStatus!==404 (confirm the none-contract with inventory-service).
  3. In the SRN field render StatusPill status='pending' label='Unavailable' with a note 'Couldn't check SRN - refresh' and hide the Create SRN link when srnUnknown.
  4. Optionally reuse DataSourceBadge for the SRN section.
- **Acceptance:**
  - Test: SRN loader error -> no 'Create SRN' link, 'Unavailable' shown.
  - SRN api ok + null -> 'Not created' + link.
  - SRN present -> View SRN link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; avoids duplicate SRN creation on a payment gate.
- **Depends on:** GAP-PROCUREMENT-GRN-DETAIL-SRN-01


---
## /procurement/grn/[id]/srn  —  `procurement/grn-detail-srn.html`

- **Source:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx`
- **Design reference:** `redesign/procurement/grn-detail-srn.html`

### GAP-PROCUREMENT-GRN-DETAIL-SRN-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as absence: only data is read from getSrnByGrn (page.tsx:9), so an API error renders "No Store Receipt Note yet" with a Create SRN button — the clerk may create a duplicate for a GRN that already has a signed SRN.
- **Verified evidence:** srn/page.tsx:8-11 destructures only `data` from getSrnByGrn and getProcurementGRNById; :14-25 renders EmptyState 'No Store Receipt Note yet' + 'Create SRN' whenever !srn. fetchJson (_data/apiClient.ts:105-180) returns {data:null, source:'error', status} on any non-2xx/network/invalid payload, so a 500/timeout is indistinguishable from no SRN. Whether inventory-service returns 404 or 200 {data:null} for 'no SRN' is not visible (service absent from snapshot); mapper getSrnByGrn tolerates both. Server-side duplicate-SRN guard also cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx`
- **Fix steps:**
  1. Destructure `source` and `status` from both loader results in SrnDetailPage.
  2. If srn is null and source==='error' and status!==404, return PageHeader + <RefreshErrorState error={toHumanError('load',{area:'Store Receipt Note'})} backHref={`/procurement/grn/${params.id}`} /> instead of the EmptyState.
  3. Only render the 'No Store Receipt Note yet' EmptyState when source==='api' (or status===404 once confirmed against inventory-service).
  4. Also handle grn error (source==='error') so the subtitle does not silently drop grnNo.
  5. Import RefreshErrorState from ../../../../../_components/ds (already exported).
- **Acceptance:**
  - Component/RSC test: mock getSrnByGrn -> {data:null,source:'error',status:500}; page shows retry error, no 'Create SRN' link.
  - Mock {data:null,source:'api'}; page shows empty state with Create SRN.
  - Manual: stop inventory-service, open a GRN with a signed SRN: error state with Retry, no create CTA.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; risk is treating a genuine 404 as error if the backend uses 404 for 'none' - confirm contract first. Prevents duplicate SRNs gating payment.
- **Depends on:** GAP-PROCUREMENT-GRN-DETAIL-05

### GAP-PROCUREMENT-GRN-DETAIL-SRN-02  ·  MEDIUM  ·  partly  ·  theme WIRING (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Store officer is a raw user id in mono (page.tsx:49) — DPDP-relevant identifier shown instead of a name/designation; received date is "—" for drafts.
- **Verified evidence:** srn/page.tsx:49 prints srn.storeOfficerId in mono; mapSrnDetail (apiMappers.ts:401-416) passes the id through or '—'. The same raw id is also shown in srn/new/CreateSrnForm.tsx:68 (from JWT sub, new/page.tsx:8-21). It is a UUID rather than a name/designation - a usability/traceability gap; masking (Masked/reveal) is not the right remedy since it is an internal user id of a government officer on an internal record, not a secret. Received date '—' for drafts is correct (receivedAt null until sign; :53). No CSV export on this page.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/CreateSrnForm.tsx`
- **Fix steps:**
  1. Decide source of display name: either SRN API returns storeOfficerName/designation, or web resolves via an existing user-directory loader (cannot verify one exists).
  2. Add optional storeOfficerName to SrnDetail and mapSrnDetail.
  3. In page.tsx:49 render `srn.storeOfficerName ?? 'Officer (ID …last6)'`, keeping the id in a title attribute.
  4. In CreateSrnForm show the session user's display name (pass from new/page.tsx) instead of the raw sub.
  5. Show 'Pending - set on signing' instead of '—' for draft received date.
- **Acceptance:**
  - Unit test mapSrnDetail maps storeOfficerName when present.
  - Signed SRN page shows officer name, not UUID.
  - Draft SRN shows 'Pending - set on signing'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; display-only. Do not expose more PII than the existing id.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Irreversible signature with thin evidence: the dialog shows no GRN number, items or values, and the optional reason box is reused as free-text remarks (SignSrnAction.tsx:14,23-30); sign does not send receivedAt, unlike the create flow (CreateSrnForm.tsx:42).
- **Verified evidence:** A confirm dialog DOES exist: SignSrnAction.tsx:28-35 uses ActionButton (ConfirmDialog) with title/description/'Sign' label, irreversibility text at :31. True gaps: dialog does not name the GRN/PO/items (static text), requireReason is not set so the reason box is optional and is sent as `remarks` (:19), overwriting/duplicating the remarks captured at create (CreateSrnForm.tsx:25); the standalone sign sends no receivedAt (SignSrnAction.tsx:19) while the create+sign flow sends it (CreateSrnForm.tsx:42), so a draft signed later has receivedAt unset/server default (server behaviour not verifiable). Maker!=checker and audit emission are server concerns, not visible here.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/SignSrnAction.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx`
- **Fix steps:**
  1. Pass grnNo and receivedAt (and existing remarks) from page.tsx as props to SignSrnAction.
  2. Build confirmDescription as JSX naming the GRN number, vendor and received date; keep the irreversibility warning.
  3. Rename reasonLabel to 'Signing remarks' and decide whether requireReason is needed (product decision); do not overwrite existing srn.remarks when empty (already `reason || undefined`).
  4. Send receivedAt (existing srn.receivedAt or today's ISO date) in the PATCH body, mirroring CreateSrnForm.tsx:41-44.
  5. Verify in inventory-service that sign enforces actor != GRN creator and writes an audit event; add if missing.
- **Acceptance:**
  - Component test: opening dialog shows GRN number text.
  - Test: sign request body contains receivedAt and remarks only when entered.
  - Manual: signed SRN shows received date.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Signing releases the payment gate (GFR 149); wrong receivedAt could misdate a statutory record. Server SoD/audit unverified.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-04  ·  LOW  ·  partly  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Header has no link back to the GRN items or the payment it unblocks; status text colours are hard-coded hex (page.tsx:57).
- **Verified evidence:** srn/page.tsx:57 uses hard-coded '#16a34a'/'#b45309' (true; also GRN detail page.tsx:120 uses hex). A back link to the GRN exists: PageHeader back={`/procurement/grn/${params.id}`} (:12, :35) and the GRN number is plain text (:46-48), not a link. No link to the payment/invoice it unblocks - no payment route/id is available in SrnDetail (apiMappers.ts:401), so that part is cannot-verify. Theme FABRICATED does not apply - no sample data.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx`
- **Fix steps:**
  1. Make the GRN field at :46-48 a <Link href={`/procurement/grn/${params.id}`}>.
  2. Replace inline hex at :57 with existing tone classes (e.g. reuse StatusPill or CSS vars var(--good)/var(--warn)).
  3. Optional: if finance exposes a payment/invoice lookup by GRN, add a 'View payment' link; otherwise omit.
- **Acceptance:**
  - GRN number in SRN card navigates to GRN detail.
  - No hex literals remain in file (lint/grep).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /procurement/grn/[id]/srn/new  —  `procurement/grn-detail-srn-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/page.tsx`
- **Design reference:** `redesign/procurement/grn-detail-srn-new.html`

### GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-01  ·  HIGH  ·  partly  ·  theme PARTIAL-FAILURE (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreateSrnForm.tsx:67-86 pushes ?signFailed=1 and treats missing id as failure, BUT srn/page.tsx never reads signFailed so no 'saved as Draft, sign again' banner is shown
- **First-pass claim:** Partial success is silent: create and sign are two non-atomic calls; if sign fails the code just navigates to the SRN page (CreateSrnForm.tsx:46-50) with no error, so the clerk who ticked "Sign now" believes the payment gate is cleared while the SRN is still a Draft.
- **Verified evidence:** CreateSrnForm.tsx:56-60 POST create then :72-79 PATCH sign; when sign fails (lines 80-86) it router.push('/procurement/grn/<id>/srn') with no message (line numbers in the observation are off). True that no error is shown at that moment. Mitigation: the landing page (srn/page.tsx:35,57-58) shows a 'Draft' pill and 'Draft — not yet signed' plus a SignSrnAction button, so the state is visible, but the clerk is not told signing failed. If create returned no id, `created.id` is falsy and the sign step is silently skipped too (line 71).
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/CreateSrnForm.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/srn/page.tsx`
- **Fix steps:**
  1. On sign failure, router.push to the SRN page with `?signFailed=1` (or stay and show an alert) and render a banner 'SRN saved as Draft - signing failed, please sign again' on srn/page.tsx.
  2. Treat `signNow && !created.id` as an error too.
  3. Check the real sign-response status/body before claiming success.
  4. Longer term ask backend for a single create-and-sign endpoint for atomicity.
- **Acceptance:**
  - Test: create 201, sign 500 -> user sees a signing-failed message and Draft state.
  - Test: create 201 without id and signNow -> error shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Payment gate (GFR 149) accuracy; SRN state must never appear signed when it is not.
- **Depends on:** GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-02

### GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Irreversible action pre-armed: "Sign now" defaults to true (Form:13) and there is no ConfirmDialog, unlike the sign button on the SRN page (SignSrnAction.tsx:28-36); the form does not show the GRN items being accepted.
- **Verified evidence:** CreateSrnForm.tsx:47 `useState(true)` for signNow; submit (line 98/handleSubmit) signs immediately with no ConfirmDialog. SignSrnAction.tsx:28-36 uses ActionButton with confirmTitle/confirmDescription for the same irreversible sign. srn/new/page.tsx does not fetch the GRN, so items being accepted are not shown (only the checkbox label explains the consequence, line 125).
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/CreateSrnForm.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/page.tsx`
- **Fix steps:**
  1. Default signNow to false (create as Draft) or keep true but gate submit behind the shared ConfirmDialog used by ActionButton when signNow is checked, reusing the SignSrnAction wording.
  2. Fetch the GRN in page.tsx (existing grn detail loader) and show a read-only items/quantities summary above the form.
  3. Emit/verify audit event server-side for sign (cannot-verify; inventory-service absent).
- **Acceptance:**
  - Test: with signNow true, clicking Sign & Submit opens a confirm dialog and does not call fetch until confirmed.
  - Manual: GRN items are visible on the form.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Irreversible payment-gate action; confirm maker-checker policy for the store officer.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme FORM-STATE (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Received date is only sent on the sign call (Form:41-44); the create body carries just grnId and remarks (Form:25), so untick "Sign now" and the entered date is discarded without notice.
- **Verified evidence:** CreateSrnForm.tsx:59 create body is {grnId, remarks}; receivedAt is sent only in the sign PATCH (line 76). With signNow unticked the date input (lines 104-112) remains visible and editable but is discarded. Also SignSrnAction.tsx:19 later signs without any receivedAt. Whether the create endpoint accepts receivedAt is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/CreateSrnForm.tsx`
- **Fix steps:**
  1. Hide or disable the Received date field when signNow is false, with helper text 'Date is recorded when the SRN is signed'.
  2. Alternatively ask backend to accept receivedAt on create and send it in the create body.
  3. Add max={today} on the date input to block future dates.
- **Acceptance:**
  - Test: untick sign -> date field hidden/disabled.
  - Test: with sign ticked, PATCH body contains receivedAt from the field.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; recorded receipt date affects audit.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Store officer is taken from an unverified JWT payload decode (base64 "sub") in the page (page.tsx:8-19) and shown as a raw id; it is not sent, so the server must derive the officer — the displayed value could differ from the recorded one.
- **Verified evidence:** srn/new/page.tsx:8-21 sessionUserId() base64-decodes the access-token payload with no signature check and returns sub; CreateSrnForm.tsx:102 shows it raw (`<span className="mono">{storeOfficerId}</span>`). The id is not in either request body (lines 59, 75-78), so the server derives the officer; if that differs the display is wrong. The same unverified-decode pattern exists in lib/auth/roleGuard.ts (has getSessionName, name claim).
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/page.tsx`, `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/CreateSrnForm.tsx`
- **Fix steps:**
  1. Replace sessionUserId() with getSessionName() from lib/auth/roleGuard (display name), falling back to 'You'.
  2. Pass `storeOfficerName` to the form instead of the id; never print the sub.
  3. Label it 'Recorded as (from your session)' and note the server sets the officer.
- **Acceptance:**
  - Test: page renders the session name, not a UUID.
  - Test: no token -> shows '—' and the request still succeeds/fails per server auth.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Display only; authoritative officer must remain server-side.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-05  ·  LOW  ·  confirmed  ·  theme A11Y-ERRORS (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreateSrnForm.tsx:11-21 status-branched copy (409/403), :96 network copy, :145 officer label now div, htmlFor ids; missing 422 branch and aria-describedby on message region
- **First-pass claim:** Error message is the generic save copy for both create and network failure (Form:29-31,55-58); no field-level errors and the store-officer label wraps a non-input span (Form:64-67).
- **Verified evidence:** CreateSrnForm.tsx:62-66 non-ok create uses toHumanError('save') for any status; the catch (line 91-94) shows err.message ('Network error' or raw text). No field-level errors. The Store officer `<label className="field">` (line 100-103) wraps only spans (no control), and the Received date/Remarks/checkbox labels rely on implicit wrapping. Theme 'PII' is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/[id]/srn/new/CreateSrnForm.tsx`
- **Fix steps:**
  1. Change the store officer label to a `<div className="field">` with `<span className="label">` (no <label> without control).
  2. Branch on res.status: 409 (SRN already exists) / 403 / 422 with tailored toHumanError copy; use a network-specific message in catch instead of err.message.
  3. Add htmlFor/id pairs and aria-describedby for the message region.
- **Acceptance:**
  - Test: 409 response -> 'already exists' style message; fetch reject -> network-specific copy.
  - axe: no label-without-control violation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/grn/new  —  `procurement/grn-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/grn/new/page.tsx`
- **Design reference:** `redesign/procurement/grn-new.html`

### GAP-PROCUREMENT-GRN-NEW-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GRN number is generated in the browser: grnNo = GRN/{year}/{Math.floor(Math.random()*900)+100} (CreateGRNForm.tsx:147). Only 900 values per year, collision-prone, and gapped/non-sequential for a numbered government store document — should be server-issued.
- **Verified evidence:** grn/new/CreateGRNForm.tsx:147 builds grnNo = `GRN/${year}/${String(Math.floor(Math.random()*900)+100)}` and posts it (:149). Only 900 values/year, random, non-sequential; collision produces either a server duplicate error or a duplicate number. Backend procurement service is not in the snapshot (only hrms-service), so whether POST /procurement/grns accepts a missing grnNo or has a sequence generator cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`, `services/procurement-service (GRN create handler / numbering sequence)`
- **Fix steps:**
  1. Backend: issue grnNo server-side from a per-tenant per-financial-year sequence inside the create transaction; make request field optional/ignored.
  2. Web: delete the grnNo line at :147 and the `grnNo` key in the body (:149).
  3. Show returned grnNo on the redirect/detail page.
  4. Add a unique index on (tenant, grnNo) if absent.
- **Acceptance:**
  - POST without grnNo returns a GRN with sequential number.
  - Concurrent creates produce unique numbers (integration test).
  - Web body contains no client-generated grnNo.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Numbered statutory store document; sequence must be gapless-ish and transactional. Migration for existing random numbers.

### GAP-PROCUREMENT-GRN-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Silent full-receipt default: the first PO and first item are auto-selected and Ordered = Received = Accepted are pre-filled (Form:82,113); "Record GRN" with no edits records a complete, fully accepted delivery. Only the first PO item is pre-filled, so other items must be added by hand (Form:113).
- **Verified evidence:** CreateGRNForm.tsx:82 auto-calls selectPo(clean[0]) and :112-115 sets one line with orderedQty=receivedQty=acceptedQty=items[0].quantity. Submit (:137-161) applies no further confirmation, so 'Record GRN' with no edits records a full, fully accepted delivery of the first item only; other PO items must be added with '+ Add line item' (:124). Vendor also defaulted to first vendor (:68). Note: acceptedQty on a not-yet-inspected GRN is questionable since inspection is a separate step (header comment :25-34).
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`
- **Fix steps:**
  1. Do not auto-select the first PO/vendor: add an empty 'Select purchase order' option and leave poId empty.
  2. On PO select, create one row per PO item with orderedQty prefilled but receivedQty/acceptedQty empty (or 0) so the clerk must enter them.
  3. Block submit when all received quantities are 0 with a clear message.
  4. Decide (product) whether acceptedQty should be entered at all before inspection; if not, remove the field and send 0 (check server contract).
- **Acceptance:**
  - Opening the form shows no PO selected and no lines with quantities.
  - Selecting a 3-item PO shows 3 rows, received blank.
  - Submit with zero received is rejected client-side.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Behaviour change for clerks used to one-click full receipts; wrong quantities feed the three-way match.
- **Depends on:** GAP-PROCUREMENT-GRN-NEW-03

### GAP-PROCUREMENT-GRN-NEW-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Quantities unchecked on create: accepted > received or received > ordered are accepted by the form (only the amend form validates, AmendGrnForm.tsx:46); unit is hard-coded "nos" for every line (Form:159) although PO items may be reams, kg etc.
- **Verified evidence:** CreateGRNForm.tsx:137-144 only checks vendor, poRef and at least one line with ref+code; no accepted<=received or received<=ordered check (AmendGrnForm.tsx:45-51 has accepted<=received only). Math.max(0,...) at :156-158 silently clamps negatives. Unit is hard-coded 'nos' (:159); POItem type (:11) carries no unit and selectPo (:103-110) does not read one from the PO item, though the PO API may supply it (not verifiable). Server-side validation may exist but cannot be seen. Not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`
- **Fix steps:**
  1. Add a validate(lines) function used in handleSubmit: acceptedQty<=receivedQty, receivedQty<=orderedQty (or warn on over-delivery), integers/non-negative; show per-row error next to the item code.
  2. Prefer a zod schema at the boundary (per CLAUDE.md) shared with AmendGrnForm.
  3. Extend POItem with `unit` from i.unit in selectPo and store it on GRNLine; send l.unit instead of 'nos'; fallback to 'nos' only if the PO gives none.
  4. Replace silent Math.max clamp with validation error.
- **Acceptance:**
  - Unit test: accepted 5 / received 3 blocked with message.
  - Unit test: received 12 / ordered 10 blocked or warned.
  - Payload unit equals PO item's unit when provided.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Quantities drive three-way match and payment; stricter rules may reject legitimate over-delivery.

### GAP-PROCUREMENT-GRN-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Vendor locked to PO vendor (CreateGRNForm.tsx:107-121,285) and backend rejects mismatch (grn/commands.ts:34); PO dropdown still capped limit=100 with no search combobox (:84)
- **First-pass claim:** PO and Vendor are independent selects (Form:190-207): picking a PO sets the vendor only when po.vendorId exists, and the vendor can then be changed to one that does not match the PO; PO dropdown is capped at 100 with no search (Form:76).
- **Verified evidence:** CreateGRNForm.tsx:190-207 are two independent <select>s. selectPo sets vendor only if po.vendorId (:96); Vendor onChange (:201) can then diverge from the PO's vendor, and body sends both vendorId and poRef (:150-151). Both lists fetched with ?limit=100 and no search (:62, :76), so POs/vendors beyond 100 are unreachable. Server may cross-check PO vs vendor; not verifiable.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`, `services/procurement-service (pos list ?q search; GRN create vendor/PO consistency check)`
- **Fix steps:**
  1. Make Vendor read-only/derived when the selected PO has vendorId (show name text, keep vendorId in state).
  2. If PO lacks vendorId, keep the select but validate on submit that it matches PO vendor name when available.
  3. Replace PO select with a searchable combobox that queries /procurement/pos?q=...&limit=25 (confirm backend supports q).
  4. Backend: reject POST when vendorId != PO.vendorId.
- **Acceptance:**
  - Choosing a PO locks vendor to PO's vendor.
  - Typing a PO number beyond the first 100 finds it.
  - Server returns 4xx on vendor/PO mismatch (integration test).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** GRN against wrong vendor would corrupt three-way match.

### GAP-PROCUREMENT-GRN-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Load failures are swallowed with no message (Form:69-71,83-85,96-98): selects remain "Loading POs…" / "Loading vendors…" and the clerk cannot tell whether to wait or retry.
- **Verified evidence:** CreateGRNForm.tsx: vendors fetch `if (!res.ok) return;` (:63) and catch does nothing (:69-72); POs same (:77, :83-86); selectPo sets items [] silently on failure (:99, :116-118). Selects keep the '<option>Loading vendors…/POs…' placeholder forever (:193, :202) because it is conditioned on list length, not on load state. Only the abort case is intentional.
- **Files to change:** `apps/web/src/app/(app)/procurement/grn/new/CreateGRNForm.tsx`
- **Fix steps:**
  1. Add loadState per list: 'loading' | 'ready' | 'error' (vendors, pos, poItems).
  2. Placeholder option text: 'Loading…' only while loading; 'No purchase orders found' when ready+empty; 'Couldn't load - Retry' when error.
  3. Render an inline alert with a Retry Button that re-runs the fetch (extract fetchVendors/fetchPos functions).
  4. On PO-detail failure show message 'Couldn't load PO items' and keep manual entry with a warning.
  5. Disable Record GRN while lists are loading/errored.
- **Acceptance:**
  - Mock fetch 500 for /pos: alert with Retry appears, placeholder no longer says Loading.
  - Retry succeeds and populates list.
  - Empty list shows 'No purchase orders found'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /procurement/indents  —  `procurement/indents.html`

- **Source:** `apps/web/src/app/(app)/procurement/indents/page.tsx`
- **Design reference:** `redesign/procurement/indents.html`

### GAP-PROCUREMENT-INDENTS-01  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Hard cap: limit 500 with client-side paging and stats computed on that slice (page.tsx:31,33-35); no truncation cue for a busy department.
- **Verified evidence:** indents/page.tsx:31 getProcurementIndents({limit:500}); stats at l.33-35 and indents.length (l.64) are computed on that slice; DataTable is client-side pageSize 10 (l.89) with client filter; no cue when 500 rows returned. Loader supports limit/offset/q (loaders.ts:2408-2425) but page never passes them.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Read searchParams (page, q, status) in the page and pass limit/offset/q to getProcurementIndents.
  2. Return a total (and status counts) from the API/loader and feed StatCards from it; if not available, show a 'showing first 500' notice when length===500.
  3. Use the DataTable server-pagination mode if present, else a Pagination control with links.
  4. Add a status filter param.
- **Acceptance:**
  - Test with 500 mocked rows: truncation notice visible.
  - Page 2 request sends offset=<pageSize>.
  - Stat totals match server total, not slice length.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Totals API is cannot-verify (service absent); interim notice is safe.
- **Depends on:** GAP-PROCUREMENT-INDENTS-03

### GAP-PROCUREMENT-INDENTS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch: ErrorState in the card but Total / Pending / Approved / Converted stay 0 (page.tsx:63-70) — unlike the dashboard's "—".
- **Verified evidence:** On source==='error' the card shows ErrorState (page.tsx:71-73; header also has DataSourceBadge l.58) but StatCard values are indents.length/filter counts = 0 (l.64-67). StatCard.tsx already renders '—' for null/undefined. Observation's 'no header cue' is not claimed; a small badge exists but the zeros remain.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/page.tsx`
- **Fix steps:**
  1. Compute stats as null when source==='error'.
  2. Swap ErrorState for RefreshErrorState (client wrapper in ds) so Retry works in this server component.
  3. Keep the empty state only for source!=='error' && rows.length===0.
- **Acceptance:**
  - Test: mock loader source 'error' -> four StatCards show '—' and Retry button present.
  - Non-error 0 rows still shows 0 and EmptyState.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** RefreshErrorState

### GAP-PROCUREMENT-INDENTS-03  ·  MEDIUM  ·  confirmed  ·  theme STATS_COVERAGE (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Stats omit Rejected, Draft and Tender Required although these statuses are labelled (page.tsx:8-16,33-35): Tender Required indents — the ones needing a procurement action — have no visible count.
- **Verified evidence:** STATUS_LABELS (page.tsx:8-16) knows draft, tender_required, rejected, closed, but only pendingApproval/approved/converted are counted (l.33-35) and shown (l.65-67). tender_required is the actionable state and has no count.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/page.tsx`
- **Fix steps:**
  1. Add counts for tender_required, rejected and draft (or a status Segmented filter with counts).
  2. Put Tender Required next to Pending Approval and link it to a filtered list.
  3. Add a screen-reader label/non-colour cue to status cells (StatusPill text already available).
- **Acceptance:**
  - Test: fixture with 2 tender_required indents shows 'Tender Required 2'.
  - Counts sum to total across all statuses.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PROCUREMENT-INDENTS-01

### GAP-PROCUREMENT-INDENTS-04  ·  LOW  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Requested By" and "Department" print whatever strings the mapper returns (raw ids if the backend returns ids); "Required By" is "—" when absent (page.tsx:45).
- **Verified evidence:** page.tsx:41-42,45 passes i.requestedBy and i.department straight to the table; mapper apiMappers.ts:217 does toText(row.requestedBy) ?? '—'. Code does print whatever string arrives, but I cannot confirm the backend returns ids rather than names (procurement-service absent). 'Required By' '—' at l.45 is true.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Check a live indents payload for requestedBy; if it is a UUID, resolve to display name in the API (preferred) or add requestedByName to the mapper.
  2. Fall back to '—' rather than a UUID by rejecting UUID-shaped values in the mapper.
- **Acceptance:**
  - Test: mapper given a UUID requestedBy renders '—' or the name field, never the UUID.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; depends on backend payload.


---
## /procurement/indents/[id]  —  `procurement/indents-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/indents/[id]/page.tsx`
- **Design reference:** `redesign/procurement/indents-detail.html`

### GAP-PROCUREMENT-INDENTS-DETAIL-01  ·  HIGH  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead end: no action on the detail page (no submit, approve, reject, convert-to-PO or close) even for statuses like "Tender Required" or "Approved" that imply a next step (page.tsx:69-146); approval happens only in the workflow queue at /procurement/approvals, which links back here by id.
- **Verified evidence:** indents/[id]/page.tsx:35-143 is read-only: no buttons/forms. Create form submits straight to workflow ('Indent submitted for approval via workflow', CreateIndentForm.tsx:84) and approve/reject happens in approvals/ProcurementApprovalsPanel.tsx, which links back by id (:103), so approval being outside the page is by design. Real gap: no contextual next step (link to the pending approval task, or 'Create PO' for approved/tender_required). Existence of a convert-to-PO or tender-create endpoint/route from an indent is not verifiable here; no indents/[id]/actions component exists.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/[id]/page.tsx`
- **Fix steps:**
  1. Show a status-driven 'Next step' line in the PageHeader actions: pending_approval -> link to /procurement/approvals; approved -> link to PO creation (verify orders/new route accepts an indent id); tender_required -> link to tenders/new.
  2. Do not add approve/reject here unless the workflow API supports it (keep single approval surface).
  3. Hide links the user lacks role for once HOME-01 role helper exists.
- **Acceptance:**
  - Approved indent shows a working 'Create purchase order' link.
  - Pending indent shows 'View in approvals'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Linking to conversion flows that do not exist would create new dead ends.
- **Depends on:** GAP-PROCUREMENT-HOME-01

### GAP-PROCUREMENT-INDENTS-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Purpose / justification is captured on the create form (purpose, CreateIndentForm.tsx:59) but never shown here — an approver reading the indent cannot see why it is needed (page.tsx:81-112).
- **Verified evidence:** CreateIndentForm.tsx:21,50,59,138-139 collect and submit `purpose` (required, min 3). The detail path never maps it: mapProcurementIndentDetail (_data/apiMappers.ts:229-268) has no purpose handling (grep finds none in apiMappers.ts) and IndentDetail rendering (page.tsx:81-112) has no purpose field. Whether GET /procurement/indents/:id returns purpose is not verifiable (service absent).
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/procurement/indents/[id]/page.tsx`, `IndentDetail type in web types/loaders`
- **Fix steps:**
  1. Confirm the API returns `purpose` (add to response DTO if not).
  2. Add `purpose?: string` to IndentDetail and map `toText(payload.purpose)` in mapProcurementIndentDetail.
  3. Render a full-width 'Purpose / justification' field after Required By in page.tsx.
  4. Consider showing it in the approvals panel too.
- **Acceptance:**
  - Mapper test: payload with purpose -> detail.purpose.
  - Indent detail shows purpose text.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; approvers currently lack justification.

### GAP-PROCUREMENT-INDENTS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme FORMAT (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Approval-trail timestamp is printed raw (step.timestamp, page.tsx:134-146) — an ISO string rather than an Indian-format date/time — and there is no reason column emphasis for rejections.
- **Verified evidence:** page.tsx:134 prints {step.timestamp} raw; mapper (apiMappers.ts:257-263) passes toText(step.timestamp) unchanged, so an ISO string is shown. formatters.ts exports only formatIndianDate (no date-time helper). Remarks are shown for all steps in the same small grey style (:135) with no emphasis for rejected steps. No confirm/approval action exists on this page, so the CONFIRM theme is wrong.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/procurement/indents/[id]/page.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) in lib/formatters.ts (DD MMM YYYY, hh:mm a, Asia/Kolkata), returning the input on parse failure.
  2. Use it at page.tsx:134.
  3. If step.action matches /reject/i render remarks in danger colour with a 'Reason:' prefix.
  4. Add unit test for the formatter.
- **Acceptance:**
  - Timestamp '2026-09-01T09:30:00Z' displays as '01 Sep 2026, 03:00 pm'.
  - Rejected step shows 'Reason: ...' emphasised.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Timezone handling must be explicit (IST).

### GAP-PROCUREMENT-INDENTS-DETAIL-04  ·  LOW  ·  confirmed  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pill appears twice (header and details card, page.tsx:75,109); trail dot colour and text colours are hard-coded hex (page.tsx:128-140).
- **Verified evidence:** page.tsx:75 (header) and :109 (details card) both render the same StatusPill. Hard-coded colours at :129 (#818cf8), :131 (#1e293b) and :132 (#64748b), :135 (#64748b). Not fabricated data; theme is styling/duplication.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/[id]/page.tsx`
- **Fix steps:**
  1. Keep the header pill and drop the duplicate 'Status' field at :107-110 (or keep field and remove header pill - pick one).
  2. Replace inline hex with design tokens (var(--mut), var(--ink), accent var) used elsewhere in the file (:134 already uses var(--mut)).
  3. Optionally extract an ApprovalTrail component under procurement/_components.
- **Acceptance:**
  - Only one status pill on the page.
  - No hex literals in the file (grep).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /procurement/indents/new  —  `procurement/indents-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/indents/new/page.tsx`
- **Design reference:** `redesign/procurement/indents-new.html`

### GAP-PROCUREMENT-INDENTS-NEW-01  ·  MEDIUM  ·  confirmed  ·  theme DEFAULT (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreateIndentForm.tsx:32 department default now empty and required with per-field error (:91), but still a free-text input; no department picker/session-home default (cf. planning/new EntityPicker)
- **First-pass claim:** Wrong-department default: Department is a free-text input pre-filled "Finance" (CreateIndentForm.tsx:17) — a Housing & Urban Development officer who does not overwrite it raises the indent under Finance, which drives routing and reporting.
- **Verified evidence:** CreateIndentForm.tsx:17 useState('Finance') seeds a free-text <input id=department> (l.107-108); submit only checks non-empty (l.50) and posts department.trim() (l.58). Nothing ties it to the user's org unit.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/new/CreateIndentForm.tsx`
- **Fix steps:**
  1. Change initial department state to '' so it must be chosen.
  2. Replace the free-text input with a select/picker fed by the user's own department(s) from the session/org-unit list, defaulting to the user's home department when there is exactly one.
  3. Keep the required check at l.50 and show a per-field error under the control.
  4. Send the department id/code the API expects rather than a display string if the indent API supports it (cannot-verify: procurement-service absent).
- **Acceptance:**
  - Component test: a fresh form has an empty department and submit is blocked with a field error.
  - Manual: user in Housing & Urban Development sees their department preselected, not Finance.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong department drives routing/reporting; low regression risk.
- **Depends on:** GAP-PROCUREMENT-INDENTS-NEW-05

### GAP-PROCUREMENT-INDENTS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Two money inputs that can disagree: the header "Estimated total value" (which selects the GFR mode band, Form:29-43,62) is typed independently of the line-item Total computed in LineItemsEditor (LineItemsEditor.tsx:119-125); the mode band can be wrong for the actual total.
- **Verified evidence:** Header estimatedValue state (l.20, input l.124) is independent of the LineItemsEditor total (lineItemsTotalMinor, LineItemsEditor.tsx:18-23, shown l.126). Mode lookup (l.30-45) and estimatedValueMinor (l.62) use only the header figure; both use Math.round(parseFloat*100).
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/new/CreateIndentForm.tsx`, `apps/web/src/app/(app)/procurement/_components/LineItemsEditor.tsx`
- **Fix steps:**
  1. Drop the separate header input; derive estimatedValueMinor = lineItemsTotalMinor(items) (already exported) and show it read-only, or keep the header field as an optional override that must equal the total.
  2. Drive the mode-band useEffect off the derived minor value (debounced) instead of estimatedValue string.
  3. If override retained, add zod refine: |header - lines| = 0 else per-field error 'Does not match line total'.
  4. Show the derived total next to the mode badge so the clerk sees the basis.
- **Acceptance:**
  - Test: two lines totalling 2,50,000 give band lookup with estimatedValueMinor=25000000 without typing a header value.
  - Test: editing a line price re-runs the lookup.
  - Mismatched override blocks submit with a visible error.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** GFR mode band (tender vs quotation) is a compliance decision; a wrong band can allow under-tendering.
- **Depends on:** GAP-PROCUREMENT-INDENTS-NEW-03

### GAP-PROCUREMENT-INDENTS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Mode lookup failure looks like loading: .catch sets the band to null (Form:43), so "Determining mode…" (Form:131-133) never resolves and no warning tells the clerk the tender-requirement check did not run.
- **Verified evidence:** Form l.35-43: fetch has no r.ok check and .catch only sets modeBand null; l.132-133 shows 'Determining mode…' whenever a value is typed and modeBand is null, so failure or unknown applicableMode is indistinguishable from loading; no warning that the tender check did not run.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/new/CreateIndentForm.tsx`
- **Fix steps:**
  1. Add a modeState: 'idle'|'loading'|'ready'|'error' set in the effect; check r.ok and throw on non-OK.
  2. Render 'Determining mode…' only for loading; for error show role=alert text 'Could not check the procurement mode. Retry.' with a retry button (re-run effect).
  3. Optionally block submit or require a confirmation checkbox when estimatedValue > 0 and mode is in error.
  4. Use toHumanError('load', {area:'procurement mode'}) for the copy.
- **Acceptance:**
  - Test: mock fetch rejection -> error text and retry visible, no 'Determining mode…'.
  - Test: 500 response also shows the error.
  - Successful lookup still renders the badge.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Silent failure hides the tender-required warning; fix has low regression risk.
- **Depends on:** GAP-PROCUREMENT-INDENTS-NEW-02

### GAP-PROCUREMENT-INDENTS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme CLIENT_GENERATED_ID (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Indent number is generated in the browser as "IND-" + Date.now().toString(36) (Form:16) rather than issued by the server, so numbering is neither sequential nor guaranteed unique; unit is hard-coded "nos" for every line (Form:67) though LineItemsEditor accepts a unitLabel prop.
- **Verified evidence:** Form l.16 indentNo = 'IND-'+Date.now().toString(36).toUpperCase() sent in the POST body (l.57); it is not sequential and uniqueness is only by millisecond. l.67 sends unit:'nos' for every line although the LineItem type (LineItemsEditor.tsx:7-12) has no unit and the unitLabel prop is only an sr-only string (l.135). Whether the server accepts a missing indentNo is cannot-verify (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/new/CreateIndentForm.tsx`, `apps/web/src/app/(app)/procurement/_components/LineItemsEditor.tsx`
- **Fix steps:**
  1. Stop sending indentNo (or make it optional) and have the server allocate it from a sequence; show 'Assigned on submit' in the read-only field.
  2. Add a unit field (select from UoM list) to LineItem/emptyLineItem and the editor table; send it_.unit instead of 'nos'.
  3. Remove the unitLabel prop or wire it to the visible column.
  4. Show the server-issued number in the success message/redirect.
- **Acceptance:**
  - Backend test: two concurrent creates get distinct sequential numbers.
  - Component test: choosing 'kg' on a line posts unit:'kg'.
  - Field no longer shows a browser-generated number.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Document numbering is statutory/audit relevant; needs series and gap-free rules decided.
- **Depends on:** GAP-PROCUREMENT-ORDERS-NEW-02, GAP-PROCUREMENT-ORDERS-NEW-04

### GAP-PROCUREMENT-INDENTS-NEW-05  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Validation is a single summary line, not per field (Form:49-52); only Department and Purpose can show server field errors; required-by is not checked to be on/after indent date.
- **Verified evidence:** Form l.49-54 has one combined message and noValidate on the form (l.93); only formError.fieldError('department') and ('purpose') are rendered (l.109,140). requiredBy (l.19,61) is never compared with indentDate; estimatedValue negative is blocked only by min attr with noValidate.
- **Files to change:** `apps/web/src/app/(app)/procurement/indents/new/CreateIndentForm.tsx`, `apps/web/src/lib/useFormError.ts`
- **Fix steps:**
  1. Add a zod schema (dept min1, purpose min3 max500, requiredBy >= indentDate, items >=1 with itemCode/description) and run safeParse in handleSubmit.
  2. Render errors per field (aria-invalid + aria-describedby) including requiredBy, estimatedValue and line items.
  3. Set min={indentDate} on the requiredBy input.
  4. Surface server fieldErrors for all posted fields via formError.fieldError.
- **Acceptance:**
  - Test: requiredBy before indentDate shows a field error and does not POST.
  - Test: empty purpose error appears under purpose only.
  - Submit stays disabled while status=submitting (already true).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; client validation mirrors server.
- **Depends on:** GAP-PROCUREMENT-INDENTS-NEW-01


---
## /procurement/orders  —  `procurement/orders.html`

- **Source:** `apps/web/src/app/(app)/procurement/orders/page.tsx`
- **Design reference:** `redesign/procurement/orders.html`

### GAP-PROCUREMENT-ORDERS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as an empty order book: unlike its sibling pages the route has no page-level badge or ErrorState (page.tsx:8-30) — stats show 0 and "₹0.00", and the only cue is a small badge inside the card above "No purchase orders found" (OrdersTable.tsx:71-78).
- **Verified evidence:** orders/page.tsx:8-30 uses source only for OrdersTable; StatCards show orders.length=0 and formatMoney(0)=0.00 on error (StatCard shows '—' only for null). Error cue is DataSourceBadge inside OrdersTable.tsx:71-77 above the EmptyState 'No purchase orders found' (l.79). Note OrdersTable may serve cached rows via useSeededResource while stats are 0.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/page.tsx`, `apps/web/src/app/(app)/procurement/orders/OrdersTable.tsx`
- **Fix steps:**
  1. In page.tsx pass null to StatCard values when source==='error'.
  2. In OrdersTable, when provenance==='error-no-data' render RefreshErrorState instead of EmptyState.
  3. Compute stats from the same rows the table shows (or lift stats into the client component).
- **Acceptance:**
  - Test: error source -> stats '—' and error state, no 'No purchase orders found'.
  - Cached rows -> stats match table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-PROCUREMENT-ORDERS-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Order Value sums every PO regardless of status (page.tsx:11), so cancelled and draft POs inflate committed spend; stats come from the server slice (limit 500, page.tsx:8) while rows come from the seeded/cached resource (Table:43-48), so they can disagree.
- **Verified evidence:** page.tsx:11 totalAmount sums every order incl. draft/cancelled; stats are from getProcurementPOs({limit:500}) (l.8) while OrdersTable displays useSeededResource data (OrdersTable.tsx:43-48), so they may differ.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/page.tsx`
- **Fix steps:**
  1. Sum only committed statuses (approved, dispatched, partial_grn, fully_received, gem_placed) and label 'Committed value'.
  2. Derive stats from the same dataset as the table.
  3. Show a 'first 500' notice or server totals when capped.
  4. Do sum in integer minor units (bigint if strings).
- **Acceptance:**
  - Test: cancelled 1,00,000 PO excluded from Committed value.
  - Stat equals visible-row sum.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Finance reporting: overstated committed spend.
- **Depends on:** GAP-PROCUREMENT-ORDERS-01

### GAP-PROCUREMENT-ORDERS-04  ·  MEDIUM  ·  confirmed  ·  theme FILTER (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** No status filter or chips: with eight statuses (Table:20-29) the only tool is free-text search; Active count excludes "pending" and "draft" without explanation (page.tsx:10).
- **Verified evidence:** OrdersTable.tsx:20-29 lists 8 statuses; DataTable has only free-text filter (l.116-117). page.tsx:10 Active = approved|partial_grn|dispatched, so pending/draft/gem_placed are unexplained.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/OrdersTable.tsx`, `apps/web/src/app/(app)/procurement/orders/page.tsx`
- **Fix steps:**
  1. Add status chips/Segmented with counts driven by STATUS_LABELS.
  2. Rename 'Active' to 'In fulfilment' with HelpTip, or add a 'Pending approval' stat.
  3. Include gem_placed where relevant.
- **Acceptance:**
  - Test: clicking 'Pending Approval' chip filters rows.
  - Stat label explains what is counted.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-ORDERS-05  ·  LOW  ·  partly  ·  theme STATUS (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GRN Status prints the raw API string or "—" (Table:59) while GRN pages use labelled statuses; deliveryDate is a plain date with no overdue cue.
- **Verified evidence:** OrdersTable.tsx:59 grnStatus = o.grnStatus ?? '—' prints the raw API string; deliveryDate uses formatIndianDate correctly (l.58) with no overdue cue. The comparison with GRN pages was not checked.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/OrdersTable.tsx`
- **Fix steps:**
  1. Map grnStatus through a label map (pending, partial, complete) shared with GRN pages.
  2. Add an 'Overdue' StatusPill/tone when deliveryDate < today and status not fully_received/cancelled.
- **Acceptance:**
  - Test: grnStatus 'partial' renders 'Partially received'.
  - Past delivery on dispatched PO shows Overdue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /procurement/orders/[id]  —  `procurement/orders-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/orders/[id]/page.tsx`
- **Design reference:** `redesign/procurement/orders-detail.html`

### GAP-PROCUREMENT-ORDERS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme APPROVAL_PATH (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — Page side done (APPROVAL_RAISABLE_STATUSES draft/pending page.tsx:23,164; Approval card; status-aware dispatch hint; tests). But second path still live: PO create still enqueues a workflow-inbox instance (services/procurement-service/src/modules/po/consumer.ts:229-243 procurement_po_approval) while page says release path is eOffice, and CreatePOForm.tsx:140 still says 'PO submitted for workflow approval.' Pending PO still has two approval mechanisms; no evidence of product-owner decision/dedupe
- **First-pass claim:** Two competing approval paths on one screen: the PO enters the workflow inbox on create (CreatePOForm "submitted for workflow approval"), yet RaiseEOfficeNote (page.tsx) offers a second, eOffice approval for any status including approved and dispatched, and DispatchPOActions tells the user to "Approve via workflow inbox" (DispatchPOActions.tsx). An officer cannot tell which decision actually releases the PO.
- **Verified evidence:** orders/[id]/page.tsx:126-134 renders RaiseEOfficeNote for every status (no gating), which posts to /estab/files/from-module then notifyPath submit-approval; CreatePOForm.tsx:244 says 'PO submitted for workflow approval'; DispatchPOActions.tsx:15-16 says 'Approve via workflow inbox' for any non-approved status. Two approval mechanisms are offered; whether the backend deduplicates is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/orders/[id]/DispatchPOActions.tsx`, `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`
- **Fix steps:**
  1. Decide the single release-approval path (workflow inbox vs eOffice) with the product owner.
  2. Show RaiseEOfficeNote only for status draft/pending and hide when an approval already exists; never for approved/dispatched/fully_received/cancelled.
  3. Make DispatchPOActions text status-aware: pending -> 'Awaiting approval', draft -> 'Submit for approval first', otherwise none.
  4. Add a page 'Approval' card stating which decision releases the PO and its current state.
- **Acceptance:**
  - Test: approved PO does not render 'Raise for approval'.
  - Pending PO shows one approval path only.
  - Dispatch hint matches status.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval integrity: a second path could release POs outside the intended maker-checker.
- **Depends on:** GAP-PROCUREMENT-ORDERS-DETAIL-02

### GAP-PROCUREMENT-ORDERS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1840, verified on main 9c5e9e9e9)
- **First-pass claim:** RaiseEOfficeNote asks the officer to paste raw employee UUIDs for "Initiating officer ID" and "Forward to officer ID" (RaiseEOfficeNote.tsx) with a UUID regex gate — no picker, so the control is unusable for a clerk and is an entity-id leak.
- **Verified evidence:** RaiseEOfficeNote.tsx: inputs 'Initiating officer ID'/'Forward to officer ID' with placeholders 'employee UUID' (l.~173-181), gated by UUID_RE (l.31,~95-96). No EntityPicker exists in the repo. Component is shared by 9 pages, so fix applies to all.
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/_components/ds/EmployeePicker.tsx (new)`
- **Fix steps:**
  1. Create an EmployeePicker (search-by-name combobox) returning employee id; reuse the existing employee list endpoint used elsewhere in the app (identify with backend).
  2. Default initiatedBy to the signed-in user's employee id (read-only) and use the picker only for 'Forward to'.
  3. Keep UUID_RE check internally, show names in the UI, and change error copy to 'Choose an officer'.
  4. Use in the other 8 RaiseEOfficeNote callers automatically.
- **Acceptance:**
  - Test: typing 'Sha' lists matching officers; selecting sets the UUID in payload.
  - No UUID visible in the form.
  - Submitting without forward-to shows 'Choose an officer'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Routing of approvals to wrong officer; employee search endpoint must respect access scope.

### GAP-PROCUREMENT-ORDERS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme LAYOUT (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status shown twice (header StatusPill, details card, page.tsx) and the header packs Print, pill, Request amendment and Dispatch into one action row that will wrap on 390 px; the dispatch hint paragraph replaces a button rather than explaining why.
- **Verified evidence:** StatusPill twice: page.tsx:87 (header) and l.121 (card) - true. Header actions (l.83-93) hold Print, pill, amend link, DispatchPOActions (button+message column) and error badge; wrapping at 390 px not verifiable statically (depends on PageHeader CSS). DispatchPOActions.tsx:12-17 returns a paragraph for every non-approved status, even draft/cancelled/fully_received where 'Approve via workflow inbox' is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/orders/[id]/DispatchPOActions.tsx`
- **Fix steps:**
  1. Remove the pill from the details card (keep header) or vice versa.
  2. Move Print/Amend/Dispatch into a wrap-friendly flex group (or overflow menu on narrow widths).
  3. Make the non-dispatchable hint status-aware and render as helper text below the header, not in place of the button (disabled button + reason).
  4. Manually check at 390 px.
- **Acceptance:**
  - Screenshot 390 px: header actions wrap without overflow.
  - Cancelled PO shows no 'Approve via workflow inbox' text.
  - Only one status pill.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-ORDERS-DETAIL-01

### GAP-PROCUREMENT-ORDERS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Item Name column can print the description placeholder "—" and unit defaults to "nos" when the API omits it (apiMappers.ts:309-316) — silent defaults hide bad data; STATUS_LABELS lacks gem_placed that the list page knows (page.tsx vs OrdersTable.tsx).
- **Verified evidence:** apiMappers.ts:~309-316 defaults itemName toText(item.itemName)??description??'—', unit ?? 'nos', qty ?? 1, itemCode ?? '—'. page STATUS_LABELS (l.17-25) lacks gem_placed, which OrdersTable.tsx:28 and apiMappers.ts:108 know, so the pill shows the raw key.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/orders/OrdersTable.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/lib/procurement-status.ts (new)`
- **Fix steps:**
  1. Extract a shared PO_STATUS_LABELS (incl. gem_placed) and import in both files.
  2. In the mapper stop defaulting unit/quantity; return null and render '—' or flag 'data incomplete' in the UI.
  3. Log/validate malformed line items at the mapper boundary (zod).
- **Acceptance:**
  - Test: gem_placed PO shows 'GeM Placed'.
  - Line with no unit renders '—' (not 'nos').
  - Shared map used by both list and detail.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /procurement/orders/[id]/amend  —  `procurement/orders-detail-amend.html`

- **Source:** `apps/web/src/app/(app)/procurement/orders/[id]/amend/page.tsx`
- **Design reference:** `redesign/procurement/orders-detail-amend.html`

### GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Page shows only the raw PO UUID as subtitle (page.tsx) and never loads the PO: the requester cannot see PO number, vendor or current value while typing a "Value change", and the revised total is not shown.
- **Verified evidence:** amend/page.tsx:74-81 subtitle prints params.id only; the page is a client component that never calls getProcurementPOById, so PO no, vendor, status and current total are not shown and no revised total is computed.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/amend/page.tsx`, `apps/web/src/app/(app)/procurement/orders/[id]/amend/AmendForm.tsx (new)`
- **Fix steps:**
  1. Make page.tsx a server component that calls getProcurementPOById(params.id) and renders PO no, vendor, status, current total in the header/summary card; move the form to a client AmendForm.
  2. Guard: if PO status not in AMENDABLE_STATUSES (approved, dispatched, partial_grn) show EmptyState.
  3. Show 'Revised total' = current + delta using integer minor arithmetic.
  4. Use RefreshErrorState on source==='error'.
- **Acceptance:**
  - Test: page shows PO/2026/… and vendor, not the UUID.
  - Entering +5000 shows revised total = current + 5,000.00.
  - Direct URL to a cancelled PO shows a not-amendable message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-04

### GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Quantity", "Price" and "Schedule" amendments carry no line, quantity or date fields — the body is only type + one signed rupee delta + free text (page.tsx), so the approver receives an unstructured request and the PO lines cannot be updated from it.
- **Verified evidence:** POST body (amend/page.tsx:42-47) is amendmentType, reason, deltaMinor and optional effectiveDate; there are no line, new-quantity or new-schedule fields, so quantity/price/schedule amendments are described only in free text (l.147-156). Slightly overstated: effectiveDate exists. Whether the API accepts structured lines is cannot-verify (service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/amend/page.tsx`, `apps/web/src/app/(app)/procurement/orders/[id]/amend/AmendForm.tsx (new)`
- **Fix steps:**
  1. Load PO lines (see AMEND-01) and, per amendmentType, show a line picker plus new quantity (quantity), new unit price (price) or new delivery date (schedule).
  2. Compute deltaMinor from line changes and make it read-only for quantity/price.
  3. Extend the POST body only with fields the API defines (confirm with backend first).
  4. Keep free-text reason mandatory.
- **Acceptance:**
  - Test: quantity amendment on line 2 posts lineId + newQuantity and computed delta.
  - Schedule type requires a new date.
  - Scope/change_order still work with delta + text.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** PO value/approval integrity; needs a backend contract for structured amendments.
- **Depends on:** GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-01

### GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Value change input is a bare number (default 0, step 0.01) converted with Math.round(parseFloat*100) (page.tsx); no sign hint, no cap against PO value, "0" is accepted for a Price amendment.
- **Verified evidence:** State deltaMinor holds rupees as a string (l.20, misleading name); converted with Math.round(parseFloat(x||'0')*100) at l.45; input step 0.01 with no min/max (l.132-140); '0' passes for any type (only reason is validated, l.29).
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/amend/page.tsx`
- **Fix steps:**
  1. Rename state to deltaRupees; parse with a shared parseRupeesToMinor(str) helper (string split, no float multiply) and reject NaN.
  2. Zod refine: for price/quantity/change_order delta != 0; cap negative delta at -PO total; show sign hint and formatMoney preview.
  3. Display 'New total' using formatMoney.
  4. Use type-specific labels (increase/decrease).
- **Acceptance:**
  - Test: '10.10' -> 1010, '0.29'*100 style cases exact.
  - Price with 0 shows error.
  - Delta of -(total+1) rejected.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: amendments change committed spend; needs the PO total from AMEND-01.
- **Depends on:** GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-01

### GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-05  ·  MEDIUM  ·  partly  ·  theme A11Y (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Success message is followed by an automatic redirect after a fixed 1200 ms (page.tsx) — a screen-reader user may lose the status text; Cancel uses history back, which can leave the app if the page was opened from a link.
- **Verified evidence:** Success message is rendered inside role=status aria-live (l.160-173), so it is announced; but setTimeout 1200 ms redirect (l.58) is short and never cleared on unmount; Cancel is router.back() (l.188) which leaves the app if there is no history. No router.refresh after redirect.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/[id]/amend/page.tsx`
- **Fix steps:**
  1. Replace timeout with a success panel showing a 'Back to purchase order' link (or lengthen to >=5 s and clear on unmount).
  2. Cancel becomes <Link href={'/procurement/orders/'+id}>.
  3. Call router.refresh() before push.
- **Acceptance:**
  - Test: Cancel navigates to /procurement/orders/<id> with empty history.
  - Success text remains visible until user follows link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /procurement/orders/new  —  `procurement/orders-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/orders/new/page.tsx`
- **Design reference:** `redesign/procurement/orders-new.html`

### GAP-PROCUREMENT-ORDERS-NEW-01  ·  HIGH  ·  confirmed  ·  theme DEFAULT (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Vendor and Source indent default silently to the first item of each list (setVendorId(clean[0].id), setIndentId(clean[0].id), CreatePOForm.tsx), and neither list is filtered: a clerk who fills only the lines issues a PO to whichever vendor sorts first, including blacklisted or provisional vendors, against any indent regardless of status.
- **Verified evidence:** CreatePOForm.tsx:181 setVendorId(clean[0].id) and l.195 setIndentId(clean[0].id); vendors/indents fetched with limit=100 and no status filter (l.175,189); submit check only needs non-empty ids (l.207). Blacklist/provisional/indent-status filtering not present; server-side validation is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`
- **Fix steps:**
  1. Initialise vendorId/indentId to '' and add a disabled 'Select…' option.
  2. Fetch vendors with status=active (or filter blacklisted/provisional client-side using the vendor status field) and indents with status=approved only.
  3. Add a searchable combobox and show vendor status.
  4. Add zod validation and per-field errors for both selects.
- **Acceptance:**
  - Test: with lists loaded, no option is preselected and submit is blocked.
  - Blacklisted vendor and draft indent are not offered.
  - Selecting both enables submit.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High: POs to blacklisted vendors / unapproved indents is a compliance risk; also enforce on server.
- **Depends on:** GAP-PROCUREMENT-ORDERS-NEW-03

### GAP-PROCUREMENT-ORDERS-NEW-02  ·  HIGH  ·  confirmed  ·  theme CLIENT_GENERATED_ID (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** PO number is generated in the browser (PO/{year}/{random 100–999}, CreatePOForm.tsx) — only 900 values per year, so collisions are near-certain at volume and the number is not sequential; a statutory PO series must be issued by the server.
- **Verified evidence:** CreatePOForm.tsx:214 poNo=`PO/${year}/${floor(random*900)+100}` posted at l.216. 900 values/year, random, not sequential. Server behaviour on duplicate/missing poNo is cannot-verify (service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`, `services/procurement-service (not in snapshot)`
- **Fix steps:**
  1. Stop generating poNo in the browser; drop it from the body.
  2. Server allocates from a per-tenant, per-FY sequence and returns it.
  3. Display returned poNo after create.
  4. Add unique constraint (tenantId, poNo).
- **Acceptance:**
  - Backend test: 1,000 parallel creates give unique sequential numbers.
  - Web test: POST body has no poNo.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Statutory numbering series; collisions cause rejected creates or duplicates.
- **Depends on:** GAP-PROCUREMENT-INDENTS-NEW-04

### GAP-PROCUREMENT-ORDERS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreatePOForm.tsx:15,149-162,226 per-list LoadState with Retry/empty message and submit disabled until ready; still limit=200 plain selects, no async search combobox
- **First-pass claim:** Lists load silently and fail silently (catch blocks, Form): "Loading vendors…" is shown as the only option forever on error; limit=100 truncates larger vendor masters with no search.
- **Verified evidence:** CreatePOForm.tsx:176 and l.190 `if (!res.ok) return;` and catch blocks (l.182-185,196-199) swallow errors; select shows 'Loading vendors…' when the list is empty (l.259,268) forever on failure or when there are none. limit=100 (l.175,189) without search.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`
- **Fix steps:**
  1. Track loadState per list (loading/ready/error/empty).
  2. On error render a role=alert message with Retry; on empty show 'No approved indents/vendors'.
  3. Replace select with async search combobox (q param) instead of limit=100.
  4. Disable submit until both lists are ready.
- **Acceptance:**
  - Test: 500 from vendors -> error + Retry, not 'Loading vendors…'.
  - Empty list shows empty copy.
  - Retry reloads.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-ORDERS-NEW-01

### GAP-PROCUREMENT-ORDERS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreatePOForm.tsx:72-77,201-216 indent-vs-PO total reconciliation + submit block; :118 unit from LineItemsEditor; GFR mode band for PO total not shown, no prefill from indent
- **First-pass claim:** PO total is not reconciled with the source indent value or GFR mode band; unit is hard-coded "nos" for every line (Form) although LineItemsEditor takes a unitLabel prop it renders only for screen readers (LineItemsEditor.tsx).
- **Verified evidence:** Form posts no reconciliation: the selected indent option has only id/indentNo/department (l.158, no value), total comes only from the lines; unit:'nos' at l.224; LineItemsEditor unitLabel is rendered only in an sr-only span (LineItemsEditor.tsx:135) and the form does not pass it.
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`, `apps/web/src/app/(app)/procurement/_components/LineItemsEditor.tsx`, `apps/web/src/app/(app)/procurement/orders/new/page.tsx`
- **Fix steps:**
  1. Load the selected indent (estimatedAmount, items) and show indent value vs PO total with a warning/blocked submit when PO exceeds indent.
  2. Optionally prefill lines from the indent.
  3. Add real unit field per line (see INDENTS-NEW-04).
  4. Show the GFR band for the PO total (reuse mode-bands lookup).
- **Acceptance:**
  - Test: PO total above indent value shows warning.
  - Unit chosen per line is posted.
  - Prefill from indent works.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Overspend against sanctioned indent; tolerance rule needs a business decision.
- **Depends on:** GAP-PROCUREMENT-INDENTS-NEW-04, GAP-PROCUREMENT-INDENTS-NEW-02

### GAP-PROCUREMENT-ORDERS-NEW-05  ·  LOW  ·  confirmed  ·  theme DARKMODE (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Fields use inline hex backgrounds (background:#fff) that break dark mode (Form); delivery date is not checked to be after today.
- **Verified evidence:** CreatePOForm.tsx:256,265,274 use style background:'#fff' on fields (dark-mode break); message colours hard-coded #b91c1c/#047857 (l.284); delivery date input has no min and no check (l.276).
- **Files to change:** `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`
- **Fix steps:**
  1. Replace '#fff' with var(--panel)/existing 'field' class, colours with var(--bad)/var(--good).
  2. Set min=today on delivery date and validate deliveryDate >= today (>= indent date if known).
  3. Show field error.
- **Acceptance:**
  - Dark-mode screenshot: fields are not white.
  - Past delivery date blocked with an error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /procurement/planning  —  `procurement/planning.html`

- **Source:** `apps/web/src/app/(app)/procurement/planning/page.tsx`
- **Design reference:** `redesign/procurement/planning.html`

### GAP-PROCUREMENT-PLANNING-01  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** No way to filter by year or department although the loader accepts both (loaders.ts:5539-5543) — the page always fetches everything and prints it as one unpaginated table; a department with several years of plans becomes one long list.
- **Verified evidence:** planning/page.tsx:21 calls getProcurementAnnualPlans() with no args; loader (loaders.ts:5539-5543) supports {department, year} but the page never passes them and renders all rows in a plain <table> (:43-74) without pagination or filter. Note: the backend may itself cap results (cannot verify - procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Make the page accept searchParams {year, department, page}; pass year/department to getProcurementAnnualPlans.
  2. Add a small GET filter form (FY <select>, department picker) above the table.
  3. Switch to shared DataTable with pageSize (or add limit/offset to the loader and show total) instead of the raw <table>.
  4. Show empty-filter state distinct from 'No plans yet'.
- **Acceptance:**
  - Load /procurement/planning?year=2026 -> request URL contains year=2026 and only FY 2026-27 rows show.
  - With 60 mocked plans, table paginates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-PLANNING-05

### GAP-PROCUREMENT-PLANNING-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw id in the first column: Plan ID prints plan.id.slice(0,8) of a UUID (page.tsx) while the detail page has a human planNo (planning/[id]/page.tsx) that the list never shows.
- **Verified evidence:** planning/page.tsx:57 prints plan.id.slice(0,8) (UUID fragment) in the 'Plan ID' column. AnnualPlanSummary (loaders.ts:5528-5537) has no planNo; only AnnualPlanDetail has planNo (:5578). Whether the list endpoint returns planNo is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add planNo?: string to AnnualPlanSummary (confirm list endpoint returns it; else backend adds it).
  2. Rename column to 'Plan No' and render plan.planNo ?? '—' as the link to the detail page; drop the UUID fragment.
  3. Keep id only in the href.
- **Acceptance:**
  - List shows 'APP/2026/001'-style numbers, no UUID fragments.
  - Link still navigates to /procurement/planning/{id}.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-PLANNING-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status chip uses solid fill with white text on var(--warn) / var(--good) (page.tsx) — contrast is not guaranteed in either theme, and the word is the raw enum (e.g. "pending" instead of "Pending Approval" used on the detail page).
- **Verified evidence:** planning/page.tsx:7-12,67-69 renders a hand-made span with background var(--warn)/var(--good) and color #fff; label is raw plan.status made 'Pending' by CSS capitalize, while detail page uses StatusPill with STATUS_LABELS 'Pending Approval' (planning/[id]/page.tsx:11-16,80). Shared StatusPill already maps draft->mut, pending->warn, approved->good, rejected->bad (ds/StatusPill.tsx), so no new tones needed. Contrast of white on warn is not guaranteed (not measured).
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/page.tsx`, `apps/web/src/lib/procurementLabels.ts`
- **Fix steps:**
  1. Delete STATUS_COLOR and the inline span; use <StatusPill status={plan.status} label={PLAN_STATUS_LABELS[plan.status]} />.
  2. Move STATUS_LABELS from planning/[id]/page.tsx to shared procurementLabels.ts and import in both pages.
- **Acceptance:**
  - List and detail show identical labels ('Pending Approval').
  - No inline colour styles remain in the status cell.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-PLANNING-04  ·  MEDIUM  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Column "Total budget" is fed by totalEstimatedMinor (page.tsx); an estimate before approval is not a budget. itemCount is fetched but never shown.
- **Verified evidence:** planning/page.tsx:50 header 'Total budget' with value from totalEstimatedMinor (:65) - label mismatch is real. itemCount exists in AnnualPlanSummary (loaders.ts:5536) and is never rendered (confirmed). Whether totalEstimatedMinor is an estimate sum is per its name; budget is not a field in the summary.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/page.tsx`
- **Fix steps:**
  1. Rename the column to 'Estimated value'.
  2. Add an 'Items' column rendering plan.itemCount.
  3. Use formatMoney (see PLANNING-05) for the amount.
- **Acceptance:**
  - Column header reads 'Estimated value'; Items column shows count.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-PLANNING-05

### GAP-PROCUREMENT-PLANNING-05  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Only the Title link is clickable (page.tsx); fmtAmount rounds to whole rupees (maximumFractionDigits 0) while other procurement screens show paise.
- **Verified evidence:** Only the Title <Link> (planning/page.tsx:60) is clickable; rows are not links. fmtAmount (:14-18) uses Intl currency with maximumFractionDigits:0 and parseInt of minor, dropping paise; duplicated at planning/[id]/page.tsx:18-22. Shared formatMoney (lib/formatters.ts:90) is bigint-safe and prints paise (Rs x.xx). Severity low but money display.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/page.tsx`, `apps/web/src/app/(app)/procurement/planning/[id]/page.tsx`
- **Fix steps:**
  1. Delete local fmtAmount in both pages; import formatMoney from @/lib/formatters.
  2. Convert the table to shared DataTable with rowHref => '/procurement/planning/'+id (as rfq/page.tsx does) or add an 'Open' link.
  3. Keep numbers as strings/paise; no v/100 float math.
- **Acceptance:**
  - 1234567 paise displays Rs 12,345.67 on list and detail.
  - Clicking anywhere on the row opens the detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.


---
## /procurement/planning/[id]  —  `procurement/planning-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/planning/[id]/page.tsx`
- **Design reference:** `redesign/procurement/planning-detail.html`

### GAP-PROCUREMENT-PLANNING-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme AUDIT (was CONFIRM)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Approve says "cannot be undone" but the dialog has no reason/remarks field while Reject does (Actions.tsx); the approval leaves no comment on the plan and submittedBy/approvedBy/approvedAt are never displayed (page.tsx), so the page has no audit trail of who decided.
- **Verified evidence:** PlanLifecycleActions.tsx: Approve ActionButton has no requireReason (l.~92-100) while Reject does; approve() only sends notes if a reason exists, so none is ever sent. Page (planning/[id]/page.tsx) shows only rejectedReason; submittedBy/approvedBy/submittedAt/approvedAt exist in AnnualPlanDetail (loaders.ts ~5545-5556) but are never rendered. Maker-checker enforcement and audit emission are backend concerns: cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/[id]/PlanLifecycleActions.tsx`, `apps/web/src/app/(app)/procurement/planning/[id]/page.tsx`
- **Fix steps:**
  1. Add requireReason + reasonLabel to the Approve ActionButton and send approval remarks (backend field: confirm; approve() currently posts notes).
  2. Render an 'Approval history' card: submitted by/at, approved by/at, remarks, rejected reason, resolving user ids to names.
  3. Hide Approve when current user === submittedBy and show why (server must also enforce).
  4. Confirm the API emits an audit event on approve/reject.
- **Acceptance:**
  - Test: Approve confirm disabled until reason entered.
  - Detail page shows approver and timestamp via formatIndianDateTime.
  - Submitter viewing own plan sees no Approve.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval integrity/audit; approvals would change from optional to mandatory remarks.

### GAP-PROCUREMENT-PLANNING-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme MISSING_COLUMNS (was FAILMASK)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Plan lines omit budgetLine, packageGroup, procurementCategory and tenderId although the loader returns them (loaders.ts:5555-5568); for a GFR plan the budget head is the key column, and a line linked to a tender cannot be followed.
- **Verified evidence:** AnnualPlanLine (loaders.ts ~5560-5574) has procurementCategory, budgetLine, packageGroup, tenderId, but LINE_COLUMNS (page.tsx:33-41) omit them; lineRows maps only 7 fields (l.62-70). No link to the tender.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/[id]/page.tsx`
- **Fix steps:**
  1. Add Budget line, Category and Package columns to LINE_COLUMNS/lineRows.
  2. Render tenderId as a Link to /procurement/tenders/<id> (or tender number if the loader can supply it).
  3. Show '—' for null; allow horizontal scroll on mobile.
- **Acceptance:**
  - Test: line with tenderId renders a link.
  - Budget line visible for GFR plan.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-PLANNING-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme FEEDBACK (was CONFIRM)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Lifecycle actions are 202-accepted async commands; the component deliberately shows no success text and only refreshes (Actions.tsx), so a user who approves sees the dialog close with no confirmation until the pill changes.
- **Verified evidence:** PlanLifecycleActions.tsx uses ActionButton with onSuccess=router.refresh only (doc comment l.14-19); ActionButton closes the dialog with no message. Accurate intent (202 async) but no feedback. useToast exists in ds/Toast.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/[id]/PlanLifecycleActions.tsx`
- **Fix steps:**
  1. In onSuccess call useToast().show('Approval request accepted; status will update shortly').
  2. Optionally poll/refresh after 2-3 s until status changes.
  3. Keep wording 'accepted', not 'approved'.
- **Acceptance:**
  - Test: after confirm a status toast appears.
  - Toast wording does not claim final state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PROCUREMENT-PLANNING-DETAIL-05  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Total estimated" is not reconciled to the sum of the lines; currency is ignored (fmtAmount always INR, page.tsx) and rounded to whole rupees; Status pill duplicated in header and card.
- **Verified evidence:** page.tsx fmtAmount (l.13-17) always Intl INR with maximumFractionDigits:0, uses parseInt(string) then /100 (float, precision loss for large bigint strings); plan.currency (type field) ignored; totalEstimatedMinor shown (l.108) without comparing to sum of lines; StatusPill at l.94 and l.111.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace fmtAmount with shared formatMoney/BigInt-safe formatter with 2 decimals honoring plan.currency.
  2. Compute the line sum in BigInt and show a mismatch warning against totalEstimatedMinor.
  3. Remove duplicate StatusPill from the details card.
- **Acceptance:**
  - Test: '12345678901234567' minor renders exactly.
  - Mismatched totals show a warning.
  - One status pill.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only.


---
## /procurement/planning/new  —  `procurement/planning-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/planning/new/page.tsx`
- **Design reference:** `redesign/procurement/planning-new.html`

### GAP-PROCUREMENT-PLANNING-NEW-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** planYear defaults to new Date().getFullYear() + 1 (page.tsx): opened in Sep 2026 it proposes 2027, but the current Indian financial year starts 2026; the field is labelled only "(start)" with no FY preview, so plans are easily filed for the wrong year.
- **Verified evidence:** planning/new/page.tsx:122-124 seeds planYear with String(new Date().getFullYear()+1); field at :199-212 is a bare type=number labelled 'Financial year (start) *' (min 2020, max 2100) with no FY preview. In Jan-Mar the default skips a whole FY (Feb 2027 -> 2028 while FY 2026-27 is still running); in Sep 2026 it gives 2027 (FY 2027-28), which is defensible as 'next FY' but is not shown as such. The list/detail pages render 'FY {y}-{yy}' so the format already exists. Theme DATEFMT is wrong (no date formatting involved).
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/new/page.tsx`, `apps/web/src/lib/financialYear.ts`
- **Fix steps:**
  1. Add helper currentFinancialYearStart(d=new Date()) in apps/web/src/lib/financialYear.ts: month>=3 (April) ? year : year-1, evaluated in Asia/Kolkata.
  2. Replace the useState seed with a <select> of currentFY-1..currentFY+2 (value = start year) defaulting to the next FY (currentFY+1) or current FY per decision below.
  3. Render label text 'FY 2027-28' via a shared fyLabel(start) helper next to the field (also reuse in planning/page.tsx:58 and planning/[id]/page.tsx:76).
  4. Keep zod/server validation of planYear range; drop free-typed min=2020/max=2100 number input.
- **Acceptance:**
  - Unit test currentFinancialYearStart: 2027-02-10 -> 2026, 2026-09-29 -> 2026, 2027-04-01 -> 2027.
  - Open form in Feb 2027 (mock clock): default shows 'FY 2027-28', not 2028-29.
  - Selecting a year shows the FY label under the field and the POST body planYear equals the start year.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong-year plans are not overwritten but mis-file aggregation. Product decision needed: default to current or next FY.

### GAP-PROCUREMENT-PLANNING-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Department is free text with no default or picker (page.tsx): plans for the same department can be filed under different spellings, which breaks the ministry-level aggregation the plan exists for.
- **Verified evidence:** planning/new/page.tsx:219-236 department is a plain <input id=dept> with useState('') at :126; only validated non-empty at :144. Nothing constrains spelling. The list loader accepts a department filter (loaders.ts:5539) so free text also hurts filtering. No department picker/loader was verified elsewhere in the procurement tree; the org/department source endpoint is not in this snapshot.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (reuse if it exists, else create)`
- **Fix steps:**
  1. Replace the <input id=dept> with the shared EntityPicker/select bound to the org department master (endpoint to be confirmed with backend), storing the canonical department name/id.
  2. Default the value to the user's own department from the session when available.
  3. Send the canonical value in the POST body; keep server-side zod check.
  4. Show fieldError('department') as today.
- **Acceptance:**
  - Component test: department field renders options from mocked master; free text cannot be submitted.
  - Two plans for the same department carry identical department string in the POST body.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; but backend must expose a department master and plan API may need departmentId.

### GAP-PROCUREMENT-PLANNING-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Line items have no budget-line / head-of-account field although the plan line schema has budgetLine and packageGroup (loaders.ts:5563-5566); the payload spreads the whole line and adds procurementCategory "goods" for every row (page.tsx) — works and services cannot be planned.
- **Verified evidence:** planning/new/page.tsx:161-167 maps lines with {...l, aggregatedQty:l.quantity, procurementCategory:'goods'} - every row is hard-coded 'goods' (also leaks the extra 'quantity' key). PlanLine type (:98-106) has no budgetLine/packageGroup though AnnualPlanLine in loaders.ts:5555-5568 has budgetLine, packageGroup, procurementCategory. Detail page shows neither. Backend accepted payload cannot be verified (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/new/page.tsx`, `apps/web/src/app/(app)/procurement/planning/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add procurementCategory ('goods'|'works'|'services'|'consultancy' - confirm enum with backend), budgetLine and packageGroup to PlanLine and emptyLine().
  2. Add a category <select> and budget-line text input columns to the line table; drop the hard-coded 'goods' in handleSubmit.
  3. Build the payload explicitly (pick fields) instead of spreading l; omit empty budgetLine/packageGroup.
  4. Show Category and Budget line columns in planning/[id]/page.tsx LINE_COLUMNS.
- **Acceptance:**
  - Add a 'works' line, submit; captured POST body has procurementCategory 'works' and no stray 'quantity' key.
  - Detail page shows the budget line entered.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; category drives method rules (GFR), enum must match backend or POST fails.
- **Depends on:** GAP-PROCUREMENT-PLANNING-NEW-02

### GAP-PROCUREMENT-PLANNING-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Remove has no minimum-one guard and Create plan accepts an empty lines array; rows have no total, so the user cannot see the plan total before submit.
- **Verified evidence:** Remove button (:402-413) filters unconditionally, so lines can reach []; handleSubmit (:144-148) validates only year/title/department, and rows without itemCode+description are silently dropped by .filter at :162, so an empty or all-blank lines array is POSTed. No total is computed or shown anywhere on the form (lines table :299-417).
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/new/page.tsx`
- **Fix steps:**
  1. In handleSubmit compute validLines = lines.filter(itemCode&&description); if length 0 set error 'Add at least one line item' and return.
  2. Disable the Remove button when lines.length===1.
  3. Compute total = sum(estimatedValueMinor) (integer paise) and render it in a <tfoot> or summary row using formatMoney from @/lib/formatters.
  4. Add per-line total column only if qty x rate semantic is confirmed (currently value is per line).
- **Acceptance:**
  - Submit with one blank row -> inline alert, no fetch call.
  - Remove is disabled with a single row.
  - Two lines of 1,000.50 and 2,000 show total Rs 3,000.50 (no float drift).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-PLANNING-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme COPY (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Method options use raw enum text with underscores replaced ("gem", "direct purchase") and are not tied to the GFR value bands used on the indent form; success text "Plan submitted" is misleading — the plan is created (draft), not submitted for approval.
- **Verified evidence:** Method options (:378-382) print m.replace(/_/g,' ') giving 'gem', 'direct purchase', 'single tender' (lowercase, GeM not capitalised). No relation to GFR value bands (indents form fetches /gfr/mode-bands, indents/new/CreateIndentForm.tsx:29-35). Success text at :176 'Plan submitted...' though the plan is created as a draft (detail page has separate PlanLifecycleActions for submit). Redirect after 1200 ms. Theme STATUS is wrong; this is copy/labels.
- **Files to change:** `apps/web/src/app/(app)/procurement/planning/new/page.tsx`, `apps/web/src/lib/procurementLabels.ts`
- **Fix steps:**
  1. Create METHOD_LABELS map (GeM, Direct purchase, Limited tender, Advertised tender, Single tender) in a shared procurementLabels.ts and use it here and in planning/[id]/page.tsx:67.
  2. Change success copy to 'Plan saved as draft. Open it to submit for approval.' and redirect to the new plan detail (/procurement/planning/{id}) if the response returns an id.
  3. Optionally show the GFR band hint per line using the existing mode-bands endpoint (decision).
- **Acceptance:**
  - Select shows 'GeM' and 'Direct purchase'.
  - After create, message says draft and user lands on the plan detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/pre-bid  —  `procurement/pre-bid.html`

- **Source:** `apps/web/src/app/(app)/procurement/pre-bid/page.tsx`
- **Design reference:** `redesign/procurement/pre-bid.html`

### GAP-PROCUREMENT-PRE-BID-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead-end log: no action to schedule a conference, record minutes or publish a corrigendum, and the Tender cell is plain text (PreBidTable.tsx) — an officer cannot get from a conference to its tender or its queries.
- **Verified evidence:** pre-bid/page.tsx has no action buttons; PageHeader has no actions (:19-22). PreBidTable.tsx:99-106 renders tender as a plain text column; DataTable supports rowHref/rowLinkKey (ds/DataTable.tsx:56,207-212) but it is not used. PreBidConference (loaders.ts:2703-2711) has no tenderId, so linking needs the API to provide it. Whether schedule/minutes/corrigendum endpoints exist is cannot-verify (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/pre-bid/PreBidTable.tsx`, `apps/web/src/app/(app)/procurement/pre-bid/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add tenderId (and conferenceId is id) to PreBidConference if the API returns it; else request backend.
  2. Render the tender cell as a Link to /procurement/tenders/{tenderId} and set rowHref to a conference detail route once it exists.
  3. Add a 'Schedule conference' action only after a create endpoint is confirmed; otherwise state read-only in subtitle.
  4. Show open (unanswered) query count column (see PRE-BID-03).
- **Acceptance:**
  - Clicking the tender cell opens the tender detail page.
  - No dead controls: every visible action navigates or submits.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low for the link; scheduling flow is new scope.
- **Depends on:** GAP-PROCUREMENT-PRE-BID-03

### GAP-PROCUREMENT-PRE-BID-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Silent all-zero stats on failure: StatGrid is computed from the server-side loader result while the table reads a separate cache (page.tsx vs PreBidTable.tsx); on error the header shows four 0s above a "Couldn't load — showing nothing" badge.
- **Verified evidence:** pre-bid/page.tsx:6-11 derives stats from loader data; when source==='error' data is [] so StatCards (:25-28) show 0 (StatCard shows '—' only for null/undefined/NaN, ds/StatCard.tsx:19-24). Table (PreBidTable.tsx:54-59,82-87) reads useSeededResource and may show cached rows while stats still say 0 - inconsistent. The page never renders RefreshErrorState. The badge/empty-state combination is shown only inside the table card.
- **Files to change:** `apps/web/src/app/(app)/procurement/pre-bid/page.tsx`, `apps/web/src/app/(app)/procurement/pre-bid/PreBidTable.tsx`
- **Fix steps:**
  1. Move stat computation into a client component (or into PreBidTable) fed by the same useSeededResource rows, or pass value=null for each StatCard when source==='error' and no cache.
  2. When provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'pre-bid conferences'})}/> instead of EmptyState.
  3. Keep DataSourceBadge as is.
- **Acceptance:**
  - Mock 500: stats show '—' and RefreshErrorState appears, not 'No conferences found'.
  - Mock cached data + error: stats equal the cached rows' totals.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, StatCard null convention

### GAP-PROCUREMENT-PRE-BID-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Responded" sums responses (page.tsx) and "Conferences Held" counts only literal "Completed" (page.tsx); status strings are matched case-sensitively, so "completed" from the API silently shows 0. Open (unanswered) queries — the actionable number — is never shown.
- **Verified evidence:** pre-bid/page.tsx:8-9 compares status === 'Completed' / 'Scheduled' case-sensitively; :11 'Responded' = sum of responses (:27 label 'Responded'). Open queries = queriesRaised - responses is never shown. The StatusPill in the table is case-insensitive (STATUS_MAP lowercases) so the pill and the tile can disagree. Theme FABRICATED is wrong (not hard-coded sample data); it is a mapping/normalisation issue.
- **Files to change:** `apps/web/src/app/(app)/procurement/pre-bid/page.tsx`
- **Fix steps:**
  1. Normalise with c.status.toLowerCase() before comparing (or use a typed enum mapper).
  2. Rename tile to 'Responses given' and add an 'Open queries' tile = max(0, totalQueries - totalResponses) per conference summed.
  3. Add unit test with mixed-case statuses.
- **Acceptance:**
  - API status 'completed' counts in 'Conferences Held'.
  - Open queries tile equals queries minus responses.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-PRE-BID-02

### GAP-PROCUREMENT-PRE-BID-05  ·  LOW  ·  partly  ·  theme LINT (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Card is imported but unused in page.tsx (line 1); the export button (exportable) has no visible audit or DPDP consideration — tender names are not personal data, so low risk.
- **Verified evidence:** Card is imported but unused in pre-bid/page.tsx:1 (true; the file uses PageHeader, StatGrid, StatCard only). exportable is set on DataTable (PreBidTable.tsx:97) which exports CSV client-side; the data is tender names/counts, not personal data, so no masking needed; audit of exports is a platform-wide DataTable concern, not specific here. Theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/pre-bid/page.tsx`
- **Fix steps:**
  1. Remove the unused Card import (eslint no-unused-vars).
  2. If export audit is required platform-wide, do it in ds/DataTable exportable handler, not per page.
- **Acceptance:**
  - Lint passes with no unused import.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /procurement/reverse-auction  —  `procurement/reverse-auction.html`

- **Source:** `apps/web/src/app/(app)/procurement/reverse-auction/page.tsx`
- **Design reference:** `redesign/procurement/reverse-auction.html`

### GAP-PROCUREMENT-REVERSE-AUCTION-01  ·  HIGH  ·  partly  ·  theme STALE (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** A "Live" auction is shown on a page that is server-rendered and revalidated every 30 s (loaders.ts:2636) with a static timeRemaining string and no polling or countdown (Table): the lowest price and time left can be stale by the time an officer reads them, and there is no way to open the auction room.
- **Verified evidence:** Loader revalidateSeconds:30 (loaders.ts:2636) and page is server-rendered with the table hydrated once via useSeededResource; no polling (ReverseAuctionTable.tsx has no interval) and timeRemaining is a server string shown as-is (:183). So staleness is real. Rows are not links (no rowHref, :205-221), so no path to an auction room; whether such a route/endpoint exists is cannot-verify. The 'VALIDATION' theme is wrong (no form). 'Live' stale by up to 30s + cache is accurate but overstated as a defect for a list page.
- **Files to change:** `apps/web/src/app/(app)/procurement/reverse-auction/ReverseAuctionTable.tsx`, `apps/web/src/app/(app)/procurement/reverse-auction/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add periodic refetch (e.g. 15s) while any row status is Live using the existing sync/resource hook if it supports refresh, else a small useEffect + fetch of /api/proxy/v1/procurement/reverse-auctions.
  2. Show 'Updated hh:mm:ss' next to the table.
  3. Compute a countdown from an endsAt timestamp instead of a static timeRemaining string (needs API to return endsAt).
  4. Link Live rows to the auction room once that route exists.
- **Acceptance:**
  - With a Live row, a mocked changed currentLowest appears within the refresh interval.
  - Countdown decrements client-side.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; showing stale lowest price to officers during a live auction.
- **Depends on:** GAP-PROCUREMENT-REVERSE-AUCTION-02

### GAP-PROCUREMENT-REVERSE-AUCTION-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** No action anywhere — schedule, extend, close or award an auction — and rows are not links (Table); the list is a dead end and the item label is the only identifier (no auction id, tender ref or indent ref).
- **Verified evidence:** ReverseAuctionPage has no actions (page.tsx:129-132) and DataTable has no rowHref (ReverseAuctionTable.tsx:205-221). ReverseAuction type (loaders.ts:2627-2635) has id and item only - no tender/indent ref. Backend endpoints for schedule/extend/close/award cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/reverse-auction/ReverseAuctionTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Extend ReverseAuction with tenderRef/auctionNo if the API supplies them; show as first column.
  2. Add rowHref to a detail route (create /procurement/reverse-auction/[id] read-only first).
  3. Add lifecycle actions only after backend endpoints are confirmed, with ConfirmDialog for close/award.
- **Acceptance:**
  - Rows open a detail page; auction number/tender ref visible in the table.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Awarding is a financial/approval action: needs audit event and permission gate.

### GAP-PROCUREMENT-REVERSE-AUCTION-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Money formatting is hand-rolled: `₹${(paise/100).toLocaleString("en-IN")}` (Table) — no paise digits (₹1,84,500.5 possible), and toLocaleString runs on the server and again in the browser, so a locale difference can cause a hydration mismatch; other screens use formatMoney.
- **Verified evidence:** ReverseAuctionTable.tsx:163-165 uses `₹${(paise/100).toLocaleString('en-IN')}` - no fixed 2 digits (18450050 -> ₹1,84,500.5), float division on paise. Hydration mismatch claim is weak: Node 20 has full ICU so en-IN output matches; low real risk. Shared formatMoney (lib/formatters.ts:90) exists and is bigint-safe. Columns are labelled '(₹)' as well, so symbol is duplicated.
- **Files to change:** `apps/web/src/app/(app)/procurement/reverse-auction/ReverseAuctionTable.tsx`
- **Fix steps:**
  1. Delete local formatAmount; import formatMoney from @/lib/formatters and apply to startPrice/currentLowest.
  2. Drop '(₹)' from column labels.
  3. Add savings column: formatMoney(startPrice-currentLowest) using BigInt subtraction, and percent.
- **Acceptance:**
  - 18450050 renders ₹1,84,500.50.
  - Export CSV column uses the same formatted value.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.

### GAP-PROCUREMENT-REVERSE-AUCTION-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Silent zero stats on failure (page.tsx computes from loader data while the table reads its own cache), same as other list pages.
- **Verified evidence:** Same pattern as PRE-BID-02: page.tsx:119-121,135-138 compute counts from loader data (empty on error) so StatCards show 0/0/0/0 (auctions.length=0); table (ReverseAuctionTable.tsx:168-173,196-201) has its own useSeededResource and badge; no RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/procurement/reverse-auction/page.tsx`, `apps/web/src/app/(app)/procurement/reverse-auction/ReverseAuctionTable.tsx`
- **Fix steps:**
  1. Pass null to StatCard values when source==='error' and nothing cached, or compute stats inside the client component from the seeded rows.
  2. Render <RefreshErrorState> when provenance==='error-no-data'.
- **Acceptance:**
  - Mock 500: tiles show '—' and error state shows a retry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-PROCUREMENT-PRE-BID-02

### GAP-PROCUREMENT-REVERSE-AUCTION-05  ·  MEDIUM  ·  partly  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status counts match literal "Live" / "Scheduled" / "Awarded" (page.tsx); "Total Events" tile is styled as money (💰). Savings vs start price — the reason to run an auction — is not shown.
- **Verified evidence:** Counts match literal 'Live'/'Scheduled'/'Awarded' case-sensitively (page.tsx:119-121) - true; StatusPill has no explicit mapping for these (falls to 'info'). 'Total Events' uses 💰 icon (:137) - true. Nothing is hard-coded/fabricated, theme FABRICATED is wrong. Savings not shown - true (startPrice and currentLowest exist so it is computable).
- **Files to change:** `apps/web/src/app/(app)/procurement/reverse-auction/page.tsx`
- **Fix steps:**
  1. Lower-case compare statuses via a helper.
  2. Change icon for Total Events to a neutral one (e.g. 📋).
  3. Add a 'Total savings' tile computed with BigInt from awarded/closed rows (or per-row savings column per REVERSE-AUCTION-03).
- **Acceptance:**
  - Status 'live' counts as Live.
  - Savings tile equals sum(start-lowest).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-REVERSE-AUCTION-03


---
## /procurement/rfq  —  `procurement/rfq.html`

- **Source:** `apps/web/src/app/(app)/procurement/rfq/page.tsx`
- **Design reference:** `redesign/procurement/rfq.html`

### GAP-PROCUREMENT-RFQ-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Templates" is a dead control: it links to /procurement/rfq/new?template=1 (page.tsx) but CreateRFQForm never reads the query string (rfq/new/CreateRFQForm.tsx), so it opens the same blank form.
- **Verified evidence:** rfq/page.tsx:44 renders <Link href="/procurement/rfq/new?template=1">Templates. rfq/new/page.tsx (NewRFQPage) takes no searchParams and CreateRFQForm.tsx never calls useSearchParams; grep for 'template' in rfq/ finds only that link. No RFQ-template feature/endpoint exists in the snapshot, so the button opens the identical blank form.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/page.tsx`
- **Fix steps:**
  1. Decision: no RFQ template model or endpoint exists, so remove the Templates <Link> at rfq/page.tsx:44 (preferred until a template API is specified).
  2. If templates are wanted, define a backend resource (procurement rfq templates list/get) first, then add a template picker to CreateRFQForm that prefills title/vendor set.
  3. Do not ship a query-string flag that is ignored; if kept temporarily, disable it with aria-disabled and a 'Coming soon' title.
- **Acceptance:**
  - Manual: /procurement/rfq header shows only '+ New RFQ' (no Templates).
  - grep -r 'template=1' apps/web/src returns no results.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; removing a non-functional link only.

### GAP-PROCUREMENT-RFQ-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw reference in a user column: Indent Ref prints r.indentRef verbatim (page.tsx) — the create form stores "procurement_indent:{uuid}" (CreateRFQForm.tsx), so officers see an internal id and cannot click through to the indent.
- **Verified evidence:** rfq/page.tsx:30 maps indentRef: r.indentRef ?? '—' and it is shown as plain text in column 'Indent Ref' (line 81). CreateRFQForm.tsx:77 sends indentRef: `procurement_indent:${indentId}`, so the list prints 'procurement_indent:<uuid>'. rfq/[id]/page.tsx:86 also prints it raw in a mono span. An indent detail route exists (/procurement/indents/[id]) so a link is possible. Whether the RFQ list API also returns an indent number is cannot-verify (RFQSummary type lives in absent @civitasone/types).
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/page.tsx`, `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add a small helper (e.g. lib/refs.ts parseOpaqueRef('procurement_indent:UUID') -> {type,id}) reusing the pattern in loaders.ts buildApprovalLink.
  2. In rfq/page.tsx replace the plain indentRef column with a col.render that shows the indent number and links to /procurement/indents/{id}; never print the raw ref.
  3. Backend/loader: ask for indentNo on the RFQ list/detail payload (or batch-resolve via getIndents) and add it to RFQSummary/RFQDetail; fall back to '—' not the uuid.
  4. Apply the same rendering to rfq/[id]/page.tsx:86.
- **Acceptance:**
  - Component test: indentRef 'procurement_indent:abc' renders indent number text with href '/procurement/indents/abc' and no 'procurement_indent:' substring.
  - RFQ without indentRef shows '—' with no link.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only. Filter placeholder text must not depend on the raw ref.

### GAP-PROCUREMENT-RFQ-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was DATEFMT)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status filter and closing-date urgency are missing: an officer scanning for RFQs that closed with zero responses must sort manually; Awarded is counted (page.tsx) but nothing on the row links to an award or PO.
- **Verified evidence:** rfq/page.tsx: filter is free-text only (filterable, line 74-ish placeholder mentions status) - no status/date facet, no overdue indicator on closingDate (line 31 just formatIndianDate). 'awarded' is only counted for the stat tile (line 25); rows link only to the RFQ detail via rowLinkKey, nothing to an award or PO. Note the suggested 'use formatIndianDate' is already done (line 31), so theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/page.tsx`
- **Fix steps:**
  1. Add a status Segmented/select above the DataTable (All/Issued/Closed/Awarded) filtering rows server-side via searchParams.
  2. Add a computed 'Closes in' cue: for issued RFQs with closingDate < today (IST) render a StatusPill 'Overdue' plus a warning when responsesReceived === 0 (build with col.render).
  3. For status awarded, render a link column to the award/PO only if the RFQ detail payload exposes a poId; otherwise link to rfq/[id] (cannot-verify that the API returns a PO reference).
  4. Make the stat tiles filter shortcuts.
- **Acceptance:**
  - Selecting 'Issued' hides awarded/closed rows.
  - An issued RFQ with closingDate yesterday and 0 responses shows an Overdue cue; one closing tomorrow does not.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only. Use IST date comparison, not browser-local.

### GAP-PROCUREMENT-RFQ-04  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status printed as the raw lowercase enum through StatusPill (page.tsx); "Responses" tile sums responsesReceived across RFQs (page.tsx), not distinct vendors.
- **Verified evidence:** First half is refuted: rfq/page.tsx:82 uses cellType 'status' -> DataTable.cellValue -> StatusPill, which since the humanizeStatus fix (ds/StatusPill.tsx:61) prints 'Issued'/'Awarded', not raw lowercase. What is true: STATUS_MAP (StatusPill.tsx:5-39) has no 'issued' or 'awarded' key so they render with the neutral 'info' tone. Second half is true: rfq/page.tsx:24 totalResponses sums responsesReceived across RFQs (quotes, not distinct vendors) under a tile labelled 'Responses'.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/procurement/rfq/page.tsx`
- **Fix steps:**
  1. Add issued: 'info'(or 'warn'), awarded: 'good', cancelled: 'mut' to STATUS_MAP in StatusPill.tsx after confirming the RFQ status enum with the backend.
  2. Relabel the tile 'Quotes received' (or compute distinct vendors if the API provides vendor ids).
- **Acceptance:**
  - StatusPill test: 'awarded' -> class 'pill good'.
  - RFQ page tile label reads 'Quotes received'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. StatusPill is shared; adding keys changes colours on every page using those words.


---
## /procurement/rfq/[id]  —  `procurement/rfq-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`
- **Design reference:** `redesign/procurement/rfq-detail.html`

### GAP-PROCUREMENT-RFQ-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead end after collecting quotes: no action to compare, award, close, extend or convert to a PO (page.tsx), yet the list counts "Awarded" RFQs (rfq/page.tsx) — there is no UI in this route tree that sets that status.
- **Verified evidence:** rfq/[id]/page.tsx:64-128 renders read-only cards; no actions in PageHeader (:70-75). rfq/page.tsx:24,55 counts status==='awarded'. grep of app tree shows no code that sets an RFQ to awarded (only rfq/new create). Backend award/close endpoints cannot be verified (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/rfq/[id]/RFQActions.tsx`
- **Fix steps:**
  1. Confirm backend endpoints (award, close, extend, convert-to-PO) and required permissions.
  2. Create RFQActions client component (pattern: planning/[id]/PlanLifecycleActions.tsx) with ConfirmDialog for Close/Award and a required justification for award.
  3. Add a comparative statement view (see RFQ-DETAIL-02) before enabling Award.
  4. Hide Award until closingDate has passed and >=1 response.
- **Acceptance:**
  - Officer can award L1 vendor from detail; status pill becomes Awarded and audit event is emitted by API.
  - Award button absent for users without permission.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** High; award is an approval/financial commitment: needs permission, audit event and immutability after award.
- **Depends on:** GAP-PROCUREMENT-RFQ-DETAIL-02

### GAP-PROCUREMENT-RFQ-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Vendor responses show only a total Bid Amount per vendor (page.tsx); no per-line rates, no L1/lowest marker, no technical compliance and no attachments — an officer cannot justify the selection required for a limited-tender file.
- **Verified evidence:** Response table (rfq/[id]/page.tsx:26-31,57-62) shows vendorName, totalAmount, submittedAt, status only; line items table (:109-117) shows itemName/qty/unit only. Whether RFQDetail (in @civitasone/types, absent from snapshot) carries per-line rates, compliance or attachments is cannot-verify, so a backend addition may be needed. L1 marker is computable client-side from totalAmount.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/rfq/[id]/ComparativeStatement.tsx`
- **Fix steps:**
  1. Add L1 badge: find minimum totalAmount using BigInt among non-withdrawn responses and mark the row; sort ascending.
  2. If API exposes per-line rates, render a vendor x item matrix (ComparativeStatement) with formatMoney; otherwise request backend fields (lineRates, technicalCompliant, attachments).
  3. Show attachment links via the existing document-download component.
- **Acceptance:**
  - Lowest bidder row shows 'L1'.
  - Matrix shows each vendor's rate per line when data is available.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; selection justification for limited tender (GFR).

### GAP-PROCUREMENT-RFQ-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme SEALED (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Vendor bid amounts are visible while the RFQ is still open: the page prints responses for any status (no sealed handling like the tender page uses "Sealed"), so a live RFQ can leak competing quotes to anyone with module access.
- **Verified evidence:** rfq/[id]/page.tsx:57-62,119-127 formats and prints resp.totalAmount for any RFQ status with no check of rfq.status or closingDate. Tenders/[id]/page.tsx:58 shows 'Sealed' only when bidAmount is undefined - i.e. it relies on the API omitting the field, not on UI logic. Whether the RFQ API withholds amounts before closing is cannot-verify (backend absent); UI has no defence if it doesn't.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`
- **Fix steps:**
  1. Add defence-in-depth: if rfq.status is issued/open and now < closingDate, render 'Sealed' for totalAmount regardless of API payload.
  2. Ask backend to omit amounts for open RFQs and gate reveal by permission, with an audit event on reveal.
  3. Reuse the tender page's sealed wording.
- **Acceptance:**
  - Open RFQ with responses shows 'Sealed' in Bid Amount.
  - After closing date amounts are visible.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High for procurement integrity: bid leakage before opening.

### GAP-PROCUREMENT-RFQ-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Indent Ref is the raw stored reference and not linked to /procurement/indents/{id} (page.tsx); line items have no item code or estimated rate to check against the indent.
- **Verified evidence:** rfq/[id]/page.tsx:84-87 prints rfq.indentRef in a mono span. The create form stores indentRef as `procurement_indent:${indentId}` (rfq/new/CreateRFQForm.tsx:207) so the page shows a raw 'procurement_indent:<uuid>'. Route procurement/indents/[id] exists. Line items lack code/estimated rate; fields cannot be verified in RFQDetail type.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Parse the ref (split on ':') to get the id; render <Link href={'/procurement/indents/'+id}> with the human indent number (needs API to return indentNo, else fetch via getProcurementIndentById).
  2. Use formatInternalRef fallback for malformed refs.
  3. Add item code and indent estimated rate columns when API provides them.
- **Acceptance:**
  - Indent Ref shows 'IND/2026/012' linking to the indent.
  - Malformed ':undefined' ref shows '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-RFQ-DETAIL-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pill in header only; description rendered as one unbroken line; Submitted printed date-only.
- **Verified evidence:** Status pill is in the header (rfq/[id]/page.tsx:72) - true, harmless. Description is a plain <span> (:103) so newlines collapse; add white-space:pre-wrap. Submitted uses formatIndianDate (:60) which prints dd/mm/yyyy date-only, browser/server timezone (lib/formatters.ts:2-7), no time; for quote submission time before deadline, time matters. Theme DATEFMT is right only for the last point.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) with timeZone:'Asia/Kolkata', 'dd Mon yyyy, hh:mm' and use for submittedAt (and closingDate if it has time).
  2. Set style whiteSpace:'pre-wrap' on the description span.
- **Acceptance:**
  - Submitted shows date and IST time.
  - Multi-line description keeps line breaks.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/rfq/new  —  `procurement/rfq-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/rfq/new/page.tsx`
- **Design reference:** `redesign/procurement/rfq-new.html`

### GAP-PROCUREMENT-RFQ-NEW-01  ·  HIGH  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreateRFQForm.tsx:44 status=approved fetch, no auto-select, ?indent deep-link done; server POST /rfqs does not reject non-approved indent; picker not server-searchable
- **First-pass claim:** Subtitle says "against an approved indent" but the indent list is unfiltered (GET /indents?limit=100, CreateRFQForm.tsx) and pre-selects the first row (setIndentId(clean[0].id), Form) — an RFQ can be raised on a draft, rejected or already-ordered indent.
- **Verified evidence:** CreateRFQForm.tsx:157 fetches /procurement/indents?limit=100 with no status filter; :163 preselects clean[0].id; options (:243) show only indentNo/department, no status. Subtitle in rfq/new/page.tsx:294 says 'approved indent'. IndentOption has no status field, so client filtering is impossible until the API returns it; a status query param on the endpoint is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/new/CreateRFQForm.tsx`, `apps/web/src/app/(app)/procurement/rfq/new/page.tsx`
- **Fix steps:**
  1. Request /indents?status=approved&limit=100 (confirm param name with backend) and add status to IndentOption; also filter client-side as a guard.
  2. Remove auto-select; start with placeholder option 'Select an indent'.
  3. Make the indent picker searchable (server-side q) instead of a 100 cap; support ?indent=<id> deep-link from indent detail.
  4. Server must reject non-approved indents on POST /rfqs.
- **Acceptance:**
  - Only approved indents appear; draft indent cannot be chosen.
  - Form does not preselect any indent.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; RFQ on unapproved indent is a process violation.
- **Depends on:** GAP-PROCUREMENT-RFQ-NEW-04

### GAP-PROCUREMENT-RFQ-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — CreateRFQForm.tsx min-3 vendors+justification :96,113, blacklisted disabled, no client rfqNo; server only rejects blacklisted (rfq/routes.ts:30), no min-3 or empanelled-only enforcement
- **First-pass claim:** The vendor checklist is every vendor returned (Form), with no empanelment / blacklist status shown: a blacklisted or non-empanelled vendor can be invited, and there is no minimum-quotes rule (GFR requires three for limited tender) — one invited vendor is accepted (invited.size === 0 is the only check, Form).
- **Verified evidence:** CreateRFQForm.tsx:172-176 loads all vendors (id,name only; VendorOption :140) and renders checkboxes (:262-267) with no status; submit guard :196 is invited.size===0 only. No GFR minimum-three rule. Vendor status/blacklist fields availability from /vendors cannot be verified. Extra finding: rfqNo is generated client-side with Math.random (:203) - collision risk and not server-sequenced.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/new/CreateRFQForm.tsx`
- **Fix steps:**
  1. Add status/empanelled/blacklisted to VendorOption from the vendors API; filter to active empanelled vendors and show a status badge; disable blacklisted.
  2. Require >=3 invited vendors (GFR limited tender) with override justification textarea if fewer; show live count vs minimum.
  3. Stop sending client-generated rfqNo; let backend sequence it (confirm backend accepts omission).
  4. Server must enforce the same rules.
- **Acceptance:**
  - Selecting 2 vendors blocks submit with 'minimum 3' message unless justification given.
  - Blacklisted vendor is not selectable.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; procurement compliance (GFR) and blacklisted vendor invitation.

### GAP-PROCUREMENT-RFQ-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was CAP)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — min=today + past-date check :106,170 and Templates removed done; vendor search is client-side over first 100 only (no server q/pagination)
- **First-pass claim:** No closing-date sanity check (may be past); Templates link from the list (?template=1) is ignored here; vendors list is capped at limit=100 with no search.
- **Verified evidence:** closingDate is <input type=date> (CreateRFQForm.tsx:248) with no min; only presence checked (:196). rfq/page.tsx:44 links to /procurement/rfq/new?template=1 but rfq/new/page.tsx takes no searchParams and the form ignores it. Vendors fetched with limit=100 and no search (:172). No template endpoint verified.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/new/CreateRFQForm.tsx`, `apps/web/src/app/(app)/procurement/rfq/new/page.tsx`, `apps/web/src/app/(app)/procurement/rfq/page.tsx`
- **Fix steps:**
  1. Set min={today (IST)} on the date input and validate closingDate >= today (ideally >= today+N days per policy) in handleSubmit.
  2. Either implement ?template=1 (template picker) or remove the Templates button in rfq/page.tsx:44.
  3. Add a vendor search box with server-side q and pagination (or a checkable DataTable) replacing the 100 cap.
- **Acceptance:**
  - Past date is rejected with inline message.
  - Templates button either works or is gone.
  - With 150 vendors, search finds vendor 150.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-RFQ-NEW-02

### GAP-PROCUREMENT-RFQ-NEW-05  ·  LOW  ·  confirmed  ·  theme THEME (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline background:#fff on fields (Form) breaks dark mode; success text is set but the route pushes immediately, so it is never read.
- **Verified evidence:** CreateRFQForm.tsx:239,246,250 set style background:'#fff' on field wrappers (breaks dark theme); message colours are hard-coded #b91c1c/#047857 (:274). setMessage('RFQ issued...') at :227 is followed immediately by router.push (:228), so it is never read. Also raw <select>/<input> without className inp on :241,:248.
- **Files to change:** `apps/web/src/app/(app)/procurement/rfq/new/CreateRFQForm.tsx`
- **Fix steps:**
  1. Remove inline background:'#fff' and padding overrides; use existing .field/.inp classes and tokens (var(--bad), var(--good)).
  2. Either drop the success message or toast it (shared toast) before/while navigating.
  3. Add className='inp' to the select and date input.
- **Acceptance:**
  - Dark theme: fields have no white boxes.
  - After submit a toast confirms RFQ issued on the detail page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/tenders  —  `procurement/tenders.html`

- **Source:** `apps/web/src/app/(app)/procurement/tenders/page.tsx`
- **Design reference:** `redesign/procurement/tenders.html`

### GAP-PROCUREMENT-TENDERS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Header subtitle says "open, limited, and GeM tenders" but the type set includes Single Source (TYPE_LABELS, page.tsx; CreateTenderForm.tsx); single-source procurement is the audit-sensitive category and gets no flag, filter or justification column in the register.
- **Verified evidence:** tenders/page.tsx:185 subtitle says 'open, limited, and GeM tenders' while TYPE_LABELS (143-148) and CreateTenderForm TYPES include single_source. Rows show typeLabel as plain text (239); no badge, filter or justification column. Justification data is not captured at all (see NEW-02).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/page.tsx`, `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx`
- **Fix steps:**
  1. Update the subtitle to include single-source.
  2. Render Type via col.render: single_source gets a warn StatusPill.
  3. Add a Type filter (facet) and a 'Single source' StatCard linking to the filtered view.
  4. Add a justification column/tooltip once NEW-02 delivers the field.
- **Acceptance:**
  - Single source tender row shows a warn 'Single Source' pill.
  - Type filter 'Single Source' lists only those rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-TENDERS-NEW-02

### GAP-PROCUREMENT-TENDERS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** "Under Evaluation" merges technical and financial evaluation (status "evaluation", page.tsx), so the register cannot show which tenders are waiting for technical scoring versus for opening sealed financial bids.
- **Verified evidence:** tenders/page.tsx:166 counts status==='evaluation' as 'Under Evaluation' (tile line 206). The collapse to one status happens in the service (mapTenderStatus, per TenderLifecycleActions.tsx:165-168 comment); service source is absent so the split cannot be produced from the web alone.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/page.tsx`, `services/procurement-service queries.ts (absent)`
- **Fix steps:**
  1. Backend: expose technical_evaluation and financial_evaluation in TenderSummary.status (or a `phase` field).
  2. Web: two stat tiles (Technical eval / Financial eval) and StatusPill entries for both statuses; update filter logic at line 166.
  3. Keep a fallback for the legacy 'evaluation' value.
- **Acceptance:**
  - Tender in financial stage counted only in the Financial tile.
  - StatusPill shows 'Technical Evaluation' vs 'Financial Evaluation'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; enum change must be coordinated with all consumers.
- **Depends on:** GAP-PROCUREMENT-TENDERS-DETAIL-02

### GAP-PROCUREMENT-TENDERS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Register has no type or status filter and no overdue cue: a published tender past its Bid Close with zero bids looks identical to a fresh one (page.tsx).
- **Verified evidence:** tenders/page.tsx:233 DataTable is filterable with a free-text box (placeholder 'Filter by tender no, title, status…'), so text search on status/type works, but there is no type/status facet control. No overdue logic: bidClosingDate is only formatted (176) and no comparison with today for status 'published' with bidsReceived 0.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/page.tsx`
- **Fix steps:**
  1. Add Type and Status selects (searchParams-driven) above the table.
  2. Add an 'Overdue' cue: published && bidClosingDate < today IST -> warn pill 'Closed - 0 bids' or 'Closed'; sort overdue first optionally.
  3. Use one date helper (IST) shared with the RFQ page.
- **Acceptance:**
  - Published tender with bidClosingDate yesterday and 0 bids shows the cue; future-dated doesn't.
  - Type filter reduces rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-TENDERS-04  ·  LOW  ·  partly  ·  theme OTHER (was ROLEGATE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Est. Value cellType "amount" formatting is delegated to DataTable (page.tsx); publish date prints "—" for drafts; stat tiles are not links to filtered lists.
- **Verified evidence:** Est. Value: cellType 'amount' goes to DataTable.cellValue (DataTable.tsx:128-133) -> formatMoney, which renders '—' for null; formatting is fine, not a defect. publishDate '—' for drafts (tenders/page.tsx:175) is intended. Stat tiles (204-207) are indeed non-clickable (StatCard has no href prop). Theme ROLEGATE is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Optionally add an href prop to StatCard (wrap in Link) and point tiles to /procurement/tenders?status=...
  2. Depends on the filter from TENDERS-03.
- **Acceptance:**
  - Clicking the Published tile opens the register filtered to published.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; StatCard is shared, keep the prop optional.
- **Depends on:** GAP-PROCUREMENT-TENDERS-03


---
## /procurement/tenders/[id]  —  `procurement/tenders-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/tenders/[id]/page.tsx`
- **Design reference:** `redesign/procurement/tenders-detail.html`

### GAP-PROCUREMENT-TENDERS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Technical evaluation form pre-ticks "Qualified" only for bids already technically_qualified (Actions.tsx), so saving an untouched form disqualifies every bidder; there is no reason/remark field per bidder — a disqualification is recorded as a boolean plus an optional score (Actions.tsx) with no justification for the audit trail.
- **Verified evidence:** TenderLifecycleActions.tsx:290 initial state qualified = (b.status === 'technically_qualified'), so bids not yet qualified start unticked. submit() (303-329) sends every bid with qualified:row.qualified and optional score to /technical-evaluation with no confirm dialog, so pressing Save on an untouched form marks all pending bids disqualified. Payload (line 311) is {bidId,qualified,score} - no remark/reason per bidder; table columns are Vendor/Qualified/Score only. Maker-checker and audit emission are server-side (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/TenderLifecycleActions.tsx`, `services/procurement-service technical-evaluation route (absent)`
- **Fix steps:**
  1. Make qualified tri-state: undefined (not evaluated) | true | false; render Qualified/Disqualified radio pair, default unset.
  2. Disable Save until every bid has a decision; add a per-bid 'Reason' textarea, required when disqualified (min length via same rule as ConfirmDialog minReasonLength).
  3. Wrap submit in ConfirmDialog (or ActionButton requireReason) summarising N qualified / M disqualified before POST.
  4. Backend: accept `remarks` per result and store it, emit audit event with evaluator id; enforce evaluator != creator.
- **Acceptance:**
  - Rendering with 3 pending bids and clicking Save without choices is blocked with a validation message.
  - Marking a bid disqualified without a reason blocks submit.
  - Payload includes remarks for disqualified bids.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: a wrong disqualification eliminates a bidder from a public tender; audit trail required.

### GAP-PROCUREMENT-TENDERS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** The action set is inferred, not stated: because the summary collapses technical and financial evaluation into "evaluation", the component guesses phase from whether any bidAmount is visible (Actions.tsx). "Open financial bids" stays enabled after opening, and Award appears as soon as one amount is revealed — premature clicks fail only with the server's raw error text.
- **Verified evidence:** TenderLifecycleActions.tsx:190 anyFinancialOpened = bids.some(b => b.bidAmount !== undefined) is the inferred phase signal (comment at 165-175 admits it). 'Open financial bids' (252-259) is rendered whenever status==='evaluation' and stays enabled after opening; 'Award tender' (260-270) appears as soon as any amount is visible, even if other qualified bids are still sealed. Errors surface as `throw new Error(await res.text())` (lines 194/199/208), i.e. raw server body in ActionButton's error text. Technical form disappears once any amount is revealed (236).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/TenderLifecycleActions.tsx`, `apps/web/src/app/(app)/procurement/tenders/[id]/page.tsx`, `services/procurement-service queries.ts mapTenderStatus (absent)`
- **Fix steps:**
  1. Backend: stop collapsing statuses - return technical_evaluation and financial_evaluation (and per-bid financialOpened) in the tender detail; add both to StatusPill map.
  2. In TenderLifecycleActions switch on the explicit status: show TechnicalEvaluationForm only in technical_evaluation, 'Open financial bids' only there after evaluation is done, 'Award' only in financial_evaluation.
  3. Disable Open financial when no bid is technically_qualified; disable Award unless all qualified bids are opened.
  4. Map server errors through toHumanError/parse JSON {message} instead of throwing res.text().
- **Acceptance:**
  - Tender in financial_evaluation with opened amounts: 'Open financial bids' is not rendered.
  - Tender in technical_evaluation: Award button absent.
  - A 409 from the server shows a human sentence, not JSON.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: irreversible award step; premature actions are currently prevented only by the server.
- **Depends on:** GAP-PROCUREMENT-TENDERS-02

### GAP-PROCUREMENT-TENDERS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Award is a one-click (plus dialog) irreversible step with no role check; the maker-checker rule (approver ≠ creator ≠ technical evaluator) exists only as dialog copy (Actions.tsx) — the creator sees an enabled Award button and finds out on the server 4xx. Sanction reference is optional (Actions.tsx) for a step that raises a PO.
- **Verified evidence:** TenderLifecycleActions.tsx:260-270 Award ActionButton rendered for every user once anyFinancialOpened; no role/identity check anywhere in the component (roleGuard.ts getSessionRoles is server-only and unused here). Maker-checker exists only as text in confirmDescription (line 264). Sanction input is labelled '(optional)' (246) and body sends {} when empty (206). Server enforcement of creator!=approver is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/TenderLifecycleActions.tsx`, `apps/web/src/app/(app)/procurement/tenders/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. In tenders/[id]/page.tsx (server) call getSessionRoles()/session sub and compare with tender.createdBy and technical evaluator id (needs those fields in TenderDetail); pass canAward + blockReason props to TenderLifecycleActions.
  2. Render Award disabled with an explanatory title when !canAward instead of hiding silently.
  3. Make sanctionRef required (client validation + ActionButton disabled) unless policy says otherwise; use requireReason on the dialog.
  4. Backend: confirm maker-checker is enforced and Sanction ref required; return 403 with a code the UI maps to a human message.
- **Acceptance:**
  - Creator of the tender sees Award disabled with 'Approver must differ from creator'.
  - Award with empty sanction reference cannot be confirmed.
  - Direct API call by creator still returns 403 (backend test).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: award raises a PO (money); client gate is UX only, server must remain authoritative.
- **Depends on:** GAP-PROCUREMENT-TENDERS-DETAIL-02

### GAP-PROCUREMENT-TENDERS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme PII (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — tenders/[id]/page.tsx:72-75 shows Bidder N while published (display masking only); API still returns vendorName, no role gate or audited reveal
- **First-pass claim:** Bidder names are shown while bids are sealed (page.tsx): only the amount is hidden; before the opening date the register of who bid is visible to any module user, weakening bid confidentiality.
- **Verified evidence:** tenders/[id]/page.tsx:50-62 maps every tender.bids entry with vendorName and only masks the amount ('Sealed' at :58). The page never compares against the opening date, so bidder names are shown to any module user for whatever bids the API returns. Whether the API already hides bids/vendors before opening is cannot-verify (service absent). Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/page.tsx`, `services/procurement-service tender detail query (absent)`
- **Fix steps:**
  1. Decision/backend: define who may see the bidder register before opening (bid opening committee only) and have the detail endpoint omit or anonymise vendorName ('Bidder 1') until opening date/status.
  2. Web: in bidRows show 'Sealed bidder' when vendorName is absent and hide the Bids card behind role/status.
  3. Use a <Masked>-style component for the reveal so it can be audited.
- **Acceptance:**
  - Before opening date, a non-committee user sees 'Bidder 1..n' and count only.
  - After technical opening the names appear.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** High: bid confidentiality is a legal/vigilance requirement (GFR); leak of bidder identity.

### GAP-PROCUREMENT-TENDERS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — EMD shown (tenders/[id]/page.tsx:152-155) and NIT-missing banner (:126), but Publish is not disabled/confirm-gated: TenderLifecycleActions has no hasNit prop; acceptance 'Publish disabled with Attach NIT first' unmet
- **First-pass claim:** EMD amount is captured on create (CreateTenderForm.tsx) but never displayed on the detail page; NIT / corrigendum documents live on a separate route with no indicator here of how many exist or whether a NIT was attached before Publish.
- **Verified evidence:** CreateTenderForm.tsx:45 sends emdAmountMinor, but tenders/[id]/page.tsx fields (lines 84-123) show Tender No, Est. Value, Publish, Closing, Opening, Bids Received, Scope, Eligibility - no EMD. The only link to documents is a 'Documents' button (line 74) with no count; nothing warns Publish (TenderLifecycleActions.tsx:214) that no NIT exists. Whether TenderDetail carries emdAmount is cannot-verify (type in absent @civitasone/types).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/tenders/[id]/TenderLifecycleActions.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add an 'EMD' field to the details card with formatMoney(tender.emdAmountMinor) once the field is confirmed in the TenderDetail schema/API.
  2. Load documents (getProcurementTenderDocuments, loaders.ts:5614) in the page and show 'Documents (N)' and a NIT present/missing pill.
  3. Pass hasNit to TenderLifecycleActions and disable Publish (or add a confirm warning) when no docType==='nit' document exists.
- **Acceptance:**
  - Detail page shows EMD in rupees for a tender created with EMD 50,000.
  - Draft tender without NIT: Publish is disabled with 'Attach NIT first'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: publishing without NIT is a compliance risk; blocking must match backend rule.
- **Depends on:** GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-03


---
## /procurement/tenders/[id]/documents  —  `procurement/tenders-detail-documents.html`

- **Source:** `apps/web/src/app/(app)/procurement/tenders/[id]/documents/page.tsx`
- **Design reference:** `redesign/procurement/tenders-detail-documents.html`

### GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Corrigendum has no special handling: it is just another docType (page.tsx) with no version number, no effect on the bid closing date and no notice to bidders — the legally binding amendment of a live tender is a file in a list. Anyone with module access can upload it (no role gate) and there is no delete/replace/void action.
- **Verified evidence:** documents/page.tsx: DOC_TYPES (line 18-25) lists 'corrigendum' as one option; handleSave (120-165) posts only {docType,title,storageRef}. No version/effective date, no update of bid closing date, no notify-bidders call. Upload form is rendered unconditionally (lines 194-277); table Actions column only has Download (365); no delete/replace/void. Layout only has ModuleGate moduleKey='procurement' (procurement/layout.tsx), so any procurement user sees upload. Server-side role enforcement and any corrigendum endpoint are cannot-verify (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/documents/page.tsx`, `apps/web/src/app/(app)/procurement/tenders/[id]/page.tsx`, `services/procurement-service (absent from snapshot)`
- **Fix steps:**
  1. Decision: define the corrigendum workflow with the tender owner (issue no., reason, revised closing date, notify bidders, approver).
  2. Backend: add corrigendum endpoint (or docType-specific fields corrigendumNo, revisedClosingDate) that updates bidClosingDate, emits an audit event, and notifies bidders; add a void/supersede action instead of hard delete.
  3. Web: when docType==='corrigendum' show extra fields (No., reason, revised closing date) and a ConfirmDialog (requireReason) before save; show a Corrigenda list on tenders/[id]/page.tsx.
  4. Gate the upload form via lib/auth/roleGuard (server) - split into a server page passing canUpload to the client component - and hide it for non-procurement-officer roles.
- **Acceptance:**
  - Uploading a corrigendum with a revised closing date updates 'Bid Closing' on the tender detail and writes an audit event.
  - User without upload role sees no upload form and POST returns 403.
  - Voiding a corrigendum keeps the row visible marked Superseded.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** High: legally binding tender amendments; a wrong closing date change affects live bids. Needs audit trail and role check.
- **Depends on:** GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-02

### GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Header identifies the tender only by its raw UUID: subtitle "Tender ID: {params.id}" (page.tsx) with no tender number, title or status, so an officer cannot tell whether they are attaching to a draft (safe) or a published tender (bidders already see it).
- **Verified evidence:** documents/page.tsx:172-179 subtitle is 'Tender ID:' plus {params.id} in a mono span. It is a 'use client' page that never calls getProcurementTenderById, so tender number, title and status (draft vs published) are not available. Back link labelled 'Tender' only.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/documents/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Convert the page to a server component (or a server wrapper) that calls getProcurementTenderById(params.id) and passes tenderNo/title/status to a new client TenderDocumentsClient.
  2. Set PageHeader title to `${tenderNo}` and subtitle to the title, add <StatusPill status={status}/> in actions; move the raw id out of the UI.
  3. When status !== 'draft' show a warning banner 'Published - bidders can see new documents' above the upload form.
  4. On fetch error show ErrorState instead of 'Tender ID'.
- **Acceptance:**
  - Page for tender T-2025/12 shows 'T-2025/12', its title and a Published pill; the UUID is not visible.
  - Draft tender shows no warning banner; published does.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; refactor of a client page into server+client split.
- **Depends on:** GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-01

### GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Field mismatch risk: the page reads doc.createdAt (page.tsx) but the shared loader type for the same endpoint is uploadedAt (loaders.ts:5611); if the API sends uploadedAt every row shows "—" for Uploaded, and sizeBytes typed string here vs number there.
- **Verified evidence:** Types do disagree: documents/page.tsx:8-16 TenderDoc has createdAt?: string and sizeBytes?: string, rendered at :360 (createdAt) and :358 (formatBytes accepts string|number). loaders.ts:5611-5620 TenderDocumentSummary (getProcurementTenderDocuments, unused by any page - grep shows only its definition) declares uploadedAt: string and sizeBytes: number|null. Which name the API actually sends is cannot-verify (procurement-service absent). formatBytes tolerates both number and string so size works either way; only the date could show '—'.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/documents/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm the response shape from the tender documents route in procurement-service.
  2. Delete the local TenderDoc type; import TenderDocumentSummary (or a zod schema) and read the confirmed date field, tolerating both uploadedAt and createdAt during transition.
  3. Either use getProcurementTenderDocuments from a server component or remove the unused loader.
  4. Parse the response with the shared zod schema so a shape change fails visibly.
- **Acceptance:**
  - Unit test: row with only uploadedAt renders a formatted date, not '—'.
  - Type check passes with no local duplicate document type.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-04

### GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** load() never checks res.ok (page.tsx): a 401/500 returning JSON without data is treated as an empty list ("No documents uploaded yet.") rather than an error, so a failed fetch can look like a tender with no NIT.
- **Verified evidence:** documents/page.tsx:70-75 load() awaits fetch then res.json() and setDocs(Array.isArray(json.data)?json.data:[]) with no res.ok check. A 401/403/500 with a JSON body (e.g. {error:...}) yields json.data undefined -> empty list -> 'No documents uploaded yet.' (line 338). Only a network failure or non-JSON body reaches setError (line 78). Also error state is never reset to '' on a successful retry.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/documents/page.tsx`
- **Fix steps:**
  1. In load(): after fetch, `if (!res.ok) { setError(...); return; }` before parsing; also setError('') at the start.
  2. Treat a non-array json.data as an error, not empty.
  3. Reuse RefreshErrorState/ErrorState with onRetry (already present at line 322) for the not-ok path.
  4. Optionally move the read to a server loader (getProcurementTenderDocuments) that already reports source==='error'.
- **Acceptance:**
  - Mock fetch returning 500 {error:'x'} -> ErrorState shown, 'No documents uploaded yet.' not shown.
  - Retry after success clears the error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents an officer concluding the NIT is missing when the request failed.

### GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-05  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Type column prints the raw enum ("technical_spec", "nit") as a chip (page.tsx) while the dropdown shows "TECHNICAL SPEC"; date uses toLocaleDateString("en-IN") in the browser rather than the shared formatter; no checksum or "published to vendors" flag per document.
- **Verified evidence:** True: documents/page.tsx:355 prints raw {doc.docType} ('technical_spec') in a chip while the dropdown label is t.replace(/_/g,' ').toUpperCase() (line 237); :361 uses new Date(...).toLocaleDateString('en-IN') (browser timezone, not the shared formatIndianDate). Not shown: checksum and 'published to vendors' flag - but neither field exists in TenderDoc/TenderDocumentSummary, so this needs backend fields (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/[id]/documents/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a DOC_TYPE_LABELS map (NIT, Bid form, Technical specification, ...) and use it in both the <option> and the table chip (or humanizeStatus).
  2. Replace toLocaleDateString with formatIndianDate(doc.uploadedAt ?? doc.createdAt).
  3. If required by the business, backend to add sha256 and publishedAt to the document record; then add columns.
- **Acceptance:**
  - Row with docType technical_spec displays 'Technical specification'.
  - Date displays as 'dd Mon yyyy' in IST regardless of browser locale.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/tenders/new  —  `procurement/tenders-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/tenders/new/page.tsx`
- **Design reference:** `redesign/procurement/tenders-new.html`

### GAP-PROCUREMENT-TENDERS-NEW-01  ·  HIGH  ·  partly  ·  theme WIRING (was MONEY)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** A tender can be created with no link to an indent or annual plan line (no such field, Form) — the chain indent → tender → PO is broken at the tender step, and the GFR mode band selected on the indent form is not enforced: a ₹40 lakh purchase can be floated as Limited or Single Source.
- **Verified evidence:** CreateTenderForm.tsx body (39-47) has no indentRef/planLineRef field and no GFR check, so the tender is unlinked: confirmed. The indent form does look up GFR mode bands (indents/new/CreateIndentForm.tsx:29-35), but nothing carries the result to the tender, and estimated value vs type is not validated here (type select is free). Whether the backend enforces the band is cannot-verify. Money note: lines 44-45 and 90/95 use Math.round(x*100) on a float Number, which CLAUDE.md flags; theme should be WIRING not MONEY.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx`, `apps/web/src/app/(app)/procurement/tenders/new/page.tsx`
- **Fix steps:**
  1. Add a required 'Source indent' select (same /procurement/indents fetch as CreateRFQForm) and send indentRef `procurement_indent:${id}`; prefill estimated value from the indent.
  2. Fetch /procurement/gfr/mode-bands?estimatedValueMinor= (as CreateIndentForm does) and restrict/flag the type options outside the allowed band.
  3. Replace Math.round(x*100) with a shared parseRupeesToPaise(string) helper (string->bigint) and send paise as string/bigint per API contract.
  4. Backend: accept indentRef and validate mode against GFR band, returning 422.
- **Acceptance:**
  - Creating a tender without an indent is rejected client-side.
  - A 40 lakh estimate with Single Source is blocked or requires justification.
  - 0.1+0.2 style input '1234.56' yields 123456 paise exactly.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: breaks the indent->tender->PO chain and GFR compliance; money conversion must be exact.
- **Depends on:** GAP-PROCUREMENT-TENDERS-NEW-02

### GAP-PROCUREMENT-TENDERS-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Single Source is a plain option with no justification / approving-authority field (Form); GFR requires a recorded reason for proprietary or single-source purchases, and the register does not flag them.
- **Verified evidence:** CreateTenderForm.tsx:10-15 TYPES includes single_source as an ordinary option; the payload (39-47) has no justification or approving-authority field and no conditional UI on type. The register (tenders/page.tsx) does not flag type either. Server-side justification rule is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx`, `apps/web/src/app/(app)/procurement/tenders/page.tsx`
- **Fix steps:**
  1. When type==='single_source' render required fields: justification category (proprietary/emergency/other GFR rule), free-text reason, approving authority.
  2. Send them in the create body; backend to store and emit an audit event.
  3. In tenders/page.tsx show a 'Single source' flag pill and justification tooltip (see TENDERS-01).
- **Acceptance:**
  - Selecting Single Source without justification blocks submit.
  - Saved tender shows justification on detail page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: audit-sensitive procurement mode.
- **Depends on:** GAP-PROCUREMENT-TENDERS-01

### GAP-PROCUREMENT-TENDERS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** EMD is a free rupee field defaulting to 0 (Form) with no rule or hint (percentage of estimated value, exemptions for MSE/Startups); estimated value 0 is accepted; closing date may be in the past.
- **Verified evidence:** CreateTenderForm.tsx:23-24 estimated and emd default to 0; validation (32-36) checks only title and bidClosingDate, so estimated 0 is accepted; the date input (85) has no min attribute and no past-date check. EMD has no hint or auto-calculation. Backend zod rules unknown (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx`
- **Fix steps:**
  1. Require estimated value > 0 and show an inline error.
  2. Add min={today IST} on the date input plus submit-time check that bidClosingDate is after today (ideally after publish + minimum bid period).
  3. Add EMD helper text (e.g. typically 2-5% of estimate) and a suggested value button; add an 'EMD exempt (MSE/Startup)' checkbox that zeroes it with a reason.
  4. Move rupee->paise parsing to the shared string-based helper.
- **Acceptance:**
  - Submit with estimated 0 shows an error.
  - Closing date yesterday is rejected.
  - Exempt checkbox sends emdAmountMinor 0 and the reason.
- **Needs:** web+decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium: EMD policy percentages must come from the procurement rules owner.
- **Depends on:** GAP-PROCUREMENT-TENDERS-NEW-01

### GAP-PROCUREMENT-TENDERS-NEW-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Publish date, opening date and NIT attachment are not captured here although the detail page shows Publish Date and Opening Date and the documents route exists (tenders/[id]/page.tsx); success copy says "entered the workflow" for what is only a draft.
- **Verified evidence:** Form has no publish date, opening date or NIT attachment (CreateTenderForm.tsx:39-47); detail page conditionally shows publishDate/openingDate (tenders/[id]/page.tsx:92,102). Publish date is set by the separate Publish action (TenderLifecycleActions.tsx:214), so its absence in the create form is by design; opening date and NIT upload are genuinely missing. Success copy 'Tender created and entered the workflow.' (line 61) overstates a draft. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx`, `apps/web/src/app/(app)/procurement/tenders/new/page.tsx`
- **Fix steps:**
  1. Add optional 'Bid opening date/time' input (validated >= closing date) and send openingDate if the create API accepts it (cannot-verify).
  2. After create, redirect to the tender detail with a 'Next: attach NIT and publish' prompt linking /documents.
  3. Change message to 'Tender saved as draft.' and the page subtitle in new/page.tsx accordingly.
- **Acceptance:**
  - Success toast reads 'saved as draft'.
  - Opening date earlier than closing date is rejected.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROCUREMENT-TENDERS-NEW-05  ·  LOW  ·  confirmed  ·  theme THEME (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline background:#fff on fields (Form) breaks dark mode; Scope and Eligibility are unlimited free text with no max length.
- **Verified evidence:** CreateTenderForm.tsx lines 73,77,83,87,92,97,101 set inline style background:'#fff' on .field wrappers (dark mode would show white panels); error/success colors #b91c1c/#047857 hard-coded at 109. Scope and Eligibility textareas (99,103) have no maxLength.
- **Files to change:** `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx`
- **Fix steps:**
  1. Remove inline background/padding from .field wrappers and rely on the .field class; use var(--panel).
  2. Replace #b91c1c/#047857 with var(--bad)/var(--good).
  3. Add maxLength (e.g. 4000) with a character counter to both textareas and mirror in the zod schema.
- **Acceptance:**
  - Dark theme shows no white blocks in the form.
  - Typing beyond limit is blocked.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/vendors  —  `procurement/vendors.html`

- **Source:** `apps/web/src/app/(app)/procurement/vendors/page.tsx`
- **Design reference:** `redesign/procurement/vendors.html`

### GAP-PROCUREMENT-VENDORS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — Subtitle fixed, Segmented status filter added, PO/RFQ pickers exclude/disable blacklisted, RFQ route 422 (rfq/routes.ts:36). But POST /v1/procurement/pos (po/routes.ts:38-42 -> commands.ts:9) returns 202 with no sync blacklist check; rejection only async in po/consumer.ts:178 (event+audit, no PO), so acceptance "POST PO with blacklisted vendorId returns 4xx" unmet; CreatePOForm.tsx:44 comment wrongly claims 422. not_empanelled not warned/disabled.
- **First-pass claim:** Subtitle promises "Approved vendor directory" but the table lists every status, including Blacklisted and Not Empanelled, mixed with approved vendors and with no filter (Table) — the same list feeds the PO and RFQ pickers, which is how blacklisted vendors become selectable.
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/page.tsx:156 subtitle says 'Approved vendor directory'; l.142 fetches limit 500 with no status filter and VendorsTable.tsx:244-270 lists all statuses with only a free-text filter (l.249). The PO and RFQ pickers also take all vendors: procurement/orders/new/CreatePOForm.tsx:28-33 and rfq/new/CreateRFQForm.tsx:42-46 call /procurement/vendors?limit=100 and only filter on id&&name, with VendorOption = {id,name} (no status). So blacklisted vendors are selectable client-side; server-side rejection is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/page.tsx`, `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`, `apps/web/src/app/(app)/procurement/orders/new/CreatePOForm.tsx`, `apps/web/src/app/(app)/procurement/rfq/new/CreateRFQForm.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Rename subtitle to 'Vendor directory with empanelment status...' or default the table to Empanelled/Provisional.
  2. Add a Segmented status filter (All/Empanelled/Provisional/Not empanelled/Blacklisted) in VendorsTable.tsx over tableRows.
  3. In CreatePOForm and CreateRFQForm add empanelmentStatus to VendorOption, exclude 'blacklisted' (and warn/disable 'not_empanelled') from the option list.
  4. Backend: reject PO/RFQ against a blacklisted vendor (server is the real control).
  5. Add server-side ?empanelmentStatus= support to the list call if not present.
- **Acceptance:**
  - Blacklisted vendor never appears in the PO vendor select or RFQ invite list.
  - Directory status filter shows only chosen status.
  - POST PO with a blacklisted vendorId returns 4xx (backend).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Procurement compliance risk: blacklisted vendor can receive orders. Confirm whether provisional vendors are orderable.
- **Depends on:** GAP-PROCUREMENT-VENDORS-03

### GAP-PROCUREMENT-VENDORS-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: the Contact column falls back to the raw phone number (contact: v.contactPerson ?? v.phone ?? "—", Table) for every module user; contact persons of proprietorship vendors are natural persons, and no masking or role gate applies.
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx:228 sets contact: v.contactPerson ?? v.phone ?? '—' and l.268 shows the Contact column to every module user; the search filter also indexes it. No masking or role gate. Whether contact persons are natural persons is domain fact (plausible for proprietorships).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Show contactPerson only; drop the phone fallback (l.228) or render it through <Masked kind='phone'>.
  2. Make the reveal role-gated (same rule as DETAIL-01).
  3. Consider removing contact from the DataTable global filter.
- **Acceptance:**
  - Vendor with no contactPerson shows '—' or a masked number, not the raw phone.
  - Authorised role can reveal.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Officers lose quick phone lookup in list; detail page remains available.
- **Depends on:** GAP-PROCUREMENT-VENDORS-DETAIL-01

### GAP-PROCUREMENT-VENDORS-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — vendors/page.tsx:14 + VendorsTable.tsx:121 truncation notice when cap 500 hit (interim step); no server total/counts or server pagination
- **First-pass claim:** limit=500 with a client-side DataTable: vendor masters above 500 are silently truncated, and stat tiles are computed from the same truncated set (page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/page.tsx:142 getProcurementVendors({limit:500}); tiles (l.144-146,163) computed from that array; VendorsTable.tsx does client-side filter/paging (pageSize 10, l.251). q filtering in loaders.ts:2462-2469 is also client-side after the fetch. No truncation indicator. Total count from the API is cannot-verify (envelope unknown).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/page.tsx`, `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `procurement-service (list total + counts)`
- **Fix steps:**
  1. Backend: return {data,total} plus per-status counts (or a /vendors/summary endpoint).
  2. Loader: pass page/pageSize/q/status through buildListPath; return total.
  3. Tiles read server counts; table moves to server pagination (DataTable page/onPageChange props if supported, else a small wrapper).
  4. Interim: if data.length === limit show a visible 'Showing first 500 - refine search' notice.
- **Acceptance:**
  - Seed 600 vendors: Total tile shows 600 and paging reaches all.
  - Searching a vendor beyond the first 500 finds it.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; tile numbers will change to true totals.
- **Depends on:** GAP-PROCUREMENT-VENDORS-01

### GAP-PROCUREMENT-VENDORS-04  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Silent zero tiles on failed fetch while the provenance badge sits in the card (Table): stat tiles read the server result and the table reads its own cache, so they can disagree (UX-012 comment).
- **Verified evidence:** Confirmed: on fetch error getProcurementVendors returns [] so tiles (page.tsx:163-166) show 0 with no marker; the badge lives inside the card (VendorsTable.tsx:240). Nuance: table rows come from useSeededResource (VendorsTable.tsx:211-216), which can serve a cached copy on error, while tiles use the raw server array, so tile and table can indeed disagree; actual cache behaviour depends on lib/sync/resource (not deep-read). Page does pass source to the table but not to the tiles.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/page.tsx`, `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`, `apps/web/src/app/_components/ds/RefreshErrorState.tsx`
- **Fix steps:**
  1. Move the StatGrid into VendorsTable (client) or a child that receives `rows` from useSeededResource, so tiles and table share one dataset.
  2. When provenance is error-no-data render '—' in the tiles, not 0.
  3. When no data and no cache render <RefreshErrorState> instead of the 'No vendors found / Register a vendor' EmptyState (VendorsTable.tsx:241-243).
- **Acceptance:**
  - Force the vendors API to fail with no cache: tiles show '—' and a Retry error state, not 0 and 'No vendors found'.
  - With a cached copy, tiles equal the row count.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-PROCUREMENT-VENDORS-05  ·  LOW  ·  partly  ·  theme CONSISTENCY (was VALIDATION)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Not Empanelled tile added so tiles reconcile (VendorsTable.tsx:71); table Rating column still n/5 vs scorecard /100 (only detail relabelled Buyer rating)
- **First-pass claim:** Rating "n/5" here but the scorecard scores 0–100 (vendors/[id]/scorecard/page.tsx) — two scales for the same vendor; GSTIN prints unvalidated as returned; empanelment set uses "Not Empanelled" that the stat tiles do not count.
- **Verified evidence:** True: rating '{n}/5' at VendorsTable.tsx:227 vs scorecard/page.tsx:116 '/100'. True: tiles count only empanelled, provisional, blacklisted (page.tsx:144-146) while Total (l.163) includes not_empanelled, so tiles do not add up. GSTIN printed as returned (l.224) is not really a defect (validation belongs at entry). Not a form-validation issue.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`, `apps/web/src/app/(app)/procurement/vendors/page.tsx`
- **Fix steps:**
  1. Align rating scale with the scorecard (see DETAIL-05 decision).
  2. Add a 'Not empanelled' tile (or 'Others') so tiles reconcile with Total.
  3. Do nothing for GSTIN display.
- **Acceptance:**
  - Sum of status tiles equals Total Vendors.
  - Same rating scale in list, detail and scorecard.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROCUREMENT-VENDORS-DETAIL-05


---
## /procurement/vendors/[id]  —  `procurement/vendors-detail.html`

- **Source:** `apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx`
- **Design reference:** `redesign/procurement/vendors-detail.html`

### GAP-PROCUREMENT-VENDORS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — vendors/[id]/page.tsx:117-165 PAN/email/phone/account via server-rendered Masked (raw not in payload); no role-gated audited reveal endpoint (fail-closed by design)
- **First-pass claim:** DPDP / financial-data exposure: PAN, phone, email and the full bank Account No are printed in clear text (page.tsx) to any module user; nothing is masked, gated by role, or audited on view.
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx renders PAN (l.70-75), Email (82-87), Phone (88-93) and bank Account No (118-123) as plain text in an RSC, so unmasked values are in the HTML for every user who passes ModuleGate (procurement/layout.tsx; tenant-level only, no role check). No shared <Masked> display component exists (only a local MaskedInput in hr/employees/new/steps/Step4.tsx:22, an input). No view audit: procurement-service is absent from the snapshot, so server-side view logging is cannot-verify. 'CSV export' in the fix text does not apply to this page (no export here).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx: props {value, kind:'pan'|'phone'|'email'|'account', canReveal:boolean, onReveal?}; default shows last-4 (e.g. XXXXXX1234F / ******7890 / a***@x.com); export from ds/index.ts.
  2. In [id]/page.tsx resolve canReveal from the session role claim (use the existing auth/session helper the app already uses for role claims; do not invent a new one) and wrap PAN, email, phone and Account No in <Masked>.
  3. Do the masking on the server: pass only the masked string to the client when canReveal is false so the raw value is not in the RSC payload.
  4. Reveal action: small client button calling a new audited endpoint (backend) e.g. POST /v1/procurement/vendors/:id/reveal {field}; show value for the session only and emit an audit event.
  5. Keep GSTIN and IFSC visible (public/business identifiers).
- **Acceptance:**
  - Component test: Masked renders last-4 for each kind and never emits the raw value in DOM when canReveal=false.
  - Manual: log in as a role without reveal permission, open /procurement/vendors/<id>; view-source shows masked PAN/phone/email/account.
  - Manual: authorised role clicks Reveal; value shows and an audit event exists.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Officers verifying payment details lose one-click access; must keep a role that can reveal so payments are not blocked. Audit endpoint is a backend dependency (cannot-verify).
- **Depends on:** Masked (new shared component)

### GAP-PROCUREMENT-VENDORS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** KYC "Verified At" prints String(kycVerifiedAt).slice(0,10) (page.tsx) — an ISO date, not the Indian format used elsewhere; KYC Status is capitalised from the raw string (page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx:103 prints String(vendor.kycVerifiedAt).slice(0,10) (raw ISO yyyy-mm-dd, and a non-ISO string would be truncated arbitrarily). l.97 builds the KYC label with charAt(0).toUpperCase()+slice(1), so a value like 'in_progress' shows 'In_progress'. lib/formatters.ts has formatIndianDate (dd/MM/yyyy en-IN, returns '—' for empty) already used by revenue screens; no dd-Mon-yyyy/IST helper exists there.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace l.103 with formatIndianDate(vendor.kycVerifiedAt) imported from '@/lib/formatters' (app convention dd/MM/yyyy; if dd Mon yyyy IST is wanted, add formatIndianDateIST to formatters.ts and use it repo-wide).
  2. Add a KYC_LABELS map (verified, pending, rejected, expired ...) like EMPANELMENT_LABELS and fall back to replacing '_' with ' ' and title-casing.
  3. Use the same label map for the StatusPill label at l.97.
- **Acceptance:**
  - Unit test formatIndianDate('2026-03-05T18:40:00Z') renders the expected en-IN date.
  - Render test: kycStatus='in_progress' shows 'In progress'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.

### GAP-PROCUREMENT-VENDORS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FEATURE (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Profile has no history: orders, GRN acceptances, contracts, EMD/BG or empanelment expiry for the vendor are not shown, so an officer cannot judge the record without opening five other screens.
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx renders only two cards: Vendor details (l.50-113) and Bank details (115-132) plus a 'View scorecard' link (l.44). VendorDetail (apiMappers.ts:126-159, 270-283) has no orders, GRN, contract, EMD/BG or empanelment-expiry field. Sibling lists exist (orders, grn, contracts, emd-bg, empanelment pages) but whether their list APIs accept a vendorId filter cannot be verified (procurement-service absent).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/procurement/vendors/[id]/VendorHistoryTabs.tsx (new)`
- **Fix steps:**
  1. Backend first: confirm/add vendorId filter on /procurement/orders, /grns, /contracts, /emd-bg and an empanelment validity date on the vendor payload.
  2. Add loaders (getProcurementOrders/GRNs/contracts with {vendorId}) in loaders.ts; extend mapProcurementVendorDetail with empanelmentValidTill.
  3. Create client VendorHistoryTabs.tsx (Tabs + DataTable, existing ds components) with tabs Orders, GRNs, Contracts, EMD/BG; each with its own empty/error state (see RefreshErrorState).
  4. Add an 'Empanelment valid till' field to the details card with an expiry warning pill when < 30 days.
  5. Fetch tabs in Promise.all in page.tsx; failures must show per-tab error, not empty.
- **Acceptance:**
  - Vendor with 2 POs shows both in Orders tab with links to /procurement/orders/<id>.
  - Vendor with expired empanelment shows an Expired pill.
  - Simulated GRN fetch failure shows an error state, not 'No GRNs'.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Feature add; low regression risk, medium effort due to filter support on 4 endpoints.
- **Depends on:** GAP-PROCUREMENT-VENDORS-01

### GAP-PROCUREMENT-VENDORS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme CONSISTENCY (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Rating pill duplicates the scorecard on a /5 scale while the scorecard uses /100; empanelment status appears twice (header pill and details card).
- **Verified evidence:** apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx:41-43 shows a rating pill '{rating}/5'; scorecard/page.tsx:116 shows 'Overall score ... /100' from overallRating, so two scales. Empanelment status is rendered twice: header StatusPill (l.40) and details card (l.60-63). Nothing to do with form validation (theme wrong).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`, `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`
- **Fix steps:**
  1. Decide one scale (recommend /100 band from the scorecard) and derive the pill from scorecard overallRating/ratingBand, or relabel this one 'Buyer rating n/5' if they are genuinely different inputs (needs product decision).
  2. Remove the duplicate Empanelment field from the details card (l.60-63) or from the header actions.
  3. Apply the same scale in VendorsTable.tsx:227.
- **Acceptance:**
  - Detail and list show the same rating scale as the scorecard.
  - Empanelment appears once on the detail page.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; only labelling, but confirm what rating (0-5) actually represents before removing.
- **Depends on:** GAP-PROCUREMENT-VENDORS-05


---
## /procurement/vendors/[id]/scorecard  —  `procurement/vendors-detail-scorecard.html`

- **Source:** `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`
- **Design reference:** `redesign/procurement/vendors-detail-scorecard.html`

### GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Failure looks like "no data": a failed scorecard request returns null and renders "No scorecard yet — Performance data will appear after GRN acceptance…" (page.tsx); the error badge exists only in the filled branch (page.tsx), so an outage tells a vendor-manager the vendor has no history.
- **Verified evidence:** scorecard/page.tsx:81-87 returns EmptyState 'No scorecard yet' whenever scorecard is null, without looking at source. fetchJson (apiClient.ts) returns {data: null, source:'error'} on failure, so an outage renders the empty state. The DataSourceBadge at :109 sits in the non-null branch where source==='error' cannot occur with data present, so it is effectively dead code.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`, `apps/web/src/app/_components/ds/RefreshErrorState.tsx`
- **Fix steps:**
  1. In the `!scorecard` branch: if source==='error' render ErrorState/RefreshErrorState (toHumanError('load',{area:'vendor scorecard'})) with retry; only otherwise show EmptyState.
  2. Distinguish 404 (no scorecard) via result.status if available.
  3. Remove the dead DataSourceBadge at line 109.
- **Acceptance:**
  - Mock loader source 'error' -> error state, no 'No scorecard yet' text.
  - Mock 200 with data null -> empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-02  ·  HIGH  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** The two-column layout is fixed `gridTemplateColumns: "1fr 1fr"` inline (page.tsx) with no breakpoint, so on a phone the breakdown and 240 px radar are squeezed side by side; score bars and chart colours are hard-coded var(--good/warn/bad) instead of the chart palette.
- **Verified evidence:** scorecard/page.tsx:130 has gridTemplateColumns:'1fr 1fr' inline with no breakpoint (the stat grid above at :114 does use auto-fill), so the two cards stay side by side on phones; the radar SVG is maxWidth 240 (line 51). Colours are CSS design tokens (var(--good/--warn/--bad)), not hard-coded hex, so that claim is overstated. Theme PII is wrong; severity high is overstated (layout only).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`
- **Fix steps:**
  1. Change line 130 to repeat(auto-fit,minmax(min(100%,280px),1fr)).
  2. Optional: move band/score colours to a shared chart-palette helper if one is adopted.
- **Acceptance:**
  - At 375px width the two cards stack with no horizontal scroll.
  - At 1200px they remain two columns.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Band legend + note that /100 performance score is separate from /5 buyer rating added; no single scale or shared formatVendorRating helper. Legend uses excellent/good/average/poor (>=90/75/50) but API ratingBand is A/B/C/D (>=85/70/50, scorecard-domain.ts) so legend and BAND_COLOR keys do not match backend.
- **First-pass claim:** Scale mismatch: the scorecard shows "Overall score 86/100" (page.tsx) but the vendor list and profile show rating "n/5" (VendorsTable.tsx, vendors/[id]/page.tsx); ratingBand is server-supplied and not derived from the visible scores, and the thresholds (excellent/good/average/poor) are not explained.
- **Verified evidence:** scorecard/page.tsx:116 shows overallRating + '/100'; vendors/[id]/page.tsx:42 and VendorsTable.tsx:55 show rating as n/5. Both come from the API (VendorScorecard.overallRating loaders.ts:5502-5514, vendor.rating), so two scales for one vendor. ratingBand is taken from the server (:96, :107), bands not explained on the page. Whether the server derives band from score is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`, `apps/web/src/app/(app)/procurement/vendors/[id]/page.tsx`, `apps/web/src/app/(app)/procurement/vendors/VendorsTable.tsx`
- **Fix steps:**
  1. Decision: pick one scale (e.g. score out of 100 everywhere, or stars derived as score/20) and one source of truth.
  2. Add a shared formatVendorRating helper used by all three files.
  3. Add band legend text (e.g. Excellent >= 90, Good 75-89 ...) once thresholds are confirmed with backend, or derive band client-side from the score.
- **Acceptance:**
  - Vendor with overallRating 86 shows the same figure/scale on list, profile and scorecard.
  - Legend shows thresholds matching the backend.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium: vendor empanelment decisions may rely on the rating.

### GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-04  ·  MEDIUM  ·  partly  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — 'As of' added to subtitle but reads scorecard.lastUpdated while API returns computedAt (not mapped), so it always shows a dash; 3-axis radar still kept.
- **First-pass claim:** Radar with exactly three axes is a triangle that adds nothing over the three bars beside it (RadarChart, page.tsx; returns null under 3); lastUpdated is fetched (loaders.ts:5512) but never shown, so the score has no as-of date.
- **Verified evidence:** subscores in scorecard/page.tsx:90-94 always has exactly 3 items (Delivery/Quality/SLA), so RadarChart (29-31) always draws a triangle duplicating the ScoreBars: confirmed as low-value. lastUpdated is typed at loaders.ts:5512 (string|null) but never referenced in the page or vendors folder: confirmed, no as-of date. Severity medium is slightly high.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Render 'As of {formatIndianDate(scorecard.lastUpdated)}' in the PageHeader subtitle (or '—' if null).
  2. Replace the radar with a trend/sparkline or drop the card and give the breakdown full width; keep the sr-only table if a chart remains.
- **Acceptance:**
  - Scorecard shows 'As of 12 Sep 2026'.
  - Layout has no empty right-hand card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Null subscores/counts show a dash with grey bar and radar skips nulls; 'On-time X + Late Y of Z orders' reconciliation caption not added.
- **First-pass claim:** Missing sub-scores are coerced with ?? 0 (page.tsx) — an unscored dimension renders as a red 0 rather than "—"; on-time / late do not visibly add to total orders.
- **Verified evidence:** scorecard/page.tsx:91-93 use `?? 0` for delivery/quality/SLA scores; :116 and :118-121 use `?? 0` for overall and counts, so an unscored dimension renders as red 0 (ScoreBar color at :15 -> var(--bad)). totalOrders and on-time/late/rejections are shown as independent tiles without reconciliation. The loader type says number, so nulls depend on the API (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/[id]/scorecard/page.tsx`
- **Fix steps:**
  1. Make subscore value `number | null`; in ScoreBar show '—' and a neutral grey bar when null; skip null axes in the radar.
  2. Remove `?? 0` for displayed counts; show '—' when null.
  3. Add a caption 'On-time X + Late Y of Z orders' computed from values, flagging mismatch.
- **Acceptance:**
  - Scorecard with slaScore null shows '—' with a grey bar, not red 0.
  - On-time+late tile text shows 'of N orders'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /procurement/vendors/new  —  `procurement/vendors-new.html`

- **Source:** `apps/web/src/app/(app)/procurement/vendors/new/page.tsx`
- **Design reference:** `redesign/procurement/vendors-new.html`

### GAP-PROCUREMENT-VENDORS-NEW-01  ·  HIGH  ·  partly  ·  theme WIRING (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Web form now has category, contact person, address, account no + confirm, IFSC/account coupling. BUT procurement-service createVendorBody accepts only name,gstin,pan,email,phone,mse,msme,udyamNo,bankAccount,ifsc; web posts bankAccountNo/category/contactPerson/address which zod strips and vendor consumer never persists, so bank account number and category are silently dropped.
- **First-pass claim:** Registration captures only name, GSTIN, PAN, email, phone and IFSC (Form), but the profile and directory display category, contact person, address, KYC status and bank account number (vendors/[id]/page.tsx, VendorsTable.tsx): a vendor can never be given a category or a bank account from the UI, so registered vendors appear with empty profiles and an unusable payment record.
- **Verified evidence:** Confirmed: apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx state l.303-308 and POST body l.339-346 carry only name, gstin, pan, email, phone, ifsc. No category, contactPerson, address or bank account number. Overstated: the mapper defaults category to 'General' (apiMappers.ts:135), so profiles are not blank, and KYC is presumably server-set. The bank record is genuinely unusable: an IFSC with no account number (detail page shows Account No only when present, page.tsx:115-123). Whether the create API accepts category/address/bankAccount is cannot-verify (procurement-service absent), though the GET mapper reads bankAccount/bankAccountNo/address/category/contactPerson.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx`, `apps/web/src/app/(app)/procurement/_components/validators.ts`
- **Fix steps:**
  1. Backend: confirm create schema fields (category, contactPerson, address, bankAccount, ifsc) and add any missing.
  2. Add form fields: Category (select from the same category list used by tenders/indents), Contact person, Address (textarea), Account number + Confirm account number (masked input, digits 9-18).
  3. Add validateAccountNo to validators.ts and require account number whenever IFSC is entered (and vice versa).
  4. Send the new fields in the POST body; keep account number out of console/logs.
- **Acceptance:**
  - Submitting IFSC without account no shows a field error.
  - Registered vendor shows chosen category and contact person on /procurement/vendors/<id>.
  - Account numbers not matching blocks submit.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Bank details drive payments; wrong account entry is a money risk, so confirm-entry and later penny-drop verification matter.
- **Depends on:** GAP-PROCUREMENT-VENDORS-NEW-05, GAP-PROCUREMENT-VENDORS-DETAIL-01

### GAP-PROCUREMENT-VENDORS-NEW-02  ·  HIGH  ·  partly  ·  theme VALIDATION (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Client GSTIN checksum + state code + GSTIN-PAN match done (validators.ts). Remaining: server-side unique (tenant,gstin/pan) with 409 and duplicate lookup/link not implemented.
- **First-pass claim:** Validation is format-only (validators.ts): GSTIN checksum, state code and GSTIN-to-PAN consistency (characters 3–12 of GSTIN are the PAN) are not checked, and there is no duplicate check — the same GSTIN or PAN can be registered twice with slightly different names.
- **Verified evidence:** apps/web/src/app/(app)/procurement/_components/validators.ts:3-12 validates GSTIN by regex only (no checksum, state-code range or PAN match); PAN by regex (l.4). RegisterVendorForm.tsx:316-317 does no cross-check between gstin[2:12] and pan. No client duplicate check exists. Server-side uniqueness on GSTIN/PAN cannot be verified (procurement-service absent), so the 'same GSTIN twice' outcome is unproven.
- **Files to change:** `apps/web/src/app/(app)/procurement/_components/validators.ts`, `apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx`, `procurement-service vendor create (backend, not in snapshot)`
- **Fix steps:**
  1. In validators.ts implement GSTIN mod-36 checksum on char 15, state code 01-38 (+97/99), and export validateGstinPanMatch(gstin, pan).
  2. In RegisterVendorForm validate(): call the match validator when both are present and show an error on the PAN field.
  3. Backend: add unique index (tenantId, gstin) and (tenantId, pan) and return 409 with a code; map to a field message in the form.
  4. Optionally add on-blur GET /procurement/vendors?gstin= duplicate lookup with a link to the existing vendor.
- **Acceptance:**
  - Unit tests: valid GSTIN passes; one flipped check digit fails; mismatched PAN fails.
  - Registering an existing GSTIN shows 'Vendor already registered' with a link.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Rejecting legacy real GSTINs wrongly would block registration; test checksum against known-good samples.

### GAP-PROCUREMENT-VENDORS-NEW-03  ·  MEDIUM  ·  partly  ·  theme COPY (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: PAN, phone and email of individual proprietors are collected with no purpose or notice text; "Vendor registration accepted." then an immediate redirect (Form) means the confirmation is never seen and the new vendor's empanelment status ("not empanelled" or "provisional") is not stated.
- **Verified evidence:** Confirmed: no purpose/notice text anywhere in RegisterVendorForm.tsx. l.355 sets 'Vendor registration accepted.' then l.356 router.push() immediately, so the message is never seen. New vendor empanelment status is not stated. Additional risk: mapProcurementVendorDetails (apiMappers.ts:136-141) maps a missing/'registered' status to 'empanelled', so a fresh vendor may display as Empanelled unless the API returns an explicit status. Actual API default is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/procurement/vendors/new/page.tsx`
- **Fix steps:**
  1. Add a short DPDP notice under the form title: purpose (vendor onboarding, payment, statutory reporting), retention, contact for grievance; link to privacy policy.
  2. After success push to /procurement/vendors/<newId>?registered=1 (use id from the POST response) and show a banner there: 'Registered. Status: Not empanelled - complete KYC and empanelment before ordering.'
  3. Change apiMappers.ts:140 so 'registered' maps to not_empanelled (or a new 'registered' state), not empanelled.
  4. Show the initial status in the confirmation.
- **Acceptance:**
  - After submit the user lands on the vendor profile with a visible confirmation and status.
  - Vendor with status 'registered' does not show Empanelled pill.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Mapping change alters status pills on existing rows; check dashboards counting empanelled.
- **Depends on:** GAP-PROCUREMENT-VENDORS-01

### GAP-PROCUREMENT-VENDORS-NEW-04  ·  MEDIUM  ·  partly  ·  theme DARKMODE (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — Inline white backgrounds and hard-coded colours removed. Remaining: no optional KYC document upload (FileUpload) and no GSTN/PAN verification or not-verified label.
- **First-pass claim:** Inline backgrounds (#fff) on every field wrapper (Form) break dark mode; no GST-portal or PAN verification, no attachment of registration documents or KYC.
- **Verified evidence:** Confirmed: every field wrapper has style background '#fff' (apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx l.375,381,389,397,404,412) and hard-coded #b91c1c/#047857 (l.366,423). I did not render dark mode to prove breakage, but a white wrapper with themed text tokens is the likely failure. Also confirmed: no GST/PAN verification call and no document/KYC attachment (an existing FileUpload component is at app/_components/FileUpload.tsx). Backend verification integrations cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx`, `apps/web/src/app/_components/FileUpload.tsx`
- **Fix steps:**
  1. Remove the inline background and padding on the .field divs (l.375-412) so the .field class/tokens style them; replace hard-coded colours with var(--bad)/var(--good).
  2. Add an optional documents section using FileUpload (GST certificate, PAN card, cancelled cheque) posting to the existing upload path (confirm with backend).
  3. Backend/decision: GSTN/PAN verification service integration; until then label fields 'not verified'.
- **Acceptance:**
  - Toggle dark mode: form fields have theme background and readable labels.
  - Uploaded documents are attached to the vendor record.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Attachments hold PII; need storage ACL and audit. Dark mode fix is zero risk.

### GAP-PROCUREMENT-VENDORS-NEW-05  ·  LOW  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Phone validator accepts exactly 10 digits (validators.ts) — no +91, landline or STD formats; IFSC accepted without an account number.
- **Verified evidence:** validators.ts:7 PHONE_RE = /^[0-9]{10}$/ so +91, 0-prefix, landline/STD are rejected (validatePhone l.29-32); form placeholder says '10-digit number'. IFSC (RegisterVendorForm.tsx l.412-419) has no account-number counterpart; validateIfsc is standalone. Not a PII masking matter.
- **Files to change:** `apps/web/src/app/(app)/procurement/_components/validators.ts`, `apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx`
- **Fix steps:**
  1. Normalise input: strip spaces/hyphens, a leading +91/91/0, then require [6-9]\d{9} for mobile; add optional landline pattern (STD 2-4 digits + 6-8 digits) if wanted.
  2. Store the normalised 10-digit value; update placeholder/error copy.
  3. Couple IFSC with account number (see NEW-01) in validate().
- **Acceptance:**
  - '+91 98765 43210' is accepted and stored as 9876543210.
  - '12345' rejected.
  - IFSC without account no. rejected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Other forms import the same validators (PO/contract forms); regression-test them.
- **Depends on:** GAP-PROCUREMENT-VENDORS-NEW-01


---
## Backend verification items (service code absent from snapshot)

### GAP-PROCUREMENT-APPROVALS-ESCALATION-01  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Thresholds are hard-coded in the page (ESCALATION_ROWS, page.tsx:13-17) while real routing lives in the workflow service (page.tsx:25-28): the reference can silently drift from actual behaviour, and per-tenant delegation of powers cannot differ. Workflow service is not in the snapshot — the true thresholds are undeterminable.
- **Service:** `workflow-service`  ·  **Endpoint(s):** `['(none; ESCALATION_ROWS hard-coded in page)', 'approval routing config']`
- **Question:** Do the workflow-service procurement approval thresholds and escalation times equal ESCALATION_ROWS, and are they per-tenant configurable?
- **How to verify:** Open the workflow routing config for procurement approvals and diff against escalation/page.tsx:13-17.
- **Test to add:** Given seeded workflow, when comparing thresholds to page rows, then every band and authority matches (snapshot test).
- **Impact if wrong:** Reference misstates delegation of financial powers.
- **Web change if wrong:** Fetch rows from workflow-service instead of constants.

### GAP-PROCUREMENT-BID-EVALUATION-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/bid-evaluations is not in the snapshot (services/procurement-service absent): scoring rules, who may see financial scores before technical opening (GFR sealed-bid discipline), and audit are undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/bid-evaluations']`
- **Question:** Financial scores must be withheld until technical evaluation is complete and opened (sealed-bid), and reads audited; role-limited to evaluation committee.
- **How to verify:** Open the bid-evaluations handler; check status gating of financial fields. curl as evaluator before technical opening expecting financial fields absent.
- **Test to add:** Given tender in TECHNICAL stage, when GET bid-evaluations, then financialScore is null.
- **Impact if wrong:** Bid-rigging exposure, GFR breach.
- **Web change if wrong:** Render financial columns only if the API returns them.

### GAP-PROCUREMENT-CONTRACTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — contract-service list is tenant-scoped, role-limited and returns poRef (full row). Remaining: web contracts page has no PO column/link.
- **First-pass claim:** Data comes from /api/v1/contract/contracts (contract service), not /procurement — contract-to-PO linkage (poRef) and audit are undeterminable; contract service is not in the snapshot.
- **Service:** `contract-service`  ·  **Endpoint(s):** `['GET /api/v1/contract/contracts']`
- **Question:** Does the list return poRef and is it tenant-scoped and role-limited?
- **How to verify:** Open contract-service list route; inspect response fields and guard.
- **Test to add:** Given tenant A/B contracts, when tenant A lists, then only A rows including poRef.
- **Impact if wrong:** Cross-tenant leak; missing PO linkage.
- **Web change if wrong:** Add PO column/link if poRef returned.

### GAP-PROCUREMENT-CONTRACTS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1928 — Audit event and duplicate contractNo 409 (DUPLICATE_NUMBER) done. Remaining: poRef is optional free text, not validated against an existing PO.
- **First-pass claim:** Mutation goes to the contract service (/v1/contract/contracts, Form:65) while vendors come from procurement; audit trail, uniqueness and PO linkage (poRef) cannot be determined — services absent from snapshot.
- **Service:** `contract-service`  ·  **Endpoint(s):** `['POST /api/v1/contract/contracts']`
- **Question:** Contract create must emit audit, enforce unique contract number per tenant, and validate poRef against an existing PO (by API, not FK).
- **How to verify:** Open contract-service create handler; POST duplicate number and unknown poRef.
- **Test to add:** Given existing contract C-1, when POST C-1 again, then 409; unknown poRef then 422.
- **Impact if wrong:** Duplicate or unlinked contracts.
- **Web change if wrong:** Surface 409/422 messages on the form.

### GAP-PROCUREMENT-DASHBOARD-02  ·  MEDIUM  ·  partly  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Counters are not actionable: "Pending Indents" and "Contract Renewals Due" are not links, and the dashboard has no value or aging figures — a "snapshot of pending actions" that cannot be acted on (page.tsx:42-45).
- **Service:** ``  ·  **Endpoint(s):** `['GET /api/v1/procurement/dashboard']`
- **Question:** Web-only: counters are plain StatCards and the API returns no value/aging.
- **How to verify:** Read dashboard/page.tsx:42-45.
- **Test to add:** Given dashboard data, when rendered, then Pending Indents links to /procurement/indents?status=pending.
- **Impact if wrong:** Low usability: users cannot act from counters.
- **Web change if wrong:** Wrap counters in Links; add value/aging only if the API supplies them.
- **Finding:** apps/web/.../procurement/dashboard/page.tsx:42-45 StatCards have no href

### GAP-PROCUREMENT-DASHBOARD-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1866 — grnsThisMonth defined as ACCEPTED GRNs in IST calendar month. Remaining: contractRenewalsDue is hard-coded 0 (dashboard/queries.ts:66, contract data lives in another service) so the card shows a false zero; no window defined or labelled.
- **First-pass claim:** GET /procurement/dashboard is not in the snapshot; the definition of "GRNs (MTD)" and "renewals due" window is undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/dashboard']`
- **Question:** Define grnsThisMonth (calendar month in tenant timezone, accepted GRNs only?) and the contractRenewalsDue window (e.g. 90 days).
- **How to verify:** Open dashboard query in procurement-service; read date filters and status conditions.
- **Test to add:** Given GRNs on the 31st and 1st in IST, when dashboard, then month boundary uses tenant timezone.
- **Impact if wrong:** Misleading KPIs.
- **Web change if wrong:** Label the window in the card sublabel.

### GAP-PROCUREMENT-EMD-BG-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — emd/pbg forfeit/release/refund are role-gated (procurement roles, not finance-only), audited, and post GL entries. Remaining: no PFMS/treasury reference captured or shown.
- **First-pass claim:** /procurement/emd and /pbg are not in the snapshot: forfeiture workflow, PFMS/treasury linkage and audit undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/emd', 'GET /api/v1/procurement/pbg']`
- **Question:** Forfeiture/release transitions must be role-guarded, audited, and linked to PFMS/treasury refs.
- **How to verify:** Open emd/pbg routes and state machine; try release as non-finance role.
- **Test to add:** Given an EMD, when a non-finance user forfeits, then 403 and audit records actor otherwise.
- **Impact if wrong:** Improper release or forfeiture of security deposits.
- **Web change if wrong:** Show treasury ref column if returned.

### GAP-PROCUREMENT-EMPANELMENT-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — Empanel endpoint role-guarded and blacklisted vendors blocked from empanelment/PO. Remaining: empanelment validUntil is not enforced at PO creation (no expired-empanelment rejection).
- **First-pass claim:** /procurement/empanelment is not in the snapshot: category master, validity rules and who may empanel undeterminable; overlaps with /procurement/vendors (vendor register) with no cross-link.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/empanelment']`
- **Question:** Category master, validity dates and who may empanel must be enforced server-side and consistent with vendor register.
- **How to verify:** Open empanelment route/schema; check validTo enforcement and role guard.
- **Test to add:** Given expired empanelment, when a PO is raised for vendor, then rejected.
- **Impact if wrong:** Purchases from unempanelled vendors.
- **Web change if wrong:** Add cross-link to /procurement/vendors.

### GAP-PROCUREMENT-GEM-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** /procurement/gem/items is not in the snapshot: how GeM data is imported (API, manual upload) and its authenticity checks are undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/gem/items']`
- **Question:** GeM item data import path and authenticity (source, checksum, imported-by) must be recorded.
- **How to verify:** Open gem/items route and import job; check source metadata.
- **Test to add:** Given a manual upload, when listed, then source=manual and importedBy set.
- **Impact if wrong:** Unverified GeM prices used for purchase decisions.
- **Web change if wrong:** Show source column.

### GAP-PROCUREMENT-GRN-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — GRN list is tenant-scoped and role-limited, but there is no store/department assignment scoping (store A vs B).
- **First-pass claim:** GET /procurement/grns not in snapshot: visibility scoping per store / department undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/grns']`
- **Question:** List must be scoped by tenant and by user's store/department assignment.
- **How to verify:** Open list query; call as store user of store A.
- **Test to add:** Given GRNs in stores A/B, when store A user lists, then only A.
- **Impact if wrong:** Cross-department data visibility.
- **Web change if wrong:** none

### GAP-PROCUREMENT-GRN-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1111, verified on main 9c5e9e9e9)
- **First-pass claim:** PATCH /grns/:id/accept|reject and amend are not in the snapshot: audit entry, stock posting on accept, and SoD enforcement are undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['PATCH /api/v1/procurement/grns/:id/accept|reject', 'PATCH /api/v1/procurement/grns/:id']`
- **Question:** Accept/reject/amend must audit, post stock only on accept (once), and enforce SoD vs creator.
- **How to verify:** Open GRN handlers; accept twice; accept as creator.
- **Test to add:** Given accepted GRN, when accept again, then 409 and stock unchanged.
- **Impact if wrong:** Stock inflation or unaudited edits.
- **Web change if wrong:** Disable actions per returned status.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** PATCH /v1/inventory/srn/:id/sign, SoD (store officer vs GRN creator) and payment-gate consumer are not in the snapshot — undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['PATCH /api/v1/inventory/srn/:id/sign']`
- **Question:** Signer must differ from GRN creator (SoD) and must hold store_officer; signing releases the payment gate exactly once.
- **How to verify:** Open sign handler; sign as GRN creator expecting 403 SOD_VIOLATION.
- **Test to add:** Given GRN created by U1, when U1 signs SRN, then 403.
- **Impact if wrong:** Single person receives and certifies goods (fraud).
- **Web change if wrong:** Surface SoD error message.

### GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #644, verified on main 9c5e9e9e9)
- **First-pass claim:** inventory-service SRN endpoints absent from snapshot: idempotency (duplicate SRN per GRN), audit and payment-gate linkage undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['POST /api/v1/inventory/srn', 'PATCH /api/v1/inventory/srn/:id/sign']`
- **Question:** Only one SRN may exist per GRN (idempotent or 409) and creation/signing must be audited; the create+sign two-call flow must be atomic-safe.
- **How to verify:** Open inventory-service srn create; POST twice for same grnId.
- **Test to add:** Given GRN G1 with SRN, when POST second SRN for G1, then 409.
- **Impact if wrong:** Duplicate SRNs, double stock/payment release.
- **Web change if wrong:** Handle 409 by linking to existing SRN; avoid auto-sign on create.

### GAP-PROCUREMENT-GRN-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1111 — createdBy from authenticated actor, PO/vendor match 404/422, orderedQty re-derived server-side, accepted<=ordered. Remaining: receivedQty not capped against PO open qty (no cumulative over-receipt check).
- **First-pass claim:** POST /procurement/grns not in the snapshot: creator capture for SoD, stock impact and audit undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/v1/procurement/grns']`
- **Question:** createdBy must be captured from the JWT (not body) and received qty must not exceed PO open qty.
- **How to verify:** Open GRN create; POST with forged createdBy and over-qty.
- **Test to add:** Given PO open qty 10, when POST received 11, then 422; createdBy equals token subject.
- **Impact if wrong:** SoD bypass and over-receipt.
- **Web change if wrong:** none

### GAP-PROCUREMENT-INDENTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/indents (scoping per department / requester) not in snapshot — whether a clerk sees only own-department indents is undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/indents']`
- **Question:** Does the list handler filter indents by the caller's department/requester unless the caller holds a procurement-wide role?
- **How to verify:** Open the indents list route in procurement-service; call with a clerk token of dept A and expect only dept A indents, and a procurement_officer token expecting all.
- **Test to add:** Given indents in depts A and B, when a dept-A clerk GETs /indents, then only dept-A rows (and total) are returned.
- **Impact if wrong:** Cross-department disclosure of purchase demand; DPDP/least-privilege breach.
- **Web change if wrong:** Add a department/scope filter or note in the page header if server returns all.

### GAP-PROCUREMENT-INDENTS-DETAIL-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** GET /procurement/indents/:id and the shape of approvalTrail are not in the snapshot — completeness of the trail (actors, rejection reasons) undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/indents/:id']`
- **Question:** approvalTrail must include actor, action, timestamp and rejection reason for every step.
- **How to verify:** Open indent detail serializer; reject an indent with reason and GET.
- **Test to add:** Given rejected indent, when GET, then approvalTrail last entry has reason and actor.
- **Impact if wrong:** Incomplete audit trail.
- **Web change if wrong:** Render fields if present.

### GAP-PROCUREMENT-INDENTS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #60, verified on main 9c5e9e9e9)
- **First-pass claim:** POST /procurement/indents and /gfr/mode-bands (band thresholds) are not in the snapshot: maker-checker, audit and GFR band definitions undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/v1/procurement/indents', 'GET /api/v1/procurement/gfr/mode-bands?estimatedValueMinor=']`
- **Question:** Indent create must audit and enforce maker-checker; mode-bands must return GFR thresholds server-side and the server must re-derive procurement mode.
- **How to verify:** Open indents POST and gfr/mode-bands; POST with a mode inconsistent with value.
- **Test to add:** Given value above Rs 25 lakh, when POST mode=direct, then 422.
- **Impact if wrong:** Wrong procurement mode chosen, GFR breach.
- **Web change if wrong:** Trust server bands only.

### GAP-PROCUREMENT-ORDERS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #34, verified on main 9c5e9e9e9)
- **First-pass claim:** "+ New PO" is visible to every user (page.tsx:19) though creating and approving POs is a controlled action (maker-checker); no role hint or disabled state. Role list undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/pos', 'POST .../pos/:id/approve']`
- **Question:** Which roles may create and approve POs, and is approver != creator enforced?
- **How to verify:** Open role guards on the PO create/approve routes; call create with a viewer token expecting 403.
- **Test to add:** Given a user with only viewer role, when POST /pos, then 403 FORBIDDEN.
- **Impact if wrong:** Any user could raise purchase commitments.
- **Web change if wrong:** Hide or disable '+ New PO' unless the user has the create role.

### GAP-PROCUREMENT-ORDERS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/pos is not in the snapshot: scoping, PO number issuance and GeM-placed linkage undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/pos']`
- **Question:** Is the PO list tenant/department scoped, is poNo server-issued unique and sequential, and is the GeM-placed linkage returned as a field?
- **How to verify:** Open the list handler and PO number sequence; list as dept user and confirm scoping and presence of gemOrderRef.
- **Test to add:** Given POs across tenants, when listing, then only own-tenant rows are returned.
- **Impact if wrong:** Cross-tenant leakage; duplicate PO numbers.
- **Web change if wrong:** Add GeM ref column if returned.

### GAP-PROCUREMENT-ORDERS-DETAIL-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Dispatch is an irreversible vendor-facing command but the body is a fixed note "Dispatched from web UI" (DispatchPOActions.tsx); no field for dispatch note, mode or expected delivery, and no role gate — whether the API enforces maker-checker (creator ≠ dispatcher) is undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/pos/:id/dispatch']`
- **Question:** Does dispatch enforce a role gate and maker-checker (dispatcher != creator/approver), require an approved PO, and accept optional mode/note/expectedDelivery?
- **How to verify:** Open the dispatch handler; dispatch with the creator's token expecting 403, with a non-procurement role expecting 403, and on an unapproved PO expecting 409.
- **Test to add:** Given PO created by U and approved, when U dispatches, then 403 SOD_VIOLATION; when a different procurement_officer dispatches, then 200, status=dispatched and audit emitted.
- **Impact if wrong:** Irreversible vendor-facing commitment without separation of duties; GFR non-compliance.
- **Web change if wrong:** Add dispatch note/mode/expected-delivery fields and hide the action by role.

### GAP-PROCUREMENT-ORDERS-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/pos/:id, /pdf, dispatch and submit-approval are not in the snapshot (services/procurement-service absent): audit emission, state-machine and PDF content undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/pos/:id', 'GET /api/proxy/v1/procurement/pos/:id/pdf', 'POST .../pos/:id/dispatch', 'POST .../pos/:id/submit-approval']`
- **Question:** Do the PO state machine, PDF generation and submit/dispatch transitions enforce legal transitions and emit audit events?
- **How to verify:** Open the PO routes/domain; walk draft->pending_approval->approved->dispatched via curl, attempting illegal jumps (expect 409), and fetch the PDF checking PO number, vendor, lines and totals.
- **Test to add:** Given a draft PO, when dispatch is called, then 409; when submit-approval is called, then status pending_approval and audit event emitted.
- **Impact if wrong:** Invalid PO states and missing audit trail on purchase commitments.
- **Web change if wrong:** none

### GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** No status guard on the route: the link is hidden for non-amendable PO statuses on the detail page (orders/[id]/page.tsx) but typing the URL for a draft or cancelled PO renders the same form; server-side rejection is undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/pos/:id/amendments']`
- **Question:** Does POST amendments reject with 409/422 when the PO status is not an amendable one (draft, cancelled, closed)?
- **How to verify:** Open the PO amendment handler/state machine; POST an amendment on a draft and a cancelled PO with a valid token and expect 409 INVALID_STATE.
- **Test to add:** Given a cancelled PO, when POST /pos/:id/amendments, then 409 and no amendment row or audit event is created.
- **Impact if wrong:** Amendments to non-live POs corrupt commitments and vendor obligations.
- **Web change if wrong:** Web page should load the PO in a loader and redirect/notFound for non-amendable statuses.

### GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /pos/:id/amendments loader exists (loaders.ts:5638) but no route shows amendment history or status; approver and audit emission for POST /amendments are undeterminable (backend absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/pos/:id/amendments', 'POST /api/proxy/v1/procurement/pos/:id/amendments']`
- **Question:** Do POST amendments require a distinct approver (SoD), carry a status field, and emit an audit event?
- **How to verify:** Open the amendments route and schema; POST as creator then attempt approval as same user expecting 403; check the audit emit call and response fields.
- **Test to add:** Given an amendment created by user U, when U approves it, then 403 SOD_VIOLATION; when another approver approves, then status=approved and an audit event exists.
- **Impact if wrong:** Unapproved value changes to a binding vendor PO; audit gap.
- **Web change if wrong:** Add an amendment history/status panel to the PO detail page using the existing loader.

### GAP-PROCUREMENT-ORDERS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #34 — Blacklisted/debarred vendors rejected in PO consumer, poNo server-issued, audited. Remaining: no check that vendor is empanelled / empanelment valid.
- **First-pass claim:** POST /procurement/pos, vendor status validation and audit are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/pos']`
- **Question:** Does PO creation validate with zod, reject vendors not empanelled/blacklisted, issue the PO number server-side, and emit audit?
- **How to verify:** Open the POST /pos handler; create a PO for a blacklisted vendor expecting 422/409, and a valid one expecting a server-issued poNo and an audit event.
- **Test to add:** Given a blacklisted vendor, when POST /pos, then 422 VENDOR_NOT_ELIGIBLE and no row is written.
- **Impact if wrong:** Orders placed with debarred vendors; GFR violation.
- **Web change if wrong:** Filter vendor picker to eligible vendors and surface the server error text.

### GAP-PROCUREMENT-PLANNING-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/plans and who may see other departments plans are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/plans']`
- **Question:** Is the plans list scoped by department, and which roles may view other departments' plans?
- **How to verify:** Open the list handler; call with dept A user and confirm dept B plans are absent unless role is procurement/finance.
- **Test to add:** Given plans in depts A and B, when dept-A user lists, then only A plans returned.
- **Impact if wrong:** Cross-department disclosure of procurement intent.
- **Web change if wrong:** none

### GAP-PROCUREMENT-PLANNING-DETAIL-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** Approve and Reject are offered to every viewer of a pending plan (PlanLifecycleActions.tsx): no role gate, and the submitter (submittedBy is fetched, loaders.ts:5579) can approve their own plan from this page; the only protection would be server-side, which is undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/plans/:id/approve', 'POST .../plans/:id/reject']`
- **Question:** Does approve/reject require an approver role and reject when caller == submittedBy (SoD), and does it emit audit?
- **How to verify:** Open plan approve/reject handlers (planning/routes.ts); submit a plan as U then approve as U expecting 403 SOD_VIOLATION.
- **Test to add:** Given plan submitted by U, when U POSTs approve, then 403 and status stays pending; another approver gets 200 and an audit event.
- **Impact if wrong:** Self-approval of procurement plans; control failure in a high-risk area.
- **Web change if wrong:** Hide Approve/Reject for the submitter and for users without the approver role; show server error.

### GAP-PROCUREMENT-PLANNING-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** Plan state machine, SoD rule and audit events (planning/schema.ts, routes.ts cited in code comments) are not in the snapshot — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/plans/:id', 'POST .../plans/:id/submit|approve|reject']`
- **Question:** Does the plan state machine (draft->submitted->approved/rejected) reject illegal transitions and emit an audit event on each?
- **How to verify:** Open planning/schema.ts and routes.ts; attempt approve on a draft (expect 409) and check audit emits.
- **Test to add:** Given a draft plan, when approve is called, then 409 INVALID_STATE.
- **Impact if wrong:** Plans bypass review; no audit trail.
- **Web change if wrong:** none

### GAP-PROCUREMENT-PLANNING-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #149, verified on main 9c5e9e9e9)
- **First-pass claim:** POST /procurement/plans validation, plan number issue and audit are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/plans']`
- **Question:** Does plan creation zod-validate, issue planNo server-side and emit audit?
- **How to verify:** Open POST /plans handler; send invalid body expecting 422 with field errors and valid body expecting planNo and audit event.
- **Test to add:** Given an empty items array, when POST /plans, then 422.
- **Impact if wrong:** Malformed plans and untraceable creation.
- **Web change if wrong:** none

### GAP-PROCUREMENT-PRE-BID-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** Conference Date prints the API string as-is (Table) rather than through formatIndianDate used elsewhere in the module; Tender column shows whatever text the API sends (a tender id or name — undeterminable).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/pre-bid-conferences']`
- **Question:** Is the conference date returned as ISO 8601 and is the tender field a stable id plus display name?
- **How to verify:** Open the response schema; curl the endpoint and inspect conferenceDate and tender fields.
- **Test to add:** Given a conference, when listing, then conferenceDate matches ISO date-time and tenderNo/tenderTitle are separate fields.
- **Impact if wrong:** Wrong or ambiguous dates shown to bidders' officers.
- **Web change if wrong:** Format date with formatIndianDate and render tender as link with id+title.

### GAP-PROCUREMENT-PRE-BID-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/pre-bid-conferences is not in the snapshot (services/procurement-service absent): who can create conferences, and how queries link to tender clarifications, undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/pre-bid-conferences']`
- **Question:** Which roles may create conferences and how are bidder queries linked to tender clarifications?
- **How to verify:** Open the pre-bid routes and schema; POST as non-procurement role expecting 403; check queries foreign key to tender clarification.
- **Test to add:** Given a viewer token, when POST a conference, then 403.
- **Impact if wrong:** Unauthorised conferences; disconnected clarification record (transparency).
- **Web change if wrong:** none

### GAP-PROCUREMENT-REVERSE-AUCTION-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/reverse-auctions, bidder anonymity and auction rules (GFR/GeM) are not in the snapshot — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/reverse-auctions']`
- **Question:** Does the API mask bidder identities during a live auction and enforce GeM/GFR rules (decrement, timing)?
- **How to verify:** Open the auction handler; GET as buyer during live auction and confirm bidder names are anonymised (Bidder-1..n).
- **Test to add:** Given a live auction, when the buyer lists bids, then bidder identity fields are absent.
- **Impact if wrong:** Collusion risk; auction integrity.
- **Web change if wrong:** Never render bidder names for live auctions.

### GAP-PROCUREMENT-RFQ-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/rfqs and RFQ status set (draft/issued/closed/awarded) are undeterminable — services/procurement-service absent.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/rfqs']`
- **Question:** Is the RFQ status enum exactly draft/issued/closed/awarded and is it returned consistently?
- **How to verify:** Open the RFQ schema enum; curl list and compare status values to the web badge map.
- **Test to add:** Given each status, when listed, then the value is in the documented enum.
- **Impact if wrong:** Unmapped statuses render blank in UI.
- **Web change if wrong:** Update the status badge map.

### GAP-PROCUREMENT-RFQ-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/rfqs/:id and response confidentiality rules are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/rfqs/:id']`
- **Question:** Are vendor responses hidden until the RFQ closing time, and is access role-scoped?
- **How to verify:** Open the rfq detail handler; GET before closing time as buyer and expect no quoted prices.
- **Test to add:** Given an open RFQ before deadline, when GET :id, then responses array is empty/redacted.
- **Impact if wrong:** Premature price disclosure breaks fair procurement.
- **Web change if wrong:** none

### GAP-PROCUREMENT-RFQ-NEW-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** RFQ number is generated in the browser as RFQ/{year}/{random 100–999} (Form) — collision-prone and non-sequential; the RFQ carries no line items from this form, so how items reach the detail page is undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/rfqs']`
- **Question:** Does the server issue a unique sequential rfqNo (ignoring client value) and accept line items on create?
- **How to verify:** Open the POST /rfqs handler and its number sequence; POST twice with the same client rfqNo and expect distinct server numbers; check whether items are in the schema.
- **Test to add:** Given two concurrent creates, when both POST, then rfqNo values are unique and sequential.
- **Impact if wrong:** Duplicate RFQ numbers; missing items.
- **Web change if wrong:** Stop sending rfqNo from the browser; add an items section to the form if supported.

### GAP-PROCUREMENT-RFQ-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** POST /procurement/rfqs, vendor-notification side effects and audit are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/rfqs']`
- **Question:** Does RFQ creation validate, notify vendors only on issue, and emit audit?
- **How to verify:** Open the handler; create draft and confirm no notification, issue and confirm queue event and audit.
- **Test to add:** Given a draft RFQ, when created, then no vendor notification is enqueued.
- **Impact if wrong:** Vendors alerted prematurely; missing audit.
- **Web change if wrong:** none

### GAP-PROCUREMENT-TENDERS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/tenders and the tender status machine (draft → published → technical_evaluation → financial_evaluation → awarded per component comments) are not in the snapshot — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/tenders']`
- **Question:** Is the tender status enum draft/published/technical_evaluation/financial_evaluation/awarded exact and complete (cancelled?)?
- **How to verify:** Open the tender status enum; compare with the web status map.
- **Test to add:** Given each state, when listed, then value belongs to the documented enum.
- **Impact if wrong:** Unmapped status in list.
- **Web change if wrong:** Update status map for any extra states.

### GAP-PROCUREMENT-TENDERS-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** Tender state machine, sealed-bid encryption, L1 selection and PO generation (procurement-service tender/{routes,domain}.ts per code comments) are not in the snapshot — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/tenders/:id', 'POST .../tenders/:id/publish|technical-evaluation|open-financial|award']`
- **Question:** Does the tender state machine block illegal transitions, keep sealed bids encrypted until opening, select L1 correctly and generate the PO on award with audit?
- **How to verify:** Open tender/routes.ts and domain.ts; call open-financial on a draft expecting 409; GET before opening and confirm no financial bids in response.
- **Test to add:** Given a tender in technical_evaluation, when award is called, then 409; sealed price fields are absent before open-financial.
- **Impact if wrong:** Bid leakage, wrong award; legal challenge.
- **Web change if wrong:** none

### GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — Documents add/list role-gated and audited. Remaining: only a storageRef is registered; no size/type limits and no malware scan or quarantine anywhere in procurement-service.
- **First-pass claim:** Presigned upload/download service (admin uploads), malware scanning and the documents endpoints are not in the snapshot — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET/POST /api/proxy/v1/procurement/tenders/:id/documents', 'GET /api/proxy/v1/admin/uploads/:storageRef']`
- **Question:** Are uploads presigned with type/size limits, malware-scanned before availability, role-gated and audited?
- **How to verify:** Open the documents route and upload service; upload an EICAR file expecting rejection or quarantine, and a download by an unauthorised role expecting 403.
- **Test to add:** Given an EICAR test file, when uploaded to a tender, then it is quarantined and not downloadable.
- **Impact if wrong:** Malware or unauthorised access to tender documents.
- **Web change if wrong:** none

### GAP-PROCUREMENT-TENDERS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** POST /procurement/tenders, tender-number issue (tenderNo is server-side) and audit are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/tenders']`
- **Question:** Does the server issue tenderNo, validate dates (closing after publish) and emit audit?
- **How to verify:** Open the POST handler; send closing date in the past expecting 422 and check tenderNo issued.
- **Test to add:** Given closingDate < today, when POST, then 422.
- **Impact if wrong:** Invalid tenders or duplicate numbers.
- **Web change if wrong:** none

### GAP-PROCUREMENT-VENDORS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/vendors and who may change empanelment status are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/vendors', 'PATCH .../vendors/:id/status']`
- **Question:** Which roles may change empanelment status?
- **How to verify:** Open the status route role guard; call as clerk expecting 403.
- **Test to add:** Given clerk token, when changing vendor status, then 403.
- **Impact if wrong:** Unauthorised empanelment.
- **Web change if wrong:** none

### GAP-PROCUREMENT-VENDORS-DETAIL-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — PATCH empanel and blacklist exist, role-gated, blacklist requires reason (min 5) and is audited. Remaining: no suspend endpoint and no role-gated empanel/suspend/blacklist actions on the web vendor detail page.
- **First-pass claim:** Dead-end profile for a compliance record: no action to empanel, suspend or blacklist, refresh KYC or edit details, even though the list treats Blacklisted as a status (page.tsx) — how status changes at all is undeterminable from this route tree.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['PATCH/POST /api/v1/procurement/vendors/:id/(empanel|suspend|blacklist)', 'GET /api/v1/procurement/empanelment']`
- **Question:** Which endpoint changes vendor status, who may call it, does it require a reason and audit?
- **How to verify:** Search the vendors routes for status transition endpoints; call as officer and as viewer.
- **Test to add:** Given a viewer token, when blacklisting a vendor, then 403; given an authorised role, then status=blacklisted with reason and audit event.
- **Impact if wrong:** No controlled path to blacklist; compliance risk.
- **Web change if wrong:** Add role-gated empanel/suspend/blacklist actions with reason dialog if the endpoint exists.

### GAP-PROCUREMENT-VENDORS-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1866, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /procurement/vendors/:id and field-level access rules are not in the snapshot — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/vendors/:id']`
- **Question:** Are sensitive vendor fields (PAN, bank account, GSTIN) masked or role-limited?
- **How to verify:** Open the vendor serializer; GET as viewer and confirm bank/PAN are masked.
- **Test to add:** Given a viewer token, when GET vendor, then bankAccount is masked.
- **Impact if wrong:** PII/financial data exposure.
- **Web change if wrong:** Mask fields in the UI.

### GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** Score computation (GRN acceptance, order completion, SLA) and refresh cadence are not in the snapshot (services/procurement-service absent) — undeterminable.
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['GET /api/v1/procurement/vendors/:id/scorecard']`
- **Question:** How are the scores (GRN acceptance, completion, SLA) computed, and how often refreshed?
- **How to verify:** Open the scorecard service; compare with sample GRN/PO data by hand and note the job schedule.
- **Test to add:** Given 8 accepted of 10 GRNs, when scorecard computed, then acceptance=80.
- **Impact if wrong:** Vendors rated on wrong data.
- **Web change if wrong:** Show 'as of' timestamp if returned.

### GAP-PROCUREMENT-VENDORS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by main — Initial status is forced to registered (client status stripped) and creation is audited. Remaining: no PAN/GSTIN duplicate rejection (no unique index or 409).
- **First-pass claim:** POST /procurement/vendors, initial empanelment status and audit emission are undeterminable (services/procurement-service absent).
- **Service:** `procurement-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/procurement/vendors']`
- **Question:** Is initial empanelment status forced to pending regardless of client input, and is creation audited and de-duplicated on PAN/GSTIN?
- **How to verify:** Open the POST handler; POST status=empanelled expecting it ignored or 422; POST duplicate PAN expecting 409.
- **Test to add:** Given body status=empanelled, when POST, then stored status=pending.
- **Impact if wrong:** Bypass of empanelment check.
- **Web change if wrong:** none
