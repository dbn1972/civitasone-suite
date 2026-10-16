# Detailed gap file — module `change`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 19, BACKEND-VERIFY 4



---
## /change  —  `change/home.html`

- **Source:** `apps/web/src/app/(app)/change/page.tsx`
- **Design reference:** `redesign/change/home.html`

### GAP-CHANGE-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was CONFIRM)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Raise dialog is a hand-rolled fixed overlay: no focus trap or focus return, only Escape closes it (NewChangeButton.tsx:28-34,75-76); not the DS ConfirmDialog.
- **Verified evidence:** NewChangeButton.tsx:75-76 renders a hand-rolled position:fixed overlay with role=dialog aria-modal; the only key handling is Escape (:27-34). No initial focus move, no Tab trap, no focus return to the '+ Raise change' button, no overlay-click close. ds/ConfirmDialog has all of that but is confirmation-specific (has reason field, not a general form modal).
- **Files to change:** `apps/web/src/app/_components/ds/ (new Modal/Dialog extracted from ConfirmDialog)`, `apps/web/src/app/(app)/change/NewChangeButton.tsx`, `apps/web/src/app/_components/ds/ConfirmDialog.tsx`
- **Fix steps:**
  1. Extract ConfirmDialog's portal, focus trap, ESC and focus-return logic into a reusable ds <Modal> (children + title); refactor ConfirmDialog to use it.
  2. Rebuild NewChangeButton's overlay with <Modal>; keep close() busy guard.
  3. Focus the Title input on open.
- **Acceptance:**
  - Tab/Shift+Tab cycle inside dialog; ESC closes; focus returns to trigger.
  - Screen reader announces dialog label.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Regression risk for ConfirmDialog consumers if refactored; add tests first.

### GAP-CHANGE-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Awaiting CAB is a count only — no filter/tab to show just the submitted queue that a CAB member must work (page.tsx:22-26).
- **Verified evidence:** page.tsx:24 computes awaitingCab count and :49 shows it in a non-link StatCard; the DataTable (:63-79) has only free-text filter, no status filter, so the CAB queue cannot be isolated. Row status text is present, so text filter 'submitted' works but is not discoverable.
- **Files to change:** `apps/web/src/app/(app)/change/page.tsx`
- **Fix steps:**
  1. Read searchParams.status in page.tsx; filter rows before mapping.
  2. Add ds <Segmented>/<Tabs> (All / Awaiting CAB / Scheduled / Open) above the table with counts.
  3. Make the 'Awaiting CAB' StatCard link to ?status=submitted (extend StatCard with href if unsupported).
  4. Default CAB-role users to the submitted view if role available.
- **Acceptance:**
  - /change?status=submitted lists only submitted rows and count matches the stat.
  - Clicking the stat card applies the filter.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CHANGE-HOME-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Emergency-type changes are indistinguishable in list styling beyond a status cell; no expedited path is described although type 'emergency' exists (NewChangeButton.tsx:7).
