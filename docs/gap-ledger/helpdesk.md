# Detailed gap file — module `helpdesk`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 66, BACKEND-VERIFY 1



---
## /helpdesk  —  `helpdesk/home.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/page.tsx`
- **Design reference:** `redesign/helpdesk/home.html`

### GAP-HELPDESK-HOME-01  ·  HIGH  ·  partly  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status counts, SLA Breach % and Total Tickets are computed client-side from one unpaginated GET /api/v1/citizen/tickets (page.tsx:14-20, loaders.ts:3258-3263), while loaders.ts:3279-3283 documents that citizen-service returns a paginated {data, pagination} envelope. On a tenant with more tickets than one page the headline numbers are silently truncated; analytics already exposes totalTickets/openTickets/slaBreachedCount server-side.
- **Verified evidence:** page.tsx:8-20 derives open/inProgress/pending/resolved/breached/total/slaBreachPct by filtering the array from getHelpdeskTicketList() (loaders.ts:3258-3264, GET /api/v1/citizen/tickets, mapHelpdeskTicketList in _data/apiMappers.ts:593 unwraps only the data array and discards any pagination). The loaders.ts doc comment (~3268-3283) says citizen-service wraps the filtered branch as {data, pagination}; whether the unfiltered branch caps rows is cannot-verify (citizen-service absent). getTicketAnalytics() (loaders.ts:~3319) already returns totalTickets/openTickets/slaBreachedCount, but not in_progress/pending/resolved split. Also: the comment says the unfiltered call returns a narrower summary, and mapSingleHelpdeskTicket defaults a missing slaStatus to within_sla (apiMappers.ts:~626), so breached could under-count silently.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with citizen-service owners the default page size and whether GET /citizen/tickets or /analytics can return per-status counts.
  2. Use analytics.totalTickets, openTickets and slaBreachedCount for Total/Open/SLA Breached; compute SLA Breach % from those.
  3. If in_progress/pending/resolved counts are needed, ask backend to add them to the analytics payload and TicketAnalyticsSchema; do not derive from a possibly capped list.
  4. Stop fetching the full list on Home (drop getHelpdeskTicketList) except for the empty-state check, or fetch limit=1.
  5. Show an em dash for any card whose source is error.
- **Acceptance:**
  - Component/unit test: with a mocked list of 50 rows and analytics.totalTickets=500, Total card shows 500.
  - Manual: tenant with more tickets than one page shows same Total on Home and Reports.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Dashboard numbers change; no money or PII. Needs backend to expose missing counts.
- **Depends on:** GAP-HELPDESK-HOME-03

### GAP-HELPDESK-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Avg Resolution comes from a second fetch whose source is discarded (page.tsx:8-11 reads only data): an analytics failure falls back to zeros and renders "—" (page.tsx:22-28) with no badge, indistinguishable from "no resolved tickets".
- **Verified evidence:** page.tsx:8-11 destructures only {data: analytics} from getTicketAnalytics(); on failure fetchJson returns TICKET_ANALYTICS_EMPTY (avgResolutionHours 0) so page.tsx:22-28 shows an em dash with no error cue, same as a real no-data state. The ticket-list error IS handled (page.tsx:12, 38, 74-75).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/page.tsx`
- **Fix steps:**
  1. Also destructure source as analyticsSource from getTicketAnalytics().
  2. When analyticsSource==='error' render Avg Resolution as em dash and show <DataSourceBadge source=...> (or a small inline RefreshErrorState) so it is distinguishable.
  3. Keep em dash only for source api with avgResolutionHours 0.
- **Acceptance:**
  - Test: mock analytics fetch failure, expect DataSourceBadge/error cue present and Avg Resolution card marked unavailable.
  - Test: analytics ok with avg 0 shows em dash and no error cue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.

### GAP-HELPDESK-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Two sources for the same idea: Home derives Open/Total from the list, /helpdesk/reports reads analytics.openTickets/totalTickets (reports/page.tsx:43-46); the two pages can show different totals for the same tenant.
- **Verified evidence:** Home derives Open (status==='open' only, page.tsx:14) and Total (tickets.length, :19) from the list; reports/page.tsx:43-46 uses analytics.openTickets/totalTickets. Different definitions of open (Home counts only status open, excluding in_progress) and different data sources, so the pages can disagree.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/page.tsx`, `apps/web/src/app/(app)/helpdesk/reports/page.tsx`
- **Fix steps:**
  1. Pick analytics as the single source for headline totals (see HOME-01).
  2. Define 'Open' identically on both pages and label it (Open vs In Progress).
  3. Optionally extract a shared <HelpdeskHeadlineStats> server component used by both pages.
- **Acceptance:**
  - Test: same mocked analytics produce identical Total/Open on Home and Reports.
  - Manual: values match on both screens.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-HOME-01

### GAP-HELPDESK-HOME-04  ·  LOW  ·  confirmed  ·  theme THEME (was LOADING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** loading.tsx uses Tailwind slate classes on bg-slate-50 (loading.tsx:3) rather than DS Skeleton, so it flashes light in dark theme, and shows 4 stat blocks vs 8 cards.
- **Verified evidence:** loading.tsx:3 uses min-h-screen bg-slate-50 with bg-slate-200 blocks (no dark variants), not the DS Skeleton (_components/ds/Skeleton.tsx which uses --line/--line2 vars). It renders 4 blocks (loading.tsx:~8) vs 8 StatCards on page.tsx:41-48 plus the Quick Navigation card. The same slate pattern is in reports/slas/internal loading.tsx.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/loading.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx with DS Skeleton (apps/web/src/app/_components/ds/Skeleton.tsx) instead of bg-slate-50/bg-slate-200 so it themes correctly
  2. Render 8 skeleton stat cards inside StatGrid and a card skeleton for Quick Navigation to match page.tsx.
  3. Drop the min-h-screen wrapper; use the layout's padding.
- **Acceptance:**
  - Manual: toggle dark theme, reload with throttling; skeleton has no white flash.
  - Visual check: 8 placeholders then 8 cards, no layout jump.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** Shared loading skeleton (see systemic note)

### GAP-HELPDESK-HOME-05  ·  LOW  ·  partly  ·  theme A11Y (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stat card icons are emoji (page.tsx:41-48,54-58) — inconsistent rendering across OS and no accessible name beyond the label.
- **Verified evidence:** Emoji are passed as StatCard icon (page.tsx:41-48) and Quick Navigation tiles (page.tsx:55-59, rendered at :67). Real. Whether StatCard hides the icon from AT was not checked, and the label text is present so 'no accessible name' is overstated. Strings are also hardcoded English rather than next-intl.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Replace emoji with the DS icon component (StatIcon.tsx) in StatCard icon props and nav tiles.
  2. Mark decorative icons aria-hidden.
  3. Move titles/labels to next-intl keys (namespace helpdesk).
- **Acceptance:**
  - Manual: icons render identically on Windows/Android/macOS.
  - axe run reports no image-alt or duplicate-name issue.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /helpdesk/catalogue  —  `helpdesk/catalogue.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/catalogue/page.tsx`
- **Design reference:** `redesign/helpdesk/catalogue.html`

### GAP-HELPDESK-CATALOGUE-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "My Requests" stat is a hard-coded "—" (page.tsx:44) although getMyServiceRequests exists (loaders.ts:5476); a permanently empty card on a user-facing page.
- **Verified evidence:** helpdesk/catalogue/page.tsx:44 renders <StatCard icon='📥' label='My Requests' value='—' /> as a constant, never fetching. getMyServiceRequests exists at _data/loaders.ts:5476 (my-requests/page.tsx uses it). Not a fabricated figure, just a permanently empty card.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/page.tsx`
- **Fix steps:**
  1. Import getMyServiceRequests and load with getCatalogueOfferings via Promise.all.
  2. Compute open = requests not in fulfilled/rejected/cancelled (share the helper from MY-REQUESTS-05); value = mineErrored ? '—' : open.toLocaleString('en-IN').
  3. Make the card link to /helpdesk/catalogue/my-requests if StatCard supports href, otherwise leave the existing button.
  4. A failure of the second call must not blank the whole page; degrade to '—' only.
- **Acceptance:**
  - Test: 3 open requests -> card shows 3.
  - Test: loader error -> card shows '—' and offerings table still renders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Adds one extra request per page load; loader is cached 15s.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-05

### GAP-HELPDESK-CATALOGUE-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No route exists to publish or retire offerings, yet the empty state says "An administrator can publish catalogue offerings" (page.tsx:55); nothing in /helpdesk/catalogue/** lets an administrator do so, and the empty state has no action.
- **Verified evidence:** catalogue/page.tsx:55 empty state says 'An administrator can publish catalogue offerings...' with no action. helpdesk/catalogue/** contains only page, [id], breaches, my-requests; a grep for 'catalogue/offerings' finds only loaders.ts and RaiseRequestForm.tsx (GET/POST for requests), so no web screen creates, publishes or retires offerings. Whether the helpdesk-service has a create/publish endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/page.tsx`
- **Fix steps:**
  1. Immediate: change message to 'No services are available yet. Please contact your helpdesk administrator.' (no promise of a UI) and add action={<Link href='/helpdesk/tickets/new' className='btn primary'>Raise a ticket instead</Link>}.
  2. Feature (separate): after confirming backend endpoints, add helpdesk/catalogue/manage with create/edit offering form (name, category, priority, approvalRequired, stages, OLAs) and publish/retire ActionButtons with reason, role-gated to helpdesk_admin.
  3. Zod-validate the form body at the boundary and ensure the service emits audit events for publish/retire.
- **Acceptance:**
  - Test: empty offerings renders a link to /helpdesk/tickets/new.
  - If the admin screen is built: publish -> offering appears in the catalogue; non-admin gets redirected.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy fix is safe; the admin UI is a new feature with audit implications.

### GAP-HELPDESK-CATALOGUE-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Category and Priority use cellType "status" (page.tsx:60-61), rendering a category name like "Facilities" as a status pill with status colours; "Maker-checker" (page.tsx:27) is jargon for the citizen/staff requester.
- **Verified evidence:** catalogue/page.tsx:60-61 sets cellType 'status' on Category and Priority, which DataTable renders through StatusPill (ds/DataTable.tsx:127). STATUS_MAP (ds/StatusPill.tsx:4-36) has none of category names or Low/Medium/High/Critical, so every value gets a neutral info pill: category is styled like a status, and priority is not colour-coded at all (Critical looks the same as Low). Line 27 sets approval: 'Maker-checker' / 'Auto', which is internal jargon in a staff-facing list. ConfirmDialog/maker-checker enforcement (theme CONFIRM) does not apply to a read-only list.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Remove cellType 'status' from the Category column so it is plain text.
  2. Add 'critical': 'bad', 'high': 'warn', 'medium': 'info', 'low': 'mut' to STATUS_MAP (check no other consumer relies on info for these), keeping cellType 'status' on Priority.
  3. Change approval text to 'Needs approval' / 'No approval needed'.
  4. Keep the raw value for CSV export (csvCellValue already returns the row value).
