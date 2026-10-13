# Detailed gap file — module `meeting`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 28, BACKEND-VERIFY 5, REFUTED 1



---
## /meeting  —  `meeting/home.html`

- **Source:** `apps/web/src/app/(app)/meeting/page.tsx`
- **Design reference:** `redesign/meeting/home.html`

### GAP-MEETING-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch still renders four real "0" stat cards under the small badge (page.tsx:46-74); the comment at page.tsx:35-38 fixes the silent-zero for the in-progress query but the values are not nulled or hidden, so "Total Meetings 0" reads as fact. No RefreshErrorState or retry, unlike /meeting/meetings.
- **Verified evidence:** meeting/page.tsx:38 computes source=error if either query fails; :46-48 shows only DataSourceBadge 'Couldn't load - showing nothing'. StatCards at :50-73 still render all.data.length / inProgress.data.length / derived counts, which are 0 (loader returns empty data on error). No RefreshErrorState (used on meetings/page.tsx:150). Silent-zero comment at :35-37 only fixes the source flag.
- **Files to change:** `apps/web/src/app/(app)/meeting/page.tsx`
- **Fix steps:**
  1. When source==='error' pass value='—' to all four StatCards (and derived scheduled/minutesPending) instead of toLocaleString of zero.
  2. Render <RefreshErrorState error={{what:"We couldn't load meeting totals.",next:"Check your connection and try again.",actions:["retry","help"]}}/> under the badge (copy the pattern at meetings/page.tsx:150-156), or drop the redundant badge.
  3. Track which query failed if partial numbers are wanted: show '—' only for the failed stat.
- **Acceptance:**
  - Component/RTL test: mock getMeetings to return {data:[],source:'error'}; assert no '0' stat text, '—' shown, retry control present.
  - Manual: block /api/v1/meeting; page shows dashes plus retry, not zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.
- **Depends on:** RefreshErrorState

### GAP-MEETING-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Awaiting Minutes" folds adjourned meetings (minutes not yet started) and minutes_pending together (page.tsx:32-34); the number cannot be used to chase overdue minutes and there is no drill-through from any stat to a filtered list.
- **Verified evidence:** page.tsx:32-34 counts status==='minutes_pending' || 'adjourned' into a single 'Awaiting Minutes' stat (:68-73). StatCards (:50-73) are not links; no href/drill-through to /meeting/meetings, and meetings/page.tsx has no status filter (no searchParams), so drill-through also needs the list filter (see GAP-MEETING-MEETINGS-01).
- **Files to change:** `apps/web/src/app/(app)/meeting/page.tsx`, `apps/web/src/app/(app)/meeting/meetings/page.tsx`
- **Fix steps:**
  1. Split into 'Adjourned (minutes not started)' and 'Minutes pending' counts, or keep one card with a sub-label showing both.
  2. Wrap each StatCard in Link to /meeting/meetings?status=<statuses> (check whether StatCard accepts href; otherwise wrap).
  3. Read searchParams.status in meetings/page.tsx and filter (or pass to getMeetings(status) which already takes a status arg, see page.tsx:26).
- **Acceptance:**
  - Click 'Awaiting Minutes' lands on list showing only those statuses and count matches the card.
  - Test: 2 adjourned + 1 minutes_pending renders 2 and 1 (or 3 with breakdown).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-MEETING-MEETINGS-01

### GAP-MEETING-HOME-04  ·  MEDIUM  ·  partly  ·  theme RBAC (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No role awareness: secretaries, chairpersons and plain members all get the same page, and "Admin Configuration" is offered to everyone (page.tsx:15-20).
- **Verified evidence:** meeting/page.tsx:8-21 CONSOLES is a static array rendered for everyone; no role/entitlement check on the page or in meeting/layout.tsx. True that Admin Configuration tile is offered to all. Whether /meeting/admin API is server-restricted cannot be seen (meeting-service absent from snapshot), so this is a UX/least-privilege gap, not proven exposure. Not a PII/Masked issue.
- **Files to change:** `apps/web/src/app/(app)/meeting/page.tsx`, `apps/web/src/app/(app)/meeting/layout.tsx`
- **Fix steps:**
  1. Find the existing role/permission helper used by other module home pages (session claims) and expose it to this server component.
  2. Add requiredRole to the admin entry in CONSOLES and filter the list; hide the tile for non-admins.
  3. Ensure /meeting/admin/page.tsx also checks the role and renders a 403 state (do not rely on hiding).
- **Acceptance:**
  - Test: plain member session sees only Meetings tile; admin sees both.
  - Direct GET /meeting/admin as member shows access-denied.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Role claim names must match Keycloak roles; wrong mapping could hide admin from real admins.

### GAP-MEETING-HOME-05  ·  LOW  ·  partly  ·  theme NAV (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Tile icons are emoji (page.tsx:11,17) and the tiles are full-card links with an inner "Open →" that is not a control of its own; console and admin tiles are the only navigation - New meeting is two clicks away.
- **Verified evidence:** Icons are emoji at page.tsx:11,17 (aria-hidden at :87, so not read by AT) plus stat icons :51,57,63,69. Tiles are whole-card Links (:85) containing a div.lnk 'Open ->' (:92-97), a visual affordance only, which is normal for card links, not a defect. 'New meeting' is not on the home page: reachable via Meetings tile then '+ New meeting' (meetings/page.tsx:139), i.e. two clicks. Overstated: 'console and admin tiles are the only navigation' is true only for the page body.
- **Files to change:** `apps/web/src/app/(app)/meeting/page.tsx`
- **Fix steps:**
  1. Add PageHeader actions with <Link className="btn primary" href="/meeting/meetings/new">+ New meeting</Link> (same as meetings/page.tsx:138-142).
  2. Replace emoji with the ui-kit icon component used elsewhere (if one exists) for consistent rendering.