- **Verified evidence:** page.tsx:66-67 render Type and Risk through StatusPill (cellType 'status'); ds/StatusPill.tsx STATUS_MAP has no emergency/normal/standard/low/medium/high keys, so all fall to the neutral 'info' variant: emergency and high-risk look the same as standard/low. NewChangeButton.tsx:7 offers 'emergency' and ChangeActions has no expedited path or copy; whether the backend has a distinct emergency flow is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/change/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/change/NewChangeButton.tsx`
- **Fix steps:**
  1. Add risk keys (low good, medium warn, high bad) and type 'emergency' (bad) to STATUS_MAP or render a dedicated <RiskPill>/<TypePill>.
  2. Decision needed: define expedited path (e.g. emergency skips freeze, needs retrospective CAB); surface it as helper text in the Raise dialog and detail page.
  3. Optionally sort emergency/high first in the list.
- **Acceptance:**
  - Emergency row shows red pill distinct from standard.
  - Raise dialog explains what 'emergency' does once policy is decided.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Changing STATUS_MAP affects other pages using these words; grep usages first.

### GAP-CHANGE-HOME-05  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx uses Tailwind gray-100/200 and a p-6 wrapper (loading.tsx:1-14), inconsistent with the DS Skeleton used elsewhere and light-only.
- **Verified evidence:** change/loading.tsx:1-14 (and identical comms/loading.tsx) use Tailwind h-8/bg-gray-200/bg-gray-100/p-6 classes and animate-pulse, hard-coded light colours; the DS provides SkeletonCard/SkeletonTable/SkeletonBar (ds/Skeleton.tsx, exported from ds/index.ts:42) using CSS variables, and contracts/loading.tsx uses var(--panel)/var(--line). Whether Tailwind utilities are even compiled for the (app) group was not verified.
- **Files to change:** `apps/web/src/app/(app)/change/loading.tsx`, `apps/web/src/app/(app)/change/comms/loading.tsx`
- **Fix steps:**
  1. Rewrite both loading.tsx with PageHeader-shaped SkeletonBar, a StatGrid of SkeletonCard and SkeletonTable rows={8}.
  2. Remove p-6 wrapper; use the app's page wrapper class.
  3. Add aria-busy and a label.
- **Acceptance:**
  - Loading state uses theme tokens (visible in dark theme) and matches page layout without shift.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CHANGE-HOME-06  ·  LOW  ·  confirmed  ·  theme VALIDATION (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Loader maps unknown/malformed rows with defaults (status 'draft', type 'normal') so a backend shape change would silently show every change as draft (_data/loaders.ts:34-39).
- **Verified evidence:** loaders.ts:34-35,39 mapChange defaults type to 'normal', risk to 'medium', status to 'draft' via str(v,fallback); id defaults to '' (:32). No schema validation of the payload (asArray/asObj casts only). A shape change (e.g. status renamed) would make every row 'draft', and the detail page would then offer draft actions (ChangeActions.tsx:59-70).
- **Files to change:** `apps/web/src/app/(app)/change/_data/loaders.ts`, `apps/web/src/app/(app)/change/_data/types.ts`
- **Fix steps:**
  1. Define zod schemas for ChangeRequest and ChangeAuditEntry (enum status/type/risk) in _data/types.ts.
  2. In mapResponse safeParse each row; drop invalid rows, count them, and return source 'error' (or a warning flag) if any fail; log via recordLoaderFallback telemetry.
  3. Remove fallback defaults; treat unknown status as 'unknown' shown with an alert pill and no actions.
- **Acceptance:**
  - Unit test: payload with status 'in-review' yields parse failure surfaced, not 'draft'.
  - Rows without id are excluded.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; may surface backend drift that was previously hidden.


---
## /change/[id]  —  `change/detail.html`

- **Source:** `apps/web/src/app/(app)/change/[id]/page.tsx`
- **Design reference:** `redesign/change/detail.html`

### GAP-CHANGE-DETAIL-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Approve (CAB), Reject, Complete and 'Mark rolled back' fire immediately on click with no ConfirmDialog (ChangeActions.tsx:29-31,78-79,115-116) — irreversible governance transitions (approval releases to production; rollback is terminal) on a single click, unlike contracts/[id] and cdp/steward which confirm.
- **Verified evidence:** Confirmed no confirmation: ChangeActions.tsx:49-51 btn() calls run(fn) directly on click; Approve (:78), Reject (:79), Complete (:115) and Mark rolled back (:116) all fire immediately (lines 29-31 cited earlier are just state hooks). Same for Submit/Schedule/Start. Overstated: Approve only moves submitted->approved (scheduling and start are separate steps :86-106), it does not release to production; rolled_back is treated terminal at :121. Contracts do confirm (BondActions/MilestoneActions use ds ActionButton). Server-side maker-checker/audit are cannot-verify (service absent), UI hint :81 claims them.
- **Files to change:** `apps/web/src/app/(app)/change/[id]/ChangeActions.tsx`
- **Fix steps:**
  1. Replace btn() for Approve, Reject, Complete and Mark rolled back with ds <ActionButton> (uses useConfirmAction + ConfirmDialog) with danger for Reject/Rolled back.
  2. Set requireReason (+minReasonLength) for Reject and Rolled back; pass the reason to post() body; for Approve use optional note.
  3. Wrap Submit for CAB / Schedule / Start in ActionButton too, showing window and affected services in confirmDescription.
  4. On ActionButton throw, show the mapped error inside the dialog (see DETAIL-05).
  5. Disable Approve when current user id === requestedBy if session id is available (UI aid only; server remains authority).
- **Acceptance:**
  - Click Approve: dialog opens; Cancel makes no fetch; Confirm posts once.
  - Reject/Rolled back: Confirm disabled until reason entered.
  - Escape closes dialog and focus returns to trigger.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Governance transitions; accidental click currently changes production-release state and cannot be undone from UI.
- **Depends on:** GAP-CHANGE-DETAIL-02, GAP-CHANGE-DETAIL-05

### GAP-CHANGE-DETAIL-02  ·  HIGH  ·  partly  ·  theme AUDIT (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Approve sends a hard-coded note 'Approved via console' (ChangeActions.tsx:78) and Reject posts an empty reason if the field is left blank (line 79) — the audit trail records boilerplate instead of the CAB member's rationale; no client validation that reason is non-empty.
- **Verified evidence:** Approve posts the literal { note: 'Approved via console' } (ChangeActions.tsx:78) so the audit note (rendered page.tsx:89) is boilerplate. Reject posts { reason } from the shared 'Rejection reason' input (:75-79) with no client check that it is non-empty (button never disabled). Whether the backend rejects an empty reason is cannot-verify. The single reason input sits beside Approve so the approver cannot record a rationale.
- **Files to change:** `apps/web/src/app/(app)/change/[id]/ChangeActions.tsx`
- **Fix steps:**
  1. Remove the hard-coded note; collect the approval rationale in the ConfirmDialog (requireReason, reasonLabel 'Approval rationale') and send it as note.
  2. Drop the inline 'Rejection reason' input; Reject uses ActionButton requireReason minReasonLength 10 (align with backend rule once known).
  3. Send trimmed reason only; block confirm while empty (ConfirmDialog already enforces).
- **Acceptance:**
  - Approve payload contains the typed rationale, never 'Approved via console'.
  - Reject cannot be confirmed with blank/whitespace reason; audit table shows the text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Audit-trail quality for CAB decisions.
- **Depends on:** GAP-CHANGE-DETAIL-01

### GAP-CHANGE-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Requested by / Approved by / Actor print 8-char UUID prefixes (page.tsx:41-42,88), so CAB cannot tell who raised or approved a change; maker-checker (approver ≠ requester) is unverifiable on screen.
- **Verified evidence:** page.tsx:41 (requestedBy.slice(0,8)), :42 (approvedBy.slice(0,8)) and :88 (audit actorId.slice(0,8)), and header :31 prints c.id.slice(0,8). No name resolution exists on this page; no user-directory helper found in web loaders (cannot-verify whether an endpoint exists).
- **Files to change:** `apps/web/src/app/(app)/change/[id]/page.tsx`, `apps/web/src/app/(app)/change/_data/loaders.ts`, `apps/web/src/app/_components/ds/ (new UserRef component)`
- **Fix steps:**
  1. Ask backend for a display-name lookup (or embed requestedByName/approvedByName/actorName in the change detail payload); do not invent one.
  2. Add a small <UserRef id name/> ds component that shows name with the short id in a title/tooltip and copy affordance.
  3. Use it at page.tsx:41,42,88.
  4. Show a visible 'Same person as requester' warning when approvedBy === requestedBy.
- **Acceptance:**
  - Detail page shows 'Asha Rao' not 'a1b2c3d4' for requester, approver and each audit row.
  - Fallback to short id when name unavailable.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Maker-checker evidence is unreadable to CAB/auditors.

### GAP-CHANGE-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Release window shows dates only (formatIndianDate) though windows are datetime-local inputs (ChangeActions.tsx:90-94), so a 22:00–02:00 window reads as same-day start/end.
- **Verified evidence:** page.tsx:44-46 renders windowStart/windowEnd via formatIndianDate, which returns dd/MM/yyyy only (formatters.ts:2-7). ChangeActions.tsx:90,94 collect datetime-local and :96-99 send new Date(x).toISOString(). Also: an empty picker gives new Date('') and toISOString() throws RangeError, swallowed by run() into the generic error.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/change/[id]/page.tsx`, `apps/web/src/app/(app)/change/[id]/ChangeActions.tsx`, `apps/web/src/app/(app)/change/page.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime with timeZone 'Asia/Kolkata' and 'IST' suffix to lib/formatters.ts.
  2. Use it for the release window (page.tsx:45) and audit 'When' column (:85).
  3. In ChangeActions, disable Schedule until both values valid and end > start; show inline field errors.
- **Acceptance:**
  - A 22:00-02:00 window renders '14/09/2026 22:00 IST -> 15/09/2026 02:00 IST'.
  - Schedule button disabled with empty/invalid inputs; no RangeError.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Wrong perceived freeze overlap; low data risk.

### GAP-CHANGE-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme ERRMSG (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Failure of any action shows one generic message (ChangeActions.tsx:12-17); a freeze-overlap or maker-checker rejection is not distinguished from a network error, though the hint text names both rules.
- **Verified evidence:** ChangeActions.tsx:15-18 changeActionError() returns one catalogued 'save' message; post() (:20-26) throws it on any !res.ok without reading status/body, and run() (:45) replaces any exception with it. Hints at :81 and :101 tell users about maker-checker and freeze rules, but their violation is indistinguishable from a network failure. NewChangeButton.tsx:56 already uses useFormError.fromResponse. Whether the admin service returns typed { code, message } bodies is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/change/[id]/ChangeActions.tsx`, `apps/web/src/lib/useFormError.ts`
- **Fix steps:**
  1. Use useFormError('change request') in ChangeActions and have post() return the Response instead of throwing.
  2. On !ok call formError.fromResponse(res,'save'); on exception fromException('save').
  3. Map known codes/409/403 to specific copy (add catalogue entries in lib/messages: freeze overlap, approver same as requester, rollback plan missing) once backend codes are confirmed.
  4. Render inside the ConfirmDialog errorMessage when action was confirmed there.
