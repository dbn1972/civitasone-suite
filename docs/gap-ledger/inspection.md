# Detailed gap file — module `inspection`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 23



---
## /inspection  —  `inspection/home.html`

- **Source:** `apps/web/src/app/(app)/inspection/page.tsx`
- **Design reference:** `redesign/inspection/home.html`

### GAP-INSPECTION-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as good news: on source 'error' the badge shows but StatCards still print 0 for inspections/assignments/CAPA and there is no RefreshErrorState/retry (page.tsx:20-36).
- **Verified evidence:** inspection/page.tsx:20-24 computes source='error' if any of the 3 loaders errored; :31 renders only <DataSourceBadge>; :33-35 still render String(x.data.length) which is 0 because fetchJson returns empty [] on failure (apiClient.ts:119). No RefreshErrorState/retry (it is already used in inspection/inspections/page.tsx:24).
- **Files to change:** `apps/web/src/app/(app)/inspection/page.tsx`
- **Fix steps:**
  1. Use toResourceState()/per-loader source (useResource.ts) to know which loader failed.
  2. When any loader errored, render <RefreshErrorState error={toHumanError('load',{area:'inspection summary'})} backHref='/dashboard'/> instead of/in addition to the badge.
  3. Pass value='—' to the StatCard of each errored loader instead of String(data.length).
  4. Keep the link tiles visible so the user can still navigate.
- **Acceptance:**
  - Component/RSC test: mock getInspections to return {data:[],source:'error'}; card shows '—' and Retry button, not '0'.
  - Manual: stop inspection-service, load /inspection; Retry calls router.refresh and recovers when service is back.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.
- **Depends on:** RefreshErrorState