- **Acceptance:**
  - Home shows a New meeting button that opens /meeting/meetings/new in one click.
  - Tab order: each tile focusable with visible focus ring.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.


---
## /meeting/admin  —  `meeting/admin.html`

- **Source:** `apps/web/src/app/(app)/meeting/admin/page.tsx`
- **Design reference:** `redesign/meeting/admin.html`

### GAP-MEETING-ADMIN-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Applying a preset fires immediately on one click and "upserts the policies below" (AdminConfig.tsx:87-100,120-132): no ConfirmDialog, no preview of which values change, no undo - overwrites the tenant's tuned agenda/minutes/escalation policy.
- **Verified evidence:** apps/web/src/app/(app)/meeting/admin/AdminConfig.tsx:120-132 preset buttons call onApplyPreset(p) directly; onApplyPreset (87-100) calls applyPreset -> POST v1/meeting/config/presets/:preset (_data/client.ts:333-335) with empty body, then reload. Copy at 117-118 says presets 'upsert the policies below'. No ConfirmDialog, no diff preview. Server upsert semantics and audit are unverifiable (meeting-service absent).
- **Files to change:** `apps/web/src/app/(app)/meeting/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/meeting/_data/policy.ts`
- **Fix steps:**
  1. Add pendingPreset state; button click sets it instead of calling applyPreset.
  2. Render ConfirmDialog (danger, requireReason) listing 'This will overwrite N policy values'.
  3. If preset values are known client-side or via a GET preview endpoint (unverified), show a current vs preset diff; otherwise warn that all policy values will be replaced.
  4. On confirm call applyPreset(preset) (add reason to body only if API supports it); keep idempotency header.
- **Acceptance:**
  - Component test: clicking a preset does not call applyPreset until Confirm.
  - Cancel leaves settings unchanged.
  - Manual: confirm applies preset and toast appears.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Preset overwrites tenant governance; backend should emit audit event (not verifiable here).

### GAP-MEETING-ADMIN-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Boolean committee-type buttons change tenant governance on a single click with no confirmation; the button shows the CURRENT state ("On"/"Off") rather than the action, so it reads as a status chip (AdminConfig.tsx:182-189).
- **Verified evidence:** AdminConfig.tsx:182-189 the boolean button toggles on click (save(field, encodeBooleanValue(!current))) with no confirmation and labels itself with the current state ('On'/'Off', class primary vs ghost), so it reads as a status chip; no role='switch' or aria-pressed. Optimistic version passed via expectedVersion (line 76).
- **Files to change:** `apps/web/src/app/(app)/meeting/admin/AdminConfig.tsx`
- **Fix steps:**
  1. Replace button with an accessible switch (role='switch' aria-checked={current}) labelled with field.label, plus visible On/Off text.
  2. Intercept turning a committee type Off (and last remaining On) through ConfirmDialog with explanation.
  3. Keep save() and expectedVersion unchanged.
- **Acceptance:**
  - a11y test: element exposes role switch with aria-checked.
  - Turning a type Off requires confirmation; turning On saves directly.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-MEETING-ADMIN-04

### GAP-MEETING-ADMIN-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Copy contradiction: group text says "When none are toggled on, the full default set applies" (policy.ts:450) - switching every type Off therefore permits every type. Nothing warns about it.
- **Verified evidence:** The text is at apps/web/src/app/(app)/meeting/_data/policy.ts:165 (not 450): 'When none are toggled on, the full default set (standing, ad-hoc, statutory, board) applies.' AdminConfig lets every committee-type switch be saved Off with no warning (182-189). The actual engine behavior (all-off = all allowed) is only asserted by this copy; meeting-service is absent so it cannot be verified. Tag I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/meeting/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/meeting/_data/policy.ts`
- **Fix steps:**
  1. Confirm engine behavior with meeting-service owner.
  2. In AdminConfig compute whether the resulting set of committee types would be all Off; if so show inline warning and require ConfirmDialog.
  3. Reword group description to explicit language e.g. 'If all types are switched off, every type is permitted.'
  4. Or block turning off the last enabled type.
- **Acceptance:**
  - Turning off the last enabled type shows the warning/confirmation.
  - Copy states the consequence unambiguously.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Governance policy could silently become permissive.

### GAP-MEETING-ADMIN-06  ·  LOW  ·  partly  ·  theme VALIDATION

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Engine defaults are duplicated by hand in the web app (policy.ts header comment); they can drift from meeting-service. Bounds (min/max) are UX-only guards. Min/max is shown only after an out-of-range entry, not beforehand.
- **Verified evidence:** True: policy.ts:1-11 header says defaults mirror services/meeting-service/.../policy.ts by hand, and min/max (policy.ts:24-37 comment) are UX-only guards. AdminConfig.tsx:198-203 computes outOfRange and lines 249-253 show '{min}–{max}' only after an out-of-range entry; but the input does carry min/max attributes (237-238) and Save is disabled when invalid (203,263). No zod schema is used; meeting-service cannot be inspected for drift.
- **Files to change:** `apps/web/src/app/(app)/meeting/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/meeting/_data/policy.ts`
- **Fix steps:**
  1. Show the allowed range as helper text always (e.g. under field.help: 'Allowed: 1–2160 hours').
  2. Give the out-of-range message words ('Enter a value between 1 and 2160').
  3. Optionally load defaults from a GET defaults endpoint (unverified) or add a CI test comparing web defaults with the service's POLICY_DEFAULTS.
  4. Add a zod schema per field derived from min/max in policy.ts and reuse it in save().
- **Acceptance:**
  - Range is visible before typing.
  - Entering 0 in a min-1 field shows a full-sentence error and Save stays disabled.
  - CI test fails if web default differs from service default (if both in monorepo).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; server remains the authority.


---
## /meeting/meetings  —  `meeting/meetings.html`

- **Source:** `apps/web/src/app/(app)/meeting/meetings/page.tsx`
- **Design reference:** `redesign/meeting/meetings.html`

### GAP-MEETING-MEETINGS-01  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No search, filter, sort or pagination: the table renders every meeting the API returns (meetings/page.tsx:60-104); a tenant with years of committee meetings gets an unbounded list. Home's stat cards do not link into filtered views either.
- **Verified evidence:** meetings/page.tsx:127-129 calls getMeetings() with no args; table renders meetings.data.map (:177) with no search, sort, filter or pagination and page does not read searchParams. getMeetings(status) takes an optional status (used in home page.tsx:26). Whether the API paginates or caps cannot be verified (meeting-service absent).
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/page.tsx`, `apps/web/src/app/(app)/meeting/_data/loaders.ts`
- **Fix steps:**
  1. Read searchParams (q, status, page) in the page and pass to getMeetings with limit/offset if API supports; else cap and add truncation notice.
  2. Add filter bar (status select, search) and pager using shared list components.
  3. Show total from API.
