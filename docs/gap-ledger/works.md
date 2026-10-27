# Detailed gap file — module `works`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 164, BACKEND-VERIFY 36



---
## /works  —  `works/home.html`

- **Source:** `apps/web/src/app/(app)/works/page.tsx`
- **Design reference:** `redesign/works/home.html`

### GAP-WORKS-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed dashboard fetch renders five zeros (page.tsx:23,57-67) — only a small badge in the header separates "outage" from "no works"; StatCards should show "—" on error.
- **Verified evidence:** apps/web/src/app/(app)/works/page.tsx:20-29 defaults to zeros; apps/web/src/app/(app)/works/page.tsx:45 destructures source, but only :57 shows a DataSourceBadge in the header actions. StatCards (:61-65) print dash.totalWorks etc. as 0 on error. StatCard already renders null/undefined as '—' (ds/StatCard.tsx displayValue).
- **Files to change:** `apps/web/src/app/(app)/works/page.tsx`
- **Fix steps:**
  1. Add const failed = source==='error'.
  2. Pass failed ? null : value to all five StatCards (draftCount/pendingCount too).
  3. Keep the badge; add message 'Couldn't load dashboard figures'.
  4. Optional: RefreshErrorState banner above the grid with retry.
- **Acceptance:**
  - Component test: source 'error' -> five '—' values.
  - Component test: successful empty dashboard -> zeros.
  - Manual: stop API, hub shows dashes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-WORKS-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Module tiles use emoji icons and hard-coded English labels (page.tsx:31-40, 60-76) rather than next-intl keys and the DS icon set.
- **Verified evidence:** apps/web/src/app/(app)/works/page.tsx:31-40 MODULES holds hard-coded English label/desc and emoji icons; Quick Actions (:71-74) and titles (:55-56) are also hard-coded. next-intl getTranslations is used elsewhere (app/(app)/admin/page.tsx:25) but not in works. DS has lucide-based StatIcon (apps/web/src/app/_components/ds/StatIcon.tsx) and a ModuleHub/LinkTiles pair. The FABRICATED theme is wrong - nothing here is sample data.
- **Files to change:** `apps/web/src/app/(app)/works/page.tsx`, `apps/web/messages/en.json (locate actual messages file)`
- **Fix steps:**
  1. Locate the messages catalogue used by admin/page.tsx and add a 'works.hub' namespace.
  2. Use await getTranslations('works.hub') and replace label/desc/title/subtitle/quick-action strings with t() keys.
  3. Swap emojis for lucide icons via the StatIcon mapping (or ModuleHub/LinkTiles) so icons are aria-hidden and themeable.
  4. Add hi translations if the catalogue is bilingual.
- **Acceptance:**
  - Component test with hi locale renders translated labels.
  - Grep: no emoji literals in works/page.tsx.
  - Manual: tiles unchanged in en.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep hrefs unchanged.

### GAP-WORKS-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx paints 4 KPI blocks while the page renders 5 StatCards (loading.tsx:6, page.tsx:61-67) — layout jump on load.
- **Verified evidence:** apps/web/src/app/(app)/works/loading.tsx:6 maps [1,2,3,4] four KPI skeletons; apps/web/src/app/(app)/works/page.tsx:60-66 renders five StatCards. Also no skeleton for the module tile grid.
- **Files to change:** `apps/web/src/app/(app)/works/loading.tsx`
- **Fix steps:**
  1. Use five stat placeholders with StatGrid's grid class.
  2. Add a skeleton block for the 8-tile grid (auto-fill minmax 220px) instead of the single h-64 block.
- **Acceptance:**
  - Snapshot test: 5 placeholders.
  - Manual: no layout jump on load.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-WORKS-HOME-05  ·  LOW  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13: closed by #1867, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003; W1 SF-15 re-confirmed on #2011)
- **First-pass claim:** Tiles link to /works/masters and /works/reports without any role gate; hub does not mirror the works_operator role used in contractor pages (contractors/[id]/page.tsx:58).
- **Verified evidence:** apps/web/src/app/(app)/works/page.tsx:42-47 does gate the Quick Actions card with WORKS_ADMIN_ROLES, but the eight module tiles (:87-107), including /works/masters and /works/reports, are ungated; masters/page.tsx and its create form (apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx) do no role check (no getSessionRoles in masters or reports). WORKS_ADMIN_ROLES (works_admin, dao, do, super_admin, div_officer) omits works_operator and differs from PROPOSAL_WRITE_ROLES and CONTRACTOR_RATE_ROLES (apps/web/src/app/(app)/works/contractors/[id]/page.tsx:58-64), so role lists are duplicated and inconsistent. Server enforcement cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/page.tsx`, `apps/web/src/lib/auth/workRoles.ts`, `apps/web/src/app/(app)/works/masters/page.tsx`, `apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx`
- **Fix steps:**
  1. Move WORKS_ADMIN_ROLES and the contractor list into lib/auth/workRoles.ts as named exports and reuse in all works pages.
  2. Decide the role set allowed to see Masters (config) and Reports; add optional `roles` to MODULES entries and filter tiles by getSessionRoles().
  3. In masters/page.tsx pass canWrite to MasterCreateForm and hide the create button for others.
  4. Verify works-service guards on masters POST and reports endpoints.
- **Acceptance:**
  - Component test: role 'works_operator' sees the intended tile set.
  - Component test: read-only role sees Masters list without the Add button.
  - Backend check: masters POST returns 403 for non-admin.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Hiding tiles from a role that legitimately needs them is a regression; defense stays server-side.


---
## /works/approvals  —  `works/approvals.html`

- **Source:** `apps/web/src/app/(app)/works/approvals/page.tsx`
- **Design reference:** `redesign/works/approvals.html`

### GAP-WORKS-APPROVALS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; work number + officer name resolved web-side (loaders.ts getWorkNumberMap/getOfficerNameMap; approvals.loader.test.ts); columns relabelled Work Number / Authority) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** register rows now carry `workNumber` from works-service (approval routes stitch it from the proposal module with one batched, tenant-scoped getWorkHeaders read, no cross-module SQL join); the officer NAME comes from the tenant user directory (loaders.ts getOfficerNameMap -> lib/directory/resolveUsers, batched by id, so no 200-user cap). The old loader called GET /api/v1/identity/users which the gateway forwards to identity-service /v1/identity/users, a route that does not exist (the real list is /identity/users, ADMIN-gated); identity-service now also serves GET /v1/identity/users/directory (tenant-scoped, {id, displayName} only), the path every shared directory helper already used. Work Number links to /works/proposals/<id>; a row that could not be resolved reads "ID 3f9a1c20…" / "Unknown officer (aaaa1111…)" with the full id as a tooltip and exports the FULL id to the CSV; the approval number is now the first column (the row link to the detail page) so the work link is not nested in another link. Tests: approvals.loader.test.ts, ApprovalsTable.test.tsx, cluster01-route-validation.test.ts, users-directory.db.test.ts.
- **W0 note:** partly fixed by #1867 — No backend join for workNumber/authorityName (works-service approval list returns only ids); mapAaRow/mapTsRow prefer str(r.workNumber)/authorityName, fall back to shortId, columns relabelled "Work (ID)"/"Authority (ID)"; Work Number is not linked to the work.
- **First-pass claim:** Work Number and Authority columns show 8-char UUID prefixes ("3f9a1c20…") not the work number or officer name (_data/loaders.ts:168,171; ApprovalsTable.tsx:10,12) — register is unreadable for officers.
- **Verified evidence:** works/_data/loaders.ts:146-168 (mapAaRow) and mapTsRow set workNumber: shortId(workId) and authority: shortId(approvingAuthorityId|tsAuthorityId) -> '3f9a1c20…' (format.ts shortId). ApprovalsTable.tsx:7-8 columns 'Work Number'/'Authority' display those directly. The tenders loader shows the list API can supply r.workNumber (loaders.ts mapTenderRow uses str(r.workNumber)), but AA/TS mappers never read workNumber or any authority name, so whether the approvals API returns them is unverifiable (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/approvals/ApprovalsTable.tsx`, `services/works-service approvals list query (cannot see)`
- **Fix steps:**
  1. Check whether GET /works/approvals/aa|ts rows include workNumber/authorityName; if not, add them backend-side.
  2. In mapAaRow/mapTsRow use str(r.workNumber) || shortId(workId) and str(r.authorityName) || shortId(authorityId).
  3. Make Work Number a link to the work (add workId to row and render via DataTable column render if supported).
  4. Rename column fallback text so a bare hash is marked as 'ID'.
- **Acceptance:**
  - Row with workNumber 'WK/2026/001' shows it, not hash.
  - Row lacking name falls back to shortId with title tooltip of full id.
  - CSV export contains the readable values.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; display only. Wrong join mislabels authority.

### GAP-WORKS-APPROVALS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** "Pending" counts only status "draft" (page.tsx:15-16) but the finalize button also accepts "submitted" (ApprovalFinalizeButton.tsx:17) — submitted records are never counted as pending.
- **Verified evidence:** approvals/page.tsx:15-16 pendingAA/TS count only status==='draft'. ApprovalFinalizeButton.tsx:17 treats draft and submitted as finalizable. Records with status 'submitted' show a Finalize action yet are not counted as pending. Which statuses are 'pending' semantically is not defined in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/page.tsx`, `apps/web/src/app/(app)/works/approvals/ApprovalFinalizeButton.tsx`
- **Fix steps:**
  1. Export FINALIZABLE_STATUSES from a shared constants file (works/_data/format.ts or approvals/status.ts).
  2. Use it in page.tsx: pending = rows.filter(a => PENDING.has(a.status)).
  3. Confirm with product whether 'submitted' counts as pending.
- **Acceptance:**
  - Fixture with 1 draft + 1 submitted + 1 finalized gives Pending 2.
  - Button and count use the same constant.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; dashboard count only.
- **Depends on:** GAP-WORKS-APPROVALS-03

### GAP-WORKS-APPROVALS-03  ·  MEDIUM  ·  partly  ·  theme CONSISTENCY (was FABRICATED)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ApprovalsTable.test.tsx error-source with seeded rows and em-dash cases; closed by #1867)
- **First-pass claim:** StatCards use raw server arrays while the table uses useSeededResource cache (page.tsx:13-16 vs ApprovalsTable.tsx:31-49): counts and rows can disagree on cache fallback (UX-012 only fixed the badge).
- **Verified evidence:** approvals/page.tsx:13-16 compute counts from server arrays; ApprovalsTable.tsx:31-49 (actually :76-87) use useSeededResource which may substitute cached rows if source is error or empty. So counts can disagree with rows on cache fallback: real. Theme FABRICATED is wrong: nothing is hard-coded, the issue is dual sources. Also note: with source==='error' the stat cards show 0 while the table may show cached rows. Note page.tsx:12 collapses to 'api'/'error' from two loaders.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/page.tsx`, `apps/web/src/app/(app)/works/approvals/ApprovalsTable.tsx`
- **Fix steps:**
  1. Move StatGrid into a client component (or ApprovalsTable) that receives the useSeededResource data for both registers.
  2. Compute totals/pending from aaData/tsData there; keep Card/PageHeader in page.tsx.
  3. Show dashes instead of 0 when provenance is not live and no rows.
- **Acceptance:**
  - Simulate error source with cached rows: stat cards match table row counts.
  - Live source unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-APPROVALS-02

### GAP-WORKS-APPROVALS-04  ·  LOW  ·  partly  ·  theme A11Y (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Tab buttons use Tailwind classes bg-primary/bg-muted (ApprovalsTable.tsx:63,71) instead of the DS Tabs/Segmented component; no aria-controls/tabpanel.
- **Verified evidence:** ApprovalsTable.tsx:58-71 (observation said 63,71) hand-roll role=tablist/tab buttons with Tailwind classes bg-primary/bg-muted; ds/Tabs.tsx and ds/Segmented.tsx exist and are exported (ds/index.ts:14-15). Buttons lack id/aria-controls, no tabpanel wrapper, no arrow-key navigation. Tailwind classes are used elsewhere in the app per stack rules, so the class complaint is minor; a11y gap is real.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ApprovalsTable.tsx`
- **Fix steps:**
  1. Read ds/Tabs.tsx props and replace the two buttons with <Tabs> (or Segmented) bound to tab state.
  2. Wrap the DataTable in a role=tabpanel with aria-labelledby matching the active tab id.
  3. Ensure keyboard arrows switch tabs (provided by Tabs if implemented; add otherwise).
- **Acceptance:**
  - Test: role tablist has 2 tabs, active has aria-selected, panel labelled by it.
  - Arrow keys move focus/selection.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-APPROVALS-05  ·  LOW  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W2 works: closed by #2047; approvals/new/layout.tsx + approvals/ts-new/layout.tsx requireAnyRole(AA/TS_CREATE_ROLES) redirect direct-URL openers; approvals/layouts.test.tsx)
- **W0 note:** partly fixed by #1867 — New AA/TS links role-gated via AA_CREATE_ROLES/TS_CREATE_ROLES + hasAnyRole and use btn sm classes; no role guard/layout on approvals/new or ts-new so direct URL still opens the form (fix step 4 not done).
- **First-pass claim:** "+ New AA" / "+ New TS" use inline styles and mixed btn classes (page.tsx:31-32) and are not role-gated.
- **Verified evidence:** approvals/page.tsx:30-31 links with inline style (minHeight 36, padding) plus classes 'btn' / 'btn primary' rather than ds Button; not role-gated (no getSessionRoles/requireAnyRole anywhere under works/). Inline styles confirmed; but the link creation is only a navigation, and the server (unverified) enforces creation. Which roles may create AA/TS is unknown.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Replace inline styles with ds Button (asChild/href variant if present, otherwise shared .btn size class).
  2. Decision: define AA_CREATE_ROLES / TS_CREATE_ROLES.
  3. Add hasAnyRole helper in roleGuard.ts and hide the links (or render disabled with tooltip) when absent.
  4. Same route pages should call requireAnyRole in a layout so direct URL is also handled.
- **Acceptance:**
  - User without role sees no + New links; direct URL redirects to /dashboard.
  - Visual: both buttons same height as other page header actions.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong role list would lock out creators; no server change.
- **Depends on:** GAP-WORKS-APPROVALS-TS-DETAIL-04


---
## /works/approvals/aa/[id]  —  `works/approvals-aa-detail.html`

- **Source:** `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`
- **Design reference:** `redesign/works/approvals-aa-detail.html`

### GAP-WORKS-APPROVALS-AA-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: aa/[id]/page.test.tsx by-id fetch; GET /v1/works/approvals/aa/:id (approval/routes.ts); closed by #1867)
- **First-pass claim:** No GET-by-id: page fetches the first 100 records and filters by id (page.tsx:93-107); any record beyond row 100 is a permanent 404 even though it exists.
- **Verified evidence:** aa/[id]/page.tsx:93-107 fetches /api/v1/works/approvals/aa?pageSize=100 and .find(); comment at 93 admits there is no GET-by-id. Records past first 100 (or beyond server max page size) -> notFound(). Cannot verify server has GET /aa/:id (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`
- **Fix steps:**
  1. Ask works-service for GET /api/v1/works/approvals/aa/:id (zod response) and use fetchJson with it.
  2. Interim: search with an id filter query param if the list supports it; else paginate until found.
  3. Add unit test with 150 records.
- **Acceptance:**
  - Record #120 opens.
  - Unknown id returns 404 only after a definitive miss.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approval records unreachable by link - operational block.
- **Depends on:** GAP-WORKS-APPROVALS-AA-DETAIL-02

### GAP-WORKS-APPROVALS-AA-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: aa/[id]/page.test.tsx 404 vs load-error tests; closed by #1867)
- **First-pass claim:** Fetch failure is indistinguishable from a missing record — result.source is ignored and notFound() fires (page.tsx:107).
- **Verified evidence:** page.tsx:94-107: result.source is never checked; on error data is [] so find() fails and notFound() fires. Finalize actions unavailable and the user thinks the record is gone.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`
- **Fix steps:**
  1. After fetchJson, if result.source==='error' render RefreshErrorState with toHumanError('load',{area:'administrative approval'}) and back link.
  2. Call notFound() only when source==='api' and no match.
  3. Mirror tenant-admin/users/[id]/page.tsx:18-25.
- **Acceptance:**
  - Mock fetch error: error state with retry, not 404.
  - Real miss: 404.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-APPROVALS-AA-DETAIL-01

### GAP-WORKS-APPROVALS-AA-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; aa/[id]/page.tsx shows the work number linked to the proposal and the officer name; aa/[id]/page.test.tsx)
- **W0 note:** partly fixed by #1867 — Work is now a link to /works/billing/<workId> with full id in title, but still shows the truncated UUID as text; approving authority still shortId (no name lookup); workNumber/officer name not fetched.
- **First-pass claim:** Work ID and Approving Authority are shown as truncated UUIDs (page.tsx:112-113) with no link to the work or officer.
- **Verified evidence:** page.tsx:112-113 shows workId/approvingAuthorityId as slice(0,8)+'…' without links. Work names/officer names are not fetched. The apps/works _data/format.ts has shortId helper but that doesn't solve the readability issue.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`
- **Fix steps:**
  1. Render Work as Link to /works/<workId> using the work title (fetch by id via existing works loader) with fallback to shortId.
  2. Resolve approving authority name via a user/employee lookup loader; fallback to shortId with title=full id.
  3. Do not print truncated UUIDs as primary text.
- **Acceptance:**
  - Work row is a link showing work name.
  - Authority shows name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; extra fetches must tolerate failure.
- **Depends on:** GAP-WORKS-APPROVALS-NEW-01

### GAP-WORKS-APPROVALS-AA-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Finalize offered to every role and for "submitted" as well as "draft" (ApprovalFinalizeButton.tsx:17,95); no role note, so users without DAO/DO rights meet a server error only after confirming.
- **Verified evidence:** ApprovalFinalizeButton.tsx:17 FINALIZABLE_STATUSES = draft, submitted; button shown to any viewer (page.tsx:181 passes no role). It already has a ConfirmDialog (line ~140) with danger; description mentions irreversible. No role gate; server error only shown after confirm (fromResponse). lib/auth/roleGuard.ts and workRoles.ts exist but are not used here. Which roles the server permits (DAO/DO) cannot be verified. Allowing 'submitted' may be intentional.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ApprovalFinalizeButton.tsx`, `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`, `apps/web/src/lib/auth/workRoles.ts`
- **Fix steps:**
  1. Add an APPROVAL_FINALIZE_ROLES constant in workRoles.ts derived from works-service route guard.
  2. Have the page read getSessionRoles() and pass canFinalize; hide or disable button with a tooltip 'Requires DAO/DO'.
  3. Confirm with backend whether 'submitted' is finalizable; adjust FINALIZABLE_STATUSES.
  4. Keep server as authority.
- **Acceptance:**
  - Non-approver sees disabled button with explanation.
  - Approver flow unchanged.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong role list would hide the button from legitimate approvers.

### GAP-WORKS-APPROVALS-AA-DETAIL-05  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: approvals.loader.test.ts register date equals formatIndianDate (format.ts fmtDate); closed by #1867)
- **First-pass claim:** Dates use formatIndianDate (dd/mm/yyyy, page.tsx:114) while the register uses "12 Jul 2026" (_data/format.ts:5-9).
- **Verified evidence:** page.tsx:114-115 uses formatIndianDate (lib/formatters.ts:2-7: dd/mm/yyyy) while works/_data/format.ts fmtDate gives '12 Jul 2026' (day 2-digit, month short). Register format differs from detail. Neither forces IST timezone.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Pick one canonical formatter (dd Mon yyyy per house rule) in lib/formatters.ts with timeZone:'Asia/Kolkata'.
  2. Replace formatIndianDate usage in this page and works/_data/format.ts fmtDate with it.
- **Acceptance:**
  - Detail and register show identical date strings.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Changing formatIndianDate globally affects many screens/tests.


---
## /works/approvals/new  —  `works/approvals-new.html`

- **Source:** `apps/web/src/app/(app)/works/approvals/new/page.tsx`
- **Design reference:** `redesign/works/approvals-new.html`

### GAP-WORKS-APPROVALS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Work and approving authority are entered as raw UUIDs (NewAaForm.tsx:107-146) — an officer cannot know either; only the proposal deep-link supplies workId.
- **Verified evidence:** NewAaForm.tsx:105-157 workId and approvingAuthorityId are free-text UUID inputs; only ?workId= prefill (21) helps. No pickers.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/new/NewAaForm.tsx`
- **Fix steps:**
  1. Create/reuse an EntityPicker for works (search by title/number) and for officers (users/employees).
  2. Submit the picked id; show name; keep manual UUID only in URL prefill.
  3. Resolve prefilled workId to name for display.
- **Acceptance:**
  - User selects work by name; POST body has UUID.
  - Prefilled workId shows work title.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Needs list/search endpoints for works and officers (cannot verify).
- **Depends on:** GAP-WORKS-APPROVALS-AA-DETAIL-03

### GAP-WORKS-APPROVALS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Amount conversion uses Number*100 with float rounding (NewAaForm.tsx:52) and no upper bound; large crore values above 2^53 paise lose precision (money must be bigint paise).
- **Verified evidence:** NewAaForm.tsx:52 String(Math.round(Number(form.approvedAmount||'0')*100)) - float math; input type=number step 0.01 min 0 with no max (161-171). Number*100 for large values can misround (e.g. 1.005*100) and >2^53 paise loses precision; String(1e21) would produce exponent notation. Backend expects string paise (approvedAmountMinor).
- **Files to change:** `apps/web/src/app/(app)/works/approvals/new/NewAaForm.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add parseRupeesToPaiseString(input:string) in lib/formatters.ts using string split on '.', pad to 2 decimals, BigInt arithmetic; reject >2 decimals/negatives.
  2. Use text input inputMode='decimal' with pattern instead of type=number.
  3. Add max (e.g. 999,99,99,999.99) and zod validation.
  4. Unit tests: '0.1', '1.005', '99999999999999.99'.
- **Acceptance:**
  - '1.005' rejected or exact; '12345678901234.56' -> '1234567890123456'.
  - No exponent notation output.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money correctness.

### GAP-WORKS-APPROVALS-NEW-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** No confirmation before creating a sanction record, and no audit hint; redirect after 700 ms hides the toast quickly (NewAaForm.tsx:66-70).
- **Verified evidence:** submit (40-75) posts directly with no confirm dialog - true. Success shows banner + toast (67-68) that says it was submitted and will appear once processed (so async is stated), then router.push after 700 ms (69). The audit hint is missing but audit is a backend concern (mutations emit events). The toast is from ds useToast so may persist after navigation.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/new/NewAaForm.tsx`
- **Fix steps:**
  1. Optionally add ConfirmDialog summarising work, AA number, amount (formatMoney) before submit.
  2. Redirect immediately or after toast, passing ?created=<aaNumber> for register banner.
  3. Backend: verify audit emit.
- **Acceptance:**
  - Confirm dialog shows amount in INR format before POST.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; creating draft AA is reversible-ish.
- **Depends on:** GAP-WORKS-APPROVALS-NEW-02

