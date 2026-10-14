# Detailed gap file — module `visitor`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 19, BACKEND-VERIFY 5



---
## /visitor  —  `visitor/home.html`

- **Source:** `apps/web/src/app/(app)/visitor/page.tsx`
- **Design reference:** `redesign/visitor/home.html`

### GAP-VISITOR-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as an empty gate: on source "error" only the DataSourceBadge is added (page.tsx:45) while StatGrid still renders real zeros from the empty fallback (page.tsx:46-50, loaders.ts:101-113). A guard supervisor sees "Awaiting Approval 0 / Expected Today 0" during an outage.
- **Verified evidence:** visitor/page.tsx:37,45 adds DataSourceBadge on error, but lines 46-50 still pass pending.data.length / expectedToday / approved.data.length formatted as '0' (getVisitRequests returns [] on error, loaders.ts:101-113). StatCard would show '—' if given undefined (ds/StatCard.tsx:20-24). Also errors are combined so one failed status hides which count is unreliable.
- **Files to change:** `apps/web/src/app/(app)/visitor/page.tsx`
- **Fix steps:**
  1. Track pending.source and approved.source separately.
  2. Pass `undefined` to the affected StatCard values when their source==='error' (renders '—').
  3. Render `<RefreshErrorState error={{what:'We could not load visitor counts.', next:'Try again.', actions:['retry']}} />` in place of the page-level badge.
- **Acceptance:**
  - Page test with getVisitRequests -> {data:[],source:'error'}: stats show '—' and a Retry control; not '0'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents a supervisor reading a false 'no visitors' during outage.