- **Acceptance:**
  - Test: ?status=in_progress requests filtered list.
  - Page 2 requests offset.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; presentational.
- **Depends on:** GAP-MEETING-HOME-03

### GAP-MEETING-MEETINGS-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error is shown twice - amber badge "Couldn't load — showing nothing" plus a RefreshErrorState (page.tsx:40-52) - and the Card title still reads "All meetings (0)" (page.tsx:44). Minor, but inconsistent with the minutes page which shows "(—)".
- **Verified evidence:** meetings/page.tsx:144-146 badge and :149-156 RefreshErrorState both render on error (duplicated) and Card title :148 is `All meetings (${meetings.data.length})` = '(0)' on error. Confirmed. Minutes page uses '—' (minutes/page.tsx:350) so inconsistent. Severity minor.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/page.tsx`
- **Fix steps:**
  1. Title: source==='error' ? 'All meetings (—)' : `All meetings (${n})`.
  2. Remove the DataSourceBadge here since RefreshErrorState covers it.
- **Acceptance:**
  - Test: error result shows '(—)' and one error region.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.

### GAP-MEETING-MEETINGS-04  ·  LOW  ·  partly  ·  theme STATUS (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status pills lose distinctions (scheduled and agenda_locked both "open"; closed and minutes_approved both "completed") while labels stay raw-humanised (format.ts:559-578); no pill for cancelled vs archived.
- **Verified evidence:** meetingPillStatus (format.ts:53-72) maps scheduled+agenda_locked to 'open', minutes_approved+closed to 'completed', cancelled+archived to 'closed'; but the visible label is humanize(m.status) (page.tsx:197) so the text still distinguishes them; only the colour/variant merges. Cancelled/archived share 'closed' variant. Overstated: label distinction is not lost.
- **Files to change:** `apps/web/src/app/(app)/meeting/_data/format.ts`
- **Fix steps:**
  1. Optionally give cancelled its own variant (danger/muted) and archived muted.
  2. Keep labels via a status-label dictionary for translation.
- **Acceptance:**
  - Unit test meetingPillStatus('cancelled') != meetingPillStatus('archived') if separated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.

### GAP-MEETING-MEETINGS-05  ·  LOW  ·  partly  ·  theme A11Y (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Wide table uses overflowX:auto (page.tsx:60) with uppercase inline-styled headers instead of a stacked mobile layout; the trailing action cell has an empty <th> (page.tsx:69).
- **Verified evidence:** Table wrapper overflowX:auto (page.tsx:164) and inline uppercase label styles (:113-120) confirmed; the actions header is `<th style={labelStyle} />` empty at :173 (not :69). An empty th is an a11y nit (add visually hidden 'Actions'). No stacked mobile layout. Not a wiring defect.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/page.tsx`
- **Fix steps:**
  1. Add <span className="sr-only">Actions</span> in the last th.
  2. Move label style to a shared table class; optional card layout below 640px.
- **Acceptance:**
  - axe check: no empty table header.
  - 375px width readable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.


---
## /meeting/meetings/[meetingId]  —  `meeting/meetings-meetingId.html`