- **Acceptance:**
  - Mock 409 freeze-overlap response: UI shows freeze copy, not generic.
  - Network failure shows generic retry copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CHANGE-DETAIL-01


---
## /change/calendar  —  `change/calendar.html`

- **Source:** `apps/web/src/app/(app)/change/calendar/page.tsx`
- **Design reference:** `redesign/change/calendar.html`

### GAP-CHANGE-CALENDAR-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Despite the name, no calendar exists — two flat tables (page.tsx:41-77); overlap between a booked window and a freeze, which blocks scheduling (ChangeActions.tsx:101), cannot be seen here.
- **Verified evidence:** change/calendar/page.tsx:36-77 renders two <table className='tbl'> (windows, freezes) sorted by start; no month/week grid and no overlap indicator. Overlap blocking is enforced server-side, message only at change/[id]/ChangeActions.tsx:101 (finding said :101, correct). Users cannot see conflicts before scheduling.
- **Files to change:** `apps/web/src/app/(app)/change/calendar/page.tsx`, `apps/web/src/app/(app)/change/calendar/ReleaseCalendar.tsx (new)`
- **Fix steps:**
  1. Add a pure helper overlaps(window, freezes) in change/_data and flag windows that intersect a freeze with a 'Conflicts with freeze X' pill.
  2. Build a month/agenda calendar client component (GanttChart in _components can be a starting point) plotting windows and freezes as distinct bands.
  3. Keep tables as accessible fallback.
  4. Wire ChangeActions to show overlapping freezes before submit (optional).