### GAP-VISITOR-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Expected Today" uses isToday() with the server-process clock (format.ts:24-34, page.tsx:36) — a UTC Node host shifts the day boundary by 5h30m versus IST, mis-counting evening/early-morning visits.
- **Verified evidence:** format.ts:24-34 isToday compares getFullYear/Month/Date of `new Date(iso)` and `new Date()` in the server process timezone; visitor/page.tsx:36 and guard/page.tsx:15 use it. On a UTC host the day rolls at 05:30 IST. fmtTime/fmtDateTime (format.ts:3-21) also omit `timeZone`, so SSR vs browser render can differ. lib/formatters.ts formatIndianDate also has no explicit timeZone. Deployment TZ setting not verified.
- **Files to change:** `apps/web/src/app/(app)/visitor/_data/format.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add `IST = 'Asia/Kolkata'` (or tenant timezone from orgConfig) and implement isToday by comparing `new Intl.DateTimeFormat('en-CA',{timeZone}).format(d)` for the input and now.
  2. Pass `timeZone` to toLocaleTimeString/toLocaleString in fmtTime/fmtDateTime.
  3. Reuse the helper in visitor/page.tsx and guard/page.tsx.
- **Acceptance:**
  - Unit test with TZ=UTC: isToday('2026-09-29T19:00:00Z') at now=2026-09-30T02:00 IST (2026-09-29T20:30Z) is true.
  - fmtTime('2026-09-29T09:00:00Z') === '14:30' regardless of process TZ.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-VISITOR-HOME-04  ·  MEDIUM  ·  partly  ·  theme LABEL (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Approved (all)" counts every approved request ever returned (page.tsx:49) — includes past visits; the label gives no time scope and the fetch has no date filter.
- **Verified evidence:** visitor/page.tsx:49 counts approved.data.length from getVisitRequests('approved') (loaders.ts:101-113, only a status filter). The label already says 'Approved (all)', so scope is stated; the real issue is that the metric mixes past and future visits and never expires (no 'completed' status in VisitRequestStatus, types.ts), and page size caps in the API are unknown, so the count may be truncated.
- **Files to change:** `apps/web/src/app/(app)/visitor/page.tsx`, `apps/web/src/app/(app)/visitor/_data/loaders.ts`
- **Fix steps:**
  1. Replace with 'Approved - upcoming' counting scheduledAt >= start of today IST, or use a count/date-filter query if visitor-service supports it.
  2. If the API paginates, show a count from the response total instead of data.length.
- **Acceptance:**
  - Test: approved requests dated yesterday are excluded from the upcoming count.
  - Label matches the computation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-VISITOR-HOME-03

### GAP-VISITOR-HOME-05  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Console icons are emoji glyphs (🛂 ✅ ⚙️) with hard-coded English copy — no next-intl keys (page.tsx:9-25); loading.tsx is one unlabelled block that does not mirror the stat grid + tiles layout (loading.tsx:1-3).
- **Verified evidence:** Hard-coded English confirmed at visitor/page.tsx:9-28,43-49 and no next-intl in the visitor tree. Emoji glyphs (page.tsx:12,18,24) are aria-hidden, and StatCard's icon prop is a string across the DS, so they follow the design-system convention. loading.tsx is a single `.skeleton` block (so it does not mirror stat grid + 3 tiles) but it does carry aria-label='Loading…' (not unlabelled; aria-label on a plain div is not announced though). Same loading file pattern in guard/admin/host.
- **Files to change:** `apps/web/src/app/(app)/visitor/page.tsx`, `apps/web/src/app/(app)/visitor/loading.tsx`, `apps/web/src/app/(app)/visitor/guard/loading.tsx`, `apps/web/src/app/(app)/visitor/admin/loading.tsx`, `apps/web/src/app/(app)/visitor/host/loading.tsx`
- **Fix steps:**
  1. Add a `visitor` namespace to messages and use getTranslations in page.tsx for headings, console titles/descriptions and stat labels.
  2. Rewrite visitor/loading.tsx with SkeletonCard x3 in the StatGrid layout plus 3 tile skeletons; add role='status' and a visually-hidden 'Loading' text.
  3. Do the same for guard/admin/host loading.tsx to mirror their layouts.
- **Acceptance:**
  - Locale hi shows translated visitor home.
  - Throttled load shows stat + tile placeholders, announced as 'Loading'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-THEMES-HOME-04


---
## /visitor/admin  —  `visitor/admin.html`

- **Source:** `apps/web/src/app/(app)/visitor/admin/page.tsx`
- **Design reference:** `redesign/visitor/admin.html`

### GAP-VISITOR-ADMIN-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM (was PII)

- [x] **Status** (W2 PQ: closed by #2037)
- **W0-10 note:** review found the W0 tick partly — Preset now behind ConfirmDialog with requireReason (AdminConfig.tsx:338-358) but no from->to diff (retention 365->1825) or undo summary, and the reason is dropped: visitor-service POST /config/presets/:preset (config-registry/routes.ts:62-66, presets.ts applyPreset) ignores body so reason is never audited though the dialog says it is
- **First-pass claim:** A preset is one click with no confirmation (AdminConfig.tsx:120-126) yet "upserts the policies below" — retention, erasure SLA, auto-approval and anti-passback for the whole tenant are overwritten at once; DPDP retention (retention.pii_days, up to 1825 in the hospital preset) can change without a review step.
- **Verified evidence:** admin/AdminConfig.tsx:120-126 renders one plain `btn ghost` per preset whose onClick calls onApplyPreset -> applyPreset (client.ts:117-119, POST v1/visitor/config/presets/{preset}) immediately; text at lines 117-119 says presets 'upsert the policies below'. policy.ts:55-58 notes the hospital preset sets retention.pii_days to 1825. No confirm, diff or reason. Server-side audit/versioning cannot be verified (visitor-service absent).
- **Files to change:** `apps/web/src/app/(app)/visitor/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/visitor/_data/client.ts`, `apps/web/src/app/(app)/visitor/_data/policy.ts`
- **Fix steps:**
  1. Wrap each preset button in ds ActionButton with confirmTitle 'Apply {preset} preset?', requireReason, and a description listing keys that will change.
  2. Build the diff by comparing current `entries` to the preset values (expose preset values via GET presets endpoint if visitor-service provides one; otherwise add it, backend) and highlight retention.pii_days and erasure SLA changes.
  3. Send `reason` in applyPreset (extend client.ts + service schema) so the audit event carries it.
  4. After apply, show a toast with an Undo/“previous values” summary.
- **Acceptance:**
  - Component test: clicking a preset opens the dialog; the POST fires only after a reason is entered.
  - Manual: applying Hospital on a tenant with retention 365 shows 365 -> 1825 in the dialog.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP retention/erasure windows change tenant-wide; an accidental click alters PII retention.

### GAP-VISITOR-ADMIN-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Boolean toggles save immediately on click (AdminConfig.tsx:159-166) and the button label shows the current state ("On"/"Off") rather than the action, so Auto-approve VIP flips with no confirmation and an ambiguous label.
- **Verified evidence:** AdminConfig.tsx:159-166: the toggle is a `btn primary/ghost` whose onClick calls save(field, encodeBooleanValue(!current)) directly; its text shows current state ('On'/'Off'), and busy shows '…'. Applies to Auto-approve VIP/contractors/delegations (policy.ts:185-212) and Anti-passback (policy.ts:163-170), so security-relevant flags flip with one tap. setConfig (client.ts:94-108) sends no reason.
- **Files to change:** `apps/web/src/app/(app)/visitor/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/visitor/_data/client.ts`
- **Fix steps:**
  1. Render booleans as a switch (`role="switch" aria-checked={current} aria-label={field.label}`) so state and action are unambiguous.
  2. Route changes through ActionButton/ConfirmDialog with requireReason for APPROVAL_NS fields and for turning anti-passback off.
  3. Add optional `reason` to setConfig and forward it to POST v1/visitor/config (schema change in visitor-service).
  4. Keep the existing expectedVersion.
- **Acceptance:**
  - Component test: clicking the VIP switch opens a confirm dialog and does not call setConfig until confirmed with a reason.
  - Accessibility check: switch exposes aria-checked and its name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Auto-approval bypasses host approval; accidental enable is an access-control risk.
- **Depends on:** GAP-VISITOR-ADMIN-06

### GAP-VISITOR-ADMIN-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Number drafts are keyed and never cleared after a preset/reload (AdminConfig.tsx:53,172), so after "Apply preset" an edited field keeps showing the pre-preset typed value while the pill says the new version.
- **Verified evidence:** AdminConfig.tsx:53 keeps drafts keyed by namespace::configKey; line 172 reads `drafts[k] ?? String(currentNum)` and 195-198 writes drafts on change. onApplyPreset (96-109) and reload (61-71) never clear drafts, so a field the user edited before applying a preset keeps the typed value while the pill (186) shows the new version; Save stays enabled if draftNum differs from the new value.
- **Files to change:** `apps/web/src/app/(app)/visitor/admin/AdminConfig.tsx`
- **Fix steps:**
  1. Call `setDrafts({})` after a successful reload in onApplyPreset (and remove only the saved key after save()).
  2. Alternatively store drafts with the version they were based on and discard when entry.version changes.
  3. Show an 'unsaved change' hint when draft differs from stored value.
- **Acceptance:**
  - Component test: type 500 in a field, apply a preset, expect the input to show the preset value.
  - Test: after Save, draft cleared and Save button disabled.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-VISITOR-ADMIN-05  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Degraded state hides partial failure: the "Showing default policy" EmptyState needs initialSource==="error" AND zero entries (AdminConfig.tsx:129); if only one namespace fails, defaults render with "Default" pills as if they were live values (admin/page.tsx:14-17).
- **Verified evidence:** Real: AdminConfig.tsx:129 shows the 'Showing default policy' EmptyState only when initialSource==='error' AND entries.length===0; admin/page.tsx:15-16 merges both namespaces and sets one combined `source`. With one namespace failing, entries are non-empty, fields fall back to defaults (`Default` pill, lines 156/186). Overstated: page.tsx:26 does render DataSourceBadge ('Couldn't load — showing nothing') on any failure, so it is not fully hidden, but the wording is wrong (defaults are shown) and it does not say which group. Worse: Save on a defaulted field sends no expectedVersion (line 85), so it may overwrite a live value that failed to load (server behaviour unverified).
- **Files to change:** `apps/web/src/app/(app)/visitor/admin/page.tsx`, `apps/web/src/app/(app)/visitor/admin/AdminConfig.tsx`
- **Fix steps:**
  1. Pass per-namespace sources (policySource, approvalSource) from admin/page.tsx to AdminConfig.
  2. For a failed namespace render RefreshErrorState per affected group, show 'Not loaded' instead of the 'Default' pill, and disable its controls.
  3. Keep the empty-state text only when both loads failed; reword it to say saving is disabled until reload.
  4. Drop the page-level 'showing nothing' badge in favour of the per-group states.
- **Acceptance:**
  - Test: policy fetch fails, approval succeeds: policy groups show retry state and no editable inputs; approval groups editable.
  - Both succeed with no rows: 'Default' pills still shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Editing on top of unread values could overwrite tenant policy.

### GAP-VISITOR-ADMIN-06  ·  LOW  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Min/max bounds are client-only — policy.ts:23-31 states the service accepts arbitrary JSON per key; reload() hard-codes "visitor_policy" instead of POLICY_NS (AdminConfig.tsx:63); optimistic-lock conflicts (expectedVersion) surface only as a generic save error.
- **Verified evidence:** policy.ts:24-35 documents that bounds are UX-only and that the service accepts arbitrary JSON per key (server validation cannot be verified; visitor-service absent). AdminConfig.tsx:64 hard-codes 'visitor_policy', but POLICY_NS === 'visitor_policy' (policy.ts:11), so it is currently correct, only drift-prone (POLICY_NS not imported at line 8-13). save() passes expectedVersion (line 85) but client.ts:31-32 throws the same generic readError('save') for any non-2xx, so a version conflict is shown as a generic save error and the page is not reloaded.
- **Files to change:** `apps/web/src/app/(app)/visitor/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/visitor/_data/client.ts`, `apps/web/src/app/(app)/visitor/_data/policy.ts`
- **Fix steps:**
  1. Import POLICY_NS and use it in reload() (line 64).
  2. In client.ts post(), read the status: for 409 throw a typed ConflictError; in save() catch it, call reload() and show 'Someone else changed this setting; values refreshed, please review'.
  3. Add zod schema for numeric bounds in visitor-service config validators (backend) mirroring min/max in policy.ts, so bounds are enforced at the API boundary.
  4. Add a shared constant for bounds or generate them from the service.
- **Acceptance:**
  - Unit test: setConfig resolving 409 triggers reload and the conflict message.
  - Backend test: POST config with retention.pii_days=999999 returns 400.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Unvalidated retention/SLA values could be written by direct API calls; conflicts currently look like generic failures.
- **Depends on:** GAP-VISITOR-ADMIN-03


---
## /visitor/guard  —  `visitor/guard.html`

- **Source:** `apps/web/src/app/(app)/visitor/guard/page.tsx`
- **Design reference:** `redesign/visitor/guard.html`

### GAP-VISITOR-GUARD-02  ·  HIGH  ·  partly  ·  theme WIRING (was ROLEGATE)

- [x] **Status** (W1 SF-06 re-confirmed on this branch (gate id is now persisted and UUID-validated and the Location fallback is a picker; the Gate terminal ID is still typed because there is no gates list API): closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Gate terminal ID" is a hand-typed UUID with no gate list, no persistence and no validation (GuardConsole.tsx:175-183); verify/check-in/check-out all send it, and check-out silently sends "" when it is blank (GuardConsole.tsx:145) so a guard's first tap can fail with a generic save error.
- **Verified evidence:** GuardConsole.tsx:177-185 is a free-text 'Gate terminal ID' input (placeholder 'Gate UUID for this terminal'), state at line 56 with no persistence and no list; onVerify (111-114) only checks non-empty, no UUID validation. Check-in uses gateId.trim() (132), check-out `gateId.trim() || ""` (145) so a blank gate is sent. Correction: when check-out fails, onCheckOut sets rosterError (148) but rosterState stays 'ok', and rosterError is only rendered under rosterState==='error' (307-317), so the failure is silently swallowed, not shown as a generic save error. Whether a gates-list endpoint exists is unknown.
- **Files to change:** `apps/web/src/app/(app)/visitor/guard/GuardConsole.tsx`, `apps/web/src/app/(app)/visitor/_data/client.ts`, `apps/web/src/app/(app)/visitor/_data/loaders.ts`
- **Fix steps:**
  1. Validate gateId as UUID (zod) on change/submit and show an inline error; disable Check out until a valid gate is set.
  2. Persist gateId per location in localStorage (try/catch) so it survives reload.
  3. Show the check-out error visibly (separate `actionError` state rendered in an alert above the roster).
  4. If visitor-service exposes gates per location, add getVisitorGates loader and replace the input with a select (endpoint not verified).
- **Acceptance:**
  - Component test: blank gate -> Check out disabled; invalid UUID shows inline error.
  - Test: recordCheckOut rejecting shows an alert and the roster stays.
  - Manual: reload page; gate ID persists.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong gate on a check-in/out affects the occupancy/evacuation roster.

### GAP-VISITOR-GUARD-03  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: visitor phone numbers are printed in full to every viewer in the Expected today table (GuardConsole.tsx:286); no masking or role gate, and the roster fetch also carries contactNumber (types.ts:49) unused.
- **Verified evidence:** GuardConsole.tsx:286 prints v.visitorPhone in full to every viewer; guard/page.tsx passes complete VisitRequest objects (including visitorEmail, hostEmployeeId) into the client component, so all PII is serialised to the browser regardless of display. types.ts documents that PII 'arrives already decrypted'. RosterEntry.contactNumber is mapped (loaders.ts:76) but never rendered. There is no shared <Masked> component; only a local maskPhone in (app)/telephony/calls/page.tsx:37. Reveal audit/role gating are server-side and cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/visitor/guard/GuardConsole.tsx`, `apps/web/src/app/(app)/visitor/guard/page.tsx`, `apps/web/src/lib/mask.ts (new)`, `apps/web/src/app/_components/Masked.tsx (new)`
- **Fix steps:**
  1. Create lib/mask.ts (maskPhone keep last 4) and a <Masked value kind=phone canReveal onReveal> component in _components; refactor telephony/calls to use it.
  2. Map expectedToday to a slim DTO in guard/page.tsx (name, masked phone, purpose, category, scheduledAt, permittedAreas) so raw phone/email never reach the client.
  3. Add a reveal action that calls a role-gated endpoint and emits an audit event (backend).
  4. Drop contactNumber from mapRoster if not shown.