- **Source:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/page.tsx`
- **Design reference:** `redesign/meeting/meetings-meetingId.html`

### GAP-MEETING-MEETINGS-MEETINGID-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Conclude vote is a single click that closes voting and computes the result with no confirmation (MeetingConsole.tsx:678-690,771-777) while lesser actions (cast vote, adjourn) do confirm; a mis-click on a statutory resolution is irreversible. Start meeting and Move to minutes also skip confirmation (MeetingConsole.tsx:76-80,321-331).
- **Verified evidence:** Conclude vote: MeetingConsole.tsx button (:771-777) calls conclude() (:678-690) directly, no ConfirmDialog; cast vote does confirm (:785-800). Adjourn confirms via pendingTransition (:78, :323-331 branch on t.danger). Start meeting (:76) and Move to minutes (:80) have no danger flag and run onTransition directly. Confirmed. 'Irreversible' for conclude cannot be verified server-side, but the toast says result computed and no reopen action exists in UI.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/MeetingConsole.tsx`
- **Fix steps:**
  1. Add local state concludeConfirm in the vote card component and render <ConfirmDialog> (same props as cast dialog at :785) with copy 'Closes voting and computes the result; ballots can't be added afterwards'; call conclude() on confirm.
  2. Mark 'Move to minutes' as danger:true in nextTransitions (:80) with copy in transitionConsequence; consider confirm for Start meeting too (lighter, non-danger).
  3. Show tally counts in the conclude dialog.
- **Acceptance:**
  - Test: click Conclude vote, concludeVote not called until confirm; Cancel leaves vote open.
  - Test: Move to minutes opens dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Extra click during live meetings; keep dialog keyboard-friendly.

### GAP-MEETING-MEETINGS-MEETINGID-02  ·  HIGH  ·  partly  ·  theme NAMES (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Attendance table identifies each participant by raw employeeId/participantId UUID in mono (MeetingConsole.tsx:545-547); the secretary cannot tell who is who to run check-in/out - the core live task. Also personal-identifier exposure (DPDP) to any viewer.
- **Verified evidence:** MeetingConsole.tsx:550-554 shows p.employeeId || p.participantId in mono; AttendanceParticipant type (types.ts:102-110) has participantId, employeeId, role, isMandatory, status but no name field. Confirmed that raw ids are the identifier shown. Whether the attendance API returns names cannot be verified (meeting-service absent). The DPDP claim is overstated: an employeeId shown to authenticated meeting participants is not obviously a personal-data breach; a name resolution is the real need. No <Masked> component exists in ds.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/MeetingConsole.tsx`, `apps/web/src/app/(app)/meeting/_data/types.ts`, `apps/web/src/app/(app)/meeting/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with meeting-service whether attendance/live can include displayName/designation; else add a user-directory lookup by employeeId in the page loader.
  2. Extend AttendanceParticipant with displayName and map it in the attendance mapper; render name bold, employeeId as secondary caption.
  3. Fall back to id only when name is missing.
- **Acceptance:**
  - Test: participant with displayName renders name and employee id caption.
  - Manual: check-in list readable without UUIDs.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational.

### GAP-MEETING-MEETINGS-MEETINGID-04  ·  MEDIUM  ·  confirmed  ·  theme REALTIME (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A "live" console with no live data: no polling, SSE or router.refresh timer (only manual Refresh buttons, MeetingConsole.tsx:376,490); tallies and quorum can be stale in a room of several devices.
- **Verified evidence:** grep of MeetingConsole.tsx finds no setInterval, EventSource or timer; useRouter used only for retry (:429). Attendance (:490) and votes (:376) refresh only through manual Refresh buttons; tallies update after own actions via onChanged. Quorum/stat cards come from attendance state so are stale across devices.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/MeetingConsole.tsx`
- **Fix steps:**
  1. Add a useEffect polling fetchLiveAttendance and fetchActiveVotes (existing refreshAttendance/refreshVotes callbacks) every 5-10s while status==='in_progress' and document.visibilityState==='visible'.
  2. Pause while a request or dialog is open; back off on error.
  3. Show 'Updated hh:mm:ss' next to Refresh.
  4. Longer term: SSE channel if the gateway offers one (not verified).
- **Acceptance:**
  - Test with fake timers: callbacks called every interval when in_progress, not when adjourned.
  - Manual: two browsers, check-in on one, appears on other within interval.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Polling load per open console; keep interval >=5s.

### GAP-MEETING-MEETINGS-MEETINGID-05  ·  MEDIUM  ·  partly  ·  theme FAILMASK (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A real 404 (cancelled/missing meeting) and a transient failure are collapsed into one message "This meeting couldn't be loaded" (page.tsx:26-50); acknowledged in a comment but unsolved.
- **Verified evidence:** [meetingId]/page.tsx:39-63 returns one message for meeting.source==='error' || !meeting.data; the comment (:40-44) says 404 vs failure can't be told apart. But apiClient LoaderResult carries `status` (apiClient.ts:35,144 return status: response.status), and getMeeting uses fetchJson, so meeting.status===404 is available. Hence the limitation is stale and the fix is small. Not a dead route.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/page.tsx`
- **Fix steps:**
  1. Branch on meeting.status: 404 -> EmptyState 'Meeting not found or cancelled' with back link (no retry); 401/403 -> access denied; otherwise current RefreshErrorState.
  2. Update the comment.
- **Acceptance:**
  - Test: status 404 shows not-found copy with no Retry; status 503 shows retry.
  - Verify LoaderResult status propagates for getMeeting.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.

