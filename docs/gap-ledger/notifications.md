# Detailed gap file — module `notifications`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 45, BACKEND-VERIFY 5



---
## /notifications  —  `notifications/home.html`

- **Source:** `apps/web/src/app/(app)/notifications/page.tsx`
- **Design reference:** `redesign/notifications/home.html`

### GAP-NOTIFICATIONS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hub carries no signal: six static tiles with no counts, so a clerk cannot see failed deliveries or experiments awaiting approval without opening each page (page.tsx); the tile order puts the niche "A/B Experiments" first and the everyday Inbox second.
- **Verified evidence:** notifications/page.tsx:5-16 is a ModuleHub with six static links and no counts; ModuleHub supports a children slot (ModuleHub.tsx:26). Tile order puts experiments first (:9), Inbox second. No failed-delivery or awaiting-approval numbers are fetched. A count endpoint for failures is not confirmed in the snapshot (deliveries list exists at /notifications/deliveries).
- **Files to change:** `apps/web/src/app/(app)/notifications/page.tsx`
- **Fix steps:**
  1. Reorder links: Inbox, Send, Deliveries, Templates, Campaigns, Experiments.
  2. Make page async; fetch failed-delivery count and getNotificationExperiments() pending_approval count via loaders (fetchJson).
  3. Render children StatGrid above tiles with '—' on error and links to /notifications/deliveries and /experiments.
  4. Add a summary endpoint if list responses lack totals.
- **Acceptance:**
  - Component test: failed count and awaiting-approval count appear; fetch error shows '—'.
  - Manual: tile order matches everyday use.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-HOME-02  ·  MEDIUM  ·  partly  ·  theme LOADING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** loading.tsx is a tailwind block with min-h-screen and bg-slate-50 (loading.tsx) that fights the app shell background and is reused by every child route without its own loading file (campaigns/, compose/ have their own; hub inherits this) — it also ignores dark mode.
- **Verified evidence:** notifications/loading.tsx:3 uses min-h-screen bg-slate-50 with bg-slate-200 blocks and no dark variant (dark mode is a .dark class, civitas-ds.css:317). True, but it is not unique to the hub or inherited by children: list, compose, and campaigns/[id]/deliveries/[id] each have their own loading.tsx, and the ones checked (list/loading.tsx, compose/loading.tsx) copy the same min-h-screen/bg-slate-50 pattern. The hub shows a 72-unit table block though it is tiles only.
- **Files to change:** `apps/web/src/app/(app)/notifications/loading.tsx`, `apps/web/src/app/(app)/notifications/list/loading.tsx`, `apps/web/src/app/(app)/notifications/compose/loading.tsx`, `apps/web/src/app/_components/RouteSkeleton.tsx (new, shared)`
- **Fix steps:**
  1. Create a shared skeleton component using DS tokens (var(--line), var(--bg-soft)) with dark support.
  2. Replace the module's loading.tsx files with it, hub variant showing a 3x2 tile grid.
  3. Drop min-h-screen and bg-slate-50.
- **Acceptance:**
  - Manual: toggle dark mode and reload; skeleton has no white flash.
  - Skeleton shape matches hub tile grid.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-HOME-03  ·  LOW  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** not-found.tsx renders an EmptyState with no action (not-found.tsx), leaving the user on a dead end inside the module.
- **Verified evidence:** notifications/not-found.tsx:5-8 renders EmptyState with title and message only; EmptyState accepts an action prop (ds/EmptyState.tsx:8,40) and other pages pass one (templates/[id]/page.tsx:243).
- **Files to change:** `apps/web/src/app/(app)/notifications/not-found.tsx`
- **Fix steps:**
  1. Pass action={<a className='btn primary' href='/notifications'>Back to Notifications</a>} (use next/link) to EmptyState.