- **Acceptance:**
  - Unit test: maskPhone('9876543210') === 'XXXXXX3210'.
  - Manual: guard view shows masked phone; page source (RSC payload) contains no full phone/email.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of visitor contact data to all guard users.

### GAP-VISITOR-GUARD-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Overstay threshold is hard-coded to 8 hours (GuardConsole.tsx:28) while the admin screen governs check_in.overstay_grace_minutes and overstay_escalation_hours (policy.ts:118-141) — the two never meet, so configured policy has no effect on the flag.
- **Verified evidence:** GuardConsole.tsx:28 `const OVERSTAY_HOURS = 8` drives the Overstays stat (101-103) and per-row flag (337-338). Admin fields check_in.overstay_grace_minutes and check_in.overstay_escalation_hours exist at policy.ts:118-145 and are never read by the guard page (guard/page.tsx loads only locations and approved requests). Binding is not trivial: grace is 'after expected checkout' and RosterEntry (types.ts) has no expected-checkout/validUntil field.
- **Files to change:** `apps/web/src/app/(app)/visitor/guard/GuardConsole.tsx`, `apps/web/src/app/(app)/visitor/guard/page.tsx`, `apps/web/src/app/(app)/visitor/_data/types.ts`, `services/visitor-service (roster response)`
- **Fix steps:**
  1. Decide the overstay definition (checkIn + escalation hours? or expectedEnd + grace?).
  2. Load getConfigNamespace(POLICY_NS) in guard/page.tsx and pass the two thresholds to GuardConsole; replace OVERSTAY_HOURS.
  3. If expectedEnd is required, extend the roster response (visitor-service) with validUntil and add to RosterEntry/mapRoster.
  4. Show which threshold applies in the Overstays card hint.