### GAP-MEETING-MEETINGS-MEETINGID-06  ·  LOW  ·  partly  ·  theme COPY (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Empty voting copy says "Open a resolution below" but the control is labelled "+ Open a vote" (MeetingConsole.tsx:388,856). Agenda status pills and attendance status are humanised raw tokens.
- **Verified evidence:** Empty vote copy MeetingConsole.tsx:388 'Open a resolution below' vs button '+ Open a vote' at :857 confirmed. Agenda/attendance status pills use humanize(item.status) (:478, :562) i.e. token to sentence case, works but not translated; no next-intl usage in the meeting module. Colour-only cue claim: StatusPill carries a text label, so not colour-only.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/MeetingConsole.tsx`
- **Fix steps:**
  1. Change copy to 'Use "Open a vote" below to start a motion.'
  2. If i18n is in scope, move strings to next-intl keys and map statuses via a label dictionary instead of humanize().
- **Acceptance:**
  - Copy names the actual button label.
  - Status labels come from a dictionary (test).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.

### GAP-MEETING-MEETINGS-MEETINGID-07  ·  LOW  ·  partly  ·  theme A11Y (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Dense single-column console with three tables/cards and inline-styled grids; no tabs or anchors, long on phones; VC link opens with rel="noreferrer" but no target/label for screen readers.
- **Verified evidence:** Console is a long single page of cards/tables with inline styles (confirmed by structure). VC link (:313-317) uses rel="noreferrer" with no target="_blank", so it opens in the same tab and leaves the console during a live meeting; text 'Join VC ↗' hints external. No tabs/anchors. Not a PII item.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/MeetingConsole.tsx`
- **Fix steps:**
  1. Add target="_blank" rel="noopener noreferrer" and aria-label 'Join video conference (opens in new tab)'.
  2. Add in-page anchor nav or Tabs (Agenda/Attendance/Voting) for narrow screens.
  3. Wrap wide tables in overflow container (already for some).
- **Acceptance:**
  - VC link opens new tab and console stays.
  - At 375px width sections reachable via anchors.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational.


---
## /meeting/meetings/[meetingId]/minutes  —  `meeting/meetings-meetingId-minutes.html`

- **Source:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/page.tsx`
- **Design reference:** `redesign/meeting/meetings-meetingId-minutes.html`

### GAP-MEETING-MEETINGS-MEETINGID-MINUTES-01  ·  HIGH  ·  confirmed  ·  theme DATALOSS (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Submit for approval" does not save the textarea: onSubmit calls submitMinutes(meetingId, id, minutes.version) only (MinutesPanel.tsx onSubmit) while Save draft is a separate button enabled only when content changed. A secretary who edits and clicks Submit sends the last saved version - unsaved text is silently left out of the record put before the chairperson.
- **Verified evidence:** MinutesPanel.tsx:96-110 onSubmit calls submitMinutes(meetingId, minutes.id, minutes.version) only; the textarea state 'content' (:42,:233) is sent solely by onSaveDraft (:77-94). Save draft is disabled unless content !== minutes.content (:273). Submit is enabled with unsaved edits (:278-283) so unsaved text is silently dropped. Data-loss/record-integrity issue, not a PII masking issue.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/MinutesPanel.tsx`
- **Fix steps:**
  1. In onSubmit, if content !== minutes.content: await updateMinutes(meetingId, minutes.id, {version:minutes.version, content}) first, then refresh() to get the new version before calling submitMinutes with the new version (202 queue: fetchMinutes and use returned version).
  2. Alternative: disable Submit while content is dirty and show 'Save draft before submitting'.
  3. Prefer a ConfirmDialog on submit showing that the saved version is what is submitted.
- **Acceptance:**
  - Component test: edit textarea, click Submit; assert updateMinutes called with new content before submitMinutes, or Submit disabled.
  - Manual: type text, submit, chairperson view shows the typed text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Version conflict: update returns 202 async; need refreshed version else submit fails on stale version.

### GAP-MEETING-MEETINGS-MEETINGID-MINUTES-02  ·  HIGH  ·  partly  ·  theme NAMES (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Drafter and Approver are printed as raw user-id strings (createdBy / approvedBy in mono, MinutesPanel.tsx dl block); a chairperson cannot see who drafted, and the maker-checker separation cannot be visually verified. Integrity hash and DSC signer are shown but not explained.
- **Verified evidence:** MinutesPanel.tsx:197-200 prints minutes.createdBy and approvedBy as raw ids in mono; confirmed. dscSignerName (:205-210) is a name; integrity hash (:211-216) shown with no explanation. The maker-checker separation is stated in text (:219-223) and enforced server-side per comment; server enforcement cannot be verified (meeting-service absent). Approve/reject already use ConfirmDialog (:322-348), so 'add ConfirmDialog' fix is already done; the real gap is name resolution. No name field exists on Minutes type (types.ts:197+); a user directory lookup endpoint is not visible in this snapshot.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/MinutesPanel.tsx`, `apps/web/src/app/(app)/meeting/_data/types.ts`, `apps/web/src/app/(app)/meeting/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend whether minutes payload can include createdByName/approvedByName, or which user-lookup endpoint to use.
  2. Map names in mapMinutes (loaders.ts:217) and Minutes type; render name with id as secondary/tooltip.
  3. Add helper text/tooltip explaining Integrity hash and DSC signer.
  4. Show a warning chip if createdBy === current user on Approve dialog.
- **Acceptance:**
  - Test: Minutes with createdByName renders name, not UUID.
  - Manual: hash tooltip explains hash chain.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational.
- **Depends on:** GAP-MEETING-MEETINGS-MEETINGID-02