- **Acceptance:**
  - Manual: visit /notifications/nope; page shows a back link that navigates to the hub.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-HOME-04  ·  LOW  ·  confirmed  ·  theme NAVUX (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Settings (/tenant-admin/notifications) is linked from the Inbox page header (list/page.tsx) but not from the hub, so channel/provider configuration is undiscoverable from the module home.
- **Verified evidence:** list/page.tsx:77 links /tenant-admin/notifications as 'Settings'; the hub page.tsx:8-15 has no such tile. tenant-admin/page.tsx also links it.
- **Files to change:** `apps/web/src/app/(app)/notifications/page.tsx`
- **Fix steps:**
  1. Add { href: '/tenant-admin/notifications', label: 'Settings', note: 'Channels and provider configuration' } to ModuleHub links.
  2. Show only if user has tenant-admin role (reuse existing role guard) to avoid dead-end for clerks.
- **Acceptance:**
  - Manual: admin sees Settings tile and it opens channel config; non-admin doesn't see it.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /notifications/campaigns  —  `notifications/campaigns.html`

- **Source:** `apps/web/src/app/(app)/notifications/campaigns/page.tsx`
- **Design reference:** `redesign/notifications/campaigns.html`

### GAP-NOTIFICATIONS-CAMPAIGNS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error state contradicts itself: DataSourceBadge says "Couldn't load — showing nothing" (DataSourceBadge.tsx) while the card body says "Campaigns could not be loaded. Showing saved information." (CampaignList.tsx) under a title of "—"; the list never falls back to cached data, so the second sentence is false (the same UX-002 defect the badge comment documents).
- **Verified evidence:** CampaignList.tsx:65 shows DataSourceBadge 'Couldn't load - showing nothing' and line 77 EmptyState title '-' message 'Campaigns could not be loaded. Showing saved information.'; getCampaigns (campaigns.ts:253-263) has no cache, so the second sentence is false. Same contradiction the DataSourceBadge doc (DataSourceBadge.tsx:53-58, UX-002) describes. The create dialog repeats it at CampaignList.tsx:332 ('Templates could not be loaded - showing saved information').
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignList.tsx`
- **Fix steps:**
  1. Replace the EmptyState at line 77 with ds ErrorState (what/next/retry via load()) using toHumanError('load',{area:'campaigns'}); remove badge in card header for this case.
  2. Fix template-load copy at line 332 (and segments 412) to 'Templates could not be loaded. Try again.'; add retry.
  3. Keep 'No campaigns yet' only for source==='api' && length 0.
- **Acceptance:**
  - Force fetch failure: single error message, Retry button, no 'saved information'.
  - grep of CampaignList.tsx has no 'Showing saved information'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-02

### GAP-NOTIFICATIONS-CAMPAIGNS-02  ·  HIGH  ·  partly  ·  theme VALIDATION (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle says campaigns are planned "against an audience segment" but the create form makes Recipients (free-text list of raw emails/phones) mandatory and the segment optional (CampaignList.tsx): a segment does not replace recipients, so a citizen-scale campaign requires pasting contacts by hand into a textarea — personal data typed into an unbounded field with no consent or opt-out check visible.
- **Verified evidence:** Confirmed client-side: CampaignList.tsx:240-241 canSubmit requires recipientList.length>0 (comment at CampaignList/campaigns.ts:177 says backend requires >=1) while segment is optional (400); recipients is an unbounded textarea (346-356) with no maxLength, no email/phone validation, no consent/opt-out text. Page subtitle (campaigns/page.tsx:11) says 'against an audience segment'. Overstated: whether the backend expands a segment in addition to recipients cannot be verified (notification-service and v1/segments absent), so 'a segment does not replace recipients' is inferred from the required-recipient rule only.
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignList.tsx`, `apps/web/src/lib/notifications/campaigns.ts`, `apps/web/src/app/(app)/notifications/campaigns/page.tsx`
- **Fix steps:**
  1. Confirm with backend whether a segment can supply recipients; if yes make recipients optional when a segment is chosen (canSubmit logic + CreateCampaignInput).
  2. Validate each recipient token (email/E.164) and cap the count with a visible limit; show invalid tokens.
  3. Add helper text on consent/opt-out ('Only contact people who have consented') and a DPDP notice; do not persist typed recipients in localStorage.
  4. Align page subtitle with actual capability.
- **Acceptance:**
  - Choosing a segment with empty recipients submits (if backend allows).
  - Pasting 'abc' shows an invalid-recipient error.
  - Over-limit list blocked.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Personal data entered by hand; consent/opt-out enforcement must be server-side (cannot-verify).

### GAP-NOTIFICATIONS-CAMPAIGNS-03  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The ROI column contains no ROI: the list contract has none (comment at CampaignList.tsx), so every row shows a "View metrics" link under the header "ROI"; the same URL is linked three times per row (name, View metrics, Open — ), tripling tab stops.
- **Verified evidence:** CampaignList.tsx:93 header 'ROI'; cell at 110-114 is always a 'View metrics' link because the list contract has no ROI (comment 35-36). The same href /notifications/campaigns/${c.id} appears three times per row: name link (103), View metrics (111), Open button (116).
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignList.tsx`
- **Fix steps:**
  1. Remove the ROI column or rename it 'Metrics'; drop the duplicate 'View metrics' link.
  2. Keep the name link as primary and the Open button (or vice versa) - one link per row, or make the row clickable via DataTable rowHref.
  3. If ROI is wanted in list, request it from the list endpoint (backend) rather than N metrics calls.
- **Acceptance:**
  - Row has at most two tab stops to the detail route.
  - No 'ROI' header without ROI values.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-CAMPAIGNS-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Custom dialog closes on backdrop mousedown and Escape and discards all typed recipients/budget without a dirty-form warning (CampaignList.tsx), and is not the DS ConfirmDialog; no focus trap or return-focus is visible in the code.
- **Verified evidence:** CreateCampaignDialog (CampaignList.tsx:267-454) is a hand-rolled div.cd-overlay/cd-panel: onMouseDown on backdrop closes (273-275), document Escape closes (215-222), both discard state (form reset only on next open, 181-190) with no dirty check. role=dialog aria-modal present but no focus move, trap or return-focus code (contrast ds/ConfirmDialog.tsx:7-8,92-124, which has all of these). ConfirmDialog is not a form container, and no generic ds Modal exists in ds/ (listing checked).
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignList.tsx`, `apps/web/src/app/_components/ds/Modal.tsx`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Extract ConfirmDialog's focus-in/trap/restore/portal logic into a new ds <Modal> (or FormDialog) and re-use it in ConfirmDialog and CreateCampaignDialog.
  2. Track dirty state (any field non-empty); on Escape/backdrop/Cancel when dirty, ask window-style confirm ('Discard this campaign?') via ConfirmDialog.
  3. Do not close on backdrop mousedown while dirty.
- **Acceptance:**
  - Type in Name, press Escape: discard prompt appears; data kept on 'Keep editing'.
  - Tab cycles within dialog; focus returns to New campaign button on close.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; shared Modal touches other dialogs only if refactored.

### GAP-NOTIFICATIONS-CAMPAIGNS-05  ·  LOW  ·  partly  ·  theme PAGINATION (was MONEY)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Fetch is capped at 50 (getCampaigns limit=50, campaigns.ts) with no pager; cancelled/sent campaigns are mixed with drafts and there is no status filter; budgets are rendered with formatMoney (paise → ₹ lakh grouping) correctly.
- **Verified evidence:** getCampaigns(limit=50, offset=0) (campaigns.ts:253) and CampaignList.tsx:45 calls it with defaults, no pager; the API's `total` is captured (unwrapTotal) but never displayed. No status filter/sort in the table (86-123); mixed statuses. Budget uses formatMoney(c.budgetMinor) (line 109) on paise strings - correct, and create uses rupeesToMinorString - so the MONEY theme is a non-issue (positive finding). Severity low is appropriate.
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignList.tsx`, `apps/web/src/lib/notifications/campaigns.ts`
- **Fix steps:**
  1. Use the returned `total` to show 'Showing 50 of N' and add Previous/Next (getCampaigns already accepts offset).
  2. Add a Segmented status filter using CAMPAIGN_STATUSES and pass status to the API if supported (cannot-verify), else filter client-side.
  3. Default sort newest first if API does not.
- **Acceptance:**
  - With total>50, pager appears and page 2 loads offset=50.
  - Selecting 'Draft' shows only drafts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /notifications/campaigns/[id]  —  `notifications/campaigns-detail.html`

- **Source:** `apps/web/src/app/(app)/notifications/campaigns/[id]/page.tsx`
- **Design reference:** `redesign/notifications/campaigns-detail.html`

### GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error state contradicts itself on both cards: badge "Couldn't load — showing nothing" next to "Campaign could not be loaded. Showing saved information." under an em-dash title (CampaignDetail.tsx); nothing saved is shown, and a 404 for an unknown campaign id is indistinguishable from a failed load.
- **Verified evidence:** CampaignDetail.tsx:107 shows DataSourceBadge source='error' ('Couldn't load - showing nothing', DataSourceBadge.tsx:71/75) while line 126 shows EmptyState title '-' with 'Campaign could not be loaded. Showing saved information.' Nothing is cached (getCampaign in lib/notifications/campaigns.ts:265-275 is a plain browserFetch). Same contradiction for metrics at lines 184/192. getCampaign returns source 'error' for every !res.ok including 404 (campaigns.ts:268), so an unknown id equals a failed load. (page.tsx is a thin server wrapper; client component holds logic.)
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignDetail.tsx`, `apps/web/src/lib/notifications/campaigns.ts`
- **Fix steps:**
  1. In getCampaign/getCampaignMetrics return a `status` (or `notFound: true` when res.status===404) in LoaderResult.
  2. In CampaignDetail replace the EmptyState at 126 and 192 with ErrorState (ds) + onRetry=loadCampaign/loadMetrics and honest copy 'Campaign could not be loaded.'; drop the DataSourceBadge next to it and the 'Showing saved information' text.
  3. When 404, render 'Campaign not found' with back link to /notifications/campaigns.
- **Acceptance:**
  - Mock 500 => error state with Retry, no 'saved information' text; retry refetches.
  - Mock 404 => 'Campaign not found' state distinct from error.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Scheduled at goes through formatIndianDate (CampaignDetail.tsx; formatters.ts) which returns dd/mm/yyyy with no time, so a scheduled send at 10:00 vs 23:00 is indistinguishable — for the one field where the hour matters.
- **Verified evidence:** CampaignDetail.tsx:154 uses formatIndianDate(campaign.scheduledAt); lib/formatters.ts:2-7 uses toLocaleDateString en-IN with day/month/year only - no time, no explicit IST timeZone. A datetime-local value is submitted in CampaignList.tsx:257 as an ISO instant, so the hour is lost on display. Only formatIndianDate exists in formatters.ts; lib/admin/sftpIngestion.ts:280 has a local formatDateTime.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignDetail.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts: toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) with the same '-' / invalid fallbacks.
  2. Use it for Scheduled at (and Created) in CampaignDetail; add unit test in lib/__tests__.
- **Acceptance:**
  - formatIndianDateTime('2026-10-01T04:30:00Z') => contains '10:00'.
  - Detail shows time for a scheduled campaign.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; also reused by deliveries fixes (-DELIVERIES-DETAIL-06).

### GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme STATE (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Send and Cancel are disabled, not hidden, with no explanation (CampaignDetail.tsx, canSend/canCancel ); canCancel is true while status is "sending" so a half-sent campaign can be cancelled with the copy "will not be sent", and the dialog cancel label is "Keep editing" though nothing is editable.
- **Verified evidence:** Send/Cancel are always rendered when the campaign loaded and only disabled (CampaignDetail.tsx:162-174) with canSend = draft|scheduled (98) and canCancel = anything except cancelled/sent (99), so 'sending' is cancellable - TRUE. Dialog copy line 221 'will not be sent' and cancelLabel 'Keep editing' (224) for both dialogs - TRUE. No explanation of disabled state - TRUE. Corrections: the actions are already behind ConfirmDialog (214-231); the suggested theme fix (ConfirmDialog) is present but has no requireReason, and no audit/maker-checker is visible client-side (backend cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignDetail.tsx`
- **Fix steps:**
  1. Change canCancel to status in draft|scheduled (and 'sending' only if backend supports stop, else disallow).
  2. Hide Send/Cancel when not applicable, or keep disabled with aria-describedby text explaining why (e.g. 'Only draft or scheduled campaigns can be sent').
  3. Set cancelLabel to 'Go back' / 'Keep campaign'; for 'sending' use copy 'Messages already sent cannot be recalled'.
  4. Pass requireReason to the cancel ConfirmDialog and send reason to cancelCampaign only if the API accepts it (cannot-verify).
- **Acceptance:**
  - status='sending' => Cancel disabled or dialog shows partial-send warning.
  - Dialog cancel button reads 'Go back' not 'Keep editing'.
  - Disabled Send shows explanatory text.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Cancelling a mid-send campaign has business impact (partial delivery to citizens); backend semantics for cancel-while-sending unverifiable (notification-service absent).

### GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme UX-COPY (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Audience segment prints the raw segment id (CampaignDetail.tsx) rather than the name loaded for the create dialog from v1/segments; metrics show "0" placeholders before a first send with ROI "—", which reads as failure rather than "not started".
- **Verified evidence:** CampaignDetail.tsx:150 prints campaign.audienceSegmentId raw; names are available via getCampaignSegments() (campaigns.ts:301, GET v1/segments) already used by the create dialog (CampaignList.tsx:199-205). Metrics render numeric zeros (lines 202-206) and ROI '-' (209) for an unsent campaign - not distinguished from a failed/zero result; no 'not started' state when status is draft/scheduled.
- **Files to change:** `apps/web/src/app/(app)/notifications/campaigns/_components/CampaignDetail.tsx`
- **Fix steps:**
  1. Fetch segments in CampaignDetail (getCampaignSegments) and show the segment name, falling back to the id only if lookup fails.
  2. When status is draft or scheduled (and recipients===0) show a 'Metrics appear after the first send' note instead of the zero grid, or show '-' per metric.
  3. Keep ROI '-' but add title/aria explanation 'Not available until cost is recorded'.
- **Acceptance:**
  - Draft campaign shows note not zeros.
  - Campaign with segment id shows the segment name.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /notifications/compose  —  `notifications/compose.html`

- **Source:** `apps/web/src/app/(app)/notifications/compose/page.tsx`
- **Design reference:** `redesign/notifications/compose.html`

### GAP-NOTIFICATIONS-COMPOSE-02  ·  HIGH  ·  partly  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The template select lists every row of GET /notification/templates including superseded versions (page.tsx sets no status filter; Template.status is loaded), so retired wording can be sent to citizens; the option label shows the raw enum "(in_app)".
- **Verified evidence:** compose/page.tsx:62-74 loads /notification/templates and stores the list unfiltered; Template.status is declared (24) but never used; options (163-167) list `{t.name} ({t.channel})` so the raw enum 'in_app' shows. Templates page proves the same endpoint returns superseded rows (templates/page.tsx:21-23,57,70 uses supersededBy/status 'superseded'). Whether the send endpoint rejects superseded templates is cannot-verify (notification-service absent), so 'retired wording can be sent' is likely but unproven.
- **Files to change:** `apps/web/src/app/(app)/notifications/compose/page.tsx`
- **Fix steps:**
  1. Add supersededBy to the Template type and filter `templates.filter(t => !t.supersededBy && t.status !== 'superseded')` (keep status==='active' only if API always sets it).
  2. Format option label with humanizeStatus / a channel label map (reuse CHANNELS labels) instead of raw t.channel.
  3. Server should also reject superseded template on send (backend).
- **Acceptance:**
  - Fixture with one superseded template: not present in dropdown.
  - Option shows 'In-app' not 'in_app'.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Sending superseded wording to citizens; server-side guard unverified.

### GAP-NOTIFICATIONS-COMPOSE-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No required-variable handling or preview: templates contain {{placeholders}} (see templates detail) but the form sends only templateId + recipient (page.tsx), so the placeholders cannot be filled and the user cannot see what will be sent.
- **Verified evidence:** Client fact confirmed: send() body is only {templateId, recipient, channel?} (compose/page.tsx:99-100); the side card shows name/channel/subject only (221-227), no body or placeholders, and no variable inputs. Whether the send API accepts a variables/payload object cannot be verified (service absent), so the fix needs backend confirmation. Theme 'FABRICATED' is wrong - no fabricated data.
- **Files to change:** `apps/web/src/app/(app)/notifications/compose/page.tsx`
- **Fix steps:**
  1. Confirm the /notification/send schema for variables (backend).
  2. If supported: parse {{placeholders}} from the selected template body (template detail endpoint), render one labelled input per variable, and send them; block submit until all are filled.
  3. Render a preview of the substituted message in the 'About sending' card and in the ConfirmDialog.
  4. If not supported: show a notice that the template is sent with default values.
- **Acceptance:**
  - Selecting a template with {{name}} shows a 'name' input and preview.
  - Submit blocked until all variables are filled.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Blank placeholders sent to citizens (OTP/sanction notices).

### GAP-NOTIFICATIONS-COMPOSE-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Recipient is one unvalidated text field ("email address, phone number, or user handle", page.tsx) not checked against the chosen channel; a phone in an email send is accepted client-side and fails asynchronously in Deliveries.
- **Verified evidence:** Recipient input (compose/page.tsx:176-186) is type=text, only trimmed non-empty (87) with placeholder 'email address, phone number, or user handle'; channel is independent (196-206) and defaults to the template's, so no email/phone-vs-channel check exists client-side. Failure is asynchronous (page says so, 216-219). Server-side validation cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/notifications/compose/page.tsx`, `apps/web/src/lib/form-validation.ts`
- **Fix steps:**
  1. Compute effective channel = channel || selectedTemplate.channel.
  2. Validate recipient per channel (email regex, E.164/10-digit Indian mobile for sms/whatsapp, non-empty handle for in_app/push) using helpers in lib/form-validation.ts (add if missing).
  3. Show inline aria-invalid error and disable Review & send until valid.
  4. Adjust placeholder/help text to the effective channel.
- **Acceptance:**
  - Email channel + '9876543210' => inline error, button disabled.
  - SMS channel + valid mobile passes.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-COMPOSE-05  ·  LOW  ·  confirmed  ·  theme UX-COPY (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** User copy exposes transport detail: "The service accepts the request (HTTP 202)" (page.tsx); the confirm sentence prints the raw channel value ("over in_app"), and the template select stays selected after a successful send while the recipient is cleared, inviting an accidental repeat.
- **Verified evidence:** Copy 'The service accepts the request (HTTP 202)' at compose/page.tsx:218; ConfirmDialog description prints `over ${channel}` with the raw value (237, e.g. in_app); after success only setRecipient('') (113) - templateId and channel persist, so an immediate second submit needs only a new recipient (not an exact duplicate). The confirmation itself exists.
- **Files to change:** `apps/web/src/app/(app)/notifications/compose/page.tsx`
- **Fix steps:**
  1. Reword line 218: 'Notifications are queued and sent shortly; track them in Deliveries.'
  2. Use the CHANNELS label (or template channel label) in the confirm sentence.
  3. After success reset templateId/channel too (or keep with an explicit 'Send another' button).
- **Acceptance:**
  - No 'HTTP 202' string in DOM.
  - Confirm sentence reads 'over In-app'.
  - After send, form is in its initial state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /notifications/deliveries  —  `notifications/deliveries.html`

- **Source:** `apps/web/src/app/(app)/notifications/deliveries/page.tsx`
- **Design reference:** `redesign/notifications/deliveries.html`

### GAP-NOTIFICATIONS-DELIVERIES-01  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Recipient email/phone printed unmasked on every row (deliveries/page.tsx, column :105) — a delivery log is a complete list of who was contacted and where; no DPDP masking or role gate.
- **Verified evidence:** deliveries/page.tsx:51-59 maps d.recipient straight into the DataTable column (line 105) - no masking; filter box (114) also searches full recipients; list data is additionally persisted in the offline cache (useOfflineResource, lib/sync/resource.ts). No role gate.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/page.tsx`, `apps/web/src/lib/pii.ts`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. Use the shared maskEmail/maskPhone (see DETAIL-02) in the recipient column render.
  2. Ideally request masked recipients from the API and exclude recipients from the offline cache payload.
  3. Provide reveal per row for authorised roles with audit logging.
- **Acceptance:**
  - List shows masked recipients by default.
  - IndexedDB cache contains no full recipient (test).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; offline cache retains PII.
- **Depends on:** GAP-NOTIFICATIONS-DELIVERIES-DETAIL-02

### GAP-NOTIFICATIONS-DELIVERIES-02  ·  MEDIUM  ·  confirmed  ·  theme STATS (was NAVUX)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stats use exact matches on delivered/failed/pending (page.tsx) but StatusBadge also knows sent, queued and bounced (StatusBadge.tsx); those rows count in Total only, and bounced deliveries — resendable in the detail page — appear in no tile and no tab (TABS = All/Failed/Pending).
- **Verified evidence:** deliveries/page.tsx:42-44 count exact 'delivered'/'failed'/'pending'; StatusBadge.tsx:15-20 also defines sent, queued, bounced. TABS (31) = All/Failed/Pending with exact matches (61-66), so bounced/queued/sent appear only in Total/All. Detail page treats bounced as resendable (DD page.tsx:126).
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/page.tsx`
- **Fix steps:**
  1. Define status groups: delivered=delivered|sent; pending=pending|queued; failed=failed|bounced (shared constant beside StatusBadge).
  2. Use the groups for stat tiles and tab filters; optionally list bounced separately.
  3. Add a test asserting tiles sum to Total.
- **Acceptance:**
  - Fixture with bounced/queued/sent rows: tile sum equals Total; Failed tab includes bounced.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-DELIVERIES-04  ·  MEDIUM  ·  confirmed  ·  theme LOADING (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Counts describe the loaded page only (no limit/offset param in useOfflineResource path) and zeros render during loading, identical to an empty log.
- **Verified evidence:** useOfflineResource(path '/notification/deliveries') has no limit/offset (deliveries/page.tsx:34-38) so stats reflect whatever the API returns by default; initialData [] means tiles read '0' while loading (81-84 use deliveries.length) and, when error, tiles still show 0 while ErrorState renders (93). The card's empty state does distinguish loading, but the tiles do not.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/page.tsx`
- **Fix steps:**
  1. Show '-' in StatCards while `loading` or `error`.
  2. Add server pagination (limit/offset) if the API supports it, or a stats endpoint; label 'in this page' otherwise.
  3. Skeleton the StatGrid while loading.
- **Acceptance:**
  - While loading and on error tiles show '-'.
  - With >page size rows, tiles come from server totals (backend).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; server totals need backend (cannot-verify).

### GAP-NOTIFICATIONS-DELIVERIES-05  ·  LOW  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Header has no actions (no Send, no link to Templates) and back goes to /notifications/list rather than the module hub; "Delivered At" is "—" for failed and pending rows with no failure reason column, so causes need a click per row.
- **Verified evidence:** deliveries/page.tsx:70-74 PageHeader has back='/notifications/list' (the notifications inbox list, not the hub /notifications) and no `actions`; columns (103-110) have no failure-reason column and Delivered At is '-' for non-delivered rows (57). Theme DEADROUTE inaccurate: no dead link, just wrong/missing navigation.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/page.tsx`
- **Fix steps:**
  1. Set back='/notifications' backLabel 'Notifications'.
  2. Add actions: 'Send notification' -> /notifications/compose and 'Templates' -> /notifications/templates.
  3. Add a Failure reason column (short, catalogued text) if the list DTO carries it (cannot-verify), else leave to detail.
  4. Rename 'Delivered At' to 'Delivered' or show status-relevant timestamp.
- **Acceptance:**
  - Back goes to the hub.
  - Header shows Send and Templates actions.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /notifications/deliveries/[id]  —  `notifications/deliveries-detail.html`

- **Source:** `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`
- **Design reference:** `redesign/notifications/deliveries-detail.html`

### GAP-NOTIFICATIONS-DELIVERIES-DETAIL-01  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Resend" is a brand-new POST /notification/send carrying only templateId + recipient + channel (ResendAction.tsx): template variables and original payload are not re-sent, so an OTP, sanction or payslip notice can go out with blank placeholders, and the original row stays "failed" while a duplicate appears. Shown to any user who can open the page, with no role check (page.tsx).
- **Verified evidence:** ResendAction.tsx:218-222 posts only {templateId, recipient, channel?} to /notification/send; the original row is unchanged (copy at 235-236 says so) and a new delivery is created - TRUE. The 'blank placeholders' consequence depends on whether the template needs variables and whether the API can accept them: cannot-verify (notification-service absent; Delivery type in page.tsx:20-35 has no payload/variables field). The action is behind ActionButton/ConfirmDialog (ResendAction:230-240) but page.tsx:135-142 shows it to anyone who opens the page when status is failed|bounced; no role/permission check exists in the page (no hasPermission helper found in web src). Server enforcement cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/[id]/ResendAction.tsx`, `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`
- **Fix steps:**
  1. Confirm with backend whether the delivery row stores the rendered payload/variables and add a POST /notification/deliveries/:id/resend (idempotent, audit-logged) - or send stored variables.
  2. Until then, hide Resend for templates that require variables, or warn in the dialog.
  3. Gate the button behind the app's permission check (e.g. notification.send) and pass requireReason to ActionButton so the reason lands in the audit event.
  4. Link the new delivery in the success message (see -06).
- **Acceptance:**
  - User without send permission: no Resend button; API returns 403 if called.
  - Resend of a variable-based template preserves values (integration test).
  - Audit event with reason recorded (backend).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate or blank citizen notices; audit requirement (CLAUDE.md audit events).
- **Depends on:** GAP-NOTIFICATIONS-COMPOSE-03

### GAP-NOTIFICATIONS-DELIVERIES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Recipient phone/email shown in full in the Delivery card and again in the confirm dialog (page.tsx, ResendAction.tsx) — no masking or role gate for DPDP personal data.
- **Verified evidence:** DD page.tsx:149 renders delivery.recipient in full; ResendAction.tsx:235 prints it again in the confirm dialog. No masking helper or role gate exists in ds or this module; the only masking precedent is a local maskPhone in telephony/calls/page.tsx:36-41. Recipients are also stored unmasked in the offline cache by useOfflineResource on the list page.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`, `apps/web/src/app/(app)/notifications/deliveries/[id]/ResendAction.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/lib/pii.ts`
- **Fix steps:**
  1. Create lib/pii.ts (maskEmail: a***@d***.com, maskPhone: last 4) and ds <Masked value kind reveal /> with role-based reveal that emits an audit event through the existing audit client on reveal.
  2. Use <Masked> for Recipient on the detail page, the ResendAction dialog and deliveries list.
  3. Preferably have the API return masked values by default (backend).
- **Acceptance:**
  - Default render shows masked value; reveal requires permission and logs audit.
  - Unit tests for maskEmail/maskPhone edge cases.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; reveal must be audited.
- **Depends on:** GAP-NOTIFICATIONS-DELIVERIES-01

### GAP-NOTIFICATIONS-DELIVERIES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failure reason and Detail print the provider/backend error string verbatim (page.tsx), which may carry gateway internals; Template ID and Delivery ID are raw UUIDs (page.tsx) with no link to the template.
- **Verified evidence:** DD page.tsx:162-163 print delivery.error and errorDetail verbatim (visible to any viewer, whether 'failed' or 'bounced'); 158-159 show raw Delivery ID and Template ID in mono with no link. A templates detail route exists under notifications/templates (dir present) but is not linked. Content of provider errors cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`
- **Fix steps:**
  1. Map delivery.error to a catalogued message (lib/messages) and show errorDetail only in a collapsible 'Technical detail' section for admin roles.
  2. Show template name (fetch /notification/templates/:id) linking to /notifications/templates/<id>; keep the delivery id as a copy-able small 'Reference'.
- **Acceptance:**
  - Failure reason shows friendly text; detail hidden for non-admin.
  - Template row is a link to template detail.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not hide the error entirely from support roles.

### GAP-NOTIFICATIONS-DELIVERIES-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Attempts is retryCount ?? 0 (page.tsx) while the list column is attemptCount (deliveries/page.tsx): different field and possibly off-by-one; failed row shows "0" attempts when retryCount is absent.
- **Verified evidence:** Detail page.tsx:151 shows `delivery.retryCount ?? 0`; list (deliveries/page.tsx:16,56,107) uses `attemptCount` from NotificationDelivery (@civitasone/types, absent from snapshot). Detail type declares retryCount only (31). So two different field names is TRUE; 'off-by-one' and which the backend returns are cannot-verify. The '?? 0' fallback fabricating 0 attempts is real. Theme FAILMASK acceptable (fabricated zero).
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`
- **Fix steps:**
  1. Confirm field names with the notification-service delivery contract and share one DeliveryDto type between list and detail.
  2. Show `retryCount ?? attemptCount ?? '-'`; define attempts = retries+1 consistently if the backend counts retries only.
  3. Render '-' when neither field is present.
- **Acceptance:**
  - Payload without retryCount/attemptCount => '-'.
  - List and detail show the same number for the same delivery.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Misleading attempt counts in support triage.

### GAP-NOTIFICATIONS-DELIVERIES-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme ERRORS (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Errors other than 404 are collapsed to one fixed sentence (page.tsx); the resolved message from useFormError is stored but never rendered, and the not-found check compares a magic string "not_found" against the same error state (page.tsx), so a server message equal to that string would misroute.
- **Verified evidence:** DD page.tsx:65-69 sets error 'not_found' on 404; other failures store formError.fromResponse(...).message (72) or fromException (77) in `error`, but render (100-124) only tests truthiness/equality and shows a fixed sentence 'There was a problem loading this delivery. Please try again.' (110) - stored message never displayed. Magic string compare at 100/107/109 could misroute only if a catalogued message equals 'not_found' (unlikely; messages come from lib/messages). Try again button is provided (115). Low real impact; theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`
- **Fix steps:**
  1. Split state into `notFound: boolean` and `error: string|null`; render the resolved message (or drop the unused message plumbing).
  2. Handle 403 distinctly ('You don't have access').
- **Acceptance:**
  - 404 shows 'Delivery not found'; 500 shows the catalogued message with Retry; 403 shows access message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-DELIVERIES-DETAIL-06  ·  LOW  ·  confirmed  ·  theme DATEFMT (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** formatIndianDate drops the time (formatters.ts): Sent at / Next retry at / Created at cannot tell a 10:01 attempt from a 10:41 retry; the resend result is only announced in a live region and an inline line, with no link to the new delivery.
- **Verified evidence:** DD page.tsx:152-154 format Sent/Next retry/Created with formatIndianDate (formatters.ts:2-7, date only). ResendAction onSuccess (241-244) sets a text result and calls onResent -> load() which reloads the same delivery; the new delivery id is not known/linked (send returns 202, response body unused at 218-226). Theme DEADROUTE is wrong - no dead route.
- **Files to change:** `apps/web/src/app/(app)/notifications/deliveries/[id]/page.tsx`, `apps/web/src/app/(app)/notifications/deliveries/[id]/ResendAction.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Use the new formatIndianDateTime (see CAMPAIGNS-DETAIL-03) for the three fields.
  2. If the send response returns a delivery/message id, link to /notifications/deliveries/<id>; else link to the deliveries list filtered to this recipient.
  3. Drop the redundant sr-only status span (both spans announce the same text).
- **Acceptance:**
  - Dates show hh:mm IST.
  - After resend a link to deliveries is shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-03


---
## /notifications/experiments  —  `notifications/experiments.html`

- **Source:** `apps/web/src/app/(app)/notifications/experiments/page.tsx`
- **Design reference:** `redesign/notifications/experiments.html`

### GAP-NOTIFICATIONS-EXPERIMENTS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch reads as an empty program: loader returns [] on error (loaders.ts), the badge is shown (page.tsx) but stats print 0 and the table prints "No experiments — Create an A/B or multivariate experiment…" (page.tsx), inviting the user to create a duplicate.
- **Verified evidence:** experiments/page.tsx:11-13 uses data from getNotificationExperiments(); loaders.ts:3100 fetchJson falls back to [] with source 'error' (apiClient.ts:119-172). page.tsx:30 renders only DataSourceBadge on error, then :32-33 print data.length/awaiting (0) and :36-49 DataTable shows emptyTitle 'No experiments / Create an A/B...' as if none exist.
- **Files to change:** `apps/web/src/app/(app)/notifications/experiments/page.tsx`
- **Fix steps:**
  1. In ExperimentsPage compute errored = source === 'error'.
  2. Pass value={errored ? '—' : ...} to both StatCards (pattern used in plugins/installed/page.tsx).
  3. When errored render <RefreshErrorState error={toHumanError('load',{area:'experiments'})} /> inside the Card instead of DataTable.
  4. Keep DataSourceBadge; only show the create-hint empty state when source==='api' and rows are empty.
- **Acceptance:**
  - Unit/component test: mock loader {data:[],source:'error'} -> no 'No experiments' text, stat cards show '—', error state visible.
  - Manual: block /api/v1/notification/experiments; page shows retry error not empty program.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; avoids duplicate experiments being created after a fetch failure.
- **Depends on:** RefreshErrorState

### GAP-NOTIFICATIONS-EXPERIMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status column uses cellType "status" (StatusPill, colour + text) and pending_approval/running/concluded are missing from STATUS_MAP so all render in the neutral info colour (StatusPill.tsx map); statusLabel() ("Awaiting winner approval") exists but is only used in the footnote (page.tsx), so the table and legend use different wording, and other notification pages use the WCAG StatusBadge instead.
- **Verified evidence:** Table column uses cellType 'status' (page.tsx:39) -> DataTable.tsx:127 StatusPill. StatusPill.tsx STATUS_MAP (lines 5-39) has no pending_approval/running/concluded, so they fall to 'info' (line 53); label is humanizeStatus (e.g. 'Pending Approval') not statusLabel() 'Awaiting winner approval' (experiments.ts:7-20, used only in footnote page.tsx:52). Notifications module's other pages use StatusBadge (notifications/_components/StatusBadge.tsx), which also lacks these keys.
- **Files to change:** `apps/web/src/app/(app)/notifications/_components/StatusBadge.tsx`, `apps/web/src/app/(app)/notifications/experiments/page.tsx`, `apps/web/src/app/(app)/notifications/experiments/experiments.ts`
- **Fix steps:**
  1. Add pending_approval (warn), running (info), concluded (mut) entries to STATES in notifications/_components/StatusBadge.tsx (draft exists).
  2. In experiments/page.tsx replace cellType 'status' with render:(r)=><StatusBadge status={r.status} label={statusLabel(r.status)} />.
  3. Use statusLabel() for the legend so table and legend match.
  4. Do not edit shared StatusPill map unless other modules need it.
- **Acceptance:**
  - Component test: each of pending_approval/running/concluded/draft renders distinct variant class, icon and label matching statusLabel().
  - Manual: legend text equals the table label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-EXPERIMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Winner variant" prints the raw winnerVariantId (page.tsx), an opaque id with no variant name or lift metric, so approvers cannot see what won or by how much.
- **Verified evidence:** page.tsx:19 maps winner to e.winnerVariantId ?? '—' and prints it in column 'Winner variant' (:40). No variant name or lift is loaded. The NotificationExperiment type/zod schema (@civitasone/types, notificationExperimentListSchema) is not in the snapshot, so whether the API returns variant names or lift is cannot-verify for the field level.
- **Files to change:** `apps/web/src/app/(app)/notifications/experiments/page.tsx`, `packages/types (NotificationExperiment + zod schema)`
- **Fix steps:**
  1. Check the experiments API response for variants[] / lift fields; if absent add them in the notification service and zod schema (backend).
  2. Extend Row with winnerName and lift; render 'Variant B (+12.4% open rate)' or '—' when no winner.
  3. Fallback to the id in a muted secondary line only if name is missing.
  4. Move labels to next-intl keys.
- **Acceptance:**
  - Component test: experiment with winner shows name and lift; without winner shows '—'.
  - Manual: approver sees which variant won and by how much before approving.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval decisions depend on this data; wrong lift display would mislead approvers.

### GAP-NOTIFICATIONS-EXPERIMENTS-05  ·  LOW  ·  partly  ·  theme LOADING (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** loading.tsx is only <p>Loading experiments…</p> (loading.tsx), inconsistent with the skeleton pattern of siblings; hard-coded English, no next-intl keys; CSV export offered with no role or PII consideration (winner ids only, low risk).
- **Verified evidence:** experiments/loading.tsx is a single <p>Loading experiments…</p> in .page-main (true; siblings use pulse skeletons, though those are min-h-screen/bg-slate-50 blocks themselves). All strings in page.tsx are hard-coded English (no useTranslations). DataTable exportable (page.tsx:44) downloads CSV of name/status/winner id only - no PII, so the PII theme is wrong and risk is negligible.
- **Files to change:** `apps/web/src/app/(app)/notifications/experiments/loading.tsx`
- **Fix steps:**
  1. Replace loading.tsx with skeleton matching PageHeader + 2 StatCards + table (reuse the shared skeleton used by plugins/loading.tsx or a new shared <RouteSkeleton>).
  2. Optionally extract page strings into next-intl keys (only if module i18n is in scope).
  3. No CSV gating needed.
- **Acceptance:**
  - Manual: throttle network; skeleton shows header, two stat tiles, table rows; no layout jump.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /notifications/list  —  `notifications/list.html`

- **Source:** `apps/web/src/app/(app)/notifications/list/page.tsx`
- **Design reference:** `redesign/notifications/list.html`

### GAP-NOTIFICATIONS-LIST-01  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Recipient (email address or phone number) is printed verbatim for every row (list/page.tsx, column) with no masking or role gate — DPDP personal data for every notified person, visible to whoever opens the inbox; whether the endpoint is scoped to the caller is not verifiable (backend absent).
- **Verified evidence:** list/page.tsx:55 maps recipient: n.recipient and :117 prints it verbatim in a DataTable column; no masking or role check. Data comes from GET /notification/notifications; whether the service scopes it to the caller is cannot-verify (service absent). No shared <Masked> was found for tables (grep hits only in admin/integrations and hr Step4).
- **Files to change:** `apps/web/src/app/(app)/notifications/list/page.tsx`, `apps/web/src/app/_components/Masked.tsx (new or reuse)`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add maskRecipient() (a***@d***.com, XXXXXX1234) to formatters and use in tableRows.
  2. Add role-gated reveal (Masked component) that calls an audit-event endpoint on reveal.
  3. Confirm with backend that the endpoint returns only the caller's or tenant-permitted rows.
- **Acceptance:**
  - Unit test: maskRecipient for email and 10-digit mobile.
  - Manual: clerk role sees masked recipient; reveal logs an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP personal data; reveal must be audited per CLAUDE.md rules.
- **Depends on:** Masked

### GAP-NOTIFICATIONS-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was NAVUX)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Unread" tab is r.status !== "read" (page.tsx) so failed and queued events count as unread; and StatCards use exact-match statuses (sent/failed/read) so queued/pending/delivered events appear in Total but in no other tile.
- **Verified evidence:** list/page.tsx:63 Unread = r.status !== 'read', so failed/queued/sent all count as unread. Stats at :42-44 use exact matches sent/failed/read; Total (:88) is length, so queued/pending/delivered appear only in Total. StatusBadge knows delivered/pending/queued/bounced states.
- **Files to change:** `apps/web/src/app/(app)/notifications/list/page.tsx`
- **Fix steps:**
  1. Define Unread as status in {sent, delivered} (exclude failed/queued) or add a real read flag from API.
  2. Add tiles or compute 'Other/In progress' = total - sent - failed - read, or group delivered with sent.
  3. Extract a shared classifyStatus() helper in notifications/_components.
- **Acceptance:**
  - Unit test: array of sent/queued/failed/read/delivered yields tile counts summing to Total.
  - Failed events do not appear under Unread tab.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; counts change visibly.

### GAP-NOTIFICATIONS-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme CAP (was FAILMASK)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Counts are derived client-side from whatever the single fetch returned (no limit/offset in the request), so Total/Sent/Failed describe one page of results, not the inbox; loading also renders the same zeros as an empty inbox.
- **Verified evidence:** list/page.tsx:34-38 fetches '/notification/notifications' with no limit/offset; counts at :42-44,88 are computed from that response only; DataTable pageSize 15 is client paging. While loading, notifications=[] (initialData) so tiles show 0 (:88-91). Server pagination support is cannot-verify (service absent).
- **Files to change:** `apps/web/src/app/(app)/notifications/list/page.tsx`
- **Fix steps:**
  1. Show '—' in StatCards when loading or error.
  2. Request ?limit=&offset= and use API totals/aggregates for stats, or label tiles 'in this page'.
  3. Render RefreshErrorState on error (already ErrorState) and never zeros during loading.
- **Acceptance:**
  - Component test: loading state shows '—' not 0.
  - With >100 rows, Total reflects API total.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Misleading operational counts today.

### GAP-NOTIFICATIONS-LIST-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Provenance is shown as a plain amber sentence (page.tsx), not the DataSourceBadge used by sibling pages; a cache note and an ErrorState can coexist for different fetches and the page never says which data is stale.
- **Verified evidence:** list/page.tsx:46-49,82-86 renders provenance as an amber <p> with hard-coded #92400e; DataSourceBadge (with a provenance prop accepting useOfflineResource output) exists but within notifications only experiments/page.tsx uses it. There is only a single fetch on this page, so the claim that a cache note and ErrorState can be for different fetches is wrong; they can coexist for the same fetch.
- **Files to change:** `apps/web/src/app/(app)/notifications/list/page.tsx`, `apps/web/src/app/(app)/notifications/templates/page.tsx`
- **Fix steps:**
  1. Replace cacheNote paragraph with <DataSourceBadge provenance={...} cachedAt={cachedAt} offline={offline} /> fed from the same useOfflineResource call.
  2. Hide the cache note when error state is shown.
- **Acceptance:**
  - Manual: go offline; badge shows saved-data timestamp; no hard-coded colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-LIST-05  ·  LOW  ·  confirmed  ·  theme NAVUX (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Rows are not clickable (no rowHref) though deliveries and templates are; header actions are plain <a href> (page.tsx) causing full reloads instead of client navigation; dates show dd/mm/yyyy without time for events that are minutes old.
- **Verified evidence:** No rowHref on DataTable (list/page.tsx:113-127) whereas templates/page.tsx:123 and deliveries/page.tsx:112 have one. Header actions are <a href> (:75-78) causing full reload. Dates use formatIndianDate (date only, :58). No inbox detail route exists under notifications/list, so row links would need to target deliveries or a new detail page.
- **Files to change:** `apps/web/src/app/(app)/notifications/list/page.tsx`
- **Fix steps:**
  1. Replace <a> with next/link (or Button href) for the four header actions.
  2. Add rowHref to deliveries/[id] if events map to a delivery id (verify in API) or add a detail route.
  3. Use formatIndianDateTime for createdAt.
- **Acceptance:**
  - Manual: clicking Templates doesn't reload the shell; recent items show time.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /notifications/templates  —  `notifications/templates.html`

- **Source:** `apps/web/src/app/(app)/notifications/templates/page.tsx`
- **Design reference:** `redesign/notifications/templates.html`

### GAP-NOTIFICATIONS-TEMPLATES-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The module promises "Message templates and versions" (notifications/page.tsx) but no route creates, edits or activates a template; the compose page tells the user templates "are managed in the notification service" (compose/page.tsx). Template content is read-only and unmanageable from the app, so wording changes need engineering.
- **Verified evidence:** Notifications dir contains no create/edit/activate routes (templates/ has page and [id] only); both pages are read-only; compose/page.tsx:150 says 'Templates are managed in the notification service.' Whether the service exposes POST/PUT template endpoints is cannot-verify (service absent).
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/new/page.tsx (new)`, `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`, `apps/web/src/app/(app)/notifications/templates/page.tsx`
- **Fix steps:**
  1. Confirm with backend which template write endpoints and versioning semantics exist.
  2. Add /templates/new and edit (creating a new version) with zod-validated form (name, channel, subject, body with placeholder check).
  3. Add activate/retire actions with confirm dialog and audit event.
  4. Until then change hub note and compose message to say read-only.
- **Acceptance:**
  - Manual: authorised user creates a template and a new version; old one becomes superseded.
  - Zod rejects unknown placeholders.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Template wording is sent to citizens; needs approval workflow and audit.

### GAP-NOTIFICATIONS-TEMPLATES-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was VALIDATION)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Every version of every template is a row: a superseded v2 appears next to its active v3 with the same Name (page.tsx), and the list has no grouping or "latest only" default, so "Active" and "Total" double-count logical templates.
- **Verified evidence:** templates/page.tsx maps every returned row (:64-71) with no grouping; Total (:94) counts all rows, Active (:56) counts status==='active' (one per logical template, so Active does not double count) and Superseded counts the rest. Whether the API returns all versions in the list is cannot-verify. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/page.tsx`
- **Fix steps:**
  1. Default to latest-per-name (group by name+channel, keep max version) with a 'Show all versions' toggle.
  2. Relabel Total as 'Templates' using grouped count.
- **Acceptance:**
  - Unit test: v2 superseded and v3 active yield one row by default.
  - Toggle reveals all versions.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-TEMPLATES-03  ·  MEDIUM  ·  partly  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subject shows raw placeholders such as {{period}} and "—" for sms/in-app; channel is a lowercased key with underscores replaced (page.tsx) rather than a label.
- **Verified evidence:** Subject is printed as stored (:68, includes {{period}}) and '—' when null; channel is t.channel.replace(/_/g,' ') (:67), not lowercased by the code but shown as raw key like 'in app'/'sms'. Placeholders are legitimate template content, so only the channel label is a real gap. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/page.tsx`, `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`, `apps/web/src/app/(app)/notifications/list/page.tsx`
- **Fix steps:**
  1. Add channelLabel() map (email->Email, sms->SMS, in_app->In-app, push->Push, whatsapp->WhatsApp), reuse from compose CHANNELS.
  2. Use in list, detail and history tables.
- **Acceptance:**
  - Unit test: channelLabel('in_app') === 'In-app'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-TEMPLATES-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Counts reflect one unpaginated fetch (path has no limit/offset, page.tsx) and read as zeros while loading; the cache note is plain text, not a DataSourceBadge.
- **Verified evidence:** Fetch '/notification/templates' at :48-51 has no limit/offset; stats at :94-96 read 0 while loading (initialData []); cache note :88-92 is plain amber text (hard-coded #92400e). Server pagination support is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/page.tsx`
- **Fix steps:**
  1. Show '—' stats while loading/error.
  2. Swap cache note for DataSourceBadge provenance.
  3. Add limit/offset and use API total when available.
- **Acceptance:**
  - Component test: loading state shows '—'.
  - Offline: badge shows saved time.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-NOTIFICATIONS-LIST-04

### GAP-NOTIFICATIONS-TEMPLATES-05  ·  LOW  ·  confirmed  ·  theme ROLEGATE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Header action Send notification is a plain <a href> (page.tsx) not preselecting a template; no page-level role gate on who may send.
- **Verified evidence:** templates/page.tsx:86 uses <a className='btn primary' href='/notifications/compose'> with no template context (nothing to preselect at list level) and no role guard anywhere in the page. Server-side enforcement on /notification/send is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/page.tsx`
- **Fix steps:**
  1. Use next/link.
  2. Wrap the action in the shared role guard (e.g. notification.send permission) or hide for read-only roles.
  3. Verify the service enforces the permission.
- **Acceptance:**
  - Manual: read-only role does not see Send; POST /notification/send returns 403 for it.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Authorization must be enforced server-side.


---
## /notifications/templates/[id]  —  `notifications/templates-detail.html`

- **Source:** `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`
- **Design reference:** `redesign/notifications/templates-detail.html`

### GAP-NOTIFICATIONS-TEMPLATES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Send with this template" is a bare link to /notifications/compose (page.tsx); compose reads no query string and starts with an empty template select (compose/page.tsx), so the button loses the very context it names and the user must find the template again in a list that includes superseded versions.
- **Verified evidence:** templates/[id]/page.tsx:269 is <a href='/notifications/compose'> with no query; compose/page.tsx has no useSearchParams/searchParams (grep empty) and initialises templateId to '' (:352). Compose loads and lists all templates including superseded (no filter).
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`, `apps/web/src/app/(app)/notifications/compose/page.tsx`
- **Fix steps:**
  1. Link to /notifications/compose?templateId=${latest.id} (next/link).
  2. In compose read useSearchParams and initialise templateId if it exists in the loaded list.
  3. Filter the compose select to active, non-superseded templates.
- **Acceptance:**
  - Component test: /notifications/compose?templateId=X preselects X.
  - Manual: click button on a template; compose opens with it selected.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Sending wrong version is a comms risk.
- **Depends on:** GAP-NOTIFICATIONS-TEMPLATES-DETAIL-03

### GAP-NOTIFICATIONS-TEMPLATES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Send CTA stays on a superseded template: latest.supersededBy only changes the pill (page.tsx), not the action, so users can be sent from a retired version with no warning.
- **Verified evidence:** Page.tsx:269 CTA is unconditional; supersededBy affects only the StatusBadge (:274, :258). Also versions[0] is assumed latest, so the CTA could point at retired version. Compose does not filter superseded either.
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`
- **Fix steps:**
  1. Compute isSuperseded = !!latest.supersededBy || latest.status==='superseded'.
  2. If superseded, disable the CTA and show an alert with link to /notifications/templates/${latest.supersededBy}.
  3. Otherwise pass templateId per DETAIL-01.
- **Acceptance:**
  - Component test: superseded template renders disabled CTA with link to the replacement.
  - Active template CTA enabled.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Prevents sends from retired wording.
- **Depends on:** GAP-NOTIFICATIONS-TEMPLATES-DETAIL-01

### GAP-NOTIFICATIONS-TEMPLATES-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Version history lists channel, subject and status only (page.tsx) — no date, author or diff — and includes the current version as a row, so "history" cannot answer who changed the wording or when; the single-version test (history.length <= 1) therefore fires only for a template with exactly one row.
- **Verified evidence:** History table (:290-299) columns are version/channel/subject/status; TemplateView (:149-158) has no date, author or body diff fields, so adding them needs API fields (cannot-verify in absent service). The current version is included as a row (history built from all versions, :256) and the history.length <= 1 test (:287) is therefore consistent - it fires only for a single-version template, which is correct rather than a bug. Theme DATEFMT is wrong (no dates rendered).
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`, `notification service versions endpoint`
- **Fix steps:**
  1. Ask backend to return createdAt and createdBy per version in /versions.
  2. Add columns with formatIndianDateTime and author.
  3. Mark the current row with a 'Current' badge; optionally a body diff view.
- **Acceptance:**
  - Manual: history shows date and author of each version; current is flagged.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-NOTIFICATIONS-TEMPLATES-DETAIL-05  ·  LOW  ·  partly  ·  theme DARKMODE (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Body is shown as raw text with {{placeholders}} in a <pre> (page.tsx) using a hard-coded #f8fafc fallback background (ignores dark mode); errors reduce to one fixed sentence and the resolved message is unused.
- **Verified evidence:** <pre> at :280 uses background var(--bg-soft, #f8fafc); --bg-soft is not defined in civitas-ds.css, so the light fallback is always used and ignores .dark. Row label colour #667085 also hard-coded. Error branch sets error message from formError (:206,211) but :241-242 show fixed strings and never render it. Raw placeholders in <pre> is intentional. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/notifications/templates/[id]/page.tsx`
- **Fix steps:**
  1. Use var(--bg) / var(--line) tokens that have dark variants for the pre background and label colours.
  2. Render the resolved error message in the EmptyState message when error is set.
- **Acceptance:**
  - Manual: toggle dark mode; body block has dark background.
  - Force 500; shown message comes from formError.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Irreversible bulk send behind a single confirm: "Send campaign" queues messages to the whole audience (CampaignDetail.tsx) for any user reaching the page — no role gate, no maker-checker (contrast the experiments module, which requires an approval step), and no consent/DND or opt-out check is visible anywhere in the UI (DPDP marketing consent). Server-side enforcement undeterminable (notification-service absent).
- **Service:** `notification-service`  ·  **Endpoint(s):** `['PATCH notification/campaigns/:id/send', 'PATCH .../cancel']`
- **Question:** Does send require an approver role distinct from the creator, check consent/DND/opt-out per recipient, and audit with audience size?
- **How to verify:** Open notification-service campaigns send handler; curl PATCH send as creator expecting 403 if maker-checker; verify opt-out filtering in audience builder.
- **Test to add:** Given recipient with marketing opt-out, when campaign sent, then no message queued for them; sender=creator gets 403.
- **Impact if wrong:** DPDP consent breach and irreversible mass send.
- **Web change if wrong:** Add approval step and role gate in CampaignDetail.tsx; show audience count in confirm.

### GAP-NOTIFICATIONS-COMPOSE-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Any user reaching the page can send any template to any free-text recipient over any channel with two clicks (page.tsx); there is no role check, no recipient allow-list or count, no template-variable input and no visible rate limit or audit — a spam/phishing vector. Server-side guards are undeterminable (notification-service absent).
- **Service:** `notification-service`  ·  **Endpoint(s):** `['POST notification/send', 'GET notification/templates']`
- **Question:** Does send restrict roles, cap recipients, rate-limit per user and audit each send?
- **How to verify:** Open notification-service send handler; curl POST with employee JWT expecting 403; loop 100 requests expecting 429.
- **Test to add:** Given employee token, when POST send, then 403; admin over quota gets 429; success writes audit with recipient+template.
- **Impact if wrong:** Internal spam/phishing vector.
- **Web change if wrong:** Add role guard and recipient limits in compose/page.tsx.

### GAP-NOTIFICATIONS-DELIVERIES-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** List shows attemptCount while the detail page reads retryCount from the raw row (deliveries/[id]/page.tsx) — two field names for one concept from two shapes of the same service; detail "Attempts" can disagree with the list (retries vs attempts). Server contract undeterminable.
- **Service:** `notification-service`  ·  **Endpoint(s):** `['GET notification/deliveries', 'GET notification/deliveries/:id']`
- **Question:** Do list and detail use the same attempt counter field (attemptCount vs retryCount)?
- **How to verify:** Compare DTOs in notification-service; curl both for one failed delivery.
- **Test to add:** Given delivery retried twice, when GET list and detail, then both report the same attempts number under same key.
- **Impact if wrong:** Support sees contradictory retry counts.
- **Web change if wrong:** Read the correct key in deliveries/[id]/page.tsx.

### GAP-NOTIFICATIONS-EXPERIMENTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The approval workflow the page describes has no UI: subtitle and hub tile promise "approval-gated winner promotion" and the legend refers to "approve-winner" (page.tsx), yet the table has no row link, no Approve/Reject control and no detail route in the snapshot, so a reviewer cannot act on the "Awaiting approval" count from here (maker-checker step is invisible).
- **Service:** `notification-service`  ·  **Endpoint(s):** `['GET/POST notification experiments (approve-winner)']`
- **Question:** Does the service expose approve/reject-winner endpoints with role separation from the experiment creator?
- **How to verify:** Grep notification-service for approve-winner; curl as creator and as approver.
- **Test to add:** Given awaiting-approval experiment, when creator approves, then 403; approver gets 200 and audit.
- **Impact if wrong:** Winner promotion cannot be actioned; maker-checker not enforced.
- **Web change if wrong:** Add detail route with Approve/Reject in notifications/experiments/page.tsx.

### GAP-NOTIFICATIONS-TEMPLATES-DETAIL-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** versions[0] is assumed to be the latest (page.tsx) and the comment says the API returns latest first, but the client never sorts by version; if order differs the page shows an old body as "Current version" and offers to send it. Server ordering undeterminable (service absent).
- **Service:** `notification-service`  ·  **Endpoint(s):** `['GET notification/templates/:id/versions']`
- **Question:** Does versions endpoint return newest first with explicit version numbers?
- **How to verify:** Open versions query ORDER BY; curl for template with 3 versions.
- **Test to add:** Given versions 1..3, when GET versions, then first item version=3.
- **Impact if wrong:** Old body shown and sent as current.
- **Web change if wrong:** Sort by version desc client-side in templates/[id]/page.tsx.