- **Acceptance:**
  - Unit: overlaps() true for partially overlapping ranges, false for adjacent.
  - Manual: window inside a freeze is visibly flagged.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; read-only visual. Server remains authoritative for blocking.
- **Depends on:** GAP-CHANGE-CALENDAR-03

### GAP-CHANGE-CALENDAR-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** On error the stat cards render 0 for 'Scheduled releases' and 'Change freezes' (page.tsx:28-29, values from empty arrays) while the change home renders '—'; a broken feed reads as 'no freezes', which could lead to scheduling during a freeze.
- **Verified evidence:** On error, stat cards get scheduled.length / freezes.length from empty arrays (page.tsx:28-29) and show 0, whereas change home uses errored ? '—' (change/page.tsx:48-51). Mitigations the finding omits: DataSourceBadge (l.26) and RefreshErrorState replaces both tables when errored (l.32-34). Also one failing loader marks both as errored though the other data is fine.
- **Files to change:** `apps/web/src/app/(app)/change/calendar/page.tsx`
- **Fix steps:**
  1. value={errored ? '—' : ...} for both StatCards (or per-loader: cSource for releases, fSource for freezes).
  2. Show RefreshErrorState per failed panel so a working freeze list is not hidden by a change-request failure.
- **Acceptance:**
  - Mock getChangeFreezes error -> Change freezes stat '—', no '0'.
  - Healthy zero still shows 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; safety-relevant (freeze visibility).