### GAP-MEETING-MEETINGS-MEETINGID-MINUTES-04  ·  MEDIUM  ·  partly  ·  theme WORKFLOW (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A returned draft loses its reason: rejectionComments are sent to the service but never displayed on this page, so the secretary revising the draft cannot see why it came back (MinutesPanel.tsx runConfirmed / Minutes type has no rejection field).
- **Verified evidence:** rejectMinutes sends rejectionComments (MinutesPanel.tsx:121-124; client.ts:300-303). Minutes type and mapMinutes (loaders.ts:217+) have no rejection field, and the panel never shows one (grep for rejection in _data finds only client.ts). Confirmed on the frontend. Whether the service returns the comment in GET minutes cannot be verified (meeting-service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/MinutesPanel.tsx`, `apps/web/src/app/(app)/meeting/_data/types.ts`, `apps/web/src/app/(app)/meeting/_data/loaders.ts`
- **Fix steps:**
  1. Confirm GET /minutes returns rejectionComments (or a history); if not, request it from meeting-service.
  2. Add rejectionComments/rejectedAt/rejectedBy to Minutes and mapMinutes.
  3. In MinutesPanel when isDraft and rejectionComments present, render an alert banner 'Returned by chairperson: <comments>' above the textarea.
- **Acceptance:**
  - Test: draft with rejectionComments shows banner; without it none.
  - Manual: reject with reason, reload as secretary, reason visible.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Comments may contain sensitive text; show only to secretary/chair roles.

### GAP-MEETING-MEETINGS-MEETINGID-MINUTES-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** getMinutes conflates 404 (not drafted) with failure (page.tsx:35-37, comment); a real outage shows "No minutes drafted yet" with a Create button, inviting a duplicate draft. Refresh after each action uses a fixed 900 ms delay (REFRESH_DELAY_MS) rather than waiting on the 202.
- **Verified evidence:** minutes/page.tsx:36-38 comment: getMinutes returns source:error on both 404 and failure; :56-60 passes minutesReachable = source==='api' || data!==null, but MinutesPanel.tsx:137-160 still renders the Create minutes draft button when !minutes (only the title changes at :153). Note apiClient LoaderResult exposes `status` (apiClient.ts:35,144), so 404 vs outage IS distinguishable, contrary to the comment. REFRESH_DELAY_MS=900 fixed sleep at MinutesPanel.tsx:38,50 confirmed; refresh swallows failures (:57).
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/page.tsx`, `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/MinutesPanel.tsx`
- **Fix steps:**
  1. In page.tsx, treat minutes.source==='error' && minutes.status!==404 as outage: render <RefreshErrorState> instead of MinutesPanel (or pass minutesUnavailable prop).
  2. Only show Create button when status===404 (or source api with null).
  3. Replace fixed delay: poll fetchMinutes up to N times (e.g. 5 x 600ms) until version/status changes, show 'Processing...' meanwhile.
- **Acceptance:**
  - Test: getMinutes {source:'error',status:500} shows error + retry, no Create button; status 404 shows Create.
  - Test: refresh polls until status changes.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Duplicate minutes draft on outage is the current risk.
- **Depends on:** RefreshErrorState

### GAP-MEETING-MEETINGS-MEETINGID-MINUTES-06  ·  LOW  ·  partly  ·  theme OTHER (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Vote records table uses raw humanised result and inline styles with overflowX:auto (page.tsx:71-98); the "(—)" count on error is right but the meeting header has no status/date context.
- **Verified evidence:** Vote table (minutes/page.tsx:71-98 actual) renders humanize(r.result) through votePillStatus StatusPill (:387), which is fine; inline styles + overflowX:auto (:366) confirmed. '(—)' count on error (:350) confirmed. Header: PageHeader shows title only (:336-341) with no meeting status/date, though meeting is already fetched (:323). Not a date-format issue in the table; the missing context is a small gap.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/[meetingId]/minutes/page.tsx`
- **Fix steps:**
  1. Add subtitle or pill row from meeting.data: StatusPill meetingPillStatus(status) and fmtDateTime(scheduledAt).
  2. Optionally move inline styles to shared table class.
- **Acceptance:**
  - Minutes page header shows meeting status and IST date/time.
  - No change when meeting fetch fails (falls back to plain title).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.


---
## /meeting/meetings/new  —  `meeting/meetings-new.html`

- **Source:** `apps/web/src/app/(app)/meeting/meetings/new/page.tsx`
- **Design reference:** `redesign/meeting/meetings-new.html`

### GAP-MEETING-MEETINGS-NEW-01  ·  HIGH  ·  confirmed  ·  theme INPUT (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Chairperson, Secretary and Convener are free-text UUID fields with a 00000000-... placeholder (NewMeetingForm.tsx:343,368,393; validation "Enter a valid user ID (UUID format)"). Government clerks do not know user UUIDs; there is no employee search, so this form is unusable without copying ids from elsewhere. Wrong-but-valid UUIDs silently assign a stranger as chair.
- **Verified evidence:** NewMeetingForm.tsx: Chairperson/Secretary/Convener are type=text inputs with placeholder 00000000-0000-0000-0000-000000000000 (~:340-395), validated by UUID_RE with 'Enter a valid user ID (UUID format).' (:115-116). Only committees have a list loader (listCommittees, client.ts:120). No user search in meeting _data. A valid-but-wrong UUID is accepted. A user-directory endpoint is not visible in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/new/NewMeetingForm.tsx`, `apps/web/src/app/(app)/meeting/_data/client.ts`, `apps/web/src/app/_components/ds/UserPicker.tsx (new)`
- **Fix steps:**
  1. Confirm the user/employee search endpoint (hrms or identity via gateway).
  2. Create shared <UserPicker> (combobox, debounced search, returns id, shows name+designation) in ds.
  3. Replace the three inputs; keep UUID in form state; show selected name after choice.
  4. Add chair != secretary check in validate().
- **Acceptance:**
  - Test: typing 'ram' lists matches; selecting sets chairpersonId to UUID.
  - Manual: can't submit free text UUID.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Assigning chair is authority-bearing; picker must respect tenant scoping.

### GAP-MEETING-MEETINGS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** datetime-local is converted with new Date(value).toISOString() (NewMeetingForm.tsx:181) - browser-local interpretation with no explicit IST label; a clerk on a device with another zone schedules the wrong instant. Dates elsewhere use en-IN 24-hour format.
- **Verified evidence:** NewMeetingForm.tsx:181 scheduledAt: new Date(form.scheduledAt).toISOString() parses datetime-local in the browser's zone; no IST label or offset in the form. Display side fmtDateTime (format.ts:11-23) uses toLocaleString('en-IN') without timeZone, so it also follows the browser zone, not fixed IST.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/new/NewMeetingForm.tsx`, `apps/web/src/app/(app)/meeting/_data/format.ts`
- **Fix steps:**
  1. Add a shared helper istLocalToIso(value) that appends +05:30 (or uses Intl with timeZone Asia/Kolkata) and use it at :181.
  2. Set timeZone:'Asia/Kolkata' in fmtDateTime and show 'IST' suffix.
  3. Label the field 'Date and time (IST)'.
- **Acceptance:**
  - Unit test: '2026-09-01T10:00' converts to 2026-09-01T04:30:00.000Z regardless of TZ env.
  - Manual: change device TZ, scheduled time still IST.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Wrong instants for meetings; test with TZ env variants.

### GAP-MEETING-MEETINGS-NEW-03  ·  MEDIUM  ·  partly  ·  theme COPY (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Meeting type and confidentiality option labels come from raw enum tokens via humanize-less rendering (MEETING_TYPES, CONFIDENTIALITY_LEVELS, types.ts:34-50), e.g. "ad_hoc", "top_secret"; no explanation of what each confidentiality level restricts.
- **Verified evidence:** Options render humanize(t) (NewMeetingForm.tsx:263, :445) so labels are 'Ad hoc', 'Top secret' not raw tokens; the observation's 'humanize-less' claim is wrong. Valid part: no explanation of what each confidentiality level restricts (helper text absent near :433-450).
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/new/NewMeetingForm.tsx`
- **Fix steps:**
  1. Add helper text under the confidentiality select mapping each level to its effect (obtain wording from product/SECURITY.md).
  2. Optionally use a labelled dictionary rather than humanize().
- **Acceptance:**
  - Selecting 'Secret' shows its description.
  - Select has aria-describedby to the helper.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.

### GAP-MEETING-MEETINGS-NEW-04  ·  MEDIUM  ·  partly  ·  theme IDEMPOTENCY (was VALIDATION)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Submit failures display err.message verbatim (NewMeetingForm.tsx:199); no toHumanError mapping. POST has no idempotency key (client.ts:115 comment), so a double submit on a slow network can create two meetings.
- **Verified evidence:** Submit error uses err.message (NewMeetingForm.tsx ~:207) but client.send throws Error(readError('save')) built from toHumanError (client.ts:41-58,72), so the text is already plain-language; not raw. The idempotency point is true: createMeeting has no idempotency header (client.ts:115-120 comment; other POSTs use idempotencyKey()). Mitigation exists: both buttons disabled while busy (:480,486) and the busy flag stays true until after navigation delay, so single-page double click is blocked; retry after a timeout could still duplicate.
- **Files to change:** `apps/web/src/app/(app)/meeting/_data/client.ts`, `apps/web/src/app/(app)/meeting/meetings/new/NewMeetingForm.tsx`
- **Fix steps:**
  1. If meeting-service supports x-idempotency-key on create, add headers: idempotencyKey() in createMeeting and generate the key once per form mount (useRef) so retries reuse it.
  2. If not supported, request it from backend.
- **Acceptance:**
  - Test: two submits with same form use same header value.
  - Duplicate POST returns the same meeting.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Duplicate meetings notify attendees twice.

### GAP-MEETING-MEETINGS-NEW-05  ·  LOW  ·  partly  ·  theme DIRTYFORM (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A 202 with a fixed NAVIGATE_DELAY_MS pause then navigation; if the id is missing it sends the user to the list without confirming what was created (NewMeetingForm.tsx:190-197). Cancel discards silently without a dirty-form warning.
- **Verified evidence:** NewMeetingForm.tsx:55 NAVIGATE_DELAY_MS=900; after 202 it shows created alert then pushes to /meeting/meetings/{id} (:190-197) or the list when id missing (:200-204). The list fallback is silent (created flag already shows a success alert). Cancel (:484-490) does router.push without dirty check - confirmed; no beforeunload either. A ConfirmDialog with reason/maker-checker is not applicable.
- **Files to change:** `apps/web/src/app/(app)/meeting/meetings/new/NewMeetingForm.tsx`
- **Fix steps:**
  1. Track dirty = form differs from initial; on Cancel with dirty open <ConfirmDialog> 'Discard this meeting?'.
  2. Add beforeunload handler while dirty.
  3. In no-id branch change alert to 'Meeting scheduled - find it in the list'.
- **Acceptance:**
  - Test: edit title, click Cancel, dialog appears; Keep editing retains data.
  - Untouched form Cancel navigates immediately.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.


---
## Backend verification items (service code absent from snapshot)

### GAP-MEETING-HOME-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Counts are computed client-side from one unpaginated GET /api/v1/meeting (page.tsx:24-33); list limits/paging of the service are undeterminable (meeting-service absent), so "Total Meetings" may be a page size, not a total. "In Progress" costs a second identical-shaped request.
- **Service:** `meeting-service`  ·  **Endpoint(s):** `['GET /api/v1/meeting']`
- **Question:** Does the list endpoint paginate with a default limit, and does it return total or support status filter/count?
- **How to verify:** Open meeting-service list handler; curl GET with 150 seeded meetings and check length and meta.total.
- **Test to add:** Given 150 meetings, when GET list, then response includes total=150 (or all are returned); status=in_progress filter honoured.
- **Impact if wrong:** Wrong headline counts.
- **Web change if wrong:** Read total from meta and use a count endpoint or ?status= filter in meeting/page.tsx:24-33.

### GAP-MEETING-ADMIN-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No role gate on the page: every signed-in user with the module sees editable controls (admin/page.tsx:9-31). Whether meeting-service rejects non-admin writes and audits each setting change (CLAUDE.md: every mutation audited) cannot be verified - service absent from the snapshot.
- **Service:** `meeting-service`  ·  **Endpoint(s):** `['POST /api/v1/meeting/config', 'POST /api/v1/meeting/config/presets/:preset', 'GET /api/v1/meeting/config/:ns']`
- **Question:** Does config write require an admin role and write an audit row with before/after per setting?
- **How to verify:** Open meeting-service config routes (/v1/meetings/config); curl POST with normal user JWT expecting 403; check audit table.
- **Test to add:** Given non-admin token, when POST config, then 403; given admin, then 200 and audit meeting.config.updated with old/new value.
- **Impact if wrong:** Any user can change tenant meeting policy unaudited.
- **Web change if wrong:** Add requireAnyRole to meeting/admin/page.tsx and render read-only for others.

### GAP-MEETING-MEETINGS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** + New meeting is shown to every user (page.tsx:34-38); if the service restricts scheduling to secretariat roles the button will 403 for others. Role rules undeterminable.
- **Service:** `meeting-service`  ·  **Endpoint(s):** `['POST /api/v1/meeting']`
- **Question:** Which roles may create a meeting (secretariat only?) and what is the 403 body?
- **How to verify:** Open meeting-service create route guard; curl POST as employee.
- **Test to add:** Given employee token, when POST meeting, then 403 (or 201 if open policy documented).
- **Impact if wrong:** Confusing 403 for ordinary users.
- **Web change if wrong:** Hide + New meeting for unauthorised roles in meetings/page.tsx:34-38.

### GAP-MEETING-MEETINGS-MEETINGID-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Lifecycle, check-in/out, cast and conclude controls render for every viewer (MeetingConsole.tsx:315-341,571-590,730-777); the chair-only / secretary-only nature is not modelled in the UI, so non-authorised users get 403 errors printed as raw messages (MeetingConsole.tsx:228,262,275). Server-side checks and audit undeterminable (service absent).
- **Service:** `meeting-service`  ·  **Endpoint(s):** `['POST /api/v1/meeting/:id/transition', '/attendance/check-in', '/votes/cast', '/votes/:rid/conclude']`
- **Question:** Are lifecycle, cast and conclude restricted to the right roles (chair/secretary, eligible voter once) with audit?
- **How to verify:** Open meeting-service handlers; curl transition as attendee expecting 403; cast twice as same voter expecting 409.
- **Test to add:** Given non-member, when cast, then 403; duplicate cast gives 409; conclude by non-chair gives 403; each success audited.
- **Impact if wrong:** Vote tampering or unauthorised meeting state changes.
- **Web change if wrong:** Return permissions in meeting payload and hide controls in MeetingConsole.tsx:315-341,571-590,730-777.

### GAP-MEETING-MEETINGS-MEETINGID-MINUTES-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Approve minutes / Return to secretary render for every viewer of a submitted draft (MinutesPanel.tsx isSubmitted block) although the comment says approval is chairperson-only and drafter-excluded; other users get a raw error in the dialog (confirmErr = err.message). Server enforcement/audit undeterminable.
- **Service:** `meeting-service`  ·  **Endpoint(s):** `['POST /api/v1/meeting/:id/minutes/:minutesId/approve', 'POST .../reject']`
- **Question:** Does approve/reject enforce chairperson-only and drafter-excluded, return a coded 403, and audit?
- **How to verify:** Open meeting-service minutes approve handler; curl approve as drafter and as secretary expecting 403; as chair expecting 200.
- **Test to add:** Given drafter token, when approve, then 403 with code; chair approve writes audit meeting.minutes.approved.
- **Impact if wrong:** Self-approval of minutes; legal record integrity.
- **Web change if wrong:** Hide buttons unless viewer is chair and not drafter in MinutesPanel.tsx; map 403 to friendly text.


---
## Refuted by deep pass — do NOT implement

### GAP-MEETING-ADMIN-05 · /meeting/admin
- **First-pass claim:** Save failures show the raw exception message (err.message) to the clerk (AdminConfig.tsx:81,96); there is no toHumanError mapping.
- **Why refuted:** AdminConfig.tsx:81 and :96 do render err.message, but every error thrown from the data layer is already humanised: _data/client.ts:35-38 readError() builds toHumanError(kind,{area:'meeting data'}) and send() (55-65) / get() (67-71) throw new Error(readError('save'|'load')) on non-OK; raw server text/status is never included. The fallback strings ('Could not save this setting.') are plain language too. Only unexpected non-API exceptions (e.g. network TypeError) could leak a browser message; minor.