- **Acceptance:**
  - Test: policy escalation=2h, visitor checked in 3h ago -> flagged; with 8h default not flagged.
  - Manual: change threshold on /visitor/admin and see the guard console update.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Security escalation may fire too late/early versus configured policy.
- **Depends on:** GAP-VISITOR-ADMIN-05

### GAP-VISITOR-GUARD-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Expected today is not scoped to the selected Location (page.tsx:15; GuardConsole.tsx:255) — a guard at one site sees every site's approved visitors; day boundary uses the server clock (format.ts:24-34).
- **Verified evidence:** guard/page.tsx:9-15 calls getVisitRequests('approved') with no location filter and filters only by isToday (line 15); GuardConsole.tsx:190,258 shows expectedToday.length and the table for all sites even though locationId state (55) selects a site and VisitRequest.locationId exists (types.ts). isToday (format.ts:24-34) uses `new Date()` in the server process timezone. Whether the API supports a locationId query parameter is not verifiable.
- **Files to change:** `apps/web/src/app/(app)/visitor/guard/GuardConsole.tsx`, `apps/web/src/app/(app)/visitor/guard/page.tsx`, `apps/web/src/app/(app)/visitor/_data/format.ts`
- **Fix steps:**
  1. In GuardConsole filter `expectedToday` with `r.locationId === locationId` via useMemo and use the filtered list for the stat, card title and table.
  2. Compute the day boundary in Asia/Kolkata (shared isTodayIST helper) - see GAP-VISITOR-HOME-03.
  3. If the API supports it, pass locationId to getVisitRequests for server-side scoping.