### GAP-WORKS-APPROVALS-NEW-04  ·  LOW  ·  confirmed  ·  theme DS (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline styles, no DS Input/Field components and hard-coded #hex banners (NewAaForm.tsx:9-13); placeholder example "AA/2024-25/001" is a stale FY.
- **Verified evidence:** NewAaForm.tsx:8-12 inline style constants and hard-coded hex (#fef2f2, #b42318, #ecfdf3, #166534) and plain <input>; placeholder 'e.g. AA/2024-25/001' at line 128 uses FY 2024-25 while today is 2026. Theme FABRICATED is a mislabel: it's a placeholder, not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/new/NewAaForm.tsx`
- **Fix steps:**
  1. Replace inputs with ds Field/Input components if present.
  2. Use token colours or ds Alert.
  3. Generate placeholder from current FY (helper currentFy()).
- **Acceptance:**
  - Placeholder shows current FY.
  - No hex in file.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /works/approvals/ts-new  —  `works/approvals-ts-new.html`

- **Source:** `apps/web/src/app/(app)/works/approvals/ts-new/page.tsx`
- **Design reference:** `redesign/works/approvals-ts-new.html`

### GAP-WORKS-APPROVALS-TS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; ts-new picker lists only dao_finalized works (workProposal.ts DAO_FINALIZED) and prefills ?workId= (ts-new/page.tsx + NewTsForm.tsx); NewTsForm.test.tsx) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** a work that is not DAO-finalized is now LISTED as a disabled option with the reason (EntityOption.disabledReason: aria-disabled, reason text, skipped by ArrowUp/ArrowDown, ignored on click/Enter); Create is disabled until a work and a TS authority are chosen (and while the chosen work is not eligible), with an explanation and a submit() guard; the info banner follows the selected work (neutral / eligible / blocked, including a ?workId= prefill); the work search is server-side (GET /v1/works/proposals?q=&limit=&prefer=, returns status, eligible statuses ranked first) instead of the first 200 proposals filtered in the browser; the TS authority picker uses the tenant user directory (the admin-gated users list was unreachable for a works clerk). Eligibility mirrors the server allow-list canEnterTS (dao_finalized, ts_eligible). Tests: EntityPicker.test.tsx (combobox roles, ArrowUp/ArrowDown, disabled options), NewTsForm.test.tsx, cluster01-route-validation.test.ts, cluster01-billing.db.test.ts.
- **W0 note:** partly fixed by #1867 — EntityPicker (work + TS authority) added, but picker does not disable non-DAO-finalized works (only shows Status sublabel), info banner is static, no ?workId= prefill on ts-new.
- **First-pass claim:** The DAO-finalized precondition is only prose (page.tsx:82-84); the work is a pasted UUID (page.tsx:104-114), so users learn about a non-finalized proposal only from a server error.
- **Verified evidence:** ts-new/page.tsx:82-84 infoBanner prose only; Work ID is a plain text input (:110-121) with UUID placeholder, TS authority likewise (:149-160). No lookup or precondition check; failure only surfaces via formError after POST (:60-63). Whether the server returns a specific error for non-finalized proposals is not verifiable (works-service absent). No EntityPicker component exists anywhere in apps/ or packages/, so it must be created.
- **Files to change:** `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/works/approvals/ts-new/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Create ds/EntityPicker (searchable combobox: props label, value, onChange, fetchOptions(query) => {id,label,sublabel,disabledReason?}[]) and export from ds/index.ts.
  2. Backend/BFF: expose list of works (proposals) with status; option is disabled with reason 'Not DAO-finalized' unless finalized.
  3. Replace workId input at ts-new page with EntityPicker, and tsAuthorityId with an officer picker (needs users/officer lookup endpoint, cannot verify).
  4. Support ?workId= prefill like billing forms.
  5. Keep the info banner but derive it from the selected work status.
- **Acceptance:**
  - Typing a work number lists matches; non-finalized works appear disabled with reason.
  - Submit disabled until work and authority selected; body still sends UUIDs.
  - Component test for EntityPicker keyboard nav and aria-combobox.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Shared picker used by many forms; a bad option filter could block valid submissions.
- **Depends on:** GAP-WORKS-BILLING-BILLS-NEW-01, GAP-WORKS-BILLING-NEW-MB-01, GAP-WORKS-BILLING-MEASUREMENTS-NEW-02

### GAP-WORKS-APPROVALS-TS-NEW-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: NewTsForm.test.tsx 'submitted' (202 != done) test; closed by #1867)
- **First-pass claim:** Reports "created" (page.tsx:64) whereas AA create and TS finalize are 202/queued and say "submitted" — inconsistent truthfulness about async writes (NewAaForm.tsx:66).
- **Verified evidence:** ts-new/page.tsx:64-65 say 'Technical sanction created.'. NewAaForm.tsx:62-66 says 'submitted ... will appear once processed' with a comment that AA create returns 202. Finalize button also 202-aware. Whether POST /works/approvals/ts also returns 202 cannot be verified (works-service absent); if it is queued the copy is untruthful, if it is 201 then it is correct. Line refs: NewAaForm message is at :62-65 not :66.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ts-new/page.tsx`
- **Fix steps:**
  1. Confirm the TS create status code with works-service.
  2. If 202: change message/toast to 'Technical sanction submitted. It will appear in the register once processed.' and delay redirect 700ms like AA.
  3. Optionally branch on res.status === 202 to show either wording.
- **Acceptance:**
  - With mocked fetch 202 the banner says 'submitted'.
  - With 201 the banner says 'created'.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-APPROVALS-TS-NEW-03  ·  MEDIUM  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: NewTsForm.test.tsx SR-year dropdown test; no Pune/Nashik/Maharashtra in works sources; closed by #1867)
- **First-pass claim:** Zone placeholder "Pune Zone" (page.tsx:183) is a Maharashtra example in an Odisha deployment; SR Year/Zone free text with no master lookup.
- **Verified evidence:** ts-new/page.tsx:183 placeholder 'e.g. Pune Zone' and SR Year placeholder '2024-25' (:170); both are free text (:163-186, maxLength 16/64). Placeholder is a hint, not fabricated data, but is a Maharashtra name in an Odisha deployment and there is no master lookup (no SR/zone master endpoint visible). Same issue in account-compile ('Nashik').
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ts-new/page.tsx`
- **Fix steps:**
  1. Change placeholder to an Odisha zone example (e.g. 'e.g. Central Zone, Bhubaneswar') or remove.
  2. Change SR Year to a select of FY labels generated from the current date (Apr-Mar).
  3. Later: bind Zone to a master list if works-service exposes one (cannot verify).
- **Acceptance:**
  - No non-Odisha place names remain in works forms (grep for Pune|Nashik|Maharashtra).
  - SR Year select offers current and previous 5 FYs.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BILLING-ACCOUNT-COMPILE-04

### GAP-WORKS-APPROVALS-TS-NEW-04  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** No Cancel/back button and no Suspense; sibling AA form has both (page.tsx:220 vs NewAaForm.tsx:194-205). Amount uses float Math.round(x*100) (page.tsx:49).
- **Verified evidence:** Cancel missing: ts-new/page.tsx:216-223 only a submit Button; NewAaForm.tsx:194-205 has Cancel. Float math confirmed: page.tsx:49 String(Math.round(Number(form.tsAmount||'0')*100)) (e.g. 1.005*100 rounding, and Number('') gives 0 so blank/0 amount is accepted). Suspense is not needed here (ts-new does not use useSearchParams); AA needs it because it reads search params, so that sub-claim is refuted. Also no min>0 check beyond HTML min=0.
- **Files to change:** `apps/web/src/lib/money.ts (new, toMinorString)`, `apps/web/src/app/(app)/works/approvals/ts-new/page.tsx`, `apps/web/src/app/(app)/works/approvals/new/NewAaForm.tsx`, `apps/web/src/app/(app)/works/billing/bills/new/page.tsx`
- **Fix steps:**
  1. Create toMinorString(input: string): string in lib/money.ts that parses a decimal string with regex ^\d+(\.\d{1,2})?$ into integer paise using BigInt/string ops, throwing on invalid.
  2. Replace the Math.round expression at page.tsx:49 with it; show an inline error if invalid or zero.
  3. Add a Cancel ghost Button calling router.push('/works/approvals'), disabled while busy, as in NewAaForm.
  4. Reuse toMinorString in NewAaForm and bills/new.
- **Acceptance:**
  - Unit tests: '1.005' rejected, '10.10'->'1010', '0'->error, '123456789012.34' exact.
  - Cancel returns to register without POST.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: incorrect parsing would misstate sanction amount; test thoroughly.
- **Depends on:** GAP-WORKS-BILLING-BILLS-NEW-02


---
## /works/approvals/ts/[id]  —  `works/approvals-ts-detail.html`

- **Source:** `apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx`
- **Design reference:** `redesign/works/approvals-ts-detail.html`

### GAP-WORKS-APPROVALS-TS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme API-GAP (was DEADROUTE)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ts/[id]/page.test.tsx by-id fetch + ApprovalsTable.test.tsx row link to /works/approvals/aa/<id>; closed by #1867)
- **First-pass claim:** No GET-by-id: page fetches the first 100 records and filters by id (page.tsx:91-105); any record beyond row 100 is a permanent 404 even though it exists.
- **Verified evidence:** apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx:91-105 fetches /api/v1/works/approvals/ts?pageSize=100, maps, then result.data.find(r=>r.id===params.id) and notFound() if absent. Code comment at :91 admits no GET-by-id. Any TS beyond the first 100 rows (or beyond whatever the server caps pageSize at) is unreachable; the list-row link from ApprovalsTable.tsx:97-100 would 404. Same pattern in approvals/aa/[id]/page.tsx:93. works-service is not in the snapshot so endpoint existence/pageSize cap cannot be verified. Not a dead link per se; it is a missing API.
- **Files to change:** `services/works-service/src/modules/approvals (GET /api/v1/works/approvals/ts/:id, cannot see file)`, `apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx`, `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`
- **Fix steps:**
  1. Backend: add GET /api/v1/works/approvals/ts/:id (and aa/:id) returning one record, tenant-scoped, 404 when absent.
  2. In ts/[id]/page.tsx replace the list fetch with fetchJson<unknown, TsRaw|null>(`/api/v1/works/approvals/ts/${params.id}`, null, {mapResponse: p => mapRawTs(isRecord(p)&&'data' in p ? p.data : p)}).
  3. Delete pickArray and the .find; keep mapRawTs.
  4. Call notFound() only when result.status === 404; otherwise render an error state (see -02).
  5. Mirror the change in aa/[id]/page.tsx.
- **Acceptance:**
  - Unit/route test: page for id known to exist but not in the first 100 list rows renders its detail.
  - GET with unknown id returns 404 page; network 500 shows error state, not 404.
  - Register row click on row #101 opens the detail.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only. Until backend ships, detail of older sanctions remains unreachable.
- **Depends on:** GAP-WORKS-APPROVALS-TS-DETAIL-02

### GAP-WORKS-APPROVALS-TS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ts/[id]/page.test.tsx 404 vs load-error tests; closed by #1867)
- **First-pass claim:** Fetch failure is indistinguishable from a missing record — result.source is ignored and notFound() fires (page.tsx:105).
- **Verified evidence:** ts/[id]/page.tsx:92-105: fetchJson returns {data: [], source:'error', status?, errorMessage?} on failure (apps/web/src/app/_data/apiClient.ts:119-172), but the page only reads result.data; empty array => find returns undefined => notFound() at :105. result.source/status are never checked, so 401/500/timeout looks like 'not found'.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx`, `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`
- **Fix steps:**
  1. After the fetch, if result.source === 'error' and result.status !== 404 return <LoadErrorState/> or <RefreshErrorState/> from @/app/_components/ds (already exist) with a retry link to the same route.
  2. Only call notFound() when source==='api' and the record is absent (or status===404 once GET-by-id exists).
  3. Apply the same in aa/[id]/page.tsx.
- **Acceptance:**
  - Mock fetchJson returning source 'error' renders the error state, not the 404 page.
  - Mock source 'api' with no matching id still 404s.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-APPROVALS-TS-DETAIL-01

### GAP-WORKS-APPROVALS-TS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; ts/[id]/page.tsx shows the work number linked to the proposal and the officer name; ts/[id]/page.test.tsx) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** when the officer lookup fails the TS authority reads "Unknown officer (3f9a1c20…)" (works.approvalNames.unknownOfficer, en + hi) with the full id as a tooltip, and the work falls back to "ID 3f9a1c20…"; the page now skips the work-number / officer lookups when works-service already returned them, and looks the officer up in the tenant user directory by id. Same treatment on the AA detail page so register and detail agree. Tests: ts/[id]/page.test.tsx, aa/[id]/page.test.tsx.
- **W0 note:** partly fixed by #1867 — Work linked to /works/billing/<workId> but label is still truncated UUID; TS authority still shortId with "(ID)" label; no workNumber/officer name resolution.
- **First-pass claim:** Work ID and TS Authority are shown as truncated UUIDs (page.tsx:112-113) with no link to the work or officer.
- **Verified evidence:** ts/[id]/page.tsx:110-111 render Work ID and TS Authority as `id.slice(0,8)+'…'` in plain text (rows at :110 and :111, not 112-113; :112-113 are Date/Created). No link to /works/billing/[workId] or proposal, no officer name. Title fallback at :120 also shows a UUID prefix. Response has only workId and tsAuthorityId (TsRaw :13-24); no name fields are read, so names need a lookup endpoint that is not visible here (works-service/master absent).
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/_data/format.ts`
- **Fix steps:**
  1. Short term: render Work as a <Link href={`/works/billing/${workId}`}> (or the works detail route) showing the full id in a monospace title attribute with a copy button.
  2. Backend (or BFF loader): return workNumber and authority display name with the TS record (join/lookup in loader), add fields to TsRaw and mapRawTs.
  3. Show `workNumber` and officer name; keep shortId only as fallback labelled 'ID'.
  4. Reuse the same lookup in loaders.ts mapTsRow so register and detail agree (see GAP-WORKS-APPROVALS-01).
- **Acceptance:**
  - Detail page shows work number linking to the work.
  - When name lookup fails, fallback shows 'Unknown officer (3f9a1c20…)' not a bare hash.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; display only. Wrong join would mislabel an authority.
- **Depends on:** GAP-WORKS-APPROVALS-01

### GAP-WORKS-APPROVALS-TS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Finalize offered to every role and for "submitted" as well as "draft" (ApprovalFinalizeButton.tsx:17,95); no role note, so users without DAO/DO rights meet a server error only after confirming.
- **Verified evidence:** apps/web/src/app/(app)/works/approvals/ApprovalFinalizeButton.tsx:17 FINALIZABLE_STATUSES = draft|submitted, so Finalize shows for both; ts/[id]/page.tsx:179 renders it with no role check. It does have a ConfirmDialog (:136) and shows server error via formError (:52-55), and the server rejection is real (can't verify roles: works-service absent). No role note in dialog. Also note the dialog text 'cannot be undone' is shown to everyone. Web has server-side getSessionRoles()/requireAnyRole in lib/auth/roleGuard.ts but no client hook and no works layout guard; which roles may finalize TS is not visible in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx`, `apps/web/src/app/(app)/works/approvals/aa/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/works/approvals/ApprovalFinalizeButton.tsx`
- **Fix steps:**
  1. Decision: confirm with works-service which roles may finalize AA/TS (DAO/DO per billing copy) and whether 'submitted' is valid.
  2. Add a server helper hasAnyRole(allowed: string[]): boolean in roleGuard.ts (non-redirecting) using getSessionRoles().
  3. In the detail pages pass canFinalize={hasAnyRole(FINALIZE_ROLES)} to ApprovalFinalizeButton.
  4. In the button, when !canFinalize render disabled Button with title 'Requires DAO/DO role' instead of null/active.
  5. Keep server enforcement unchanged.
- **Acceptance:**
  - Session without the role sees disabled Finalize with explanation; no POST is made.
  - Session with role still finalizes and sees pending state.
  - Server 403 still surfaces via formError.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong role list would hide the button from legitimate approvers; UI gating is cosmetic only.
- **Depends on:** GAP-WORKS-BILLING-ACCOUNT-COMPILE-02, GAP-WORKS-APPROVALS-05

### GAP-WORKS-APPROVALS-TS-DETAIL-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: approvals.loader.test.ts date test; closed by #1867)
- **First-pass claim:** Dates use formatIndianDate (dd/mm/yyyy, page.tsx:114) while the register uses "12 Jul 2026" (_data/format.ts:5-9).
- **Verified evidence:** ts/[id]/page.tsx:112-113 use formatIndianDate (lib/formatters.ts:2-7, dd/mm/yyyy). The register uses fmtDate in works/_data/format.ts:5-10 ('12 Jul 2026'). So the mismatch is real, but the reverse of the fix text: formatIndianDate IS the shared formatter; the works-local fmtDate is the outlier. Neither pins timeZone to Asia/Kolkata.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/works/_data/format.ts`, `apps/web/src/app/(app)/works/approvals/ts/[id]/page.tsx`
- **Fix steps:**
  1. Pick one format (decision: dd Mon yyyy suggested) and implement it in lib/formatters.ts as formatIndianDate with timeZone:'Asia/Kolkata'.
  2. Make works/_data/format.ts fmtDate delegate to it (or delete and import shared).
  3. Update ts/[id] and aa/[id] pages to use the same function.
- **Acceptance:**
  - Unit test: formatIndianDate('2026-07-12') returns the chosen string; 2026-07-11T20:00:00Z renders 12 in IST.
  - Register and detail show identical date strings.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Changing shared formatIndianDate affects other modules' tests/snapshots.


---
## /works/billing  —  `works/billing.html`

- **Source:** `apps/web/src/app/(app)/works/billing/page.tsx`
- **Design reference:** `redesign/works/billing.html`

### GAP-WORKS-BILLING-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was VALIDATION)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: format.test.ts modeLabel('e_mb') = 'e-MB'; BillingRegister.test.tsx dedicated Draft card; closed by #1867)
- **First-pass claim:** Mode renders humanize("e_mb") = "E mb" (_data/loaders.ts:75, format.ts:13-18). "Pending" adds draft to mid-workflow bills (page.tsx:10) while the table Status uses the same buckets — a draft bill is labelled "Draft" in the row but counted as Pending; stage and status columns are redundant duplicates of one field (_data/loaders.ts:75-78).
- **Verified evidence:** _data/format.ts:13-17 humanize('e_mb') = 'E mb' (mapBillRow uses it at loaders.ts:75). page.tsx:10 pending = status pending||draft while the row Status shows billBucket (draft stays 'draft', loaders.ts:79): a draft is counted Pending but labelled Draft. Stage = humanize(status) (loaders.ts:78) and status = billBucket(status) (:79) derive from the same field, so the columns duplicate (Stage is the finer version). Theme tag VALIDATION is wrong; this is copy/labeling. Actual billMode values not visible (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/_data/format.ts`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/billing/page.tsx`, `apps/web/src/app/(app)/works/billing/BillingTable.tsx`
- **Fix steps:**
  1. Add a modeLabel() map in format.ts (e_mb -> 'e-MB', physical -> 'Physical', etc., taken from the service enum) and use it in mapBillRow.
  2. Make StatCard 'Pending' count only status==='pending' and add a 'Draft' card, or relabel the card 'In progress (Draft + Pending)'.
  3. Remove one of Stage/Status (keep Stage as granular label; make Status a bucket pill) or rename Status to 'Bucket'.
  4. Unit test modeLabel and stat counts.
- **Acceptance:**
  - Test: modeLabel('e_mb') === 'e-MB'.
  - Manual: draft bill counted under the card whose label names Draft.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-BILLING-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; billing register rows open /works/billing/<workId>?bill=<id> (BillingTable.tsx) and [workId]/page.tsx lists that bill first with a callout; BillingTable.test.tsx + [workId]/page.test.tsx)
- **W0 note:** partly fixed by #1867 — Backend billing repo joins workNumber and mapBillRow uses it; rowHref still goes to /works/billing/<workId> with no ?highlight= or bill detail route (fix step 3 not done).
- **First-pass claim:** Work column shows an 8-char UUID prefix (_data/loaders.ts:74); rowHref opens the work-level page for any bill so two bills of one work are indistinguishable targets (BillingTable.tsx:40).
- **Verified evidence:** loaders.ts:74 work: shortId(workId) gives 8 chars + ellipsis; the Bill type has no workNumber (types.ts:27-42) so no readable work reference is available. BillingTable.tsx:40 (file line 576-536) rowHref = /works/billing/{workId}, so clicking a bill opens the work-level page listing all bills, not the bill. True but by design of the current route; no bill-detail route exists (billing/ has only [workId]).
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/_data/types.ts`, `apps/web/src/app/(app)/works/billing/BillingTable.tsx`, `services/works-service (backend)`
- **Fix steps:**
  1. Backend: include workNumber (join like tenders/closure already do) in GET /v1/works/billing/bills.
  2. mapBillRow: work = str(r.workNumber) || shortId(workId), as mapTenderRow does at loaders.ts:122.
  3. Add ?highlight=<billId> to rowHref and have [workId]/page.tsx scroll/highlight that row, or add a bill detail route.
  4. Update the Bill type with workNumber.
- **Acceptance:**
  - Manual: Work column shows the work number.
  - Clicking the second bill of a work highlights that bill on the work page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-WORKS-BILLING-03  ·  MEDIUM  ·  confirmed  ·  theme STALE-DATA (was I18N)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: BillingRegister.test.tsx stat total equals row count with an empty live seed; closed by #1867)
- **First-pass claim:** StatCards read raw fetch data while the table can render a cached copy (page.tsx:6-12 vs BillingTable.tsx:14): counts show 0 next to cached rows.
- **Verified evidence:** billing/page.tsx:6-12 computes counts from the server result while BillingTable.tsx:14 (useSeededResource, lib/sync/resource.ts:215-257) swaps in the cache copy whenever the server result is error OR empty. So on error/offline, cards read 0 next to cached rows; also if the live result is genuinely empty and a cache exists, stale rows show. Theme I18N is wrong; this is a data-consistency issue.
- **Files to change:** `apps/web/src/app/(app)/works/billing/page.tsx`, `apps/web/src/app/(app)/works/billing/BillingTable.tsx`
- **Fix steps:**
  1. Move StatGrid into a client wrapper (or into BillingTable) and compute total/pending/finalized/submitted from the useSeededResource `data`.
  2. Or lift useSeededResource into a BillingRegister client component that renders both StatGrid and the table.
  3. When provenance is 'cached', label stat cards with the cached-at time via DataSourceBadge.
- **Acceptance:**
  - Component test: mock useSeededResource with cached rows and server [] - stat total equals row count.
  - Manual: go offline after load; cards match table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-BILLING-04  ·  LOW  ·  partly  ·  theme NAVUX (was OTHER)

- [x] **Status** (W2 works: closed by #2047; ALREADY-FIXED on main: register header links Record measurement, Generate bill, Account compile, Issue MB (billing/page.tsx:31-52) and each form opens a work picker, not a UUID box (WorkField at measurements/new/page.tsx:305, bills/new/page.tsx:239, new-mb/page.tsx:171))
- **W0 note:** partly fixed by #1867 — Register header now links Record measurement, Generate bill, Account compile, Issue MB; but measurement/bill/MB forms opened without ?workId= have no work picker (raw UUID text inputs), so the links from the register land on UUID entry.
- **First-pass claim:** Only "+ Issue MB" appears on the register; Generate bill and Account Compile are reachable only via other pages (page.tsx:29-35).
- **Verified evidence:** billing/page.tsx:15-21 shows only '+ Issue MB'. Generate bill (bills/new) and Record measurement (measurements/new) are on [workId]/page.tsx:103-123; Account Compile is linked from works/page.tsx:74 (works home), not the billing register. So reachability exists but is scattered; bills/new needs a workId via query. Low severity holds.
- **Files to change:** `apps/web/src/app/(app)/works/billing/page.tsx`
- **Fix steps:**
  1. Add secondary actions to the register PageHeader: '+ Record measurement', '+ Generate bill', 'Account compile' (btn ghost).
  2. Since bills/new and measurements/new expect ?workId=, either accept an empty workId with a work picker or link them per-row.
  3. Keep '+ Issue MB' primary.
- **Acceptance:**
  - Manual: register header links reach account-compile and bills/new.
  - Links resolve without 404.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BOQ-NEW-03


---
## /works/billing/[workId]  —  `works/billing-workId.html`

- **Source:** `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`
- **Design reference:** `redesign/works/billing-workId.html`

### GAP-WORKS-BILLING-WORKID-01  ·  HIGH  ·  confirmed  ·  theme CONTRACT-MISMATCH (was CONFIRM)

- [x] **Status** (W2 works: closed by #2039)
- **First-pass claim:** Field-name mismatch: page maps r.billNo, r.mode, r.stage (page.tsx:79-83) but the API row uses billNumber / billMode and has no stage (_data/loaders.ts:73,75); Bill No, Mode and Stage render "—" and BillingActions receives billNo "undefined" in dialog copy (page.tsx:183, BillingActions.tsx:242).
- **Verified evidence:** billing/[workId]/page.tsx:10-20 declares BillRow with billNo/mode/stage, but the works Bill contract is billNumber/billMode/status with no stage (_data/types.ts:27-42; list loader maps billNumber->billNo at _data/loaders.ts:73, billMode at :75). page.tsx:79,80,83 read r.billNo/r.mode/r.stage so Bill No/Mode/Stage render undefined->'—' (String(undefined ?? '—')), and :183 passes b.billNo (undefined) into BillingActions, giving 'Bill undefined' in the row label, toast (BillingActions.tsx:~84) and dialog text (:259-261). Caveat: the detail endpoint /billing/{workId}/bills is not in the snapshot (works-service absent); assumed to return the same raw row as the list. The 'fix' text (ConfirmDialog/maker-checker) is unrelated to this defect.
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/BillingActions.tsx`
- **Fix steps:**
  1. Add getBillsForWork(workId) to _data/loaders.ts that fetches /api/v1/works/billing/${workId}/bills and reuses mapBillRow (billNumber->billNo, billMode->mode via humanize).
  2. Keep the raw status on the mapped row (add rawStatus) because BillingActions needs the workflow code, while the table shows the bucket/label.
  3. In [workId]/page.tsx delete the local BillRow/pickData and consume the loader; drop the stage column (not an API field) or derive it from status via humanize.
  4. Pass {id, billNo, status: rawStatus} to BillingActions so the label, toast and ConfirmDialog show the real bill number.
  5. Add a Vitest for the mapper: {billNumber:'RA-01',billMode:'e_mb',status:'so_finalized'} yields billNo 'RA-01', not '—' or 'undefined'.
- **Acceptance:**
  - Component/loader test: mapped row has billNo 'RA-01' and mode set.
  - Manual: open /works/billing/<workId>; Bill No and Mode columns populated; Advance dialog reads 'advance bill "RA-01"'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display-only, but the wrong bill number in an irreversible-advance dialog is a control risk until fixed.
- **Depends on:** GAP-WORKS-BILLING-WORKID-02, GAP-WORKS-BILLING-WORKID-06

### GAP-WORKS-BILLING-WORKID-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** nextInSequence returns seq[0] for any status not in the sequence (BillingActions.tsx:31), so bills that are draft, submitted, submitted_ifms or finalized appear under "Finalize Bills" with a "→ So Finalized" button — including bills already sent to IFMS.
- **Verified evidence:** BillingActions.tsx:29-34 nextInSequence returns seq[0] ('so_finalized') for any status not in BILL_SEQUENCE; actionableBills (:130-132) filters on non-null. Real raw statuses are draft|so..do_finalized|submitted (types.ts:18-25). So 'draft' correctly gets So Finalized as first step, but 'submitted' (already sent) also falls to seq[0] and is offered '-> So Finalized'. 'submitted_ifms' and 'finalized' are not raw statuses (they are display buckets from billBucket, _data/format.ts:30-35) but would behave the same if ever returned. do_finalized correctly returns null. Related: page.tsx:57-63 counts 'submitted_ifms'/'finalized' which never match raw values ('submitted'), so the Submitted stat is always 0.
- **Files to change:** `apps/web/src/app/(app)/works/billing/[workId]/BillingActions.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/_data/format.ts`
- **Fix steps:**
  1. Change nextInSequence: idx===-1 returns seq[0] only when current==='draft'; otherwise return null (unknown or submitted).
  2. Export BillStatus-typed constants from _data/types.ts/format.ts and reuse them instead of local string arrays.
  3. In page.tsx compute finalizedCount from 'do_finalized' and submittedCount from 'submitted' (or billBucket) so stats match real values.
  4. Show submitted/finalized bills in the table only; add unit tests for nextInSequence.
- **Acceptance:**
  - Unit: nextInSequence(BILL_SEQUENCE,'submitted') === null; ('draft') === 'so_finalized'; ('do_finalized') === null.
  - Manual: a submitted bill shows no Advance button; Submitted stat counts it.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes an erroneous action on already-submitted bills. Server-side transition validation cannot be verified (works-service absent).
- **Depends on:** GAP-WORKS-BILLING-WORKID-01

### GAP-WORKS-BILLING-WORKID-03  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W2 works: closed by #2039)
- **W0-10 note:** review found the W0 tick partly — Only a single coarse canFinalize (BILLING_FINALIZE_ROLES) gates all steps; no per-step role map, so estimator/SO can still advance a DAO step; BILL_STEP_AUTHORITY is guidance text only (workRoles.ts:446-486). Acceptance (no DAO role => no button on auditor_finalized) unmet; no maker!=checker; backend WRITE_ROLES also coarse (billing/routes.ts:21)
- **First-pass claim:** Irreversible stage advances are offered to every role (BillingActions.tsx:151-178) and the dialog text only says "This cannot be undone"; no indication of which authority (SO/SDO/Auditor/DAO/DO) may perform which step.
- **Verified evidence:** BillingActions.tsx:136-170 renders the Advance button for every actionable bill and :176-262 the MB form for any viewer; dialog copy (:259-261, :278-281) is only 'This cannot be undone.' with no authority named. No role gating in the component or page; the layout only has ModuleGate (works/layout.tsx). A server-only helper exists (lib/auth/roleGuard.ts getSessionRoles/requireAnyRole) but no client hook and no mapping of SO/SDO/Auditor/DAO/DO to role claims. Server enforcement cannot be verified (works-service absent). Also 'cannot be undone' is asserted in copy but no evidence of that in code.
- **Files to change:** `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/BillingActions.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/works/_data/format.ts`
- **Fix steps:**
  1. Decide the role-claim names for each finalize step (SO, SDO, Auditor, DAO, DO, Estimator) and add a STEP_ROLE map next to the sequences.
  2. In page.tsx call getSessionRoles() server-side and pass canAdvance(status)->boolean per bill to BillingActions (do not read cookies client-side).
  3. Disable (with aria-describedby tooltip) or hide the button when the caller lacks the role; show 'Awaiting: <authority>' text beside Current status.
  4. Dialog description: name the authority stepping the bill and the from->to status; keep it truthful about reversibility.
  5. Confirm the finalize endpoints enforce the same role and maker!=checker; add backend ticket if not.
- **Acceptance:**
  - Test: user without DAO role sees no button on an auditor_finalized bill; with role sees 'Dao Finalized'.
  - Direct POST with wrong role returns 403 (backend).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval workflow: UI hiding is convenience only; wrong role mapping could block legitimate finalisation.
- **Depends on:** GAP-WORKS-BILLING-WORKID-02

### GAP-WORKS-BILLING-WORKID-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** MB finalization needs a pasted UUID ("no list endpoint exists yet", BillingActions.tsx:176,207) and lets the user pick any Next Status, skipping stages.
- **Verified evidence:** BillingActions.tsx:176 comment 'manual ID entry - no list endpoint exists yet'; input id billing-mb-id placeholder 'Paste full MB UUID' (:207) posts to /api/proxy/v1/works/billing/mb/${mbId}/finalize (:~93). The Next Status <select> (:~230) lists all of MB_SEQUENCE with default seq[0], so any step can be chosen and stages skipped; no client check of the MB's current status. Whether the backend rejects skipped transitions cannot be verified. No MB list loader exists in _data/loaders.ts.
- **Files to change:** `apps/web/src/app/(app)/works/billing/[workId]/BillingActions.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Backend: add GET /v1/works/billing/mb?workId= returning id, mbNumber, status (gateway path /api/v1/works/billing/mb).
  2. Add getMbsForWork(workId) loader and render MBs as a table/list like bills, each with its own single 'Advance to <next>' button using nextInSequence(MB_SEQUENCE, status).
  3. Remove the UUID input and the free Next Status select; if a select is kept, restrict to the immediate next step.
  4. Reuse the same ConfirmDialog with the MB number.
- **Acceptance:**
  - Component test: only the next MB status is offered; no UUID field rendered.
  - Manual: advancing an MB from the list moves it exactly one step.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; MB stage advance is an approval step, so skipped stages must also be blocked server-side.
- **Depends on:** GAP-WORKS-BILLING-WORKID-02

### GAP-WORKS-BILLING-WORKID-05  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: billing/[workId]/page.test.tsx BigInt total + money.sumMinor.test.ts; closed by #2039)
- **First-pass claim:** Total Gross sums with Number() over paise strings (page.tsx:53) — float, not bigint; the BoQ page does this correctly with BigInt (boq/page.tsx:16).
- **Verified evidence:** [workId]/page.tsx:52-55 sums with Number(String(b.grossAmountMinor)) then String(Math.round(total)) into formatMoney (:139): float accumulation on paise strings, violating the bigint-minor rule; boq/page.tsx:14-20 shows the BigInt pattern. Practical error only above 2^53 paise (~Rs 9e13), so low real-world impact but a rule violation; formatMoney already handles strings/bigint.
- **Files to change:** `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`
- **Fix steps:**
  1. Replace reduce with BigInt accumulation in try/catch, starting from 0n and skipping unparsable values (copy boq/page.tsx:14-20).
  2. Pass the bigint straight to formatMoney; remove Math.round/String wrapping.
  3. Extract sumMinor(rows, key) into lib/money.ts and reuse in boq/page.tsx and boq/[workId]/page.tsx.
- **Acceptance:**
  - Unit: sumMinor(['9007199254740993','1']) === 9007199254740994n.
  - Manual: Total Gross matches sum of Gross column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BOQ-WORKID-03

### GAP-WORKS-BILLING-WORKID-06  ·  MEDIUM  ·  partly  ·  theme COPY (was MONEY)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: page.test.tsx granular status label; closed by #2039)
- **First-pass claim:** Status column shows raw workflow codes (so_finalized …) while the register shows four buckets (_data/format.ts:30-38); Total Gross card is not labelled ₹.
- **Verified evidence:** Status column uses cellType 'status' on the raw status (page.tsx:173, row from :84), e.g. so_finalized, whereas the register shows billBucket values (loaders.ts:79 / format.ts:30-35): true. 'Total Gross card is not labelled Rs' is refuted: formatMoney output includes the rupee sign (:139). Mislabel of the Stage column: it is also fed from a field that does not exist (see -01).
- **Files to change:** `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/_data/format.ts`
- **Fix steps:**
  1. Decide the single vocabulary: on the detail page show the granular workflow status using humanize()/statusLabel (it is the actionable step) and keep the four buckets on the register; state that in a column label or legend.
  2. Map status through a shared billStatusLabel() in format.ts and use it in both BillingActions.statusLabel and the table.
  3. Drop the Stage column once -01 is fixed.
- **Acceptance:**
  - Manual: detail table Status reads 'So finalized', consistent with 'Current:' text in Finalize Bills.
  - Register unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BILLING-WORKID-01


---
## /works/billing/account-compile  —  `works/billing-account-compile.html`

- **Source:** `apps/web/src/app/(app)/works/billing/account-compile/page.tsx`
- **Design reference:** `redesign/works/billing-account-compile.html`

### GAP-WORKS-BILLING-ACCOUNT-COMPILE-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: account-compile/page.test.tsx confirm dialog (Cancel = no request), single POST, reference shown; closed by #1867)
- **First-pass claim:** Irreversible-looking submit to treasury has no ConfirmDialog and no audit/receipt reference on success — just a banner and redirect after 1.2 s (page.tsx:77-79,100-112).
- **Verified evidence:** account-compile/page.tsx:49-85 submits directly on form submit; no ConfirmDialog (ds/ConfirmDialog.tsx exists and is used by ApprovalFinalizeButton). Success: toast 'Account compile initiated.' (:77), banner 'Account compile submitted' (:109), redirect after 1200ms (:79); no reference id, and the response body is ignored. 'Irreversible' and 'audit event' cannot be verified (works-service absent); audit emission is a backend duty (CLAUDE.md), not web. Maker!=checker is not applicable to a single submit. Mandatory reason is not clearly required.
- **Files to change:** `apps/web/src/app/(app)/works/billing/account-compile/page.tsx`
- **Fix steps:**
  1. Turn the submit button into an open-dialog trigger; validate then open <ConfirmDialog> stating month/year/recipient and that it is sent to treasury.
  2. Move fetch into onConfirm with busy/errorMessage props.
  3. Read job id / reference from the response (confirm field name with backend) and show it in the success banner; do not auto-redirect before the user can read it (link 'Go to billing' instead).
  4. Backend: confirm audit event is emitted on account-compile.
- **Acceptance:**
  - Clicking Compile shows confirm dialog with month/year/submittedTo; Cancel makes no request.
  - Confirm posts once; success shows reference if returned.
  - Double-click posts once.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Submission to treasury: duplicate submits; ensure busy guard.

### GAP-WORKS-BILLING-ACCOUNT-COMPILE-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: account-compile/layout.test.tsx redirect without DAO/DO/admin role; closed by #1867)
- **First-pass claim:** Role restriction is prose only (page.tsx:133); every user who opens the URL sees a live form and learns of a 403 after submitting.
- **Verified evidence:** account-compile/page.tsx:132-135 note 'restricted to DAO / DO roles'; the page is a client component with no role check, and there is no requireAnyRole in works layout. Server 403 handled through formError after submit (:71-75). lib/auth/roleGuard.ts requireAnyRole is server-only and can be used from a layout.tsx.
- **Files to change:** `apps/web/src/app/(app)/works/billing/account-compile/layout.tsx (new)`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Add account-compile/layout.tsx (server component) calling requireAnyRole(['dao','do']) (confirm exact role claim strings used in JWT) as done in crm/*/layout.tsx.
  2. Optionally, render the form disabled with a note instead of redirect for a friendlier UX.
  3. Link to it from billing/page.tsx only for allowed roles.
- **Acceptance:**
  - Session without role visiting URL is redirected to /dashboard.
  - DAO session sees the form.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Incorrect claim strings lock out DAO/DO.

### GAP-WORKS-BILLING-ACCOUNT-COMPILE-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: closed by #2047; account-compile/page.tsx follows the 202 job through GET account-compile until the compilation is recorded (useAcceptedWrite poll); page.test.tsx job follow-up test)
- **W0 note:** partly fixed by #1867 — Already-compiled warning via GET /billing/account-compile?month&year and job reference shown; no post-submit job status view/polling (fix step 3 status part not done).
- **First-pass claim:** Nothing shows whether the month was already compiled or the job status; the async job has no follow-up view (page.tsx:60-79).
- **Verified evidence:** account-compile/page.tsx:60-79: POSTs, ignores the response, toasts and redirects to /works/billing. No GET to check whether the month was compiled and no job status view anywhere in works/billing (only BillingTable, [workId], forms). Backend job/status endpoint existence cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/billing/account-compile/page.tsx`, `services/works-service (job status endpoint, cannot see)`
- **Fix steps:**
  1. Backend: confirm whether account-compile returns a job id and whether a list/status endpoint exists; add if missing.
  2. Fetch previous compiles for selected month/year and show 'Already compiled on ...' warning, requiring an explicit confirm to re-run.
  3. After success show job id and status link/polling instead of immediate redirect.
- **Acceptance:**
  - Selecting an already-compiled month shows a warning.
  - After submit, the page shows pending/complete status until finished.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate compile/treasury submissions if status not shown.
- **Depends on:** GAP-WORKS-BILLING-ACCOUNT-COMPILE-01

### GAP-WORKS-BILLING-ACCOUNT-COMPILE-04  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: account-compile/page.test.tsx FY-first month order + calendar-month payload; closed by #1867)
- **First-pass claim:** Example office "District Treasury Officer, Nashik" (page.tsx:192) is not an Odisha treasury; months listed calendar-order rather than FY (Apr–Mar) order (page.tsx:33-36).
- **Verified evidence:** account-compile/page.tsx:192 example "District Treasury Officer, Nashik"; MONTHS array (:29-32) is January-December and default month is the current calendar month (:41); YEARS is last 6 calendar years (:35). Government FY runs Apr-Mar. Offered 'year' is calendar year, so consistent with month, only ordering differs. Submitted-to is free text.
- **Files to change:** `apps/web/src/app/(app)/works/billing/account-compile/page.tsx`
- **Fix steps:**
  1. Change example to an Odisha treasury (e.g. 'Treasury Officer, Bhubaneswar').
  2. Order MONTHS April..March and show FY label ('Apr 2026 (FY 2026-27)') while still sending calendar month/year.
  3. Optionally replace free text with treasury master lookup if available.
- **Acceptance:**
  - Month select starts at April.
  - Payload for 'January 2027' remains {month:1, year:2027}.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; watch month/year mapping.


---
## /works/billing/bills/new  —  `works/billing-bills-new.html`

- **Source:** `apps/web/src/app/(app)/works/billing/bills/new/page.tsx`
- **Design reference:** `redesign/works/billing-bills-new.html`

### GAP-WORKS-BILLING-BILLS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — Award and DO-finalized MB become selects when ?workId= given (via /billing/:workId/awards and /mbs); Work ID remains a UUID text input and with no workId (register link) all three fall back to UUID text; no EntityPicker; tenders/[id] hint not fixed.
- **First-pass claim:** Three raw UUIDs (work, award, MB) are typed or pasted (page.tsx:135-155); award is "found in the Works Tenders list" but TenderRow carries no award id (tender id, work, type, amount, opening date, authority, status — _data/loaders.ts:102-110), so the hint is not actionable.
- **Verified evidence:** bills/new/page.tsx:143-153 three text inputs (workId, awardId, mbId) with a hint at :149 'Find in the Works Tenders list.'. TenderRow (works/_data/loaders.ts:93-101) has no award id. Award id exists only on tenders/[id]/page.tsx:227 (quotations awardId) passed into TenderActions; nothing links to bills/new or new-mb with awardId. Web pages read ?workId/awardId/mbId from search params (:28-30) but only [workId]/page.tsx passes workId. No EntityPicker component exists.
- **Files to change:** `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/(app)/works/billing/bills/new/page.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `services/works-service (list awards/MBs by work, cannot see)`
- **Fix steps:**
  1. Short term: on billing/[workId] page derive award and finalized MB for the work and link with ?workId=&awardId=&mbId= prefilled; show prefilled ids as read-only summary.
  2. Create ds/EntityPicker and use it for MB (filtered to DO-finalized MBs of the work) and Award (by work).
  3. Backend: endpoints for awards-by-work and MBs-by-work with status if not present (cannot verify).
  4. Replace the 'Find in Tenders list' hint with picker help text; fix hint on tender detail by showing the award reference.
- **Acceptance:**
  - From a work's billing page, Generate Bill opens with work, award, MB already chosen.
  - Only DO-finalized MBs are selectable.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Wrong award/MB pairing would raise a bill against wrong contract.
- **Depends on:** GAP-WORKS-APPROVALS-TS-NEW-01

### GAP-WORKS-BILLING-BILLS-NEW-02  ·  MEDIUM  ·  partly  ·  theme MONEY

- [~] **Status** (W2 works rescan: PARTIAL. Built: an e-MB bill now starts from the MB's still-billable value (gross prefilled once the MB position loads, never overwriting what the clerk typed), with a neutral note when the gross is below it; the over-ceiling case stays a hard reject in web and server (MEASURED_VALUE_EXCEEDED). NEEDS OWNER DECISION for the rest, see below)
- **W2 works rescan note (cluster 01):** OWNER QUESTION (GAP-WORKS-BILLING-BILLS-NEW-02): should an e-MB bill's gross be LOCKED to the MB's still-billable value with an "override with reason" path? If yes: (a) is billing LESS than the billable value (a running/partial bill) allowed without a reason, and who may override at all; (b) where must the reason live (a column or table on works.bills: a schema change, plus an audit field); (c) is an override ABOVE the measured value ever allowed (today web and server reject it). Not built because each answer is a payment-control policy. The measured-value hint is deliberately shown in abstract mode too, because the server enforces the same ceiling in both modes.
- **W2 works note (#2039):** gross cannot be derived from the MB total (no MB-total endpoint); float math already replaced by BigInt.
- **W0 note:** partly fixed by #1867 — Float math replaced by rupeesToMinorString/BigInt net preview; gross still free-typed (not derived from or validated against MB total; e_mb lock/override-reason and backend check not done).
- **First-pass claim:** Gross and deductions are free-typed rupees converted with float Math.round(x*100) (page.tsx:17-20,48-50), not derived from the finalized MB measurements — bill value can silently diverge from measured work.
- **Verified evidence:** bills/new/page.tsx:17-20 toMinor and :46-49 net preview use Math.round(Number(x)*100), floats. Payload amounts are integer paise strings (:78,80) which respects the API contract, but float multiplication can misround (e.g. 1.005). Gross and deductions are free-typed, not derived from the MB (form has no measured value); server validation of gross vs MB cannot be verified (works-service absent). Client check for deductions>gross exists (:64-67).
- **Files to change:** `apps/web/src/lib/money.ts (new)`, `apps/web/src/app/(app)/works/billing/bills/new/page.tsx`, `services/works-service billing bill create (cannot see)`
- **Fix steps:**
  1. Add toMinorString in lib/money.ts (decimal string to paise, no float) and use it for toMinor and net preview via BigInt.
  2. For e_mb mode: fetch MB total (needs backend endpoint) and pre-fill/lock gross with an 'override with reason' path.
  3. Backend: validate gross against MB total and reject/flag mismatch.
  4. Compute net = BigInt(gross) - BigInt(deductions) and format with formatMoney.
- **Acceptance:**
  - toMinorString('1.005') rejects; '2.50' -> '250'.
  - In e_mb mode gross shows MB total; overriding needs reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money: bill values feed payment to contractors.
- **Depends on:** GAP-WORKS-APPROVALS-TS-NEW-04

### GAP-WORKS-BILLING-BILLS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by 4f03cdd52 (owner decision D4c #37, 2026-10-27): five fixed heads, per-division rates, maker adjusts, checker sees computed vs charged, lines sum to deductions
- **W2 works rescan note (cluster 01):** OWNER QUESTION (GAP-WORKS-BILLING-BILLS-NEW-03): which statutory recovery heads apply (security deposit, income tax/TDS, labour cess, GST TDS: codes and labels), are they fixed or tenant-configured, and is each head an entered amount or computed from a rate (percent of gross, of net, or of measured value)? Note for the schema decision: works.bill_recoveries (recovery_type, amount_minor, remarks, RLS, audit columns) already exists but nothing reads or writes it; the bill create command, consumer and read model would need per-head lines whose sum equals deductionsMinor. Nothing was built: heads and rates are policy values that are not in the repository or tenant configuration.
- **W2 works part 2 note (#2047):** statutory recovery heads (security deposit, TDS, labour cess) need a product decision and a schema change. INTERIM, owner decision.
- **W2 works note (#2039):** statutory recovery heads need a product decision and a schema change.
- **First-pass claim:** Single "Deductions" number: no breakdown of statutory recoveries (security deposit, TDS, labour cess), so the net payable cannot be audited from the form.
- **Verified evidence:** bills/new/page.tsx:188-191 single Deductions input, body.deductionsMinor (:80). Bill type (works/_data/types.ts:26-40) has only deductionsMinor, no breakdown, so backend contract also has none. Statutory recovery structure (SD, TDS, labour cess) is unverifiable and a business/product decision.
- **Files to change:** `apps/web/src/app/(app)/works/billing/bills/new/page.tsx`, `services/works-service billing bill schema (cannot see)`, `apps/web/src/app/(app)/works/_data/types.ts`
- **Fix steps:**
  1. Decision: confirm required recovery heads and rates (security deposit, income tax/TDS, labour cess, GST TDS).
  2. Backend: add a deductions array [{head, amountMinor}] and store per-head with audit.
  3. Web: replace the single input with a repeatable head/amount list, sum to deductionsMinor and show net.
  4. Show per-head lines on billing/[workId] and bill detail.
- **Acceptance:**
  - Adding three heads updates total deductions and net.
  - Payload contains per-head lines; sum equals total.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Statutory recoveries; wrong heads or rates cause payment errors.
- **Depends on:** GAP-WORKS-BILLING-BILLS-NEW-02

### GAP-WORKS-BILLING-BILLS-NEW-04  ·  LOW  ·  partly  ·  theme A11Y (was VALIDATION)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: Suspense skeleton test + invalid-input tests in bills/new/page.test.tsx; closed by #2039)
- **First-pass claim:** Suspense has no fallback (page.tsx:224); the field id attributes are generic ("workId", "awardId", "mbId") and duplicate across sibling forms.
- **Verified evidence:** Suspense at bills/new/page.tsx:224-226 has no fallback (true; briefly renders nothing). Ids 'workId','awardId','mbId' at :143-153 are generic, but each sits on a different page and never co-render, so duplicates are not a real DOM issue (new-mb uses prefixed ids, others do not). Validation is not zod (manual checks :56-67).
- **Files to change:** `apps/web/src/app/(app)/works/billing/bills/new/page.tsx`, `apps/web/src/app/(app)/works/billing/measurements/new/page.tsx`, `apps/web/src/app/(app)/works/billing/new-mb/page.tsx`
- **Fix steps:**
  1. Pass a fallback to <Suspense> (skeleton from ds/Skeleton).
  2. Optionally prefix input ids (bill-new-*) for consistency.
  3. Move field checks to a zod schema shared with the paise helper.
- **Acceptance:**
  - Throttled render shows skeleton.
  - Schema test rejects invalid input.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /works/billing/measurements/new  —  `works/billing-measurements-new.html`

- **Source:** `apps/web/src/app/(app)/works/billing/measurements/new/page.tsx`
- **Design reference:** `redesign/works/billing-measurements-new.html`

### GAP-WORKS-BILLING-MEASUREMENTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: measurements/new/page.test.tsx computed 6 and remark-block tests; closed by #2039)
- **First-pass claim:** Quantity is typed independently of L/B/D/No. and the page itself says the product is "for reference" (page.tsx:263-265): a mis-typed quantity is silently authoritative and flows into a bill; there is no cross-check or computed suggestion.
- **Verified evidence:** measurements/new/page.tsx:87-93 sends quantity = parseFloat(form.quantity) independent of numberVal/lengthVal/breadthVal/depthVal (:99-102). Note at :251 'L x B x D x No. product is for reference - the backend uses quantity as the authoritative value.' No computation, suggestion, or mismatch warning. Backend recompute unverifiable (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/billing/measurements/new/page.tsx`, `services/works-service measurement create (cannot see)`
- **Fix steps:**
  1. Compute suggested = No. (default 1) x L x B x D of the non-empty dimension fields using decimal-safe arithmetic (scale to integers by 1000).
  2. Show 'Computed: X' next to Quantity with a 'Use computed' button.
  3. If quantity differs from computed by more than tolerance, show a warning and require remark before submit.
  4. Backend: validate/recompute quantity when dimensions are given.
- **Acceptance:**
  - L=2, B=3, D=0.5, No=2 shows Computed 6.000.
  - Quantity 9 with computed 6 shows warning and blocks submit without remark.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Measured quantity feeds bill value and payment.
- **Depends on:** GAP-WORKS-BILLING-MEASUREMENTS-NEW-03

### GAP-WORKS-BILLING-MEASUREMENTS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; Record measurement row actions on the BoQ lines (boq/[workId]/BoqItemsTable.tsx) and MB rows (billing/[workId]/BillingActions.tsx) open the form with work and item/MB pre-chosen; boq/[workId]/page.test.tsx + BillingActions.test.tsx)
- **W2 works note (#2039):** MB and BoQ pickers done (BoQ select shows unit); the 'Record measurement' row action on BoQ/MB lists is not built (part 2).
- **W0 note:** partly fixed by #1867 — MB is a select when ?workId= given; BoQ Item remains a raw UUID text input (no picker, no unit/description); no BoQ/MB row action linking here.
- **First-pass claim:** Two raw UUIDs (MB and BoQ item) with no lookup (page.tsx:176-200); BoQ list rows are not linked here.
- **Verified evidence:** measurements/new/page.tsx:171-192 mbId and boqItemId are text inputs; both are prefilled only from ?mbId/?boqItemId (:63-64). No caller in works links here with those params (only billing/[workId]/page.tsx:111 with workId). Whether BoQ rows link is unverified but no boq link to this route exists (grep). No EntityPicker exists.
- **Files to change:** `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/(app)/works/billing/measurements/new/page.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/boq (list rows)`
- **Fix steps:**
  1. Use EntityPicker for MB (by workId) and BoQ item (label: item no. + description + unit).
  2. Add 'Record measurement' row action on BoQ/MB lists linking with ?mbId=&boqItemId=&workId=.
  3. Show the selected BoQ item code/description read-only when prefilled.
- **Acceptance:**
  - From MB page, Record links prefilled and shows item description.
  - Manual UUID entry no longer needed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong BoQ item makes a measurement against the wrong rate.
- **Depends on:** GAP-WORKS-APPROVALS-TS-NEW-01

### GAP-WORKS-BILLING-MEASUREMENTS-NEW-03  ·  MEDIUM  ·  partly  ·  theme QUANTITY (was MONEY)

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — Quantity validated by regex (<=3dp, no NaN/Infinity) but sent as Number (backend schema is z.number()); unit suffix not shown (blocked on BoQ item picker).
- **First-pass claim:** Quantity sent as JS float via parseFloat (page.tsx:91,97) at 3 decimals; no unit shown next to Quantity because the BoQ item unit is unknown to the form.
- **Verified evidence:** measurements/new/page.tsx:87,99-102 use parseFloat and send JSON numbers (quantity :93). This is a physical quantity, not money, so CLAUDE.md paise rule does not apply; theme MONEY is wrong. Float risk exists for 3-decimal values; whether the API expects number or decimal string cannot be verified (works-service absent). No unit label: form has no BoQ item data (:171-192). Step 0.001 confirmed.
- **Files to change:** `apps/web/src/app/(app)/works/billing/measurements/new/page.tsx`, `services/works-service measurement schema (cannot see)`
- **Fix steps:**
  1. Check the API contract; if decimal strings are supported send validated strings (regex ^\d+(\.\d{1,3})?$) instead of parseFloat.
  2. After BoQ item is picked (see -02), show its unit as input suffix.
  3. Reject NaN/Infinity.
- **Acceptance:**
  - '12.345' is sent unchanged.
  - Unit shown after selecting item.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low-medium; quantity precision flows into bill.
- **Depends on:** GAP-WORKS-BILLING-MEASUREMENTS-NEW-02

### GAP-WORKS-BILLING-MEASUREMENTS-NEW-04  ·  LOW  ·  partly  ·  theme VALIDATION

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: negative-dimension test + Suspense skeleton test; closed by #2039)
- **First-pass claim:** Validation rejects only quantity <= 0; negative dimensions are blocked only by the HTML min attribute (page.tsx:248-249). Suspense has no fallback.
- **Verified evidence:** page.tsx:87-92 only checks qty falsy or <=0 (also !qty rejects NaN). Dimensions use min="0" (:244) and quantity min="0" (:204) which browser validation enforces on submit (form is not noValidate), but nothing server-side or in JS; numberVal etc. parsed without NaN check (:99-102). Also a 0 dimension is silently dropped by the truthy test `if (form.lengthVal)` no, string '0' is truthy so it is sent. Suspense without fallback at :296 is true.
- **Files to change:** `apps/web/src/app/(app)/works/billing/measurements/new/page.tsx`
- **Fix steps:**
  1. Add a zod schema {quantity: positive, numberVal/lengthVal/breadthVal/depthVal: optional nonnegative finite} and parse before POST.
  2. Show field-level errors.
  3. Add Suspense fallback skeleton.
- **Acceptance:**
  - Programmatic submit with -1 dimension shows error, no POST.
  - Suspense fallback visible in test.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BILLING-BILLS-NEW-04


---
## /works/billing/new-mb  —  `works/billing-new-mb.html`

- **Source:** `apps/web/src/app/(app)/works/billing/new-mb/page.tsx`
- **Design reference:** `redesign/works/billing-new-mb.html`

### GAP-WORKS-BILLING-NEW-MB-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — Award is a select when ?workId= given; Work still UUID text and register "+ Issue MB" has no workId; tenders/[id] has no Issue MB link prefilled with workId/awardId; no EntityPicker.
- **First-pass claim:** Work and Award are pasted UUIDs (page.tsx:99-122) and the hint sends the user to the Tenders list, whose rows carry no award id (TenderRow, _data/loaders.ts:102-110) — the required award UUID cannot be obtained from the UI.
- **Verified evidence:** new-mb/page.tsx:100-127 workId and awardId text inputs with hint 'Find in Works Tenders list' (:124-126). TenderRow (loaders.ts:93-101) has no award id; award id appears only inside tenders/[id]/page.tsx:227 as a prop to TenderActions and is not displayed or linked to new-mb. So the UI has no way to get the award UUID. Same root cause as bills/new.
- **Files to change:** `apps/web/src/app/(app)/works/billing/new-mb/page.tsx`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. On tenders/[id] show 'Issue MB' link to /works/billing/new-mb?workId=..&awardId=.. when an award exists.
  2. On new-mb use EntityPicker for work and award (award options by work).
  3. Show prefilled work number and award reference read-only.
  4. Drop the misleading hint.
- **Acceptance:**
  - From an awarded tender, Issue MB opens prefilled.
  - No UUID typing required.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong award binds MB to wrong contract.
- **Depends on:** GAP-WORKS-BILLING-BILLS-NEW-01

### GAP-WORKS-BILLING-NEW-MB-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline success says only "Created." while the toast says "Measurement book issued." (page.tsx:58-59) — inconsistent, and "Created." does not name the object.
- **Verified evidence:** new-mb/page.tsx:58 setMessage('Created.') vs toast.success('Measurement book issued.') at :59. Also the redirect at 600ms hides the banner quickly. Whether the POST is 202 unknown.
- **Files to change:** `apps/web/src/app/(app)/works/billing/new-mb/page.tsx`
- **Fix steps:**
  1. Set inline message to 'Measurement book issued.' matching the toast (or 'submitted' if the API returns 202).
  2. Use the same string constant for both.
- **Acceptance:**
  - Banner and toast text identical.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-BILLING-NEW-MB-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: closed by #2039; W2 works rescan: completed by #2133)
- **W2 rescan note:** web now reads the FLAT works-service envelope (code at top level) so DUPLICATE_MB_NUMBER lands on the MB number field; billing-mb-duplicate-envelope.test.ts runs the real error handler, new-mb/page.test.tsx uses the real body shape
- **W0 note:** partly fixed by #1867 — values trimmed before POST; no field-level 409 mapping (generic formError message only) and no duplicate pre-check
- **First-pass claim:** MB number is free text with no uniqueness feedback until the server responds (page.tsx:130-143).
- **Verified evidence:** new-mb/page.tsx:129-141 mbNumber is free text with maxLength 64, no pre-check; error only from formError after POST. Uniqueness rules and a lookup endpoint cannot be verified (works-service absent). Also workId/awardId/mbNumber are sent untrimmed (:49-51), unlike bills/new.
- **Files to change:** `apps/web/src/app/(app)/works/billing/new-mb/page.tsx`, `services/works-service (MB by number check, cannot see)`
- **Fix steps:**
  1. Trim values before sending.
  2. Ensure the server returns a 409 with clear code and map it in formError to a field error 'MB number already used for this work'.
  3. Optionally debounced GET check for existing number if endpoint exists; otherwise suggest next number from list.
- **Acceptance:**
  - Duplicate MB number shows error on the field, form data retained.
  - Trimmed values sent.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-BILLING-NEW-MB-04  ·  LOW  ·  partly  ·  theme UUID

- [x] **Status** (W2 works: closed by #2039)
- **W0-10 note:** review found the W0 tick partly — back/Cancel/Suspense fallback done, but fix step 4 missing: new-mb/page.tsx post-submit redirect (target built from form.workId.trim()) and backHref from paramWorkId are not UUID-validated
- **First-pass claim:** No Cancel button; PageHeader back link changes target as the Work ID field is typed (page.tsx:74-79). Suspense without fallback.
- **Verified evidence:** new-mb/page.tsx:144-151 only a submit button, no Cancel (bills/new has one, :201-207). PageHeader back is `form.workId.trim() ? /works/billing/${workId} : /works/billing` (:73) so it changes with typed input, and could point to /works/billing/<partial text> mid-typing; real. Suspense without fallback at :160 true. Theme UUID marginal.
- **Files to change:** `apps/web/src/app/(app)/works/billing/new-mb/page.tsx`
- **Fix steps:**
  1. Compute back href from searchParams.get('workId') (stable), not form state.
  2. Add ghost Cancel Button routing to that href, disabled while busy.
  3. Add Suspense fallback skeleton.
  4. Post-submit redirect (:60) should also validate the id is a UUID before using in a path.
- **Acceptance:**
  - Typing in Work ID does not change back link.
  - Cancel returns without POST.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BILLING-BILLS-NEW-04


---
## /works/boq  —  `works/boq.html`

- **Source:** `apps/web/src/app/(app)/works/boq/page.tsx`
- **Design reference:** `redesign/works/boq.html`

### GAP-WORKS-BOQ-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: BoqTable.test.tsx Work column shows the work number; loaders.test.ts; closed by #1867)
- **First-pass claim:** The index mixes line items of every work with no Work column (BoqTable.tsx:9-17); rows are only distinguishable by an 8-char scope UUID prefix (_data/loaders.ts:341), and the row link goes to the work page which is not shown — users cannot tell which work an item belongs to.
- **Verified evidence:** BoqTable.tsx:9-17 columns have no Work column; Scope = shortId(scopeId) (loaders.ts:341) - an opaque 8-char prefix; mapBoqRow (loaders.ts:330-345) keeps workId but not a work number; rowHref (:102 in file) goes to /works/boq/{workId}. Whether the list API returns workNumber is not visible (works-service absent; other loaders read r.workNumber).
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/boq/BoqTable.tsx`, `apps/web/src/app/(app)/works/boq/page.tsx`
- **Fix steps:**
  1. Backend: confirm/add workNumber (and scope name) to GET /v1/works/boq.
  2. mapBoqRow: work = str(r.workNumber)||shortId(workId); add 'Work' as first column; replace scope with scope name.
  3. Consider grouping by work (default sort by work).
- **Acceptance:**
  - Manual: each row shows its work number.
  - Filter by work number works.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-BOQ-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: loaders.test.ts boq summary uses meta total / exact bigint sum and reports fetched count; closed by #1867)
- **First-pass claim:** Total Amount and Scopes are computed over the 100 rows fetched (pageSize=100, _data/loaders.ts:347) — for a tenant with more items the totals are silently partial.
- **Verified evidence:** loaders.ts:347 fetches /api/v1/works/boq?pageSize=100; page.tsx:10-22 computes total items, amount and scopes over that slice, with no indication of truncation. Response pagination meta (total) not visible.
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/boq/page.tsx`
- **Fix steps:**
  1. Read the total from the list response meta if present, else request a summary endpoint from backend.
  2. Use server pagination in DataTable instead of a fixed 100 fetch.
  3. If truncated, show a 'Showing first 100' hint next to the stat cards.
- **Acceptance:**
  - Test: 150 items -> Total Items shows 150 or the truncated hint.
  - Amount total equals full-set sum.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: a partial money total on a finance stat card is misleading.

### GAP-WORKS-BOQ-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty message says "once a work is selected" (BoqTable.tsx:39) but this page has no work selection control.
- **Verified evidence:** BoqTable.tsx:39 (file line 101) emptyMessage 'will appear here once a work is selected'; the page has no work selector and rows link to work pages. Copy is wrong for this screen.
- **Files to change:** `apps/web/src/app/(app)/works/boq/BoqTable.tsx`
- **Fix steps:**
  1. Change to 'No BoQ items yet. Add an item to a work to get started.'
  2. Add emptyAction linking to /works/boq/new.
- **Acceptance:**
  - Manual: empty page shows new copy and CTA.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-BOQ-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: loaders.test.ts mapBoqRow keeps srItemId; boq/page.tsx counts SR-linked lines; closed by #1867)
- **First-pass claim:** "SR Items" counts rows with any itemCode, not rows linked to a Schedule of Rates item (page.tsx:53-54); srItemId is available on the detail type (boq/[workId]/page.tsx:20) but not used here.
- **Verified evidence:** boq/page.tsx:53-54 counts rows where itemCode is set and != '—'; mapBoqRow (loaders.ts:330-345) does not map srItemId at all, so the stat cannot reflect SR linkage. srItemId exists on the detail type (boq/[workId]/page.tsx:19). Whether the list endpoint returns srItemId is not visible.
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/boq/page.tsx`
- **Fix steps:**
  1. Add srItemId: strOrNull(r.srItemId) to mapBoqRow (confirm list returns it).
  2. Count rows with srItemId for 'SR Items' and add 'Non-SR' or rename the tile 'Coded items'.
- **Acceptance:**
  - Unit: mapBoqRow keeps srItemId; count matches.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /works/boq/[workId]  —  `works/boq-workId.html`

- **Source:** `apps/web/src/app/(app)/works/boq/[workId]/page.tsx`
- **Design reference:** `redesign/works/boq-workId.html`

### GAP-WORKS-BOQ-WORKID-01  ·  HIGH  ·  partly  ·  theme TRANSPARENCY (was MONEY)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: boq/[workId]/page.test.tsx recap breakdown test; closed by #1867)
- **First-pass claim:** Recapitulation percentages are printed with no basis or order of application (page.tsx:196-229): a reviewer cannot see how Grand Total is derived from Work Amount + contingency + centage etc., and turnover tax / other charges mix % and ₹ in one column.
- **Verified evidence:** Recapitulation card (boq/[workId]/page.tsx:183-224) prints only percentages (contingency, turnover tax, work charge, QC, centage) and formatMoney for Work Amount, Other Charges and Grand Total; Recapitulation type (:22-31) has no per-line rupee amounts or basis. So reviewers cannot see the derivation, and % rows sit in the same numeric column as Rs rows: confirmed. Cannot verify the backend formula (recapitulation endpoint absent), so the actual application order is unknown.
- **Files to change:** `apps/web/src/app/(app)/works/boq/[workId]/page.tsx`, `services/works-service (backend)`
- **Fix steps:**
  1. Decision: get the recap formula (basis and order) from the works business owner.
  2. Backend: return per-component amountMinor and basis in the recapitulation response.
  3. Render columns Component | Basis | Rate % | Amount with formatMoney, ending with Grand Total; no mixing of % and ₹ in one cell.
  4. Add a footnote naming the order of application.
- **Acceptance:**
  - Manual: reviewer can recompute Grand Total from displayed rows.
  - Sum of line amounts equals Grand Total.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** High trust risk: estimate totals feed sanction; no client-side recomputation until formula is agreed.

### GAP-WORKS-BOQ-WORKID-02  ·  MEDIUM  ·  confirmed  ·  theme ERRORSTATE (was OTHER)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: boq/[workId]/page.test.tsx items-error and 404 tests; closed by #1867)
- **First-pass claim:** Failure of only one of the two fetches shows nothing to the user; notFound() fires only if both fail (page.tsx:113-117).
- **Verified evidence:** page.tsx:93-117: two fetches in Promise.all; notFound() only when both fail (:115). If items fail, DataTable shows 'No BoQ items' (:177-179); if recap fails, the card is silently omitted (:183) and the stats show '—'. No RefreshErrorState/DataSourceBadge here. Also an error on both (401/500/network) is shown as 404.
- **Files to change:** `apps/web/src/app/(app)/works/boq/[workId]/page.tsx`
- **Fix steps:**
  1. Distinguish outcomes: if source==='error' for items, render RefreshErrorState (ds) above the table instead of the empty state.
  2. If recap failed, render a small notice card 'Recapitulation unavailable' with retry.
  3. Only call notFound() when the API returns 404; otherwise render the error state.
  4. Show DataSourceBadge for each source.
- **Acceptance:**
  - Test: mocked items failure shows an error state, not 'No BoQ items'.
  - Recap failure shows the unavailable notice.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-WORKS-BOQ-WORKID-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: boq/[workId]/page.test.tsx BigInt fallback total test; closed by #1867)
- **First-pass claim:** Fallback Total Amount sums with Number() (page.tsx:126) and rows convert paise with Number() (page.tsx:136-138) — float on money; boq/page.tsx:16 uses BigInt.
- **Verified evidence:** page.tsx:126 sums Number(i.amountMinor) into formatMoney (only used when recap.grandTotal missing); :136,:138 convert rate/amountMinor with Number() for the table. Float on paise strings but exact below 2^53, so risk is theoretical; still violates the bigint rule. DataTable amount cells accept strings (billing register passes strings). Rows' quantity is passed as string OK.
- **Files to change:** `apps/web/src/app/(app)/works/boq/[workId]/page.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Add sumMinor() using BigInt to lib/money.ts and use at :126.
  2. Pass item.rate and item.amountMinor as strings to boqRows (remove Number()).
  3. Also label the fallback total as 'Sum of items (recap unavailable)'.
- **Acceptance:**
  - Unit for sumMinor.
  - Manual: values identical to before for normal data.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BILLING-WORKID-05

### GAP-WORKS-BOQ-WORKID-04  ·  LOW  ·  partly  ·  theme UUID

- [x] **Status** (W2 works: closed by #2047; BoQ detail subtitle shows the work number and description via getWorkHeader (boq/[workId]/page.tsx); page.test.tsx)
- **W0 note:** partly fixed by #1867 — empty-state Add first item action present; subtitle still shows Work ref + 8-char UUID prefix (getWorkHeader exists but not used on BoQ detail)
- **First-pass claim:** Subtitle shows "Work {8-char UUID}…" (page.tsx:151) not the work number; empty state has no action to add the first item (page.tsx:184).
- **Verified evidence:** Subtitle at page.tsx:145 is `Work ${workId.slice(0, 8)}…` (line differs from the observation): true. Empty state (:177-179) has no emptyAction, but DataTable supports emptyAction (DataTable.tsx:84,186,320) and the header does have '+ Add item' (:149-155). BoqItem has no work number field.
- **Files to change:** `apps/web/src/app/(app)/works/boq/[workId]/page.tsx`
- **Fix steps:**
  1. Pass emptyAction={<Link href={`/works/boq/new?workId=${workId}`} className='btn primary'>+ Add first item</Link>}.
  2. Subtitle: work number/name once a work lookup or backend workNumber is available; else keep short id with a title tooltip.
- **Acceptance:**
  - Manual: empty BoQ shows Add first item button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BOQ-NEW-03


---
## /works/boq/new  —  `works/boq-new.html`

- **Source:** `apps/web/src/app/(app)/works/boq/new/page.tsx`
- **Design reference:** `redesign/works/boq-new.html`

### GAP-WORKS-BOQ-NEW-01  ·  HIGH  ·  partly  ·  theme VALIDATION

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: boq/new/page.test.tsx SR pick fills unit/rate and posts srItemId; sub-paise rate rejected; closed by #1867)
- **First-pass claim:** Items are typed free-hand although the API row carries srItemId (boq/[workId]/page.tsx:20) — no Schedule of Rates lookup, so codes, units and rates can drift from the approved SR and there is no rate validation.
- **Verified evidence:** boq/new/page.tsx:47-55 posts free-typed workId, itemDescription, itemCode, unit, rate (no srItemId in the body); the API row carries srItemId (boq/[workId]/page.tsx:19,67). No SR lookup component or endpoint use exists in the page. Whether the backend validates rate against SR cannot be verified (works-service absent). Validation is only HTML required/min. Any SR-lookup endpoint is not visible - do not invent.
- **Files to change:** `apps/web/src/app/(app)/works/boq/new/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Confirm/create an SR items search endpoint (backend) e.g. /api/v1/works/masters/sr-items?q=.
  2. Add an SR item picker; on select prefill itemCode, itemDescription, unit, rate and send srItemId; allow manual override only with a 'non-SR item' flag.
  3. Add a zod schema (workId uuid, unit non-empty, rate via rupeesToMinorString, quantity positive) and run safeParse in submit().
  4. Show inline field errors and disable submit while busy.
- **Acceptance:**
  - Test: submitting rate '1.005' shows an error.
  - Manual: choosing an SR item fills unit/rate and posts srItemId.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; rates drive estimates and payments.
- **Depends on:** GAP-WORKS-BOQ-NEW-03

### GAP-WORKS-BOQ-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: boq/new/page.test.tsx grouped-rupee estimate; closed by #1867)
- **First-pass claim:** "Estimated: ₹{(rate*qty).toFixed(2)}" (page.tsx:38,238) is unformatted float: ₹125000.00, not lakh grouped, and can mis-round; formatMoney with BigInt is available.
- **Verified evidence:** Line 36-38 estimates via Number(rate)*Number(qty) .toFixed(2); rendered '₹{estimated}' at :195 without lakh grouping (e.g. ₹125000.00). Float rounding possible (e.g. 1.005-type products). Submit also does String(Math.round(Number(form.rate)*100)) at :51, the same float pattern; lib/money.ts already has rupeesToMinorString (exact, rejects >2 decimals).
- **Files to change:** `apps/web/src/app/(app)/works/boq/new/page.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Parse rate with rupeesToMinorString(form.rate); reject null.
  2. Parse quantity to a decimal string/bigint scaled by 1000 (step 0.001) and compute estimate in bigint (rateMinor*qtyMilli/1000n with a stated rounding rule).
  3. Render with formatMoney(estimateMinor).
  4. Send rate as that minor string in the body.
- **Acceptance:**
  - Unit: rate '125', qty '1000' displays ₹1,25,000.00.
  - Rate '1.005' is rejected.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium; rounding rule must match the backend amountMinor calc.
- **Depends on:** GAP-WORKS-BILLING-WORKID-05

### GAP-WORKS-BOQ-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: boq/new/page.test.tsx work chosen by number without ?workId=; closed by #1867)
- **First-pass claim:** Work ID is a pasted UUID unless the user arrives from a work page (page.tsx:99-118).
- **Verified evidence:** boq/new/page.tsx:18 initial workId from ?workId=; otherwise the input at :103-113 is a plain text field labelled 'Work ID (UUID) *' with a UUID placeholder. No picker exists in the repo (no EntityPicker in app/_components/ds). A works list loader may exist elsewhere; not confirmed.
- **Files to change:** `apps/web/src/app/(app)/works/boq/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Create shared <EntityPicker> in ds (async search combobox, value=id, shows label) - used by billing/new-mb, bills/new, measurements/new too.
  2. Feed it from an existing works list endpoint (find the loader; otherwise backend needs GET /v1/works?q=).
  3. When workId comes from the query string, render it read-only with the work name.
  4. Validate uuid with zod.
- **Acceptance:**
  - Manual: opening /works/boq/new without workId lets me search by work number.
  - No UUID visible in the UI.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** EntityPicker (new shared)

### GAP-WORKS-BOQ-NEW-04  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W2 works: closed by #2047; quantity sent as a decimal string (boq/new/page.tsx) and accepted by works-service boqQuantitySchema (boq/validators.ts); boq-quantity-string.test.ts + boq/new/page.test.tsx; W2 works rescan: completed by #2133)
- **W2 rescan note:** POST /v1/works/boq answers a duplicate line synchronously with 409 DUPLICATE_BOQ_LINE (flat envelope); the form shows it on the item code (or description) field with the data kept, plus an early check on blur against the work BoQ list; Suspense SkeletonCard fallback has a test
- **W0 note:** partly fixed by #1867 — 409 mapped to inline message and Suspense SkeletonCard done; quantity still sent as Number(), not a decimal string
- **First-pass claim:** No duplicate-item check within a work; quantity sent as JS number (page.tsx:52). Suspense has no fallback.
- **Verified evidence:** No duplicate check anywhere in submit (:40-74). Quantity sent as JS number (:52) while rate is a string (:51). Suspense at :236 has no fallback. Backend duplicate handling not visible (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/boq/new/page.tsx`
- **Fix steps:**
  1. Send quantity as a decimal string validated by zod (regex ^\d+(\.\d{1,3})?$) and change the API accordingly (backend may need to accept string).
  2. On 409 from the API map to a field error 'Item already exists for this work'; optionally pre-check against the work's BoQ list.
  3. Give <Suspense fallback={<Skeleton/>}>.
- **Acceptance:**
  - Test: duplicate itemCode returns inline error.
  - Suspense fallback renders skeleton.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-BOQ-NEW-01


---
## /works/closure  —  `works/closure.html`

- **Source:** `apps/web/src/app/(app)/works/closure/page.tsx`
- **Design reference:** `redesign/works/closure.html`

### GAP-WORKS-CLOSURE-01  ·  HIGH  ·  confirmed  ·  theme DEADEND (was DEADROUTE)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ClosureTable.test.tsx rows link to the work; closure/page.tsx:26 links to closure/new; closed by #1867)
- **First-pass claim:** The register has no action or link at all (closure/page.tsx, ClosureTable.tsx:67-79): a closure/drop/completion cannot be initiated from the UI and rows do not open the work — dead-end list.
- **Verified evidence:** closure/page.tsx:8-14 header has only `back`; ClosureTable.tsx:67-79 DataTable has no rowHref or actions; mapClosureRow (loaders.ts:290-304) does not even keep workId. There is no closure/new route (dir has only page, table, loading). The closure POST endpoint is not visible (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/closure/page.tsx`, `apps/web/src/app/(app)/works/closure/ClosureTable.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/closure/new/page.tsx (new)`
- **Fix steps:**
  1. Confirm the backend create endpoint (e.g. POST /v1/works/closure) and its body.
  2. Add closure/new form (work picker, type closed/dropped/completion, closedDate, remarks) using zod + audit-friendly ConfirmDialog.
  3. Keep workId in mapClosureRow and add rowHref to the work's page (or /works/execution).
  4. Add '+ New closure' in the PageHeader actions.
- **Acceptance:**
  - Manual: can create a closure and see it in the right tab.
  - Row click opens the work.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; closing/dropping a work is a state change needing authority and audit.
- **Depends on:** GAP-WORKS-BOQ-NEW-03

### GAP-WORKS-CLOSURE-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ClosureTable.test.tsx Agreement column; closure-list-agreement.test.ts (service); closed by #1867)
- **First-pass claim:** Agreement number was dropped because closures do not join awards (ClosureTable.tsx:9-21): the register cannot answer "which contract was this?".
- **Verified evidence:** ClosureTable.tsx:9-21 documents the removal: work_closures has no agreement number; only awards.agreementNumber (tender schema) exists and listClosures does not join. Cannot verify backend. Choice among multiple awards is a product decision.
- **Files to change:** `apps/web/src/app/(app)/works/closure/ClosureTable.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `services/works-service (backend)`
- **Fix steps:**
  1. Decision: which award (latest / finalized) supplies the agreement number.
  2. Backend: join or enrich in listClosures and return agreementNumber.
  3. Re-add the Agreement column and map r.agreementNumber.
- **Acceptance:**
  - Manual: closure rows show agreement number.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; wrong award choice would misidentify the contract.

### GAP-WORKS-CLOSURE-03  ·  MEDIUM  ·  confirmed  ·  theme FILTER (was NAVUX)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Tab filter compares closureType exactly to closed/dropped/completion (ClosureTable.tsx:31); any other server value (unknown vocabulary, works-service absent) is counted in Total but appears under no tab.
- **Verified evidence:** ClosureTable.tsx:31 (file line 172) filters exact lowercase compare with tab; stat cards in page.tsx:5-8 count only three values but Total = all rows. mapClosureRow defaults missing closureType to 'closed' (loaders.ts:~300), but any other string appears in no tab. Allowed closureType values not visible.
- **Files to change:** `apps/web/src/app/(app)/works/closure/ClosureTable.tsx`, `apps/web/src/app/(app)/works/closure/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Define CLOSURE_TYPES in _data/types.ts and normalise in mapClosureRow (unknown -> 'other').
  2. Add an 'All' tab (default) and an 'Other' tab when count>0, or fold unknown into 'All' only.
  3. Use the shared Tabs component (ds/Tabs.tsx) with counts.
- **Acceptance:**
  - Test: a row with closureType 'suspended' appears under All and in Total.
  - Tab counts sum to Total.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-CLOSURE-04  ·  LOW  ·  partly  ·  theme COPY (was DATEFMT)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ClosureTable.test.tsx per-tab date column and empty copy; closed by #1867)
- **First-pass claim:** "No completion works to display." (ClosureTable.tsx:78) uses the raw key; Status Date is the single column for three different meanings (closed date for all types, _data/loaders.ts:302).
- **Verified evidence:** ClosureTable.tsx:78 (file line 219) emptyMessage `No ${tab} works to display.` prints the key 'completion' ('No completion works...') vs tab label 'Completion List': true. statusDate = fmtDate(closedDate) for every type (loaders.ts:302) so the column name 'Status Date' hides that it is the closed date: true. fmtDate (format.ts:5-10) uses toLocaleDateString en-IN without timeZone, unlike formatIndianDate in lib/formatters.ts. Theme DATEFMT is secondary; primarily copy.
- **Files to change:** `apps/web/src/app/(app)/works/closure/ClosureTable.tsx`, `apps/web/src/app/(app)/works/_data/format.ts`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Add a TAB_LABEL map and use it in emptyMessage (e.g. 'No works in the completion list.').
  2. Rename column to 'Date' with per-tab labels (Closed on / Dropped on / Completed on).
  3. Replace fmtDate with formatIndianDate from lib/formatters (IST).
- **Acceptance:**
  - Manual: completion tab empty message reads correctly.
  - Column header changes per tab.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /works/contractors  —  `works/contractors.html`

- **Source:** `apps/web/src/app/(app)/works/contractors/page.tsx`
- **Design reference:** `redesign/works/contractors.html`

### GAP-WORKS-CONTRACTORS-01  ·  HIGH  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** No row link: the DataTable has no rowHref (page.tsx:116-130), so /works/contractors/[id] (rating, edit, history) is unreachable from the register.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/page.tsx:116-127: <DataTable> has sortable/filterable/pageSize but no rowHref or rowLinkKey/rowLinkPrefix (DataTable.tsx:55-58,210-214), so nothing links to /works/contractors/[id], which exists and holds rating/edit/history. Finding's line range 116-130 is right. Server-safe fix exists: rowLinkKey+rowLinkPrefix (rows already carry id, ContractorRow line 18).
- **Files to change:** `apps/web/src/app/(app)/works/contractors/page.tsx`
- **Fix steps:**
  1. Add rowLinkKey="id" rowLinkPrefix="/works/contractors/" and identifyingColumnKey="name" to the DataTable (works from a Server Component).
  2. Verify the id column is not displayed (it isn't in `columns`) and first column (Name) becomes the link.
- **Acceptance:**
  - Component/page test: rendered Name cell is an anchor with href /works/contractors/<id>.
  - Manual: keyboard Enter on a row opens the detail page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-WORKS-CONTRACTORS-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** PAN is shown in full to anyone who can open the page (page.tsx:74,55); PAN of a proprietor is personal data under DPDP — no masking or role gate.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/page.tsx:55 maps pan: String(row.pan ?? "—") and line 74 lists it as a column, so full PAN plus phone (line 75) are rendered to anyone who can load the page. DataTable here has no exportable prop, so no CSV export exists on this list (the 'gate CSV' part is n/a). No role gate on the page. Server-side field-level filtering is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;).
- **Files to change:** `apps/web/src/app/(app)/works/contractors/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Use the shared <Masked kind="pan"> (see DETAIL-02) via a column `render` - requires making the table a client wrapper since render can't cross RSC; or pre-mask in mapContractors (maskPan helper) and leave reveal to the detail page.
  2. Simplest: mask PAN and phone in mapContractors (XXXXX1234X, 98XXXXXX10) and drop full values from the list payload sent to the client.
  3. Keep the PAN filterable via last-4 only (filter searches the masked string).
- **Acceptance:**
  - Unit test maskPan('AAAPZ1234C') = 'XXXXX1234C'; list HTML contains no full PAN.
  - Manual: register shows masked PAN; detail page shows reveal control.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Users who search the register by full PAN will lose that ability; agree on last-4 search.
- **Depends on:** GAP-WORKS-CONTRACTORS-DETAIL-02

### GAP-WORKS-CONTRACTORS-03  ·  MEDIUM  ·  partly  ·  theme CAP (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9; W2 works rescan: completed by #2133)
- **W2 rescan note:** works-service honours ?pageSize/?page (max 200) and returns meta.total; the register shows the true total and Showing the first N of M; w2 tests: contractor-cluster02.test.ts, contractors/page.test.tsx, real-DB paging
- **First-pass claim:** No pagination param on the request (page.tsx:68 fetches /api/v1/works/contractors without pageSize) and no cache/offline layer, unlike the other list pages that use useSeededResource.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/page.tsx:65 fetches "/api/v1/works/contractors" with no pageSize (other works loaders use ?pageSize=100, e.g. works/_data/loaders.ts:85,133), so the backend default limit applies silently and stats (lines 83-86) and 'Contractors (N)' are computed from that partial page; default is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;). Also on fetch failure the stat cards show 0 and the table shows 'No contractors registered' (only a badge signals the error) - a failure mask. Overstated: 'FABRICATED' is the wrong theme, and useSeededResource is used only by a few list pages (ModuleListPage, admin/editions), not 'the other list pages' generally.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/page.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Request an explicit ?pageSize=100 (match sibling loaders) and read total from the API response if provided; show 'Showing first 100 of N' when N>100.
  2. When source==="error" render <LoadErrorState result={...} area="contractors"> instead of stats + empty table (fetchJson result already has status/errorMessage).
  3. Optional: move to useSeededResource for offline cache only if the works module adopts it.
- **Acceptance:**
  - Test: fetch URL contains pageSize=100.
  - Test: source:'error' renders retry state, not zeroed StatCards.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Server pagination needs a total from the API; verify response shape.

### GAP-WORKS-CONTRACTORS-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Status is plain text "Active"/"Inactive" and rating a string — neither sorts meaningfully (rating "10/5" style strings sort lexically); other registers use cellType status pills (page.tsx:69-76).
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/page.tsx:58 activeStatus is the plain string 'Active'/'Inactive' with no cellType, and rating is a formatted string `${perf}/5 (${count} reviews)` (lines 31-37, columns 76-77). Sorting is not purely lexical: DataTable.compareValues (DataTable.tsx:160-171) falls back to localeCompare with numeric:true, so '10 reviews' > '9 reviews' works, but decimals (4.5 vs 4.25) and the 'Not rated' text still sort wrongly and the unrounded `${perf}` can print 4.333333. A 'rating "10/5"' case cannot occur (max 5). cellType="status" exists (DataTable.tsx:47,127) and StatusPill maps active/inactive.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/page.tsx`
- **Fix steps:**
  1. Add ratingValue: number|null (raw performanceRating) and reviewCount to ContractorRow; keep display string separate.
  2. Set the status column to cellType: "status" (StatusPill).
  3. Format rating with toFixed(1) and sort on numeric ratingValue (add sort accessor or use a numeric column with cellType-less render; DataTable has no sortKey override, so either make the Rating column the numeric one and put review count in a separate 'Reviews' column).
- **Acceptance:**
  - Unit test: rows with ratings 4.5, 4.25, null sort 4.25 < 4.5, null last/first consistently.
  - Visual: Status column shows coloured pill.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-CONTRACTORS-05  ·  LOW  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** "+ Register contractor" not role-gated though editing is (ContractorEditToggle.tsx:24); StatCard icons are emoji with fallback hex colours (page.tsx:109-114).
- **Verified evidence:** Role gate part confirmed: apps/web/src/app/(app)/works/contractors/page.tsx:98-104 renders '+ Register contractor' for everyone; write roles live in apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx:156 (not line 24). Emoji part is overstated: StatCard passes the emoji to StatIcon (ds/StatIcon.tsx maps '🏢'->Building2, '⭐'->Star etc. to lucide SVGs), and hex fallbacks in var(--x, #hex) (lines 110-113) are the codebase-wide pattern.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/page.tsx`, `apps/web/src/lib/works/roles.ts`
- **Fix steps:**
  1. Make the page read getSessionRoles() and render the Register link only when roles intersect CONTRACTOR_WRITE_ROLES (shared list from lib/works/roles.ts).
  2. Leave StatCard icons as is (optionally swap 🔲 if StatIcon has no mapping - verify).
- **Acceptance:**
  - Test: read-only role does not see the Register button; works_admin does.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Role list must match backend.
- **Depends on:** GAP-WORKS-CONTRACTORS-NEW-02


---
## /works/contractors/[id]  —  `works/contractors-detail.html`

- **Source:** `apps/web/src/app/(app)/works/contractors/[id]/page.tsx`
- **Design reference:** `redesign/works/contractors-detail.html`

### GAP-WORKS-CONTRACTORS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** A contractor fetch failure returns notFound() (page.tsx:133) so outages look like "contractor does not exist" and the hasApiError badge (page.tsx:130,190) is dead code.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/[id]/page.tsx:105-133: fetchJson result is destructured as only {data, source}; line 133 `if (source === "error" || !contractor.id) return notFound()`. fetchJson (apps/web/src/app/_data/apiClient.ts:141-144,170-172) returns source:"error" with status/errorMessage for 401/403/5xx/network/invalid payload, so all become a 404 page. hasApiError (line 132) is only read at line 182 (DataSourceBadge), which is unreachable because notFound() already returned. Related: the rating-history fetch (line 105, destructures only data) failing silently renders 'No ratings recorded yet.' (line 299-301). Existing pattern to copy: hr/employees/[id]/page.tsx:96-105 uses LoadErrorState with status/errorMessage.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status and errorMessage from the contractor fetchJson result, and source/status from the rating-history result.
  2. If source==="error" && status===404 keep notFound(); if source==="error" otherwise, return a page shell (PageHeader back=/works/contractors) containing <LoadErrorState result={{status,errorMessage}} area="contractor" backHref="/works/contractors" /> (handles 403 as PermissionDenied, others as RefreshErrorState with retry).
  3. Keep notFound() for source==="api" && !contractor.id only.
  4. Remove the dead hasApiError/DataSourceBadge branch or use it for the rating-history failure.
  5. For rating-history source==="error", render an inline RefreshErrorState/DataSourceBadge in the Rating History card instead of the 'No ratings recorded yet' text.
- **Acceptance:**
  - Component/page test: mock fetchJson to return {source:'error',status:500} -> page renders retry error state, not notFound.
  - Mock status 403 -> PermissionDenied 'Access restricted'; status 404 -> notFound().
  - Mock history error with contractor OK -> history card shows error, not 'No ratings recorded yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only changes failure rendering. Ensure 404 from the API still yields notFound so real missing ids are not shown as outages.

### GAP-WORKS-CONTRACTORS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** PAN, GST, phone and email are shown twice — in KPI cards and again in Contact Details (page.tsx:135-151) — unmasked to every viewer; contractor PAN/phone can be an individual’s personal data (DPDP).
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/[id]/page.tsx:135-142 (kpiItems PAN/GST/Phone/Email) and apps/web/src/app/(app)/works/contractors/[id]/page.tsx:144-151 (contactFields Address/Email/Phone/PAN/GST) both print raw contractor.pan/gst/phone/email as plain strings; no masking component exists in the repo (grep for Masked/maskPan finds only integration-secret strings). No role check for viewing PII on this page (getSessionRoles is used only for canRate at line 102-103). Extra leak: lines 342-354 pass full pan/gst/email/phone to the client component ContractorEditToggle for every viewer, so the values are serialised into the RSC payload even when the toggle returns null for non-editors (E:174-176). No CSV export exists on this page. Whether the detail GET is audited/PII-logged is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;).
- **Files to change:** `apps/web/src/app/(app)/works/contractors/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx`, `apps/web/src/lib/works/roles.ts (new)`
- **Fix steps:**
  1. Create ds/<Masked value kind="pan|phone|email|gstin" canReveal> (client) showing e.g. XXXXX1234X / 98XXXXXX10 / a***@d.com with a Reveal button (aria-pressed) that unmasks and calls a reveal-audit endpoint (see needs); export via ds/index.ts.
  2. In kpiItems remove PAN/GST/Phone/Email tiles (keep Status, Registered Since, maybe Reg. No.) so each identifier appears once, in Contact Details.
  3. In contactFields render PAN/Phone/Email via <Masked>; canReveal derived from a shared role list in lib/works/roles.ts (DECISION: which roles may reveal; works_admin/super_admin suggested).
  4. Only pass the full contractor object to <ContractorEditToggle> when canEdit; otherwise pass null so PII is not serialised to non-editors.
  5. Firm GSTIN is business data; decide whether to mask only PAN whose 4th char is 'P' (individual) - record the decision in the component doc.
- **Acceptance:**
  - Unit test Masked: default render never contains the full PAN string in DOM; after Reveal click it does, and the audit callback fires once.
  - Page test: viewer without reveal role sees masked PAN/phone/email and the HTML/RSC payload for the edit toggle does not contain the raw values.
  - Manual: PAN appears once on the page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP. Operators need PAN for TDS/bills, so over-masking can block work; reveal audit needs a backend endpoint/event that is not visible in this snapshot.
- **Depends on:** Masked (new shared ds component), GAP-WORKS-CONTRACTORS-02

### GAP-WORKS-CONTRACTORS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9; W2 works rescan: completed by #2133)
- **W2 rescan note:** rating-history now carries ratedByName resolved server-side via identity-service user-summaries (fail-open to null; only the asked-for ids returned); contractor-cluster02.test.ts
- **First-pass claim:** Rated By shows the first 8 chars of a UUID (page.tsx:172); history rows have no comment/criteria so a rating cannot be justified or audited.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/[id]/page.tsx:168-173 maps ratedBy: r.ratedBy?.slice(0, 8) ?? "—"; RatingHistoryRow (apps/web/src/app/(app)/works/contractors/[id]/page.tsx:28-33) and mapRatingHistory (lines 70-90) carry only id, rating, ratedAt, ratedBy - no comment, criteria or work reference, and the write path apps/web/src/app/(app)/works/contractors/[id]/ContractorRatingForm.tsx:46-52 sends only {rating}. Additional: mapRatingHistory falls back to Math.random() as row id (line 81). Whether the rating-history API returns a name/comment is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;).
- **Files to change:** `apps/web/src/app/(app)/works/contractors/[id]/page.tsx`, `apps/web/src/app/(app)/works/contractors/[id]/ContractorRatingForm.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Backend: extend rating-history response with ratedByName (resolved server-side, no cross-service SQL) and optional comment/workId; extend PATCH /contractors/:id/rate to accept comment.
  2. Web: add ratedByName/comment to RatingHistoryRow + mapRatingHistory; render name (fallback '—', never a UUID slice) and a Comment column in the DataTable.
  3. Replace the Math.random() row-id fallback with index-based key.
  4. Until backend ships, replace the 8-char UUID with '—' rather than showing an opaque fragment.
- **Acceptance:**
  - mapRatingHistory test: payload with ratedByName renders the name; payload without it renders '—' (no UUID text).
  - Manual: history table shows date, stars, rater name, comment.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low on web; backend contract change to rating payload must stay backward compatible.
- **Depends on:** GAP-WORKS-CONTRACTORS-DETAIL-04

### GAP-WORKS-CONTRACTORS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [~] **Status** (W2 works rescan: PARTLY done by #2133; NEEDS OWNER DECISION: the cooling-off length between two ratings of one contractor by one officer, and whether it blocks; ready: works-service enforces WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS (409 RATING_COOLDOWN, unset = off) in route and consumer, the form warns from the same server value, the audit event carries the reason, a rating can link a work (migration 0153); GAP-WORKS-CONTRACTORS-DETAIL-04)
- **First-pass claim:** Rating is one 1–5 star tap with a generic confirm and no reason (ContractorRatingForm.tsx:88-130); a contractor can be re-rated repeatedly with no visible cooldown or per-work link.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/[id]/ContractorRatingForm.tsx:88-105 star buttons set selectedRating; Submit (110-114) opens ConfirmDialog (117-129) with only description `Rate this contractor N/5 stars?` - no requireReason (ConfirmDialog supports requireReason/reasonLabel/minReasonLength). handleConfirm (41-67) PATCHes {rating} only; nothing on the client prevents repeated re-rating (selectedRating reset at line 61; no cooldown, no per-work link). Whether the backend rejects/limits repeat ratings or emits an audit event is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;). Note: maker!=checker in the finding is not really applicable to a rating; a per-work link and reason are the meaningful controls.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/[id]/ContractorRatingForm.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. In <ConfirmDialog> at lines 117-129 set requireReason, reasonLabel="Reason / basis for rating", minReasonLength={10}; change onConfirm to receive (reason) and send it as {rating, comment: reason} (needs backend field).
  2. Add an optional Work selector (see execution EntityPicker finding) to link the rating to a work order once backend supports workId.
  3. Show last-rated date and disable Submit / warn when the same user rated within N days (needs ratedAt/ratedBy of latest from rating-history, already fetched on the page - pass it as a prop).
  4. Backend: enforce cooldown + emit audit event with reason; return 409 with a clear message that useFormError surfaces.
- **Acceptance:**
  - Component test: Confirm button disabled until reason >=10 chars; request body contains comment.
  - Component test: 409 response shows the message inside the dialog and keeps it open.
  - Manual: rating twice in a row shows the cooldown warning.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Adds required field to a live PATCH; keep comment optional server-side for older clients. Rating affects tender eligibility so audit trail matters.
- **Depends on:** GAP-WORKS-CONTRACTORS-DETAIL-03

### GAP-WORKS-CONTRACTORS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Star display rounds to integer stars (page.tsx:112-116) but shows one decimal beside it; the rating card is drawn as "Rate Contractor" even for roles that only get the permission sentence.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/[id]/page.tsx:92-95 starDisplay uses Math.round(rating) (4.5 -> 5 filled stars) while lines 207-209 print performanceRating.toFixed(1) ('4.5 / 5.0'). Line numbers in the finding (112-116) were wrong. The 'Rate Contractor' Card (lines 286-295) is always rendered, and ContractorRatingForm returns only 'You do not have permission to rate contractors.' when !canRate (apps/web/src/app/(app)/works/contractors/[id]/ContractorRatingForm.tsx:31-37).
- **Files to change:** `apps/web/src/app/(app)/works/contractors/[id]/page.tsx`
- **Fix steps:**
  1. Change starDisplay to floor to half-stars (or use Math.floor) so the stars never exceed the printed value; add half-star glyph or keep floor.
  2. Wrap the 'Rate Contractor' Card in `{canRate && ...}`, and show nothing (or a muted one-line note) for read-only roles.
  3. Move the inline banner styles to a class while there (optional).
- **Acceptance:**
  - Unit test starDisplay(4.5) shows 4 filled (or 4.5) stars, never 5.
  - Page test: viewer without a rate role has no 'Rate Contractor' heading.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic only.


---
## /works/contractors/new  —  `works/contractors-new.html`

- **Source:** `apps/web/src/app/(app)/works/contractors/new/page.tsx`
- **Design reference:** `redesign/works/contractors-new.html`

### GAP-WORKS-CONTRACTORS-NEW-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** PAN, GSTIN, mobile and email are accepted with no client validation of format (page.tsx:102-148) — PAN 10 / GSTIN 15 chars only capped by maxLength — so malformed tax identifiers enter the contractor master and later bills/TDS.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/new/page.tsx:110-161: pan input has only maxLength=10 and uppercase transform (handleChange 31-38), gst maxLength=15, phone maxLength=20 with inputMode numeric, email type=email (browser-validated only; form has no noValidate so it does get native email check). submit() (40-75) builds the body with no format checks. The sibling edit form has the same gap (apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx:236-243). Server-side zod rules for create are cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;); a comment in apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx:224-235 says update uses pan .length(10) and email .email(), i.e. length-only for PAN, so malformed PAN/GSTIN likely pass.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/new/page.tsx`, `apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx`, `apps/web/src/lib/validation/indianIds.ts (new)`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Create lib/validation/indianIds.ts with zod schemas: PAN /^[A-Z]{5}[0-9]{4}[A-Z]$/, GSTIN /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/ (+ check that GSTIN chars 3-12 equal PAN when both given), mobile /^[6-9][0-9]{9}$/, email.
  2. In submit() parse the trimmed form with a zod object schema before fetch; on failure set per-field errors and do not call the API. Show errors under each input (aria-describedby, aria-invalid).
  3. Reuse the same schema in ContractorEditToggle.handleSubmit.
  4. Backend: mirror the regexes in the works-service create/update zod schemas (CLAUDE.md rule 9).
- **Acceptance:**
  - Unit tests for schemas: valid AAAPZ1234C passes; 'ABCDE12345' and 'abcde1234f' fail; GSTIN with wrong PAN segment fails; 9-digit mobile fails.
  - Component test: submitting 'BAD' PAN shows inline error and fetch is not called.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Stricter rules may reject legacy/foreign contractors; keep PAN/GSTIN optional as today and confirm whether mobile must be Indian.

### GAP-WORKS-CONTRACTORS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate on the page although editing is restricted to WRITE_ROLES (ContractorEditToggle.tsx:24); PageHeader has no subtitle or back link (page.tsx:72).
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/new/page.tsx is a 'use client' page (line 1) with no role check; the edit-side WRITE_ROLES is in apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx:156 (finding said line 24), and detail page has a duplicate CONTRACTOR_RATE_ROLES (apps/web/src/app/(app)/works/contractors/[id]/page.tsx:58-64). PageHeader at apps/web/src/app/(app)/works/contractors/new/page.tsx:78 has only title (no subtitle/back), though a Cancel button exists (lines 131-137 region). Server-side enforcement of create is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;).
- **Files to change:** `apps/web/src/app/(app)/works/contractors/new/page.tsx`, `apps/web/src/app/(app)/works/contractors/new/layout.tsx (new)`, `apps/web/src/app/(app)/works/contractors/page.tsx`, `apps/web/src/app/(app)/works/contractors/[id]/ContractorEditToggle.tsx`, `apps/web/src/app/(app)/works/contractors/[id]/page.tsx`, `apps/web/src/lib/works/roles.ts`
- **Fix steps:**
  1. Create lib/works/roles.ts exporting CONTRACTOR_WRITE_ROLES and reuse it in ContractorEditToggle, contractors/[id]/page.tsx and the new files (removes 3 duplicated arrays).
  2. Add contractors/new/layout.tsx (server component) calling requireAnyRole(CONTRACTOR_WRITE_ROLES, "/works/contractors") from lib/auth/roleGuard, or render PermissionDenied.
  3. Add subtitle and back="/works/contractors" backLabel="Contractors" to PageHeader.
  4. Confirm with backend that POST /contractors enforces the same roles.
- **Acceptance:**
  - Test: session with only a read role visiting /works/contractors/new is redirected/denied.
  - Test: works_admin sees the form with a back link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Role list must match the backend or legit users get locked out; today the lists are duplicated by hand.
- **Depends on:** GAP-WORKS-CONTRACTORS-05

### GAP-WORKS-CONTRACTORS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Personal identifiers (PAN, mobile, email) collected without a DPDP purpose/notice line and no audit hint.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/new/page.tsx:84-161 collects PAN, email, mobile with no purpose/notice text (only placeholders); no consent/notice component exists in apps/web ds. Audit emission on create is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;). The generated fix text about <Masked>/CSV does not apply to an input form.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/new/page.tsx`, `apps/web/src/app/_components/ds/DpdpNotice.tsx (new)`
- **Fix steps:**
  1. DECISION: get approved DPDP notice wording (purpose: contractor empanelment, TDS/GST compliance; retention; data-fiduciary contact).
  2. Create small <DpdpNotice purpose="..."/> ds component and render it above the identifier fields (PAN, email, mobile) in the form.
  3. Add helper text 'Changes to this record are logged.' only if backend audit is confirmed.
  4. Backend: verify contractor create/update emit audit events via @civitasone/events (CLAUDE.md rule 8).
- **Acceptance:**
  - Visual: notice visible above PAN/email/mobile and read by screen readers (role=note).
  - Backend test: POST /contractors emits one audit event.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Legal wording must be signed off; no functional risk.

### GAP-WORKS-CONTRACTORS-NEW-04  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** GSTIN placeholder "29ABCDE1234F1Z5" is a Karnataka state code (29); Odisha GSTINs start 21 (page.tsx:121). Inline banner "Registered." is terse.
- **Verified evidence:** apps/web/src/app/(app)/works/contractors/new/page.tsx:131 placeholder "29ABCDE1234F1Z5" (29 = Karnataka; Odisha is 21) - finding said line 121. Inline 'Registered.' is set at line 66 and shown in okBanner (lines 80-81 region) alongside a toast, then router.push after 600 ms; the banner is redundant and terse. Placeholder is example text, not data, so 'fabricated' is overstated.
- **Files to change:** `apps/web/src/app/(app)/works/contractors/new/page.tsx`
- **Fix steps:**
  1. Change GSTIN placeholder to "21ABCDE1234F1Z5" (keep PAN segment consistent with the PAN placeholder ABCDE1234F).
  2. Drop the okBanner or change message to 'Contractor registered. Redirecting to the register...'.
- **Acceptance:**
  - Visual check of placeholder and success message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /works/execution  —  `works/execution.html`

- **Source:** `apps/web/src/app/(app)/works/execution/page.tsx`
- **Design reference:** `redesign/works/execution.html`

### GAP-WORKS-EXECUTION-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: loaders.test.ts progress rows show work number + scope description; closed by #1867)
- **First-pass claim:** Work and Scope columns print 8-character UUID prefixes (loaders.ts:250-251 shortId) — a clerk cannot tell which work or scope a row belongs to without opening it.
- **Verified evidence:** apps/web/src/app/(app)/works/_data/loaders.ts:230-241 mapProgressRow sets work: shortId(workId) and scope: shortId(scopeId) (8 chars + ellipsis, apps/web/src/app/(app)/works/_data/format.ts:20-23); the issues mapper does the same for work (:243-252). Columns are declared at apps/web/src/app/(app)/works/execution/ExecutionTable.tsx:37-43. Line numbers in the observation (250-251) are off; the real ones are ~235-236. Whether the progress endpoint returns workNumber/description cannot be verified (works-service absent); closure list does return workNumber via a proposals join, so an equivalent join is plausible backend work.
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/execution/ExecutionTable.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Check whether GET /v1/works/execution/progress and /issues can return workNumber and scope description like listClosures does; if not, request that join in works-service.
  2. In mapProgressRow/mapIssueRow use str(r.workNumber) || shortId(...) exactly like mapClosureRow.
  3. For the scope column use description (as in record-progress pickScopes) else catalog name.
  4. Keep workId in the row for rowHref; hide the UUID fallback behind a title tooltip.
- **Acceptance:**
  - Unit test: row with workNumber 'W-2025-014' renders that, not a UUID prefix.
  - Manual: list shows number plus title for every row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; display. Backend join must respect module isolation (CLAUDE.md rule 4) - use a read model rather than a cross-module JOIN.
- **Depends on:** GAP-WORKS-EXECUTION-WORKID-01

### GAP-WORKS-EXECUTION-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat cards silently show 0 when both fetches fail (page.tsx:9-20); the only error signal is the tab-level badge, which is absent when provenance is "live" for an empty seeded result.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/page.tsx:7-17 defaults both loaders to empty arrays; StatCards (:42-46) print 0 on error (total, onTrack, delayed, completed, openIssues). The badge claim is overstated: ExecutionTable seeds provenance from the server source (apps/web/src/app/(app)/works/execution/ExecutionTable.tsx:93,99,134; resource.ts deriveProvenance), so on a failure it shows 'Couldn't load' unless a cache copy exists; 'live' only appears for a genuinely empty success. Real problems: (1) stats stay 0 while the table may show cached rows, contradicting each other; (2) page.tsx:10 ORs both sources into one, so if only issues fail the progress tab is also marked errored and its cache is not refreshed (useSeededResource serverUsable requires source==='api').
- **Files to change:** `apps/web/src/app/(app)/works/execution/page.tsx`, `apps/web/src/app/(app)/works/execution/ExecutionTable.tsx`
- **Fix steps:**
  1. Pass progressSource and issuesSource separately into ExecutionTable and use each in its own useSeededResource call.
  2. In page.tsx pass null to StatCard for values whose source is 'error' (progressFailed -> total/onTrack/delayed/completed; issuesFailed -> openIssues).
  3. Optionally move stats into the client component so they follow the same provenance/cached data as the table.
  4. Show RefreshErrorState above the table when both fail and nothing is cached.
- **Acceptance:**
  - Component test: progress error -> stat cards show '—', issues card unaffected.
  - Component test: issues error only -> progress tab not flagged as error.
  - Manual: kill API, reload -> no zeros.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; view only.
- **Depends on:** GAP-WORKS-EXECUTION-03

### GAP-WORKS-EXECUTION-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: execution/page.test.tsx mutually exclusive buckets sum to total; closed by #1867)
- **First-pass claim:** Status buckets leave a gap: On Track is >= 80 and Delayed is 0 < p < 50, so entries at 50-79% are counted nowhere, and 0% entries are neither delayed nor on track (page.tsx:14-19). The "Completed" 100% rows are also counted in On Track.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/page.tsx:12-16: onTrack = pct>=80, delayed = 0<pct<50, completed = pct===100. Rows at 50-79% and at exactly 0% appear in no bucket; 100% rows are counted in both On Track and Completed. 'Delayed' is defined purely by low percentage with no reference to planned dates, so a scope just started reads 'delayed'.
- **Files to change:** `apps/web/src/app/(app)/works/execution/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Agree bucket definitions with the business (decision) and put them in one helper progressBucket(pct) exported from _data/format.ts.
  2. Make buckets mutually exclusive, e.g. completed >=100, onTrack 80-<100, inProgress 50-<80, atRisk >0-<50, notStarted 0; card sum must equal total.
  3. If Delayed should be schedule-based, compute it from plannedEnd vs today (needs plannedEnd in the progress row - verify).
  4. Add a unit test asserting buckets sum to total.
- **Acceptance:**
  - Unit test: pct values 0, 30, 50, 79, 80, 99, 100 each fall in exactly one bucket.
  - Manual: card counts add up to Progress Entries.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Stat labels are read by management as delay indicators; a changed definition shifts reported numbers.

### GAP-WORKS-EXECUTION-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was NAVUX)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Tabs are plain buttons with role="tab" but no tabpanel/aria-controls and use Tailwind utility classes (ExecutionTable.tsx:63-77) unlike the DS Tabs used elsewhere.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/ExecutionTable.tsx:110-127 uses <button role='tab'> with Tailwind classes (bg-primary, bg-muted) and the panels (:135-165) have no role='tabpanel', ids or aria-controls/aria-labelledby; arrow-key navigation is also missing. Caveat: the DS Tabs component (apps/web/src/app/_components/ds/Tabs.tsx) also has no tabpanel/aria-controls (span-based tabs, has roving tabindex and arrow keys), so switching to it only fixes styling and keyboard, not the panel linkage.
- **Files to change:** `apps/web/src/app/(app)/works/execution/ExecutionTable.tsx`, `apps/web/src/app/_components/ds/Tabs.tsx`
- **Fix steps:**
  1. Extend ds Tabs to accept an optional idPrefix and render id/aria-controls on each tab; export a TabPanel wrapper with role='tabpanel' aria-labelledby.
  2. Replace the two raw buttons in ExecutionTable with <Tabs tabs={['Progress','Issues']}>.
  3. Wrap each DataTable in the TabPanel.
  4. Update Tabs tests for the new attributes.
- **Acceptance:**
  - Component test: selected tab has aria-controls matching the visible panel id.
  - Component test: ArrowRight moves selection to Issues.
  - axe check passes on the page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Tabs is shared; keep new props optional to avoid regressions elsewhere.
- **Depends on:** ds/Tabs

### GAP-WORKS-EXECUTION-05  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1867, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx shows four stat blocks; the page renders five StatCards (execution/loading.tsx:5, page.tsx:43-49).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/loading.tsx:5 maps [1,2,3,4] to four stat blocks while apps/web/src/app/(app)/works/execution/page.tsx:41-47 renders five StatCards (Progress Entries, On Track, Delayed, Completed, Open Issues). Causes layout shift on load.
- **Files to change:** `apps/web/src/app/(app)/works/execution/loading.tsx`
- **Fix steps:**
  1. Change the skeleton array to five items and use the same grid class as StatGrid (check StatGrid.tsx) or reuse ds Skeleton.
  2. Optionally add a tabs-row skeleton above the table block.
- **Acceptance:**
  - Snapshot test: loading renders 5 stat placeholders.
  - Manual: no visible jump when data arrives.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /works/execution/[workId]  —  `works/execution-workId.html`

- **Source:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`
- **Design reference:** `redesign/works/execution-workId.html`

### GAP-WORKS-EXECUTION-WORKID-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: execution/[workId]/page.test.tsx WORKID-01 header test; closed by #1867)
- **First-pass claim:** Header reads "Work 3f9a1c20…" — the work is identified only by a UUID prefix (page.tsx:141); no work number, name or agreement is fetched.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/[workId]/page.tsx:155 sets subtitle to `Work ${params.workId.slice(0, 8)}…`; the only data fetched are scopes (:104-111) and issues (:112-119), neither carries a work number. The billing sibling repeats it (apps/web/src/app/(app)/works/billing/[workId]/page.tsx:95). The proposals detail page reads /api/v1/works/proposals/:id (apps/web/src/app/(app)/works/proposals/[id]/page.tsx:103-106) and the closure loader joins work_proposals by workId for workNumber (apps/web/src/app/(app)/works/_data/loaders.ts), which suggests workId is the proposal/work id - not verifiable without works-service.
- **Files to change:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`, `apps/web/src/app/(app)/works/billing/[workId]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Add a getWorkHeader(workId) loader in _data/loaders.ts calling the proposal-by-id endpoint used in proposals/[id]/page.tsx and returning {workNumber, description}; verify workId equals the proposal id first.
  2. Fetch it in parallel in ExecutionDetailPage (Promise.all at :103).
  3. Render subtitle as `${workNumber} - ${description}`; if fetch fails fall back to 'Work' plus a badge, not the UUID prefix.
  4. Reuse for the billing/[workId] header.
- **Acceptance:**
  - Component test: header shows work number from the mocked loader.
  - Component test: loader error -> no UUID text in header.
  - Manual: open a work and confirm number and title are visible.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; if workId is not the proposal id the header would show the wrong work - verify mapping.
- **Depends on:** GAP-WORKS-EXECUTION-01

### GAP-WORKS-EXECUTION-WORKID-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Physical Completion and Work Closure act on the whole work with no role check and no precondition display (ExecutionActions.tsx:100-211); a clerk with module access sees both buttons whether or not the server would 403, and closure as "dropped" is permanent.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/[workId]/ExecutionActions.tsx:84-195 always renders the Physical Completion and Work Closure cards; the file imports no role helper, and the server page apps/web/src/app/(app)/works/execution/[workId]/page.tsx never calls getSessionRoles (unlike apps/web/src/app/(app)/works/proposals/[id]/page.tsx:190 and apps/web/src/app/(app)/works/contractors/[id]/page.tsx:102). Both actions do open ConfirmDialog (:198-226; closure is danger and says 'cannot be undone'), but there is no precondition display (open issues, progress vs target). Closing as 'dropped' is offered in the same select (:178-180). Server 403 behaviour cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`, `apps/web/src/app/(app)/works/execution/[workId]/ExecutionActions.tsx`, `apps/web/src/lib/auth/workRoles.ts`
- **Fix steps:**
  1. Add WORK_CLOSURE_ROLES to lib/auth/workRoles.ts (pattern of PROPOSAL_WRITE_ROLES) after the business confirms who may certify completion/close.
  2. In ExecutionDetailPage call getSessionRoles() and pass canManage to ExecutionActions; render the two cards only (or a read-only note) when false.
  3. Show preconditions above the buttons: open issue count (already computed at :131) and a warning when >0.
  4. Require a reason in the ConfirmDialog for 'dropped' and send it in the POST body only if the close endpoint accepts it (verify closeWorkSchema).
  5. Keep server enforcement authoritative; verify /physical-complete and /close guards in works-service.
- **Acceptance:**
  - Component test: without an allowed role ExecutionActions is not rendered.
  - Component test: open issues > 0 shows precondition warning before Close Work.
  - Backend check: non-permitted role receives 403 from both endpoints.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Closure is irreversible and may trigger final billing; wrong role list either locks out officers or leaves the control exposed.

### GAP-WORKS-EXECUTION-WORKID-03  ·  MEDIUM  ·  confirmed  ·  theme DEADCOL (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Priority column is always "—": work_issues has no priority column (page.tsx:70-75 comment), yet the column is still rendered.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/[workId]/page.tsx:83-90 comment admits work_issues has no priority column and asStr(o.priority,'—') always yields '—'; the Priority column is still declared at :213 and rows carry it (:146). The sibling issues register also shows '—'. Note the WorkIssue.priority type (:31) implies a real field.
- **Files to change:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`
- **Fix steps:**
  1. Remove `priority` from WorkIssue (:31), asWorkIssue (:90), issueRows (:146) and the column list (:213).
  2. If priority is wanted, raise a backend ticket (schema + createIssueSchema) instead of rendering a stub.
  3. Apply the same removal to execution/issues/page.tsx for consistency.
- **Acceptance:**
  - Component test: issues table has no Priority header.
  - Grep: no 'priority' remains in the file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; removes an always-empty column.

### GAP-WORKS-EXECUTION-WORKID-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: execution/[workId]/page.test.tsx WORKID-04 achieved % test; closed by #1867)
- **First-pass claim:** Scope progress is not shown at all here — the scopes table has no achievement/percentage (page.tsx:104-108 comment), so the primary "Execution Progress" page has no progress figures.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/[workId]/page.tsx:127-130 comment states scopes carry no completion field and 'real progress lives in scope_progress'; StatGrid (:188-192) shows only scope and issue counts and the scopes table (:194-207) has Scope/Target/Start/End only. The page titled 'Execution Progress' therefore shows no progress. A progress list exists at /api/v1/works/execution/progress?pageSize=100 with currentAchievement, targetValue and percentage per scope (apps/web/src/app/(app)/works/_data/loaders.ts:230-241, :254-260) but is tenant-wide and capped at 100; per-work filtering support cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Add getWorkProgress(workId) in _data/loaders.ts reusing mapProgressRow; call it in the page Promise.all. Verify the endpoint accepts a workId filter (else backend change) - do not filter a 100-row cap client-side.
  2. Join to scopes by scope id and add Achieved and % columns to the Work Scopes DataTable (use ProgressBar from ds).
  3. Add an overall progress StatCard (target-weighted) only if units are homogeneous; otherwise show per-scope only.
  4. On progress fetch error show '—' in those cells, not 0.
- **Acceptance:**
  - Component test: scope with achievement 30 of 100 renders 30% bar.
  - Component test: progress fetch error -> '—' plus error badge.
  - Manual: record progress then see the figure update on this page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; read only. Mixed units make an overall % misleading.
- **Depends on:** GAP-WORKS-EXECUTION-WORKID-05

### GAP-WORKS-EXECUTION-WORKID-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Load failure on either fetch renders normal-looking zero counts plus a small badge; a partial failure (scopes ok, issues failed) is indistinguishable in the tables (page.tsx:99,173-210).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/[workId]/page.tsx:124 computes loadFailed; it only drives a small DataSourceBadge in the header actions (:160-162). StatCards (:189-191) show 0 counts on failure, and both tables fall to 'No scopes defined' / 'No open issues' empty states (:204-205, :219-220) even when that fetch errored. fetchJson returns empty data plus source 'error' (apps/web/src/app/_data/apiClient.ts); scopesResult.source and issuesResult.source are available separately but never used per section. RefreshErrorState exists in ds and is unused in works.
- **Files to change:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`
- **Fix steps:**
  1. Compute scopesFailed and issuesFailed separately from scopesResult.source / issuesResult.source.
  2. Pass null to StatCard value (renders '—') for counts whose source failed (StatCard supports null).
  3. Inside each Card render <RefreshErrorState error={...} backHref='/works/execution'/> instead of the DataTable when its fetch failed.
  4. Keep the header badge or drop it once section errors are shown; do not call notFound() on error.
- **Acceptance:**
  - Component test: scopes ok, issues error -> scopes table rows shown, issues card shows retry state, Open/Closed stats show '—'.
  - Component test: both fail -> both cards show retry, no zero stats.
  - Manual: Retry re-fetches via router.refresh.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; view only.
- **Depends on:** RefreshErrorState (exists)

### GAP-WORKS-EXECUTION-WORKID-06  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty-issues copy says "No open issues" but the table lists issues of every status, so a work with none raised reads as if open ones were merely cleared (page.tsx:200-203).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/[workId]/page.tsx:210-221 lists every issue (no status filter) but the empty state title is 'No open issues' (:219) although openIssues/closedIssues are counted separately (:131-132). Hard-coded English throughout; next-intl is used elsewhere in the app (e.g. app/(app)/admin/page.tsx) but not under works.
- **Files to change:** `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`
- **Fix steps:**
  1. Change emptyTitle to 'No issues raised' and emptyMessage to 'Issues raised against this work will appear here.'
  2. Optionally add a status filter (Open/Closed/All) via ds Segmented.
  3. i18n migration of the works module is a separate cross-cutting task; do not block this copy fix on it.
- **Acceptance:**
  - Component test: empty issues render title 'No issues raised'.
  - Manual: a work with only closed issues shows the table, not the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /works/execution/issues  —  `works/execution-issues.html`

- **Source:** `apps/web/src/app/(app)/works/execution/issues/page.tsx`
- **Design reference:** `redesign/works/execution-issues.html`

### GAP-WORKS-EXECUTION-ISSUES-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Closing an issue requires pasting its full UUID (IssueCloseForm.tsx:73-91) while the table only shows the first 8 characters (page.tsx:51) — a user cannot obtain the full id from this screen.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/page.tsx:51 shows shortId = issue.id.slice(0, 8); apps/web/src/app/(app)/works/execution/issues/IssueCloseForm.tsx:69-81 close form requires the full UUID typed/pasted (placeholder xxxxxxxx-xxxx-..., helper text 'Enter an issue UUID', lines 65-67); the full id is never displayed or copyable on the page (rows include id but DataTable columns omit it). Finding's line refs (73-91) are approximately right.
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/page.tsx`, `apps/web/src/app/(app)/works/execution/issues/IssueCloseForm.tsx`, `apps/web/src/app/(app)/works/execution/issues/IssuesTable.tsx (new)`
- **Fix steps:**
  1. Delete the free-text 'Close Issue' card and IssueCloseForm's id input.
  2. Create client IssuesTable (DataTable with a `render` action column) that gives each open row a 'Close' button; refactor IssueCloseForm into IssueCloseButton({issueId, description}) that opens the existing ConfirmDialog and POSTs /api/proxy/v1/works/execution/issues/${id}/close.
  3. Pass rows (id, shortId, etc.) from the server page to the client table (serialisable props only).
  4. Keep the toast + router.refresh on success.
- **Acceptance:**
  - Component test: clicking Close on row X sends POST .../issues/X/close after confirming.
  - Manual: no UUID ever has to be typed; closed rows show no button.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Closing is a state change; ensure the id is bound to the row, not a typed value.
- **Depends on:** GAP-WORKS-EXECUTION-ISSUES-04

### GAP-WORKS-EXECUTION-ISSUES-02  ·  HIGH  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Issue rows carry no work reference and no link; description is hard-cut at 80 chars (page.tsx:53) with no expand, so context is lost.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/page.tsx:49-56 builds rows from id, description.slice(0, 80) (line 52; finding said 53), priority, raisedDate, status; IssueRow has workId (line 9) but it is dropped, and the DataTable at line 85 has no rowLinkKey/rowHref. Truncation adds no ellipsis and no expand. Route to link to exists: /works/execution/[workId].
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/page.tsx`
- **Fix steps:**
  1. Add workId to the mapped rows and a 'Work' column; link it with rowLinkKey="workId" rowLinkPrefix="/works/execution/" (server-safe) and identifyingColumnKey="description".
  2. Stop slicing in the mapper: render full text with CSS line-clamp + title attribute, or slice with '…' and add a tooltip; keep full description in the row.
  3. Show the work name/number if the issues API provides it (cannot-verify), otherwise short work id.
- **Acceptance:**
  - Test: row link href = /works/execution/<workId>.
  - Test: 200-char description shows ellipsis and full text in title.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-EXECUTION-ISSUES-05

### GAP-WORKS-EXECUTION-ISSUES-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Priority column is always "—" — work_issues has no priority column (execution/[workId]/page.tsx:70-75) — dead column.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/page.tsx:24,53: Priority column always renders `issue.priority ?? "—"`. The comment at works/execution/[workId]/page.tsx:83-90 (finding cites 70-75) states work_issues has no priority column and nothing sends one; the create form (apps/web/src/app/(app)/works/execution/issues/new/page.tsx:47-48) sends no priority. work_issues schema itself is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;). Not a dead link - a dead column.
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/page.tsx`, `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`
- **Fix steps:**
  1. Remove the Priority column from `columns` and the priority field from rows/IssueRow in issues/page.tsx.
  2. Remove the Priority column at execution/[workId]/page.tsx:213 (and line 90/146 mapping) for the same reason.
  3. If priority is wanted, raise a backend requirement (column + createIssueSchema) first.
- **Acceptance:**
  - Visual: no Priority column on either page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-WORKS-EXECUTION-ISSUES-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Close is a one-click resolve with no resolution note, and it is offered to every viewer without a role check (IssueCloseForm.tsx:38-60).
- **Verified evidence:** Role gate part confirmed: apps/web/src/app/(app)/works/execution/issues/IssueCloseForm.tsx has no roles prop or role check, and issues/page.tsx does not call getSessionRoles, so the Close card shows to all viewers. Overstated 'one-click': closing goes through a danger ConfirmDialog (apps/web/src/app/(app)/works/execution/issues/IssueCloseForm.tsx:94-105) - a two-step confirm - but with no requireReason/resolution note, and POST has no body (line 43). Server enforcement of role and a resolution field are cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;).
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/page.tsx`, `apps/web/src/app/(app)/works/execution/issues/IssueCloseForm.tsx`, `apps/web/src/lib/works/roles.ts`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Read getSessionRoles() in issues/page.tsx and render the close control only for ISSUE_CLOSE_ROLES (DECISION on list; add to lib/works/roles.ts).
  2. Set requireReason reasonLabel="Resolution note" on the ConfirmDialog and send {resolution: reason} in the POST body (needs backend field).
  3. Backend: enforce role + persist resolution + audit event.
- **Acceptance:**
  - Test: read-only role sees no Close button.
  - Test: Confirm disabled until note entered; body contains resolution.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Backend must accept the extra field or the request may 400.
- **Depends on:** GAP-WORKS-EXECUTION-ISSUES-01

### GAP-WORKS-EXECUTION-ISSUES-05  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** No row link, sort, filter, pagination beyond first 100 (page.tsx:33) and no way to raise an issue from here; page uses inline padding instead of the standard wrap.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/page.tsx:31 fetches ?pageSize=100 (finding said 33) and lines 45-47 compute Total/Open/Closed from that capped list; DataTable at line 85 has no sortable/filterable/pageSize props; no link to /works/execution/issues/new exists on this page (only execution/[workId]/page.tsx:171 links it); layout uses inline padding "24px 32px" (lines 70-77) rather than className="page-main wrap" used by contractors pages. Backend paging/total support is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;).
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/page.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Add sortable filterable pageSize={20} exportable to the DataTable.
  2. Add a '+ Raise issue' primary Link (to /works/execution/issues/new) in PageHeader actions.
  3. Wrap content in `page-main wrap` instead of inline padding.
  4. If API returns total, show 'first 100 of N' when N>100, or add server-side page/status query params.
- **Acceptance:**
  - Test: header has Raise issue link.
  - Test: 150 rows return + total 150 shows notice / pager.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Stat counts wrong when list exceeds 100.
- **Depends on:** GAP-WORKS-EXECUTION-ISSUES-02


---
## /works/execution/issues/new  —  `works/execution-issues-new.html`

- **Source:** `apps/web/src/app/(app)/works/execution/issues/new/page.tsx`
- **Design reference:** `redesign/works/execution-issues-new.html`

### GAP-WORKS-EXECUTION-ISSUES-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: issues/new/page.test.tsx NEW-01 picks a work by name and posts its id; closed by #1867)
- **First-pass claim:** Work ID and Issue Type ID are raw UUID text inputs (page.tsx:93-118); reaching the form without ?workId= means the user must know a UUID, and a wrong id yields only a generic server error.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/new/page.tsx:91-118 workId and issueTypeId are free-text inputs ('UUID of the work', 'Issue type UUID (optional)'); workId is only prefilled when ?workId= is present (line 31; the work detail page links with it at execution/[workId]/page.tsx:171). No component named EntityPicker exists; the closest is SmartCombobox (string-only options, no id/label pairs). Issue types exist as a master (works/masters/page.tsx:22 uses GET /api/v1/works/masters/issue-types?pageSize=100, line 109). A works list endpoint for the picker: cannot-verify path (execution/page.tsx uses a loader; confirm route). Error path shows the generic formError message (apps/web/src/app/(app)/works/execution/issues/new/page.tsx:57-61 region).
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/(app)/works/execution/issues/new/page.tsx`
- **Fix steps:**
  1. Create ds/EntityPicker (combobox, options {id,label,sublabel}, async search, value = id) reusable across works forms; base on SmartCombobox a11y pattern.
  2. Replace the Work ID input with EntityPicker fed by the works/orders list loader (name + work number); keep ?workId= prefill and resolve its label.
  3. Replace Issue Type ID with a <select>/EntityPicker fed by /api/v1/works/masters/issue-types.
  4. Show fieldErrors from useFormError under the pickers (fieldError("workId")).
- **Acceptance:**
  - Component test: choosing an item posts its id; typing a name never requires a UUID.
  - Manual: opening the page without ?workId= still lets the user pick a work by name.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Picker must load enough works (paginate/search) or users can't find theirs.
- **Depends on:** EntityPicker (new), GAP-WORKS-EXECUTION-PHOTOS-NEW-01

### GAP-WORKS-EXECUTION-ISSUES-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: issues/new/page.test.tsx discard confirm + beforeunload only while dirty; closed by #1867)
- **First-pass claim:** No Cancel/back action inside the form and no unsaved-draft guard; only the header back link (page.tsx:159-165).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/new/page.tsx:75-165: the form has only a submit button (lines ~140-152) - no Cancel/Reset; the only exit is the PageHeader back link (lines 161-166 -> /works/execution). No beforeunload/dirty-state guard anywhere in the file. (contractors/new and photos/new do have a Cancel link/button.) Note the back link goes to /works/execution, not to the work when ?workId= is set.
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/new/page.tsx`
- **Fix steps:**
  1. Add a ghost Cancel Button/Link next to 'Raise Issue' routing to workId ? `/works/execution/${workId}` : "/works/execution".
  2. Track dirty = description||issueTypeId||workId!==initialWorkId; add a beforeunload listener and confirm on Cancel when dirty (ConfirmDialog).
  3. Set PageHeader back to the work when initialWorkId exists.
- **Acceptance:**
  - Component test: typing in description then clicking Cancel opens a discard confirm.
  - Manual: browser tab close warns while dirty, not after submit.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-EXECUTION-ISSUES-NEW-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: issues/new/page.test.tsx NEW-03 blocked without a work; closed by #1867)
- **First-pass claim:** On success it redirects to /works/execution/{workId} using the typed value without checking it is a valid work (page.tsx:57).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/new/page.tsx:63 does router.push(`/works/execution/${workId}`) with the raw typed string, unencoded, and there is no client-side format/zod check on workId or issueTypeId (lines 47-48). Overstated: the redirect happens only after a 2xx from POST /issues (line 56-63), so an unknown work is rejected earlier if the service validates the FK/existence - which is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;). Real risks: non-UUID strings reach the server, and a value like '../x' would be pushed into the URL.
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/new/page.tsx`
- **Fix steps:**
  1. Add a zod schema {workId: z.string().uuid(), issueTypeId: z.string().uuid().optional(), description: z.string().trim().min(1).max(2048)} and parse before fetch; show field errors.
  2. Use encodeURIComponent(workId) (or the id returned by the API) in the redirect; disable submit while busy (already) and when invalid.
  3. After EntityPicker lands, validation of the id shape becomes moot; keep description rule.
- **Acceptance:**
  - Unit test: workId 'abc' shows 'Select a work' error and no request is sent.
  - After success the URL is /works/execution/<uuid>.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-EXECUTION-ISSUES-NEW-01

### GAP-WORKS-EXECUTION-ISSUES-NEW-04  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: issues/new/page.test.tsx NEW-04 role=alert; Suspense SkeletonCard fallback in page.tsx; closed by #1867)
- **First-pass claim:** Uses inline styles and a hand-rolled error banner rather than the DS form kit; Suspense fallback is bare "Loading..." (page.tsx:167).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/issues/new/page.tsx:75-89 renders a hand-built role=alert div with inline rgba styles, and the Suspense fallback is <div>Loading...</div> (line 168; finding said 167). True. But there is no 'DS form kit' in apps/web/src/app/_components/ds (no Field/Input/FormError components); every sibling form (contractors/new, photos/new, IssueCloseForm) uses the same local inputStyle/labelStyle, and useFormError IS used here (line 37).
- **Files to change:** `apps/web/src/app/(app)/works/execution/issues/new/page.tsx`, `apps/web/src/app/_components/ds/FormBanner.tsx (new, optional)`
- **Fix steps:**
  1. Replace the bare Loading... fallback with the ds <Skeleton> (ds/Skeleton.tsx) or a labelled status region.
  2. Extract the error banner + input/label styles into a shared ds FormBanner/Field helper only if adopted across works forms; otherwise leave.
  3. Show useFormError field errors.
- **Acceptance:**
  - Visual: skeleton shown during Suspense; error banner has role=alert.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /works/execution/photos/new  —  `works/execution-photos-new.html`

- **Source:** `apps/web/src/app/(app)/works/execution/photos/new/page.tsx`
- **Design reference:** `redesign/works/execution-photos-new.html`

### GAP-WORKS-EXECUTION-PHOTOS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: photos/new/page.test.tsx NEW-01 label and posted workId; closed by #1867)
- **First-pass claim:** Work ID is a raw UUID text input labelled "UUID of the execution record" (page.tsx:127-136) — the label says execution record but the API and back link treat it as a work id; users pasting the wrong id get a generic failure.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/photos/new/page.tsx:109-121 Work ID is a free-text input with placeholder 'UUID of the execution record' (line 119; the finding's 127-136 was off) while the body sends it as workId (line 51) and cancel/redirect go to /works/execution/{workId} (lines 75-79, 87-89); PageHeader subtitle (line 220) also says 'execution record'. Errors are the raw server message or 'Failed to register photo.' (lines 66-69). The work detail page links here with ?workId= (execution/[workId]/page.tsx:178).
- **Files to change:** `apps/web/src/app/(app)/works/execution/photos/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new, shared)`
- **Fix steps:**
  1. Use the shared EntityPicker (see ISSUES-NEW-01) for Work, prefilled from ?workId=.
  2. Rename copy: label 'Work', subtitle 'Upload a photo and attach it to a work.'.
  3. Route errors through useFormError (see PHOTOS-NEW-04) so a bad id yields a specific field message.
- **Acceptance:**
  - Manual: choose work by name; label and subtitle say 'work'.
  - Test: workId sent equals picked id.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** EntityPicker (new), GAP-WORKS-EXECUTION-ISSUES-NEW-01

### GAP-WORKS-EXECUTION-PHOTOS-NEW-02  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W2 PQ: closed by #2035) (W2 works: closed by #2048; source is web-gps (geolocation) / web-manual (typed) / web (no coordinates) in photos/new/page.tsx and accepted by uploadPhotoSchema; photos/new/page.test.tsx + all-routes.test.ts)
- **W0 note:** partly fixed by #1867 — Done: zod lat/long range + both-or-neither, min/max attrs, Use my location button. Remains: source still hard-coded "web" (no web-gps/web-manual), backend range validation unverifiable (works-service not in snapshot)
- **First-pass claim:** Photo evidence with GPS has no range validation: latitude/longitude accept any number and are not checked against -90..90 / -180..180 (page.tsx:186-205), and source is hard-coded "web" so the coordinates are typed, not device-captured — weak as verification evidence.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/photos/new/page.tsx:157-182 latitude/longitude are type=number with step only (no min/max), the form is noValidate (line 92) so even native constraints don't run, and submit parses parseFloat (lines 56-57) with no range check; source is hard-coded "web" (line 53) and coordinates are typed in, not captured via navigator.geolocation. Server-side range validation/source enum is cannot-verify (works-service is not in the snapshot (only services/hrms-service), so server behaviour is cannot-verify;). Theme 'PII' is wrong - this is validation/evidence integrity.
- **Files to change:** `apps/web/src/app/(app)/works/execution/photos/new/page.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Add min/max attributes (-90..90, -180..180) and a zod check in handleSubmit: lat/long both or neither, finite, in range; show inline errors.
  2. Add a 'Use my location' button using navigator.geolocation.getCurrentPosition that fills the fields and records accuracy.
  3. DECISION/backend: if backend has a source enum, send "web-gps" for device-captured and "web-manual" for typed; otherwise leave "web".
  4. Backend: mirror range validation in the photo zod schema.
- **Acceptance:**
  - Unit test: latitude 95 shows error, no request; lat without long blocked.
  - Manual: Use my location fills both fields on HTTPS.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Evidence-integrity: allowing manual GPS keeps weak proof; geolocation needs HTTPS and permission and must not block offline site users.

### GAP-WORKS-EXECUTION-PHOTOS-NEW-03  ·  MEDIUM  ·  partly  ·  theme OTHER (was CONFIRM)

- [x] **Status** (W2 works: closed by #2048; image thumbnail of the chosen photo from the local File (FileUpload.tsx meta.file, photos/new/page.tsx); photos/new/page.test.tsx)
- **W0 note:** partly fixed by #1867 — Done: filename+size shown from meta, Choose another clears. Remains: no image thumbnail preview (no previewUrl in FileUpload meta); the Remove action lacks a preview
- **First-pass claim:** After upload only the storage key is shown ("✓ File key") with no thumbnail or filename, so the user cannot confirm the right photo was attached (page.tsx:151-156).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/photos/new/page.tsx:136-140 the page itself prints only '✓ File key: <code>' but the FileUpload component already shows '✅ Uploaded: {file.name}' (ds/FileUpload.tsx:85,113) and passes meta {fileName,size,mimeType} as onUploaded's 2nd arg (line 86) which the page ignores (line 134 uses only key). No thumbnail/preview anywhere. Theme 'CONFIRM' is not accurate (this is feedback, not a confirm dialog).
- **Files to change:** `apps/web/src/app/(app)/works/execution/photos/new/page.tsx`, `apps/web/src/app/_components/ds/FileUpload.tsx`
- **Fix steps:**
  1. Use onUploaded(key, meta) to store meta.fileName/size and display them instead of the raw key (hide the key).
  2. Extend FileUpload to include a local previewUrl (URL.createObjectURL(file), revoked on unmount) in the meta for image/* and render a 96px <img alt={fileName}> in the page.
  3. Add a 'Remove / choose another' action that clears fileKey.
- **Acceptance:**
  - Component test: after upload, filename and an img preview are visible, raw key not.
  - Manual: clearing resets and disables submit.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; revoke object URLs to avoid memory leaks.

### GAP-WORKS-EXECUTION-PHOTOS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: photos/new/page.test.tsx 500, 400 fieldErrors and network-failure tests; closed by #1867)
- **First-pass claim:** Errors are hand-written and inconsistent with sibling forms that use useFormError (issues/new, record-progress); server message is shown raw (page.tsx:59-62).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/photos/new/page.tsx does not import useFormError (imports at lines 1-6; siblings issues/new line 37 and IssueCloseForm do). Lines 66-69 display the server JSON `message` raw (or 'Failed to register photo.'); catch (81-83) shows err.message raw; the local validations at 45-46 use ad-hoc strings. useFormError's own contract (lib/useFormError.ts header) says never echo raw server text/status. Also submit doesn't guard double-click beyond disabled state.
- **Files to change:** `apps/web/src/app/(app)/works/execution/photos/new/page.tsx`
- **Fix steps:**
  1. Import useFormError("photo"); call formError.clear() at submit start; replace lines 66-69 with setError((await formError.fromResponse(res, "save")).message) and the catch with formError.fromException("save").message.
  2. Render formError.fieldError("workId"/"latitude"/...) beside the inputs.
  3. Keep client-side required checks but phrase them via the same banner.
- **Acceptance:**
  - Test: 400 with fieldErrors shows inline field messages; 500 shows the catalogued generic copy, not server text.
  - Test: network failure shows the catalogued message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /works/execution/record-progress  —  `works/execution-record-progress.html`

- **Source:** `apps/web/src/app/(app)/works/execution/record-progress/page.tsx`
- **Design reference:** `redesign/works/execution-record-progress.html`

### GAP-WORKS-EXECUTION-RECORD-PROGRESS-01  ·  HIGH  ·  partly  ·  theme UUID

- [x] **Status** (W1 follow-up: closed by #2002, verified on main d341ad6f1)
- **First-pass claim:** No workId → the form asks the clerk to paste a scope UUID (page.tsx:186-197); the hint says "enter a scope ID manually" but there is nowhere in the app that lists scope ids, and the preload failure is silently swallowed (page.tsx:90-93).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/record-progress/page.tsx:189-197 renders a free-text scope UUID input (placeholder is a sample UUID) whenever scopes.length==0; hint at :201-205. Scopes preload only runs when ?workId= is present (:70-100), so the primary entry point (+ Record progress on apps/web/src/app/(app)/works/execution/page.tsx:31-37, no workId) always lands on the UUID box. Preload failure is swallowed by design (catch at :90-93, comment :79-82) so the user gets 'No scopes found' even on an outage. Overstated only in that the dropdown (:172-187) is used when arriving from a work page and preload succeeds. No page shows a work_scope.id (work detail apps/web/src/app/(app)/works/execution/[workId]/page.tsx:135-141 shows label/target/dates only), so the manual fallback is unusable.
- **Files to change:** `apps/web/src/app/(app)/works/execution/record-progress/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. When workId is absent, replace the UUID input with a work picker (search by work number/description) and load scopes for the chosen work; EntityPicker does not exist yet - build it on the SmartCombobox pattern (combobox role, arrow keys) but with {id,label} options instead of string[].
  2. Reuse the existing works list endpoints already used by loaders (e.g. /v1/works/proposals) for the picker; do not invent a new endpoint.
  3. Delete the free-text workScopeId <input> (:188-198); keep only the <select>/picker.
  4. Track preload failure in state (scopesError) and render an inline error with Retry instead of the 'enter a scope ID manually' hint; distinguish 'no scopes defined' (ok) from 'load failed'.
  5. Keep ids only in the URL (?workId=) and in the POST body.
- **Acceptance:**
  - Component test: /record-progress with no workId shows a work picker, no UUID input in the DOM.
  - Component test: scopes fetch returns 500 -> error message with Retry visible, not 'No scopes found'.
  - Manual: from the execution list, record progress by picking a work then a scope by name, without seeing a UUID.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; only changes how workScopeId is chosen. Wrong scope selection would mis-post progress, so labels must be unambiguous (description + target).
- **Depends on:** EntityPicker (new shared ds component)

### GAP-WORKS-EXECUTION-RECORD-PROGRESS-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Entry is additive and irreversible from this screen: the user cannot see the current cumulative total, and there is no maximum, so typing 60 on a scope at 60% silently exceeds 100% (page.tsx:247-262, 273-276); no confirmation dialog on a figure that changes reported physical progress.
- **Verified evidence:** apps/web/src/app/(app)/works/execution/record-progress/page.tsx:246-259 quantity input has min=0, no max, and the form never fetches or shows the scope's current cumulative achievement (only target appears in the option text, :184). Copy at :273-276 says the amount is added to the running total. submit() (:109-140) POSTs straight away with no ConfirmDialog (ConfirmDialog is used in apps/web/src/app/(app)/works/execution/[workId]/ExecutionActions.tsx but not here). Note the example in the copy talks in percent while the input is a quantity (currentAchievement, see -05), so exceeding 100% cannot even be judged client-side today. Server-side cap/maker-checker/audit cannot be verified: works-service is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/works/execution/record-progress/page.tsx`
- **Fix steps:**
  1. On scope select, fetch the scope's current cumulative from GET /v1/works/execution/progress (the list the loaders use, apps/web/src/app/(app)/works/_data/loaders.ts:254-260) filtered client-side by scope id - verify the endpoint supports a scope/work filter before relying on pageSize=100.
  2. Show 'Recorded so far: X of target Y (Z%)' under the scope select and compute 'new total' live as the user types.
  3. Set input max to (target - current) or, if over-run is legitimate, show an amber warning when new total > target.
  4. Wrap submit in the shared ConfirmDialog from ds: 'Add {n} to {scope}? Total becomes {new} of {target}.' with confirm label 'Record'.
  5. Backend: confirm the service rejects/flags totals above target and emits an audit event (CLAUDE.md rule 8); log a finding if not.
- **Acceptance:**
  - Component test: scope at 60 of 100, typing 60 shows 'new total 120 exceeds target' warning and blocks or requires explicit confirm.
  - Component test: submit opens ConfirmDialog; POST fires only after confirm.
  - Manual: current cumulative is visible before entering a value.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Progress figures feed reported physical progress and may gate bill payment; a hard client max could block legitimate over-measurement, so the over-target rule needs a business decision.
- **Depends on:** GAP-WORKS-EXECUTION-RECORD-PROGRESS-05

### GAP-WORKS-EXECUTION-RECORD-PROGRESS-03  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE (was CAP)

- [x] **Status** (W2 works: closed by #2048; record-progress/page.tsx warns (does not block) when the scope already has an entry for the chosen month/year; page.test.tsx RP-03 tests. Server-side uniqueness is a separate item (RECORD-PROGRESS-06))
- **W0 note:** partly fixed by #1867 — Done: inFlight ref + saved state keep form disabled through redirect. Remains: no warning when an entry already exists for same scope/month/year; backend uniqueness/idempotency unverified
- **First-pass claim:** Duplicate month/year submissions for the same scope are not prevented client-side — a double click before redirect (or a re-entry next day) adds the amount twice; the button disables only while busy (page.tsx:110-140).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/record-progress/page.tsx:109-140: setBusy(true) at :111 and finally setBusy(false) at :138 run as soon as the POST resolves, but navigation is deferred by setTimeout 600 ms (:134). During that window the submit button is enabled again, so a second click re-POSTs and adds the amount twice. No idempotency key is sent (:123-127) and no month/year+scope duplicate check exists client-side. Whether the service upserts or rejects a repeat (scope, month, year) cannot be verified (works-service absent). The theme tag CAP and the fix text are unrelated boilerplate.
- **Files to change:** `apps/web/src/app/(app)/works/execution/record-progress/page.tsx`
- **Fix steps:**
  1. Add a 'saved' state set on success and keep the form disabled (Button disabled={busy||saved}) until router.push; do not clear busy in finally on the success path.
  2. Guard submit() with a useRef in-flight flag so a double event cannot pass before re-render.
  3. After scope select, fetch existing progress rows for that scope (same call as -02) and if one exists for the chosen month/year show a warning and change the confirm text to 'Add to existing entry'.
  4. Backend: confirm a unique (workScopeId, month, year) rule or an Idempotency-Key header is supported; add if absent.
- **Acceptance:**
  - Component test: two rapid clicks after a successful response issue exactly one fetch.
  - Component test: existing entry for same month shows the warning.
  - Backend test: repeated POST for same scope/month/year does not double-count.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Double-counted physical progress could overstate completion and release payments early.
- **Depends on:** GAP-WORKS-EXECUTION-RECORD-PROGRESS-02

### GAP-WORKS-EXECUTION-RECORD-PROGRESS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: record-progress/page.test.tsx RP-04 year options + back-dated confirmation; closed by #1867)
- **First-pass claim:** Year is a free number input with min 2000 and no max, and month/year default to today, so back-dated or future-period entries are accepted without a warning (page.tsx:233-245).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/record-progress/page.tsx:55-60 defaults month/year to today; year input :234-243 is type=number min=2000 with no max; month select lists all 12 months (:224-228) with no relation to the current date. Nothing warns on future or old periods. Server-side period validation cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/execution/record-progress/page.tsx`
- **Fix steps:**
  1. Replace the free year <input> with a <select> of (currentYear-2 .. currentYear), or add max={currentYear}.
  2. Compute selectedPeriod > current month/year: show inline error and block submit (future period is never valid).
  3. For periods more than 1 month old show a non-blocking amber note 'Back-dated entry' and include it in the ConfirmDialog text from -02.
  4. Backend: confirm period validation exists.
- **Acceptance:**
  - Component test: selecting a future month/year blocks submit with an error message.
  - Component test: a period 3 months back submits only after confirmation showing 'back-dated'.
  - Manual: year field cannot be set to 2099.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; a wrongly strict back-date rule may block genuine late entries - confirm allowed window with the business.
- **Depends on:** GAP-WORKS-EXECUTION-RECORD-PROGRESS-02

### GAP-WORKS-EXECUTION-RECORD-PROGRESS-05  ·  LOW  ·  partly  ·  theme UNIT (was WIRING)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: record-progress/page.test.tsx RP-05 unit beside the input and option; closed by #1867)
- **First-pass claim:** Field labelled "Progress this period" is really "quantity done"; unit of the scope (m, sqm, nos) is never shown next to the input because scopes carry no unit column (page.tsx:23-30 comment).
- **Verified evidence:** apps/web/src/app/(app)/works/execution/record-progress/page.tsx:18-24 comment and :247-258 confirm the input is 'Progress this period' with placeholder 'Amount done this month (e.g. 20)' and posts currentAchievement (:120); no unit is shown. True that work_scopes rows carry no unit. But the master Scopes catalog does define a required unit (m, sqm, nos) (apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx:80-86) and work_scopes.scopeId references that catalog, so a unit is obtainable by joining client-side. Whether GET /v1/works/masters/scopes returns unit cannot be verified (service absent; apps/web/src/app/(app)/works/masters/page.tsx:123-128 only reads id/name/code/active). Copy at :273-276 additionally mixes percent and quantity wording.
- **Files to change:** `apps/web/src/app/(app)/works/execution/record-progress/page.tsx`, `apps/web/src/app/(app)/works/execution/[workId]/page.tsx`
- **Fix steps:**
  1. Fetch /api/proxy/v1/works/masters/scopes?pageSize=100 once, build a Map<scopeId,{name,unit}>, and attach unit + catalog name to each Scope in pickScopes().
  2. Show unit as an input suffix (e.g. 'm') and in the option text: 'target 500 m'.
  3. Rewrite the helper text to say quantity, not percent, unless the API confirms percent semantics; label the field 'Quantity done this period'.
  4. If unit is not returned by the masters API, raise a backend ticket and show 'unit not defined' rather than guessing.
- **Acceptance:**
  - Component test: scope with unit 'sqm' renders 'sqm' beside the input and in the option.
  - Component test: unit missing -> no suffix and no crash.
  - Copy review: no '%' wording remains if the field is a quantity.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only. Mis-mapping scopeId to the wrong catalog entry would show a wrong unit, so join on scopeId strictly.


---
## /works/masters  —  `works/masters.html`

- **Source:** `apps/web/src/app/(app)/works/masters/page.tsx`
- **Design reference:** `redesign/works/masters.html`

### GAP-WORKS-MASTERS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: MastersTable.test.tsx failed fetch shows retry, not the empty state; closed by #1867)
- **First-pass claim:** List fetch errors are swallowed: only `data` is read (page.tsx:108), so an outage shows "No authorities yet — Use the form above to add the first entry", inviting duplicate creation.
- **Verified evidence:** apps/web/src/app/(app)/works/masters/page.tsx:108 destructures only `data` from fetchJson (default []), dropping `source`; on failure the empty DataTable shows emptyTitle 'No X yet' with emptyMessage 'Use the form above to add the first entry.' (:187-188) beside an enabled create form. Note isMasterType failure correctly uses notFound() (:105) - that part is fine.
- **Files to change:** `apps/web/src/app/(app)/works/masters/page.tsx`
- **Fix steps:**
  1. Destructure { data: items, source } and set const failed = source==='error'.
  2. When failed render <RefreshErrorState error={...} backHref='/works'/> in the Card instead of the DataTable, and hide or disable MasterCreateForm to avoid duplicate creation.
  3. Show the row count in the Card title only when not failed.
- **Acceptance:**
  - Component test: source 'error' -> retry state, no 'add the first entry' text.
  - Component test: successful empty -> empty state kept.
  - Manual: API down, no create button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents duplicate master entries during outages.

### GAP-WORKS-MASTERS-03  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1867, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003; W1 SF-15 re-confirmed on #2011)
- **First-pass claim:** Parent references (Work Type ID, Program ID) are raw UUID text boxes labelled "Paste Work Type UUID" (MasterCreateForm.tsx:53,73,83) and the table shows only an 8-character ID prefix (page.tsx:124), so a user cannot look the UUID up on this screen.
- **Verified evidence:** apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx:53 (work-sub-types workTypeId), :73 (repair-types programId), :83 (scopes workTypeId) are required text inputs with 'Paste ... UUID' placeholders; apps/web/src/app/(app)/works/masters/page.tsx:124 shows String(item.id).slice(0,8) as the ID column and never shows parent. The UUID cannot be found on this screen (the ID column is truncated). Whether list responses include workTypeId/programId cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx`, `apps/web/src/app/(app)/works/masters/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. In masters/page.tsx, when type is work-sub-types or scopes fetch work-types (and programs for repair-types) with the same fetchJson call and pass options [{id,name}] to MasterCreateForm.
  2. Add a new `select` FieldSpec kind (optionsFrom: 'work-types'|'programs') and render it via EntityPicker or a plain <select>.
  3. Replace the ID column with Code; add a Parent column mapping workTypeId/programId -> name when present in list rows.
  4. Keep UUID only in the POST body.
- **Acceptance:**
  - Component test: work-sub-types form shows a dropdown of work type names, no UUID text input.
  - Component test: submitted body contains selected workTypeId.
  - Manual: create a sub-type without seeing a UUID.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong parent link corrupts lookup hierarchy; the select removes paste errors.
- **Depends on:** EntityPicker (new shared ds component), GAP-WORKS-EXECUTION-RECORD-PROGRESS-01

### GAP-WORKS-MASTERS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: closed by #2048; Unit column for scopes (masterTypes.ts) and MastersTable.test.tsx proves Deactivate confirms then PATCHes active=false with the row version; edit form unchanged)
- **First-pass claim:** Registry is create-only: no edit, deactivate or delete, and no parent/child display for Work Sub-Types, Scopes or Repair Types (page.tsx:67-72).
- **Verified evidence:** apps/web/src/app/(app)/works/masters/page.tsx:67-72 columns are ID/Name/Code/Active only; apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx only POSTs (:264) and the row cannot be clicked (no rowHref, page.tsx:179-190). No edit/deactivate/delete UI exists, and parent/child columns are absent for sub-types, scopes and repair types. Whether PATCH/PUT/DELETE endpoints exist in works-service cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/masters/page.tsx`, `apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx`, `services/works-service (not in snapshot)`
- **Fix steps:**
  1. Confirm backend update/deactivate endpoints for masters (with audit events); add if missing.
  2. Add row actions: Edit (reuse MasterCreateForm in edit mode with initial values) and Deactivate with ConfirmDialog.
  3. Add Parent and Unit columns per type (sub-types: work type; scopes: work type, unit; repair types: program).
  4. Prefer deactivate over delete since other records reference master ids.
- **Acceptance:**
  - Component test: edit form prefilled, PATCH sent with version.
  - Component test: deactivate opens ConfirmDialog and sends active=false.
  - Backend test: audit event emitted on update.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Editing masters referenced by live tenders/works can change historic meaning; deactivate only, never hard delete.
- **Depends on:** GAP-WORKS-MASTERS-03, GAP-WORKS-MASTERS-05

### GAP-WORKS-MASTERS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: closed by #2048; MastersTable.tsx shows a Pending row, locks the Add control and polls the type's own GET until the list total grows (useAcceptedWrite poll); MastersTable.test.tsx pending/duplicate-submit test, MasterCreateForm re-entry guard)
- **W1 SF-15 note:** the timer-driven 600/1500/3000ms refreshes were removed (#2011). After a 202 the form now shows the shared AcceptedNotice ("received, will appear shortly") with a manual Refresh; the row does NOT yet appear without a manual refresh and there is no pending row or duplicate-submit block, so this stays OPEN.
- **W0 note:** partly fixed by #1867 — Replaced single refresh with fixed 600/1500/3000ms router.refresh polling. Remains: polling does not stop when row appears, no pending row/toast, no duplicate-submit block
- **First-pass claim:** Create returns 202 and the row appears "shortly" — the list refreshes after a fixed 600 ms timeout, so a slow write leaves the new entry missing (MasterCreateForm.tsx:264-271).
- **Verified evidence:** apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx:264-271: any non-202 is treated as error; on 202 the form shows 'Created. Changes will reflect shortly.' and does setTimeout(router.refresh, 600). 202 implies async (CQRS) write, so if the read model lags beyond 600 ms the list stays stale with no further refresh; users may re-create the entry.
- **Files to change:** `apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx`, `apps/web/src/app/(app)/works/masters/page.tsx`
- **Fix steps:**
  1. After 202, poll router.refresh() a few times (e.g. 600ms, 1.5s, 3s) until the new name/code appears or attempts run out - keep a ref of the submitted name to detect it.
  2. Alternatively add an optimistic 'Pending' row in a client wrapper around the DataTable.
  3. If retries exhaust show a toast 'Still processing - refresh shortly' and keep the row marked pending.
  4. Block re-submission of the same name/code while pending.
- **Acceptance:**
  - Component test with fake timers: refresh is called until list contains the new name, then stops.
  - Manual: with a delayed read model the row appears without manual reload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-MASTERS-06  ·  MEDIUM  ·  confirmed  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: civitas-ds.css .masters-layout stacks under the 375px breakpoint (civitas-ds.css:568-586); masters/page.tsx uses the class; closed by #1867)
- **First-pass claim:** Left nav is a fixed 220 px flex column with inline styles and no responsive rule (page.tsx:141-158); on a phone it consumes the row and squeezes the table.
- **Verified evidence:** apps/web/src/app/(app)/works/masters/page.tsx:141-170: container is display:flex gap 24 with a nav of width 220, flexShrink 0, all inline styles, so no media query is possible; at phone width the nav takes ~60% of the row and squeezes the table (minWidth 0 on the right column). Nav has 17 links. The PII tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/works/masters/page.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Replace inline styles with classNames (e.g. .masters-layout, .masters-nav) in civitas-ds.css.
  2. At <=768px set flex-direction column and nav width 100%, or render the nav as a <select> that navigates.
  3. Keep aria-current on the active link.
- **Acceptance:**
  - Manual at 375px: nav stacks above content; table uses full width.
  - No horizontal page scroll.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-WORKS-MASTERS-07  ·  LOW  ·  partly  ·  theme WIRING (was I18N)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: MastersTable.test.tsx sr-items columns and 'Not set' tests; closed by #1867)
- **First-pass claim:** SR Items and Assets have no Name-based empty/label logic; the "Active" column shows "—" when the API omits it, which reads as unknown rather than absent (page.tsx:127).
- **Verified evidence:** apps/web/src/app/(app)/works/masters/page.tsx:123-128 maps every row through item.name and item.code only. Per the form spec (apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx:113-120) sr-items have no name or code (fields are zone, srYear, itemCode, description, unit, rate), so if the API returns those names every SR Items row shows '—' in Name and Code - worse than the observation says. Assets have code and name so are fine (extra fields like type/district/cost not shown). Active shows '—' when item.active is null (:127) - accurate. Exact response shapes cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/masters/page.tsx`
- **Fix steps:**
  1. Introduce a per-type column config: sr-items -> Item Code, Description, Unit, Rate (formatINR from paise via lib/formatters formatMoney), Zone, SR Year; assets -> Code, Name, Type, District, Cost.
  2. Build rows from that config instead of the fixed DisplayRow.
  3. Render Active '—' as 'Not set' or omit the column when the API does not return it.
  4. Money: rate is minor units per the form (multiplied by 100) - format with formatMoney.
- **Acceptance:**
  - Component test: sr-items row shows item code and description, not dashes.
  - Component test: rate 12550 (paise) renders as Rs 125.50.
  - Manual: check Assets list shows type/district.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; money must remain paise-based.
- **Depends on:** GAP-WORKS-MASTERS-04


---
## /works/orders  —  `works/orders.html`

- **Source:** `apps/web/src/app/(app)/works/orders/page.tsx`
- **Design reference:** `redesign/works/orders.html`

### GAP-WORKS-ORDERS-01  ·  HIGH  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** No row link: DataTable has no rowHref (page.tsx:118-128) so a work order cannot be opened; /works/proposals/[id] is reachable only from the separate proposals list.
- **Verified evidence:** orders/page.tsx:118-128 renders DataTable with no rowHref (DataTable supports rowHref, ds/DataTable.tsx:56,211; proposals list uses it at ProposalsTable.tsx:40). No /works/orders/[id] route exists. Whether work-order ids equal proposal ids cannot be verified (works-service absent from snapshot; /work-orders payload shape unknown).
- **Files to change:** `apps/web/src/app/(app)/works/orders/page.tsx`
- **Fix steps:**
  1. Confirm with backend that GET /works/work-orders items carry the proposal id in `id` (or a distinct workId).
  2. Add `id` to the DataTable rows (already in OrderRow) and pass rowHref={(r)=>`/works/proposals/${r.id}`} to the DataTable at page.tsx:118.
  3. If ids differ, map the proposal/work id field in mapOrders and use that instead.
  4. Make workNumber cell keyboard-reachable (rowHref in DataTable already handles this; verify).
- **Acceptance:**
  - Component test: rendering OrdersPage with 2 rows yields links/rows whose href is /works/proposals/<id>.
  - Manual: click a row on /works/orders and land on the matching proposal detail page.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong id mapping would open a 404 detail page.

### GAP-WORKS-ORDERS-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Estimated cost is computed through Number(): paise strings above 2^53 lose precision and the display is "₹2.45 Cr" / "₹86.50 L" rounded to 2 dp (page.tsx:45-53), unlike proposals which uses paise-exact formatMoney — the same work shows two different amounts.
- **Verified evidence:** orders/page.tsx:45-53 fmtCost does Number(minor)/100 and prints '₹x.xx Cr' / '₹x.xx L' (2 dp, rounded) or toLocaleString; proposals detail uses paise-exact formatMoney (proposals/[id]/page.tsx:225) and the list uses cellType 'amount' -> formatMoney (DataTable.tsx:128,268). So the same work shows e.g. '₹86.50 L' here vs exact rupees+paise elsewhere. Precision loss above 2^53 paise (~₹9e13) is real in code but practically unreachable; the true defect is inconsistent, lossy display and duplicate helper (violates paise-string rule in CLAUDE.md).
- **Files to change:** `apps/web/src/app/(app)/works/orders/page.tsx`
- **Fix steps:**
  1. Remove local fmtCost; keep `estimatedCost` in OrderRow as the raw paise string (String(row.estimatedCostMinor ?? '0')).
  2. Set column { key:'estimatedCost', cellType:'amount', align:'right' } so DataTable applies formatMoney.
  3. If Cr/L compact display is wanted, add a shared formatMoneyCompact in lib/formatters using BigInt, not Number.
  4. Delete the `as number | undefined` cast at line 75.
- **Acceptance:**
  - Unit test: estimatedCostMinor '865000050' renders '₹86,50,000.50' on both /works/orders and /works/proposals.
  - Sorting by cost sorts numerically (paise) not by formatted string.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money display only; verify DataTable amount sort works on strings.

### GAP-WORKS-ORDERS-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** STATUS_LABELS ("DAO Finalized", "TS Eligible") are passed as the status value to StatusPill, which lower-cases and re-humanizes it, so users see "Dao Finalized" / "Ts Eligible" and the acronym labels are lost (page.tsx:25-31,92; StatusPill.tsx:53-61; formatters.ts:44-52).
- **Verified evidence:** orders/page.tsx:25-31,73 STATUS_LABELS gives 'DAO Finalized'/'TS Eligible' into statusLabel; column cellType 'status' (page.tsx:92) -> DataTable.tsx:127 <StatusPill status=label>; StatusPill.tsx:52-61 lower-cases via humanizeStatus (formatters.ts:44-52) giving 'Dao Finalized'/'Ts Eligible'. Also STATUS_MAP (StatusPill.tsx:5-39) has no dao_finalized/ts_eligible so the pill tone falls to 'info'. Same wrong text appears on proposals list and detail (humanize).
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/works/orders/page.tsx`
- **Fix steps:**
  1. Add dao_finalized:'DAO Finalized', ts_eligible:'TS Eligible', aa_issued:'AA Issued' to STATUS_ACRONYM_LABELS in formatters.ts.
  2. Add tones to STATUS_MAP in StatusPill.tsx (dao_finalized/'dao finalized' -> info or good; ts_eligible -> info).
  3. Note STATUS_MAP is looked up with the raw key; normalise underscores to spaces or add both spellings.
  4. In orders/page.tsx pass the raw status (`status`) in the row, not statusLabel, and drop STATUS_LABELS.
- **Acceptance:**
  - Unit test: humanizeStatus('dao_finalized') === 'DAO Finalized'.
  - Manual: /works/orders, /works/proposals and detail show 'DAO Finalized' with a consistent pill colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** humanizeStatus is shared app-wide; only new keys added, low risk.

### GAP-WORKS-ORDERS-04  ·  MEDIUM  ·  partly  ·  theme NAVUX (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** "New Proposal" secondary button goes to the proposals list, not the create form (page.tsx:110); the page duplicates /works/proposals (subtitle calls these "work proposals") and its endpoint /work-orders differs from proposals' /proposals, so which is the system of record is unclear.
- **Verified evidence:** Confirmed in code: 'New Proposal' Link goes to /works/proposals (orders/page.tsx:110-112), not /works/proposals/new; subtitle says 'work proposals' (:104); endpoint /api/v1/works/work-orders (:83) vs /works/proposals (loaders.ts:382). Which one is the system of record cannot be verified: works-service is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/works/orders/page.tsx`
- **Fix steps:**
  1. Change href to /works/proposals/new.
  2. Reword subtitle/card copy to say 'work orders' if it is a distinct entity, or retire the page and redirect to /works/proposals after a product decision.
  3. Ask backend which endpoint owns the lifecycle and document it in the page header comment.
- **Acceptance:**
  - Manual: 'New Proposal' opens the create form.
  - Decision recorded on whether /works/orders remains.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for the href fix; removing the page is a product decision.

### GAP-WORKS-ORDERS-05  ·  LOW  ·  partly  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Unknown statuses sort last but show the raw token (page.tsx:73,76); no status filter tabs as on the proposals list.
- **Verified evidence:** Unknown statuses get order 99 and sort last (page.tsx:73,76) and statusLabel falls back to the token (:73), but StatusPill then humanizes it so users see 'Foo Bar', not the raw token. No status filter tabs is true: only the text filter (page.tsx:122-123) exists, whereas proposals/page.tsx:83-110 has tabs.
- **Files to change:** `apps/web/src/app/(app)/works/orders/page.tsx`
- **Fix steps:**
  1. Pass raw status and rely on shared StatusPill/humanizeStatus.
  2. Optionally add status tabs (reuse whatever shared tab component replaces PROPOSALS-04 inline tabs) driven by ?status=.
  3. Log unknown statuses via the existing telemetry rather than silently sorting last.
- **Acceptance:**
  - Test: status 'weird_state' renders 'Weird State' and sorts after 'closed'.
  - Manual: status tabs filter the list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-PROPOSALS-04


---
## /works/proposals  —  `works/proposals.html`

- **Source:** `apps/web/src/app/(app)/works/proposals/page.tsx`
- **Design reference:** `redesign/works/proposals.html`

### GAP-WORKS-PROPOSALS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: proposals/page.test.tsx Type column shows the work-type name; closed by #1867)
- **First-pass claim:** Type and Office columns print 8-character id prefixes of workTypeId / executingDivisionId (loaders.ts:372,375) — unreadable as a register column and useless for search.
- **Verified evidence:** loaders.ts:373 type: shortId(workTypeId) and :376 office: shortId(executingDivisionId); shortId (works/_data/format.ts) returns first 8 chars + '…'. ProposalsTable.tsx:11,14 renders these as 'Type' and 'Office' columns. Not searchable by name.
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/proposals/page.tsx`
- **Fix steps:**
  1. In page.tsx fetch /works/masters/work-types once and build an id->name map (server side).
  2. Pass names into mapProposalRow (or map after fetch); fall back to '—' not the id prefix.
  3. Find an endpoint for division names (unverified) or drop the Office column until names are available.
  4. Remove shortId for authority/tender columns too (loaders.ts:74,123,126…) as a follow-up.
- **Acceptance:**
  - Manual: Type column shows 'Road Works' etc.
  - Search 'road' in the table filter matches.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Extra fetch latency; name lookup failure must degrade gracefully.
- **Depends on:** GAP-WORKS-PROPOSALS-NEW-01

### GAP-WORKS-PROPOSALS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** StatCards and tab counts use the server fetch while the table renders the useSeededResource copy (page.tsx:33-38 vs ProposalsTable.tsx:18): offline the table shows saved rows while stats read 0 and the tab card title says "(0)".
- **Verified evidence:** proposals/page.tsx:33-38 counts computed from server `proposals` (empty on error), tab counts :86-87, card title :112-117; ProposalsTable.tsx:16 renders useSeededResource data (falls back to the cached copy when server empty/error, resource.ts:242-250). Offline/error: stats read 0, title '(0)', table shows cached rows.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/page.tsx`, `apps/web/src/app/(app)/works/proposals/ProposalsTable.tsx`
- **Fix steps:**
  1. Move StatGrid, tabs and card title counts into the client component that owns useSeededResource, computing from `data`.
  2. When source==='error' and no cache, render <RefreshErrorState> instead of 0s.
  3. Show '—' for counts when provenance is 'cached' with a 'cached' label.
- **Acceptance:**
  - Test: server error + cache with 3 rows shows 3 in stats/title and 'cached' badge.
  - Test: error + no cache shows RefreshErrorState.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-PROPOSALS-03

### GAP-WORKS-PROPOSALS-03  ·  HIGH  ·  confirmed  ·  theme WIRING (was CAP)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Filter tabs can show stale rows: the server filters by ?status= (page.tsx:46-50) but ProposalsTable holds rows in useState(initialData) and its effect depends only on [cacheKey, serverSource] (resource.ts:221,229-256). On a client-side tab switch the component stays mounted with the same key, so the table can keep the previous tab's rows under the new tab's title; the cache key "works-proposals" is also overwritten with whichever filtered subset was last loaded (resource.ts:238). Inferred from code; not run.
- **Verified evidence:** page.tsx:46-49 passes `filtered` per ?status=. ProposalsTable.tsx:16 calls useSeededResource('works-proposals', proposals,...); resource.ts:221 useState(initialData) and the effect deps [cacheKey, serverSource] (resource.ts:~255) do not include initialData; setData only runs on mount. In App Router a searchParams-only navigation keeps the client component mounted, so rows stay from the first tab while the card title changes. resource.ts:238 also writeCache('works-proposals', initialData) stores whichever filtered subset loaded last, corrupting the offline copy. Not run, but follows from code.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/ProposalsTable.tsx`, `apps/web/src/app/(app)/works/proposals/page.tsx`, `apps/web/src/lib/sync/resource.ts`
- **Fix steps:**
  1. Quick fix: in page.tsx add key={activeTab} to <ProposalsTable> to force remount.
  2. Better: always cache the unfiltered list and filter client-side from useSeededResource data with a status prop.
  3. Or add initialData to resource.ts effect deps via a stable signature (e.g. JSON key of ids).
  4. Use per-tab cache keys if filtering server-side.
- **Acceptance:**
  - Component test: rerender with different proposals prop shows new rows.
  - Manual: All -> Draft -> DAO Finalized shows matching rows and counts; offline cache still holds the full list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** resource.ts is shared by other pages; prefer the key fix.

### GAP-WORKS-PROPOSALS-04  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Filter tabs are inline-styled links without aria-current, and an unknown status shows label "All" with zero rows (page.tsx:51-52,90-107).
- **Verified evidence:** proposals/page.tsx:84-110 tabs are Links with inline styles and no aria-current (compare masters/page.tsx:158 which sets aria-current). Unknown ?status=foo: activeTabLabel falls back to 'All' (:51-52), filtered is empty, title shows 'All (0)' (:116).
- **Files to change:** `apps/web/src/app/(app)/works/proposals/page.tsx`, `apps/web/src/app/_components/ds/FilterTabs.tsx`
- **Fix steps:**
  1. Create shared ds FilterTabs (Links, aria-current='page', role-less nav with aria-label).
  2. Use it here with STATUS_TABS.
  3. Normalise unknown status to 'all' (or notFound) before filtering, so title/label match.
  4. Replace inline styles with CSS classes/tokens.
- **Acceptance:**
  - Test: active tab has aria-current='page'.
  - Test: ?status=foo shows All with full list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-PROPOSALS-05  ·  LOW  ·  partly  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Only Draft and DAO Finalized exist as filters; TS-eligible/approved proposals move on to other screens, so lifecycle after DAO finalisation is not visible here (page.tsx:6-17).
- **Verified evidence:** STATUS_TABS is All/Draft/DAO Finalized (page.tsx:18-22); the comment at :6-17 states the backend only sets draft/dao_finalized (writer proposal/consumer.ts absent from snapshot, cannot re-verify). The claim that TS-eligible/approved proposals 'move on to other screens' is an inference: AA/TS live under /works/approvals but the list here gives no link to them; the detail page has 'Create AA' (proposals/[id]/page.tsx:314).
- **Files to change:** `apps/web/src/app/(app)/works/proposals/page.tsx`
- **Fix steps:**
  1. Add a helper line/link on the list to /works/approvals for post-DAO stages.
  2. Show AA/TS status column only if a list API exposes it (backend confirmation needed).
  3. Otherwise keep as is and close.
- **Acceptance:**
  - Product confirms lifecycle visibility expectation.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /works/proposals/[id]  —  `works/proposals-detail.html`

- **Source:** `apps/web/src/app/(app)/works/proposals/[id]/page.tsx`
- **Design reference:** `redesign/works/proposals-detail.html`

### GAP-WORKS-PROPOSALS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was DEADROUTE)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: proposals/[id]/page.test.tsx 500 vs 404 tests; closed by #2039)
- **First-pass claim:** A failed proposal fetch calls notFound() (page.tsx:186-188): an outage reads as "proposal does not exist", and there is no retry or error state.
- **Verified evidence:** proposals/[id]/page.tsx:186-188: `if (source === 'error' || !proposal || !proposal.id) notFound()`. fetchJson already returns HTTP status (apiClient.ts:34-35,144) so 5xx/network/401 are indistinguishable from 404 on this page. RefreshErrorState exists (ds/RefreshErrorState.tsx) and is used e.g. metadata/records/page.tsx:23. Same pattern in contractors/[id]:133.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/page.tsx`
- **Fix steps:**
  1. Destructure `status` from getProposal.
  2. If status===404 (or source api with null proposal) call notFound().
  3. If source==='error' otherwise, return <RefreshErrorState error={toHumanError('load',{area:'work proposal'})} backHref='/works/proposals' /> inside the page shell.
  4. Handle 401/403 with the same message helper used by other detail pages.
- **Acceptance:**
  - Test: mocked 500 renders retry state, not the 404 page.
  - Test: mocked 404 still renders notFound.
  - Manual: Retry re-fetches via router.refresh().
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-PROPOSALS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** Closed per owner decision D4c #38 (2026-10-27): keep the current timeline (Proposal Created done, DAO Finalized current for a draft); the acceptance wording is amended to match, no code change
- **W2 works part 2 note (#2047):** status-to-step mapping for a draft is still the owner's call (see the reopen note above). INTERIM, owner decision.
- **First-pass claim:** Timeline promises "Submitted", "TS Eligible" and "AA Issued" steps that the backend never sets (list page comment, proposals/page.tsx:6-17), so a draft shows "Submitted" as the current step, and after DAO finalisation "TS Eligible" as current with no path to advance it (page.tsx:117-153).
- **Verified evidence:** page.tsx:117 PROPOSAL_STATUSES=[draft,submitted,dao_finalized,ts_eligible,aa_issued]; buildTimelineSteps 119-153. For status 'draft' (idx 0) the 'Submitted' step is 'current' (:135); for 'dao_finalized' (idx 2) 'TS Eligible' is 'current' (:146) and AA Issued upcoming. proposals/page.tsx:6-17 comment states the backend only ever writes draft and dao_finalized (backend source absent, cannot re-verify). 'Create AA' link (page.tsx:314) exists but does not advance this status.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/page.tsx`
- **Fix steps:**
  1. Reduce timeline to steps the backend sets: Created (draft) -> DAO Finalized.
  2. Or derive TS/AA steps from separate approval records via /works/approvals endpoints (needs backend confirmation) rather than proposal.status.
  3. Fix state logic so unknown statuses do not mark 'created' as current.
  4. Rename 'Submitted' or remove; the DAO finalize action returns 202 (ProposalActions.tsx:42), so show 'Finalization queued' only if the API exposes it.
- **Acceptance:**
  - Test: draft -> Created current, rest upcoming; dao_finalized -> Created+DAO done, no dead 'current' step.
  - Manual: no step shows 'current' that has no action to advance it.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong step derivation could misstate approval status.

### GAP-WORKS-PROPOSALS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Edit pre-fills cost with Math.round(rupees) (ProposalEditToggle.tsx:83-84) and Save sends whichever whole-rupee value differs from the stored paise, so opening and saving a proposal costed ₹86,50,000.50 rewrites it to ₹86,50,001 without the user editing the field.
- **Verified evidence:** ProposalEditToggle.tsx:83-84 prefill = String(Math.round(minorToRupeesOrNull(...))); handleSubmit :100-102 costMinor=Math.round(parseFloat(costRupees)*100) and patches when String(costMinor)!==String(proposal.estimatedCostMinor). For stored '865000050' the prefill is '8650001' -> '865000100' differs, so estimatedCostMinor is PATCHed unchanged by the user. Edit is draft-only (:58-59).
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/ProposalEditToggle.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add paiseToRupeeString(minor: string|bigint) (BigInt, exact 2dp) and rupeeStringToPaise(str) (regex ^\d+(\.\d{1,2})?$, BigInt math) in lib/formatters or lib/money.
  2. Prefill costRupees with paiseToRupeeString, no Math.round.
  3. Only include estimatedCostMinor in patch when costRupees !== initial prefill string, then send rupeeStringToPaise(costRupees).
  4. Reuse rupeeStringToPaise in proposals/new/page.tsx (NEW-02).
- **Acceptance:**
  - Unit test: '865000050' -> '8650000.50' -> back to '865000050'; open+save with no edit yields 'No changes detected.'.
  - Unit test: '8650000.505' rejected.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money field in a maker flow; add tests before merging.
- **Depends on:** GAP-WORKS-PROPOSALS-NEW-02

### GAP-WORKS-PROPOSALS-DETAIL-04  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W2 works part 1: closed by #2075; UUID guards already in ProposalExtActions.tsx:465-474; added acceptance tests: non-UUID sub-division/section blocks submit with inline error, no confirm opened, no POST sent)
- **W2 works part 2 note (#2047):** Sub-Division/Section have no master and the API has no reason field. INTERIM, owner decision. (NEEDS OWNER DECISION: Sub-Division/Section masters)
- **W2 works note (#2039):** Division is now an EntityPicker with its name in the confirm; Sub-Division/Section have no master (UUID inputs kept with guard) and the API has no reason field. INTERIM, owner decision.
- **W0 note:** partly fixed by #1867 — Done: UUID regex validation, ConfirmDialog with review summary for office and COA mapping. Remains: Division/Sub-division/Section still raw UUID text inputs (no EntityPicker), COA format validation not added, no mandatory reason field
- **First-pass claim:** Split / Map COA / Map Office take raw UUIDs and free-text account heads (Division ID, Sub-Division ID, Section ID; Major Head max 16 chars) with no lookup (ProposalExtActions.tsx:397-437,308-332); they are append-only so a typo becomes permanent (comments at :250,:366) — the confirm dialog is the only safeguard.
- **Verified evidence:** ProposalExtActions.tsx: MapOfficeForm 397-437 takes Division/Sub-Division/Section as free-text UUIDs (placeholders 'Division UUID'); MapCOAForm 308-332 takes free-text heads maxLength 16; comments at :250 and :366 say mappings are append-only. Each already uses ConfirmDialog (danger) via useConfirmAction (:101,252,368) but with no reason field and no lookup/validation of ids or heads. Whether the API validates ids/heads or emits audit events cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/ProposalExtActions.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`
- **Fix steps:**
  1. Create a shared <EntityPicker> (search-by-name, returns id) and use it for Division/Sub-Division/Section; source the office list from the org master endpoint (needs backend confirmation).
  2. Add client-side uuid check (zod) before trigger(); block submit on invalid UUID.
  3. For COA heads add format validation (digits, fixed lengths) and a read-only review summary inside the ConfirmDialog listing the values being made permanent.
  4. Add a mandatory reason textarea to the confirm and send it in the payload if the API accepts it.
  5. Ask backend to confirm zod validation and audit emission on coa/office-mapping.
- **Acceptance:**
  - Test: non-UUID divisionId blocks submit with inline error.
  - Confirm dialog shows the selected division name and COA codes.
  - Manual: cannot select a non-existent division.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Append-only records; typo protection is high value.
- **Depends on:** GAP-WORKS-PROPOSALS-NEW-01

### GAP-WORKS-PROPOSALS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: ProposalExtActions.test.tsx parent label + confirm dialog repeats data; closed by #2039)
- **First-pass claim:** Split Proposal shows the parent as "{id8}…" and asks only for a description — no lines, amount split or estimate is captured although the dialog says "split lines" (ProposalExtActions.tsx:184-195,220).
- **Verified evidence:** SplitProposalForm (ExtActions.tsx:84-230): parent shown as workId.slice(0,8)+'…' (:194), only a description textarea (:197-214), POST body {parentWorkId, description} (:107). Dialog text says 'from the split lines' (:220) though no lines or amounts are captured. Success text claims 'Child work … is now active' (:154) though the split is only requested. Backend split semantics (cost apportioning) cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/ProposalExtActions.tsx`, `apps/web/src/app/(app)/works/proposals/[id]/page.tsx`
- **Fix steps:**
  1. Pass workNumber and estimatedCost into ProposalExtActions from page.tsx and show 'WO-123 (₹x)' as the parent.
  2. Either add split-amount input (paise-exact, must not exceed parent cost) if the API supports it, or reword the dialog to 'creates a new child proposal with this description'.
  3. Add a reason field and show it in the ConfirmDialog.
  4. Fix success wording ('Split requested') unless the API confirms creation.
- **Acceptance:**
  - Manual: parent displays work number and cost.
  - Dialog text matches captured data.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money apportioning if amounts are added.
- **Depends on:** GAP-WORKS-PROPOSALS-DETAIL-04

### GAP-WORKS-PROPOSALS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — Done: Habitation, Sector, Charged/Voted rows added. Remains: workTypeId still mapped but not resolved to a name or shown
- **First-pass claim:** Fields habitation, sector, chargedOrVoted, budgetYear are mapped and only budgetYear is shown; chargedOrVoted (a budgeting classification) and workTypeId are hidden (page.tsx:18-38,192-200).
- **Verified evidence:** WorkProposal type/mapper map habitation, sector, chargedOrVoted, workTypeId (page.tsx:28-35,85-86,91-92) but detailRows (:192-200) show only workNumber, planOrNonPlan, budgetYear, dates, remarks; KPI tiles show district/taluka/village. habitation, sector, chargedOrVoted, workTypeId are never rendered. workTypeId would need a name lookup (masters/work-types).
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/page.tsx`
- **Fix steps:**
  1. Add Habitation, Sector and Charged/Voted rows to detailRows using humanize() where enum-like.
  2. Resolve workTypeId to a name via GET /works/masters/work-types (endpoint used at masters/page.tsx:109) and show it, or omit if lookup fails.
  3. Delete unused mapped fields if a product decision says they are not needed.
- **Acceptance:**
  - Manual: detail page lists the added fields with '—' when empty.
  - Test: mapper output fields all appear in render or are removed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-PROPOSALS-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Role lists diverge: WRITE_ROLES is redefined locally in ProposalEditToggle.tsx:25-27 instead of importing PROPOSAL_WRITE_ROLES like the two sibling components, so they can drift.
- **Verified evidence:** ProposalEditToggle.tsx:25-27 defines a local WRITE_ROLES array; ProposalActions.tsx:6 and ProposalExtActions.tsx:6 import PROPOSAL_WRITE_ROLES from lib/auth/workRoles.ts. Values are currently identical (workRoles.ts:1-9), so no behaviour difference today, only drift risk.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/ProposalEditToggle.tsx`
- **Fix steps:**
  1. Import PROPOSAL_WRITE_ROLES from '@/lib/auth/workRoles' and delete the local WRITE_ROLES.
  2. Use the same `(PROPOSAL_WRITE_ROLES as readonly string[]).includes(r)` cast as the siblings.
  3. Better: export a hasProposalWriteRole(roles) helper and use it in all three.
- **Acceptance:**
  - Grep shows a single role list for proposals.
  - Existing role tests still pass.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None if lists stay identical.

### GAP-WORKS-PROPOSALS-DETAIL-08  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Action buttons mix DS Button, a Tailwind-classed button (ProposalActions.tsx:57-63) and .btn links; layout is a flex row with no wrap rule (page.tsx:289-320).
- **Verified evidence:** ProposalActions.tsx:57-63 is a raw <button> with Tailwind classes (the app uses ds Button/.btn); page.tsx:297 uses className='btn ghost' Link, :301 ds Button, :314 'btn secondary' Link. Footer flex row (page.tsx:289-296) has no flexWrap, and the Edit form <div> is rendered by ProposalEditToggle as a sibling inside the same flex row, so opening it lays the form out beside the buttons.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/[id]/ProposalActions.tsx`, `apps/web/src/app/(app)/works/proposals/[id]/page.tsx`, `apps/web/src/app/(app)/works/proposals/[id]/ProposalEditToggle.tsx`
- **Fix steps:**
  1. Replace the Tailwind button with <Button variant='primary'> from ds.
  2. Add flexWrap:'wrap' to the footer row.
  3. Move the edit form out of the button row (render below the row, full width).
  4. Use one consistent variant scheme for Link-buttons.
- **Acceptance:**
  - Manual at 375px width: buttons wrap, edit form is full width below.
  - No Tailwind utility classes remain in ProposalActions.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Visual only.


---
## /works/proposals/new  —  `works/proposals-new.html`

- **Source:** `apps/web/src/app/(app)/works/proposals/new/page.tsx`
- **Design reference:** `redesign/works/proposals-new.html`

### GAP-WORKS-PROPOSALS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2039)
- **W0-10 note:** review found the W0 tick partly — EntityPicker used, but searchWorkTypes/fetchAll (lib/entityAdapters/workType.ts) returns [] on non-ok HTTP, so a failing fetch shows No matches rather than an error (acceptance: failing fetch shows an error)
- **First-pass claim:** Work type is a raw UUID text box with placeholder "UUID from masters" (page.tsx:166-175): a clerk must copy an id from /works/masters, whose table shows only 8 characters (masters/page.tsx:124), so the field is effectively unusable without database access.
- **Verified evidence:** proposals/new/page.tsx:165-175 is a text input 'Work type ID (UUID)' placeholder 'UUID from masters'. masters/page.tsx:124 shows only String(id).slice(0,8), so the full UUID is not copyable from that table. A masters endpoint for work-types exists (masters/page.tsx:109, MASTER_TYPES includes 'work-types'). No EntityPicker component exists in apps/web (grep empty); RefreshErrorState etc. exist but not a picker.
- **Files to change:** `apps/web/src/app/_components/ds/EntityPicker.tsx`, `apps/web/src/app/(app)/works/proposals/new/page.tsx`, `apps/web/src/app/(app)/works/masters/page.tsx`
- **Fix steps:**
  1. Create ds/EntityPicker (combobox: fetch options from a URL prop, show name+code, return id).
  2. Use it in new/page.tsx for workTypeId with source /api/proxy/v1/works/masters/work-types.
  3. Show a full copyable id (or name) in masters table as interim fallback.
  4. Validate UUID with zod before submit.
- **Acceptance:**
  - Manual: user selects a work type by name and the POST body carries its id.
  - Test: picker with failing fetch shows an error, not an empty free-text box.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared component; reused by other UUID findings.

### GAP-WORKS-PROPOSALS-NEW-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 closed by #1867; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: rupeeStringToPaise string parsing; 0 and over-precise rejected)
- **First-pass claim:** Estimated cost accepts 0 and any magnitude with no lakh/crore feedback; conversion uses Math.round(Number(x)*100) so values with many decimals or above 2^53 paise lose precision (page.tsx:61) — money should be parsed as a decimal string to paise, not through float.
- **Verified evidence:** new/page.tsx:61 estimatedCostMinor=String(Math.round(Number(form.estimatedCost||'0')*100)); input type=number min=0 step=0.01 required (:151-162) so 0 is accepted and browsers reject >2 decimals (step) unless bypassed. >2^53 paise (~₹9e13) is unreachable in practice, so the float claim is theoretical, but float parsing violates CLAUDE.md paise rule and 1.005-style values can misround. No lakh/crore echo or zero-cost guard: true. Server zod validation cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/new/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add rupeeStringToPaise(str) (regex, BigInt) shared with ProposalEditToggle.
  2. Change input min to 0.01 and reject zero client-side with inline message.
  3. Show live echo under the field using formatMoney(paise) (e.g. '₹5,00,000.00').
  4. Use zod schema for the form before fetch.
- **Acceptance:**
  - Unit test: '500000.10' -> '50000010'; '0' rejected; '1.005' rejected.
  - Manual: entering 500000 shows '₹5,00,000.00'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money creation path.

### GAP-WORKS-PROPOSALS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 closed by #1867; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: copy says 'Create draft'; redirects to the created proposal)
- **First-pass claim:** Header says "Submit a new work proposal for approval", button says "Submit" and the toast says "Work proposal submitted", but the record is created as a draft (proposals list has a Draft status, proposals/page.tsx:37,79); approval is a separate action on the detail page.
- **Verified evidence:** new/page.tsx:91 subtitle 'Submit a new work proposal for approval.', :232 button 'Submit', :78 toast 'Work proposal submitted.', :77 message 'Created.'. Detail page has a separate 'DAO Finalize' action (ProposalActions.tsx:62) and list has Draft status (proposals/page.tsx:19-20), so creation yields a draft; backend creation status cannot be verified directly.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/new/page.tsx`
- **Fix steps:**
  1. Subtitle: 'Create a draft work proposal. You can finalize it for DAO from its detail page.'
  2. Button: 'Create draft'; busy label 'Creating…'.
  3. Toast: 'Draft proposal created.'; redirect to the new proposal's detail if the response has an id, else the list.
  4. Remove duplicate 'Created.' banner.
- **Acceptance:**
  - Manual: copy no longer says 'submitted'/'for approval'.
  - Redirect goes to the created proposal when id returned.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-WORKS-PROPOSALS-NEW-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [~] **Status** (NEEDS OWNER DECISION: location field label and master data for location picker; GAP-WORKS-PROPOSALS-NEW-04) [partly built by 31fc27889 per owner decision D4c #39, 2026-10-27: label is now Tehsil / Block (en+hi); LGD district/block picker still open: location-service masters are role-gated to location roles and expose no admin-level filter, so works users cannot read them]
- **W2 works part 2 note (#2047):** Taluka/Tehsil label and location masters need a product decision. INTERIM, owner decision.
- **W2 works note (#2039):** needs a product decision (Taluka/Tehsil label, location masters).
- **First-pass claim:** Location is three free-text fields (District, Taluka, Village) — "Taluka" is not an Odisha administrative term (tehsil/block) and values are not validated against a master; no latitude/longitude or executing division/office field although the list shows Office (ProposalsTable.tsx:14).
- **Verified evidence:** Location is three free-text inputs, maxLength 128 (new/page.tsx:177-211), labelled 'Taluka'; no lat/long or executing-division field on the form. Whether 'Taluka' is wrong for the tenant is a domain judgement (Odisha uses tehsil/block) and cannot be verified from code. Executing office can be set after creation via Map Office (ProposalExtActions.tsx:352+) and the list shows Office (ProposalsTable.tsx:14), so missing office at create is a workflow gap, not absence of the capability.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/new/page.tsx`
- **Fix steps:**
  1. Get product decision on labels (Tehsil/Block) and whether district is a master.
  2. If location masters exist, replace with EntityPicker (district -> block -> village).
  3. Add optional executing division via EntityPicker if the create API accepts executingDivisionId (unverified).
  4. Add zod schema for lengths.
- **Acceptance:**
  - Decision recorded.
  - Manual: district chosen from list.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Depends on availability of location masters.
- **Depends on:** GAP-WORKS-PROPOSALS-NEW-01

### GAP-WORKS-PROPOSALS-NEW-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W1 SF-19: closed by #2014; earlier W0 tick #1867 re-confirmed against 9e34d2e4a: the Cancel discard prompt was a native window.confirm; it is now ds/ConfirmDialog; beforeunload guard unchanged)
- **First-pass claim:** No Cancel/back button inside the form and no unsaved-changes guard; only the header back link (page.tsx:89-94).
- **Verified evidence:** new/page.tsx:87-94 PageHeader back link to /works/proposals is the only navigation; form (106-234) has only a Submit button, no Cancel, and no beforeunload / dirty-state guard.
- **Files to change:** `apps/web/src/app/(app)/works/proposals/new/page.tsx`
- **Fix steps:**
  1. Add a ghost <Button> 'Cancel' next to Submit routing to /works/proposals.
  2. Track dirty state (form differs from initial) and register a beforeunload listener while dirty.
  3. Confirm via ConfirmDialog on Cancel/back when dirty.
- **Acceptance:**
  - Manual: typing then clicking Cancel shows a discard confirm.
  - Browser reload with dirty form prompts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /works/reports  —  `works/reports.html`

- **Source:** `apps/web/src/app/(app)/works/reports/page.tsx`
- **Design reference:** `redesign/works/reports.html`

### GAP-WORKS-REPORTS-01  ·  HIGH  ·  partly  ·  theme UUID

- [x] **Status** (W2 works: closed by #2048; active-filter chip and picker label show the division name, never the uuid (ReportFilters.tsx); ReportFilters.test.tsx)
- **W0 note:** partly fixed by #1934 — Division via EntityPicker with UUID guard (also touched in #1867). Remains: active-filter chip shows raw "Division <uuid>" instead of the name
- **First-pass claim:** Division is a free-text "Division ID" with placeholder "e.g. DIV-001" (ReportFilters.tsx:70-78), yet every other works screen treats division ids as UUIDs (proposals/[id] Map Office); a typed code silently returns an empty register with the message "No works match the selected filters".
- **Verified evidence:** ReportFilters.tsx:69-80 (printed 265-276) free-text input 'Division ID' placeholder 'e.g. DIV-001'; Map Office elsewhere uses UUIDs (ProposalExtActions.tsx:405). The value is sent unchanged as ?divisionId= (reports/page.tsx:49). What the API does with a non-UUID (400 vs empty result) cannot be verified: works-service is absent. If it 400s, page.tsx:97 shows the error badge and zeros, not the 'No works match' message.
- **Files to change:** `apps/web/src/app/(app)/works/reports/ReportFilters.tsx`, `apps/web/src/app/(app)/works/reports/page.tsx`
- **Fix steps:**
  1. Replace text input with EntityPicker (division name -> uuid).
  2. Validate UUID before router.push; keep the id only in the URL.
  3. Show the selected division name in the filter echo.
- **Acceptance:**
  - Manual: typing a code is impossible; selecting a division filters.
  - Test: invalid uuid does not navigate.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Requires a divisions lookup endpoint (unverified).
- **Depends on:** GAP-WORKS-PROPOSALS-NEW-01

### GAP-WORKS-REPORTS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: reports/page.test.tsx per-block retry tests; closed by #1867)
- **First-pass claim:** One aggregate error badge for three independent fetches (page.tsx:97): a failed summary shows "Total Works 0" next to a populated register, and vice-versa, with no indication which block is stale.
- **Verified evidence:** reports/page.tsx:66-95 three fetchJson calls each with own source; :97 hasError ORs them; :126 renders one DataSourceBadge; summary fallback is {0,0,0} (:73) and StatCards print those (:140-152). A failed summary next to a populated register is therefore shown as 'Total Works 0' with only a generic badge.
- **Files to change:** `apps/web/src/app/(app)/works/reports/page.tsx`
- **Fix steps:**
  1. Per block: if sSource==='error' render '—' in the StatCards and a per-card inline error with retry (RefreshErrorState).
  2. Same for status breakdown and register cards (Card-level RefreshErrorState instead of the empty table).
  3. Keep the header badge only as a summary.
- **Acceptance:**
  - Test: summary error, works ok -> cards show '—', register still renders.
  - Test: register error -> register card shows retry, not 'No works found'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-REPORTS-03  ·  MEDIUM  ·  confirmed  ·  theme CAP (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Register is capped at page=1&pageSize=100 with no pager or total (page.tsx:88): departments with more than 100 works get a truncated "full list" (caption "full list of engineering works") and truncated CSV export.
- **Verified evidence:** reports/page.tsx:88 requests page=1&pageSize=100 with no pager and no total from the API (mapResponse takes payload.data only, :92); caption says 'full list' (:188); DataTable exportable exports the loaded rows (:186-187, DataTable.tsx:268). Departments with >100 works get a truncated list and CSV. Backend pagination/total fields cannot be verified. PII theme does not apply (no personal data).
- **Files to change:** `apps/web/src/app/(app)/works/reports/page.tsx`
- **Fix steps:**
  1. Read page/pageSize from searchParams and pass to the API; read total (if the API returns meta.total - verify) and render a pager.
  2. If no total is available, show 'Showing first 100' notice when length===100.
  3. Change the caption to drop 'full list'.
  4. Provide a server-side export endpoint (backend) for the complete CSV; gate/audit it.
- **Acceptance:**
  - Test: 100 rows returned -> notice shown.
  - Manual: page 2 loads next rows; CSV export label states scope.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Silent truncation of a report used for decisions.

### GAP-WORKS-REPORTS-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Filters are not validated: To before From is accepted, and the applied filters are not echoed anywhere except the inputs (ReportFilters.tsx:16-30).
- **Verified evidence:** ReportFilters.tsx:16-30 handleApply builds the query with no check that from<=to; date inputs have no min/max. Applied filters are echoed only because the inputs use defaultValue from searchParams (:250,:260,:270), so 'not echoed anywhere except the inputs' is accurate but the inputs do echo them. Backend handling of inverted ranges cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/reports/ReportFilters.tsx`
- **Fix steps:**
  1. Set min={fromDate} on To and max={toDate} on From, and block submit with an inline error when to<from.
  2. Show an 'Active filters' chip row on the page (page.tsx) with a clear link.
  3. Use a zod schema for the query in the client handler.
- **Acceptance:**
  - Test: from 2026-05-01, to 2026-04-01 shows an error and does not navigate.
  - Manual: chips reflect applied filters.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKS-REPORTS-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: reports/page.test.tsx residual 'Other / In progress' test; closed by #1867)
- **First-pass claim:** Summary/Status/Register use different fetches so their totals can disagree; there is no reconciliation and Active + Closed need not equal Total (page.tsx:135-154).
- **Verified evidence:** Cards use /reports/summary, breakdown /reports/status, register /reports/works (page.tsx:71-94) with no cross-check; the page renders total/active/closed with no 'other' bucket (:135-154). Proposals statuses include draft and dao_finalized (proposals/page.tsx:18-22) which are neither active nor closed, so Active+Closed<Total is plausible, but the endpoints' semantics cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/reports/page.tsx`
- **Fix steps:**
  1. Add an 'Other / In progress' card = total - active - closed (clamped at 0), or label cards with definitions.
  2. Compare register length/status counts to summary and show a small 'figures may differ' note if they mismatch and register is not truncated.
  3. Ask backend to confirm the definition of active/closed.
- **Acceptance:**
  - Manual: cards sum to Total or a residual card is shown.
  - Test: mismatched totals show the note.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-REPORTS-03

### GAP-WORKS-REPORTS-06  ·  LOW  ·  confirmed  ·  theme FORMAT (was VALIDATION)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: reports/page.test.tsx humanized Category test; closed by #1867)
- **First-pass claim:** Category column prints raw tokens ("regular") while Status is humanized (page.tsx:113,178); status breakdown uses a local humanizeStatus duplicate of lib/formatters (page.tsx:54-56).
- **Verified evidence:** reports/page.tsx:113 category: row.category raw (e.g. 'regular'), while status uses cellType 'status' (:178) which humanizes via StatusPill; humanizeStatus is redefined locally at :54-56 (regex-based) instead of importing humanizeStatus from lib/formatters (formatters.ts:44). The local one lacks the acronym map (N/A, and any DAO additions).
- **Files to change:** `apps/web/src/app/(app)/works/reports/page.tsx`
- **Fix steps:**
  1. Import humanizeStatus (and humanize from works/_data/format) and delete the local helper.
  2. Set category: humanize(row.category) as the proposals loader does (loaders.ts:370).
  3. Use the same helper for the status breakdown label (:103).
- **Acceptance:**
  - Test: category 'regular' renders 'Regular'.
  - Grep shows one humanizeStatus implementation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-WORKS-ORDERS-03


---
## /works/tenders  —  `works/tenders.html`

- **Source:** `apps/web/src/app/(app)/works/tenders/page.tsx`
- **Design reference:** `redesign/works/tenders.html`

### GAP-WORKS-TENDERS-01  ·  HIGH  ·  confirmed  ·  theme STATUS (was DATEFMT)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: deriveTenderStatus.test.ts (Awarded; no invented open/closed); closed by #2039)
- **First-pass claim:** Status is a heuristic: "closed" when the opening date is past, else "open" (loaders.ts:114,126-127; comment loaders.ts:115-118 admits no status column is returned), so a tender with an award reads "Open" until its opening date, and a past-dated pre-tender reads "Closed" before any bid is invited.
- **Verified evidence:** apps/web/src/app/(app)/works/_data/loaders.ts:95-104 (comment) states listTenders() returns no status; mapTenderRow (apps/web/src/app/(app)/works/_data/loaders.ts:112-129) uses status = dbStatus ?? (isPast ? 'closed' : 'open'), dbStatus being always null. No award info is in the row, so an awarded tender is 'open' until opening date. Nuance: a pre-tender with no openingDate gives isPast=false, so it reads 'open', not 'closed'; only past-dated ones read 'closed'. Backend claim comes from the code comment (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/tenders/page.tsx`, `apps/web/src/app/(app)/works/tenders/TendersTable.tsx`
- **Fix steps:**
  1. Request status (and award state) on the list endpoint, or join pre_tenders/awards in works-service; use it as the source.
  2. Until then relabel: rename statuses to 'Opening date passed' / 'Upcoming' or hide the Open/Closed stat cards.
  3. Extract one deriveTenderStatus() helper shared with detail (DETAIL-05).
- **Acceptance:**
  - Awarded tender shows Awarded.
  - No tender shows Open solely from a future date unless labelled as such.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Misleading pipeline status for procurement staff.
- **Depends on:** GAP-WORKS-TENDERS-DETAIL-05

### GAP-WORKS-TENDERS-02  ·  HIGH  ·  confirmed  ·  theme UUID (was MONEY)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: tenders.loader.test.ts name resolution + dash amount; closed by #2039)
- **First-pass claim:** Tender Type and Authority print 8-character id prefixes (loaders.ts:123,126); the Amount column is the tender amount while the create form never asks for one, so most rows will show ₹0.00.
- **Verified evidence:** apps/web/src/app/(app)/works/_data/loaders.ts:123,126 tenderType: shortId(tenderTypeId), authority: shortId(approvingAuthorityId) -> 'xxxxxxxx…' (apps/web/src/app/(app)/works/_data/format.ts:20-23). amount: str(r.tenderAmountMinor,'0') (124) renders ₹0.00 for missing amounts; the create form asks no amount (NEW-02), so ₹0.00 for pre-tenders is plausible but depends on backend.
- **Files to change:** `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/tenders/TendersTable.tsx`
- **Fix steps:**
  1. Fetch tender-types and authorities masters (or have list API return names) and map ids to names in mapTenderRow/page.
  2. Return '' / null for missing amount and make DataTable amount cell show '—'.
  3. Drop shortId fallback for user-facing columns.
- **Acceptance:**
  - Type and Authority columns show names.
  - Missing amount shows '—'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Display only.
- **Depends on:** GAP-WORKS-TENDERS-NEW-02, GAP-WORKS-TENDERS-NEW-03

### GAP-WORKS-TENDERS-03  ·  MEDIUM  ·  confirmed  ·  theme STALE (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat cards come from the server fetch, the table from useSeededResource (page.tsx:7-11, TendersTable.tsx:17): offline the table shows saved rows while the counts read 0.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/page.tsx:7-11 stats computed from server getTenders() `tenders`; apps/web/src/app/(app)/works/tenders/TendersTable.tsx:56 renders useSeededResource rows (cache fallback in lib/sync/resource.ts:229-250 when server data is empty/errored). Offline or on error, stat cards read 0 while cached rows show; the DataSourceBadge appears in the table only. Same happens if the server legitimately returns an empty list but a stale cache exists.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/page.tsx`, `apps/web/src/app/(app)/works/tenders/TendersTable.tsx`
- **Fix steps:**
  1. Move the stat cards into TendersTable (or a small client wrapper) and compute from the same `data` returned by useSeededResource.
  2. When provenance != 'live', show a 'cached' hint on the cards.
  3. Consider showing '—' instead of 0 when source==='error'.
- **Acceptance:**
  - Offline with cached rows: cards match the table rows.
  - Error with no cache: cards show '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-WORKS-TENDERS-04  ·  MEDIUM  ·  confirmed  ·  theme FILTER (was DATEFMT)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: TendersTable.test.tsx status and 7-day filters; closed by #2039)
- **First-pass claim:** No filter by status or opening-date range and no "opening this week" cue although opening date drives the status (TendersTable.tsx:11).
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/TendersTable.tsx:56-79 only enables DataTable text filter (filterable) and sorting; there is no status or opening-date control (DataTable has no facet support besides text filter). openingDate is a pre-formatted string (fmtDate in the loader), so range filtering would need the raw ISO date.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/TendersTable.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/tenders/page.tsx`
- **Fix steps:**
  1. Keep raw openingDate ISO in the row (hidden field) alongside the formatted one.
  2. Add status Segmented filter and 'Opening this week' quick-filter above the table in TendersTable, filtering `data` before passing to DataTable.
  3. Use formatIndianDate for display.
- **Acceptance:**
  - Selecting Closed shows only closed rows.
  - 'Opening this week' shows tenders within 7 days (IST).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKS-TENDERS-01

### GAP-WORKS-TENDERS-05  ·  LOW  ·  partly  ·  theme NAV (was DEADROUTE)

- [x] **Status** (W2 works: closed by #2048; awarded tenders open at #quotations and an Awarded stat card (TendersTable.tsx); TendersTable.test.tsx)
- **W0 note:** partly fixed by #1867 — Detail has id=quotations anchor and Awarded stat links to it; list still has no awarded/quotation count column (optional step 1).
- **First-pass claim:** Header has only "+ New pre-tender"; there is no link to quotations/awards from the list other than the row (page.tsx:25).
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/page.tsx:23-27 header actions has only '+ New pre-tender'; rows link to detail (apps/web/src/app/(app)/works/tenders/TendersTable.tsx:78) which hosts quotations and award actions, so navigation exists. No standalone quotations/awards list route exists under works/tenders (directory has only [id], new). Severity low; 'dead route' is not accurate.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/page.tsx`
- **Fix steps:**
  1. Optional: add a 'Quotations' / 'Awarded' count column in the list with link to detail#quotations.
  2. Add an id anchor for the Quotations card on the detail page.
- **Acceptance:**
  - Row click still opens detail.
  - Awarded count links to the quotations section.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-WORKS-TENDERS-01


---
## /works/tenders/[id]  —  `works/tenders-detail.html`

- **Source:** `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`
- **Design reference:** `redesign/works/tenders-detail.html`

### GAP-WORKS-TENDERS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme UUID (was I18N)

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — EntityPicker for contractor, Contractor column in quotations table, award sends contractorId; Add Quotation POST still sends contractorName only (comment: schema has no contractorId).
- **First-pass claim:** Add Quotation and Create Award take a typed "Contractor Name" (TenderActions.tsx:175-186,292-307) even though a contractor register exists (/works/contractors) and QuotationRow has contractorId (page.tsx:14); spelling variants of the same firm can be awarded, and the quotations table shows no contractor at all (page.tsx:177-188).
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/TenderActions.tsx:174-190 and 291-307 render a free-text 'Contractor Name' input (contractorName / awardContractor state, lines 25,72) and POST it as contractorName (lines 38, 92); no contractor lookup. apps/web/src/app/(app)/works/tenders/[id]/page.tsx:11-20 QuotationRow has contractorId but the DataTable columns (177-188) are Ref/Quoted Amount/Deviation/Status/Submitted, no contractor. /works/contractors exists and lists via GET /api/v1/works/contractors (contractors/page.tsx:65). Whether the backend accepts contractorId on the quotation/award commands cannot be verified (works-service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/TenderActions.tsx`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Create a shared EntityPicker (searchable select returning {id,label}) in ds; back it by GET /api/v1/works/contractors (same call as contractors/page.tsx:65).
  2. In TenderActions replace both contractor <input>s with EntityPicker; hold contractorId in state.
  3. Send contractorId (not contractorName) in handleAddQuotation and handleCreateAward once backend confirms the field; until then send both.
  4. In page.tsx resolve contractorId to name via the contractors fetch and add a 'Contractor' column to the quotations DataTable (fallback '—' when null).
  5. Preselect the award contractor from the chosen quotation (see DETAIL-06).
- **Acceptance:**
  - Component test: Add Quotation form cannot submit without a picked contractor; payload contains contractorId.
  - Manual: quotations table shows contractor name for each row.
  - Two quotations by the same firm resolve to one contractor id.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Award to wrong firm is a procurement/audit risk; changing payload needs backend contract check.
- **Depends on:** GAP-WORKS-TENDERS-DETAIL-06, EntityPicker (new shared component)

### GAP-WORKS-TENDERS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Award actions have no role gating and DAO / DO finalisation are two adjacent buttons available to anyone who sees the page (TenderActions.tsx:374-384); the dialog text "Ensure DAO approval is obtained" is the only control, and DO finalisation is not disabled until DAO has finalised.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/TenderActions.tsx:374-385 renders 'DAO Finalize Award' and 'DO Finalize Award' side by side whenever awardId exists; no role check anywhere in the component (lib/auth/roleGuard.ts is server-only, uses next/headers) and DO is not disabled until DAO is done. ConfirmDialogs (388-409) have descriptive text only; ConfirmDialog supports requireReason (ds/ConfirmDialog.tsx) but it is not set. handleAwardFinalize (128-154) POSTs with no body. Server-side role/order enforcement cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/TenderActions.tsx`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. In page.tsx (server) read the JWT roles (reuse decode logic in lib/auth/roleGuard.ts, expose a helper) and pass canDaoFinalize / canDoFinalize props to TenderActions.
  2. Render each button only when permitted; otherwise render disabled with explanatory tooltip.
  3. Pass finalization state from the award (needs backend field, else cannot disable DO until DAO) and disable DO until DAO is finalised.
  4. Set requireReason on both ConfirmDialogs and send the reason in the POST body once backend accepts it.
  5. Confirm the backend emits an audit event for each finalize (CLAUDE.md rule 8).
- **Acceptance:**
  - Test: user without DO role sees no active DO button.
  - Test: DO button disabled while DAO not finalised.
  - Dialog Confirm stays disabled until a reason is typed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval-chain control; wrong gating could block legitimate finalisation, so server must remain source of truth.
- **Depends on:** GAP-WORKS-TENDERS-DETAIL-05

### GAP-WORKS-TENDERS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme PAGINATION (was DEADROUTE)

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — GET /v1/works/tenders/:tenderId added and detail uses it with notFound(); list loader still pageSize=100 with no paging UI (server returns real meta.total).
- **First-pass claim:** The tender is found by fetching the entire register (pageSize=200) and filtering client-side (page.tsx:57-69); tenders beyond 200 404 by URL, and the list page fetches only 100 (loaders.ts:133), so the two screens disagree on which tenders exist.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/page.tsx:57-65 fetches /api/v1/works/tenders?pageSize=200 and finds by id (line 69); 404 at 76-78 when the register loaded but the id is absent. List loader uses pageSize=100 (apps/web/src/app/(app)/works/_data/loaders.ts:133). So tenders ranked 101-200 are reachable by URL but not listed, and tenders >200 404. The code comment (71-75) acknowledges the cap. A GET-by-id endpoint for tenders cannot be verified (works-service absent).
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/tenders/page.tsx`
- **Fix steps:**
  1. Confirm/add GET /api/v1/works/tenders/:id in works-service and use it in page.tsx instead of the list scan; keep list scan only as fallback.
  2. Map 404 from that endpoint to notFound(), other errors to an error state.
  3. Give the list a real pagination (server page/pageSize) instead of fixed 100 so list and detail agree.
  4. Extract a shared TENDER_PAGE_SIZE constant if the fallback is retained.
- **Acceptance:**
  - Tender number 250 in the register opens its detail page.
  - List page shows total count and can page past 100.
  - Bogus UUID still 404s.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Silent 404 on real tenders in large tenants; low money risk.

### GAP-WORKS-TENDERS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: tenders/[id]/page.test.tsx lowest-bid cases; closed by #2039)
- **First-pass claim:** Lowest Bid is min over Number(quotedAmountMinor) (page.tsx:90-94) — float math on paise strings; it also treats percentage-rate quotes (which carry no amount) as candidates and ignores status (withdrawn/rejected).
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/page.tsx:84-95: reduce over Number(q.quotedAmountMinor) then formatMoney(String(Math.round(min))). Float math is technically true but exact up to ~9e15 paise, so display error is not realistic; the real defects are that every quotation counts (no status filter, line 90) and a null/NaN amount yields 0 or NaN (Number(null)=0; NaN never < min). Row type declares quotedAmountMinor: string non-null (line 15) so whether percentage-rate quotes come with null/'0' cannot be verified (works-service absent). Also line 111 falls back to '0' which formatMoney renders as a real-looking ₹0.00.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`
- **Fix steps:**
  1. Replace Number() with BigInt parsing guarded by /^\d+$/; skip rows that fail.
  2. Filter out rows where status is withdrawn/rejected (confirm status vocabulary with backend) and where the method is percentage_rate / amount is null.
  3. Return '—' when no eligible quotation; pass the BigInt string straight to formatMoney (no Math.round).
  4. Line 111: use q.quotedAmountMinor ?? '' so DataTable shows '—' rather than ₹0.00.
- **Acceptance:**
  - Unit test: quotes [null,'500000','300000'] -> ₹3,000.00.
  - Withdrawn lowest quote is ignored.
  - All quotes ineligible -> '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Lowest-bid figure informs award decision; wrong number could mislead evaluators.
- **Depends on:** GAP-WORKS-TENDERS-DETAIL-06

### GAP-WORKS-TENDERS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: page.test.tsx Awarded status tile; closed by #2039)
- **First-pass claim:** Tender Status and Details Status print the raw or "—" value (page.tsx:160,210); the list endpoint returns no status (loaders.ts:115-118), so the stat is normally "—".
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/page.tsx:160 and 210 print String(tender?.status ?? '—'). apps/web/src/app/(app)/works/_data/loaders.ts:95-104 documents that listTenders() returns no status column, so tender.status is undefined and both show '—' always (backend claim taken from that comment; works-service absent). Raw value would also be unformatted (no StatusPill).
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Either remove the Tender Status stat and Details 'Status' row, or derive a real status (needs backend: join pre_tenders.status / award state).
  2. If kept, render with StatusPill and a humanised label.
  3. Share the derivation with the list page (see TENDERS-01) via one helper in _data/format.ts.
- **Acceptance:**
  - No permanent '—' status tiles on detail page.
  - Awarded tender shows an 'Awarded' status.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; avoid inventing a status the server does not own.
- **Depends on:** GAP-WORKS-TENDERS-01

### GAP-WORKS-TENDERS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 W1 SF-15 re-confirmed against code and tests: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Awarded count and awardId come from quotations having awardId (page.tsx:82,227); Create Award is a separate free-form form not tied to a selected quotation, so the accepted amount can differ from any quotation.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/page.tsx:82 awardedCount and 227 awardId derive from quotations' awardId (first found). apps/web/src/app/(app)/works/tenders/[id]/TenderActions.tsx:80-117 Create Award posts workId, contractorName and a typed acceptedAmountMinor (93) with no tenderId or quotationId, and the form is shown whenever no quotation has awardId (275). Nothing forces the amount/contractor to match a quotation. Whether the backend links the award back to a quotation cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/TenderActions.tsx`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`
- **Fix steps:**
  1. Add a per-row 'Award this quotation' action in the quotations table (or a select in the award form) that sets quotationId/contractorId/acceptedAmount.
  2. Prefill acceptedAmountRs and contractor from that quotation; make them read-only unless an 'award at negotiated rate' reason is given.
  3. Add client check that acceptedAmount <= lowest eligible bid (or requires a reason) and pass quotationId to POST /award if backend supports it.
  4. Use rupeesToMinorString (lib/money.ts) instead of Math.round(parseFloat()*100) at line 93 (see also line 40).
- **Acceptance:**
  - Award form cannot be submitted without selecting a quotation.
  - Accepted amount equals selected quotation by default.
  - Deviating amount requires a reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money and procurement integrity: awarded amount must trace to a bid.
- **Depends on:** GAP-WORKS-TENDERS-DETAIL-01, GAP-WORKS-TENDERS-DETAIL-04

### GAP-WORKS-TENDERS-DETAIL-07  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: page.test.tsx no id prefix in table; closed by #2039)
- **First-pass claim:** Ref column shows the first 8 chars of the quotation UUID (page.tsx:110); Tender ID row prints the full UUID as content (page.tsx:218).
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/[id]/page.tsx:110 id: q.id.slice(0, 8) as the 'Ref' column and apps/web/src/app/(app)/works/tenders/[id]/page.tsx:216-219 prints params.id (full UUID) as the 'Tender ID' value; title fallback (125) also shows a UUID prefix when workNumber is missing.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`
- **Fix steps:**
  1. Show a human reference (quotation number / contractor name) in the Ref column if backend provides one; otherwise drop the column.
  2. Replace Tender ID row with Reference Number (pre-tender referenceNumber) if available, or move the UUID into a copy-to-clipboard 'Technical ID' in a details disclosure.
- **Acceptance:**
  - No 8-char UUID prefixes in the table.
  - Tender ID row not shown as main content.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-WORKS-TENDERS-DETAIL-01


---
## /works/tenders/new  —  `works/tenders-new.html`

- **Source:** `apps/web/src/app/(app)/works/tenders/new/page.tsx`
- **Design reference:** `redesign/works/tenders-new.html`

### GAP-WORKS-TENDERS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — Work EntityPicker (search/resolve) replaces UUID input; no ?workId= query-param prefill and no zod schema at submit.
- **First-pass claim:** Work is a pasted UUID ("Work ID (UUID)", placeholder 3fa85f64-…) with no lookup (page.tsx:77-86); the same raw-id pattern recurs across works forms and a wrong id is only caught server-side.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/new/page.tsx:76-87 'Work ID (UUID) *' plain text input with UUID placeholder; submit sends workId.trim() (42) with no UUID format check or existence lookup. Errors only come back from the server. Same pattern exists in other forms (e.g. assets/condemnation).
- **Files to change:** `apps/web/src/app/(app)/works/tenders/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Create/reuse shared EntityPicker; back it with the works list endpoint (route to be confirmed in works-service; not in snapshot).
  2. Replace the workId input with the picker (search by work number/name); store id, show label.
  3. Support ?workId= query param so 'Add pre-tender' from a work detail page prefills it.
  4. Add zod schema for the form body (uuid workId) at submit.
- **Acceptance:**
  - Cannot submit without choosing a work.
  - Typing a work number finds the work.
  - ?workId= preselects.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; wrong work linkage is caught server-side today.
- **Depends on:** EntityPicker (new shared component)

### GAP-WORKS-TENDERS-NEW-02  ·  HIGH  ·  partly  ·  theme WIRING (was MONEY)

- [~] **Status** (NEEDS OWNER DECISION: approving authority/contractor class/tender amount fields in POST pre-tender need backend columns; GAP-WORKS-TENDERS-NEW-02)
- **W2 works part 2 note (#2047):** approving authority, contractor class and estimated amount are still not accepted by POST pre-tender (no backend fields). INTERIM, owner decision.
- **W2 works note (#2039):** approving authority, contractor class and estimated amount are not accepted by POST pre-tender (no backend fields); missing amount already renders a dash. Needs backend fields (part 2 / owner decision).
- **W0 note:** partly fixed by #1867 — openingDate field added end-to-end (validator, consumer) and list shows dash for missing amount; approving authority, contractor class and estimated amount still not captured.
- **First-pass claim:** The form captures none of the fields the tender list and detail depend on — opening date, approving authority, contractor class, tender amount (types.ts:50-62 vs page.tsx:16-23) — so a newly created pre-tender shows ₹0.00, no opening date and an id-prefix authority, and its list Status (derived from opening date) is meaningless.
- **Verified evidence:** Form fields (apps/web/src/app/(app)/works/tenders/new/page.tsx:16-23) are workId, referenceNumber, tenderType, tenderCategory, bidValidity, fees: none of opening date, approving authority, contractor class or tender amount, which the register expects (apps/web/src/app/(app)/works/_data/types.ts:46-58 Tender interface; list columns in apps/web/src/app/(app)/works/tenders/TendersTable.tsx:7-13). Whether a pre-tender row appears in the /works/tenders list at all (it is tenders table vs pre_tenders per apps/web/src/app/(app)/works/_data/loaders.ts:95-104) cannot be verified, so the '₹0.00 / id-prefix authority' outcome is an inference; mapTenderRow does default amount to '0' (apps/web/src/app/(app)/works/_data/loaders.ts:124) and prefix authority via shortId.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/new/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend which table the pre-tender writes and whether it is listed; align list loader accordingly.
  2. Add optional fields the pre-tender command accepts (opening date via date input, approving authority picker, contractor class picker, estimated amount via rupeesToMinorString).
  3. In mapTenderRow return '—' (not '0') for missing amount so the list does not show a fabricated ₹0.00.
- **Acceptance:**
  - Created pre-tender shows correct opening date and authority name in the list.
  - Missing amount renders '—'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Register data quality; do not invent fields the API lacks.
- **Depends on:** GAP-WORKS-TENDERS-02, GAP-WORKS-TENDERS-01

### GAP-WORKS-TENDERS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme MASTERDATA (was STATUS)

- [x] **Status** Closed by 9018e1708 (owner decision D4c #40, 2026-10-27): nullable tender_type_id on pre-tenders, form sends it, text code kept for old records
- **W2 works part 2 note (#2047):** pre-tender accepts tenderType (code) only; tenderTypeId needs a backend column. INTERIM, owner decision.
- **W2 works note (#2039):** pre-tender accepts tenderType (code) only; tenderTypeId needs a backend column. Select is master-driven and the list resolves names. INTERIM, owner decision.
- **W0 note:** partly fixed by #1867 — Type select loads tender-types master and list resolves names; form still sends tenderType code/name not tenderTypeId, and category remains free text.
- **First-pass claim:** Tender type is a free enum of four strings sent as `tenderType` (page.tsx:45,111-116) while the register and masters use `tenderTypeId` (masters "Tender Types", loaders.ts:123); two vocabularies for the same concept, and the "Category" is free text.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/new/page.tsx:102-117 tender type select with values open/limited/quotation/single_source, sent as body.tenderType (45); category is free text (119-130, maxLength 64). The register/types use tenderTypeId (apps/web/src/app/(app)/works/_data/loaders.ts:123, types.ts Tender.tenderTypeId) and a 'tender-types' master exists (works/masters/page.tsx:19,46). Detail page also reads tenderType as a string (page.tsx:26) while the loader reads tenderTypeId, so two vocabularies. Backend acceptance of tenderTypeId on pre-tender cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/new/page.tsx`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`, `apps/web/src/app/(app)/works/_data/loaders.ts`, `apps/web/src/app/(app)/works/tenders/[id]/page.tsx`
- **Fix steps:**
  1. Load tender-types master (GET used by masters page) in the form and render as a select bound to tenderTypeId; send tenderTypeId if the pre-tender command supports it.
  2. Do the same for category (master or fixed enum agreed with backend).
  3. Resolve tenderTypeId to name on list and detail instead of shortId.
- **Acceptance:**
  - Select options come from masters.
  - List shows type name, not UUID prefix.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Master/enum mismatch could reject submissions.
- **Depends on:** GAP-WORKS-TENDERS-02

### GAP-WORKS-TENDERS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was WIRING)

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: new/page.test.tsx back link + role=alert tests; closed by #2039)
- **First-pass claim:** No back link, subtitle or breadcrumb from the header (page.tsx:71) and the error banner lacks role="alert" (page.tsx:73), unlike sibling forms.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/new/page.tsx:70-71 wrapper is a hand-styled div and <PageHeader title="New Pre-Tender" /> has no back/backLabel/subtitle (PageHeader supports back). Error banner at 73 is a plain div with no role="alert"; sibling forms use role="alert" aria-live="assertive" (works/boq/new/page.tsx:90, proposals/new/page.tsx:101). Cancel button exists (160-166), so navigation is not fully absent.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/new/page.tsx`
- **Fix steps:**
  1. Pass back="/works/tenders" backLabel="Tenders" and a subtitle to PageHeader.
  2. Add role="alert" aria-live="assertive" to the error banner and role="status" to the success banner.
  3. Replace the inline 640px wrapper with the DS page-main/wrap layout used by siblings.
- **Acceptance:**
  - Back link visible and works.
  - Screen reader announces submit error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-WORKS-TENDERS-NEW-05  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: new/page.test.tsx fee and bid-validity tests; closed by #2039)
- **First-pass claim:** Tender fee accepts 0 or blank and is converted through Math.round(Number(x)*100) (page.tsx:48); bid validity has no maximum; inline styles and a hand-set 640 px wrapper bypass the DS layout.
- **Verified evidence:** apps/web/src/app/(app)/works/tenders/new/page.tsx:48 body.fees = String(Math.round(Number(form.fees||'0')*100)) (float multiply; 1.005 style values round instead of being rejected; guarded by `if (form.fees)` so blank is omitted but '0' is sent as '0'). bidValidity (133-143) has min=1 but no max (line 47 parseInt). Inline style objects (8-11) and maxWidth 640 wrapper (70) bypass DS. lib/money.ts rupeesToMinorString already exists for this.
- **Files to change:** `apps/web/src/app/(app)/works/tenders/new/page.tsx`
- **Fix steps:**
  1. Use rupeesToMinorString(form.fees) (lib/money.ts); show a field error when it returns null (note it rejects 0, so treat '0' as 'no fee' explicitly).
  2. Add max (e.g. 365, confirm rule) to bidValidity and validate with zod at submit.
  3. Move inline styles to DS classes (see NEW-04).
- **Acceptance:**
  - Fee '1.005' is rejected, '150.5' sends '15050'.
  - bidValidity above max blocked.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Fee is a small amount; regression risk low.
- **Depends on:** GAP-WORKS-TENDERS-NEW-04


---
## Backend verification items (service code absent from snapshot)

### GAP-WORKS-HOME-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** Completed/Draft/Pending counts read byStatus keys "draft", "submitted"|"pending" (page.tsx:49-50) but the works-service status vocabulary is not in the snapshot; unknown keys silently show 0.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/dashboard']`
- **Question:** What are the exact byStatus keys returned (draft, submitted, pending, completed) for the dashboard?
- **How to verify:** Open dashboard handler and status enum in works-service; curl and list byStatus keys.
- **Test to add:** Given works in each status, when GET dashboard, then byStatus keys equal the enum set used by page.tsx:49-50.
- **Impact if wrong:** Dashboard counts show 0 while records exist.
- **Web change if wrong:** Change key names in page.tsx to the real vocabulary and derive from a shared enum.

### GAP-WORKS-HOME-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/dashboard']`
- **Question:** Do GET /api/v1/works/dashboard enforce works reader role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/dashboard and its schema; curl each endpoint as a role without works reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking works reader, when calling GET /api/v1/works/dashboard, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-APPROVALS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1944, verified on main 9c5e9e9e9)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/approvals/aa?pageSize=100', 'GET /api/v1/works/approvals/ts?pageSize=100']`
- **Question:** Do GET /api/v1/works/approvals/aa?pageSize=100, GET /api/v1/works/approvals/ts?pageSize=100 enforce works approvals reader role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/approvals/aa?pageSize=100 and its schema; curl each endpoint as a role without works approvals reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking works approvals reader, when calling GET /api/v1/works/approvals/aa?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-APPROVALS-AA-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1944, verified on main 9c5e9e9e9)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/approvals/aa?pageSize=100', 'POST /api/proxy/v1/works/approvals/aa/:id/finalize']`
- **Question:** Do GET /api/v1/works/approvals/aa?pageSize=100, POST /api/proxy/v1/works/approvals/aa/:id/finalize enforce AA approver role checks, input validation, canonical status enums and the documented response shape and does list-then-find return the row for a given id?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/approvals/aa?pageSize=100 and its schema; curl each endpoint as a role without AA approver (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking AA approver, when calling GET /api/v1/works/approvals/aa?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-APPROVALS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** POST /v1/works/approvals/aa now validates aaDate as a real calendar date (YYYY-MM-DD or ISO date-time; was an unvalidated string accepted with 202 then thrown in the consumer), requires a strictly positive amount (zero and negative were accepted) no larger than the int8 column, and 404s a work that does not exist (TS create already did); the consumer re-checks date and amount for commands that bypass the route. Tests: cluster01-route-validation.test.ts, approval-consumer-events.test.ts.
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/approvals/aa']`
- **Question:** Do POST /v1/works/approvals/aa enforce AA creator role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/approvals/aa and its schema; curl each endpoint as a role without AA creator (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking AA creator, when calling POST /v1/works/approvals/aa, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-APPROVALS-TS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** POST /v1/works/approvals/ts validates tsDate as a real calendar date and requires a strictly positive amount; 403 for a role that cannot create a TS is now covered by a route test (works_viewer, citizen, estimator), together with 400 (bad date, zero/negative/overflow amount), 404, 422 DAO_GATE_BLOCKED and 202; the consumer re-checks both. The status column remains a varchar without a DB CHECK (not changed: the route and consumer enforce the draft/finalized values). Tests: cluster01-route-validation.test.ts, approval-consumer-events.test.ts.
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/approvals/ts']`
- **Question:** Do POST /v1/works/approvals/ts enforce TS creator role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/approvals/ts and its schema; curl each endpoint as a role without TS creator (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking TS creator, when calling POST /v1/works/approvals/ts, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-APPROVALS-TS-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1944, verified on main 9c5e9e9e9)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/approvals/ts?pageSize=100', 'POST /v1/works/approvals/ts/:id/finalize']`
- **Question:** Do GET /api/v1/works/approvals/ts?pageSize=100, POST /v1/works/approvals/ts/:id/finalize enforce TS approver role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/approvals/ts?pageSize=100 and its schema; curl each endpoint as a role without TS approver (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking TS approver, when calling GET /api/v1/works/approvals/ts?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BILLING-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: billing-finalize-authority.test.ts GET /bills 403 and envelope; closed by #2039)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/billing/bills?pageSize=100']`
- **Question:** Do GET /api/v1/works/billing/bills?pageSize=100 enforce billing reader role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/billing/bills?pageSize=100 and its schema; curl each endpoint as a role without billing reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking billing reader, when calling GET /api/v1/works/billing/bills?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BILLING-WORKID-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: closed by #2039; W2 works rescan: completed by #2133)
- **W2 rescan note:** finalize is idempotent: a repeat of the step the record is already at returns 200 {alreadyApplied} and publishes nothing; both consumers lock the row, no-op a replay and refuse an out-of-order step (INVALID_STEP), so a double DO step raises ONE finance hand-off; GET :workId/{bills,mbs,awards} validate the UUID (400) and the work (404); w2-works-cluster02.db.test.ts (real DB incl. concurrent finalize). CONFIRM: repeat finalize is now 200, previously 422 INVALID_STEP; route-finalization-guards.test.ts updated to the new contract
- **W0 note:** partly fixed by #1867 — Finalize bill/MB role = broad WRITE_ROLES (no dedicated finalizer role); repeat finalize returns 422 INVALID_STEP rather than idempotent success; step sequence enforced.
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/billing/:workId/bills', 'POST /v1/works/billing/bills/:id/finalize', 'POST /v1/works/billing/mb/:id/finalize']`
- **Question:** Do GET /api/v1/works/billing/:workId/bills, POST /v1/works/billing/bills/:id/finalize, POST /v1/works/billing/mb/:id/finalize enforce billing finalizer role checks, input validation, canonical status enums and the documented response shape and are finalize calls idempotent?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/billing/:workId/bills and its schema; curl each endpoint as a role without billing finalizer (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking billing finalizer, when calling GET /api/v1/works/billing/:workId/bills, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BILLING-ACCOUNT-COMPILE-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: billing-finalize-authority.test.ts POST /account-compile 403/400/202; closed by #2039)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/billing/account-compile']`
- **Question:** Do POST /v1/works/billing/account-compile enforce billing accountant role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/billing/account-compile and its schema; curl each endpoint as a role without billing accountant (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking billing accountant, when calling POST /v1/works/billing/account-compile, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BILLING-BILLS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by main, verified on main 9c5e9e9e9) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** POST /v1/works/billing/bills now requires a strictly positive gross and a non-negative deduction (a negative gross used to pass both cumulative ceilings; zero deductions stay valid and net payable stays gross - deductions); the bill number is trimmed and unique per work, case-insensitively (409 DUPLICATE_BILL_NUMBER from the route, re-checked in the consumer transaction under a per-work advisory lock so two concurrent creates against different MBs cannot both win; the web form shows it under the Bill Number field); 403 wrong role is route-tested. No DB UNIQUE index was added: existing rows may already hold duplicates, so adding one needs a data check first. Tests: cluster01-route-validation.test.ts, orphan-consumers.test.ts, cluster01-billing.db.test.ts (exact paise, concurrency), bills/new/page.test.tsx.
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/billing/bills']`
- **Question:** Do POST /v1/works/billing/bills enforce billing creator role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/billing/bills and its schema; curl each endpoint as a role without billing creator (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking billing creator, when calling POST /v1/works/billing/bills, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BILLING-MEASUREMENTS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by main, verified on main 9c5e9e9e9) (W2 works rescan: completed by #2133)
- **W2 works rescan note (cluster 01):** a measurement can only be recorded against a DRAFT measurement book (409 MB_NOT_OPEN from the route; the consumer re-checks under FOR UPDATE on the MB row), so the measured-value ceiling a bill is checked against cannot change once the finalization chain starts or after do_finalized; quantity is bounded to numeric(18,4) and the optional dimensions to numeric(12,4); route tests cover 401/403/400/404/409/202 and the web form offers only draft books and explains the rest. Tests: cluster01-route-validation.test.ts, orphan-consumers.test.ts, cluster01-billing.db.test.ts, measurements/new/page.test.tsx, errorCatalogue.change.test.ts.
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/billing/measurements']`
- **Question:** Do POST /v1/works/billing/measurements enforce measurement recorder role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/billing/measurements and its schema; curl each endpoint as a role without measurement recorder (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking measurement recorder, when calling POST /v1/works/billing/measurements, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BILLING-NEW-MB-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: billing-finalize-authority.test.ts POST /mb 403 + finalize role tests; closed by #2039)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/billing/mb', 'POST /v1/works/billing/mb/:id/finalize']`
- **Question:** Do POST /v1/works/billing/mb, POST /v1/works/billing/mb/:id/finalize enforce MB recorder role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/billing/mb and its schema; curl each endpoint as a role without MB recorder (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking MB recorder, when calling POST /v1/works/billing/mb, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BOQ-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: works-service boq routes: all-routes.test.ts role/validation cases + boq-quantity-string.test.ts; closed by #1867)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/boq?pageSize=100']`
- **Question:** Do GET /api/v1/works/boq?pageSize=100 enforce BoQ reader role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/boq?pageSize=100 and its schema; curl each endpoint as a role without BoQ reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking BoQ reader, when calling GET /api/v1/works/boq?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BOQ-WORKID-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: works-service boq routes: all-routes.test.ts GET boq 401/403/200 + boq-workid-existence.test.ts; closed by #1867; W2 works rescan: completed by #2133)
- **W2 rescan note:** workId is UUID-validated on both GETs (400); recap GET tells unknown work (NOT_FOUND) from not computed (RECAPITULATION_NOT_COMPUTED); a recapitulation is computed from the stored BoQ line amounts (paise, summed in SQL) instead of the nonexistent client workAmount, so recap rows can now be produced; a work with no lines is 422 BOQ_EMPTY. Exact-paise real-DB test: work amount 287497, grand total 348555; a work has ONE recapitulation: a repeat or a racing double submit is refused (route 409 RECAP_EXISTS, consumer re-check under a per-work lock) and the stored figures never move, the read orders by version DESC. OPEN QUESTION FOR THE OWNER: may a changed BoQ REPLACE the work recapitulation (recompute in place, version bumped), or is it computed once? Until decided a recapitulation cannot be recomputed after the BoQ changes
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/boq/:workId', 'GET /api/v1/works/boq/:workId/recapitulation']`
- **Question:** Do GET /api/v1/works/boq/:workId, GET /api/v1/works/boq/:workId/recapitulation enforce BoQ reader role checks, input validation, canonical status enums and the documented response shape and is money returned in one consistent unit?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/boq/:workId and its schema; curl each endpoint as a role without BoQ reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking BoQ reader, when calling GET /api/v1/works/boq/:workId, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-BOQ-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: works-service boq create: all-routes.test.ts 202/400 + boq-quantity-string.test.ts; closed by main; W2 works rescan: completed by #2133)
- **W2 rescan note:** BR-015 freeze now also refuses ADDING a line (route 409 BOQ_FROZEN + consumer); rate must be > 0 and PATCH quantity must be > 0 (400); duplicates answered synchronously; 403 on POST boq tested (boq-cluster02-routes.test.ts, w2-works-cluster02.db.test.ts). Owner to confirm: a zero rate is now refused (the finding asked for rate > 0, no statutory value was invented); if provisional or free-issue lines with a zero rate occur in practice that is a policy call
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/boq']`
- **Question:** Do POST /v1/works/boq enforce BoQ author role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for POST /v1/works/boq and its schema; curl each endpoint as a role without BoQ author (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking BoQ author, when calling POST /v1/works/boq, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-CLOSURE-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1944, verified on main 9c5e9e9e9)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/closure?pageSize=100']`
- **Question:** Do GET /api/v1/works/closure?pageSize=100 enforce closure reader role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/closure?pageSize=100 and its schema; curl each endpoint as a role without closure reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking closure reader, when calling GET /api/v1/works/closure?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-CONTRACTORS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: contractor-routes.test.ts roles + validation + duplicate registration number; closed by main; W2 works rescan: completed by #2133)
- **W2 rescan note:** pageSize/page contract fixed with meta.total; list rows never carry a clear PAN; detail returns the clear PAN only to PII_REVEAL_ROLES; contractor validation errors now carry fieldErrors. Not covered: phone and email are still returned unmasked by the API to READ_ROLES (the web masks them); the finding named PAN only; tracked separately as GAP-WORKS-CONTRACTORS-API-PII-01 (open)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/contractors']`
- **Question:** Do GET /api/v1/works/contractors enforce contractor reader role checks, input validation, canonical status enums and the documented response shape?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/contractors and its schema; curl each endpoint as a role without contractor reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking contractor reader, when calling GET /api/v1/works/contractors, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-CONTRACTORS-API-PII-01  ·  MEDIUM  ·  confirmed  ·  theme PRIVACY

- [ ] **Status** (raised by the W2 works cluster-02 review; split out of GAP-WORKS-CONTRACTORS-06, which named PAN only)
- **Claim:** works-service returns contractor phone and email in clear from GET /v1/works/contractors (list) and GET /v1/works/contractors/:id to every READ_ROLES holder. The house rule masks phone, email, PAN, Aadhaar and bank account; only the web currently masks phone and email, so any other client of the API (or a browser network tab) reads them. PAN is already handled server-side (list never carries it; detail only for PII_REVEAL_ROLES).
- **Service:** `works-service`  ·  **Endpoint(s):** `[GET /v1/works/contractors, GET /v1/works/contractors/:id]`
- **Files to change:** `services/works-service/src/modules/contractor/mask.ts`, `services/works-service/src/modules/contractor/routes.ts`, `apps/web/src/app/(app)/works/contractors/**`
- **Fix steps:**
  1. Extend the server-side masking (withMaskedPan in mask.ts) to phone and email: the list rows never carry them in clear, the detail carries them in clear only to the roles that may reveal them.
  2. The contractor edit form must keep working for the write roles: either give the edit toggle the audited reveal path (as PAN has) or let the PATCH treat an untouched masked value as unchanged, so a masked value is never written back over the real one.
  3. Keep the web masking as defence in depth.
- **Acceptance:**
  - Test: a works_viewer list and detail response contains neither the full phone nor the full email.
  - Test: an editor can change the phone/email and an unrelated edit does not overwrite them with a masked value.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium (edit-form round trip).

### GAP-WORKS-CONTRACTORS-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: contractor-routes.test.ts detail/patch/rate role gates; closed by #1944)
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/contractors/:id', 'GET /api/v1/works/contractors/:id/rating-history', 'PATCH /v1/works/contractors/:id', 'POST /v1/works/contractors/:id/rate']`
- **Question:** Do GET /api/v1/works/contractors/:id, GET /api/v1/works/contractors/:id/rating-history, PATCH /v1/works/contractors/:id, POST /v1/works/contractors/:id/rate enforce contractor manager role checks, input validation, canonical status enums and the documented response shape and is PAN/GST validated on PATCH?
- **How to verify:** In works-service open the route/handler for GET /api/v1/works/contractors/:id and its schema; curl each endpoint as a role without contractor manager (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking contractor manager, when calling GET /api/v1/works/contractors/:id, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-CONTRACTORS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: closed by #2048; registration number unique per tenant: route 409 DUPLICATE_REGISTRATION_NO + consumer re-check in the writing transaction (contractor/routes.ts, consumer.ts, repo.ts); contractor-routes.test.ts + gap2-review2-consumers.db.test.ts (real DB))
- **W0 note:** partly fixed by #1867 — PAN/GSTIN/mobile regex validated and WRITE_ROLES enforced; no duplicate registrationNo rejection found in route/consumer/migration 0015.
- **First-pass claim:** Backend works-service is absent from this snapshot (only services/hrms-service exists) — role checks, validation, status enums and response shapes are undeterminable server-side.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/contractors']`
- **Question:** Do POST /v1/works/contractors enforce contractor manager role checks, input validation, canonical status enums and the documented response shape including PAN/GST format and duplicate registrationNo?
- **How to verify:** In works-service open the route/handler for POST /v1/works/contractors and its schema; curl each endpoint as a role without contractor manager (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
- **Test to add:** Given a user lacking contractor manager, when calling POST /v1/works/contractors, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
- **Impact if wrong:** Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- **Web change if wrong:** If shape/roles differ: adjust types.ts mapping and hide actions the role cannot use; otherwise none.

### GAP-WORKS-EXECUTION-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: progress percentage derived in execution/consumer.ts progressRecord and paginated with true meta.total (execution/routes.ts progress route); orphan-consumers.test.ts; closed by #1867)
- **First-pass claim:** Backend works-service is absent from this snapshot; progress percentage derivation and pageSize cap are undeterminable (only the first 100 rows are ever fetched, page never says so).
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/execution/progress?pageSize=100']`
- **Question:** How is progress percentage derived (cumulative/scope quantity) and what is the maximum pageSize the service honours; does the response include total?
- **How to verify:** Open progress list handler; request pageSize=500 and check clamp and a meta.total field.
- **Test to add:** Given 150 rows, when GET pageSize=100, then response contains total=150 and derived percent within 0-100.
- **Impact if wrong:** Works beyond first 100 silently missing; wrong percentages.
- **Web change if wrong:** Add pagination and a truncated notice using meta.total.

### GAP-WORKS-EXECUTION-WORKID-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by eb9e84696 (owner decision D4c #41, 2026-10-27): completion closure refused with open issues / progress below 100%; early close needs a reason and the DAO; idempotent close unchanged
- **W2 works part 2 note (#2048):** done: close is now idempotent (route 409 ALREADY_CLOSED + consumer dead-letter) and the physical-complete certificate key is tenant-checked. Still open: refusing a close while issues are open or progress is below 100% is a product rule. INTERIM, owner decision.
- **W0 note:** partly fixed by #1867 — close restricted to dao/do/admin and checks closureEligibility (agreement, physical completion, splits) sync with audit; does not check open issues or 100% progress; no explicit idempotency guard.
- **First-pass claim:** works-service absent from snapshot — server checks for completion/closure preconditions and audit are undeterminable.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/execution/physical-complete', 'POST /v1/works/execution/close', 'GET /api/v1/works/execution/:workId/scopes', 'GET /api/v1/works/execution/:workId/issues']`
- **Question:** Does close require physical-complete first with no open issues and 100% progress, is it idempotent, and is it role-restricted and audited?
- **How to verify:** Open close and physical-complete handlers; call close on a work with an open issue (expect 409/422) and twice in a row.
- **Test to add:** Given open issue, when POST close, then 422 OPEN_ISSUES; repeat close after success returns same result with a single audit row.
- **Impact if wrong:** Works closed prematurely; irreversible closure without controls.
- **Web change if wrong:** Disable Close in ExecutionActions until preconditions from the API are met.

### GAP-WORKS-EXECUTION-ISSUES-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: issue close: roles in all-routes.test.ts, idempotent no-op + audit in works-ai-pack-gaps.test.ts; closed by #1867)
- **First-pass claim:** works-service absent from snapshot — close idempotency, audit and role rules undeterminable.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/execution/issues/:id/close', 'GET /api/v1/works/execution/issues?pageSize=100']`
- **Question:** Is issue close idempotent (second close returns 200/409 without a duplicate audit row) and restricted to a site-engineer/supervisor role?
- **How to verify:** Open the close handler; curl close twice as authorised user then once as unauthorised (expect 403); count audit rows.
- **Test to add:** Given a closed issue, when close is posted again, then no second audit entry and a defined 200/409; given unauthorised role, then 403.
- **Impact if wrong:** Duplicate/unauthorised closure of site issues, corrupting closure audit.
- **Web change if wrong:** Treat 409 already-closed as success in IssueCloseForm and refresh the row.

### GAP-WORKS-EXECUTION-ISSUES-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: closed by #2048; POST issues 404s an unknown work and rejects another tenant's attachmentKey (execution/routes.ts); issues/new has an attachment upload; all-routes.test.ts + issues/new/page.test.tsx)
- **W0-10 note:** review found the W0 tick partly — Backend accepts attachmentKey (execution/validators.ts:37) and audits (consumer.ts:44) but route (routes.ts:168-172) does not check workId exists (202 then blind insert consumer.ts:28; no 404/422), and issues/new/page.tsx has no attachment field.
- **First-pass claim:** No attachment field even though work_issues has an attachmentKey (types.ts:125); server validation and audit undeterminable (works-service absent).
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/execution/issues']`
- **Question:** Does POST issues validate title/severity/workId, accept an optional attachmentKey (work_issues.attachmentKey) and write an audit row?
- **How to verify:** Open the issues create handler and schema in works-service; curl with and without attachmentKey and a nonexistent workId (expect 404/422); check audit table.
- **Test to add:** Given valid body with attachmentKey, when POST issues, then 201, key persisted, audit row; given unknown workId, then 422.
- **Impact if wrong:** Issues lack evidence or are created against invalid works without an audit trail.
- **Web change if wrong:** Add a FileUpload field passing attachmentKey in issues/new/page.tsx if the API accepts it.

### GAP-WORKS-EXECUTION-PHOTOS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (NEEDS OWNER DECISION: virus scan and EXIF stripping are platform-level decisions; GAP-WORKS-EXECUTION-PHOTOS-NEW-05) [deferred post-UAT per owner decision D4c #42, 2026-10-27]
- **W2 works part 2 note (#2048):** done: fileKey must be this tenant's upload (route 422 INVALID_FILE_KEY), unknown work is 404, presign already enforces extension allow-list and size cap (admin-service uploads/routes.ts). Still open: virus scan and EXIF stripping are platform features. INTERIM, owner decision.
- **W0 note:** partly fixed by #1867 — GPS range-validated server-side and audit written; fileKey only length-checked, no tenant-prefix verification; presign content-type/size, virus scan and EXIF handling not evidenced.
- **First-pass claim:** Presign endpoint behaviour, virus scan, EXIF handling and audit of the photo registration are undeterminable — works-service absent and FileUpload internals not traced.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/admin/uploads/presign', 'POST /v1/works/execution/photos']`
- **Question:** Does presign restrict content-type/size for category=photo, is the object virus-scanned and EXIF (GPS/PII) handled, and does photo registration verify the key belongs to the tenant and audit the write?
- **How to verify:** Open admin uploads presign handler (owned by admin/platform service) and works photos handler; request presign with application/x-msdownload (expect 422), register a key from another tenant (expect 403).
- **Test to add:** Given non-image content-type, when presign category=photo, then 422; given foreign-tenant key, when POST photos, then 403; valid then 201 with audit.
- **Impact if wrong:** Malware or cross-tenant objects attached to works; unstripped GPS data leaks.
- **Web change if wrong:** Client-side check types only as UX; no change if server enforces.

### GAP-WORKS-EXECUTION-RECORD-PROGRESS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by 3b5e6c76d (owner decision D4c #43, 2026-10-27): unique (scope, month) for ordinary entries; corrections are negative entries with a stored reason
- **W2 works part 2 note (#2048):** the web form now warns on a second entry for the same scope/month; whether the server should refuse it (deltas are insert-only) is a product rule. INTERIM, owner decision.
- **W0 note:** partly fixed by #1867 — Cumulative<=target enforced sync and in consumer, negative delta needs reason, audit written; no one-entry-per-scope-per-month uniqueness (insert-only deltas).
- **First-pass claim:** Server rules (uniqueness per scope-month, cumulative cap, audit) undeterminable — works-service absent.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET|POST /v1/works/execution/:workId/scopes', 'POST /v1/works/execution/progress']`
- **Question:** Does POST progress enforce one entry per scope per month, cumulative quantity <= scope quantity, and write an audit row?
- **How to verify:** Open progress handler and DB unique constraint; curl the same scope-month twice (expect 409) and a quantity over the remaining cap (expect 422).
- **Test to add:** Given cumulative 90 of 100, when posting 20, then 422 CUMULATIVE_EXCEEDED; duplicate scope-month then 409.
- **Impact if wrong:** Over-reported progress leads to over-payment against measurements.
- **Web change if wrong:** Show remaining quantity per scope and map 409/422 codes to field messages.

### GAP-WORKS-MASTERS-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: MastersTable.test.tsx canManage gating + works-service masters ADMIN_ROLES on POST/PATCH (masters/routes.ts); closed by #1867)
- **First-pass claim:** Create form is shown to every viewer with no role gate (MasterCreateForm.tsx:280-289) although masters drive every works workflow (tender types, contractor classes, SR rates); server-side authorisation is undeterminable (works-service absent).
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/masters/:type']`
- **Question:** Does POST masters/:type require a masters-admin role, and is it audited?
- **How to verify:** Open masters create handler; curl as a plain works user (expect 403) and as masters admin (expect 201 + audit).
- **Test to add:** Given non-admin, when POST masters/tender-types, then 403; admin then 201 and audit row.
- **Impact if wrong:** Any user can change tender types, contractor classes, SR rates: fraud/integrity risk.
- **Web change if wrong:** Gate MasterCreateForm behind requireAnyRole for the masters-admin role.

### GAP-WORKS-MASTERS-08  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: masterTypes.ts is the single 17-type source; masters-registry.test.ts (service); closed by #1867)
- **First-pass claim:** Which masters the backend actually exposes, their schemas and audit of writes are undeterminable — works-service absent; the 17-type list is duplicated in page.tsx and MasterCreateForm.tsx.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/masters/:type?pageSize=100', 'POST /v1/works/masters/:type']`
- **Question:** Does the service expose exactly the 17 master types listed in page.tsx/MasterCreateForm.tsx, with those schemas, and audit writes?
- **How to verify:** List routes registered under /v1/works/masters and compare the type enum and body schemas with the two web lists.
- **Test to add:** Given each of the 17 types, when GET masters/:type, then 200; unknown type returns 404.
- **Impact if wrong:** Web lists types that 404 or misses new ones.
- **Web change if wrong:** Extract one shared type list and fetch types from a service endpoint if exposed.

### GAP-WORKS-ORDERS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** GET /api/v1/works/work-orders response shape and pagination are undeterminable (works-service absent); page passes no pageSize.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/work-orders']`
- **Question:** Does work-orders return {data:[...]} with pagination (pageSize/total) and what is the default page size?
- **How to verify:** Open work-orders list handler; curl with no pageSize and with pageSize=1000.
- **Test to add:** Given 250 orders, when GET without pageSize, then default page and meta.total returned.
- **Impact if wrong:** Silent truncation of work orders.
- **Web change if wrong:** Pass pageSize and render pagination from meta.

### GAP-WORKS-PROPOSALS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1867, verified on main 9c5e9e9e9)
- **First-pass claim:** pageSize=100 fetched once with no pagination/total; status semantics come from a comment referencing services/works-service, which is absent from the snapshot — undeterminable.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/proposals?pageSize=100']`
- **Question:** Does the list return total and a stable status vocabulary, and honour pageSize beyond 100?
- **How to verify:** Open proposals list handler; check meta.total and status enum documented in consumer.
- **Test to add:** Given 130 proposals, when GET pageSize=100, then meta.total=130.
- **Impact if wrong:** Proposals beyond 100 invisible.
- **Web change if wrong:** Add pagination controls using total.

### GAP-WORKS-PROPOSALS-DETAIL-09  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: closed by #2048; ProposalActions.tsx follows the queued DAO-finalize through GET proposal until status is dao_finalized, else ends at 'still processing' with a manual refresh; ProposalActions.test.tsx)
- **W2 works note (#2039):** no failed/processing status is surfaced if the async DAO-finalize consumer fails.
- **W0 note:** partly fixed by #1867 — dao-finalize sync-checks state and consumer sets dao_finalized with audit; web router.refresh after 202; no failed/processing status surfaced if consumer fails.
- **First-pass claim:** Whether the 202 DAO finalize actually completes, status transitions, and audit trail are undeterminable — works-service absent (the comment cites proposal/consumer.ts).
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/proposals/:id', 'POST /v1/works/proposals/:id/dao-finalize']`
- **Question:** After a 202 from dao-finalize, does the consumer (proposal/consumer.ts) complete the transition, and are failures visible in status and audit?
- **How to verify:** Open the dao-finalize handler and queue consumer; post finalize, then poll GET proposals/:id until status changes; force a consumer error.
- **Test to add:** Given finalize accepted, when consumer runs, then status becomes dao_finalized with audit; on failure status shows failed and can be retried.
- **Impact if wrong:** Proposals stuck pending while the UI says finalized.
- **Web change if wrong:** Poll or show 'processing' status instead of success.

### GAP-WORKS-PROPOSALS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by b7de6b503 (owner decision D4c #44, 2026-10-27): no hard cost cap; likely duplicate (title, location, category, financial year) is warned about, never blocked
- **W2 works part 2 note (#2047):** estimated-cost cap and duplicate detection need a product rule. INTERIM, owner decision.
- **W2 works note (#2039):** cost cap and duplicate detection need a product rule.
- **W0 note:** partly fixed by #1867 — description max 2048, category enum, uuid fields and audit present; no estimated-cost cap and no duplicate detection.
- **First-pass claim:** Server validation (description length, category enum, cost cap), duplicate detection and audit are undeterminable — works-service absent.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/proposals']`
- **Question:** Does POST proposals validate description length, category enum and cost cap, detect duplicates, and audit?
- **How to verify:** Open proposals create schema; curl with oversize description, invalid category and a duplicate payload.
- **Test to add:** Given invalid category, when POST proposals, then 422 with field error; duplicate returns 409.
- **Impact if wrong:** Invalid or duplicate proposals enter approval flow.
- **Web change if wrong:** Mirror limits/enums client-side from the service error fields.

### GAP-WORKS-REPORTS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: closed by #2048; reports/StatusBars.tsx status chart with text alternative + definitions note (active = total - closed; exact-division filter, no sub-divisions); reports/page.test.tsx)
- **W0 note:** partly fixed by #1867 — active = total minus closed is defined server-side; divisionId is exact match on executingDivisionId (no child hierarchy); reports page imports no chart component.
- **First-pass claim:** No chart although this is the reporting screen (only tables); report semantics (what counts as active/closed) and whether divisionId filters by hierarchy are undeterminable — works-service absent.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/reports/summary', 'GET /api/v1/works/reports/status']`
- **Question:** How are active and closed defined in reports/summary, and does divisionId filter by hierarchy (including child divisions)?
- **How to verify:** Open reports handlers; compare counts to DB for a division with children.
- **Test to add:** Given parent division with child works, when GET summary?divisionId=parent, then counts include children.
- **Impact if wrong:** Report totals misstated for officers.
- **Web change if wrong:** Add chart from status counts; pass division consistently.

### GAP-WORKS-TENDERS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: PROVISIONAL cleared by re-check, evidence: tender-routes.test.ts meta.total 250 test; closed by #2039)
- **First-pass claim:** works-service absent: listTenders columns and the 100-row cap (loaders.ts:133; the detail page fetches 200, tenders/[id]/page.tsx:58) are undeterminable, so tenders 101-200 are reachable by URL but not from this list.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/tenders?pageSize=100 (apps/web/src/app/(app)/works/_data/loaders.ts:133)', 'GET /api/v1/works/tenders?pageSize=200 (apps/web/src/app/(app)/works/tenders/[id]/page.tsx:58)']`
- **Question:** Does GET /works/tenders honour pageSize up to 200 (not silently clamped), return a total count and paging metadata, and expose the columns the list maps (mapTenderRow) so rows beyond 100 can be reached?
- **How to verify:** In works-service open the tenders list route/handler and its query schema: check pageSize max/default and whether page/cursor and total are returned. Then seed 150 tenders and call GET /api/v1/works/tenders?pageSize=100, ?pageSize=200 and ?pageSize=100&page=2 with a works-viewer token; expect 100, 150 and 50 rows and a total of 150.
- **Test to add:** Given 150 tenders exist, when a viewer calls GET /works/tenders?pageSize=200, then 150 items are returned with total=150; when pageSize=500, then it is 400 or clamped with the max stated in the response meta.
- **Impact if wrong:** Tenders beyond the cap are invisible in the list and the stat cards (Total/Open/Closed) undercount, so a tender can be missed in pipeline monitoring.
- **Web change if wrong:** Add pagination or load-more to TendersTable using the service's page/cursor and total. Compute the stat cards from a server total or summary instead of tenders.length. Align the list and detail pageSize.

### GAP-WORKS-TENDERS-DETAIL-08  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (NEEDS OWNER DECISION: deviation percent computation and award-outcome follow-up from 202 queue need product rules; GAP-WORKS-TENDERS-DETAIL-08)
- **W2 works part 2 note (#2047):** deviation percent and the award outcome (still queued, 202) need a product rule. INTERIM, owner decision.
- **W2 works note (#2039):** role gates and maker-checker exist; deviation percent is not computed in works-service and the award outcome is still queued (202). Needs a product rule.
- **W0 note:** partly fixed by #1944 — Award/finalize role-gated with maker-checker and ordered statuses (draft, dao_finalized); deviation percent is not computed anywhere in works-service, enums undocumented; award outcome still queued.
- **First-pass claim:** Quotation/award status enums, deviation calculation and role enforcement are undeterminable — works-service absent; awards are queued ("recorded once processed", TenderActions.tsx:109) so success toast precedes the result.
- **Service:** `works-service`  ·  **Endpoint(s):** `['GET /api/v1/works/tenders/:id/quotations', 'POST /v1/works/tenders/quotation', 'POST /v1/works/tenders/award', 'POST /v1/works/tenders/award/:id/{level}-finalize']`
- **Question:** What are the quotation/award status enums, how is deviation computed, are award and finalize role-restricted, and how does a client learn the queued award outcome?
- **How to verify:** Open tenders award handlers and consumer; award as unauthorised role (expect 403), award and poll until processed.
- **Test to add:** Given quotation above estimate by 12%, when awarding, then deviation=12 and status transitions awarded; unauthorised then 403.
- **Impact if wrong:** Wrong contractor awarded or unauthorised award.
- **Web change if wrong:** Change success toast to 'submitted, processing' and refetch status.

### GAP-WORKS-TENDERS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 works: closed by #2039)
- **W0 note:** partly fixed by #1867 — Pre-tender writes audit; route/consumer do not check work exists or is TS-eligible and do not reject duplicate referenceNumber.
- **First-pass claim:** Server validation (work must exist and be TS-eligible, duplicate reference numbers) and audit are undeterminable — works-service absent.
- **Service:** `works-service`  ·  **Endpoint(s):** `['POST /v1/works/tenders/pre-tender']`
- **Question:** Does pre-tender require the work to exist and be TS-eligible, reject duplicate reference numbers, and audit?
- **How to verify:** Open pre-tender handler; post with unknown workId, non-TS work and repeated referenceNo.
- **Test to add:** Given work without TS, when POST pre-tender, then 422 TS_REQUIRED; duplicate reference then 409.
- **Impact if wrong:** Tenders created without sanction.
- **Web change if wrong:** Surface server error codes as field messages.
