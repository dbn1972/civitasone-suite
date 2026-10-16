# Detailed gap file — module `projects`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 79, BACKEND-VERIFY 6



---
## /projects  —  `projects/home.html`

- **Source:** `apps/web/src/app/(app)/projects/page.tsx`
- **Design reference:** `redesign/projects/home.html`

### GAP-PROJECTS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** "+ New Project" is a create action rendered as an equal-weight navigation tile with the same 12-tile grid and no role gate (page.tsx:12); users without create rights will reach the form and only fail at POST /api/proxy/v1/projects (new/CreateProjectForm.tsx:82).
- **Verified evidence:** projects/page.tsx:12 places '+ New Project' inside the same 12 links array as navigation tiles (ModuleHub -> LinkTiles); no permission field. CreateProjectForm.tsx:82 POSTs /api/proxy/v1/projects and only surfaces failure afterwards. Server enforcement unverifiable. Better home for the create action is the list page (already has a '+ New Project' button in PageHeader actions, list/page.tsx:43-47).
- **Files to change:** `apps/web/src/app/(app)/projects/page.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`, `apps/web/src/app/(app)/projects/new/page.tsx`
- **Fix steps:**
  1. Remove '+ New Project' from the hub links (the list page already offers it) or add an optional `hidden`/`requires` field in ModuleHub links.
  2. Make the hub a server component that calls getSessionRoles() and filters links by role.
  3. In new/page.tsx redirect or show a friendly no-access state for users without create rights.
  4. Same gating for the list-page button.
- **Acceptance:**
  - User without create role sees no New Project entry on hub or list.
  - Visiting /projects/new directly shows a no-access message.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; server must still enforce.
- **Depends on:** GAP-PROJECTS-FUND-RELEASES-01

### GAP-PROJECTS-HOME-03  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1869, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx paints a stat-grid + table skeleton for a page that has neither (loading.tsx:7-12), so the hub flashes a wrong layout on navigation.
- **Verified evidence:** projects/loading.tsx:7-12 renders four stat blocks and a large table block, but the hub (page.tsx, ModuleHub) is a header plus a 3-column LinkTiles grid. It also applies as fallback to child routes without their own loading.tsx (fund-releases and milestones have their own; new and [id]/members etc. rely on it).
- **Files to change:** `apps/web/src/app/(app)/projects/loading.tsx`
- **Fix steps:**
  1. Rewrite as header block + grid of 12 tile placeholders (3 columns).
  2. Check nested routes that inherit it (new, schemes) and add their own loading.tsx if needed.
- **Acceptance:**
  - Navigating to /projects shows tile-shaped skeleton.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-HOME-04  ·  LOW  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** RouteError renders "We couldn't open Projects page." — grammatically clipped because area "Projects page" is passed without an article (error.tsx:12, RouteError.tsx).
- **Verified evidence:** projects/error.tsx:12 passes area='Projects page'; RouteError.tsx:65 renders 'We couldn't open {area}.' giving 'We couldn't open Projects page.' The same area is copy-pasted in dpr-tracking, escalations (and other) error.tsx files. RouteError deliberately renders no article, so callers must pass a clean noun phrase.
- **Files to change:** `apps/web/src/app/(app)/projects/error.tsx`, `apps/web/src/app/(app)/projects/dpr-tracking/error.tsx`, `apps/web/src/app/(app)/projects/escalations/error.tsx`
- **Fix steps:**
  1. Set area='Projects' in projects/error.tsx.
  2. Set specific areas per sub-route (e.g. 'DPR Tracking', 'Escalations').
  3. Grep other error.tsx for area="... page" and fix in one sweep.
- **Acceptance:**
  - Error page reads 'We couldn't open Projects.'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/[id]  —  `projects/detail.html`

- **Source:** `apps/web/src/app/(app)/projects/[id]/page.tsx`
- **Design reference:** `redesign/projects/detail.html`

### GAP-PROJECTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** RefreshErrorState is unreachable: the null-project test (page.tsx:13) precedes the source==="error" test (page.tsx:28) and getProjectById falls back to null (loaders.ts:3483), so any outage shows “Project not found … may have been removed”.
- **Verified evidence:** [id]/page.tsx:13 `if (!project)` returns 'Project Not Found' before :28 `source==='error'`; getProjectById falls back to null (loaders.ts:3482-3488) and fetchJson returns {data: empty, source:'error', status} (apiClient.ts:125-152), so every outage/401/5xx shows not-found; RefreshErrorState is unreachable. LoaderResult.status permits 404 detection.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/page.tsx`
- **Fix steps:**
  1. Swap the order: check source==='error' first.
  2. Inside error branch, if result.status===404 render the not-found view (or call notFound()), else RefreshErrorState with retry.
  3. Destructure status from getProjectById result.
- **Acceptance:**
  - Test: source error status 500 -> RefreshErrorState; status 404 -> not found; ok+null -> not found.
  - Manual: stop API, page shows retry not 'removed'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PROJECTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** “Complete: <title>” is rendered for every viewer for each pending milestone (ProjectDetailActions.tsx:20,65-77) although the dialog says it triggers a fund release; no role gate, and the “maker-checker” label describes a single-user confirm with no second approver shown (:95). Any pending milestone can be completed out of sequence.
- **Verified evidence:** ProjectDetailActions.tsx:20 filters status==='pending' and :65-77 renders a 'Complete: <title>' button for each with no role check; page.tsx:46 passes it to everyone. Dialog (:86-102) danger, requireReason, says 'maker-checker action that triggers a fund release'; onConfirm PATCHes milestones/{id}/complete once (:27-34), so it is one user's confirm with no second approver and no sequencing (any pending milestone). Whether the server enforces role, sequence, maker-checker or fund release cannot be verified (project-service absent).
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/ProjectDetailActions.tsx`, `apps/web/src/app/(app)/projects/[id]/page.tsx`, `project-service milestone complete route (not in snapshot)`
- **Fix steps:**
  1. In page.tsx compute canComplete from getSessionRoles() and pass to ProjectDetailActions; render nothing when false.
  2. Restrict button to the next pending milestone by due date (or disable others with reason).
  3. Either implement true maker-checker (request -> approve by a different user, showing pending state) or reword the dialog to what happens.
  4. Confirm server-side role check, audit event and idempotency.
- **Acceptance:**
  - Viewer role: no completion controls.
  - Attempt to complete a later milestone while earlier pending: disabled with tooltip.
  - Server returns 403 for unauthorized role.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: triggers a fund release; irreversible per copy. Needs audit event and maker-checker decision.

### GAP-PROJECTS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Header actions become an unbounded vertical stack of buttons, one per pending milestone (ProjectDetailActions.tsx:64-77), which pushes the page title layout on projects with many milestones.
- **Verified evidence:** ProjectDetailActions.tsx:64-77 returns a flex column (gap 8) with one ghost Button per pending milestone inside the PageHeader actions slot; count is unbounded.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/ProjectDetailActions.tsx`, `apps/web/src/app/(app)/projects/[id]/ProjectDetailTables.tsx`
- **Fix steps:**
  1. Replace button stack with a single 'Complete milestone' action, or a row-level 'Complete' action in MilestonesDetailTable for pending rows, opening the same ConfirmDialog.
  2. Keep the message status region.
- **Acceptance:**
  - Project with 10 pending milestones: header height unchanged; each pending row has one action.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Same money risk as DETAIL-02; keep confirm dialog unchanged.
- **Depends on:** GAP-PROJECTS-DETAIL-02

### GAP-PROJECTS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Gantt derives each bar start from the previous milestone due date and assumes list order (ProjectGantt.tsx:39,57); progress is hard-coded 100/50/0 from status (:40), and “delayed” milestones plot as 0%. The same data is shown three times (table, chart, text table).
- **Verified evidence:** ProjectGantt.tsx:39 and :57 set start to previous milestone dueDate (index order, not sorted) and project start for the first; :40 and :58 progress = 100 / 50 / 0 by status (delayed and pending 0). The data appears three times: MilestonesDetailTable (page.tsx:77), GanttChart, and the text DataTable in ProjectGantt (:73-82); the last is deliberate accessibility text alternative (comment :69-70). Start dates are derived approximations; does the API supply milestone start/progress? cannot verify.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/ProjectGantt.tsx`
- **Fix steps:**
  1. Sort milestones by dueDate before mapping.
  2. Label chart 'Approximate timeline' or use API start/progress fields if present.
  3. Drop Start/Progress columns from the text alternative or hide the duplicate main table.
- **Acceptance:**
  - Unit test: unsorted input yields bars in date order; caption present.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Misleading schedule view for delay decisions.

### GAP-PROJECTS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** StatusPill maps no "in_progress", "delayed" or "on_hold" keys, so those render as neutral info blue (ds/StatusPill.tsx:6-38); dates print as dd/mm/yyyy from toLocaleDateString (lib/formatters.ts:2-7).
- **Verified evidence:** StatusPill.tsx:5-39 has 'in progress' (space) but no 'in_progress', 'delayed', or 'on_hold', so milestone statuses in_progress/delayed (ProjectGantt.tsx:20-25) and project status delayed render as 'info' (line 53). Dates: page.tsx uses formatIndianDate (formatters.ts:2-7), which outputs dd/mm/yyyy by design (comment cites GFR/PFMS); not a defect, and no IST timeZone is set.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add in_progress:'warn', delayed:'bad', on_hold:'warn' (and normalise underscores by replacing _ with space before lookup).
  2. Add unit test for the mapping.
- **Acceptance:**
  - StatusPill 'in_progress' -> warn; 'delayed' -> bad; 'on_hold' -> warn.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Global recolour of statuses across modules; review usages.

### GAP-PROJECTS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme OTHER (was DATEFMT)