- **Acceptance:**
  - Test: StatusPill('Critical') is 'pill bad'.
  - Manual: Category shows plain text; Approval column no longer says Maker-checker.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared; adding low/medium/high/critical changes appearance wherever those words are already passed to it. Grep first.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03

### GAP-HELPDESK-CATALOGUE-04  ·  LOW  ·  partly  ·  theme COPY (was LOADING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** loading.tsx heading says "Catalogue" (catalogue/loading.tsx:5) vs "Service Catalogue" on the page; subtitle promises "raise a request" but the list has no Raise action, only row links (page.tsx:36).
- **Verified evidence:** True: catalogue/loading.tsx:6 has <h1>Catalogue</h1> (observation says line 5) while catalogue/page.tsx:36 titles the page 'Service Catalogue'. Overstated: the page subtitle 'Browse available services and raise a self-service request' (page.tsx:36-37) is accurate enough because the table uses rowLinkKey='id' rowLinkPrefix='/helpdesk/catalogue/' (:434-435), taking the user to the detail page with the Raise form; but there is no visible cue that rows are clickable. The loading skeleton (4 stat blocks + table) does match this page, which has four StatCards.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/loading.tsx`, `apps/web/src/app/(app)/helpdesk/catalogue/page.tsx`
- **Fix steps:**
  1. Change loading.tsx h1 text to 'Service Catalogue'.
  2. Reword subtitle to 'Browse available services, then select one to raise a request.'
  3. Optionally add an 'Actions' column with a Request link/button per row (needs a client table render, or reuse rowLink).
- **Acceptance:**
  - Snapshot: loading heading equals the page title.
  - Manual: subtitle tells the user to select a service.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-HELPDESK-CATALOGUE-05  ·  LOW  ·  partly  ·  theme UX (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Fulfilment column shows only "3 stages" (page.tsx:28) — no indication of elapsed time or SLA target although OLA data exists on the detail record.
- **Verified evidence:** catalogue/page.tsx:28 shows fulfilment as `${n} stage(s)` only. Partly mis-described: 'elapsed time' is per-request and has no meaning in an offering list; the useful missing item is the expected turnaround. CatalogueOfferingSummary.olas is optional and documented as part of the detail record (loaders.ts ~5421-5435, getCatalogueOffering comment); whether the list endpoint /api/v1/helpdesk/catalogue/offerings also returns olas is not visible (cannot verify), and RaiseRequestForm/detail page.tsx:~30 is the only place using it.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Check the list response shape (log or curl the offerings endpoint) to see whether olas is populated.
  2. If it is, add an 'Expected turnaround' column: the max (or resolution-type) OLA targetMinutes through formatDuration (see DETAIL-04), '—' when none.
  3. If not, request the backend to include a summary field (e.g. targetResolutionMinutes) on the list endpoint.
- **Acceptance:**
  - Test: offering with an OLA target of 4320 shows '3 days'; without OLAs shows a dash.
  - CSV export includes the new column.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; displaying targets could set user expectations, so show it as 'expected' not 'guaranteed'.
- **Depends on:** GAP-HELPDESK-CATALOGUE-DETAIL-04


---
## /helpdesk/catalogue/[id]  —  `helpdesk/catalogue-detail.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/catalogue/[id]/page.tsx`
- **Design reference:** `redesign/helpdesk/catalogue-detail.html`

### GAP-HELPDESK-CATALOGUE-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Fetch failure becomes a 404: page.tsx:8-9 ignores source and calls notFound() on null, so a transient error shows "Page not found — does not exist or has been moved" (helpdesk/not-found.tsx) with no retry, and users may abandon a valid service.
- **Verified evidence:** helpdesk/catalogue/[id]/page.tsx:8-9: `const { data: offering } = await getCatalogueOffering(params.id); if (!offering) notFound();`. The loader (_data/loaders.ts:5467-5473) returns data null as its fallback for any failure, so a 500/timeout gives source 'error', data null, and the page shows helpdesk/not-found.tsx ('Page not found... has been moved') with no retry. LoaderResult exposes `status` (apiClient.ts:32-35, documented for telling 404 from other errors) and ai/chat/[id]/page.tsx is a peer that already uses source==='error' with RefreshErrorState. catalogue/[id]/error.tsx only catches thrown errors.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/[id]/page.tsx`
- **Fix steps:**
  1. Destructure `{ data: offering, source, status }` from getCatalogueOffering.
  2. If source === 'error' && status === 404 (or source is ok and offering null) call notFound().
  3. If source === 'error' otherwise, return PageHeader plus <RefreshErrorState error={toHumanError('load', { area: 'service details' })} backHref='/helpdesk/catalogue' /> (imports as in catalogue/page.tsx).
  4. Keep the 'Offering retired' EmptyState for status !== 'active'.
- **Acceptance:**
  - Test: loader returns {source:'error', status:500, data:null} -> page renders RefreshErrorState, not not-found.
  - Test: {source:'error', status:404} -> notFound() called.
  - Manual: kill the helpdesk service, page shows retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Verify fetchJson actually sets status on 404 for this route.

### GAP-HELPDESK-CATALOGUE-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme UX (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Requester can pick any priority up to Critical for every offering, overriding defaultPriority with no explanation (RaiseRequestForm.tsx:96-108); priority drives SLA clocks.
- **Verified evidence:** helpdesk/catalogue/[id]/RaiseRequestForm.tsx:~99-106 renders a Priority <select> with Low/Medium/High/Critical for every offering; state is initialised from defaultPriority (line ~22) and posted as `priority` in the body (line ~54). Nothing explains the choice or limits Critical. Whether the backend uses priority for SLA clocks or validates it against the offering is not visible here (helpdesk-service absent, cannot verify). The About card shows 'Default priority' but not what changing it does.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/[id]/RaiseRequestForm.tsx`, `apps/web/src/app/(app)/helpdesk/catalogue/[id]/page.tsx`
- **Fix steps:**
  1. Get a policy decision: can requesters override priority at all? Options: hide the field and use defaultPriority, restrict to Low..High, or keep it but require a justification when above default.
  2. Add helper text under the select: 'Priority affects how quickly your request is handled. Choose Critical only for an outage or urgent deadline.'
  3. If Critical is kept, add a required 'Why is this critical?' textarea sent in formData and validate it client-side.
  4. Confirm server-side validation of allowed priorities with the helpdesk-service owners.
- **Acceptance:**
  - Test: submitting with priority above default without justification shows a validation error (if option 3 chosen).
  - Manual: helper text is visible and linked with aria-describedby.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Priority inflation can distort SLA reporting; changing what is sent must match the backend contract.

### GAP-HELPDESK-CATALOGUE-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UX (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Submit gives no confirmation: unlike the ticket forms there is no toast or request number, just a redirect to My Requests (RaiseRequestForm.tsx:62-64), where requests appear only as UUIDs.
- **Verified evidence:** RaiseRequestForm.tsx:~61-63 on res.ok does router.push('/helpdesk/catalogue/my-requests') and router.refresh() with no toast, no message and no read of the response body. The peer helpdesk/tickets/new/NewTicketForm.tsx:26,66-67 calls useToast().toast.success('Ticket submitted successfully.') before navigating. My Requests then lists requests by raw UUID (see MY-REQUESTS-01). Whether the POST response contains a request id/number is not visible (cannot verify). A ConfirmDialog with reason is not appropriate for a self-service request; the missing piece is success feedback.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/[id]/RaiseRequestForm.tsx`
- **Fix steps:**
  1. Import useToast from '@/app/_components/ds' and call toast.success('Request submitted. Track it under My Requests.') before router.push.
  2. Parse the JSON response defensively (res.json().catch(() => null)); if it has data.id, include a short reference (first 8 chars) in the toast text.
  3. Optionally push to my-requests with ?highlight={id} so the new row can be emphasised.
- **Acceptance:**
  - Component test: successful POST calls toast.success once and router.push.
  - Test: failed POST shows the inline error and no toast.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-01

### GAP-HELPDESK-CATALOGUE-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Internal ITIL jargon shown to the requester: "OLA / underpinning contracts", provider names and "target 4320 min" (page.tsx:31-41), and approvals as "Maker-checker required" with no approver named.
- **Verified evidence:** catalogue/[id]/page.tsx:~30-40 prints heading 'OLA / underpinning contracts' and per item `{o.name} - {o.kind.toUpperCase()} via {o.provider}, target {o.targetMinutes} min` (raw minutes such as 4320); line ~26 shows 'Maker-checker required' / 'Auto-approved'. CatalogueStage has assigneeRole but no approver is named or available for approvals (loaders.ts CatalogueStage/CatalogueOla types). The offering page is a self-service page for all staff, so this is internal jargon.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDuration(minutes) to lib/formatters.ts (4320 -> '3 days', 90 -> '1 h 30 min') and use it for targetMinutes.
  2. Rename section to 'Expected turnaround' and show 'Name - about 3 days' per item; hide provider/kind from non-admin roles (or remove kind.toUpperCase()).
  3. Change the Approval value to 'Needs approval before work starts' / 'No approval needed'; if a stage has assigneeRole, list 'Handled by: {role}'.
  4. Keep the technical OLA table only behind a helpdesk_admin role check (getSessionRoles) if managers still need it.
- **Acceptance:**
  - Unit test: formatDuration(4320)==='3 days', formatDuration(45)==='45 min'.
  - Manual: a non-admin sees no 'OLA' or 'underpinning' text on the detail page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Do not hide SLA info managers rely on; role-gate rather than delete.

### GAP-HELPDESK-CATALOGUE-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme STYLE (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded #fff field backgrounds and #b91c1c / #047857 message colours (RaiseRequestForm.tsx:75,98,113) — breaks the dark theme; loading.tsx heading is the literal "[Id]" (catalogue/[id]/loading.tsx:5).
- **Verified evidence:** RaiseRequestForm.tsx has inline background '#fff' on the field wrappers (lines ~75 and ~98) and message colours '#b91c1c' / '#047857' (line ~113), so text on dark theme is low contrast and the white blocks stay white. catalogue/[id]/loading.tsx:6 renders the literal <h1>[Id]</h1> (observation says line 5) and uses #f1f5f9 skeleton fills; error.tsx also sets area 'Helpdesk [Id]' (error.tsx:~11). Whether these tokens exist: CSS vars such as var(--mut) and var(--ink) are used elsewhere in help/page.tsx.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/[id]/RaiseRequestForm.tsx`, `apps/web/src/app/(app)/helpdesk/catalogue/[id]/loading.tsx`, `apps/web/src/app/(app)/helpdesk/catalogue/[id]/error.tsx`
- **Fix steps:**
  1. Remove background:'#fff' from the two .field wrappers (rely on the DS .field/.fields styles) or use var(--card).
  2. Replace message colours with DS classes/tokens (e.g. className='msg err' or var(--bad) / var(--good)); check civitas-ds.css for the actual names before use.
  3. In loading.tsx change the heading to a skeleton bar or the text 'Service details' and replace #f1f5f9 with a skeleton token/class.
  4. Change error.tsx area to 'service catalogue offering'.