- **Acceptance:**
  - Component test: requests for locations A and B; selecting A lists only A's visitors and count.
  - Test isToday at 2026-09-29T20:00Z is false for UTC host but true in IST semantics.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Guards seeing other sites' visitor lists is a privacy leak (PII).
- **Depends on:** GAP-VISITOR-HOME-03

### GAP-VISITOR-GUARD-07  ·  LOW  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — tables now use the DS tbl-wrap class; no data-label/stacked-card variant below 640px, and the session-only Verified card is unchanged
- **First-pass claim:** Tables use bare className="tbl" with overflow-x scroll (GuardConsole.tsx:271,324) — no mobile row transform; "Verified (session)" is component state and resets on reload (GuardConsole.tsx:64).
- **Verified evidence:** Tables use className="tbl" wrapped in `<div style={{overflowX:'auto'}}>` (GuardConsole.tsx:270-271, 323-324): horizontal scroll, no responsive row transform (the DS .tbl-wrap class exists at civitas-ds.css:132 but is not used). 'Verified (session)' is useState (line 64) and resets on reload, but the label already says '(session)', so it is not misleading, just low value; there is no count endpoint verified.
- **Files to change:** `apps/web/src/app/(app)/visitor/guard/GuardConsole.tsx`
- **Fix steps:**
  1. Replace inline overflow wrappers with the DS `tbl-wrap` class and add data-label attributes / a stacked-card variant below 640px.
  2. Either drop the Verified card or back it with a server count (only if the service exposes verification counts; not verified).