- [x] **Status** (W2 closed by #W2-PROJECTS-1: Spent % already present from #1869; button card replaced by route-based ProjectDetailNav in [id]/layout.tsx)
- **W0 note:** partly fixed by #1869 — 'Spent %' added; the Card of three <Link className='btn'> buttons is still there, no route-based Tabs / [id]/layout.tsx.
- **First-pass claim:** Expenditure is shown beside Budget without a consumption percentage or comparison to Completion %; sub-page links are plain buttons rather than tabs (page.tsx:61-71).
- **Verified evidence:** page.tsx:55-57 show Budget, Expenditure, Completion % as separate fields with no utilisation %; :60-71 sub-pages are three <Link className='btn'> buttons in a Card, while ds/Tabs.tsx exists. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/page.tsx`, `apps/web/src/app/_components/ds/Tabs.tsx`
- **Fix steps:**
  1. Add 'Spent %' = expenditure/budget computed with BigInt-safe math (both are paise) next to Expenditure, with '—' when budget is 0.
  2. Replace the button card with route-based Tabs (Overview, Tasks, Team, Risks) via a [id]/layout.tsx.
- **Acceptance:**
  - Budget 1000, expenditure 250 -> shows 25.0%; budget 0 -> '—'.
  - Tabs highlight active route.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money calculation: avoid float on large paise; ratio for display only.


---
## /projects/[id]/members  —  `projects/detail-members.html`

- **Source:** `apps/web/src/app/(app)/projects/[id]/members/page.tsx`
- **Design reference:** `redesign/projects/detail-members.html`

### GAP-PROJECTS-DETAIL-MEMBERS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** Members are identified and added only by raw UUID: the table prints userId (page.tsx:57) and the form asks the user to paste “User ID (UUID)” (AddMemberForm.tsx:54-60). Nobody can tell who a row is, or safely add the right officer.
- **Verified evidence:** members/page.tsx:49 header 'User ID' and :57 prints m.userId in monospace; AddMemberForm.tsx:54-60 label 'User ID (UUID)' free-text input with UUID placeholder, only a non-empty check (:22). ProjectMemberRow (loaders.ts:5236-5242) carries only userId. No EntityPicker exists in apps/web/src (grep). A user-directory endpoint cannot be verified (services absent).
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/members/page.tsx`, `apps/web/src/app/(app)/projects/[id]/members/AddMemberForm.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Confirm/choose a user search endpoint (name, email, employeeNo) with backend; add loader searchUsers(q).
  2. Create ds/EntityPicker (combobox, debounced search, returns id) and use it in AddMemberForm instead of the UUID input.
  3. Have backend return userName/email on member rows (or resolve ids in a loader) and show name plus role in the table; keep userId only as title/aria.
  4. Add zod uuid parse before POST.
- **Acceptance:**
  - Component test: typing a name lists matches; selecting submits its uuid.
  - Table row shows person name, not UUID.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Adding the wrong person to a project team is the risk today; PII (names/emails) now shown, so respect existing user-directory permissions.

### GAP-PROJECTS-DETAIL-MEMBERS-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Add Member is rendered for every role and even when the list failed to load (page.tsx:32-34); there is no confirmation, and no way to remove or change the role of a member once added (no row actions in page.tsx:55-77).
- **Verified evidence:** members/page.tsx:32-34 renders <Card title='Add Member'><AddMemberForm/></Card> unconditionally (also when errored, :31); AddMemberForm.tsx:20-49 posts immediately without ConfirmDialog; table rows (:55-77) have only userId/role/date, no actions column. No requireAnyRole/getSessionRoles used in projects pages (lib/auth/roleGuard.ts has requireAnyRole/getSessionRoles). Whether project-service enforces membership permissions or offers DELETE/PATCH member endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/members/page.tsx`, `apps/web/src/app/(app)/projects/[id]/members/AddMemberForm.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. In page.tsx compute canManage from getSessionRoles() (roles to be decided) and render the Add card only when canManage && !errored.
  2. Add a row-actions column (Change role, Remove) with ConfirmDialog if backend exposes PATCH/DELETE; otherwise raise backend ticket.
  3. Optionally confirm before adding a project_manager/finance_officer.
  4. Verify the service rejects non-managers.
- **Acceptance:**
  - Viewer-role session: Add Member card absent.
  - Errored load: card absent and only RefreshErrorState shows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Access control on project team; UI hiding is not a control, server must enforce.

### GAP-PROJECTS-DETAIL-MEMBERS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** On error both DataSourceBadge and RefreshErrorState render (page.tsx:31,36-37) — duplicate messaging; sibling pages (risks/tasks) do the same.
- **Verified evidence:** members/page.tsx:31 renders DataSourceBadge source='error' and :36-37 RefreshErrorState in the Team Members card, so both show; the Add Member form also stays. risks/page.tsx:44,52-53 and tasks/page.tsx:42,50-51 same. DataSourceBadge (DataSourceBadge.tsx) is only for the legacy pattern where a table still renders.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/members/page.tsx`, `apps/web/src/app/(app)/projects/[id]/risks/page.tsx`, `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Remove the `{source==='error' && <DataSourceBadge/>}` line from all three pages.
  2. Keep RefreshErrorState inside the card as the single message.
- **Acceptance:**
  - Force error: exactly one error message appears on each of members/risks/tasks.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PROJECTS-DETAIL-MEMBERS-04  ·  LOW  ·  partly  ·  theme STATUS (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Only project_manager and finance_officer get a tone; project_officer, engineer, viewer are indistinguishable grey (page.tsx:12-22); role label uses replace("_"," ") which only fixes the first underscore (page.tsx:70) versus the global regex used in the form (AddMemberForm.tsx:75).
- **Verified evidence:** members/page.tsx:12-22 give tone only to project_manager and finance_officer; others grey (true). Line 70 uses .replace('_',' ') but every current role has a single underscore (AddMemberForm.tsx:10) so output is correct today; only inconsistent with the /_/g used at AddMemberForm.tsx:75. Role chip is hand-rolled inline span, not a shared component. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/members/page.tsx`
- **Fix steps:**
  1. Add humanizeStatus (lib/formatters.ts) for the label instead of replace.
  2. Give each role a distinct tone or use a neutral chip deliberately; move to a shared RoleChip/StatusPill mapping.
- **Acceptance:**
  - Unit test: 'project_officer' -> 'Project Officer'.
  - Visual check of the five roles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** StatusPill tones

### GAP-PROJECTS-DETAIL-MEMBERS-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W2 closed by #W2-PROJECTS-1: formatIndianDate now returns — for any non-parseable string, not the raw string; test updated)
- **W0 note:** partly fixed by #1869 — formatIndianDate now used, but it echoes an unparseable value verbatim (not '—'), and the table is still a bare tbl-wrap (no DataTable / stacked mobile rows).
- **First-pass claim:** Table uses a bare .tbl without a mobile card transform, and dates use toLocaleDateString("en-IN") (page.tsx:74) rather than the shared formatIndianDate.
- **Verified evidence:** members/page.tsx:45-46 uses <div.tbl-wrap><table.tbl> (civitas-ds.css:132 gives horizontal scroll only, no card transform; DataTable has none either). Date at :74 uses toLocaleDateString('en-IN'), which yields the same dd/mm/yyyy as lib/formatters.ts:2-7 formatIndianDate; difference is helper consistency and that an invalid createdAt prints 'Invalid Date' instead of '—'. Neither helper sets timeZone IST, and neither prints 'dd Mon yyyy'.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/members/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Use formatIndianDate(m.createdAt).
  2. Move the table to DataTable (or add a shared mobile stacked-row class) if mobile cards are a requirement.
  3. If IST/dd Mon yyyy is desired add a formatter option centrally and pass timeZone:'Asia/Kolkata'.
- **Acceptance:**
  - Unit test: bad date -> '—'.
  - Narrow viewport: table readable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /projects/[id]/risks  —  `projects/detail-risks.html`

- **Source:** `apps/web/src/app/(app)/projects/[id]/risks/page.tsx`
- **Design reference:** `redesign/projects/detail-risks.html`

### GAP-PROJECTS-DETAIL-RISKS-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only register with no way to add, edit or close a risk anywhere in the projects route tree (page.tsx has no actions or links); the empty state says only “No risks have been identified”, so a project manager has no path to record one.
- **Verified evidence:** risks/page.tsx has no actions on PageHeader (:39-43), no links, and the empty state (:55-59) only says none identified. grep finds no web route/form for creating risks (only loader GET at loaders.ts:5275). A backend create endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/risks/page.tsx`, `apps/web/src/app/(app)/projects/[id]/risks/AddRiskForm.tsx (new)`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm POST/PATCH risk endpoints with backend.
  2. Add AddRiskForm (title, category, probability, impact, mitigationPlan; zod at boundary) and PageHeader action 'Add risk', role-gated.
  3. Add status change action (mitigate/close) with ConfirmDialog and reason.
  4. Update empty state with the action button.
- **Acceptance:**
  - Component test: submit valid form POSTs and router.refresh().
  - Manual: new risk appears with computed score.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Audit events must be emitted server-side for risk changes.

### GAP-PROJECTS-DETAIL-RISKS-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Score bands are hard-coded (≥ 9 critical, ≥ 4 amber; page.tsx:11,26-35) and probability/impact are unconstrained strings, so the 1-5 matrix behind riskScore is invisible; “Critical” cannot be reconciled with the row data.
- **Verified evidence:** Thresholds are hard-coded at risks/page.tsx:11 (>=9 critical) and :26-35 (>=9 red, >=4 amber); probability/impact are typed string (loaders.ts:5265-5266) and printed capitalized (:92-97). Nothing shows the scale; the score range and matrix behind riskScore cannot be verified (backend absent). It is not fabricated data, just undocumented presentation rules.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/risks/page.tsx`
- **Fix steps:**
  1. Move bands to a shared constant RISK_BANDS and add a legend under the table ('Score = probability x impact; 9+ critical, 4-8 medium').
  2. Confirm scale with backend and remove ambiguity.
  3. Consider showing probability/impact as levels with numbers.
- **Acceptance:**
  - Legend visible; test scoreBand(9)='critical', (4)='medium', (3)='low'.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Wrong band could under-flag risks; confirm thresholds with PMU.

### GAP-PROJECTS-DETAIL-RISKS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Duplicate error messaging: DataSourceBadge and RefreshErrorState both render (page.tsx:44,52-53); status “open” is styled red here but StatusPill treats “open” as good/green elsewhere (ds/StatusPill.tsx:14).
- **Verified evidence:** Duplicate messaging at risks/page.tsx:44 and :52-53. Colour conflict: statusBg/statusColor (:14-25) paint 'open' red, while StatusPill.tsx:12 maps 'open' to good. Stat cards already show '—' when errored.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/risks/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Remove DataSourceBadge line.
  2. Replace hand-rolled status span with StatusPill after adding risk statuses (open: bad/warn, mitigated: good, occurred: bad, closed: mut) - consider a per-domain label map so 'open' is not global good.
- **Acceptance:**
  - One error message on failure; 'open' risk shows warning/red pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Changing global 'open' would recolour other screens; use a domain override.
- **Depends on:** StatusPill tones, GAP-PROJECTS-DETAIL-MEMBERS-03

### GAP-PROJECTS-DETAIL-RISKS-04  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Status and score meaning is colour-plus-text only inside hand-rolled inline-styled spans, not the shared StatusPill; table has no mobile card transform (page.tsx:61-120).
- **Verified evidence:** risks/page.tsx:78-90 and :99-111 are inline-styled spans (score, status), status text is raw r.status (:110, lowercase); table :61-62 is a bare .tbl with only overflow scroll. Text is present so meaning is not colour-only.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/risks/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Use StatusPill for status with humanized label; create a small ScoreBadge in ds.
  2. Move to DataTable for consistency and mobile handling.
- **Acceptance:**
  - Snapshot: status shows 'Open' pill; score badge keeps thresholds.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.
- **Depends on:** StatusPill tones

### GAP-PROJECTS-DETAIL-RISKS-05  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1869, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** Loading uses the parent detail skeleton (no risks/loading.tsx), causing a layout jump.
- **Verified evidence:** risks/ contains only page.tsx; [id]/loading.tsx:1-13 is the generic detail skeleton (Tailwind slate min-h-screen blocks) which is used for risks, tasks and members too. Also off the design system tokens.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/risks/loading.tsx`, `apps/web/src/app/(app)/projects/[id]/tasks/loading.tsx`, `apps/web/src/app/(app)/projects/[id]/members/loading.tsx`
- **Fix steps:**
  1. Add loading.tsx to each sub-route using ds Skeleton with header, stat row and table placeholders matching the page.
  2. Optionally restyle [id]/loading.tsx to ds tokens.
- **Acceptance:**
  - Navigate detail -> risks: skeleton has stat tiles and table, no jump.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /projects/[id]/tasks  —  `projects/detail-tasks.html`

- **Source:** `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Design reference:** `redesign/projects/detail-tasks.html`

### GAP-PROJECTS-DETAIL-TASKS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [~] **Status** (INTERIM W2-PROJECTS-1: AddTaskForm (POST /tasks, role-gated) is present; status/progress edit UI (PATCH /tasks/:id/status) is still missing. Backend endpoint exists per W0-10 note. NEEDS OWNER DECISION: implement the full PATCH task-status form as a separate sprint item. Flagged L-effort web+backend.)
- **W0-10 note:** review found the W0 tick partly — AddTaskForm (POST /tasks, role-gated, backend exists) and empty-state copy done, but no status/progress edit UI: no PATCH call anywhere under projects/[id]/tasks although backend PATCH /tasks/:taskId and /status exist (fix step 2)
- **First-pass claim:** Empty state tells end users “Use the API to create tasks.” (page.tsx:56) and the page offers no add/edit control, so a project team cannot build a WBS from the UI; /projects/wbs repeats the dependency (“Create tasks in a project to see the WBS”).
- **Verified evidence:** tasks/page.tsx:56 message 'Use the API to create tasks.'; no add/edit control on the page; wbs/page.tsx:33 says 'Create tasks in a project to see the WBS.' Backend create-task endpoint cannot be verified (copy implies one exists).
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`, `apps/web/src/app/(app)/projects/[id]/tasks/AddTaskForm.tsx (new)`, `apps/web/src/app/(app)/projects/wbs/page.tsx`
- **Fix steps:**
  1. Confirm task POST/PATCH endpoints.
  2. Add AddTaskForm (name, parent, dates, weight; zod) and status/progress edit; role-gated.
  3. Replace copy with 'No tasks yet. Add the first task.' plus action button; update wbs empty message to link to the project tasks.
- **Acceptance:**
  - Create a task from UI -> appears in list and in /projects/wbs.
  - Empty state contains no mention of API.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Weight% must sum to 100 per parent; validation needed.

### GAP-PROJECTS-DETAIL-TASKS-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Status counts include both parents and sub-tasks (page.tsx:11-14) so totals double-count a parent and its children; only parentTaskId with one level of indent is rendered (:72).
- **Verified evidence:** tasks/page.tsx:11-14 count all rows incl. sub-tasks; that counts each task once by its own status, so it is not literally a double count unless parent status is a roll-up (cannot verify). Rows are rendered in API order with a fixed 16px indent when parentTaskId is set (:72), not grouped under their parent and only one level. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Sort/group tasks into a tree (build by parentTaskId, depth-first) with indent = depth*16.
  2. Label the tiles 'Tasks (incl. sub-tasks)' or count leaf tasks only, after confirming parent-status semantics.
- **Acceptance:**
  - Unit test tree builder with 3 levels; sub-tasks appear under parent.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-PROJECTS-DETAIL-TASKS-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** “Back to Project” action duplicates the header back link (page.tsx:35-40); planned dates print as raw ISO strings (:121-125) and actual dates fetched (loaders.ts:5219-5220) are never shown.
- **Verified evidence:** tasks/page.tsx:35 back prop and :36-40 'Back to Project' action link to the same URL; :121-125 print t.plannedStart/plannedEnd raw (ISO); actualStart/actualEnd exist in ProjectTaskRow (loaders.ts:5219-5220) but are not rendered. Theme is DATEFMT.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Remove the actions block.
  2. Render formatIndianDate(t.plannedStart/plannedEnd) and add Actual Start/End columns.
- **Acceptance:**
  - Dates show dd/mm/yyyy; null shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PROJECTS-DETAIL-TASKS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Duplicate error messaging (DataSourceBadge plus RefreshErrorState; page.tsx:42,50-51). Table lacks the mobile card transform.
- **Verified evidence:** Duplicate messaging at tasks/page.tsx:42 and :50-51; table :60-61 bare .tbl (scroll only).
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Remove DataSourceBadge line (see MEMBERS-03).
  2. Move to DataTable for mobile/filters if required.
- **Acceptance:**
  - Single error message on failure.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PROJECTS-DETAIL-MEMBERS-03

### GAP-PROJECTS-DETAIL-TASKS-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Progress bar colour is amber unless exactly ≥ 100% and blocked tasks show progress in amber, ignoring status (page.tsx:107-112).
- **Verified evidence:** tasks/page.tsx:107-112 bar colour good only if progressPct>=100 else warn regardless of status (blocked stays amber); width `${t.progressPct}%` is not clamped to 0-100.
- **Files to change:** `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Use shared ProgressBar (ds/ProgressBar.tsx) or compute colour from status (blocked bad, completed good, else brand) and clamp with Math.min(100,Math.max(0,p)).
- **Acceptance:**
  - Test: progress 130 renders 100% width; blocked task uses bad colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /projects/beneficiaries  —  `projects/beneficiaries.html`

- **Source:** `apps/web/src/app/(app)/projects/beneficiaries/page.tsx`
- **Design reference:** `redesign/projects/beneficiaries.html`

### GAP-PROJECTS-BENEFICIARIES-01  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: beneficiary names, social category and disbursement are shown to every module user with no role gate or masking and can be exported in one click to CSV (BeneficiariesTable.tsx:46-54; page.tsx has no requireAnyRole).
- **Verified evidence:** BeneficiariesTable.tsx:16-22 shows Name, District, Category, Disbursement columns and DataTable exportable (line 53) downloads CSV of all sorted rows (DataTable.tsx:274-290) with no audit/masking. page.tsx has no requireAnyRole; projects/layout.tsx only applies ModuleGate (tenant module flag). Server-side role scoping in the projects service cannot be verified (service absent). No Aadhaar/phone shown; category is sensitive social category.
- **Files to change:** `apps/web/src/app/(app)/projects/beneficiaries/page.tsx`, `apps/web/src/app/(app)/projects/beneficiaries/BeneficiariesTable.tsx`, `apps/web/src/app/(app)/projects/beneficiaries/layout.tsx`
- **Fix steps:**
  1. Add a layout.tsx with requireAnyRole(<project/social-welfare roles>, '/projects') from lib/auth/roleGuard; decide role list.
  2. Remove exportable or wrap export so it is only rendered for an export role and calls an audited backend export endpoint (audit event required by CLAUDE.md).
  3. Render name/category via a shared <Masked> component with role-based reveal if one exists; otherwise create it.
  4. Confirm backend row-level filtering by role.
- **Acceptance:**
  - User without the role is redirected.
  - CSV button absent for non-export roles; export produces an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of beneficiary PII and social category.

### GAP-PROJECTS-BENEFICIARIES-02  ·  HIGH  ·  confirmed  ·  theme LOGIC (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles misreport verification: “Verified” and “Active” are the same count (page.tsx:23-24) and “Pending Verification” = pending + rejected (page.tsx:25), so rejected applicants look pending; the Verified column pill reads “Active”.
- **Verified evidence:** page.tsx:14-16 active = verified==='active', pending, notVerified = rejected. Tiles: 'Active' (line 23) and 'Verified' (line 24) both use `active`; 'Pending Verification' = pending + notVerified (line 25) so rejected counts as pending. The table 'Verified' column uses cellType:'status' (BeneficiariesTable.tsx:23), and StatusPill humanizes value 'active' to 'Active' (StatusPill.tsx:61).
- **Files to change:** `apps/web/src/app/(app)/projects/beneficiaries/page.tsx`, `apps/web/src/app/(app)/projects/beneficiaries/BeneficiariesTable.tsx`
- **Fix steps:**
  1. Drop the duplicate tile: keep 'Verified' (verified==='active') and remove 'Active', or define Active differently with backend.
  2. Change 'Pending Verification' to `pending` only and add a 'Rejected' tile with notVerified.
  3. Add label mapping in the Verified column (active -> 'Verified', pending -> 'Pending', rejected -> 'Rejected') via StatusPill label or a render fn.
  4. Confirm the verified enum values with the projects service.
- **Acceptance:**
  - Fixture: 3 active, 2 pending, 1 rejected shows Verified 3, Pending 2, Rejected 1.
  - Row pill for 'active' reads 'Verified'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Misreports verification counts to officials.

### GAP-PROJECTS-BENEFICIARIES-04  ·  MEDIUM  ·  partly  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Loading is one bare .skeleton block (loading.tsx:4) with no header or stat placeholders; rows link nowhere so there is no beneficiary detail view.
- **Verified evidence:** loading.tsx:3-5 is a single .skeleton block without header/stat placeholders: confirmed. DataTable in BeneficiariesTable.tsx:44-52 has no rowHref/onRowClick, and no beneficiary detail route exists under projects/beneficiaries (only page, table, loading, error): confirmed. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/projects/beneficiaries/loading.tsx`
- **Fix steps:**
  1. Rebuild loading.tsx with a PageHeader-like skeleton, 4 stat skeleton cards and a table skeleton (reuse existing skeleton classes/components in _components/ds if present).
  2. If a detail view is wanted, add [id]/page.tsx and pass rowHref to DataTable (backend endpoint must exist; cannot-verify).
- **Acceptance:**
  - Loading state shows header, stat and table skeletons matching layout, no layout shift.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-PROJECTS-BENEFICIARIES-05  ·  LOW  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** The DataTable renders its own “No beneficiaries match the current filter.” but the empty card has no distinction between “none registered” and “filtered out” beyond copy.
- **Verified evidence:** BeneficiariesTable.tsx:57-59 emptyMessage 'No beneficiaries match the current filter.' is only reachable when rows exist but filter matches none (page.tsx:32 renders a separate EmptyState 'No beneficiaries' when rows.length===0). So the distinction the finding wants already exists at page level; remaining issue is only that the DataTable empty title reads 'No beneficiaries' rather than 'No matches'. Theme I18N is wrong; strings are hardcoded English.
- **Files to change:** `apps/web/src/app/(app)/projects/beneficiaries/BeneficiariesTable.tsx`
- **Fix steps:**
  1. Set emptyTitle to 'No matching beneficiaries' and add emptyAction to clear the filter if DataTable supports it.
  2. Move copy to next-intl if the page adopts it.
- **Acceptance:**
  - Filter with no match shows 'No matching beneficiaries'; empty register shows the page-level empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /projects/dashboard  —  `projects/dashboard.html`

- **Source:** `apps/web/src/app/(app)/projects/dashboard/page.tsx`
- **Design reference:** `redesign/projects/dashboard.html`

### GAP-PROJECTS-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Column titled “RAG Status” is bound to the lifecycle status field (DashboardProjectsTable.tsx:40; page.tsx:42 never maps rag into the row), so RAG is not shown at all on the RAG dashboard; StatusPill also renders "delayed" as neutral info blue (ds/StatusPill.tsx:6-38).
- **Verified evidence:** dashboard/page.tsx:34-43 builds rows with status: p.status and no rag; DashboardProjectsTable.tsx:40 declares { key:'status', label:'RAG Status', cellType:'status' } so DataTable.tsx:127 renders StatusPill of the lifecycle status. /projects/list/page.tsx:22-24 shows ProjectSummary.rag (green/amber/red) exists. StatusPill.tsx:5-39 STATUS_MAP has no 'delayed','on_hold','in_progress' so they fall back to 'info' (line 53).
- **Files to change:** `apps/web/src/app/(app)/projects/dashboard/page.tsx`, `apps/web/src/app/(app)/projects/dashboard/DashboardProjectsTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. In page.tsx rows map add rag: p.rag ?? null and add rag to DashboardProjectRow.
  2. In DashboardProjectsTable COLUMNS add a 'RAG' column with a render that shows a coloured pill mapped green->good, amber->warn, red->bad (add green/amber/red keys to STATUS_MAP or a small RagPill in ds/) with text label Green/Amber/Red.
  3. Rename the existing status column to 'Status' (lifecycle).
  4. Add 'delayed':'bad', 'on_hold':'warn', 'in_progress':'warn' to STATUS_MAP in StatusPill.tsx (also add 'in_progress' since map only has 'in progress' with a space).
- **Acceptance:**
  - Component test: row {status:'active',rag:'red'} renders 'Red' pill with class bad and a 'Active' status cell.
  - StatusPill test: status 'delayed' -> class 'pill bad'; 'on_hold' -> 'pill warn'.
  - Manual: /projects/dashboard header reads 'RAG' and 'Status' columns; no 'RAG Status' shows lifecycle text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Changing STATUS_MAP is global: check other screens that relied on 'delayed'/'in_progress' being neutral blue.
- **Depends on:** StatusPill tones

### GAP-PROJECTS-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Outlay is rounded to whole crore with Math.round(totalOutlay / 1e9) (page.tsx:32): ₹0.4 Cr shows "₹0 Cr" and the paise-exact total is lost; the "(FY)" label has no fiscal-year parameter in the request (loaders.ts:3465).
- **Verified evidence:** dashboard/page.tsx:31-32 outlayInCrores = Math.round(data.totalOutlay / 1e9) (comment says paise), rendered at :59 as ₹{n} Cr; 4,00,00,000 paise (₹0.4 Cr) -> '₹0 Cr'. Label 'Outlay (FY)' (:58) but loaders.ts:3464-3471 calls /api/v1/project/dashboard with no FY/query param, so FY is unsupported by the request (backend semantics cannot be verified; project-service absent). Math.round on a JS number also loses precision above 2^53 paise.
- **Files to change:** `apps/web/src/app/(app)/projects/dashboard/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatCrore(minor: bigint|number|string) to lib/formatters.ts doing BigInt division: whole = minor/1e9, frac 2 decimals, returns '₹0.40 Cr'; '—' for null (same convention as formatMoney).
  2. Replace outlayInCrores/Math.round in page.tsx with formatCrore(data.totalOutlay); or use formatMoney for the exact paise amount in a title/tooltip.
  3. Change label to 'Total outlay' unless the API is confirmed to be FY-scoped; if FY is wanted add an fy param to getProjectsDashboard and the request (backend to confirm).
- **Acceptance:**
  - Unit test formatCrore(4_00_00_000) -> '₹0.40 Cr', formatCrore(0) -> '₹0.00 Cr', formatCrore(null) -> '—'.
  - Manual: dashboard with outlay under 1 Cr shows non-zero value.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display; rounding is display only but a wrong zero on a finance dashboard misleads. Label change needs product decision on FY.

### GAP-PROJECTS-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** "Projects" tile uses data.totalProjects from /dashboard while the table uses rows from /projects (page.tsx:54,34); the two can disagree and neither is reconciled or explained.
- **Verified evidence:** page.tsx:54 tile uses data.totalProjects from getProjectsDashboard (/api/v1/project/dashboard) whereas the table rows (:34) come from getProjects (/api/v1/project/projects), fetched separately at :16-20. Nothing reconciles or caveats them; whether they can differ (e.g. archived/cancelled or pagination) cannot be verified because project-service is absent.
- **Files to change:** `apps/web/src/app/(app)/projects/dashboard/page.tsx`
- **Fix steps:**
  1. Decide the single source: either show rows.length in the tile or keep dashboard aggregate.
  2. If both kept, render a footnote/HelpTip when data.totalProjects !== rows.length ('Dashboard counts all statuses; table lists ...').
  3. Confirm with backend whether /project/projects is paginated or filtered.
- **Acceptance:**
  - Test: mock dashboard totalProjects=12 and projects length 10 -> a visible reconciliation note appears.
  - Manual: with equal counts no note appears.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.

### GAP-PROJECTS-DASHBOARD-04  ·  LOW  ·  confirmed  ·  theme OTHER (was MONEY)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** onTrackPct is fetched (loaders.ts:3459) but never displayed; formatMoney is imported in page.tsx:11 and unused there.
- **Verified evidence:** onTrackPct is in PROJECTS_DASHBOARD_EMPTY (loaders.ts:3457-3462) and the response schema but page.tsx never reads it; formatMoney is imported at page.tsx:11 and unused (formatMoney used only in DashboardProjectsTable.tsx:4). Theme MONEY is wrong; it is dead code / unused data.
- **Files to change:** `apps/web/src/app/(app)/projects/dashboard/page.tsx`
- **Fix steps:**
  1. Either add a StatCard 'On Track' showing data.onTrackPct (with % formatting and '—' on error) or drop it from the type/loader.
  2. Remove the unused formatMoney import from page.tsx (ESLint no-unused-vars).
- **Acceptance:**
  - Lint passes with no unused import.
  - If tile added: value renders '—' when anyError and '72%' style otherwise.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PROJECTS-DASHBOARD-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Error state has no backHref (page.tsx:71) although every sibling list page passes /projects.
- **Verified evidence:** page.tsx:71 <RefreshErrorState error=... /> has no backHref, and PageHeader (:47-51) has no back prop; sibling delay-analysis/page.tsx:20,30 passes back='/projects' and backHref='/projects'. No dashboard/error.tsx exists either (dir has DashboardProjectsTable, loading, page only); the parent projects/error.tsx handles thrown errors.
- **Files to change:** `apps/web/src/app/(app)/projects/dashboard/page.tsx`, `apps/web/src/app/(app)/projects/dashboard/error.tsx`
- **Fix steps:**
  1. Add backHref='/projects' to the RefreshErrorState at :71 and back='/projects' to PageHeader.
  2. Add dashboard/error.tsx copying delay-analysis/error.tsx (RouteError with backHref '/projects').
- **Acceptance:**
  - Manual: force fetch failure -> error card shows a 'Back' link to /projects.
  - Render test asserts backHref prop passed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /projects/delay-analysis  —  `projects/delay-analysis.html`

- **Source:** `apps/web/src/app/(app)/projects/delay-analysis/page.tsx`
- **Design reference:** `redesign/projects/delay-analysis.html`

### GAP-PROJECTS-DELAY-ANALYSIS-01  ·  HIGH  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** A “RAG dashboard” with no red/amber/green: rag is compared to active/review/overdue (page.tsx:14-16) and rendered through StatusPill as “Active / Review / Overdue”; the semantics of “At Risk” = “review” are undocumented in the page, and the real RAG (green/amber/red) used by /projects/list is a different field.
- **Verified evidence:** delay-analysis/page.tsx:14-16 counts r.rag==='active'|'review'|'overdue' (ProjectDelayRow.rag is a plain string, loaders.ts:5197) and DelayAnalysisTable.tsx:26 renders it with cellType 'status' -> StatusPill, which does colour these (active good/green, review warn/amber, overdue bad/red per StatusPill.tsx:6,18,28), so colour is RAG-like, but labels read Active/Review/Overdue. Tiles are labelled On Track/At Risk/Delayed. /projects/list uses green/amber/red (list/page.tsx:22-24), so the vocabulary is inconsistent; any other value (e.g. 'green') falls in no tile so Total may not equal the sum. What the delay-analysis endpoint (/api/v1/projects/delay-analysis) actually returns cannot be verified (backend absent).
- **Files to change:** `apps/web/src/app/(app)/projects/delay-analysis/page.tsx`, `apps/web/src/app/(app)/projects/delay-analysis/DelayAnalysisTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Create normalizeRag(raw): 'green'|'active'->'green', 'amber'|'review'->'amber', 'red'|'overdue'->'red' (shared helper in lib/rag.ts) and use it for the tile counts and the column.
  2. Render the RAG column with a RAG pill (Green/Amber/Red, matching dashboard) via a render fn in DelayAnalysisTable COLUMNS.
  3. Add an 'Other' bucket or assert sum==total so unmapped values are visible.
  4. Confirm the value set with backend and type ProjectDelayRow.rag as a union.
- **Acceptance:**
  - Unit test normalizeRag for all six inputs and unknown -> null.
  - Component test: rows with rag 'review' render an amber 'Amber' pill and increment the At Risk tile.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong bucket could hide delayed projects from a monitoring view.
- **Depends on:** GAP-PROJECTS-DASHBOARD-01

### GAP-PROJECTS-DELAY-ANALYSIS-02  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Project name is plain text with no link to /projects/[id] and there is no id in the row shape (DelayAnalysisTable.tsx:6-13), so a delayed project cannot be opened from here.
- **Verified evidence:** DelayRow (DelayAnalysisTable.tsx:6-13) and ProjectDelayRow (loaders.ts:5191-5198) have only project (name) with no id; the DataTable at :45-57 passes no rowLinkPrefix/rowLinkKey (unlike dashboard/DashboardProjectsTable.tsx:48-49), so names are plain text.
- **Files to change:** `apps/web/src/app/(app)/projects/delay-analysis/DelayAnalysisTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `project-service delay-analysis route (not in snapshot)`
- **Fix steps:**
  1. Ask backend to include projectId on /api/v1/projects/delay-analysis rows.
  2. Add projectId: string to ProjectDelayRow and DelayRow.
  3. Pass rowLinkPrefix='/projects/' rowLinkKey='projectId' identifyingColumnKey='project' to DataTable.
- **Acceptance:**
  - Manual: clicking a row name opens /projects/<id>.
  - Test: row link href equals /projects/<projectId>.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** None; until backend adds the field the link cannot be built.

### GAP-PROJECTS-DELAY-ANALYSIS-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1869, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** Loading is one bare .skeleton block (loading.tsx:4).
- **Verified evidence:** delay-analysis/loading.tsx:1-7 renders one <div class='skeleton'> in .page-main.wrap; the page has PageHeader, 4-tile StatGrid and a table Card. Compare dashboard/loading.tsx (16 lines). error.tsx exists and is correct.
- **Files to change:** `apps/web/src/app/(app)/projects/delay-analysis/loading.tsx`
- **Fix steps:**
  1. Rebuild loading.tsx using shared Skeleton (ds/Skeleton.tsx): header bar, 4 stat placeholders, 6 table-row placeholders.
  2. Reuse dashboard/loading.tsx structure.
- **Acceptance:**
  - Throttle network in devtools: skeleton has stat row + table rows and no layout jump on load.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /projects/dpr-tracking  —  `projects/dpr-tracking.html`

- **Source:** `apps/web/src/app/(app)/projects/dpr-tracking/page.tsx`
- **Design reference:** `redesign/projects/dpr-tracking.html`

### GAP-PROJECTS-DPR-TRACKING-01  ·  HIGH  ·  confirmed  ·  theme WORKFLOW (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** No workflow: DPRs can only be viewed, never submitted, reviewed, approved or returned from the UI (no actions in page.tsx or DprTrackingTable.tsx), and “Returned” is really status “rejected” (page.tsx:16), which changes the meaning for a submitter.
- **Verified evidence:** dpr-tracking/page.tsx:8-37 is a read-only server page; DprTrackingTable.tsx:46-58 is a DataTable with no action column or buttons. Only loader is getProjectDprs -> GET /api/v1/projects/dprs (loaders.ts:5168); no submit/review/approve/return call exists anywhere under projects/dpr-tracking. page.tsx:16 counts status==='rejected' under the label 'Returned' (StatCard line 25) while the row pill (StatusPill maps rejected->bad) will read 'Rejected', so tile and row disagree. Backend endpoints for DPR transitions cannot be seen (project-service absent).
- **Files to change:** `apps/web/src/app/(app)/projects/dpr-tracking/page.tsx`, `apps/web/src/app/(app)/projects/dpr-tracking/DprTrackingTable.tsx`, `apps/web/src/app/(app)/projects/dpr-tracking/DprActions.tsx (new)`
- **Fix steps:**
  1. Decide with product whether DPR workflow lives here or on /projects/[id]; confirm API for submit/review/approve/return with backend.
  2. Add a status column render in DprTrackingTable that shows 'Returned for revision' consistently (either rename tile to 'Rejected' or add a distinct 'returned' status in API + StatusPill).
  3. Create DprActions.tsx modelled on projects/fund-releases/FundReleasesActions.tsx using ConfirmDialog(requireReason) for Return/Reject and Approve.
  4. Add an Actions column (sortable:false, render) gated by a server-derived permission prop (see FUND-RELEASES-01).
  5. router.refresh() and show a success role=status message after each transition.
- **Acceptance:**
  - Component test: Reviewer sees Approve/Return on 'under review' rows only; submitter sees none.
  - Return without reason keeps Confirm disabled; with reason PATCH is sent and table refreshes.
  - Tile label and row pill use the same word for the same status.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Approvals: transitions must be enforced and audited server-side; UI-only gating is not enough.
- **Depends on:** GAP-PROJECTS-FUND-RELEASES-01

### GAP-PROJECTS-DPR-TRACKING-03  ·  MEDIUM  ·  partly  ·  theme LINK/PII (was PII)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** DPR number is not linked to a project or document, and “Submitted By” is free text (possibly a named officer — DPDP-relevant) shown to every module user (DprTrackingTable.tsx:6-14).
- **Verified evidence:** DprTrackingTable.tsx:6-14 row type has dprNo, projectTitle, submittedBy (plain string), no projectId, so DPR number and title are unlinked (no rowLinkPrefix at :46-58). Table is exportable (:53) so submittedBy goes into CSV and, via useSeededResource('projects.dprs') (:31), is also written to the offline cache on the device. Whether submittedBy is a named person is unknown (could be an agency); no <Masked> component exists in the repo (only a local MaskedInput in hr Step4). Access is only the module gate (projects/layout.tsx).
- **Files to change:** `apps/web/src/app/(app)/projects/dpr-tracking/DprTrackingTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend whether submittedBy is a person or an agency; if agency, downgrade to a link issue only.
  2. Add projectId to ProjectDprRow (loaders.ts:5157) once API returns it and set rowLinkPrefix='/projects/' rowLinkKey='projectId'.
  3. If person: create ds/Masked (reveal by role, emits audit event via existing audit call) and use it in a render for submittedBy.
  4. Drop submittedBy from the offline cache seed or from CSV export unless role allows.
- **Acceptance:**
  - Non-privileged role sees masked submittedBy; reveal writes an audit event.
  - CSV export omits or masks the column for non-privileged roles.
  - Clicking a DPR row opens the project.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII (DPDP): masking must be applied server-side too; client masking alone leaves data in the payload.

### GAP-PROJECTS-DPR-TRACKING-04  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** Loading is a single bare .skeleton block (loading.tsx:4); submitted date prints as delivered string.
- **Verified evidence:** loading.tsx:3-5 is one bare .skeleton div, while the page renders header, 4 stat cards and a card table (page.tsx:19-37). Submitted date is a raw string column (DprTrackingTable.tsx:24, no render/formatIndianDate); estimatedCost is also a raw string with '(₹ Cr)' in the label. Error boundary already uses RouteError with retry+back (error.tsx:7-13), so that part of the suggested fix is done; its area 'Projects page' gives clipped copy (see HOME-04).
- **Files to change:** `apps/web/src/app/(app)/projects/dpr-tracking/loading.tsx`, `apps/web/src/app/(app)/projects/dpr-tracking/DprTrackingTable.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx to mirror page shape: header block, 4 stat blocks in a grid-cols-4, and a table block (copy projects/list/loading.tsx).
  2. Add render: formatIndianDate(r.submittedDate) on the Submitted Date column in DprTrackingTable COLUMNS.
  3. Change area in error.tsx to 'DPR Tracking'.
- **Acceptance:**
  - Throttled navigation shows 4 stat placeholders plus a table placeholder.
  - A date like 2026-03-05 renders in the same format as other tables.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/escalations  —  `projects/escalations.html`

- **Source:** `apps/web/src/app/(app)/projects/escalations/page.tsx`
- **Design reference:** `redesign/projects/escalations.html`

### GAP-PROJECTS-ESCALATIONS-01  ·  HIGH  ·  confirmed  ·  theme COUNTS (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile maths is wrong or mislabelled: “Critical” and “High” count all rows by severity including cleared ones, and “Resolved This Month” counts every cleared row with no month filter (page.tsx:13-16), so the queue can show resolved items as Critical and last year’s closures as “this month”.
- **Verified evidence:** escalations/page.tsx:13-16: active = status!=='cleared'; critical = severity==='blocked' and high = severity==='overdue' with no status filter, so cleared rows still count as Critical/High; resolvedThisMonth = every status==='cleared' row with no date test (row type has only raisedDate, no cleared date: EscalationsTable.tsx:6-14 / loaders.ts:5119). Tile labels do not match severity values. i18n is not the issue (theme tag wrong).
- **Files to change:** `apps/web/src/app/(app)/projects/escalations/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Filter Critical/High to non-cleared rows: rows.filter(r=>r.status!=='cleared' && r.severity===...).
  2. Agree severity enum with backend (critical/high/medium/low) and rename tile labels/mapping accordingly.
  3. Request a resolvedDate/clearedAt field on ProjectEscalationRow; compute 'Resolved This Month' against it, else rename tile to 'Resolved'.
  4. Add unit test for the tile counts with mixed rows.
- **Acceptance:**
  - Rows: {blocked,cleared},{blocked,open} give Critical=1.
  - A row cleared last year is not in 'Resolved This Month'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Reporting accuracy for escalation oversight; low technical risk.

### GAP-PROJECTS-ESCALATIONS-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** A queue with no actions: escalations cannot be acknowledged, reassigned or cleared from the UI (no controls in EscalationsTable.tsx), and “open” is painted green by StatusPill (ds/StatusPill.tsx:14) — an unresolved blocker looks healthy.
- **Verified evidence:** EscalationsTable.tsx:20-28 has display-only columns; no action/ConfirmDialog. StatusPill.tsx:12 maps 'open' to 'good' (green), so an open escalation renders green; 'cleared' also good, so open vs cleared are visually identical. Changing the global map affects every module that uses status 'open'.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/projects/escalations/EscalationsTable.tsx`, `apps/web/src/app/(app)/projects/escalations/EscalationActions.tsx (new)`
- **Fix steps:**
  1. Avoid changing global 'open'; add cellType render in EscalationsTable that maps open->warn/bad via a local variant map, or add a scoped `variantOverrides` prop to StatusPill.
  2. Add EscalationActions (Acknowledge / Reassign / Clear) using ConfirmDialog(requireReason) like FundReleasesActions.
  3. Gate by server-derived permission prop; confirm backend endpoints first.
- **Acceptance:**
  - Open escalation pill is amber/red, cleared is green.
  - Clear action requires reason and refreshes the queue.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Global StatusPill change could recolour other modules' 'open' badges.
- **Depends on:** GAP-PROJECTS-FUND-RELEASES-01

### GAP-PROJECTS-ESCALATIONS-03  ·  MEDIUM  ·  partly  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Severity vocabulary is borrowed from status words (blocked/overdue) rather than critical/high; rows show a raw escalationId and the project as text with no link (EscalationsTable.tsx:6-14).
- **Verified evidence:** EscalationsTable.tsx:21-28 shows escalationId as first column and project as plain text; row type (:6-14) carries no projectId so no link is possible. Severity words: page.tsx:14-15 treats 'blocked' as Critical and 'overdue' as High, i.e. the API severity values are status-like (StatusPill.tsx:27,31 shows them red). Layer: needs backend to expose projectId and a real severity enum.
- **Files to change:** `apps/web/src/app/(app)/projects/escalations/EscalationsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Get projectId (and a human ref) added to /api/v1/projects/escalations and to ProjectEscalationRow.
  2. Add rowLinkPrefix='/projects/' rowLinkKey='projectId' with identifyingColumnKey='project'.
  3. Map severity display labels (Critical/High) in a render instead of showing raw words; hide raw escalationId or move it to last column.
- **Acceptance:**
  - Clicking a row opens the project detail.
  - Severity column reads Critical/High, not blocked/overdue.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PROJECTS-ESCALATIONS-01

### GAP-PROJECTS-ESCALATIONS-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1869, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** Loading is a single bare .skeleton block (loading.tsx:4).
- **Verified evidence:** escalations/loading.tsx:3-5 is one bare .skeleton div versus header + 4 tiles + table on the page (page.tsx:19-37). error.tsx already has RouteError with retry and back link, so the rest of the suggested fix exists.
- **Files to change:** `apps/web/src/app/(app)/projects/escalations/loading.tsx`
- **Fix steps:**
  1. Replace with shaped skeleton (header, 4 tiles, table) copied from projects/list/loading.tsx.
  2. Set error.tsx area to 'Escalations'.
- **Acceptance:**
  - Loading state layout matches the loaded page without shift.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/fund-releases  —  `projects/fund-releases.html`

- **Source:** `apps/web/src/app/(app)/projects/fund-releases/page.tsx`
- **Design reference:** `redesign/projects/fund-releases.html`

### GAP-PROJECTS-FUND-RELEASES-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Money-moving action for everyone: Disburse renders on every sanctioned row with no role gate and a single-user confirm (FundReleasesTable.tsx:44-51; FundReleasesActions.tsx:61-73); no second approver or amount recap in the dialog. Whether the server enforces role and audit cannot be checked (project-service absent).
- **Verified evidence:** FundReleasesTable.tsx:43-51 renders <DisburseButton> for every row with status 'sanctioned' (DISBURSE_ELIGIBLE :13) with no role check; FundReleasesActions.tsx:61-73 is a single ConfirmDialog (requireReason) whose description (:64) does not show amount or project. PATCH /api/proxy/v1/projects/schemes/{id}/fund-releases/{rid}/disburse (:26-33); no second approver. Server enforcement/audit cannot be verified (project-service absent). A server-side role source exists (lib/auth/roleGuard.ts getSessionRoles) but is server-only, so the page must pass a boolean down.
- **Files to change:** `apps/web/src/app/(app)/projects/fund-releases/page.tsx`, `apps/web/src/app/(app)/projects/fund-releases/FundReleasesTable.tsx`, `apps/web/src/app/(app)/projects/fund-releases/FundReleasesActions.tsx`
- **Fix steps:**
  1. In page.tsx call getSessionRoles() and compute canDisburse from the agreed role name(s); pass to FundReleasesTable and render DisburseButton only when true.
  2. Extend DisburseButton props with amount (formatMoney) and projectName; show them in ConfirmDialog description.
  3. Confirm with backend that the route enforces role and maker!=checker and writes an audit event; if not, raise as backend ticket.
  4. Optionally add second-approval flow (request then approve) if policy requires.
- **Acceptance:**
  - User without the role sees no Disburse button.
  - Dialog shows release no., project and formatted amount.
  - Direct PATCH by unauthorised role returns 403 (backend test).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money-moving, irreversible; UI hiding is cosmetic, real control must be server-side.
- **Depends on:** GAP-PROJECTS-FUND-RELEASES-02

### GAP-PROJECTS-FUND-RELEASES-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** One free-text field is both the reason and the PFMS reference: the dialog asks “PFMS reference / reason” and sends { pfmsRef: reason } (FundReleasesActions.tsx:31,66-67), so any sentence is stored as a PFMS reference and there is no format check or separate audit reason.
- **Verified evidence:** FundReleasesActions.tsx:66-67 sets requireReason with label 'PFMS reference / reason'; :31 sends {pfmsRef: reason}. One string is both audit reason and PFMS ref, with no format validation (ConfirmDialog supports min/maxReasonLength only). Nothing in the client separates the two; whether the server audits is unverifiable.
- **Files to change:** `apps/web/src/app/(app)/projects/fund-releases/FundReleasesActions.tsx`, `apps/web/src/app/_components/ds/ConfirmDialog.tsx`
- **Fix steps:**
  1. Get the PFMS ref format from backend/product (regex, length).
  2. Replace the reason field with a dedicated PFMS reference input (validated) plus a separate reason textarea; extend ConfirmDialog with an optional `extraFields` slot or build a small custom dialog body.
  3. Send {pfmsRef, reason} and confirm the API accepts both.
  4. Server must emit an audit event with actor, releaseId, amount, reason.
- **Acceptance:**
  - Confirm stays disabled until PFMS ref matches the format.
  - Request body contains separate pfmsRef and reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes a payload contract for a money route; coordinate with backend.
- **Depends on:** GAP-PROJECTS-FUND-RELEASES-01

### GAP-PROJECTS-FUND-RELEASES-03  ·  MEDIUM  ·  confirmed  ·  theme API-CONTRACT (was OTHER)

- [~] **Status** (INTERIM W2-PROJECTS-1: URL uses r.projectId as schemeId with a code comment documenting the alias. Backend project-service is absent from the snapshot so an explicit schemeId field cannot be added. NEEDS OWNER DECISION: backend to return schemeId on FundReleaseSummary, then drop the comment.)
- **First-pass claim:** The URL uses schemeId but is fed r.projectId (FundReleasesTable.tsx:47; FundReleasesActions.tsx:9,27): the code’s own comment concedes “backend stores schemeId as projectId”, an id-naming trap for a mutation route.
- **Verified evidence:** FundReleasesTable.tsx:47 passes r.projectId as prop schemeId; FundReleasesActions.tsx:9 documents 'backend stores schemeId as projectId' and :27 builds /projects/schemes/${schemeId}/fund-releases/... . Functionally consistent if the comment is true, but the API contract cannot be verified here and a wrong id would hit a mutation route.
- **Files to change:** `apps/web/src/app/(app)/projects/fund-releases/FundReleasesTable.tsx`, `apps/web/src/app/(app)/projects/fund-releases/FundReleasesActions.tsx`
- **Fix steps:**
  1. Ask backend to return an explicit schemeId on FundReleaseSummary (or rename route param).
  2. Update the table to pass r.schemeId and drop the comment.
  3. Add a component test asserting the fetch URL for a fixture row.
- **Acceptance:**
  - Fixture with distinct schemeId/projectId calls the URL with schemeId.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong id on a disburse route could 404 or hit the wrong release.

### GAP-PROJECTS-FUND-RELEASES-04  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W2 closed by #W2-PROJECTS-1: Released tile renamed Disbursed and includes released+utilized; BigInt summation for paise totals)
- **W0 note:** partly fixed by #1869 — table pills now carry scoped tones (sanctioned warn, released/utilized good); remaining: 'utilized' shares released's colour, Released tile still counts status==='released' only (excludes utilized) and totals still use JS-number reduce on paise.
- **First-pass claim:** StatusPill has no keys for released, sanctioned or utilized, so all three render identical neutral “info” blue (ds/StatusPill.tsx:6-38); tiles are exclusive status buckets, so a utilized release drops out of “Released”.
- **Verified evidence:** StatusPill.tsx:5-38 has no 'released', 'sanctioned' or 'utilized' keys, so all fall to variant 'info' (:53). True. Tiles (page.tsx:14-16) filter by exclusive status equality, so if a release moves released->utilized it leaves the Released sum; whether 'utilized' is a status of the same record or a separate state is not verifiable (types package absent). Also sums use JS number reduce on paise.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/projects/fund-releases/page.tsx`
- **Fix steps:**
  1. Add keys: released:'good', sanctioned:'warn', utilized:'good' (or 'mut') to STATUS_MAP.
  2. Confirm status lifecycle with backend; if utilized implies released, compute Released as released+utilized.
  3. Consider bigint summation for totals.
- **Acceptance:**
  - Pills for sanctioned/released/utilized render distinct colours.
  - Tile Released equals released+utilized rows if agreed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Global StatusPill edit: check other pages for these keys (none found in web src except utilization sample data).

### GAP-PROJECTS-FUND-RELEASES-05  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** No back link in PageHeader (page.tsx:22-25), no project link per row, and RefreshErrorState has no backHref (page.tsx:35); loading shows 3 stat blocks for 4 tiles.
- **Verified evidence:** page.tsx:22-25 PageHeader has no back prop; :35 RefreshErrorState has no backHref; FundReleasesTable.tsx:23-24 projectName is plain text with no link. loading.tsx:7-10 renders 3 blocks (md:grid-cols-3) while page has 4 StatCards (:27-30). No error.tsx exists in fund-releases (or milestones/list) so it inherits projects/error.tsx.
- **Files to change:** `apps/web/src/app/(app)/projects/fund-releases/page.tsx`, `apps/web/src/app/(app)/projects/fund-releases/FundReleasesTable.tsx`, `apps/web/src/app/(app)/projects/fund-releases/loading.tsx`
- **Fix steps:**
  1. Add back='/projects' to PageHeader and backHref='/projects' to RefreshErrorState.
  2. Add rowLinkPrefix to link project (needs FundReleaseSummary.projectId, already used at Table:47).
  3. Set loading grid to 4 blocks (md:grid-cols-4).
- **Acceptance:**
  - Back link visible; error state offers Back.
  - Loading shows 4 tile placeholders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-FUND-RELEASES-06  ·  LOW  ·  partly  ·  theme EMPTY (was MONEY)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty list shows ₹0.00 sums rather than “—”; no success confirmation after disburse besides router.refresh (FundReleasesActions.tsx:39-41).
- **Verified evidence:** page.tsx:27-30: when not errored and list is empty, tiles show formatMoney(0) = '₹0.00' (reduce over [] gives 0), which is a true zero, but the EmptyState below says none exist; on error tiles correctly show '—'. Post-disburse: FundReleasesActions.tsx:39-41 closes dialog and router.refresh() only; no success message.
- **Files to change:** `apps/web/src/app/(app)/projects/fund-releases/page.tsx`, `apps/web/src/app/(app)/projects/fund-releases/FundReleasesActions.tsx`
- **Fix steps:**
  1. Show '—' for money tiles when releases.length===0.
  2. Add a role=status success message (pattern from ProjectDetailActions.tsx:39,57) after successful disburse, e.g. via useState in a parent or a toast.
- **Acceptance:**
  - Empty list shows '—' in money tiles.
  - Disburse success shows 'Fund release X disbursed' text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/list  —  `projects/list.html`

- **Source:** `apps/web/src/app/(app)/projects/list/page.tsx`
- **Design reference:** `redesign/projects/list.html`

### GAP-PROJECTS-LIST-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as good news: stat tiles show real zeros and the table shows “No projects yet” beside a small badge (page.tsx:20-24,54-57; ProjectsTable.tsx:37-43). /projects/dashboard nulls its tiles and renders RefreshErrorState for the same data.
- **Verified evidence:** list/page.tsx:7-24 never checks source; on failure getProjects returns [] so tiles show 0 (:54-57) and ProjectsTable.tsx:37-43 renders DataSourceBadge 'Couldn't load — showing nothing' plus EmptyState 'No projects yet'. dashboard/page.tsx:70-72 by contrast renders RefreshErrorState when anyError. The cached fallback (useSeededResource) is fine and should be kept.
- **Files to change:** `apps/web/src/app/(app)/projects/list/page.tsx`, `apps/web/src/app/(app)/projects/list/ProjectsTable.tsx`
- **Fix steps:**
  1. In page.tsx use toResourceState(result); compute tiles as null when errored and pass '—'.
  2. Pass an `errored` flag to ProjectsTable; when provenance==='error-no-data' render RefreshErrorState (backHref='/projects') instead of EmptyState.
  3. Keep cached-data path (provenance 'cached') showing the table.
- **Acceptance:**
  - With API failing and no cache: tiles show '—', error state with Try again appears, no 'No projects yet'.
  - With cache: table shown with saved-data badge.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROJECTS-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** StatusPill has no mapping for delayed, on_hold or completed-adjacent RAG words, so a Delayed project renders in the neutral “info” blue rather than red (ds/StatusPill.tsx:6-38 vs list/ProjectsTable.tsx:19).
- **Verified evidence:** StatusPill.tsx:5-38 has no 'delayed', 'on_hold' or 'on hold' key (also 'in_progress' with underscore misses 'in progress'), so they fall to 'info' (:53). ProjectsTable.tsx:19 renders lifecycle status via cellType 'status'. The lifecycle enum values (delayed, on_hold) are referenced in list/page.tsx:8-20 comments/code.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add delayed:'bad', on_hold:'warn', 'on hold':'warn', in_progress:'warn'.
  2. Verify humanizeStatus turns on_hold into 'On hold'.
  3. Add unit test for STATUS_MAP additions.
- **Acceptance:**
  - Delayed project renders red pill; on_hold amber.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Global change; recolours any other screen using these words (intended).

### GAP-PROJECTS-LIST-03  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Completion % is passed as a pre-formatted string (page.tsx:33) so it cannot sort numerically, and the table has no sortable/filterable/pageSize flags — the full project list renders unpaginated (ProjectsTable.tsx:45).
- **Verified evidence:** list/page.tsx:33 sends completionPct as a string like '12.5%'; ProjectsTable.tsx:45 DataTable has no sortable/filterable/pageSize props, so there is no sorting, filtering or pagination and all rows render. DataTable.compareValues (DataTable.tsx:169) uses localeCompare numeric:true, so a string sort would in fact order '9.0%' before '10.0%'; the 'cannot sort numerically' claim is overstated. Fetch is one unpaginated call (loaders.ts:3473), so server-side pagination needs a backend contract.
- **Files to change:** `apps/web/src/app/(app)/projects/list/ProjectsTable.tsx`, `apps/web/src/app/(app)/projects/list/page.tsx`
- **Fix steps:**
  1. Add sortable filterable filterPlaceholder pageSize={15} to the DataTable in ProjectsTable.
  2. Pass completionPct as number and format in a column render (toFixed(1)+'%').
  3. If project counts are large, agree ?page/pageSize/q params with backend and move to server-side.
- **Acceptance:**
  - Headers are sortable; 15 rows per page with pager.
  - Sorting by completion orders 9.0 before 10.0.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; client-side filtering only covers loaded rows.

### GAP-PROJECTS-LIST-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles cover only active+delayed projects (page.tsx:20-24) while the table lists every status; a reviewer summing tiles will not reach the row count and nothing explains the scope.
- **Verified evidence:** list/page.tsx:20-24 restricts tiles to status active|delayed and RAG green/amber/red, while rows (:26-35) include every status. The explanatory comment (:8-19) is in code only; the UI does not say so.
- **Files to change:** `apps/web/src/app/(app)/projects/list/page.tsx`
- **Fix steps:**
  1. Add a 'Total' tile or subtitle text 'Tiles cover active and delayed projects (N of M)'.
  2. Optionally add a status filter to the table.
- **Acceptance:**
  - Reviewer can see how tile counts relate to row count.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-LIST-05  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** The RAG value is fetched (page.tsx:22-24) but never shown per row; the last column is lifecycle status, not RAG.
- **Verified evidence:** list/page.tsx:22-24 uses p.rag only to build tiles; the row mapping (:26-35) and ProjectRow (ProjectsTable.tsx:7-10) omit rag, and the last column (:19) is lifecycle status. So RAG is not visible per project. (The RAG value is used, not dead; it is just not shown per row.)
- **Files to change:** `apps/web/src/app/(app)/projects/list/page.tsx`, `apps/web/src/app/(app)/projects/list/ProjectsTable.tsx`
- **Fix steps:**
  1. Add rag to ProjectRow and mapping.
  2. Add a 'RAG' column with a coloured pill plus text (not colour only).
  3. Add a StatusPill keys green/amber/red or a small RagPill.
- **Acceptance:**
  - Each row shows Green/Amber/Red text badge.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROJECTS-LIST-02


---
## /projects/milestones  —  `projects/milestones.html`

- **Source:** `apps/web/src/app/(app)/projects/milestones/page.tsx`
- **Design reference:** `redesign/projects/milestones.html`

### GAP-PROJECTS-MILESTONES-01  ·  HIGH  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises “Define milestones, track achievement, trigger payment release” (page.tsx:23) but the page can do none of these: it is a read-only list with no create, complete or release control; completion is only on /projects/[id] (ProjectDetailActions.tsx).
- **Verified evidence:** milestones/page.tsx:23 subtitle 'Define milestones, track achievement, trigger payment release.' but MilestonesTable.tsx:9-24 is read-only with no actions. Only completion exists, on the project page: [id]/ProjectDetailActions.tsx:20-39 (POST .../milestones/{id}/complete, pending only). No create or payment-release control anywhere seen.
- **Files to change:** `apps/web/src/app/(app)/projects/milestones/page.tsx`, `apps/web/src/app/(app)/projects/milestones/MilestonesTable.tsx`
- **Fix steps:**
  1. Quick fix: change subtitle to 'Milestone status across all projects.'
  2. Add row link to the project (needs projectId) so users reach completion.
  3. If product wants create/release here, scope it with backend (endpoints unverified).
- **Acceptance:**
  - Subtitle matches what the page does.
  - Row opens the project where Complete is available.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy change; release action would be money-related and needs approval design.
- **Depends on:** GAP-PROJECTS-MILESTONES-03

### GAP-PROJECTS-MILESTONES-02  ·  MEDIUM  ·  partly  ·  theme COUNTS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles do not reconcile: in_progress milestones are counted in no tile (page.tsx:13-15), so Pending + Completed + Delayed < Total.
- **Verified evidence:** milestones/page.tsx:13-15 counts only pending, completed and delayed; Total is milestones.length (:26). Any other status (e.g. in_progress as the observation says) is uncounted. The MilestoneSummary status enum lives in @civitasone/types, absent here, so in_progress existence is unverified; StatusPill has 'in progress' but not 'in_progress'.
- **Files to change:** `apps/web/src/app/(app)/projects/milestones/page.tsx`
- **Fix steps:**
  1. Confirm the enum with backend.
  2. Add an 'In progress' tile or compute Pending as total-completed-delayed, and label accordingly.
- **Acceptance:**
  - Tiles sum to Total for a fixture containing every status.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-MILESTONES-03  ·  MEDIUM  ·  partly  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Rows carry no project id or link (MilestonesTable.tsx:15-16), so a delayed milestone cannot be opened; PageHeader has no back link and RefreshErrorState no backHref (page.tsx:21-36).
- **Verified evidence:** MilestonesTable.tsx:15-16 columns are projectName and title only, no rowLinkPrefix; whether MilestoneSummary includes projectId cannot be seen (types absent). page.tsx:21-24 PageHeader has no back; :34 RefreshErrorState has no backHref. Fund-releases uses r.projectId from the sibling summary so a projectId likely exists but unverified.
- **Files to change:** `apps/web/src/app/(app)/projects/milestones/page.tsx`, `apps/web/src/app/(app)/projects/milestones/MilestonesTable.tsx`
- **Fix steps:**
  1. Add back='/projects' and backHref='/projects'.
  2. If MilestoneSummary has projectId, set rowLinkPrefix='/projects/' rowLinkKey='projectId' identifyingColumnKey='title'; else request it from backend.
- **Acceptance:**
  - Row click opens project; back link present.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-MILESTONES-04  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** StatusPill renders in_progress and delayed as neutral info (ds/StatusPill.tsx:6-38); loading shows 3 blocks for 4 tiles (loading.tsx:8-10).
- **Verified evidence:** StatusPill.tsx has no 'in_progress' or 'delayed' key (delayed is missing; 'in progress' with space exists), so they render 'info'. milestones/loading.tsx:8-10 shows 3 blocks (Array length 3) under grid-cols-4 vs 4 StatCards at page.tsx:26-29.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/projects/milestones/loading.tsx`
- **Fix steps:**
  1. Add delayed:'bad', in_progress:'warn' (see LIST-02).
  2. Set loading placeholder length to 4.
- **Acceptance:**
  - Delayed milestone is red; loading shows 4 tiles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROJECTS-LIST-02


---
## /projects/new  —  `projects/new.html`

- **Source:** `apps/web/src/app/(app)/projects/new/page.tsx`
- **Design reference:** `redesign/projects/new.html`

### GAP-PROJECTS-NEW-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Form captures no scheme or department, yet the list and dashboard show Scheme and Agency/Dept columns (list/ProjectsTable.tsx:15-16); every project created here shows “—” in both and cannot be linked to a scheme from the UI (CreateProjectForm.tsx:72-79).
- **Verified evidence:** CreateProjectForm.tsx fields are code, projectName, startDate, endDate, sanctionedRupees, dprCostRupees; body built at :72-79 has no scheme or department. list/page.tsx:30-31 defaults scheme and department to '—'. Whether POST /v1/projects accepts schemeId/department cannot be verified (project-service absent); getSchemes exists (loaders.ts:3509) for a picker.
- **Files to change:** `apps/web/src/app/(app)/projects/new/CreateProjectForm.tsx`, `apps/web/src/app/(app)/projects/new/page.tsx`
- **Fix steps:**
  1. Confirm request fields with backend.
  2. Load getSchemes() in new/page.tsx and pass options to the form; add a required/optional Scheme select and a Department field.
  3. Include schemeId/department in body at :72-79.
  4. Add zod schema at the boundary.
- **Acceptance:**
  - Created project shows its scheme and department in /projects/list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-PROJECTS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Only the first validation error is shown as one paragraph; aria-invalid is set but no per-field message, no aria-describedby and no focus move (CreateProjectForm.tsx:25-52,199-212).
- **Verified evidence:** CreateProjectForm.tsx:25-52 validate() returns on the first failing rule; the message renders once at :199-212 in one paragraph; inputs set aria-invalid (:119,135,161,176,192) but no aria-describedby, no per-field error text, and no focus move to the invalid input. Theme is form accessibility, not CAP.
- **Files to change:** `apps/web/src/app/(app)/projects/new/CreateProjectForm.tsx`
- **Fix steps:**
  1. Change validate() to return a Record<field,message> for all errors.
  2. Render a <p id='{field}-err'> under each field and set aria-describedby.
  3. On submit failure focus the first invalid field (refs) and keep summary with role=alert.
  4. Consider shared form-validation helper in lib/form-validation.ts.
- **Acceptance:**
  - Submitting empty form shows errors under code and name.
  - Screen reader announces error for focused field; focus lands on first invalid input.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PROJECTS-NEW-04  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Amounts are typed as plain rupees with no lakh grouping or echo ("5000000"), and converted with floating Math.round(Number(x)*100) (:78-79); very large sanctions risk precision loss.
- **Verified evidence:** CreateProjectForm.tsx:78-79 use Math.round(Number(x)*100) (float; 1.005 mis-rounds, contrary to lib/money.ts:1-9 guidance). Realistic precision loss at very large values is negligible (needs ~9e13 rupees), so 'large sanctions' overstated. Inputs are type=number with no lakh grouping or echo (:166-196). A safe helper already exists: rupeesToMinorString in lib/money.ts (rejects >2 decimals, returns string; rejects zero).
- **Files to change:** `apps/web/src/app/(app)/projects/new/CreateProjectForm.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Use rupeesToMinorString(sanctionedRupees) in validate and body; show error for null (invalid or >2dp).
  2. Send minor as string/number per API contract (confirm; currently a number).
  3. Show echo with formatMoney(minor) beneath the field and in the confirm dialog description.
  4. Switch inputs to type=text inputMode=decimal.
- **Acceptance:**
  - Entering 1.005 is rejected with a clear message.
  - Confirm dialog shows '₹50,00,000.00' for input 5000000.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: changes payload type only if string is chosen; keep number if API requires.

### GAP-PROJECTS-NEW-05  ·  LOW  ·  partly  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Cancel and back both return to /projects/list, not the hub the user may have come from (new/page.tsx:10; CreateProjectForm.tsx:223).
- **Verified evidence:** new/page.tsx:10 back='/projects/list'; CreateProjectForm.tsx:223 Cancel to /projects/list; success also pushes /projects/list (:92). This is a fixed parent target, not history-aware. Reasonable since the list is the natural parent and the hub links to /projects/list first; low impact.
- **Files to change:** `apps/web/src/app/(app)/projects/new/page.tsx`, `apps/web/src/app/(app)/projects/new/CreateProjectForm.tsx`
- **Fix steps:**
  1. Optionally accept a ?from= param or use router.back() for Cancel when history exists.
  2. Otherwise leave as is and close.
- **Acceptance:**
  - Cancel returns to the page the user came from (if implemented).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/schemes  —  `projects/schemes.html`

- **Source:** `apps/web/src/app/(app)/projects/schemes/page.tsx`
- **Design reference:** `redesign/projects/schemes.html`

### GAP-PROJECTS-SCHEMES-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1953, verified on main 9c5e9e9e9)
- **First-pass claim:** Two money units for the same scheme: the list returns whole rupees and is printed with formatRupees (SchemesTable.tsx:37-47; page.tsx:15-16, COMP-017), whereas the detail route returns minor-unit strings printed with formatMoney (schemes/[id]/page.tsx:80,103). The convention rests on comments; a wrong formatter is a silent 100x error (fund-releases list is paise as well).
- **Verified evidence:** Same as DETAIL-01: schemes/page.tsx:15-16,36-37 and SchemesTable.tsx:37-47 use formatRupees; schemes/[id]/page.tsx:80,103 use formatMoney. Documented in comments (page.tsx:29-35, SchemesTable.tsx:24-36). Claim that fund-releases is paise: loaders.ts:3500 uses FundReleaseSummaryListSchema, not verifiable for units here (types package absent). Duplicate of DETAIL-01.
- **Files to change:** `services/project-service (scheme list response)`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/projects/schemes/SchemesTable.tsx`, `apps/web/src/app/(app)/projects/schemes/page.tsx`
- **Fix steps:**
  1. Fix once together with GAP-PROJECTS-SCHEMES-DETAIL-01: list returns minor-unit strings.
  2. Switch list columns to cellType:'amount' and page.tsx sums to BigInt + formatMoney.
  3. Remove COMP-017 rationale comments once unified.
- **Acceptance:**
  - List and detail render identical figures for one scheme.
  - Test for sum of many rows with paise precision.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display; coordinate backend and web release.
- **Depends on:** GAP-PROJECTS-SCHEMES-DETAIL-01

### GAP-PROJECTS-SCHEMES-02  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Scheme code is the first column but the row link is on Name (identifyingColumnKey; SchemesTable.tsx:65-68); no “Projects #” drill-through, and the PageHeader has no back link and RefreshErrorState no backHref (page.tsx:22-43).
- **Verified evidence:** SchemesTable.tsx:16 schemeCode is column 0; :65-68 rowHref plus identifyingColumnKey='name' (deliberate UX-015). Projects # is displayed as a plain number (:48) with no link. schemes/page.tsx:22-25 PageHeader has no back prop; :42 RefreshErrorState has no backHref. Row-link on name is intentional, so that part is a design choice rather than a defect.
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/page.tsx`, `apps/web/src/app/(app)/projects/schemes/SchemesTable.tsx`
- **Fix steps:**
  1. Add back='/projects' backLabel to PageHeader at page.tsx:22.
  2. Add backHref='/projects' to RefreshErrorState at :42.
  3. Optionally render projectCount via render() as a Link to /projects/list?scheme=<id> if list supports that filter (verify first).
- **Acceptance:**
  - Back link visible on schemes list.
  - Error state offers back action.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-SCHEMES-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** Empty list shows ₹0.00 for both money tiles instead of “—” (page.tsx:15-16,36-37); loading.tsx omits stat placeholders so the page jumps (loading.tsx).
- **Verified evidence:** schemes/page.tsx:15-16 reduce over [] gives 0 when not errored, so :36-37 render formatRupees(0) = '₹0.00' for an empty scheme list (only the errored branch shows '—'). schemes/loading.tsx:4-8 renders title bars and one h-80 block, no stat-card placeholders, and uses tailwind min-h-screen unlike sibling loading files.
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/page.tsx`, `apps/web/src/app/(app)/projects/schemes/loading.tsx`
- **Fix steps:**
  1. In page.tsx compute totals as null when errored OR schemes.length===0 so tiles show '—'.
  2. Rewrite loading.tsx to page-main wrap with 4 stat placeholders and a table block (reuse the .skeleton class used elsewhere).
  3. Keep formatRupees for now (units resolved by GAP-PROJECTS-SCHEMES-01).
- **Acceptance:**
  - Empty API result shows '—' in both money tiles and Total 0.
  - Skeleton has stat row; no visible jump on load.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PROJECTS-SCHEMES-04  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** The subtitle promises “Physical & financial progress, beneficiaries” (page.tsx:24) but the table shows neither physical progress nor beneficiary counts (SchemesTable.tsx:15-49).
- **Verified evidence:** schemes/page.tsx:24 subtitle 'Physical & financial progress, beneficiaries — scheme-wise.'; SchemesTable.tsx:16-49 columns are code, name, ministry, funding type, allocation, released, projects #, status: no physical progress or beneficiaries. Detail page does show beneficiaries (page.tsx:84-87). Whether SchemeSummary carries those fields cannot be seen (package absent).
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/page.tsx`
- **Fix steps:**
  1. Change subtitle to 'Scheme-wise allocation, releases and project counts.' (or add columns if the summary API provides them).
  2. Add utilisation % column only if listSchemeSummaries returns it.
- **Acceptance:**
  - Subtitle only claims what the table shows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/schemes/[id]  —  `projects/schemes-detail.html`

- **Source:** `apps/web/src/app/(app)/projects/schemes/[id]/page.tsx`
- **Design reference:** `redesign/projects/schemes-detail.html`

### GAP-PROJECTS-SCHEMES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1953, verified on main 9c5e9e9e9)
- **First-pass claim:** Unit clash with the list: this page prints budget and released with formatMoney (paise, page.tsx:80,103) while /projects/schemes prints the same scheme’s allocation with formatRupees (rupees, SchemesTable.tsx:40-47). Correct only because of two comments (COMP-016/017); no shared type prevents a 100x display error.
- **Verified evidence:** schemes/[id]/page.tsx:80,103 print scheme.totalOutlayMinor/releasedMinor via formatMoney (paise); schemes/SchemesTable.tsx:37-47 and schemes/page.tsx:15-16,36-37 print totalAllocation/releasedAmount via formatRupees (whole rupees, per COMP-017 comments). Both correct today; the unit split lives only in comments and in the loaders' zod schemas. SchemeSummary/SchemeDetail types live in packages/types, absent from snapshot, so field types cannot be checked.
- **Files to change:** `services/project-service (scheme list response)`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/projects/schemes/SchemesTable.tsx`, `apps/web/src/app/(app)/projects/schemes/page.tsx`
- **Fix steps:**
  1. Backend: make GET /v1/projects/schemes return totalAllocationMinor/releasedMinor as minor-unit strings like the detail route (keep old fields one release, mark deprecated).
  2. Update SchemeSummarySchema in the shared schemas package and getSchemes() in loaders.ts accordingly.
  3. In SchemesTable switch the two columns to cellType:'amount' (formatMoney) and drop formatRupees usage; in page.tsx sum with BigInt of the minor strings and format with formatMoney.
  4. If the API cannot change now, add branded types Paise/Rupees in @civitasone/types so a rupee field cannot be passed to formatMoney at compile time.
  5. Add a contract test asserting list and detail agree for the same scheme.
- **Acceptance:**
  - Same scheme shows identical allocation/released on list and detail (component test with one fixture).
  - Sum on list page equals sum of rows to the paisa with values >2^53 as strings.
  - TypeScript error when passing a Rupees-branded value to formatMoney.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display; a wrong switch of formatter gives 100x error. Must ship backend and web together.

### GAP-PROJECTS-SCHEMES-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Utilized % is interpolated raw (`${scheme.utilisationPct}%`, page.tsx:81) with no rounding and start/end dates are printed as delivered ISO strings (page.tsx:105-107) while other pages use formatIndianDate.
- **Verified evidence:** schemes/[id]/page.tsx:81 renders `${scheme.utilisationPct}%` with no rounding or null guard (type not visible; package absent); page.tsx:105,107 print scheme.startDate/endDate raw (ISO or '—'). formatIndianDate exists in lib/formatters.ts:2 and is used by projects/[id]/page.tsx:4. Note it outputs dd/mm/yyyy (2-digit month), not 'dd Mon yyyy'.
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Import formatIndianDate and wrap startDate/endDate at page.tsx:105,107.
  2. Replace line 81 with formatPercent(scheme.utilisationPct, 1) (formatters.ts:190 already returns '—' for null).
  3. If 'dd Mon yyyy' is the desired standard, change formatIndianDate once centrally rather than per page.
- **Acceptance:**
  - Fixture startDate '2024-04-01' renders '01/04/2024'.
  - utilisationPct 66.6666 renders '66.7%'; null renders '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.

### GAP-PROJECTS-SCHEMES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme NAVUX (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Duplicate wayfinding: a hand-built breadcrumb plus PageHeader back link (page.tsx:61-76) and a different pattern from /projects/[id]; params is a Promise here (page.tsx:24-25) but a plain object in [id]/page.tsx:10, indicating inconsistent Next conventions.
- **Verified evidence:** schemes/[id]/page.tsx:61-69 hand-built breadcrumb nav and :70-76 PageHeader with back='/projects/schemes' both render, so two wayfinding controls. params is `Promise<{id}>` with await at :24-25, while projects/[id]/page.tsx:10 uses plain `{ id: string }`; repo-wide 4 pages use Promise vs 107 plain (Next 14 convention per CLAUDE.md). Theme tag VALIDATION is wrong (no form here).
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/[id]/page.tsx`
- **Fix steps:**
  1. Delete the inline <nav aria-label='Breadcrumb'> (lines 61-69) or, if AutoBreadcrumb is mounted in the layout, rely on it; keep PageHeader back.
  2. Change signature to `{ params }: { params: { id: string } }` and drop `await` at :25, matching projects/[id]/page.tsx.
  3. Check the other 3 Promise-params pages and align them.
- **Acceptance:**
  - Page renders exactly one back/breadcrumb affordance.
  - Type-check passes and route still resolves /projects/schemes/<id>.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; params change is safe in Next 14 either way.

### GAP-PROJECTS-SCHEMES-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Linked project rows are not clickable and have no id (SchemeProjectRow has name, code, status, budget only; SchemeProjectsTable.tsx:11-16), so users cannot drill from a scheme to its projects; error state has no backHref (page.tsx:33).
- **Verified evidence:** Linked project rows are not links: page.tsx:52-57 maps only name/code/status/budget and SchemeProjectsTable.tsx:11-16,34-40 has no id, rowHref or identifyingColumnKey (DataTable supports both, DataTable.tsx:56,68). Overstated on back link: error state at page.tsx:32 does have PageHeader back='/projects/schemes'; only RefreshErrorState at :33 lacks backHref. Whether scheme.projects[] items carry an id cannot be seen (SchemeDetail type in packages/types absent).
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/[id]/page.tsx`, `apps/web/src/app/(app)/projects/schemes/[id]/SchemeProjectsTable.tsx`
- **Fix steps:**
  1. Confirm SchemeDetail.projects[] exposes project id (add to service response if not).
  2. Add `id: string` to SchemeProjectRow and map p.id at page.tsx:52.
  3. Pass rowHref={(r)=>`/projects/${r.id}`} and identifyingColumnKey='name' to DataTable.
  4. Add backHref='/projects/schemes' to RefreshErrorState at :33.
- **Acceptance:**
  - Clicking a linked project row navigates to /projects/<id>.
  - Error state shows a Back to Schemes action.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; navigation only.
- **Depends on:** GAP-PROJECTS-SCHEMES-DETAIL-01

### GAP-PROJECTS-SCHEMES-DETAIL-05  ·  LOW  ·  partly  ·  theme PII

- [~] **Status** (INTERIM W2-PROJECTS-1: loading.tsx already uses RouteSkeleton variant='detail'. Nodal officer display (public official name) needs a product/DPDP decision before masking. NEEDS OWNER DECISION: confirm whether public-office names are exempt from DPDP masking.)
- **W0 note:** partly fixed by #1869 — loading.tsx rebuilt to header/4 stat/details/table shape; remaining: no recorded decision on nodal-officer visibility (page.tsx still prints scheme.nodalOfficer to all viewers).
- **First-pass claim:** Nodal officer is a named person shown to all module users (DPDP low risk); loading is a single bare .skeleton block.
- **Verified evidence:** page.tsx:96-97 shows scheme.nodalOfficer (a person name) to every viewer; no masking. It is an official's designation-level contact, low DPDP risk, so Masked/audit reveal is disproportionate. Loading is one `.skeleton` block (schemes/[id]/loading.tsx:1-7), true.
- **Files to change:** `apps/web/src/app/(app)/projects/schemes/[id]/loading.tsx`
- **Fix steps:**
  1. Product decision: keep nodal officer visible (public-office holder) or show designation only.
  2. Rebuild loading.tsx with header, 4 stat placeholders, details card and table blocks matching page.tsx.
- **Acceptance:**
  - Skeleton shape matches loaded layout with no layout shift.
  - Decision recorded on nodal officer visibility.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /projects/utilization  —  `projects/utilization.html`

- **Source:** `apps/web/src/app/(app)/projects/utilization/page.tsx`
- **Design reference:** `redesign/projects/utilization.html`

### GAP-PROJECTS-UTILIZATION-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (closed by #2074, verified implementation present in codebase)
- **W0 note:** partly fixed by #1869 — fabricated Lucknow/Dehradun/... literals and typed tiles removed, page now shows a 'not available yet' EmptyState; remaining: no getProjectUtilization() loader or project-service aggregate endpoint, so the table/tiles are never populated from real data (rows is a hard-coded empty array).
- **First-pass claim:** Fabricated data presented as live: the page never fetches; eight rows and every stat tile are hard-coded literals (page.tsx:4-19) — including projects in other states — so a Government user reads sample numbers as the department’s own fund position.
- **Verified evidence:** utilization/page.tsx:4-13 hard-codes eight rows (Lucknow, Dehradun, Jaipur, Patna...) and :16-19 hard-codes the tile strings; no loader call; page is a non-async function. Linked from projects/page.tsx:16 as 'Fund utilization monitoring'. No utilization loader for projects exists in loaders.ts (only grants/finance UC ones), so backend availability is unverified.
- **Files to change:** `apps/web/src/app/(app)/projects/utilization/page.tsx`, `apps/web/src/app/(app)/projects/utilization/UtilizationTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `services/project-service (utilization endpoint)`
- **Fix steps:**
  1. Immediately remove the literals and render EmptyState 'Not available yet' (or a clearly labelled Sample banner) so no fabricated fund figures show.
  2. Add getProjectUtilization() in loaders.ts with a zod responseSchema, backed by a project-service endpoint aggregating allocated/released/utilised as minor-unit strings per project.
  3. Rebuild page as async server component with toResourceState, RefreshErrorState (backHref /projects) and EmptyState.
  4. Replace the string columns with cellType:'amount' columns (see -03).
- **Acceptance:**
  - Page with no data shows empty/unavailable state, never the sample projects.
  - With API fixture, rows and tiles reflect fixture only.
  - Grep confirms no 'Lucknow' literal remains.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Government users could read fake fund positions as real; remove literals first even before backend exists.

### GAP-PROJECTS-UTILIZATION-02  ·  HIGH  ·  confirmed  ·  theme MONEY (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile totals are typed strings, not derived from the rows (page.tsx:16-19): they match today only by hand, and “Utilization %” 66% is an unweighted mean of row percentages (utilised ÷ released) while the label implies utilised ÷ allocated (47% on these rows).
- **Verified evidence:** utilization/page.tsx:16-19 tiles are typed strings. Checked arithmetic: allocated sum 3359.00, utilised sum 1586.70 (matches), 1586.7/3359=47.2%; mean of row percentages (88,44,81,28,93,40,84,74)=66.5% shown as '66%'; utilised/released = 1586.7/1975 = 80%, so the described 'utilised over released' basis is not what the tile shows either. The 66% is an unweighted mean of row pcts and mismatches the label. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/projects/utilization/page.tsx`
- **Fix steps:**
  1. When rows come from the API (see -01), derive all tiles from rows using BigInt minor units.
  2. Compute Utilization % as sum(utilised)/sum(allocated) via a shared helper and formatPercent; state the basis in the label ('of allocated').
  3. Unspent = allocated - utilised computed, not typed.
- **Acceptance:**
  - Unit test: fixture rows produce tile values computed from the rows.
  - Utilization % equals weighted ratio, not mean of row percentages.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Finance KPI correctness.
- **Depends on:** GAP-PROJECTS-UTILIZATION-01

### GAP-PROJECTS-UTILIZATION-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Values are ₹-crore strings with two decimals (UtilizationTable.tsx:6-11), a fourth unit convention alongside paise (fund releases, project budgets) and rupees (scheme list), so sorting is text-based.
- **Verified evidence:** UtilizationTable.tsx:5-12 declares allocated/released/utilized/utilizationPct as strings; :21-24 headers '(₹ Cr)' with values like '345.00'; no cellType so DataTable cellValue returns String(value) (DataTable.tsx:141) and sorting on strings is textual, unless DataTable numeric-sorts (not checked). Unit is a third convention beside paise and rupees.
- **Files to change:** `apps/web/src/app/(app)/projects/utilization/UtilizationTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Type money fields as minor-unit strings and use cellType:'amount' (formatMoney), or add a formatCrore(minor) helper in formatters.ts for a crore display.
  2. Make utilizationPct a number and render with formatPercent.
  3. Verify DataTable sorts numeric values numerically; sort on raw values not rendered text.
- **Acceptance:**
  - Sort by Allocated puts 1850 Cr above 89 Cr.
  - Test formatCrore('345000000000') gives '₹345.00 Cr'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money display units.
- **Depends on:** GAP-PROJECTS-UTILIZATION-01

### GAP-PROJECTS-UTILIZATION-04  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** loading.tsx and error.tsx exist for a page that can never suspend or throw; there is no empty state (utilization/loading.tsx, error.tsx).
- **Verified evidence:** utilization/loading.tsx and error.tsx exist (error.tsx uses shared RouteError with backHref /projects, fine). The page is currently static so neither can trigger, and it has no empty state, true. Once wired to the API (-01) both become relevant; loading.tsx is a bare .skeleton block.
- **Files to change:** `apps/web/src/app/(app)/projects/utilization/loading.tsx`
- **Fix steps:**
  1. After -01, replace loading.tsx with stat + table placeholders matching page shape.
  2. Add EmptyState branch in page.tsx for zero rows.
- **Acceptance:**
  - Skeleton matches loaded layout.
  - Empty API result shows EmptyState.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PROJECTS-UTILIZATION-01


---
## /projects/wbs  —  `projects/wbs.html`

- **Source:** `apps/web/src/app/(app)/projects/wbs/page.tsx`
- **Design reference:** `redesign/projects/wbs.html`

### GAP-PROJECTS-WBS-01  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** ARIA tree without tree behaviour: every parent has aria-expanded="true" and each item aria-selected={false}, but there is no toggle, no keyboard navigation and no roving tabindex (WbsTree.tsx:31-34,76), so screen-reader users are told about controls that do not exist.
- **Verified evidence:** wbs/WbsTree.tsx:31-34 each <li role='treeitem'> has aria-selected={false} and aria-expanded=true for any node with children; :76 ul role='tree'. No buttons, no onKeyDown, no tabIndex, no collapse state anywhere in the file; tree is static. Also leaf-level role=treeitem items are not wrapped in role=group for children (children rendered as sibling <li>s).
- **Files to change:** `apps/web/src/app/(app)/projects/wbs/WbsTree.tsx`
- **Fix steps:**
  1. Simplest: drop role='tree'/'treeitem'/aria-selected/aria-expanded and render nested <ul> lists (native list semantics) with depth conveyed via aria-level or visible indentation.
  2. Or implement real tree: expanded state per node, toggle button, roving tabindex, arrow/Home/End keys, role='group' around children.
  3. Add non-emoji status text is already given by StatusPill; keep.
- **Acceptance:**
  - axe scan reports no aria-required-* issues on /projects/wbs.
  - If tree kept: ArrowRight/Left expands/collapses and aria-expanded reflects state (component test).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; a11y only.

### GAP-PROJECTS-WBS-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles do not reconcile: “Not Started” counts only pending/planned and “In Progress” two spellings (page.tsx:15-16); blocked, delayed or on-hold nodes (statuses used on the Tasks page) fall in no tile, and parents are counted with their children.
- **Verified evidence:** wbs/page.tsx:15-16 In Progress matches 'in progress' or 'in_progress'; Not Started matches 'pending' or 'planned'. Any other status (e.g. 'blocked' which the tasks page uses at [id]/tasks/page.tsx:14) matches no tile; 'delayed'/'on hold' are not seen in the tasks page so that part is unverified. Total counts every node including parents (nodes.length at :13). Status vocabulary from /api/v1/projects/wbs cannot be checked (service absent).
- **Files to change:** `apps/web/src/app/(app)/projects/wbs/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add a Blocked tile or an 'Other' remainder so tiles sum to Total.
  2. Normalise status once (lowercase, replace '_' with space) in a helper and share with StatusPill.
  3. Count leaf nodes only for progress tiles, or label Total 'All items'.
  4. Confirm status enum with the project-service task schema and type ProjectWbsNode.status accordingly.
- **Acceptance:**
  - Unit test: tile counts sum to total for a fixture including blocked and parent nodes.
  - in_progress and 'in progress' fall in the same tile.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; reporting counts.

### GAP-PROJECTS-WBS-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty state tells the user to “Create tasks in a project” although the tasks page offers no creation UI (tasks/page.tsx:56).
- **Verified evidence:** wbs/page.tsx:33 message says 'Create tasks in a project to see the WBS.' with a View Projects button. The tasks page is at projects/[id]/tasks/page.tsx (not projects/tasks) and its own empty state (line ~56) says 'Use the API to create tasks.'; directory contains only page.tsx, no creation form or action. So the instruction cannot be followed in UI.
- **Files to change:** `apps/web/src/app/(app)/projects/wbs/page.tsx`, `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Short term: reword WBS empty message to 'No work items yet.' without a create instruction.
  2. Product decision: build task creation (form + zod + POST, audit event) on projects/[id]/tasks, then restore the instruction.
- **Acceptance:**
  - Empty state text does not promise an unavailable action.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy; task creation is a separate M feature.

### GAP-PROJECTS-WBS-05  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1869, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** StatusPill maps “in progress” but not “in_progress” or “planned” (ds/StatusPill.tsx:6-38), so the same state shows different colours; loading is one bare .skeleton block.
- **Verified evidence:** ds/StatusPill.tsx:6-38 map has 'in progress' (warn) but not 'in_progress' or 'planned' or 'delayed'; lookup is status.toLowerCase() only (:53), so 'in_progress'/'planned' fall to 'info'. Label goes through humanizeStatus so text is fine. wbs/loading.tsx is a single .skeleton block.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/projects/wbs/loading.tsx`
- **Fix steps:**
  1. In StatusPill normalise: toLowerCase().replace(/_/g,' ') before lookup.
  2. Add 'planned': 'mut' (or warn) and any other API statuses confirmed by the task enum.
  3. Give wbs/loading.tsx stat and tree placeholders.
- **Acceptance:**
  - StatusPill test: 'in_progress' and 'in progress' yield the same class.
  - 'planned' renders a non-info variant.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component: colour changes appear app-wide for underscore statuses; visually check.


---
## Backend verification items (service code absent from snapshot)

### GAP-PROJECTS-HOME-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (INTERIM W2-PROJECTS-1: project-service absent — cannot verify canonical URL prefix. NEEDS OWNER DECISION: confirm /api/v1/project/* vs /api/v1/projects/* in gateway config.)
- **First-pass claim:** Two API prefixes coexist for one module: typed loaders call /api/v1/project/* (singular: dashboard, projects, milestones, schemes, fund-releases; loaders.ts:3465-3527) while sub-resource loaders and mutations use /api/v1/projects/* and /api/proxy/v1/projects/* (plural; loaders.ts:5133-5284, new/CreateProjectForm.tsx:82). Backend routing cannot be checked because project-service is absent from the snapshot.
- **Service:** `project-service`  ·  **Endpoint(s):** `['/api/v1/project/*', '/api/v1/projects/*', '/api/proxy/v1/projects/*']`
- **Question:** Does the gateway route both /project/* and /projects/* prefixes to project-service, or is only one canonical?
- **How to verify:** Open the gateway route table and project-service route registration; curl both prefixes for dashboard.
- **Test to add:** Given GET /api/v1/project/dashboard and /api/v1/projects/dashboard, then both return 200 or one returns 404 documenting canonical prefix.
- **Impact if wrong:** One set of pages silently returns empty data (fallback []).
- **Web change if wrong:** Change loaders.ts:3465-3527 to the canonical plural prefix.

### GAP-PROJECTS-BENEFICIARIES-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (INTERIM W2-PROJECTS-1: project-service absent — disbursement unit/schema unverifiable. NEEDS OWNER DECISION.)
- **First-pass claim:** Disbursement is an unformatted string with the ₹ unit only in the header and no paise/lakh formatting (BeneficiariesTable.tsx:13,27); raw beneficiary ids are the first column; no schema validates the response (loaders.ts:5150-5156). Backend not in snapshot.
- **Service:** `project-service`  ·  **Endpoint(s):** `['GET /api/v1/projects/beneficiaries']`
- **Question:** Does the response give disbursement as integer paise (or documented unit), a beneficiary name, and a schema-validated shape?
- **How to verify:** Open the beneficiaries handler and response schema; curl and inspect types and units.
- **Test to add:** Given a beneficiary with 1,25,000 rupees, when listed, then disbursementMinor=12500000 and name is present.
- **Impact if wrong:** Wrong amounts displayed to finance users.
- **Web change if wrong:** Add zod schema in the loader, format via formatINR and show name column.

### GAP-PROJECTS-DELAY-ANALYSIS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (INTERIM W2-PROJECTS-1: project-service absent — date format and delayDays unverifiable. NEEDS OWNER DECISION.)
- **First-pass claim:** Deadlines are strings (not ISO dates) and delayDays a number computed elsewhere; sorting the deadline columns sorts text (DelayAnalysisTable.tsx:7-10). No response schema (loaders.ts:5200-5205); backend not in snapshot.
- **Service:** `project-service`  ·  **Endpoint(s):** `['GET /api/v1/projects/delay-analysis']`
- **Question:** Are planned/forecast deadlines ISO 8601 dates and delayDays computed server-side consistently?
- **How to verify:** Open the delay handler; curl and check date formats and delayDays vs dates.
- **Test to add:** Given deadline 2026-03-01 and forecast 2026-03-11, when listed, then delayDays=10 and dates are ISO.
- **Impact if wrong:** Wrong sort order and wrong delays.
- **Web change if wrong:** Parse ISO dates for sorting and add a response schema.

### GAP-PROJECTS-DPR-TRACKING-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (INTERIM W2-PROJECTS-1: project-service absent — estimatedCost unit unverifiable. NEEDS OWNER DECISION: confirm paise vs crore.)
- **First-pass claim:** Estimated cost is a free string in ₹ crore (DprTrackingTable.tsx:11,25) while project budgets are paise elsewhere and scheme lists are rupees; three units in one module. Backend not in snapshot to confirm.
- **Service:** `project-service`  ·  **Endpoint(s):** `['GET /api/v1/projects/dprs']`
- **Question:** In which unit is estimatedCost returned (paise, rupees or crore) and is it numeric?
- **How to verify:** Open the DPR handler/schema; curl and compare with project budget units.
- **Test to add:** Given a DPR of 12.5 crore, when listed, then estimatedCostMinor=12500000000 (paise).
- **Impact if wrong:** Order-of-magnitude errors in cost display.
- **Web change if wrong:** Consume a numeric minor-unit field and format with the shared currency formatter.

### GAP-PROJECTS-NEW-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (INTERIM W2-PROJECTS-1: project-service absent — POST role-check/audit unverifiable. NEEDS OWNER DECISION.)
- **First-pass claim:** Mutation goes straight from the browser to /api/proxy/v1/projects with no UI role gate; whether it is audited and role-checked cannot be verified because project-service is not in the snapshot (CreateProjectForm.tsx:82).
- **Service:** `project-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/projects']`
- **Question:** Does project creation require a role such as project_manager, validate input with zod and emit audit?
- **How to verify:** Open the POST handler; call with a viewer token expecting 403 and check audit emit.
- **Test to add:** Given a viewer token, when POST /projects, then 403 and no row.
- **Impact if wrong:** Unauthorised projects and budgets.
- **Web change if wrong:** Hide the New action by role.

### GAP-PROJECTS-WBS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (INTERIM W2-PROJECTS-1: project-service absent — WBS node projectId unverifiable. NEEDS OWNER DECISION.)
- **First-pass claim:** Portfolio-wide endpoint /api/v1/projects/wbs takes no project id while tasks are per project (/projects/{id}/tasks); the node → project relation is not shown, so a node cannot be traced to its project (WbsTree.tsx:27-56). Backend not in snapshot.
- **Service:** `project-service`  ·  **Endpoint(s):** `['GET /api/v1/projects/wbs']`
- **Question:** Does each WBS node include projectId/projectCode and does the endpoint accept a projectId filter?
- **How to verify:** Open the WBS handler and response; curl and check node fields.
- **Test to add:** Given nodes from two projects, when listed, then each node has projectId.
- **Impact if wrong:** Cannot trace tasks to projects.
- **Web change if wrong:** Add project column/link or pass projectId filter.