- **Acceptance:**
  - Manual: dark theme shows form fields without white blocks and error text with sufficient contrast (>=4.5:1).
  - Grep: no hex colours in catalogue/[id]/*.tsx; loading shows no '[Id]'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; visual only.


---
## /helpdesk/catalogue/breaches  —  `helpdesk/catalogue-breaches.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/catalogue/breaches/page.tsx`
- **Design reference:** `redesign/helpdesk/catalogue-breaches.html`

### GAP-HELPDESK-CATALOGUE-BREACHES-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A management report row identifies a request only by raw UUID (page.tsx:15-21,50-51): no offering, requester, current assignee or link to the ticket (ticketId exists on the type), so a manager cannot act on a breach from this screen.
- **Verified evidence:** helpdesk/catalogue/breaches/page.tsx:20-26 builds rows with id: r.id and the first column {key:'id', label:'Request'} (line 52) shows the raw UUID; no link (no rowLinkKey). ServiceRequestSummary (_data/loaders.ts:5426-5440 region) has offeringId, ticketId, requestedBy (all UUIDs), currentStage, slaStatus, resolutionDeadline, breachEscalatedAt, createdAt but no names, so offering name needs a lookup via getCatalogueOfferings(); requester name and assignee are not in the type (cannot verify whether the breach endpoint returns them). A ticket detail route exists at helpdesk/tickets/[id].
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/breaches/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In page.tsx fetch getCatalogueOfferings() in Promise.all with getRequestBreachReport() and build a Map(offeringId -> name); add column 'Service' using the name, fallback 'Unknown service'.
  2. Replace the UUID column with a short reference (first 8 chars, uppercase) labelled 'Ref', keeping full id only in the link/CSV.
  3. Add a 'Ticket' link: rows with ticketId link to /helpdesk/tickets/{ticketId} (DataTable rowLinkKey/rowLinkPrefix, or a client wrapper if a per-row conditional link is needed since rowHref is client-only).
  4. Backend request: have GET /api/v1/helpdesk/catalogue/requests/breaches return requesterName and assigneeName (or ids resolvable via an existing directory loader) and extend ServiceRequestSummary.
- **Acceptance:**
  - Test: row for offeringId X shows the offering name and a ticket link when ticketId is set.
  - Test: row with null ticketId renders no link and no crash.
  - Manual: clicking a breach opens the ticket detail.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low for offering name/link; requester/assignee names touch PII, so gate by helpdesk manager role.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-01

### GAP-HELPDESK-CATALOGUE-BREACHES-02  ·  MEDIUM  ·  partly  ·  theme COPY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Card is titled "Breached service requests" but the table maps all report.data rows without filtering (page.tsx:19-25), which by the page subtitle includes "at risk" ones; the At Risk stat and mixed rows contradict the card title.
- **Verified evidence:** breaches/page.tsx:20 maps every row of report.data with no filter and the card heading at :44 reads 'Breached service requests', while the page subtitle (:32) says 'breached or are at risk'. Whether report.data contains at-risk rows depends on the helpdesk-service breaches endpoint, which is not in the snapshot (cannot verify), but the summary has separate breached/atRisk/escalated/total counts (loaders.ts RequestBreachReport), so mixed rows are plausible. In the table the SLA column (:54) does show each row's status, so users can tell them apart; only the title is inconsistent.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/breaches/page.tsx`
- **Fix steps:**
  1. Rename the card heading to 'Requests breached or at risk' (or 'SLA breach and at-risk requests').
  2. Optionally add a client filter (All / Breached / At risk) using the slaStatus field before it is humanised.
  3. Update empty state text to 'No requests are breached or at risk.'
- **Acceptance:**
  - Test: with one breached and one due_soon row the heading is accurate and both rows are listed.
  - Empty state copy matches the heading.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-HELPDESK-CATALOGUE-BREACHES-04  ·  MEDIUM  ·  confirmed  ·  theme UX (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No export and no escalation action; "Escalated" is a read-only flag (page.tsx:23) with no timestamp shown although breachEscalatedAt is available.
- **Verified evidence:** breaches/page.tsx:24 reduces breachEscalatedAt to the text 'Escalated' or a dash, dropping the timestamp although ServiceRequestSummary.breachEscalatedAt is available. The DataTable (:50-63) does not set exportable/exportFilename, whereas catalogue/page.tsx:440-441 does. No escalate action exists on the page and no escalate endpoint is referenced anywhere in helpdesk/catalogue/** (backend cannot be verified). The theme PII does not apply; rows hold ids and dates only.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/breaches/page.tsx`
- **Fix steps:**
  1. Change escalated to `Escalated ${formatIndianDate(r.breachEscalatedAt)}` (use the datetime formatter from lib/formatters if one exists) so the date is visible.
  2. Add exportable and exportFilename='sla-breach-report' to the DataTable, matching catalogue/page.tsx.
  3. Escalation action: out of scope until helpdesk-service exposes an escalate endpoint; raise it as a backend item, then add an ActionButton with requireReason that posts to it and emits an audit event.
- **Acceptance:**
  - Test: a row with breachEscalatedAt shows the date; one without shows a dash.
  - Manual: Export CSV downloads the visible rows with the new columns.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low for date/export. A manual escalate action would change SLA/audit behaviour and needs backend support and an audit event.
- **Depends on:** GAP-HELPDESK-CATALOGUE-BREACHES-01

### GAP-HELPDESK-CATALOGUE-BREACHES-05  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Trailing "My requests" link (page.tsx:66-68) is a requester action on a manager report; SLA text lower-case with underscores replaced (page.tsx:22).
- **Verified evidence:** True: breaches/page.tsx:66-68 ends with a 'My requests' ghost link to /helpdesk/catalogue/my-requests, which is a requester view on a manager report. Overstated: the SLA cell is not lower-case on screen. Line 23 does replace underscores, but the column uses cellType 'status' (line 54), and DataTable.cellValue (ds/DataTable.tsx:127) renders StatusPill, whose humanizeStatus (lib/formatters.ts:44-52) title-cases it, giving 'Within Sla' / 'Due Soon'. The real defects are the wrong acronym casing ('Sla') and no tone: STATUS_MAP (ds/StatusPill.tsx:4-36) lacks 'within sla', 'due soon', 'at risk', so those show as neutral info pills; only 'breached' is red.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/breaches/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Remove the trailing 'My requests' link, or replace it with 'Back to Catalogue' / 'Helpdesk reports' since PageHeader already has back to the catalogue.
  2. Add 'within sla': 'good', 'due soon': 'warn', 'at risk': 'warn' to STATUS_MAP in StatusPill.tsx.
  3. Set the SLA value to a display label ('Within SLA', 'At risk', 'Breached') via a shared slaLabel() helper (extract SLA_MAP from helpdesk/SlaBadge.tsx) and pass it through so the acronym is uppercase.
- **Acceptance:**
  - Test: StatusPill with 'Within SLA' renders good tone, 'At risk' warn, 'Breached' bad.
  - Manual: page has no My requests link; SLA cells read 'Within SLA'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared app-wide; adding keys changes tone of any other 'at risk' label, so grep usages first.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03


---
## /helpdesk/catalogue/my-requests  —  `helpdesk/catalogue-my-requests.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/catalogue/my-requests/page.tsx`
- **Design reference:** `redesign/helpdesk/catalogue-my-requests.html`

### GAP-HELPDESK-CATALOGUE-MY-REQUESTS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The only identifier in the table is the raw request UUID (page.tsx:34,39-40 prints r.id): no offering name, no request number, no ticket link (ticketId and offeringId are in the type but never shown), so a user cannot tell their requests apart or quote one to support.
- **Verified evidence:** my-requests/page.tsx:~34 sets id: r.id and the first column {key:'id', label:'Request'} (~line 49) prints the raw UUID. ServiceRequestSummary has offeringId and ticketId (loaders.ts ~5437-5446) which are never used; there is no request number field in the type, and no rowLink on the DataTable (~47-60). Offering names are obtainable via getCatalogueOfferings() (active offerings only), and helpdesk/tickets/[id] exists for the ticket link.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/my-requests/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Fetch getCatalogueOfferings() in parallel with getMyServiceRequests(); build Map(offeringId -> name) and add a 'Service' column (fallback 'Service (retired)').
  2. Replace raw UUID with a short reference (first 8 chars, uppercase, e.g. SR-1A2B3C4D) in a 'Reference' column; keep the full id for links only.
  3. Add a 'Ticket' link where ticketId is set: /helpdesk/tickets/{ticketId}.
  4. Backend ask: add a human-readable requestNumber to service_requests and to ServiceRequestSummary; use it instead of the short id when present.
- **Acceptance:**
  - Test: row shows offering name and short reference, never a 36-char UUID.
  - Test: retired offering falls back to placeholder text.
  - Manual: Ticket link opens the ticket.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low for web changes. Request number requires a DB migration in helpdesk-service (per-service DB rule) and backfill.

### GAP-HELPDESK-CATALOGUE-MY-REQUESTS-02  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FEATURE (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Rows are not links and no request-detail or cancel route exists in helpdesk/catalogue/** although status includes "cancelled" and "rejected" (page.tsx:15-23): a rejected request shows no reason and a pending one cannot be withdrawn.
- **Verified evidence:** my-requests/page.tsx STATUS_LABEL (lines ~15-23) includes rejected and cancelled, but the DataTable has no rowLinkKey (~47-60) so rows are not links. helpdesk/catalogue/** contains only page, [id] (an offering id), breaches and my-requests, so there is no request detail route, no cancel action, and no rejection-reason field in ServiceRequestSummary (loaders.ts ~5437-5446). Cancel/withdraw endpoints in helpdesk-service cannot be verified (service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/requests/[id]/page.tsx`, `apps/web/src/app/(app)/helpdesk/catalogue/my-requests/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with helpdesk-service owners that GET /api/v1/helpdesk/catalogue/requests/:id, a cancel endpoint and a rejection reason exist; if not, request them (backend).
  2. Add getServiceRequest(id) loader and a detail page showing offering, status, stage history, SLA deadline, rejection reason, ticket link, with RefreshErrorState on source==='error'.
  3. Add a Cancel request ActionButton (requireReason, ConfirmDialog) visible only for pending_approval, posting to the cancel endpoint; backend must emit an audit event.
  4. Make my-requests rows link to the detail page (rowLinkKey='id', rowLinkPrefix='/helpdesk/catalogue/requests/').
- **Acceptance:**
  - Test: pending_approval request shows Cancel; fulfilled shows none.
  - Test: cancelling requires a reason and the row becomes Cancelled after refresh.
  - Manual: rejected request detail shows the rejection reason.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Cancel changes workflow state and may interact with approvals already started; needs backend rules and audit.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-01

### GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03  ·  MEDIUM  ·  partly  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** SLA shows lower-case "within sla" / "due soon" (page.tsx:42 replaces underscores only) while Status uses a proper label map (page.tsx:15-23); Stage prints the stage key as stored.
- **Verified evidence:** Overstated: my-requests/page.tsx:~42 does `slaStatus.replace(/_/g,' ')` but the SLA column uses cellType 'status' (~line 52), so DataTable renders StatusPill (ds/DataTable.tsx:127) and humanizeStatus (lib/formatters.ts:44-52) title-cases it: 'Within Sla', 'Due Soon' (not lower-case), with the wrong SLA casing. Real problems: STATUS_MAP in ds/StatusPill.tsx:4-36 has no 'within sla', 'due soon', 'at risk', 'pending approval', 'in fulfilment', 'pending fulfilment' keys, so those pills are neutral 'info' (only approved/rejected/breached/cancelled? map: approved good, rejected bad, breached bad). Stage (~line 41) prints r.currentStage, the stage key stored in the DB, not the stage name from the offering's fulfilmentStages.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/lib/slaLabels.ts`, `apps/web/src/app/(app)/helpdesk/catalogue/my-requests/page.tsx`, `apps/web/src/app/(app)/helpdesk/SlaBadge.tsx`
- **Fix steps:**
  1. Create lib/slaLabels.ts exporting SLA_LABELS (within_sla -> 'Within SLA', due_soon -> 'Due soon', at_risk -> 'At risk', breached -> 'Breached') extracted from helpdesk/SlaBadge.tsx and reuse it in SlaBadge.
  2. In my-requests and breaches pages map slaStatus through SLA_LABELS before building rows.
  3. Add tone keys to STATUS_MAP: 'within sla': good, 'due soon': warn, 'at risk': warn, 'pending approval': warn, 'pending fulfilment': warn, 'in fulfilment': info, 'fulfilled': good, 'cancelled': mut.
  4. Resolve stage names: with the offerings map from MY-REQUESTS-01, look up offering.fulfilmentStages.find(s => s.key === r.currentStage)?.name, fallback to humanizeStatus(key).
- **Acceptance:**
  - Test: StatusPill('Within SLA') -> class 'pill good'; 'Due soon' -> warn; 'Pending approval' -> warn.
  - Manual: SLA cells read 'Within SLA' in green; Stage shows the human stage name.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** StatusPill is shared app-wide; grep for other 'pending fulfilment'/'at risk' usages before adding tones.
- **Depends on:** GAP-HELPDESK-CATALOGUE-MY-REQUESTS-01

### GAP-HELPDESK-CATALOGUE-MY-REQUESTS-04  ·  LOW  ·  confirmed  ·  theme MISSING-FEATURE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** resolutionDeadline is fetched but not shown (only Raised date), so the user sees an SLA state without the date it depends on.
- **Verified evidence:** ServiceRequestSummary.resolutionDeadline (loaders.ts ~5443) is returned by getMyServiceRequests but my-requests/page.tsx Row type (lines 8-14 of the file) and the columns (~47-55) contain only id, status, stage, sla, raised. The breaches page does show 'Resolution Due' (breaches/page.tsx:56), so the data is formatted there already. Theme DEADROUTE is wrong (no route involved).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/my-requests/page.tsx`
- **Fix steps:**
  1. Add `due: string` to Row; set due: r.resolutionDeadline ? formatIndianDate(r.resolutionDeadline) : '—'.
  2. Add column { key: 'due', label: 'Resolution due' } after SLA.
  3. Keep '—' for null deadlines (for example while awaiting approval).
- **Acceptance:**
  - Test: request with resolutionDeadline shows the formatted date; null shows a dash.
  - Manual: column is sortable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-HELPDESK-CATALOGUE-MY-REQUESTS-05  ·  LOW  ·  partly  ·  theme LOGIC (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Open count excludes only fulfilled/rejected/cancelled (page.tsx:30), so "approved" counts as open even when nothing is pending — unlabelled logic.
- **Verified evidence:** my-requests/page.tsx:~30 (variable `open`) counts every request whose status is not fulfilled, rejected or cancelled, so pending_approval, approved, pending_fulfilment and in_fulfilment all count as Open. That is a defensible definition because 'approved' is an intermediate state before fulfilment (STATUS_LABEL lists it beside pending_fulfilment), so the claim that it is wrong is overstated; the true issue is that the rule is undocumented and the stat card label is just 'Open'. The exact backend state machine is not visible (cannot verify whether 'approved' is ever terminal for auto-approved offerings with no stages).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/catalogue/my-requests/page.tsx`
- **Fix steps:**
  1. Extract const CLOSED_STATUSES = ['fulfilled','rejected','cancelled'] with a comment stating that all other states are in progress.
  2. Confirm with helpdesk-service whether approved with zero fulfilment stages moves to fulfilled; if it can rest in approved, adjust the rule.
  3. Rename card label to 'In progress' or add a title/aria-label 'Requests not yet fulfilled, rejected or cancelled'.
- **Acceptance:**
  - Unit test of the open-count helper for each status value.
  - Manual: card tooltip/label explains the rule.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; counts only.


---
## /helpdesk/internal  —  `helpdesk/internal.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/internal/page.tsx`
- **Design reference:** `redesign/helpdesk/internal.html`

### GAP-HELPDESK-INTERNAL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failure reads as an empty queue: on error the list is [] so the stat cards show 0 and the table shows "No internal tickets" (page.tsx:10-30, InternalTicketsTable.tsx:47-48); only a small badge hints otherwise and no retry is offered.
- **Verified evidence:** internal/page.tsx:8-13 uses data with [] fallback; on error stat cards show 0 (:26-29) and InternalTicketsTable shows EmptyState 'No internal tickets' (InternalTicketsTable.tsx:81-82); only DataSourceBadge (:24) hints, no retry.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/page.tsx`, `apps/web/src/app/(app)/helpdesk/internal/InternalTicketsTable.tsx`
- **Fix steps:**
  1. If source==='error', render <RefreshErrorState error={toHumanError('load',{area:'internal tickets'})} backHref='/helpdesk' /> in place of the table.
  2. Show em dash in StatCards when errored (pattern in helpdesk/page.tsx:41-48).
  3. Remove the badge in that state.
- **Acceptance:**
  - Test: fetch failure shows RefreshErrorState, no 'No internal tickets'.
  - Test: empty api list still shows empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-HELPDESK-INTERNAL-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The "Ticket" column shows id.slice(0,8).toUpperCase() of a UUID (InternalTicketsTable.tsx:26) — a code the user cannot look up or quote; the list has no ticket number like the citizen list does.
- **Verified evidence:** InternalTicketsTable.tsx:60 ticketId: t.id.slice(0,8).toUpperCase(). Unlike citizen (ticketNo), the InternalHelpdeskTicketSummary type built in mapTickets (loaders.ts:472-487) has only id/subject/priority/status.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/InternalTicketsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Ask helpdesk-service to return ticketNo; extend mapTickets/InternalHelpdeskTicketSummary (packages/types).
  2. Show ticketNo in the Ticket column; if absent, hide the column and link the Subject instead.
  3. Keep id only as row link key.
- **Acceptance:**
  - Test: rows show ticketNo.
  - Manual: quoted number can be searched in filter.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-INTERNAL-DETAIL-05

### GAP-HELPDESK-INTERNAL-03  ·  MEDIUM  ·  partly  ·  theme ROLEGATE (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "+ New Ticket" is offered to every viewer though POST /v1/helpdesk/tickets is limited to helpdesk roles (page.tsx:20, NewInternalTicketForm.tsx:9-19).
- **Verified evidence:** internal/page.tsx:20-22 always renders '+ New Ticket'. Same as NEW-01: role restriction rests on a code comment (NewInternalTicketForm.tsx:9-19); service enforcement cannot-verify. Duplicate of NEW-01.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/page.tsx`
- **Fix steps:**
  1. Wrap the actions Link in a getSessionRoles()/HELPDESK_ROLES check (see NEW-01).
- **Acceptance:**
  - Test: non-helpdesk role has no button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-INTERNAL-NEW-01

### GAP-HELPDESK-INTERNAL-04  ·  MEDIUM  ·  partly  ·  theme DATA-LOSS (was NAVUX)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status tabs match exact capitalised strings (InternalTicketsTable.tsx:31-35); any other backend status (Pending, Closed, On Hold) is reachable only under "All" and is uncounted in the stat cards.
- **Verified evidence:** InternalTicketsTable.tsx:20-24/39-43 Open tab = Open|In Progress, Resolved tab = Resolved only. But worse than stated: mapTickets (loaders.ts:472-487) drops any row whose status is not Open/In Progress/Resolved/Closed, and priority not Low/Medium/High/Critical, so Pending/On Hold rows never appear even under All. Closed appears only under All and is not counted in the Resolved stat (page.tsx:11).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/helpdesk/internal/page.tsx`, `apps/web/src/app/(app)/helpdesk/internal/InternalTicketsTable.tsx`
- **Fix steps:**
  1. Confirm helpdesk-service status enum.
  2. Make mapTickets keep unknown statuses (pass through) instead of skipping the row.
  3. Define one status-group helper (open, resolved incl. Closed) used by page.tsx stats and table tabs.
  4. Add a Closed tab or count Closed with Resolved.
- **Acceptance:**
  - Test: mapTickets keeps a 'Pending' row.
  - Test: Closed ticket counted in Resolved stat and shown under Resolved tab.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Silent row dropping today means users miss tickets.

### GAP-HELPDESK-INTERNAL-05  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Unlike /helpdesk/tickets this table has no useSeededResource offline copy and no provenance badge in the table (InternalTicketsTable.tsx); subtitle leaks the service name "helpdesk-service" (page.tsx:19).
- **Verified evidence:** InternalTicketsTable.tsx uses plain server data with no useSeededResource, true; but the tickets list of the citizen side uses it only if TicketsTable does (not checked). Subtitle 'Staff operations queue via helpdesk-service.' at page.tsx:18 leaks the service name (confirmed; the finding says :19). Not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/page.tsx`
- **Fix steps:**
  1. Change subtitle to 'Staff operations queue.'
  2. Decide whether offline caching is required; if so adopt useSeededResource like TicketsTable.
- **Acceptance:**
  - Manual: subtitle has no service name.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /helpdesk/internal/[id]  —  `helpdesk/internal-detail.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/internal/[id]/page.tsx`
- **Design reference:** `redesign/helpdesk/internal-detail.html`

### GAP-HELPDESK-INTERNAL-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The description typed in the New Internal Ticket form (NewInternalTicketForm.tsx:47-51) is never shown: InternalTicket and its mapper have no description field (page.tsx:6-40), so the reader of a ticket cannot see what was asked.
- **Verified evidence:** internal/[id]/page.tsx:9-17 InternalTicket type has no description; mapResponse (:35-43) maps only id/subject/priority/status/dueDate/slaStatus/assignee. NewInternalTicketForm.tsx:240-244 posts description, so it is stored (if the service accepts it) but never displayed. Whether GET /v1/helpdesk/tickets/{id} returns description is cannot-verify (helpdesk-service absent).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/[id]/page.tsx`
- **Fix steps:**
  1. Add description?: string to InternalTicket and map typeof t.description==='string'.
  2. Render a Description card below the fields (preserve line breaks, text only).
  3. Confirm with helpdesk-service that the detail response includes description; if not, add it there.
  4. Also add createdAt/requester if provided.
- **Acceptance:**
  - Test: mocked detail with description renders it.
  - Manual: create ticket with description, open detail, text is visible.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; render as plain text to avoid XSS.

### GAP-HELPDESK-INTERNAL-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Read-only dead end: no assign, resolve, reply or close control exists for an internal ticket (whole page), so the queue can be filed to but not worked from the UI; the citizen detail page has these actions (tickets/[id]/TicketActions.tsx).
- **Verified evidence:** internal/[id]/page.tsx renders only a read-only fields card (:53-61 region); no client component, no assign/resolve/reply controls. Citizen detail has tickets/[id]/TicketActions.tsx (reply/assign/resolve/close with ConfirmDialog). Which helpdesk-service endpoints exist for update/assign is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/[id]/page.tsx`, `apps/web/src/app/(app)/helpdesk/internal/[id]/InternalTicketActions.tsx (new)`
- **Fix steps:**
  1. Confirm helpdesk-service mutation endpoints (assign, status change, comment) and role gate.
  2. Create InternalTicketActions.tsx modelled on tickets/[id]/TicketActions.tsx (useFormError, ConfirmDialog, router.refresh) against those endpoints.
  3. Mount it in page.tsx for helpdesk roles only (getSessionRoles).
  4. Show a comment/notes thread once a read endpoint exists.
- **Acceptance:**
  - Test: assign action posts expected body and refreshes.
  - Manual: helpdesk_user can move ticket Open to Resolved; other role sees no controls.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Changes ticket state; must be role-gated and audited server-side.
- **Depends on:** GAP-HELPDESK-INTERNAL-NEW-01

### GAP-HELPDESK-INTERNAL-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Fetch failure renders "This internal ticket does not exist." (page.tsx:46-52) because the loader falls back to null; the badge is the only hint.
- **Verified evidence:** page.tsx:20-46 fetchJson falls back to null on error; the !ticket branch (:47-55) renders EmptyState 'Ticket not found / does not exist' with only a DataSourceBadge when source==='error'. Error and true not-found are conflated.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/[id]/page.tsx`
- **Fix steps:**
  1. In the !ticket branch, if source==='error' render <RefreshErrorState error={toHumanError('load',{area:'internal ticket'})} backHref='/helpdesk/internal' />.
  2. Only show 'Ticket not found' when source==='api' (null from mapper) ; consider notFound() for that case.
  3. Remove the badge in the error branch.
- **Acceptance:**
  - Test: mocked fetch failure renders RefreshErrorState with retry.
  - Test: api response with unknown id shows not found.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-HELPDESK-INTERNAL-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme SECURITY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Path built as `/api/v1/helpdesk/tickets/${params.id}` without encodeURIComponent (page.tsx:19), unlike the catalogue loader (loaders.ts encodeURIComponent); a crafted id segment changes the request path.
- **Verified evidence:** page.tsx:22 interpolates params.id raw into /api/v1/helpdesk/tickets/${params.id}. Next decodes dynamic segments, so an id like 'x%2F..%2Fother' becomes a path with slashes. loaders.ts:5468 uses encodeURIComponent for catalogue. Citizen getHelpdeskTicketById (loaders.ts:~3267) has the same omission. The server is same-origin gateway so impact is limited to request path manipulation within the user's own session.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Wrap with encodeURIComponent(params.id).
  2. Move the fetch into a getInternalHelpdeskTicketById(id) loader in loaders.ts and encode there.
  3. Apply the same fix to getHelpdeskTicketById.
  4. Optionally validate id as UUID and call notFound() otherwise.
- **Acceptance:**
  - Test: id 'a/../b' produces request path ending %2F..%2F.
  - Manual: non-UUID id yields not found, not another resource.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-HELPDESK-INTERNAL-DETAIL-05  ·  LOW  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle shows an 8-character UUID fragment as the "ticket number" (page.tsx:59).
- **Verified evidence:** page.tsx:61 subtitle `Internal ticket ${ticket.id.slice(0, 8).toUpperCase()}`; list table does the same (InternalTicketsTable.tsx:60). The internal type has no ticketNo field in the mapper; whether the service issues one is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/[id]/page.tsx`, `apps/web/src/app/(app)/helpdesk/internal/InternalTicketsTable.tsx`
- **Fix steps:**
  1. Ask helpdesk-service to return a human ticketNo (like citizen's ticketNo) and map it.
  2. Until then, drop the fake code from the subtitle and show 'Internal ticket' plus created date.
  3. Share one formatter used by list and detail.
- **Acceptance:**
  - Manual: subtitle shows real ticket number or none, never a truncated UUID.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-INTERNAL-02


---
## /helpdesk/internal/new  —  `helpdesk/internal-new.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/internal/new/page.tsx`
- **Design reference:** `redesign/helpdesk/internal-new.html`

### GAP-HELPDESK-INTERNAL-NEW-01  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Role-gated endpoint, ungated UI: the component comment states POST /v1/helpdesk/tickets returns 403 for a plain citizen role (NewInternalTicketForm.tsx:9-19) yet neither the page (page.tsx) nor the list button (internal/page.tsx:20) checks a role; the user fills the whole form, then sees a generic save failure.
- **Verified evidence:** Confirmed web side: neither internal/new/page.tsx nor internal/page.tsx:20-22 checks roles, though NewInternalTicketForm.tsx:9-19 documents a 403 for non-helpdesk roles. A role helper exists (lib/auth/roleGuard.ts getSessionRoles) and PermissionDenied is used in hr/rti/page.tsx:36-40. The HELPDESK_ROLES list (helpdesk_user/helpdesk_admin/super_admin) is only asserted in a comment; helpdesk-service is absent so cannot-verify server enforcement.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/new/page.tsx`, `apps/web/src/app/(app)/helpdesk/internal/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Export a HELPDESK_ROLES constant (in roleGuard.ts or helpdesk/roles.ts) matching the service.
  2. In new/page.tsx call getSessionRoles(); if none match, return <PermissionDenied module='internal helpdesk' requiredRoles={HELPDESK_ROLES} /> as hr/rti does.
  3. In internal/page.tsx render the '+ New Ticket' link only when roles match.
  4. Verify with backend that POST enforces the same roles.
- **Acceptance:**
  - Test: citizen role sees PermissionDenied on /helpdesk/internal/new and no New Ticket button on the list.
  - Test: helpdesk_user sees form.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** UI gating is convenience only; server must remain authoritative.
- **Depends on:** GAP-HELPDESK-INTERNAL-03, GAP-HELPDESK-INTERNAL-NEW-05

### GAP-HELPDESK-INTERNAL-NEW-02  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Near-duplicate of NewTicketForm with only the endpoint, casing and labels changed; no assignee, category or due-date field for an operations queue (NewInternalTicketForm.tsx:47-51).
- **Verified evidence:** NewInternalTicketForm.tsx has subject, description, priority only (:277-328); no assignee, category or due date, although the detail page displays dueDate and assignee (internal/[id]/page.tsx:39-41), so the service likely has them (cannot-verify create schema). Validation is hand-rolled (:227-236), no zod, though submit is disabled while pending (:351). Duplication with NewTicketForm is not verified line by line and is a smell not a defect.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/new/NewInternalTicketForm.tsx`
- **Fix steps:**
  1. Confirm POST /v1/helpdesk/tickets body schema (assignee, dueDate, category).
  2. Add a zod schema for the form (subject 1-200, description 1-5000, priority enum) and validate before fetch, mapping errors to field messages.
  3. Add optional Assignee (EntityPicker) and Due date fields if the service accepts them.
  4. Extract shared TicketFormShell with NewTicketForm if kept.
- **Acceptance:**
  - Test: empty subject shows inline error, no fetch.
  - Test: submit button disabled while pending.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-HELPDESK-INTERNAL-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme THEME (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded #fff backgrounds and #b91c1c / #047857 (NewInternalTicketForm.tsx:84,101,118,144) — dark theme breaks.
- **Verified evidence:** Hard-coded colours in NewInternalTicketForm.tsx: background '#fff' at :277, :294, :311 (line numbers in the finding are off); '#b91c1c' / '#047857' at :337. In dark theme the white field panels and the fixed message colours break contrast. Not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/new/NewInternalTicketForm.tsx`
- **Fix steps:**
  1. Remove inline background:'#fff' from the three .field divs (class styling already themes) or use var(--panel).
  2. Replace message colours with DS tokens (e.g. var(--danger)/var(--ok)) or the DS error text class.
  3. Check contrast in both themes.
- **Acceptance:**
  - Manual: dark theme form has no white blocks; error text readable.
  - Grep for '#fff' and '#b91c1c' in file returns none.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-HELPDESK-INTERNAL-NEW-04  ·  MEDIUM  ·  partly  ·  theme UX (was UUID)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Success toast "Ticket created." gives no ticket id; internal ids are shown elsewhere as an 8-char slice of a UUID (InternalTicketsTable.tsx:26) which the user never sees at creation.
- **Verified evidence:** Success path (NewInternalTicketForm.tsx:257-259) toasts 'Ticket created.' and routes to the list; the POST response is not read, so no id is available. Whether the service returns id/ticketNo is cannot-verify. The list shows the 8-char slice (InternalTicketsTable.tsx:60).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/internal/new/NewInternalTicketForm.tsx`
- **Fix steps:**
  1. Read the POST response JSON (data.id / ticketNo) if provided.
  2. Toast 'Ticket <no> created' with a link, or router.push to /helpdesk/internal/<id>.
  3. Depends on a human ticket number (see INTERNAL-DETAIL-05).
- **Acceptance:**
  - Test: mocked 201 with id navigates to the detail page.
  - Manual: toast shows ticket reference.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-INTERNAL-DETAIL-05

### GAP-HELPDESK-INTERNAL-NEW-05  ·  LOW  ·  confirmed  ·  theme ERRORMSG (was ROLEGATE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 403 surfaces as the generic "save" error (useFormError) rather than a "you do not have access" message (NewInternalTicketForm.tsx:57-60).
- **Verified evidence:** NewInternalTicketForm.tsx:252-256 uses formError.fromResponse(res,'save'). useFormError.ts CODE_TO_KIND (:40-44) maps only VALIDATION_* and NOT_FOUND; MessageKind (messages.ts:19-24) has no forbidden kind, so a 403 gets the generic save copy.
- **Files to change:** `apps/web/src/lib/useFormError.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/app/(app)/helpdesk/internal/new/NewInternalTicketForm.tsx`
- **Fix steps:**
  1. Add a 'forbidden' MessageKind and copy in messages.ts ('You do not have access to do this. Ask your administrator.').
  2. In fromResponse, map res.status===403 (and code FORBIDDEN) to that kind.
  3. Add the same for 401 if desired.
- **Acceptance:**
  - Test: 403 response yields forbidden message.
  - Test: existing 400 mapping unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared hook; changes copy for every form on 403.
- **Depends on:** GAP-HELPDESK-INTERNAL-NEW-01


---
## /helpdesk/reports  —  `helpdesk/reports.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/reports/page.tsx`
- **Design reference:** `redesign/helpdesk/reports.html`

### GAP-HELPDESK-REPORTS-01  ·  MEDIUM  ·  confirmed  ·  theme REPORTING (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No period control, no export/print: "Resolved (MTD)" is fixed to the month and every other figure is all-time with no label (page.tsx:42-47); a reviewer cannot report on a quarter.
- **Verified evidence:** reports/page.tsx:42-47 shows Total/Open/SLA Breached (no period stated) and 'Resolved (MTD)'; getTicketAnalytics() (loaders.ts:~3319) takes no params. No period selector; DataTable has no exportable prop on these tables (:56-64, :74-82). Nothing PII here. Whether the analytics endpoint supports a period param is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/reports/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm /api/v1/citizen/tickets/analytics supports from/to; if not, add in citizen-service.
  2. Add a searchParams-driven period control (Segmented: MTD/QTD/FY/Custom) and pass to getTicketAnalytics(period).
  3. Label every card with its period; enable exportable on both tables.
  4. Update TicketAnalyticsSchema if the shape changes.
- **Acceptance:**
  - Test: ?period=qtd triggers request with range and labels update.
  - Manual: CSV export downloads both breakdowns.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; aggregate data only.

### GAP-HELPDESK-REPORTS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Average resolution is "31.2 hrs" here (page.tsx:90) but "1.3d" on the Helpdesk home (helpdesk/page.tsx:22-28); with no data it prints "0.0 hrs" instead of "—" (page.tsx:90 vs home).
- **Verified evidence:** reports/page.tsx:89 prints `${avgResolutionHours.toFixed(1)} hrs` (0 gives '0.0 hrs'); helpdesk/page.tsx:22-27 prints h under 24 else d, and em dash for 0.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/reports/page.tsx`, `apps/web/src/app/(app)/helpdesk/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDurationHours(hours) to lib/formatters.ts (em dash for 0/undefined, h under 24, d otherwise).
  2. Use it on both pages.
- **Acceptance:**
  - Unit test: 0 -> em dash, 5 -> '5.0h', 31.2 -> '1.3d'.
  - Manual: both pages agree.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-HELPDESK-REPORTS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Analytics endpoint is citizen-service only (loaders.ts:3326): "Helpdesk Reports" excludes internal tickets and catalogue requests that live in helpdesk-service, so totals differ from /helpdesk/internal and /helpdesk/catalogue/breaches.
- **Verified evidence:** getTicketAnalytics hits /api/v1/citizen/tickets/analytics (loaders.ts:~3327), the citizen-service; internal tickets are read from /api/v1/helpdesk/tickets (loaders.ts:738-744). So web-side, the report clearly does not combine sources. Whether citizen-service analytics include catalogue requests is cannot-verify (helpdesk-service, citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/reports/page.tsx`, `apps/web/src/app/(app)/helpdesk/page.tsx`
- **Fix steps:**
  1. Decision: scope the page as 'Citizen tickets' in title/subtitle, or add a combined analytics endpoint.
  2. If combined, add getInternalTicketAnalytics() and show a separate section.
  3. Label totals with their scope.
- **Acceptance:**
  - Manual: page title states scope; totals reconcile with /helpdesk/tickets.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Reporting accuracy for management.

### GAP-HELPDESK-REPORTS-04  ·  LOW  ·  partly  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** loading.tsx renders five stat blocks and the page four (reports/loading.tsx:8 vs page.tsx:42-47); on error the page stacks a badge plus two identical RefreshErrorStates (page.tsx:41,52,70).
- **Verified evidence:** reports/loading.tsx:8 md:grid-cols-5 with 5 blocks vs 4 StatCards on page (:43-46): confirmed. On error page shows DataSourceBadge (:41) plus two RefreshErrorStates (:52, :70) with different area text (priority vs channel breakdown), so not identical but redundant, three error cues.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/reports/page.tsx`, `apps/web/src/app/(app)/helpdesk/reports/loading.tsx`
- **Fix steps:**
  1. Render one RefreshErrorState for the whole page on error and hide the two cards and badge.
  2. Fix loading.tsx to 4 stat blocks using DS Skeleton.
- **Acceptance:**
  - Manual: failed analytics shows one error with retry.
  - Loading shows 4 placeholders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-HELPDESK-REPORTS-05  ·  LOW  ·  partly  ·  theme CLEANUP (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Percentages are strings ("14.3%") built in the page and sorted lexically by the sortable DataTable (page.tsx:23-31,63).
- **Verified evidence:** Strings like '14.3%' are built at page.tsx:25,31, true. But DataTable compareValues (ds/DataTable.tsx:159-170) falls back to localeCompare with {numeric:true}, so '9.0%' < '14.3%' sorts correctly; the lexical-sort claim is refuted in practice. Still a smell, and CSV/other consumers get strings.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/reports/page.tsx`
- **Fix steps:**
  1. Keep pct as number and render via a column render/format if DataTable supports it (else leave).
  2. Low priority; add a sort unit test to lock behaviour.
- **Acceptance:**
  - Test: rows 9.0% and 14.3% sort ascending correctly.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /helpdesk/slas  —  `helpdesk/slas.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/slas/page.tsx`
- **Design reference:** `redesign/helpdesk/slas.html`

### GAP-HELPDESK-SLAS-01  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Only breached tickets are tabulated (page.tsx:26-38); the Due Soon count is a dead number with no list, so the queue cannot be used to prevent the next breach.
- **Verified evidence:** slas/page.tsx:20-33 counts due_soon and within_sla but the table shows only rows filtered to breached (:19-37,:67-92). getBreachedSLATickets already fetches the due_soon rows (loaders.ts ~3296-3313), so data is available and unused.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/slas/page.tsx`
- **Fix steps:**
  1. Add a client tab (Segmented: Breached / Due soon / Within SLA) or make the stat cards links using ?bucket= searchParams.
  2. Build rows from the selected bucket; keep breached default.
  3. Rename empty-state copy per bucket.
- **Acceptance:**
  - Test: ?bucket=due_soon lists the due-soon tickets.
  - Manual: Due Soon count equals rows shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-HELPDESK-SLAS-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK (was CAP)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** getBreachedSLATickets fires three unpaginated requests and returns source "error" if any one fails (loaders.ts:3293-3312), so a single failing bucket blanks the counts and the table even when the breached list loaded.
- **Verified evidence:** loaders.ts:3298-3316 getBreachedSLATickets runs three fetches and sets source 'error' if any fails; data is still the merge of the successful ones, but slas/page.tsx:17 errored blanks stat cards and table (:63,:98-100). Confirmed. 'Unpaginated' is cannot-verify: doc comment says the filtered branch returns {data, pagination} and mapTicketDetails discards pagination, so only the first page per bucket is likely loaded.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/helpdesk/slas/page.tsx`
- **Fix steps:**
  1. Return per-bucket sources (e.g. {data, sources:{breached,dueSoon,withinSla}}).
  2. Render available buckets, show em dash and a small warning only for the failed bucket.
  3. Have mapTicketDetails return pagination.total and use it for the stat cards; add page/limit params or loop pages for the breached bucket.
- **Acceptance:**
  - Test: due_soon fetch fails, breached table still renders and Due Soon shows an em dash.
  - Test: pagination.total 120 with 20 rows shows 120 in stat.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-HELPDESK-HOME-01

### GAP-HELPDESK-SLAS-03  ·  MEDIUM  ·  confirmed  ·  theme SORT (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Oldest first" sorts by createdAt (page.tsx:28-31), not by SLA deadline; a Low ticket opened earlier outranks a Critical one already past due. No deadline or overdue-by column exists in TicketDetail.
- **Verified evidence:** slas/page.tsx:28-31 sorts by createdAt ascending; subtitle says 'sorted oldest first'. TicketDetail/mapSingleHelpdeskTicket (apiMappers.ts:~640-655) has no due/deadline field, so sorting by deadline needs a backend field. Priority is available and could be a tiebreaker.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/slas/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Ask citizen-service to expose slaDueAt on ticket detail rows; map it into TicketDetail.
  2. Sort by slaDueAt ascending, then priority weight; add 'Overdue by' column.
  3. Until then, sort by priority weight then createdAt and fix the subtitle.
- **Acceptance:**
  - Test: Critical overdue ranks above older Low ticket.
  - Manual: column shows overdue duration.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Ordering drives who is worked first.

### GAP-HELPDESK-SLAS-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** exportable table exports requester names for the whole SLA queue (page.tsx:74-75) with no role gate, masking or audit note — DPDP-relevant bulk export.
- **Verified evidence:** slas/page.tsx:93-94 exportable + exportFilename on a table with requesterName (:56). DataTable.downloadCsv (ds/DataTable.tsx:274-290) exports all sorted rows client-side with no audit call. The page has no getSessionRoles check. Export audit would need a backend audit endpoint (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/slas/page.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Gate the page or the export by role via getSessionRoles().
  2. Add an onExport callback prop to DataTable that POSTs an audit event before download (needs backend audit endpoint).
  3. Omit or mask requesterName in the export via a per-column exportable:false flag.
- **Acceptance:**
  - Test: non-privileged role sees no CSV button.
  - Manual: export writes an audit record.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of citizen names.

### GAP-HELPDESK-SLAS-05  ·  LOW  ·  confirmed  ·  theme NAMING (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Three names for one screen: route /helpdesk/slas, title "SLA Queue", home tile "SLA Monitor" (helpdesk/page.tsx:60); loader is named getBreachedSLATickets but returns all buckets.
- **Verified evidence:** Title 'SLA Queue' (slas/page.tsx:39), home tile 'SLA Monitor' at helpdesk/page.tsx:57 (finding says :60), route /slas; getBreachedSLATickets returns breached+due_soon+within_sla.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/slas/page.tsx`, `apps/web/src/app/(app)/helpdesk/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Pick one name (SLA Queue) and update tile and sidebar labels.
  2. Rename the loader to getSlaTickets.
- **Acceptance:**
  - Grep shows one label; loader name matches behaviour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /helpdesk/tickets  —  `helpdesk/tickets.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/tickets/page.tsx`
- **Design reference:** `redesign/helpdesk/tickets.html`

### GAP-HELPDESK-TICKETS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failure reads as good news: on a failed fetch the list is [] so SLA Met = 100% and Open Tickets = 0 (page.tsx:11-14), and no RefreshErrorState is shown; the only signal is a badge inside the table card (TicketsTable.tsx:78). The home page nulls the same numbers correctly (helpdesk/page.tsx:14-48).
- **Verified evidence:** tickets/page.tsx:8-14: on error getHelpdeskTicketList returns [] so breached=0, slaMetPct falls to 100 (lines 11-13), open=0; StatCards at 42-45 render '0' and '100%'. page never reads source except passing it to TicketsTable, which shows only a DataSourceBadge (TicketsTable.tsx:81) and the 'No tickets' EmptyState (82-83). helpdesk/page.tsx:14-48 uses ticketsErrored to show '—' and RefreshErrorState (line 75). Line refs in the finding for TicketsTable were 78 (actual 81).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/page.tsx`, `apps/web/src/app/(app)/helpdesk/tickets/TicketsTable.tsx`
- **Fix steps:**
  1. In page.tsx compute const errored = source==='error'.
  2. Set Open Tickets and SLA Met values to '—' when errored; keep the % calc only for non-error.
  3. When errored and no cache, render <RefreshErrorState error={toHumanError('load',{area:'tickets'})} backHref='/helpdesk'/> above the table (as helpdesk/page.tsx does).
  4. Change the empty-case slaMetPct fallback from 100 to '—' when tickets.length===0.
- **Acceptance:**
  - Test: source:'error' renders '—' for Open Tickets and SLA Met, not 0/100%.
  - Test: empty valid list shows SLA Met '—', not 100%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes false-positive SLA compliance reading.
- **Depends on:** GAP-HELPDESK-TICKETS-02

### GAP-HELPDESK-TICKETS-02  ·  MEDIUM  ·  confirmed  ·  theme CONSISTENCY (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stat cards are computed from the server-fetched list while the table reads a separately seeded/cached copy (page.tsx:6-14 vs TicketsTable.tsx:31-36): offline, cards say 0 while the table shows cached tickets.
- **Verified evidence:** page.tsx:8-14 computes stats from server list; TicketsTable.tsx:39-44 uses useSeededResource('helpdesk.tickets', tickets, source, isEmpty), which on server error/empty falls back to an IndexedDB cached copy (lib/sync/resource.ts:229-262). So offline or on error the table shows cached rows while cards show 0/100%. Not 'fabricated' data; a source-of-truth mismatch.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/page.tsx`, `apps/web/src/app/(app)/helpdesk/tickets/TicketsTable.tsx`
- **Fix steps:**
  1. Move the stat cards into a client component (or into TicketsTable) that computes from the same useSeededResource rows.
  2. Keep server-side render of initial data for first paint.
  3. When provenance is 'cached' or 'error-no-data', label cards 'as of {cachedAt}' or show '—'.
- **Acceptance:**
  - Test: server data [] with cache of 3 tickets shows counts derived from 3 rows.
  - Offline with no cache shows '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Stale cached counts must be labelled.
- **Depends on:** GAP-HELPDESK-TICKETS-01

### GAP-HELPDESK-TICKETS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** First Response and CSAT are permanently "—" (page.tsx:18-21); two of four headline cards carry no data and no explanation to the user.
- **Verified evidence:** page.tsx:16-21 hard-sets firstResponseDisplay='—' and csatDisplay='—' with code comments explaining no data source; StatCards at 43,45 show them with no tooltip or note. Does not fabricate values, but the reason is invisible to users. helpdesk/page.tsx uses getTicketAnalytics (avgResolutionHours) so an analytics loader exists but no first-response/CSAT field was verified.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/page.tsx`
- **Fix steps:**
  1. Check whether getTicketAnalytics (loaders.ts) returns first-response or CSAT fields; if so bind them.
  2. Otherwise show value 'Not available' with a HelpTip/hint ('Not yet measured')  or remove the two cards.
  3. Use the StatCard sub/hint prop if it exists (verify in ds/StatCard.tsx).
- **Acceptance:**
  - Cards either show real numbers or carry visible 'Not available' explanation.
  - No permanent unexplained '—' cards.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-HELPDESK-TICKETS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Title "Citizen Tickets" with subtitle "Tickets, SLAs, agents, queues and knowledge base." — the subtitle promises agents, queues and a knowledge base this page does not offer (page.tsx:26-27); the same string is reused on ticket detail (tickets/[id]/page.tsx:48).
- **Verified evidence:** tickets/page.tsx:27 subtitle 'Tickets, SLAs, agents, queues and knowledge base.' and the identical string (with an emoji) at tickets/[id]/page.tsx:48; the page only offers a ticket list, Export and New Ticket. Copy issue, not a wiring bug.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/page.tsx`, `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`
- **Fix steps:**
  1. List page: subtitle 'Citizen support tickets with SLA status and breach risk.'
  2. Detail page: subtitle e.g. ticket.subject, no emoji.
  3. Keep the tagline only on the module landing.
- **Acceptance:**
  - Subtitles differ per page and describe only offered features.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-HELPDESK-TICKETS-DETAIL-07

### GAP-HELPDESK-TICKETS-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Breach Risk column is a prediction (PredictionBadge) with no legend for probability vs confidence in the table header (TicketsTable.tsx:93-105).
- **Verified evidence:** TicketsTable.tsx:93-105: Breach Risk column renders PredictionBadge with label '{p}% breach' and confidence; column header is plain 'Breach Risk' with no legend or tooltip. ds/PredictionBadge and ExplainabilityTooltip exist so a legend can reuse them. isFallback is passed through (102).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/TicketsTable.tsx`
- **Fix steps:**
  1. Change the column label to include a HelpTip: 'Predicted probability the SLA will be breached; badge shows model confidence.'
  2. Or add a one-line legend under the table card header.
  3. Show an explicit 'No prediction' text instead of null when breachRisk is absent.
- **Acceptance:**
  - Header shows an accessible help tip.
  - Rows without a prediction show a non-empty placeholder.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /helpdesk/tickets/[id]  —  `helpdesk/tickets-detail.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`
- **Design reference:** `redesign/helpdesk/tickets-detail.html`

### GAP-HELPDESK-TICKETS-DETAIL-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Assign asks for "Assignee user UUID" in a free-text field (TicketActions.tsx:158-165) and the confirm dialog says only "The selected agent" (TicketActions.tsx:209-212): a typo or pasted wrong id reassigns the ticket with no name shown before or after; list pages display agent names, not ids.
- **Verified evidence:** TicketActions.tsx:158-166 is a free-text 'Assignee user UUID' input; on submit it opens a ConfirmDialog (205-214, description 'The selected agent becomes responsible...') so a confirm step DOES exist (the stub 'fix' text is stale), but no agent name is shown before or after, and the dialog has no reason field. PATCH /v1/citizen/tickets/:id/assign sends { assigneeId } (line 91). Detail page prints ticket.assignedTo (page.tsx:65,94), which mapSingleHelpdeskTicket (app/_data/apiMappers.ts) fills from assignedTo ?? assigneeId, i.e. possibly a raw id. No shared EntityPicker/user-lookup exists in ds (only local use in admin/integrations); user-directory endpoint cannot be verified (citizen-service/identity absent).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/[id]/TicketActions.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create a shared ds/EntityPicker (search input + listbox, returns {id,label}) fed by an existing staff/agent lookup endpoint (decision: confirm which endpoint lists agents).
  2. Replace the UUID <input> in the assign form (TicketActions.tsx:158-166) with EntityPicker; store {id,label} in state instead of assigneeId string.
  3. Interpolate the chosen agent label into the assign ConfirmDialog description ('Assign to {label}?') and success message.
  4. Optionally set requireReason on the assign dialog and forward it in the PATCH body only if the API accepts it (cannot verify).
  5. On the detail page render an agent display name rather than the raw assignedTo id (needs API to return a name).
- **Acceptance:**
  - Component test: selecting an agent shows their name in the confirm dialog; the PATCH body contains that agent's id.
  - Typing an unknown/pasted id cannot be submitted (Assign disabled until a picker option is chosen).
  - After assigning, the Agent field shows a name, not a UUID.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Mis-assignment routes citizen tickets to the wrong agent; picker depends on an agent-lookup API that may not exist.
- **Depends on:** EntityPicker (new shared component)

### GAP-HELPDESK-TICKETS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A failed fetch is rendered as "Ticket not found — does not exist or has been removed" beside the badge (page.tsx:22-28) because getHelpdeskTicketById returns null on error; an agent can conclude a live ticket was deleted. Sibling pages use RefreshErrorState.
- **Verified evidence:** page.tsx:20-29: when getHelpdeskTicketById fails, fetchJson (app/_data/apiClient.ts:141-144) returns data=null with source:'error' and status; the page shows DataSourceBadge plus EmptyState 'Ticket not found - This ticket does not exist or has been removed.' regardless of cause (5xx, 401, network, or genuine 404). Sibling pages (helpdesk/page.tsx:75, slas, reports, catalogue) use RefreshErrorState with toHumanError('load').
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`
- **Fix steps:**
  1. Import RefreshErrorState and toHumanError.
  2. Keep the destructure but also read result.status: const result = await getHelpdeskTicketById(id).
  3. If source==='error' && status!==404 render <RefreshErrorState error={toHumanError('load',{area:'ticket'})} backHref='/helpdesk/tickets' /> and drop the DataSourceBadge.
  4. Only when status===404 (or a valid empty response) render the 'Ticket not found' EmptyState.
  5. Optionally call notFound() for the 404 case.
- **Acceptance:**
  - Test: mock loader {data:null,source:'error',status:500} renders retry error state, not 'Ticket not found'.
  - Test: {status:404} renders 'Ticket not found'.
  - Manual: stop citizen-service, open a ticket, see retry UI and Retry re-fetches.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; makes outage vs missing-ticket distinguishable for agents.

### GAP-HELPDESK-TICKETS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme WIRING (was NAVUX)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Conversation has a Notes tab for isInternal comments (TicketConversation.tsx:8-13) but the composer only posts to /notes with { body } and no internal flag (TicketActions.tsx:80): the UI cannot create the internal notes it displays, and the reply message always says "sent to the citizen" (TicketActions.tsx:81).
- **Verified evidence:** TicketConversation.tsx:15-23 has Messages/Notes tabs filtering on isInternal (mapped from n.isInternal in apiMappers.ts). Composer TicketActions.tsx:80 POSTs /v1/citizen/tickets/:id/notes with { body: reply } only, and the label/success text always say 'citizen' (127, 81). So the UI has no way to send isInternal:true and would label an internal note as a citizen reply. Whether the /notes endpoint accepts an isInternal flag cannot be verified (citizen-service absent); the bare notes endpoint name suggests notes may be internal-by-default, so the true behaviour is unknown.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/[id]/TicketActions.tsx`
- **Fix steps:**
  1. Add a 'Reply to citizen' / 'Internal note' toggle (radio or Segmented) in the reply form.
  2. Send { body: reply, isInternal } only once the API contract is confirmed (decision with citizen-service owners).
  3. Change the label, submit text and success message per mode (line 81 'Reply sent to the citizen.' vs 'Internal note added.').
  4. Add a visible warning that replies are sent to the citizen when in reply mode.
- **Acceptance:**
  - Component test: internal mode posts isInternal:true and shows 'Internal note added.'
  - Internal note appears under the Notes tab after refresh, not under Messages.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** An internal note posted as a citizen-visible reply (or vice-versa) leaks staff commentary to the citizen.

### GAP-HELPDESK-TICKETS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme RBAC (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Reply/Assign/Resolve/Close render for every viewer and every status (TicketActions.tsx:111-121), including closed tickets and non-agent roles; only the server can refuse, after the user has typed. Audit of these four mutations cannot be checked (citizen-service absent).
- **Verified evidence:** TicketActions.tsx:109-122 renders Reply, Assign, Resolve, Close unconditionally; the component receives only ticketId (line 8) and page.tsx:51 passes no status or permissions, so closed/resolved tickets and any role see all four. Server-side refusal and audit events for the four mutations cannot be checked (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`, `apps/web/src/app/(app)/helpdesk/tickets/[id]/TicketActions.tsx`
- **Fix steps:**
  1. Pass ticket.status (and a can-act flag from the existing session/role helper) into <TicketActions>.
  2. Hide or disable Resolve/Close/Assign/Reply when status is 'closed'; hide Resolve when already 'resolved'; show tooltip reason.
  3. Hide all mutating buttons for non-agent roles using the app's existing permission check (identify helper; cannot verify name).
  4. Keep server enforcement authoritative; map 403/409 through formError.
- **Acceptance:**
  - Component test: status='closed' renders no action buttons.
  - Test: viewer role sees no buttons.
  - Manual: resolved ticket offers Close only.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong hiding rules could block legitimate agents; keep server as source of truth.

### GAP-HELPDESK-TICKETS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Requester email printed unmasked to anyone who can open the ticket (page.tsx:93) — DPDP-sensitive contact data without role gate or masking.
- **Verified evidence:** page.tsx:93 prints ticket.requesterEmail unmasked with no role gate. However the loader actually used, getHelpdeskTicketById -> mapHelpdeskTicketDetail -> mapSingleHelpdeskTicket (app/_data/apiMappers.ts:604-655), does not copy requesterEmail into the result (only loaders.ts:3239 mapTicketDetails does, and that feeds the SLA queue), so today the Email row is effectively never shown. The exposure becomes real as soon as the mapper is fixed. No shared <Masked> component exists in the repo.
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`
- **Fix steps:**
  1. Decide whether the email should be shown at all (decision); if yes, create ds/Masked (mask a***@d***.com, reveal button gated by role, audit call on reveal).
  2. Wrap the value at page.tsx:93 in <Masked kind='email' value={...}/>.
  3. Only add requesterEmail to mapSingleHelpdeskTicket after Masked exists.
  4. Emit an audit event on reveal via the existing audit route (cannot verify endpoint).
- **Acceptance:**
  - Component test: default render shows masked value; reveal requires permitted role.
  - Snapshot shows no full email in server-rendered HTML for non-privileged role.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of citizen contact data; reveal must be audited.
- **Depends on:** Masked (new shared component)

### GAP-HELPDESK-TICKETS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Dates are date-only (formatIndianDate) for Created and every comment Time (page.tsx:37,66) although the page is about SLA clocks; two same-day messages cannot be ordered and no SLA due time is shown.
- **Verified evidence:** page.tsx:37 (comment Time) and :66 (Created) use formatIndianDate (lib/formatters.ts:2), which outputs dd/MM/yyyy only, no time. No date-time formatter exists in lib/formatters.ts. TicketDetail has no SLA due field in the mapper (apiMappers.ts:641-655), so an SLA due time cannot be shown without API support (cannot-verify whether citizen-service returns it). Same-day comments in DataTable cannot be distinguished by Time column.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts using toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); return '—' for invalid.
  2. Use it at page.tsx:37 and :66 and in resolvedAt if shown.
  3. Sort comments ascending by createdAt before mapping.
  4. If API exposes an SLA due timestamp, map it and add an 'SLA due' field (backend confirmation needed).
- **Acceptance:**
  - Unit test: formatIndianDateTime('2026-03-01T04:00:00Z') === '01 Mar 2026, 09:30 am' (IST).
  - Two same-day comments show different times.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; SLA due part depends on backend.

### GAP-HELPDESK-TICKETS-DETAIL-07  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle is the module tagline with an emoji, repeated from the list page (page.tsx:48); Channel prints the raw code e.g. walk_in (page.tsx:63); result text colours are hard-coded #b91c1c/#047857 (TicketActions.tsx:250).
- **Verified evidence:** page.tsx:48 subtitle '🎫 Tickets, SLAs, agents, queues and knowledge base.' (emoji plus generic tagline, not detail-specific); page.tsx:63 prints ticket.channel raw (values web|email|phone|walk_in, so 'walk_in'); TicketActions.tsx:250 hard-codes #b91c1c/#047857 while design tokens --bad/--good exist (civitas-ds.css:15; other inspection forms use var(--good)/var(--bad)).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`, `apps/web/src/app/(app)/helpdesk/tickets/[id]/TicketActions.tsx`
- **Fix steps:**
  1. Replace subtitle with ticket.subject or 'Opened {formatted date} via {channel}' and remove the emoji.
  2. Render channel with humanizeStatus() from lib/formatters.ts (or a small CHANNEL_LABELS map).
  3. Change line 250 colours to var(--bad)/var(--good).
- **Acceptance:**
  - Detail page shows 'Walk in' not 'walk_in'.
  - Result message colours switch with .dark theme (no hex literals in file).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /helpdesk/tickets/new  —  `helpdesk/tickets-new.html`

- **Source:** `apps/web/src/app/(app)/helpdesk/tickets/new/page.tsx`
- **Design reference:** `redesign/helpdesk/tickets-new.html`

### GAP-HELPDESK-TICKETS-NEW-01  ·  MEDIUM  ·  partly  ·  theme WIRING (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No requester, channel or category fields (NewTicketForm.tsx:50-54): the header says "on behalf of citizen support" but the ticket is filed as the signed-in user, so an agent logging a phone/walk-in complaint cannot record the citizen or the channel that the ticket list later displays (TicketDetail.channel, loaders.ts:3243).
- **Verified evidence:** NewTicketForm.tsx:49-53 body has only subject, description, priority; no requester, channel or category inputs (85-138). File header comment (11-19) says it posts to citizen-service POST /v1/citizen/tickets 'citizen-facing intake' and page subtitle is 'Submit a helpdesk request for citizen support.' (new/page.tsx:9), not 'on behalf of'. Tickets read back carry channel and requesterName (apiMappers.ts:650), so an agent filing a phone/walk-in complaint cannot set them. Whether POST accepts requester/channel/category cannot be verified (citizen-service absent). Not a PII-masking issue.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/new/NewTicketForm.tsx`
- **Fix steps:**
  1. Confirm with citizen-service owners which body fields POST /v1/citizen/tickets accepts (requesterName, requesterContact, channel).
  2. Add a Channel select (web/email/phone/walk_in) and optional requester name/contact inputs, shown for agent roles.
  3. Add fields to the body at line 49 only when filled.
  4. Add DPDP hint text beside contact fields.
- **Acceptance:**
  - Test: selecting Phone and entering requester name puts channel:'phone' in POST body.
  - Created ticket shows channel and requester on the list/detail.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Collecting citizen contact data adds DPDP obligations.

### GAP-HELPDESK-TICKETS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Success gives no ticket number: toast "Ticket submitted successfully." then redirect to the list (NewTicketForm.tsx:64-66), so the filer has nothing to quote back to the citizen.
- **Verified evidence:** NewTicketForm.tsx:61-68: on ok it calls toast.success('Ticket submitted successfully.') then router.push('/helpdesk/tickets'); the response body is never read, so no ticketNo is shown. Whether the POST response contains ticketNo/id cannot be verified (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/new/NewTicketForm.tsx`
- **Fix steps:**
  1. After res.ok, parse const created = await res.json().catch(()=>null).
  2. If created?.ticketNo (or id) exists, toast 'Ticket {ticketNo} submitted.' and router.push(`/helpdesk/tickets/${created.id}`) instead of the list.
  3. Fall back to the current message and list redirect when the body has no id.
- **Acceptance:**
  - Test: mocked 201 {id, ticketNo:'TKT-102'} shows toast containing TKT-102 and navigates to the detail route.
  - Empty body still succeeds without a crash.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-HELPDESK-TICKETS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme THEME (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded #fff field backgrounds and #b91c1c / #047857 message colours (NewTicketForm.tsx:86,103,120,146) bypass tokens; fields render white on the dark theme.
- **Verified evidence:** NewTicketForm.tsx:86,103,120 inline background:'#fff' on .field wrappers (the .field class already uses var(--panel), civitas-ds.css:221, so the override breaks dark mode); :146 colours '#b91c1c' / '#047857'.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/new/NewTicketForm.tsx`
- **Fix steps:**
  1. Remove background:'#fff' from the three .field style props (keep padding or drop it as the class supplies it).
  2. Replace error/success colours with var(--bad)/var(--good).
  3. Check .inp styling in dark mode.
- **Acceptance:**
  - Toggling .dark on <html> makes form panels dark.
  - grep for '#fff|#b91c1c|#047857' in the file returns nothing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-HELPDESK-TICKETS-NEW-04  ·  LOW  ·  partly  ·  theme A11Y (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Single summary error, no per-field aria-invalid / aria-describedby, form is noValidate (NewTicketForm.tsx:74-80); Description free text up to 5000 chars has no DPDP hint not to paste Aadhaar/PAN.
- **Verified evidence:** NewTicketForm.tsx:78-83 form has noValidate; validation errors go to a single <p role='alert'> (140-152) with no aria-invalid/aria-describedby on inputs (90-117); inputs have proper label/htmlFor. Description (107-117) maxLength 5000 with no DPDP hint about Aadhaar/PAN. Masked/CSV parts of the suggested fix do not apply here.
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/new/NewTicketForm.tsx`
- **Fix steps:**
  1. Track per-field errors ({subject?, description?}) and set aria-invalid and aria-describedby pointing to an error <p id> under each field.
  2. Move focus to the first invalid field on submit.
  3. Add helper text under Description: 'Do not enter Aadhaar, PAN, passwords or bank details.'
  4. Optionally add a character counter.
- **Acceptance:**
  - Test: empty submit sets aria-invalid on subject and focuses it.
  - Screen reader announces helper text via aria-describedby.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-HELPDESK-TICKETS-NEW-05  ·  LOW  ·  confirmed  ·  theme UX (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Priority is freely selectable up to Critical for any role with no explanation of SLA impact (NewTicketForm.tsx:127-136).
- **Verified evidence:** NewTicketForm.tsx:124-136: priority select offers Low/Medium/High/Critical for everyone, no help text; priority is lowercased and sent (20-22, 52). Whether the server restricts Critical by role or how SLA is derived from priority cannot be verified (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/helpdesk/tickets/new/NewTicketForm.tsx`
- **Fix steps:**
  1. Add helper text or option labels stating SLA target per priority once confirmed by product (decision).
  2. Optionally require a justification or confirm when Critical is chosen.
  3. Restrict options by role if the API requires it.
- **Acceptance:**
  - Selecting Critical shows the SLA note.
  - Test: helper text present with aria-describedby on the select.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Wrong SLA copy would mislead users; needs sign-off.


---
## Backend verification items (service code absent from snapshot)

### GAP-HELPDESK-CATALOGUE-BREACHES-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Tenant-wide breach data (requestedBy, stages) has no role gate in the page (whole file) — visible to any user who types the URL; the only entry is a ghost link on /helpdesk/catalogue for everyone (catalogue/page.tsx:47-49). Enforcement is server-side and undeterminable.
- **Service:** `helpdesk-service`  ·  **Endpoint(s):** `['GET /api/v1/helpdesk/catalogue/requests/breaches']`
- **Question:** Does the breaches endpoint restrict tenant-wide requestedBy/stage data to supervisor/admin roles?
- **How to verify:** Open the breaches route in helpdesk-service; check requireRole. curl as a plain user, expect 403.
- **Test to add:** Given role=employee when GET breaches then 403; given helpdesk_admin then 200.
- **Impact if wrong:** Employee names and request stages exposed to all users.
- **Web change if wrong:** Add role layout for helpdesk/catalogue/breaches and hide the entry link for others.