- **Depends on:** RefreshErrorState

### GAP-CHANGE-CALENDAR-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Freeze list has no create/edit/delete control; the page claims 'active change freezes' but lists all freezes including past ones with no status or filter (page.tsx:19-21).
- **Verified evidence:** Page has no create/edit/delete UI for freezes; the only freeze loader is a list GET (_data/loaders.ts:89-101 -> /api/v1/admin/change/freezes) and no freeze mutation exists in change/. Subtitle (page.tsx:25) says 'active change freezes' but l.19-21 sorts and lists all freezes with no status or past/active filter. Freeze create/update endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/change/calendar/page.tsx`, `apps/web/src/app/(app)/change/_data/loaders.ts`
- **Fix steps:**
  1. Compute state per freeze (upcoming/active/ended) from startsAt/endsAt and show StatusPill; default-hide ended with a toggle.
  2. Fix subtitle or filter so text matches list.
  3. Decision: if freeze admin belongs to /admin, add link 'Manage freezes'; else build form after confirming POST/DELETE endpoints (with reason + audit).
- **Acceptance:**
  - Ended freeze is hidden by default and shows 'Ended' when shown.
  - Subtitle matches content.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low for filter; freeze create is high-impact (blocks releases) so needs approval flow.
- **Depends on:** GAP-CHANGE-CALENDAR-01

### GAP-CHANGE-CALENDAR-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Windows and freezes print dates only (formatIndianDate), dropping the time of day of a release window (page.tsx:52-55).
- **Verified evidence:** Windows and freezes use formatIndianDate (page.tsx:49-50,69-70), which is date-only (lib/formatters.ts:2-7) while windows are booked with datetime-local (ChangeActions.tsx). Two windows on the same day look identical and a freeze end time is lost.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/change/calendar/page.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime (IST) to formatters (see GAP-CDP-IDENTITY-03).
  2. Use it for windowStart/windowEnd/startsAt/endsAt.
- **Acceptance:**
  - Window shows date and time in IST.
  - formatIndianDateTime unit tests incl. invalid input.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure timezone is IST not browser-local.
- **Depends on:** GAP-CDP-IDENTITY-03

### GAP-CHANGE-CALENDAR-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Tables are bare <table className='tbl'> markup, not DataTable — no sort/filter/mobile card transform (page.tsx:41,63).
- **Verified evidence:** Both tables are raw <table className='tbl' style width 100%> (page.tsx:41,63) without the .tbl-wrap scroll container and without sort/filter/pagination that ds DataTable provides. Other change pages use ds components.
- **Files to change:** `apps/web/src/app/(app)/change/calendar/page.tsx`
- **Fix steps:**
  1. Replace with DataTable<...> using columns and render for the status pill and link (rowLinkKey='id', rowLinkPrefix='/change/').
  2. Enable sortable and filterable; keep emptyTitle text.
- **Acceptance:**
  - Tables scroll horizontally at 375px width.
  - Sort by window start works.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /change/comms  —  `change/comms.html`

- **Source:** `apps/web/src/app/(app)/change/comms/page.tsx`
- **Design reference:** `redesign/change/comms.html`

### GAP-CHANGE-COMMS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Page is titled 'published … broadcasts' but shows only local data: it lists completed changes with releaseNotes and never queries the notification service, so a failed broadcast still appears as 'Published' (page.tsx:12-15,25).
- **Verified evidence:** comms/page.tsx:12-14 filters getChangeRequests() to status==='completed' && releaseNotes; :25 labels the count 'Published releases' and :20 says 'broadcasts published'. The page never calls the notification service, and ChangeRequest (loaders.ts:30-52) has no broadcast/delivery field, so 'Published' just means 'completed with notes'. Whether the backend actually broadcasts on completion is cannot-verify (admin change service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/change/comms/page.tsx`, `apps/web/src/app/(app)/change/_data/loaders.ts`, `apps/web/src/app/(app)/change/_data/types.ts`
- **Fix steps:**
  1. Confirm with backend whether the change/notification service exposes per-release broadcast status (sent/failed/pending, sentAt, channel, audience); do not invent it.
  2. If it does: add broadcastStatus/broadcastAt/channel/audience to ChangeRequest and mapChange (loaders.ts:30) and render a StatusPill per card.
  3. Show a 'Retry broadcast' ActionButton (ds) for failed ones only once a retry endpoint exists.
  4. Until then: reword title/subtitle/StatCard to 'Release notes recorded' and remove the word 'broadcast/Published' so the UI makes no delivery claim.