### GAP-INSPECTION-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Counts are data.length of a pageSize=50 request, so the cards silently cap at 50 and are not totals (loaders.ts:16-33, page.tsx:33-35).
- **Verified evidence:** loaders.ts:16,24,32 request ?pageSize=50 and asRows() (loaders.ts:7-13) keeps only the array, discarding any envelope total/meta; page.tsx:33-35 prints data.length so any tenant with >50 rows shows 50. Whether inspection-service returns a total cannot be seen (service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/inspection/_data/loaders.ts`, `apps/web/src/app/(app)/inspection/page.tsx`
- **Fix steps:**
  1. Confirm with inspection-service whether list responses carry meta.total (or add a count/summary endpoint).
  2. Change loaders to return {rows,total} (mapResponse reading payload.meta.total) or add getInspectionCounts().
  3. Show total on the StatCards; if only capped rows are known, render '50+' when length===pageSize.
  4. Add server-side pagination/filter params to the list pages (see INSPECTIONS-05).
- **Acceptance:**
  - Unit test: payload with 50 rows and total=137 -> card shows 137.
  - Fallback test: 50 rows, no total -> card shows '50+'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; misreported counts only.
- **Depends on:** GAP-INSPECTION-INSPECTIONS-05

### GAP-INSPECTION-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle leaks implementation ('wired to inspection-service APIs'); not user-facing language (page.tsx:29).
- **Verified evidence:** page.tsx:29 subtitle reads 'Plans, assignments, execution and CAPA — wired to inspection-service APIs.' Implementation wording shown to users.
- **Files to change:** `apps/web/src/app/(app)/inspection/page.tsx`
- **Fix steps:**
  1. Replace subtitle with user copy e.g. 'Plans, assignments, inspections and corrective actions.'
  2. Move string to the next-intl messages file if the module uses it.
- **Acceptance:**
  - Page subtitle contains no 'API', 'service' or 'wired'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-INSPECTION-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx is a bare text line with no PageHeader or skeleton, unlike sibling modules (loading.tsx:1-3).
- **Verified evidence:** inspection/loading.tsx:1-3 (file is 3 lines) returns <div className='wrap'><p>Loading inspection…</p></div>; no PageHeader or skeleton, while page renders header + StatGrid + tiles. Inspection has no error.tsx/not-found.tsx of its own either (ls shows only layout, loading, page).
- **Files to change:** `apps/web/src/app/(app)/inspection/loading.tsx`, `apps/web/src/app/(app)/inspection/error.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx with a title placeholder, 3 skeleton StatCards and 3 skeleton tiles, reusing the ds skeleton components used by other modules (copy install/loading.tsx shape but with DS tokens).
  2. Add error.tsx using RouteError (as install/error.tsx does) with backHref='/dashboard'.
- **Acceptance:**
  - Throttle network: skeleton shape matches loaded layout with no layout jump.
  - Throw in the page: RouteError with retry shows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-INSPECTION-HOME-05  ·  LOW  ·  partly  ·  theme DSDRIFT (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub has inline styles and emoji icons with hard-coded iconBg hex (page.tsx:33-36,40); no help link or module breadcrumb, unlike ModuleHub.
- **Verified evidence:** Inline styles are real (page.tsx:37-43 grid/link/h3/p styles); hard-coded iconBg hex at :33-35 and emoji icons are real. The 'no help link or module breadcrumb, unlike ModuleHub' claim is true: ModuleHub (_components/ModuleHub.tsx) supplies help slug and LinkTiles; this hub uses ad-hoc Link+Card. Theme FABRICATED is wrong (nothing fabricated).
- **Files to change:** `apps/web/src/app/(app)/inspection/page.tsx`
- **Fix steps:**
  1. Replace the hand-built tile grid with <ModuleHub> (or LinkTiles) with help='inspection'.
  2. Drop iconBg hex; use StatCard default/token variants.
  3. Move inline styles into DS classes.
- **Acceptance:**
  - Hub renders via ModuleHub; no inline style attributes remain in page.tsx.
  - Help link resolves.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-INSPECTION-HOME-01


---
## /inspection/assignments  —  `inspection/assignments.html`

- **Source:** `apps/web/src/app/(app)/inspection/assignments/page.tsx`
- **Design reference:** `redesign/inspection/assignments.html`

### GAP-INSPECTION-ASSIGNMENTS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by ##1934, verified on main 9c5e9e9e9)
- **First-pass claim:** Assigning an inspector requires typing four raw UUIDs (inspection, inspector, type, entity) with no lookup or validation — practically unusable for field officers (AssignmentActions.tsx form, placeholder 'UUID').
- **Verified evidence:** AssignmentActions.tsx:102-132 has four text inputs (Inspection ID, Inspector ID, Type ID, Entity ID) with placeholder 'UUID'; values trimmed and POSTed to /api/proxy/v1/inspection/assignments (79-85). No lookup, no client UUID validation. Lookup endpoints for inspections, inspectors, types, entities cannot be verified (inspection-service absent); getInspectionAssignments/Capas are the only inspection loaders seen (inspection/_data/loaders.ts).
- **Files to change:** `apps/web/src/app/(app)/inspection/assignments/AssignmentActions.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`, `apps/web/src/app/(app)/inspection/_data/loaders.ts`
- **Fix steps:**
  1. Create shared ds/EntityPicker (same as helpdesk assign finding).
  2. Add loaders for inspections, inspection types and inspectors (needs backend list endpoints - confirm).
  3. Replace the four inputs with pickers showing names; send ids in the body.
  4. Add a zod schema (z.string().uuid()) for the body before fetch.
- **Acceptance:**
  - Test: create form cannot submit until all four pickers have a selection.
  - POST body contains the selected UUIDs.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Assigning inspections to the wrong inspector or entity.
- **Depends on:** EntityPicker (new shared component), GAP-INSPECTION-ASSIGNMENTS-02

### GAP-INSPECTION-ASSIGNMENTS-02  ·  HIGH  ·  partly  ·  theme VALIDATION (was FAILMASK)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Submit sends trimmed empty strings when fields are blank (no required/zod check client-side); failure surfaces only via a generic useFormError message (AssignmentActions.tsx createAssignment).
- **Verified evidence:** AssignmentActions.tsx:71-97: createAssignment posts trimmed values without any emptiness or UUID check (button at 142 is never disabled for blank fields; inputs lack required and there is no form element); error path calls formError.fromException('save') (93), which is a generic message and loses the server's field errors (the fromResponse message is thrown then discarded in catch). Not a fetch-failure masking issue (page.tsx:24-25 does show RefreshErrorState on list failure).
- **Files to change:** `apps/web/src/app/(app)/inspection/assignments/AssignmentActions.tsx`
- **Fix steps:**
  1. Wrap inputs in a <form onSubmit> and add zod schema validating four uuids plus date.
  2. Show per-field errors (aria-invalid, aria-describedby) and block submit on failure.
  3. In the catch, display e.message (from formError.fromResponse) rather than discarding it.
- **Acceptance:**
  - Test: blank submit makes no fetch call and shows field errors.
  - Test: 400 response shows the server message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-INSPECTION-ASSIGNMENTS-01

### GAP-INSPECTION-ASSIGNMENTS-03  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Inputs are wrapped in bare <label> with no id/for and no field errors; the Scheduled date defaults to today via toISOString (UTC) so it can be yesterday in IST (AssignmentActions.tsx useState init).
- **Verified evidence:** AssignmentActions.tsx:102-141 wrap each input inside a <label> (implicit association, valid for accessibility, so 'no id/for' overstated); there are no field-level errors. Scheduled date default at line 68 is new Date().toISOString().slice(0,10) which is UTC; between 00:00 and 05:30 IST it returns the previous date. Theme DATEFMT is a partial fit; core bug is UTC default.
- **Files to change:** `apps/web/src/app/(app)/inspection/assignments/AssignmentActions.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add todayIST() helper in lib/formatters.ts using Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()).
  2. Use it in the useState initializer at line 68.
  3. Add min={todayIST()} to the date input if past dates are not allowed (confirm).
- **Acceptance:**
  - Unit test: todayIST at 2026-03-01T20:00Z returns 2026-03-02.
  - Form default matches IST date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-INSPECTION-ASSIGNMENTS-04  ·  MEDIUM  ·  partly  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Summary reads title/name/findingCode/entityId — none of which is evidently an assignment attribute, so rows may all show '—' (page.tsx:48); no inspector or scheduled-date column.
- **Verified evidence:** assignments/page.tsx:43 (not 48) renders row.title ?? name ?? findingCode ?? entityId ?? '—'; rows are untyped Record<string,unknown> (inspection/_data/loaders.ts:23-28, asRows). The real assignment row fields (inspectorId, scheduledDate, etc.) cannot be verified since inspection-service is absent; the POST body (AssignmentActions.tsx:79-85) implies inspectionId, inspectorId, inspectionTypeId, entityId, scheduledDate exist. Table has only ID, Status, Summary columns (33-35), no inspector/date column. Comparable CAPA page had a similar guess fixed with 'description'.
- **Files to change:** `apps/web/src/app/(app)/inspection/assignments/page.tsx`, `apps/web/src/app/(app)/inspection/_data/loaders.ts`
- **Fix steps:**
  1. Inspect the real GET /api/v1/inspection/assignments response (inspection-service assignments schema) and type the row.
  2. Replace Summary with Inspection, Inspector, Entity and Scheduled columns using the typed fields.
  3. Format scheduledDate with formatIndianDate.
  4. Show names via lookups once available; fall back to short id.
- **Acceptance:**
  - Row test with sample payload shows inspector and scheduled date.
  - No row shows '—' for Summary when data exists.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong field mapping displays blanks, hiding who is assigned.
- **Depends on:** GAP-INSPECTION-ASSIGNMENTS-01

### GAP-INSPECTION-ASSIGNMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** 202 'queued' message with no row appearing until async consumer runs; no way to edit or cancel an assignment (no Action column).
- **Verified evidence:** AssignmentActions.tsx:90 sets 'Assignment creation accepted (queued).' and router.refresh() (91); the list (page.tsx:29-48) has no Action column, only ID/Status/Summary, so no edit/cancel. Async consumer delay is implied by the 202 handling (87) but service is absent, so exact latency cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/inspection/assignments/page.tsx`, `apps/web/src/app/(app)/inspection/assignments/AssignmentActions.tsx`
- **Fix steps:**
  1. Change message to explain 'It will appear in the list shortly - refresh in a few seconds' and add a Refresh button (router.refresh()).
  2. Optionally poll the list a few times after a 202.
  3. Add an Action column (cancel/reschedule) only if the API provides such endpoints (confirm with backend).
- **Acceptance:**
  - After create, user sees pending-processing note and a refresh control.
  - Cancel appears only when the endpoint is confirmed.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Cancel/edit affects field schedules; needs audit and confirm.

### GAP-INSPECTION-ASSIGNMENTS-06  ·  LOW  ·  partly  ·  theme RBAC (was DEADROUTE)

- [x] **Status** (W2 PQ: closed by #w2/inspection-part-1 commit f5d30e0f9)
- **W0 note:** partly fixed by ##1928 — Done: create form hidden when list errored. Remains: no client role/permission gate (viewer still sees form; server RBAC authoritative)
- **First-pass claim:** Create form remains visible on error state and for read-only viewers (page.tsx:23-25).
- **Verified evidence:** assignments/page.tsx:23 renders <AssignmentActions /> unconditionally, before the errored/empty branches (24-49), so the create form is visible when the list load failed. No role check exists in the component; whether read-only viewers exist or are refused server-side cannot be verified. Not a dead route.
- **Files to change:** `apps/web/src/app/(app)/inspection/assignments/page.tsx`
- **Fix steps:**
  1. Render <AssignmentActions/> only when !errored (or disable it with a note).
  2. Gate by the app's permission helper for inspection.assignment.create (identify existing helper; cannot verify name).
- **Acceptance:**
  - Test: errored list hides the create form.
  - Viewer role does not see the form.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /inspection/capa  —  `inspection/capa.html`

- **Source:** `apps/web/src/app/(app)/inspection/capa/page.tsx`
- **Design reference:** `redesign/inspection/capa.html`

### GAP-INSPECTION-CAPA-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Complete sends a hard-coded evidence stub {source:'inspection-hub', note:'Marked complete from inspection hub'} — closure is recorded with no real evidence, remarks or attachment, undermining the audit trail (CapaActions.tsx:complete).
- **Verified evidence:** CapaActions.tsx:286-292 complete() posts evidenceOfClosure: [{ source:'inspection-hub', note:'Marked complete from inspection hub' }] with no user input; button at 335-339 fires it directly. Server-side validation/audit of evidence cannot be verified (inspection-service absent).
- **Files to change:** `apps/web/src/app/(app)/inspection/capa/CapaActions.tsx`
- **Fix steps:**
  1. Open a dialog (ds/ConfirmDialog with requireReason, or a small form) on Complete asking for closure remarks and optional attachment reference.
  2. Send evidenceOfClosure as [{ source:'user', note: remarks, ...attachment }] per API schema (confirm shape).
  3. Disable submit until remarks are non-empty.
  4. Keep a fallback only if API allows no evidence (unlikely).
- **Acceptance:**
  - Test: Complete opens dialog; POST body note equals typed remarks.
  - Empty remarks blocks the request.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Closure of corrective actions with fake evidence undermines audit trail.
- **Depends on:** GAP-INSPECTION-CAPA-03

### GAP-INSPECTION-CAPA-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Verify posts effectivenessVerified:true on a single click with no confirmation, checklist or verifier remarks — a sign-off action with no friction (CapaActions.tsx:verify).
- **Verified evidence:** CapaActions.tsx:305-313 verify() POSTs { effectivenessVerified: true } on a single button click (340-344); no ConfirmDialog, remarks or checklist. Maker-checker enforcement (completer != verifier) and audit cannot be verified server-side (inspection-service absent).
- **Files to change:** `apps/web/src/app/(app)/inspection/capa/CapaActions.tsx`
- **Fix steps:**
  1. Wrap Verify in ds/ConfirmDialog with requireReason and reasonLabel 'Verification remarks'.
  2. Offer Verified / Not effective choice instead of hard-coded true, if API accepts false (confirm).
  3. Send remarks in the body if the schema supports it.
  4. Confirm the server rejects verify by the same user who completed (backend).
- **Acceptance:**
  - Test: click Verify shows dialog; no fetch until confirmed with reason.
  - Cancel makes no request.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Sign-off step with regulatory weight; must be audited.

### GAP-INSPECTION-CAPA-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Errors are shown as raw response text ((await res.text()) || 'Start failed') instead of toHumanError copy, unlike AssignmentActions/InspectionActions (CapaActions.tsx:52,83,101).
- **Verified evidence:** CapaActions.tsx:270, 294, 316 throw new Error((await res.text()) || 'Start failed' etc.), and the catch (275, 299, 321) shows e.message directly, so raw JSON or HTML bodies can reach the user. AssignmentActions.tsx uses useFormError('assignment').fromResponse. The line refs 52,83,101 were wrong (actual 270,294,316).
- **Files to change:** `apps/web/src/app/(app)/inspection/capa/CapaActions.tsx`
- **Fix steps:**
  1. Import useFormError and call const formError = useFormError('capa') in CapaRowAction.
  2. Replace res.text() with (await formError.fromResponse(res,'save')).message in start/complete/verify.
  3. Use formError.fromException('save').message in catch for non-Error cases.
- **Acceptance:**
  - Test: 500 with JSON body shows friendly copy, not raw JSON.
  - Test: 403 shows permission copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-INSPECTION-CAPA-04  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W2 PQ: closed by #w2/inspection-part-1 commit e54172fda)
- **W0 note:** partly fixed by ##1928 — Done: honest 'status will update shortly' copy. Remains: no post-202 refresh/compare to flag an unapplied or failed command
- **First-pass claim:** Every action returns 202 'queued'; an INVALID_TRANSITION at the async consumer is never shown to the user, as the code comment itself admits (CapaActions.tsx:16-22).
- **Verified evidence:** CapaActions.tsx:237-243 comment explains the earlier bug (Complete offered for open) and that buttons now map to legal transitions (244-246); all three actions accept 202 and show '(queued)' (272,296,318) then router.refresh(). The comment describes a fixed case, not an admission of current silence, but the residual issue holds: a stale-status race or other consumer failure after the 202 is never surfaced. Whether the service offers a status/command result endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/inspection/capa/CapaActions.tsx`
- **Fix steps:**
  1. After a 202, poll/refresh the row (router.refresh) after a delay and compare status; if unchanged, show 'Not applied yet - check again or refresh'.
  2. Reword messages: 'Request accepted; status will update shortly'.
  3. If the API exposes a command status or failure event, surface it (backend).
- **Acceptance:**
  - Test: unchanged status after refresh shows a 'may have failed' note.
  - Success path clears the message once status changes.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Users may retry and duplicate actions if state is unclear.

### GAP-INSPECTION-CAPA-05  ·  MEDIUM  ·  partly  ·  theme WIRING (was UUID)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw truncated UUID is the only identifier; no due date, owner, or severity column, so 'overdue' rows cannot be prioritised (page.tsx:41).
- **Verified evidence:** capa/page.tsx:199 shows String(row.id).slice(0,8)+'…' as ID (truncated UUID), and a Summary column already exists (line 206, description first, per schema note in 201-205), so 'only identifier' is overstated. There is no due date, owner or severity column (187-194). Whether those fields exist in the row payload cannot be verified (inspection-service absent; rows are untyped, inspection/_data/loaders.ts).
- **Files to change:** `apps/web/src/app/(app)/inspection/capa/page.tsx`, `apps/web/src/app/(app)/inspection/_data/loaders.ts`
- **Fix steps:**
  1. Check the CAPA row shape (corrective_actions schema in inspection-service) for dueDate, owner/assignee, severity.
  2. Add Due, Owner, Severity columns, format due with formatIndianDate and flag overdue with StatusPill.
  3. Sort by due date ascending so overdue rows lead.
  4. Show a human reference (capaNo) instead of a truncated UUID if available.
- **Acceptance:**
  - Row with past dueDate shows overdue pill.
  - Table sorted by due date.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-INSPECTION-CAPA-06  ·  LOW  ·  confirmed  ·  theme DEADCODE (was PII)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** CapaActions (list variant, CapaActions.tsx:135-152) exports an alternate id+status list that the page does not use — dead code.
- **Verified evidence:** CapaActions.tsx:360-378 exports CapaActions ({capas}) list variant; a repo-wide grep in apps/web/src finds only CapaRowAction imported (capa/page.tsx:4) and no test or other use of CapaActions. Also exports type CapaRow used only by it. Not PII-related.
- **Files to change:** `apps/web/src/app/(app)/inspection/capa/CapaActions.tsx`
- **Fix steps:**
  1. Delete the CapaActions component and unused CapaRow type (lines ~224-227 and 360-378).
  2. Run tsc and lint to confirm no references.
- **Acceptance:**
  - grep for CapaActions( returns nothing; build passes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /inspection/inspections  —  `inspection/inspections.html`

- **Source:** `apps/web/src/app/(app)/inspection/inspections/page.tsx`
- **Design reference:** `redesign/inspection/inspections.html`

### GAP-INSPECTION-INSPECTIONS-01  ·  HIGH  ·  confirmed  ·  theme IDENTIFIER (was UUID)

- [x] **Status** (W2 PQ: closed by #w2/inspection-part-1 commit b78be2041)
- **W0 note:** partly fixed by ##1928 — Done: typed row, Scheduled date column, Entity col. Remains: Inspection and Entity still shown as truncated UUID prefix; no inspector column, no detail link/number
- **First-pass claim:** Users see a truncated raw UUID ('9f3c1a72…') as the only identifier and Summary falls back through title/name/findingCode/entityId to '—' — no inspection number, site, inspector or date columns (page.tsx:41,48).
- **Verified evidence:** inspections/page.tsx:41 shows String(row.id).slice(0,8)+'…'; columns are only ID, Status, Summary, Action (:29-34); Summary is String(row.title ?? row.name ?? row.findingCode ?? row.entityId ?? '—') at :48. No number, site, inspector, date. Actual field names in inspection-service are not visible (service absent) so which columns are available is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/inspection/inspections/page.tsx`, `apps/web/src/app/(app)/inspection/_data/loaders.ts`
- **Fix steps:**
  1. Confirm from inspection-service execution schema which human fields exist (number/code, entity/site name, inspector, scheduledAt).
  2. Define a zod schema + typed InspectionRow in loaders.ts and parse rows.
  3. Render columns: Inspection no., Site/entity, Inspector, Scheduled date (formatIndianDate), Status; link the number to a detail route.
  4. Keep id only as the link target and row key; if a name needs another service, resolve it via the BFF, not in the browser.
- **Acceptance:**
  - Row without title still shows inspection number and site, never a bare UUID prefix.
  - Column headers include date/inspector.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-INSPECTION-INSPECTIONS-03

### GAP-INSPECTION-INSPECTIONS-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #w2/inspection-part-1 commit 93f6934f2)
- **W0 note:** partly fixed by ##1928 — Done: UserFacingError shows specific server message; copy 'Request sent - status will update shortly'. Remains: no polling/disable of row action after 202
- **First-pass claim:** Successful action toasts say 'accepted (queued)' because the API returns 202; the row is not updated until the async consumer runs, and a server-side INVALID_TRANSITION is never surfaced (InspectionActions.tsx callApi/run, router.refresh() immediately).
- **Verified evidence:** InspectionActions.tsx: callApi (:88-96) accepts 202 as success; run() (:98-113) sets 'X accepted (queued).' at :105 then router.refresh() at :106, so the row is unchanged until the consumer runs; same in Finalize onSuccess (:130-131). Overstated on INVALID_TRANSITION: synchronous 4xx do throw via formError.fromResponse (:93), but run()'s catch {} (:107-108) discards it and shows a generic formError.fromException message, and asynchronous consumer failures are never surfaced.
- **Files to change:** `apps/web/src/app/(app)/inspection/inspections/InspectionActions.tsx`
- **Fix steps:**
  1. Catch (e) in run() and display e.message (already built from fromResponse) instead of fromException.
  2. Change success copy to a user phrase ('Request sent; status will update shortly').
  3. After 202, poll router.refresh() a few times (or use SSE via useSSEConnection) until row.state changes or timeout, then show 'still processing'.
  4. Disable the row action while pending state is unresolved.
- **Acceptance:**
  - Test: server returns 409 INVALID_TRANSITION -> specific message shown in role=alert.
  - Test: 202 -> pending message, then state change replaces it after refresh.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; prevents users repeating actions.
- **Depends on:** GAP-INSPECTION-INSPECTIONS-04

### GAP-INSPECTION-INSPECTIONS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Status column was silently wrong (row.status vs row.state) until fixed; the page reads an untyped Record so a schema rename fails silent as '—' (page.tsx:43-47).
- **Verified evidence:** The status bug is already fixed: page.tsx:42-47 comment explains it and :47,:52 read row.state. Remaining risk is real: getInspections returns Record<string,unknown>[] (loaders.ts:15) with no schema, and every field is String(x ?? '—'), so a rename fails silently. Also InspectionActions.tsx exports InspectionRow{status}, a different shape.
- **Files to change:** `apps/web/src/app/(app)/inspection/_data/loaders.ts`, `apps/web/src/app/(app)/inspection/inspections/page.tsx`
- **Fix steps:**
  1. Add InspectionListItemSchema (zod) and pass responseSchema to fetchJson as getInstallSteps does (loaders.ts:4345).
  2. Type the page rows from the schema; remove String() coercions.
  3. Surface a schema-mismatch as source:'error' so RefreshErrorState shows.
- **Acceptance:**
  - Test: row missing 'state' fails schema and page shows error state rather than '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; schema too strict could blank the list, verify against real payload.
- **Depends on:** GAP-INSPECTION-INSPECTIONS-01

### GAP-INSPECTION-INSPECTIONS-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Start/Complete/Resume/Submit review fire on one click with hard-coded remarks 'Started from inspection hub' etc.; inspector cannot enter remarks (InspectionActions.tsx:actionForStatus).
- **Verified evidence:** actionForStatus (InspectionActions.tsx:31-62) fires Start/Complete/Resume/Submit review on one click with fixed remarks ('Started from inspection hub' etc.) via run() (:98-113) using a plain <button>; no remarks input. Overstated: Finalize (:58 irreversible) already uses ActionButton with ConfirmDialog (:122-135). Maker/checker and audit cannot be verified client-side (service absent; audit events would be server-side).
- **Files to change:** `apps/web/src/app/(app)/inspection/inspections/InspectionActions.tsx`
- **Fix steps:**
  1. Wrap each transition in ActionButton/ConfirmDialog with an optional remarks textarea (required for Complete and Submit review).
  2. Send the entered remarks in body.remarks; drop the hard-coded strings.
  3. Ask backend to reject same-user submit/finalize and emit the audit event; surface that 403 message.
- **Acceptance:**
  - Test: Complete opens dialog; confirm without remarks blocked; request body carries typed remarks.
  - Backend test: submitter cannot finalize own inspection.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; workflow inspection records affect compliance.
- **Depends on:** GAP-INSPECTION-INSPECTIONS-02

### GAP-INSPECTION-INSPECTIONS-05  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Table is a plain .tbl without mobile card transform, no search/filter/pagination although pageSize=50 (page.tsx:29-58, loaders.ts:16).
- **Verified evidence:** page.tsx:29-58 renders a plain <table className='tbl'> of all rows from a pageSize=50 fetch (loaders.ts:16), no search, filter, sort or pagination; no card transform is visible in this file (whether .tbl transforms via global CSS not checked, treat as unverified). No sibling ModuleListPage/ModuleListTable used although they exist in _components.
- **Files to change:** `apps/web/src/app/(app)/inspection/inspections/page.tsx`, `apps/web/src/app/(app)/inspection/_data/loaders.ts`
- **Fix steps:**
  1. Read searchParams (page, q, status) in page.tsx and pass to getInspections as query params.
  2. Render via ModuleListTable/ModuleListPage with pagination and status filter, or add pager component.
  3. Ensure mobile card layout (use the table's responsive variant).
- **Acceptance:**
  - Test: ?page=2 requests offset page and shows next rows.
  - Manual at 375px: rows readable without horizontal scroll.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-INSPECTION-HOME-02

### GAP-INSPECTION-INSPECTIONS-06  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13: closed by ##1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty copy 'No inspections returned from the API' is developer language; no CTA to create/assign (page.tsx:26).
- **Verified evidence:** page.tsx:26 EmptyState title 'No records', message 'No inspections returned from the API.'; no action prop/CTA; strings hard-coded (no next-intl). Also 'Action' is the only column header text for buttons.
- **Files to change:** `apps/web/src/app/(app)/inspection/inspections/page.tsx`
- **Fix steps:**
  1. Change copy to 'No inspections yet. Inspections appear here once an assignment is scheduled.'
  2. Add CTA link to /inspection/assignments through EmptyState action prop.
  3. Move strings to the i18n messages.
- **Acceptance:**
  - Empty list shows friendly copy and CTA; no mention of API.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