- **Acceptance:**
  - Manual: at 375px width tables scroll inside the card without page-level horizontal scroll.
  - Card label unchanged or removed per decision.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /visitor/host  —  `visitor/host.html`

- **Source:** `apps/web/src/app/(app)/visitor/host/page.tsx`
- **Design reference:** `redesign/visitor/host.html`

### GAP-VISITOR-HOST-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: visitor phone and free-text purpose are printed in full for every request (HostPortal.tsx:125-131); no masking, retention hint or role gate on the visitor PII shown to whoever opens the page.
- **Verified evidence:** HostPortal.tsx:125 prints r.visitorPhone in full and :132 / :182 print r.purpose in the approval cards and the Expected-today table; no masking or retention hint. Overstated: this is the host's approval queue where seeing the visitor's contact is a business need, the page has no CSV export, and no shared <Masked> exists in ds (only page-local maskPhone in telephony/calls/page.tsx:37 and MaskedInput in hr Step4). Whether the API scopes rows or roles is cannot-verify (visitor service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/visitor/host/HostPortal.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx (props: value, kind 'phone'|'email', canReveal, onReveal) showing e.g. +91 98XXXXXX10 with a 'Show' button; export from ds/index.ts and reuse telephony maskPhone logic.
  2. In HostPortal card replace the raw {r.visitorPhone} with <Masked kind='phone' value=... /> and reveal on click.
  3. Optionally POST an audit event on reveal only if the visitor service exposes one (do not invent an endpoint; raise to backend).
  4. Add a short 'Contact details are visible to the host for this visit only' hint under the phone.
- **Acceptance:**
  - Component test: Masked shows only last 2 digits until Show is clicked.
  - Manual: Host portal card shows masked phone by default.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** PII/DPDP: masking may slow a host who needs to call the visitor; decide policy with the DPO before enforcing.

### GAP-VISITOR-HOST-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Expected today" claims "Your approved visitors" but is the tenant-wide approved list filtered only by day (host/page.tsx:15-16; HostPortal.tsx:166) with a server-clock isToday (format.ts:24-34).
- **Verified evidence:** host/page.tsx:10-15 loads getVisitRequests('approved') (loaders.ts:101-113 builds /api/v1/visitor/visit-requests?status=approved with no host/employee param) and filters only by isToday. isToday (format.ts:24-34) uses new Date() in the Node server runtime, so the day boundary follows server TZ, not IST. Copy at HostPortal.tsx:166 (line ~202 in file) says 'Your approved visitors'. Whether the API itself scopes to the caller is cannot-verify (visitor service absent); client sends no host filter and VisitRequest.hostEmployeeId is available.
- **Files to change:** `apps/web/src/app/(app)/visitor/host/page.tsx`, `apps/web/src/app/(app)/visitor/_data/format.ts`, `apps/web/src/app/(app)/visitor/_data/loaders.ts`
- **Fix steps:**
  1. Get the current user's employee id (session helper used elsewhere in (app)) and filter approved.data by r.hostEmployeeId === me, or pass a host query param if backend supports it (confirm with backend).
  2. Make isToday timezone-explicit: compare formatted dates with Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).
  3. If the user is an admin/reception role, show a 'All hosts' toggle and relabel the card 'Expected today (all hosts)'.
- **Acceptance:**
  - Unit test isToday with 2026-09-29T19:00:00Z (IST 30 Sep) returns false on 29 Sep IST and true on 30 Sep.
  - Component test: rows of another host are not listed.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong host filter could hide a visitor from their host; test with delegated hosts.