- **Acceptance:**
  - With a completed change whose broadcast failed, the card shows a Failed pill, not Published (needs backend field).
  - Without backend support, no text on the page claims delivery.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Misleading assurance to users/auditors that a communication went out; no money impact.

### GAP-CHANGE-COMMS-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Loads the entire change-request list (no limit or paging) and filters client-side, then renders every release as a full card with no pagination or search (page.tsx:8-15,37).
- **Verified evidence:** loaders.ts:66-74 getChangeRequests() calls /api/v1/admin/change/requests with no limit/offset/status params; comms/page.tsx:12-14 filters status/releaseNotes in memory and :37 maps every result to a full card. No paging, search or count of total. Whether the endpoint supports paging/filter params is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/change/comms/page.tsx`, `apps/web/src/app/(app)/change/_data/loaders.ts`
- **Fix steps:**
  1. Add optional params {status,hasReleaseNotes,page,pageSize} to getChangeRequests and pass as query string if the endpoint supports them (confirm with backend); return total.
  2. Read page from searchParams in comms/page.tsx; render 10 per page with prev/next links and 'Showing x-y of N'.
  3. Add a title text filter (searchParams q) or reuse DataTable with expandable rows.
  4. Fallback if backend cannot filter: slice in the server component after sort, and state that the source list may be capped.
- **Acceptance:**
  - Seed 200 completed changes with notes: page renders 10 cards and a working pager; total matches.
  - ?q=gateway narrows results.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; list correctness depends on the fetch not being silently capped.

### GAP-CHANGE-COMMS-03  ·  MEDIUM  ·  partly  ·  theme OTHER (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Date shown is pirAt (post-implementation review time) rather than the broadcast time; no audience or channel is displayed.
- **Verified evidence:** Real: comms/page.tsx:14 sorts and :41 displays pirAt ?? updatedAt (PIR time, not broadcast time), and no audience/channel is shown; ChangeRequest has no such fields (loaders.ts:30-52). Overstated fix: formatIndianDate (formatters.ts:2) outputs dd/MM/yyyy via toLocaleDateString and has no time or 'dd Mon yyyy' form; there is no formatIndianDateTime helper.
- **Files to change:** `apps/web/src/app/(app)/change/comms/page.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/change/_data/types.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts using toLocaleString('en-IN',{timeZone:'Asia/Kolkata',...}).
  2. Label the shown date explicitly ('Reviewed' for pirAt) until a broadcastAt field exists.
  3. When backend exposes broadcastAt/channel/audience, map them in mapChange and show 'Sent 12/09/2026 14:05 IST via email to All users'.
- **Acceptance:**
  - formatIndianDateTime('2026-09-01T18:30:00Z') returns 02/09/2026 with 00:00 IST (unit test).
  - Card shows label + time, not a bare date.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CHANGE-COMMS-04  ·  LOW  ·  confirmed  ·  theme LAYOUT (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Release-note text is pre-wrap plain text; no length clamp, so a long note pushes all others off-screen.
- **Verified evidence:** comms/page.tsx:44 renders releaseNotes with whiteSpace pre-wrap and no clamp/max-height. Note: input in ChangeActions.tsx:113 is a single-line <input>, but backend length limit is cannot-verify, so long notes are possible.
- **Files to change:** `apps/web/src/app/(app)/change/comms/page.tsx`
- **Fix steps:**
  1. Wrap note in a component that clamps to ~6 lines (CSS line-clamp / max-height) with a 'Show more' toggle (native <details> works in a server component).
  2. Add overflow-wrap:anywhere to avoid long-token overflow.
- **Acceptance:**
  - A 5,000-char note occupies ~6 lines until expanded; expanded text remains readable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-CHANGE-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W1 SF-20: closed by #2005)
- **W1 SF-20 note:** admin-service change routes all use requireRole(CHANGE_ROLES = TENANT_ADMIN_ROLES); change/layout.tsx now redirects every other role, so the page and its actions only render for permitted roles.
- **First-pass claim:** Raise change (NewChangeButton.tsx:73) and every lifecycle action render for all signed-in users; there is no client role check, so requesters without permission meet a 403 after filling the dialog. Roles undeterminable (admin-service absent).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['POST /v1/admin/change/requests', 'POST /v1/admin/change/requests/:id/*']`
- **Question:** Which roles may create and transition change requests, and is 403 returned with a stable error code?
- **How to verify:** Open route role guards in admin-service change module; curl POST requests with a plain employee token.
- **Test to add:** Given employee without change.raise, when POST requests, then 403 FORBIDDEN and no row created.
- **Impact if wrong:** Unauthorised change requests reach CAB, or users lose typed input to a late 403; medium.
- **Web change if wrong:** Gate NewChangeButton and ChangeActions by role claims from session.

### GAP-CHANGE-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by #2090 — maker-checker assertApproverDistinct 409 MAKER_CHECKER_VIOLATION in routes.ts+f3-apply.ts; recordTransition writes audit row+event in one tx on every transition)
- **First-pass claim:** Audit rows and maker-checker rules come from the admin service, which is absent from this snapshot: undeterminable whether every transition is audited server-side.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/change/requests/:id', 'POST /v1/admin/change/requests/:id/{submit,approve,reject,schedule,rollback-plan}']`
- **Question:** Is every lifecycle transition audited server-side with actor, and does approve enforce maker-checker (approver != requester)?
- **How to verify:** Open admin-service change module transitions; approve own request as requester expecting 403/409; inspect audit table after each transition.
- **Test to add:** Given requester approves own change, when POST approve, then 403 MAKER_CHECKER; given valid CAB approver, then 200 and audit row with actor and before/after status.
- **Impact if wrong:** Self-approved production changes; high.
- **Web change if wrong:** Surface error code in ChangeActions.tsx.

### GAP-CHANGE-CALENDAR-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by #2090 — GET /v1/admin/change/freezes returns {data:[{id,name,startsAt,endsAt,reason}]} ISO-8601, gated by CHANGE_ROLES)
- **First-pass claim:** Freeze endpoint path/shape is in _data/loaders.ts (getChangeFreezes); admin service absent from snapshot: undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/change/freezes']`
- **Question:** Does the freezes route return {data:[...]} with start/end/reason and is it readable by any change-module role?
- **How to verify:** Open admin-service change freezes route and schema; curl with requester role expecting 200.
- **Test to add:** Given a seeded freeze, when GET freezes as requester, then 200 with window fields ISO-8601 and correct timezone.
- **Impact if wrong:** Calendar hides freezes so changes get scheduled in blackout; medium.
- **Web change if wrong:** Adjust mapper in change/_data/loaders.ts:89.

### GAP-CHANGE-COMMS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by #2090 — admin.change.approved/scheduled enqueued on transitions; notification.broadcast.send on complete(success)+releaseNotes via outbox relay)
- **First-pass claim:** Notification-service delivery is described only in copy (page.tsx:34); neither admin nor notification service is in the snapshot: undeterminable.
- **Service:** `notification-service`  ·  **Endpoint(s):** `['(none in web) admin change events -> notification-service']`
- **Question:** Is the comms text true: does an approved/scheduled change actually enqueue notifications to stakeholders?
- **How to verify:** Open admin-service change transition handlers for publish to the queue and notification-service consumer; approve a change and check the outbox.
- **Test to add:** Given a change is scheduled, when transition completes, then a notification job is enqueued per stakeholder and delivery is logged.
- **Impact if wrong:** Page promises notifications that never go out; medium.
- **Web change if wrong:** Reword copy in change/comms/page.tsx:34 to what is real.