### GAP-VISITOR-HOST-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Requests show no location or pass type although the model carries locationId/passType (types.ts:30-32), and multi-site tenants cannot tell which premises a visitor is coming to; hostEmployeeId is never displayed.
- **Verified evidence:** types.ts:28-30 defines hostEmployeeId, locationId, passType; HostPortal.tsx renders none of them (cards :156-186, table :204-224 show name, phone, category, purpose, time, ref, zone only). getVisitorLocations() exists in loaders.ts:116 to resolve names.
- **Files to change:** `apps/web/src/app/(app)/visitor/host/page.tsx`, `apps/web/src/app/(app)/visitor/host/HostPortal.tsx`
- **Fix steps:**
  1. In page.tsx call getVisitorLocations() in the Promise.all and pass a locationName map to HostPortal.
  2. Show 'Premises: <name>' and 'Pass: <passType>' (title-cased) in the card meta row and add Premises/Pass columns to the Expected-today table.
  3. Hide the location line when the tenant has a single location.
  4. Do not print hostEmployeeId raw; show host name only if the API returns it (otherwise skip, since the list is the host's own).
- **Acceptance:**
  - Component test: card shows location name and pass type from props.
  - Manual: multi-site tenant shows different premises per request.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; one extra loader call, degrade gracefully if locations fail.

### GAP-VISITOR-HOST-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Restricted-zone approvals only warn that a second approver follows (HostPortal.tsx:138-142); permittedAreas (which zones) is never listed, so the host approves blind.
- **Verified evidence:** HostPortal.tsx:173-177 (file lines 138-142 in numbering of the observation) shows a generic warning when permittedAreas.length>0; the array (types.ts:33, string[]) is never rendered, and the table only shows 'Restricted'.
- **Files to change:** `apps/web/src/app/(app)/visitor/host/HostPortal.tsx`
- **Fix steps:**
  1. Render r.permittedAreas as a comma list or pills inside the restricted-zone warning.
  2. Include the zone list in the Approve ConfirmDialog description.
  3. In the Expected-today table show the first zone plus '+N' in the Zone cell.
- **Acceptance:**
  - Component test: request with permittedAreas ['Server room','Vault'] shows both names in card and dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Values may be ids not names; verify API returns labels, else needs backend.

### GAP-VISITOR-HOST-06  ·  LOW  ·  partly  ·  theme FEEDBACK (was NAVUX)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — toast auto-dismiss + stale-list notice done, but table only wrapped in .tbl-wrap (overflow-x:auto, civitas-ds.css:138); no stacked mobile layout so acceptance (no sideways scroll at 375px) unmet (HostPortal.tsx:220)
- **First-pass claim:** Toast persists until reload (no timeout, HostPortal.tsx:96-100); background refresh failure after an action is swallowed (HostPortal.tsx:54-60); request cards and tables are inline-styled with bare "tbl" and no mobile transform (HostPortal.tsx:169).
- **Verified evidence:** Confirmed: toast (HostPortal.tsx:132-136 in file, setToast at :107/:110) is never cleared; refresh() catch (:94-97) swallows background failure by design (comment :83-88); the table is `className='tbl'` inside overflowX:auto (:204-205), cards fully inline styled - no mobile card transform. Not true: PageHeader already gets back='/visitor' (page.tsx:21-26), so the suggested back link is present. A ds/Toast.tsx exists.
- **Files to change:** `apps/web/src/app/(app)/visitor/host/HostPortal.tsx`
- **Fix steps:**
  1. Replace local toast with ds Toast (or setTimeout clear after ~5s in a useEffect).
  2. On background refresh failure after an action, show a non-blocking notice 'List may be out of date - Refresh'.
  3. Extract the card styles to CSS classes / ds classes; wrap table in .tbl-wrap and add a stacked layout under 768px.
- **Acceptance:**
  - Component test with fake timers: toast disappears after timeout.
  - Manual: at 375px width the expected table does not scroll sideways.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-VISITOR-HOME-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No role gate anywhere in the segment: visitor/layout.tsx is ModuleGate only, so every tenant user gets the Admin Configuration tile and Guard Console. Whether services/visitor-service rejects non-admin writes is undeterminable (service absent from snapshot).
- **Service:** `visitor-service`  ·  **Endpoint(s):** `['POST /v1/visitor/config', 'POST /v1/visitor/check-ins', 'POST /v1/visitor/visit-requests/:id/approve']`
- **Question:** Does visitor-service enforce per-endpoint roles (admin, guard, host) rather than trusting the web tiles?
- **How to verify:** Open visitor-service route guards; call each mutation with a token lacking the role.
- **Test to add:** Given employee token without visitor roles, when POST config/check-ins/approve, then 403 for each.
- **Impact if wrong:** Privilege escalation across visitor functions.
- **Web change if wrong:** Add role-gated layouts for visitor/admin and visitor/guard; show tiles only for permitted roles in visitor/page.tsx.

### GAP-VISITOR-ADMIN-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No role gate on the segment (visitor/layout.tsx is ModuleGate only); any user who can open /visitor/admin can POST config. Service enforcement and audit-logging of config writes are undeterminable (services/visitor-service not in snapshot).
- **Service:** `visitor-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/visitor/config (client.ts setConfig)', 'GET /api/v1/visitor/config/:namespace']`
- **Question:** Does POST /v1/visitor/config require an admin role, honour expectedVersion (409 on stale) and emit an audit event with old/new value?
- **How to verify:** Open visitor-service config-registry route and guard; POST as guard/host token and admin token.
- **Test to add:** Given host-role token, when POST /v1/visitor/config, then 403; admin write emits config.changed audit with before/after and stale expectedVersion returns 409.
- **Impact if wrong:** Any tenant user can change visitor approval/security policy without trace.
- **Web change if wrong:** Add requireAnyRole gate in visitor/admin (page or admin/layout.tsx) and hide the Admin tile in visitor/page.tsx.

### GAP-VISITOR-GUARD-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The roster behind "Inside Now", "Overstays" and Check out is an emergency break-glass endpoint that is fail-closed IP-allowlisted (loaders.ts:128-136); from an ordinary BFF the guard console's core panel lands in ErrorState with "emergency IP allowlist" text (GuardConsole.tsx:308-318). Service side is undeterminable (visitor-service not in snapshot).
- **Service:** `visitor-service`  ·  **Endpoint(s):** `['GET /api/v1/visitor/evacuation/roster?locationId= (loaders.ts:138)']`
- **Question:** Is the emergency roster fail-closed IP-allowlisted by design, and does a normal (non-break-glass) roster/inside-now endpoint exist for guards?
- **How to verify:** Open visitor-service evacuation route and IP allowlist middleware; list routes for a non-emergency inside-now query (e.g. check-ins?status=inside); curl roster from BFF IP.
- **Test to add:** Given request from non-allowlisted IP with guard role, when GET evacuation/roster, then 403 and audit; a separate guard roster endpoint returns current occupants.
- **Impact if wrong:** Guard console core panel is permanently broken, or the break-glass roster gets opened to ordinary traffic.
- **Web change if wrong:** Switch GuardConsole/getRoster to a non-emergency inside-now endpoint; keep evacuation roster for a break-glass flow only.

### GAP-VISITOR-GUARD-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Check out (GuardConsole.tsx:348) and Admit & check in (GuardConsole.tsx:241) are single-tap mutations with no ConfirmDialog; audit trail on POST /check-ins|/check-outs is undeterminable here.
- **Service:** `visitor-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/visitor/check-ins', 'POST /api/proxy/v1/visitor/check-outs (client.ts:59,63)']`
- **Question:** Do check-in and check-out emit an audit event (actor, passId, gateId, timestamp), reject duplicates idempotently, and require guard role?
- **How to verify:** Open visitor-service check-ins/check-outs routes; call twice with same passId; check audit emission and role guard.
- **Test to add:** Given a pass already checked in, when check-in is POSTed again, then 409 (or same result idempotently) with one audit event; check-out for a non-checked-in pass gives 409; non-guard gets 403.
- **Impact if wrong:** Wrong occupancy roster and no audit trail for physical access.
- **Web change if wrong:** Add ConfirmDialog to Check out (GuardConsole.tsx:348) and Admit (GuardConsole.tsx:241) or an undo path.

### GAP-VISITOR-HOST-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Awaiting Your Approval" is not scoped to the host: page.tsx fetches all pending_approval requests (host/page.tsx:12, loaders.ts:101-113 — no hostEmployeeId param) and HostPortal renders Approve/Reject on every one. Unless the service filters by caller (undeterminable, visitor-service absent), any user can approve visitors raised for others.
- **Service:** `visitor-service`  ·  **Endpoint(s):** `['GET /api/v1/visitor/visit-requests?status=pending_approval (loaders.ts:106)', 'POST /api/proxy/v1/visitor/visit-requests/:id/approve|reject (client.ts:76-80)']`
- **Question:** Does the list endpoint scope pending_approval to the calling host (or accept hostEmployeeId), and does approve/reject verify caller is the request's host or a delegate/admin?
- **How to verify:** Open visitor-service visit-requests list and approve handlers; as host A, list pending and approve a request whose host is B.
- **Test to add:** Given request raised for host B, when host A POSTs approve, then 403 and it stays pending_approval; host A's list excludes it.
- **Impact if wrong:** Any user can approve visitors for others: unauthorised premises access.
- **Web change if wrong:** Pass hostEmployeeId (from session) in getVisitRequests in host/page.tsx and hide Approve/Reject for rows not owned by the user.
