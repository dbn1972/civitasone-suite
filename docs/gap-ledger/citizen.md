# Detailed gap file — module `citizen`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 123, BACKEND-VERIFY 11



---
## /citizen  —  `citizen/home.html`

- **Source:** `apps/web/src/app/(app)/citizen/page.tsx`
- **Design reference:** `redesign/citizen/home.html`

### GAP-CITIZEN-HOME-01  ·  HIGH  ·  partly  ·  theme NAV (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Eight routes under /citizen have no tile and no other in-app link: catalogue, intake, documents, eligibility, payments, certificates, discovery, appeals (grep of apps/web/src finds no href to them outside their own pages; page.tsx:6-15). Reachable only by typing the URL.
- **Verified evidence:** citizen/page.tsx:6-15 lists 8 tiles (requests, rti, grievances, feedback, portal, alerts, notices, surveys). Repo-wide grep of apps/web/src finds no link to /citizen/intake, documents, eligibility, payments, discovery or appeals (only fetch URLs to /api/.../citizen/*). Two of the eight do have in-app links, contrary to the observation: /citizen/catalogue (TrackClient.tsx:64, ServiceRuntimeFlow.tsx:265, services/[serviceKey]/page.tsx:41 back links) and /citizen/certificates (TrackClient.tsx:121) - but those pages are only reachable from the catalogue itself, so it is effectively orphaned too. navRouteManifest.ts lists only /citizen and /citizen/grievances.
- **Files to change:** `apps/web/src/app/(app)/citizen/page.tsx`, `apps/web/src/messages/en.json (+hi/kn/ta/te)`, `apps/web/src/app/_components/navRouteManifest.ts`
- **Fix steps:**
  1. Extend citizenTiles in page.tsx with tiles for catalogue, intake, documents, eligibility, payments, certificates, discovery, appeals (title via t() keys, not literals).
  2. Group tiles into sections (Service delivery SVC-081..090 vs Grievance/RTI/Engagement) using a heading per LinkTiles group.
  3. Add message keys citizen.tile* in all 5 locale files.
  4. Add the new routes to navRouteManifest.ts so sidebar/search/breadcrumbs know them.
  5. Confirm each tile respects role/entitlement (ModuleGate is module-level only).
- **Acceptance:**
  - Component test: /citizen renders a link for each of the 8 previously orphaned hrefs.
  - Manual: from /citizen reach /citizen/appeals in one click; 5 locales show translated labels.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; exposing staff-only pages (payments record, intake) to citizen-role users - confirm role gating first.

### GAP-CITIZEN-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle says 'Grievances, service requests, and RTI applications' (messages en.json citizen.description) but the module also hosts the whole SVC-081..090 service-delivery lifecycle.
- **Verified evidence:** messages/en.json:513 citizen.description = 'Grievances, service requests, and RTI applications.' and page.tsx:20 passes it as the subtitle. The module directory hosts catalogue, intake, documents, eligibility, payments, certificates, discovery, appeals, services/[serviceKey] (SVC-081..090), which the copy omits.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/messages/kn.json`, `apps/web/src/messages/ta.json`, `apps/web/src/messages/te.json`
- **Fix steps:**
  1. Reword citizen.description in en.json to cover service delivery (e.g. 'Service catalogue, applications, payments, certificates, grievances and RTI.').
  2. Update hi/kn/ta/te equivalents.
  3. Keep in sync with HOME-01 tile groups.
- **Acceptance:**
  - Visual: /citizen subtitle mentions service delivery in every locale.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CITIZEN-HOME-01

### GAP-CITIZEN-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Page uses legacy PageShell (bg-slate-50, text-3xl) while every sibling route uses PageHeader (page.tsx:3,19).
- **Verified evidence:** citizen/page.tsx:3,19 uses PageShell (_components/PageShell.tsx: min-h-screen bg-slate-50 p-6, h1 text-3xl). Within the citizen tree it is the only PageShell user (grep); all sibling routes use ds PageHeader, which supports help and back. Nested inside the (app) shell this double-pads and adds a slate background that ignores dark mode tokens.
- **Files to change:** `apps/web/src/app/(app)/citizen/page.tsx`
- **Fix steps:**
  1. Replace PageShell with PageHeader from _components/ds, passing title, subtitle=t('description'), help='citizen'.
  2. Render LinkTiles directly below (no wrapper).
  3. Remove the PageShell import.
- **Acceptance:**
  - Visual: /citizen has same heading size/spacing as /citizen/portal; no slate background in dark mode.
  - Help link 'How this works' still present.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-HOME-04  ·  LOW  ·  confirmed  ·  theme NAV (was LOADING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** not-found.tsx renders an EmptyState with no back-to-Citizen action (not-found.tsx:8-11).
- **Verified evidence:** citizen/not-found.tsx:8-11 renders EmptyState with title/message only. EmptyState (ds/EmptyState.tsx) accepts an `action` ReactNode that is unused, so a mistyped citizen URL offers no way back.
- **Files to change:** `apps/web/src/app/(app)/citizen/not-found.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Pass action={<Link href='/citizen' className='btn'>{t('notFoundBack')}</Link>} to EmptyState.
  2. Add citizen.notFoundBack key in all 5 locales.
- **Acceptance:**
  - Visit /citizen/nonexistent: a 'Back to Citizen Services' button navigates to /citizen.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/alerts  —  `citizen/alerts.html`

- **Source:** `apps/web/src/app/(app)/citizen/alerts/page.tsx`
- **Design reference:** `redesign/citizen/alerts.html`

### GAP-CITIZEN-ALERTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch reads as good news on the stat cards: page.tsx:9-29 counts from `alerts` even when source==='error' (empty array), so four real zeros show above the badge. Sibling portal/page.tsx null-gates (UX-013).
- **Verified evidence:** page.tsx:8 destructures only data/source and never checks source; on error `alerts` is [] (loaders.ts:3413 default) so :10-12 and :26-29 render four real-looking zeros (Active 0, Total 0, Expired 0, Drafts 0). AlertsTable (AlertsTable.tsx:48-50) shows the error-no-data badge but also the 'No alerts published' EmptyState for an outage. Sibling citizen pages (appeals/catalogue/certificates) already use toResourceState and em dashes.
- **Files to change:** `apps/web/src/app/(app)/citizen/alerts/page.tsx`, `apps/web/src/app/(app)/citizen/alerts/AlertsTable.tsx`
- **Fix steps:**
  1. In page.tsx call toResourceState(result) (app/_data/useResource.ts) and set active/expired/drafts/total to null when status==='error'; pass `value={x ?? '—'}` to StatCard as appeals/page.tsx:15,29 does.
  2. When errored render <RefreshErrorState error={toHumanError('load',{area:'alerts'})} backHref='/citizen' /> instead of AlertsTable (mirror citizen/appeals/page.tsx:31-34).
  3. In AlertsTable stop showing EmptyState when provenance==='error-no-data'.
- **Acceptance:**
  - Mock fetch failure: stat cards show '—' and RefreshErrorState with retry.
  - Mock 200 []: stat cards show 0 and 'No alerts published'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-ALERTS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status counts use exact-case 'Active'/'Expired'/'Draft' (page.tsx:10-12) while the table paints any string via cellType 'status'; any other casing/status (e.g. 'scheduled', 'active') is uncounted and 'Total Published' includes Drafts (page.tsx:27).
- **Verified evidence:** page.tsx:10-12 compare status with exact-case 'Active'/'Expired'/'Draft'; CitizenAlert.status is a free string (loaders.ts:3409, mapped by bare cast at :3416, no normalisation). DataTable status column (AlertsTable.tsx:65) shows any string, so 'active'/'scheduled' render but are uncounted. Allowed backend values cannot be verified (citizen service absent).
- **Files to change:** `apps/web/src/app/(app)/citizen/alerts/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm the backend status enum/casing with the citizen service owner.
  2. Normalise in getCitizenAlerts mapResponse: `status: String(r.status).toLowerCase()` and validate against a union type CitizenAlertStatus.
  3. Count by the normalised union; add an 'Other' bucket or log unknown values so totals reconcile.
  4. Render label via humanizeStatus (lib/formatters.ts:44).
- **Acceptance:**
  - Unit test: statuses 'ACTIVE','active','Scheduled' counted/handled per map; no alert silently dropped.
  - Sum of stat buckets equals row count.
- **Needs:** backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; miscounts only.
- **Depends on:** GAP-CITIZEN-ALERTS-03

### GAP-CITIZEN-ALERTS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Total Published' = alerts.length includes Draft rows, contradicting its own label (page.tsx:27).
- **Verified evidence:** page.tsx:27 `value={alerts.length}` under label statTotal='Total Published' (messages/en.json:521); alerts.length includes Draft rows counted in :12. Label and value disagree. Theme I18N is wrong; strings are already in next-intl.
- **Files to change:** `apps/web/src/app/(app)/citizen/alerts/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Compute `published = alerts.filter(a => status !== 'draft').length` (after normalisation from -02) and use it for statTotal, or rename the key to 'Total Alerts'.
  2. Update en.json (and hi.json if present) accordingly.
- **Acceptance:**
  - Fixture with 2 active + 1 draft: 'Total Published' shows 2 (or label reads 'Total Alerts' and shows 3).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CITIZEN-ALERTS-02

### GAP-CITIZEN-ALERTS-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Published date printed raw (ISO / empty) while requests and RTI pages format via formatIndianDate (AlertsTable.tsx:63).
- **Verified evidence:** AlertsTable.tsx:63 defines the publishedDate column with no render/cellType, and the row builder (:30-37) passes a.publishedDate unchanged; DataTable.cellValue (DataTable.tsx:126-138) falls to String(value). RTIClient.tsx:139-140 pre-formats with formatIndianDate (lib/formatters.ts:2, output dd/mm/yyyy en-IN, not 'dd Mon yyyy').
- **Files to change:** `apps/web/src/app/(app)/citizen/alerts/AlertsTable.tsx`
- **Fix steps:**
  1. Import formatIndianDate from '@/lib/formatters' and set `publishedDate: formatIndianDate(a.publishedDate)` in the tableRows useMemo (this also fixes the CSV export, which uses raw row values, DataTable.tsx:264-271).
  2. Empty value then renders '—'.
- **Acceptance:**
  - Row with publishedDate '2026-03-05T10:00:00Z' shows 05/03/2026; empty shows '—'.
  - CSV export contains the formatted date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Sorting by the formatted string becomes lexical (dd/mm/yyyy); keep a hidden raw field or accept it.

### GAP-CITIZEN-ALERTS-05  ·  LOW  ·  partly  ·  theme SCOPE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Page is read-only: no publish/draft/expire action exists in the route though the stats imply a publishing workflow (page tree has no mutation).
- **Verified evidence:** The route is read-only: page.tsx and AlertsTable.tsx contain no POST/PATCH or link to a create/publish screen, and citizen/page.tsx only links here. But stat cards (Active/Expired/Drafts) describe state, they do not promise controls; and whether an alert-authoring UI exists elsewhere (e.g. admin/communications) was not found in citizen/*. Backend publish endpoints cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/citizen/alerts/page.tsx`
- **Fix steps:**
  1. Decision: is authoring in scope for this page or another module? If elsewhere, add a PageHeader action linking to it.
  2. If in scope, add a role-gated 'New alert' action (draft -> publish -> expire) using ConfirmDialog and audit event; otherwise mark subtitle as read-only register.
- **Acceptance:**
  - Manual: a user with publish role sees the action; a viewer does not.
  - No control on the page that leads to 404.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /citizen/appeals  —  `citizen/appeals.html`

- **Source:** `apps/web/src/app/(app)/citizen/appeals/page.tsx`
- **Design reference:** `redesign/citizen/appeals.html`

### GAP-CITIZEN-APPEALS-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Appeal is filed against a raw 'Application ID (UUID, optional)' typed by hand (AppealPanel.tsx:43-44); with the ID optional an appeal can be filed against nothing.
- **Verified evidence:** AppealPanel.tsx:44-45 is a free-text input labelled 'Application ID (UUID, optional)' (en.json:538); submit is disabled only by `!grounds || !decisionDate` (:52) and the body sends `applicationId: applicationId || undefined` (:30), so an appeal can be filed with no application and with a mistyped UUID. Also the citizen can type the filing window (`windowDays`, :48-49), which should come from the decision/service. No EntityPicker exists in the repo (grep finds none). Backend validation of applicationId cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/appeals/AppealPanel.tsx`, `apps/web/src/app/(app)/citizen/appeals/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create ds <EntityPicker> (searchable select of the citizen's own applications by service name + submitted date, value = id) fed by GET /api/v1/citizen/requests (existing loader used by citizen/requests).
  2. Make applicationId required in AppealPanel; disable submit when empty; keep UUID only in the request body/URL (?applicationId= prefill from requests page).
  3. Replace editable windowDays with a read-only value derived from the selected application/service, or drop it if the backend defaults it.
  4. Update en.json label to 'Application'.
- **Acceptance:**
  - Component test: submit disabled until an application is chosen.
  - Manual: /citizen/appeals?applicationId=X preselects it.
  - Backend test: POST without applicationId returns 400.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Legal: filing window is statutory; a user-editable window could let out-of-time appeals through if the server trusts it (verify server-side).
- **Depends on:** EntityPicker component

### GAP-CITIZEN-APPEALS-03  ·  MEDIUM  ·  confirmed  ·  theme COPYMISMATCH (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle promises 'appellate authority assignment, hearings and orders' but the list shows only type, grounds, deadline, status and outcome (appeals/page.tsx:41-47).
- **Verified evidence:** en.json:536 subtitle: 'track appellate authority assignment, hearings and orders'. The list (appeals/page.tsx:41-47) has only type, grounds, deadline, status, outcome, and AppealSummary (citizenPartials.ts:49-56) has no authority/hearing/order fields. Wrong theme: this is copy/feature mismatch.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/citizen/appeals/page.tsx`
- **Fix steps:**
  1. Short-term: reword citizenAppeals.pageSubtitle to what exists ('File an appeal within the statutory window and track its status and outcome').
  2. Long-term: if backend exposes authority/hearing/order, extend AppealSummary and add columns or an appeal detail route.
- **Acceptance:**
  - Subtitle matches visible columns.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-APPEALS-04  ·  MEDIUM  ·  confirmed  ·  theme ERRORCOPY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error text from a failed POST is res.text() shown raw in role=alert (AppealPanel.tsx:34,63) except for FILING_WINDOW_EXPIRED.
- **Verified evidence:** AppealPanel.tsx:33-34 throws Error(txt) with the raw response body (only FILING_WINDOW_EXPIRED is special-cased), catch at :37 stores e.message, rendered at :60 in role=alert. A JSON error envelope, stack text or internal code would be shown to the citizen. Also line 57 prints raw status and unformatted filingDeadline ('Filing deadline was ...').
- **Files to change:** `apps/web/src/app/(app)/citizen/appeals/AppealPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Parse res.json() safely and map known `code` values (FILING_WINDOW_EXPIRED, VALIDATION, 401/403) to next-intl strings; default to toHumanError('save',{area:'appeal'}) from lib/messages.ts.
  2. Never render raw txt; log via existing client telemetry.
  3. Format filingDeadline with formatIndianDate and status with humanizeStatus at :57.
- **Acceptance:**
  - Mock 500 with body 'stack...' -> friendly message shown, body not shown.
  - Mock FILING_WINDOW_EXPIRED -> specific message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-APPEALS-05  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No pagination or filtering on the list; grounds truncated with ellipsis and no way to read the full text (appeals/page.tsx:52).
- **Verified evidence:** appeals/page.tsx:39-60 renders every row of getAppeals() (citizenPartials.ts:57, no page/limit params) in a plain table with no filter, sort or pagination; :53 uses whiteSpace:nowrap + ellipsis with no title, so grounds text is unreadable beyond 320px. Server-side row cap of the endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/appeals/page.tsx`, `apps/web/src/app/(app)/citizen/appeals/AppealsTable.tsx (new)`, `apps/web/src/app/_data/citizenPartials.ts`
- **Fix steps:**
  1. Swap the hand table for ds DataTable in a client AppealsTable (sortable, filterable, pageSize 15) as done in citizen/alerts/AlertsTable.tsx.
  2. Make grounds cell wrap with a 'View' expand or drawer; add title attr for full text.
  3. If the API supports it, pass page/limit/status query params and render total from the response, not rows.length.
- **Acceptance:**
  - With 40 fixtures: 15 per page, search works.
  - Long grounds can be read in full.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-APPEALS-06  ·  LOW  ·  partly  ·  theme RAWCODE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Table status/type printed as raw codes ('first', 'under_review'); the list has no link to the application (appeals/page.tsx:52-56).
- **Verified evidence:** page.tsx:52,55 print appealType and status raw ('first', 'under_review'; loader defaults 'appeal'/'filed', citizenPartials.ts:64-65). 'No link to the application' is real but not fixable in the page alone: AppealSummary (citizenPartials.ts:49-56) does not carry applicationId, so nothing to link. Theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/citizen/appeals/page.tsx`, `apps/web/src/app/_data/citizenPartials.ts`
- **Fix steps:**
  1. Render type/status with humanizeStatus (lib/formatters.ts:44) or ds StatusPill.
  2. Add applicationId to AppealSummary and mapResponse (only if backend returns it), then link to the request detail route in citizen/requests.
- **Acceptance:**
  - 'under_review' displays 'Under Review'.
  - If applicationId present the cell links to the request.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-APPEALS-05


---
## /citizen/catalogue  —  `citizen/catalogue.html`

- **Source:** `apps/web/src/app/(app)/citizen/catalogue/page.tsx`
- **Design reference:** `redesign/citizen/catalogue.html`

### GAP-CITIZEN-CATALOGUE-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Table has 5 <th> but 6 <td>: the SLA value (slaDays) renders in an unlabeled sixth column (catalogue/page.tsx:40-44 vs 55-60), so the subtitle's 'SLA' is unlabeled and breaks table semantics.
- **Verified evidence:** catalogue/page.tsx:40-44 declare 5 <th> (Service, Owner, Version, Channels, Documents); rows emit 6 <td> (:52-60), the last being slaDays formatted `${n}d`. The SLA cell has no header although the subtitle (en.json:554) advertises SLA. No colSla key exists in citizenCatalogue.
- **Files to change:** `apps/web/src/app/(app)/citizen/catalogue/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add `<th scope='col'>{t('colSla')}</th>` after colDocuments (page.tsx:44).
  2. Add citizenCatalogue.colSla ('SLA (days)') to en.json (and other locales).
  3. Optional: add a table test asserting th count == td count.
- **Acceptance:**
  - Render fixture: 6 headers, 6 cells; screen reader announces 'SLA' for the last column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-CATALOGUE-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Raw serviceKey shown under each name and channels printed as comma-joined codes ('portal, whatsapp') (catalogue/page.tsx:53-58).
- **Verified evidence:** page.tsx:54 prints s.serviceKey as a muted line under the service name; :58 `s.channels.join(', ')` prints raw codes (loader passes strings through, citizenPartials.ts:41). serviceKey is also the URL slug, so showing it is developer-facing detail for citizens.
- **Files to change:** `apps/web/src/app/(app)/citizen/catalogue/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Remove the serviceKey line (keep it in the Link href only).
  2. Map channel codes via a t('channel.<code>') lookup (portal, whatsapp, counter, ...) with humanize fallback; render as small chips.
- **Acceptance:**
  - Row shows 'WhatsApp, Portal' not 'whatsapp, portal'; no serviceKey visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-CATALOGUE-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Catalogue is a register-style table with no search, filter or sort, no category grouping and no direct Apply link; a citizen must open each service page (catalogue/page.tsx:36-64).
- **Verified evidence:** True that the list has no search, filter, sort or category (page.tsx:36-64 is a static table; CatalogueService has no category field, citizenPartials.ts:20-28 region). Overstated: the service name is already a Link to /citizen/services/[serviceKey] (page.tsx:51), and that route has an apply sub-route (services/[serviceKey]/apply), so an Apply path exists but not a direct button in the row.
- **Files to change:** `apps/web/src/app/(app)/citizen/catalogue/page.tsx`, `apps/web/src/app/(app)/citizen/catalogue/CatalogueTable.tsx (new)`
- **Fix steps:**
  1. Move the table to a client CatalogueTable using ds DataTable (filterable, sortable by name/owner/SLA).
  2. Add an 'Apply' Link column to /citizen/services/{serviceKey}/apply.
  3. Category grouping only if the API provides a category (decision/backend).
- **Acceptance:**
  - Typing 'birth' filters rows.
  - Apply button opens the apply route for that service.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-CATALOGUE-01

### GAP-CITIZEN-CATALOGUE-04  ·  MEDIUM  ·  partly  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Page shows 'Published' definitions only; the Service ID (UUID) that Intake, Documents, Eligibility and Payments require is never displayed here, so those screens cannot be filled from this one.
- **Verified evidence:** True: loader captures s.id (citizenPartials.ts:35) but the page never displays it, and Intake/Documents ask for a typed 'Service ID' (IntakePanel.tsx:18,66-67 with UUID placeholder; DocumentPanel.tsx:18). Better fix than showing UUIDs: those panels should not need typing them. Note the observation says page shows only Published - correct per endpoint name catalogue/published.
- **Files to change:** `apps/web/src/app/(app)/citizen/intake/IntakePanel.tsx`, `apps/web/src/app/(app)/citizen/documents/DocumentPanel.tsx`, `apps/web/src/app/(app)/citizen/eligibility`, `apps/web/src/app/(app)/citizen/payments`, `apps/web/src/app/(app)/citizen/catalogue/page.tsx`
- **Fix steps:**
  1. Add a service picker (EntityPicker fed by getCatalogueServices) to intake, documents, eligibility and payments panels; store id in state, show name.
  2. Add an 'Apply' link from the catalogue that deep-links with ?serviceId= to intake.
  3. Do not print UUIDs in the catalogue.
- **Acceptance:**
  - Intake: choose service by name, POST body has serviceId.
  - Deep link from catalogue preselects service.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** EntityPicker component, GAP-CITIZEN-APPEALS-02

### GAP-CITIZEN-CATALOGUE-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Documents column shows a count with no unit ('4') and no drill-down (catalogue/page.tsx:59).
- **Verified evidence:** page.tsx:59 prints `s.requiredDocumentCount` bare under header 'Documents'; loader reduces requiredDocuments[] to a length (citizenPartials.ts:42), discarding names, so no drill-down without changing the loader.
- **Files to change:** `apps/web/src/app/(app)/citizen/catalogue/page.tsx`, `apps/web/src/app/_data/citizenPartials.ts`
- **Fix steps:**
  1. Render `{n} documents` via ICU plural key (t('documentsCount',{count})).
  2. Optionally keep requiredDocuments names in the loader and show them in a popover/expander.
- **Acceptance:**
  - 1 -> '1 document', 4 -> '4 documents', 0 -> 'None'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/certificates  —  `citizen/certificates.html`

- **Source:** `apps/web/src/app/(app)/citizen/certificates/page.tsx`
- **Design reference:** `redesign/citizen/certificates.html`

### GAP-CITIZEN-CERTIFICATES-02  ·  HIGH  ·  partly  ·  theme TOKEN-UX (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Verify token is truncated to 12 characters + '…' in the list (certificates/page.tsx:58), so the register cannot be used to copy a working token; no copy button, QR or download.
- **Verified evidence:** certificates/page.tsx:58 shows `verifyToken.slice(0,12)…` in monospace 11px; no copy control, QR or download anywhere on the page. Truncation is real, but likely a deliberate secret-hygiene choice (the token is a bearer for the public verify endpoint), so 'cannot copy' is not necessarily a defect; and it conflicts with -04. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/citizen/certificates/page.tsx`
- **Fix steps:**
  1. Decision: should the register expose the token at all? If certs are the citizen's own, show a per-row 'Copy verify link' / 'Show QR' action instead of text.
  2. Implement a small client CopyButton (navigator.clipboard) that copies `${origin}/verify/${token}` without rendering the token; add aria-live confirmation.
  3. Add a download/print link only if a signed-PDF endpoint exists (cannot verify).
- **Acceptance:**
  - Click 'Copy verify link' -> clipboard has full URL, 'Copied' announced.
  - Full token never appears in DOM text.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Bearer token exposure vs usability tradeoff.
- **Depends on:** GAP-CITIZEN-CERTIFICATES-04

### GAP-CITIZEN-CERTIFICATES-03  ·  MEDIUM  ·  confirmed  ·  theme COPYMISMATCH (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle promises maker-checker issuance, gapless numbering and signed output — the page has no issuance action, approval queue or download (certificates/page.tsx:21-24).
- **Verified evidence:** en.json:565 subtitle promises 'Maker-checker issuance with gapless numbering, signed output and QR verification'. certificates/page.tsx renders only a verify form and a read-only register; there is no issue/approve action, queue or download. Whether the backend implements maker-checker is not visible. Copy/feature mismatch, not a CONFIRM-dialog gap.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/citizen/certificates/page.tsx`
- **Fix steps:**
  1. Reword pageSubtitle to 'Verify certificates and view issued ones' until issuance UI exists.
  2. If issuance is in scope, add separate officer route with ConfirmDialog + reason, maker!=checker enforced server-side and audit event (backend).
- **Acceptance:**
  - Subtitle only describes present features.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None for copy change.

### GAP-CITIZEN-CERTIFICATES-04  ·  MEDIUM  ·  partly  ·  theme PII (was ROLEGATE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Verify result exposes payloadHash to any signed-in user (CertificateVerify.tsx:70) and status/type as raw codes; verifyToken appears in the clear (12 chars) in a register visible to every user.
- **Verified evidence:** CertificateVerify.tsx:68-69 print certType/status raw and :71 (not :70) prints payloadHash (:70 is validTo). The register (page.tsx:52-59) lists tokens (12 chars) under only ModuleGate (citizen/layout.tsx), no role check. Whether the verify endpoint and register are tenant/owner-scoped or public cannot be verified (service absent); payloadHash is a digest, low sensitivity but not needed by a citizen.
- **Files to change:** `apps/web/src/app/(app)/citizen/certificates/CertificateVerify.tsx`, `apps/web/src/app/(app)/citizen/certificates/page.tsx`
- **Fix steps:**
  1. Remove payloadHash from the default result (behind 'Technical details' disclosure) or drop it.
  2. Humanize certType/status with humanizeStatus.
  3. Confirm with backend that GET /citizen/certificates is scoped to the caller/tenant; add requireAnyRole in a certificates layout for officer-only register if intended.
- **Acceptance:**
  - Verify result no longer shows hash by default.
  - Non-officer role cannot load the register (if decided).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; authorization scoping is the real risk.
- **Depends on:** GAP-CITIZEN-CERTIFICATES-02

### GAP-CITIZEN-CERTIFICATES-05  ·  MEDIUM  ·  confirmed  ·  theme ERRORCOPY (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error copy on a failed verify is res.text() shown raw (CertificateVerify.tsx:37,58).
- **Verified evidence:** CertificateVerify.tsx:37 `throw new Error((await res.text()) || 'Verification failed.')`, caught at :39-40 and rendered at :57 in role=alert. Raw response bodies reach the user; strings 'Verification failed.', 'Certificate is ...', 'Certificate not found' (:63) are also hard-coded English, not next-intl.
- **Files to change:** `apps/web/src/app/(app)/citizen/certificates/CertificateVerify.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Replace the raw text with toHumanError('load',{area:'certificate'}) (lib/messages.ts) or a t('verifyFailed') key; map 429/5xx separately.
  2. Move :63 strings and validity labels to next-intl keys.
  3. Do not read res.text() into UI.
- **Acceptance:**
  - Mock 500 with body 'boom' -> friendly message, no 'boom'.
  - 404 still shows 'not found' state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-CERTIFICATES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'active' stat counts amended and renewed as active (certificates/page.tsx:17) but the column shows the raw status.
- **Verified evidence:** page.tsx:17 counts status active|amended|renewed as 'active' while the status column (:56) prints the raw status; a row marked 'renewed' is counted active but labelled otherwise, and 'renewed' of an old certificate may actually be superseded. Backend status semantics cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/certificates/page.tsx`
- **Fix steps:**
  1. Confirm with domain owner whether amended/renewed are valid states.
  2. Render status via humanizeStatus/StatusPill (lib/formatters.ts:44) and compute the 'active' number from the same validity helper (also check validTo >= today).
  3. Rename the header count to 'currently valid' if the broader definition is intended.
- **Acceptance:**
  - Fixture with active, renewed, expired, revoked: count matches documented definition and pill text is human-readable.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /citizen/discovery  —  `citizen/discovery.html`

- **Source:** `apps/web/src/app/(app)/citizen/discovery/page.tsx`
- **Design reference:** `redesign/citizen/discovery.html`

### GAP-CITIZEN-DISCOVERY-01  ·  HIGH  ·  confirmed  ·  theme CONSENT (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** DPDP consent is granted by whoever types a citizen UUID and presses 'Grant consent' (DiscoveryPanel.tsx:29-34,68): no proof the citizen consented, no purpose text, no withdrawal control, no consent record shown on the page.
- **Verified evidence:** DiscoveryPanel.tsx:26-38 grant() POSTs only {citizenId} to /api/proxy/v1/citizen/discovery/consent; button at :68 enabled by any non-empty citizenId (no UUID validation). Any operator can record consent on a citizen's behalf; UI has no purpose text, no withdraw control, no list of consent records (en.json citizenDiscovery has no such keys). Server-side consent evidence/actor logging cannot be verified: citizen service absent from snapshot (only hrms-service present). Theme is consent, not masking.
- **Files to change:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.tsx`, `apps/web/src/app/(app)/citizen/discovery/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add purpose/notice text (t('consentPurpose')) and a required checkbox 'Citizen has given consent via <channel>' plus a channel select (in person/OTP/e-sign) before enabling Grant consent.
  2. Send {citizenId, purpose, channel, noticeVersion} in the consent POST; backend must record actor, timestamp, evidence and emit an audit event (needs backend confirmation).
  3. Add a consent status block: fetch existing consent for citizenId and show granted-at/by/purpose.
  4. Add 'Withdraw consent' button wrapped in <ConfirmDialog> with reason; disable Run discovery when consent is withdrawn.
  5. Validate citizenId as UUID with zod before enabling buttons; move messages to next-intl.
- **Acceptance:**
  - Component test: Grant consent stays disabled until the attestation checkbox and channel are set.
  - Manual: after grant, consent record (who/when/purpose) is visible; withdraw disables Run discovery.
  - Request body contains purpose/channel.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP compliance: without server-side evidence the UI attestation is still only a claim; changes API contract.
- **Depends on:** GAP-CITIZEN-DISCOVERY-03

### GAP-CITIZEN-DISCOVERY-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Run discovery notifies matched citizens as a side effect ('found and notified', DiscoveryPanel.tsx:54) with no preview or confirmation step — a batch messaging action behind a plain submit.
- **Verified evidence:** run() at DiscoveryPanel.tsx:40-58 submits directly to /discovery/run; success text 'N likely-eligible service(s) found and notified' (:54) uses body.notified. The DiscoveryMatch type (citizenGaps.ts:93-99) has notified boolean, confirming notification is a side effect. No preview/dry-run endpoint is known; whether the API supports dry-run is cannot-verify (service absent). Maker-checker is overkill here; a confirm is reasonable.
- **Files to change:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Wrap Run discovery in <ConfirmDialog> from @/app/_components/ds stating that matched services will notify the citizen (name channel).
  2. If backend supports a notify flag/dry-run, add a 'Preview matches without notifying' option; otherwise raise backend ticket.
  3. Show count notified vs matched separately using body.notified and matches.length.
  4. Move literals to next-intl keys.
- **Acceptance:**
  - Click Run discovery: dialog appears; Cancel makes no fetch call (component test).
  - Confirm: POST fires once and result shows notified count.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; but true no-notify preview needs backend. Maker!=checker not warranted; drop that part of the generic fix.
- **Depends on:** GAP-CITIZEN-DISCOVERY-01

### GAP-CITIZEN-DISCOVERY-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Matches list shows raw Service UUIDs and raw outcome/strength codes (DiscoveryPanel.tsx:78); getDiscoveryMatches (citizenGaps.ts:92) exists but no history is shown.
- **Verified evidence:** Match list renders {m.serviceId} — {m.outcome} (strength) at DiscoveryPanel.tsx:80 (raw UUID, raw code). getDiscoveryMatches exists in apps/web/src/app/_data/citizenGaps.ts:100 (GET /api/v1/citizen/discovery/matches?citizenId=) but is imported nowhere (grep) so no history. Citizen ID is also hand-typed (:64). Catalogue (citizen/catalogue/page.tsx) shows name + serviceKey, and getServices could map id->name.
- **Files to change:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.tsx`, `apps/web/src/app/(app)/citizen/discovery/page.tsx`, `apps/web/src/app/_data/citizenGaps.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Load service catalogue (existing catalogue loader) in page.tsx and pass an id->name map to DiscoveryPanel; render service name linking to /citizen/services/{serviceKey}.
  2. Map outcome/strength codes to labels via humanizeStatus (lib/formatters.ts:44) or next-intl keys.
  3. Call getDiscoveryMatches(citizenId) (server action or proxy fetch) after citizen is entered and render a history table with createdAt (formatIndianDate) and notified flag.
  4. Replace typed citizenId with a citizen lookup (no EntityPicker exists in repo: create one or reuse a search endpoint if present - decision).
- **Acceptance:**
  - Matches show service names, not UUIDs (component test with map).
  - Prior matches appear on load for the entered citizenId.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; EntityPicker does not exist so scope depends on a citizen search endpoint (cannot-verify).
- **Depends on:** GAP-CITIZEN-DISCOVERY-01

### GAP-CITIZEN-DISCOVERY-04  ·  MEDIUM  ·  partly  ·  theme ERRORCOPY (was ROLEGATE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error copy is res.text() raw for anything but 403 (DiscoveryPanel.tsx:52,58); success/error messages are hard-coded English literals, not next-intl keys.
- **Verified evidence:** Error handling: 403 gets a fixed English message (:50), any other non-OK throws raw res.text() (:51, :33), raw text shown at :72. Messages 'Consent recorded.', 'Discovery failed.', 'Profile must be valid JSON.' are hard-coded English (:34,:45,:51,:54). True. But it is an error-copy/i18n issue, not role gating; no role guard exists in the component (server role enforcement cannot be verified).
- **Files to change:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Replace res.text() with useFormError('discovery') as DocumentPanel.tsx:25/29 does (formError.fromResponse(res,'save'/'load')); keep the 403 CONSENT_REQUIRED branch.
  2. Move success/error literals to citizenDiscovery keys in en.json.
  3. Confirm server enforces role on /discovery/consent and /run (backend check).
- **Acceptance:**
  - Force a 500 from the proxy: user sees friendly copy, not raw body.
  - No English literals remain in DiscoveryPanel.tsx (grep).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-DISCOVERY-05  ·  MEDIUM  ·  confirmed  ·  theme SAMPLEDATA (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Profile is a free JSON textarea with a sample prefilled (age 65) that is submitted as-is if untouched (DiscoveryPanel.tsx:20,64).
- **Verified evidence:** DiscoveryPanel.tsx:20 initial state '{"age":65,"income_proof":"x"}'; submit at :44-48 parses and posts it untouched; textarea free JSON (:66). Same sample as EligibilityCheck.tsx:17. Fabricated sample data is sent as the citizen's real profile.
- **Files to change:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Initialise profile to '{}' (or empty) and show the sample as placeholder only.
  2. Disable Run discovery when profile is empty/unchanged sample or parse fails; show inline JSON error.
  3. Longer term: replace textarea with structured fields from the rule set's attribute schema (needs attribute-schema endpoint - decision).
- **Acceptance:**
  - Fresh page: profile empty; Run disabled until valid non-empty JSON entered.
  - Component test: no request sent with the sample profile.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; bad data could otherwise trigger real notifications.
- **Depends on:** GAP-CITIZEN-ELIGIBILITY-01


---
## /citizen/documents  —  `citizen/documents.html`

- **Source:** `apps/web/src/app/(app)/citizen/documents/page.tsx`
- **Design reference:** `redesign/citizen/documents.html`

### GAP-CITIZEN-DOCUMENTS-02  ·  HIGH  ·  confirmed  ·  theme CONSENT (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** DigiLocker 'fetch' is fabricated client-side: docUri = `digilocker://${docType}` (DocumentPanel.tsx:38) with no OAuth/consent redirect and no citizen consent capture — DPDP-relevant document access by the operator.
- **Verified evidence:** DocumentPanel.tsx:38 sends docUri: `digilocker://${docType}` to /v1/citizen/documents/digilocker-fetch; no OAuth redirect, no citizen consent step. Result text shows 'provider not configured' when configured===false (:72), suggesting backend stubs the provider. Real DigiLocker flow needs citizen authorisation; backend behaviour cannot be verified. Theme is consent/integration, not masking.
- **Files to change:** `apps/web/src/app/(app)/citizen/documents/DocumentPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Hide/disable 'Fetch from DigiLocker' unless the API reports the provider configured (add status probe if endpoint exists - backend).
  2. Replace fabricated docUri with the URI returned by a DigiLocker consent/OAuth callback flow (backend issues authorize URL; web redirects and handles callback).
  3. Require a citizen-consent attestation before fetch and include consent reference in the POST.
  4. Show consent + audit reference in the result panel.
- **Acceptance:**
  - With provider unconfigured, the button is disabled with explanation.
  - Fetch request contains a provider-issued URI, not digilocker://<docType>.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** DPDP/regulatory: operator fetching documents without citizen authorisation.
- **Depends on:** GAP-CITIZEN-DISCOVERY-01

### GAP-CITIZEN-DOCUMENTS-03  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Every action needs hand-typed Service and Application UUIDs (DocumentPanel.tsx:58-63); nothing on the page or the catalogue shows those IDs to copy.
- **Verified evidence:** DocumentPanel.tsx:59-62 two plain text inputs for Service ID and Application ID (UUID); catalogue page lists name/serviceKey only, never the UUID (catalogue/page.tsx:49-53). Upload/Load checklist disabled unless serviceId set (:66,:82). No copyable IDs anywhere.
- **Files to change:** `apps/web/src/app/(app)/citizen/documents/DocumentPanel.tsx`, `apps/web/src/app/(app)/citizen/documents/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In page.tsx load services via the existing catalogue loader and pass to DocumentPanel; replace Service ID input with a <select>/combobox by name (create shared EntityPicker in app/_components/ds if none).
  2. Applicant application: replace Application ID input with a picker of the citizen's requests (getCitizenRequests) or accept ?applicationId= query param and link from request detail.
  3. Keep IDs only in the request body/URL.
- **Acceptance:**
  - User selects a service by name; POST body carries its id.
  - Deep link ?serviceId=..&applicationId=.. prefills.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-DISCOVERY-03

### GAP-CITIZEN-DOCUMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme ENUMLABEL (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Verification result reads raw statuses ('pending', 'provider not configured') and doc types as codes like id_proof (DocumentPanel.tsx:73-78,98-101).
- **Verified evidence:** Result shows 'verification {uploaded.verificationStatus}' and '(DigiLocker: {providerStatus} — provider not configured)' at DocumentPanel.tsx:71-72; checklist 'Source: {source} · complete/incomplete' (:86) and docType is a free text input placeholder id_proof (:64), label falls back to raw docType (:94). English literals, no i18n.
- **Files to change:** `apps/web/src/app/(app)/citizen/documents/DocumentPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Map verificationStatus/providerStatus/source via humanizeStatus (lib/formatters.ts:44) or a next-intl status dictionary.
  2. Replace docType text input with a select populated from the checklist (items[].docType/label).
  3. Move 'Submitted', 'required', 'verified', 'missing' etc. to citizenDocuments keys.
- **Acceptance:**
  - Status 'pending' renders as 'Pending'.
  - docType is chosen from a list; no free text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-DOCUMENTS-03

### GAP-CITIZEN-DOCUMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme MISSINGACTION (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Checklist rows have no per-item upload/re-upload action; 'missing' items are text only (DocumentPanel.tsx:92-102).
- **Verified evidence:** Checklist <li> rows (DocumentPanel.tsx:89-96) render status text + label only; no button. Upload requires the separate form above with hand-typed docType. Upload endpoint posts JSON only ({applicationId, serviceId, docType}, :37) - no file is actually attached (existing FileUpload.tsx in ds not used), so real upload capability cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/documents/DocumentPanel.tsx`
- **Fix steps:**
  1. Add per-row Upload/Re-upload button that prefills docType and calls upload('upload').
  2. Use ds FileUpload for the file, and confirm with backend that multipart/object-storage upload exists (currently JSON without file).
  3. Refresh checklist after success.
- **Acceptance:**
  - Clicking Upload on a missing row submits that docType and the row flips to provided.
  - Verified rows show Re-upload only if allowed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; no real file transfer today.
- **Depends on:** GAP-CITIZEN-DOCUMENTS-03

### GAP-CITIZEN-DOCUMENTS-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Success panel uses a hard-coded #f8fafc surface and English literals rather than tokens/next-intl (DocumentPanel.tsx:74-77).
- **Verified evidence:** DocumentPanel.tsx:70 uses background 'var(--surface, #f8fafc)' (token with hex fallback - overstated, not purely hard-coded); message literals 'Submitted — verification' (:71-72) and colours #067647/#b42318 (:75,:91) are hard-coded English/hex. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/citizen/documents/DocumentPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Move strings to citizenDocuments keys with ICU params.
  2. Replace hex colours with semantic tokens (var(--good)/var(--bad)) as used in grievances/new/page.tsx.
- **Acceptance:**
  - grep finds no hex or English literals in JSX of DocumentPanel.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /citizen/eligibility  —  `citizen/eligibility.html`

- **Source:** `apps/web/src/app/(app)/citizen/eligibility/page.tsx`
- **Design reference:** `redesign/citizen/eligibility.html`

### GAP-CITIZEN-ELIGIBILITY-01  ·  HIGH  ·  confirmed  ·  theme USABILITY (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Eligibility is checked by pasting a JSON blob of applicant attributes and a raw Service UUID (EligibilityCheck.tsx:47-52); the prefilled sample ({age: 65, income_proof: 'x'}) will be submitted as-is. Non-technical clerks cannot use this, and attributes may include income/caste data (DPDP) typed in the clear.
- **Verified evidence:** EligibilityCheck.tsx:16-17 serviceId input (:52) and JSON textarea prefilled with {age:65,income_proof:'x'} (:17,:54), parsed and posted as-is (:27-31). Non-technical use is hard. Attributes are sent via proxy over HTTPS, so 'typed in the clear' is overstated (it's a visible textarea); masking is not the fix. Server-side logging of attributes cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/eligibility/EligibilityCheck.tsx`, `apps/web/src/app/(app)/citizen/eligibility/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Init subject to '{}' and drop the sample from state.
  2. Service picker by name from catalogue/rule sets (rule-set list already loaded in page.tsx:11) instead of UUID input.
  3. Generate attribute fields from the selected rule set's declared attributes if the API exposes them (cannot-verify), else keep advanced JSON in a collapsed 'Advanced' section.
  4. Do not log request body; note sensitive attribute categories in helper text.
- **Acceptance:**
  - Fresh page has no prefilled attributes; Run disabled until valid.
  - Selecting a service by name posts its id.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; wrong attribute entry gives wrong entitlement decisions.
- **Depends on:** GAP-CITIZEN-DISCOVERY-05, GAP-CITIZEN-DOCUMENTS-03

### GAP-CITIZEN-ELIGIBILITY-02  ·  HIGH  ·  partly  ·  theme ENUMLABEL (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Outcome shown to the operator only as raw codes ('eligible', 'not_eligible') and the reason strings from the API; no explanation of what data was used or an audit reference for the decision (EligibilityCheck.tsx:63-74).
- **Verified evidence:** EligibilityCheck.tsx:63-74 shows 'Outcome: {result.outcome}' raw code (eligible/not_eligible) and reason.message strings; reviewStatus 'pending' adds '(manual review queued)'. Result type (:10-11) has no audit id or inputs used, so an audit reference cannot be shown without a backend field. Not a date-format issue.
- **Files to change:** `apps/web/src/app/(app)/citizen/eligibility/EligibilityCheck.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Map outcome via label dictionary/humanizeStatus with icon+text (not colour only).
  2. Show per-rule pass/fail marker text (currently colour only, :69).
  3. Ask backend to return decisionId/auditRef and evaluatedAt; render with formatIndianDate when present.
  4. Move 'Outcome:' and other literals to next-intl.
- **Acceptance:**
  - outcome not_eligible renders 'Not eligible'.
  - Pass/fail rows have textual indicator.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-ELIGIBILITY-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle promises 'maker-checker publish' but the page is read-only for rule sets — no publish or approve control (eligibility/page.tsx:19-22; designer/_data/eligibilityBuilderApi.ts owns authoring).
- **Verified evidence:** messages citizenEligibility.pageSubtitle = 'Versioned rule sets (maker-checker publish) and applicant eligibility checks.'; page.tsx:19-22 renders it but the page has only the checker form and a read-only table (:26-60); no publish/approve control. Authoring lives elsewhere (designer/_data/eligibilityBuilderApi.ts, not checked further). Fix is copy plus link, not a confirm dialog.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/citizen/eligibility/page.tsx`
- **Fix steps:**
  1. Reword pageSubtitle to 'Check applicant eligibility against published rule sets.'.
  2. Add a link to the designer rule-set authoring page in the header actions if a route exists (verify route in app/(app)/designer).
  3. Optionally add a 'Rule sets are published via maker-checker in Designer' note.
- **Acceptance:**
  - Subtitle no longer claims publish.
  - Link opens the authoring screen.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-ELIGIBILITY-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Invalid JSON error 'Subject must be valid JSON.' names the field 'subject' while the label reads 'Applicant attributes (JSON)' (EligibilityCheck.tsx:27).
- **Verified evidence:** EligibilityCheck.tsx:27 throws 'Subject must be valid JSON.' while label t('subjectLabel') = 'Applicant attributes (JSON)' and state var is `subject`. Also error is displayed via setError(e.message) (:36). Trivial wording mismatch.
- **Files to change:** `apps/web/src/app/(app)/citizen/eligibility/EligibilityCheck.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Change message to next-intl key 'invalidJson' worded 'Applicant attributes must be valid JSON.'.
  2. Show it inline under the textarea with aria-describedby.
- **Acceptance:**
  - Bad JSON shows the new wording.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-ELIGIBILITY-05  ·  LOW  ·  partly  ·  theme NAVIGATION (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Rule-set table has no link to the rules or the service it belongs to (eligibility/page.tsx:47-55).
- **Verified evidence:** Rule-set table columns (page.tsx:41-46,50-54) show name, v{version}, ruleCount, raw status with no link. Data from getEligibilityRuleSets (citizenGaps.ts); whether ruleset has serviceId/rules detail route is unknown (no detail route in citizen/eligibility). Low impact.
- **Files to change:** `apps/web/src/app/(app)/citizen/eligibility/page.tsx`
- **Fix steps:**
  1. If the loader returns serviceId, link the name to /citizen/services/{serviceKey}; add serviceId to the mapping in citizenGaps.ts only if the API field exists.
  2. Link to Designer rule builder if a route exists (check app/(app)/designer).
  3. Humanise status (humanizeStatus).
- **Acceptance:**
  - Rule set name is a link to a valid page (no 404).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not link to non-existent routes.


---
## /citizen/feedback  —  `citizen/feedback.html`

- **Source:** `apps/web/src/app/(app)/citizen/feedback/page.tsx`
- **Design reference:** `redesign/citizen/feedback.html`

### GAP-CITIZEN-FEEDBACK-01  ·  HIGH  ·  partly  ·  theme PLACEHOLDER (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Dead-end tile: /citizen home links 'Feedback' (page.tsx:9 of home) but the page is a permanent empty state with no data source, no form and no way to submit feedback (feedback/page.tsx:15-21).
- **Verified evidence:** Home tile exists (citizen/page.tsx:10 in this snapshot, not :9). feedback/page.tsx:14-20 renders only an EmptyState; no loader/form. No feedback route/API elsewhere in citizen dir. Page loads (not a 404), so 'dead route' is really 'placeholder module'.
- **Files to change:** `apps/web/src/app/(app)/citizen/page.tsx`, `apps/web/src/app/(app)/citizen/feedback/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decide: build feedback list (needs GET /api/v1/citizen/feedback backend) or remove the tile from citizenTiles in citizen/page.tsx and the sidebar entry.
  2. If kept, add loader in citizen/_data and DataTable with RefreshErrorState/EmptyState pattern.
  3. Otherwise gate tile by module entitlement (lib/moduleVisibility.ts).
- **Acceptance:**
  - Tile absent when feature is off, or page lists real feedback.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-FEEDBACK-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Empty message refers to 'the feedback module' being enabled — an internal concept — with no action for the user (messages en.json citizenFeedback.emptyMessage).
- **Verified evidence:** en.json citizenFeedback.emptyMessage = 'Citizen feedback submissions will appear here once the feedback module is enabled.'; no action supplied in EmptyState (feedback/page.tsx:15-19).
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/citizen/feedback/page.tsx`
- **Fix steps:**
  1. Reword to user terms, e.g. 'No feedback has been received yet.'.
  2. Add action (link to Surveys or Grievances) via EmptyState action prop if supported.
- **Acceptance:**
  - Empty state has plain wording and an action.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-FEEDBACK-01

### GAP-CITIZEN-FEEDBACK-04  ·  LOW  ·  confirmed  ·  theme DS-CONSISTENCY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Uses <div className="card"> directly instead of the DS Card component (page.tsx:15).
- **Verified evidence:** feedback/page.tsx:14 uses <div className="card">; ds Card component exists (_components/ds/Card.tsx:13 renders div.card). Trivial; many citizen pages do the same (eligibility, discovery). Theme WIRING wrong.
- **Files to change:** `apps/web/src/app/(app)/citizen/feedback/page.tsx`
- **Fix steps:**
  1. Import Card from ../../../_components/ds and wrap EmptyState.
  2. Repeat across citizen pages in one sweep.
- **Acceptance:**
  - No raw className=card in the file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/grievances  —  `citizen/grievances.html`

- **Source:** `apps/web/src/app/(app)/citizen/grievances/page.tsx`
- **Design reference:** `redesign/citizen/grievances.html`

### GAP-CITIZEN-GRIEVANCES-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE (was LOADING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Every register row links to /citizen/grievances/{id} (GrievancesTable.tsx:70-71) but no such route exists in the segment (only requests/[id] renders a grievance); clicking a row lands on citizen/not-found.
- **Verified evidence:** GrievancesTable.tsx:168-169 rowLinkKey='id', rowLinkPrefix='/citizen/grievances/'. The grievances directory contains only new/, page, table, loading, error - no [id]. Grievance detail is served at /citizen/requests/[id] (getGrievanceDetail, requests/[id]/page.tsx:5). Row click yields 404. Theme is navigation, not loading.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/GrievancesTable.tsx`
- **Fix steps:**
  1. Change rowLinkPrefix to '/citizen/requests/' (detail route uses GET /api/v1/citizen/grievances/{id}).
  2. Alternatively add grievances/[id]/page.tsx re-exporting the requests detail.
  3. Add a Playwright/component test on the link href.
- **Acceptance:**
  - Clicking a row opens the grievance detail, not not-found.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-GRIEVANCES-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Due date is invented client-side: when the API sends no dueDate, the loader adds 30 days to createdAt (_data.ts:57-63) and the 'Days Left' clock shows it as a statutory deadline. CPGRAMS per-category timelines are not modelled.
- **Verified evidence:** _data.ts:52-60 dueDate falls back to createdAt+30d when row has no dueDate/due_date; passed as dueDate and drives daysLeft (page.tsx:46). UI presents it as statutory clock (GrievancesTable clockCell). Also d.setDate mutates in local timezone. Per-category timelines are not modelled (cannot verify server side).
- **Files to change:** `apps/web/src/app/(app)/citizen/_data.ts`, `apps/web/src/app/(app)/citizen/grievances/page.tsx`, `apps/web/src/app/(app)/citizen/grievances/GrievancesTable.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Stop inventing dueDate in mapGrievances: return null when absent.
  2. Show '—' or 'SLA not set' for null (clockCell already handles n===null).
  3. Ask backend to always send dueDate computed by category SLA.
  4. If a default is wanted, mark it 'est.' with tooltip.
- **Acceptance:**
  - Row without dueDate shows —, not 30 days.
  - Unit test for mapGrievances with missing dueDate.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: overdue counts will change; statutory clock misreporting.

### GAP-CITIZEN-GRIEVANCES-03  ·  MEDIUM  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Complainant name printed for every row to any signed-in user (GrievancesTable.tsx:60) — DPDP personal data with no role gate.
- **Verified evidence:** GrievancesTable.tsx:159 (col, not :60) prints complainantName for all rows. The page is behind authenticated app shell; role gating is not done in web (moduleVisibility may gate route; not verified). Names are in a staff register - masking depends on policy. No Masked component exists (only admin integrations secretMasked).
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/GrievancesTable.tsx`, `apps/web/src/lib/mask.ts`
- **Fix steps:**
  1. Create lib/mask.ts maskName and a <Masked> ds component with reveal button gated by role claim.
  2. Use it for complainantName; emit audit event on reveal (backend endpoint needed).
  3. Decide policy with DPO.
- **Acceptance:**
  - Non-privileged role sees masked name; reveal is logged.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII policy decision needed.

### GAP-CITIZEN-GRIEVANCES-04  ·  MEDIUM  ·  partly  ·  theme IA (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Two parallel lists of the same grievances: /citizen/requests (GET /citizen/requests) and this register (GET /citizen/grievances) count differently and show different numbers (requests/page.tsx:16-19 vs grievances/page.tsx:30-37).
- **Verified evidence:** /citizen/requests lists GET /api/v1/citizen/requests (loaders.ts:3337) with a Grievance/Service segmented filter (CitizenRequestsClient.tsx:21,37-40) and links to requests/[id] which is the grievance detail; /citizen/grievances lists GET /citizen/grievances. Two lists overlap but counts computed differently (requests page counts by status buckets). Whether both endpoints return the same records is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/page.tsx`, `apps/web/src/app/(app)/citizen/grievances/page.tsx`, `apps/web/src/app/(app)/citizen/page.tsx`
- **Fix steps:**
  1. Decide canonical list; cross-link both and clarify page subtitles.
  2. Use same status bucket helper for both stat grids.
  3. If merged, redirect one route.
- **Acceptance:**
  - Counts agree for same dataset.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-GRIEVANCES-01

### GAP-CITIZEN-GRIEVANCES-05  ·  MEDIUM  ·  confirmed  ·  theme TIMEZONE (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** TODAY is computed at module load (new Date().toISOString().slice(0,10), page.tsx:11) so a long-lived server process keeps yesterday's date and UTC midnight skews IST by 5.5 h — days-left can be off by one.
- **Verified evidence:** grievances/page.tsx:10 const TODAY = new Date().toISOString().slice(0,10) at module scope: fixed at server start (stale in long-lived process; page has no dynamic export so may also be statically cached with revalidate) and UTC date (IST off between 00:00-05:30 IST). daysRemaining uses Math.round on UTC-midnight difference (:18). dueDate slice(0,10) in _data.ts:59 is UTC too.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Compute today inside GrievancesPage() per request using Asia/Kolkata (Intl.DateTimeFormat en-CA timeZone 'Asia/Kolkata').
  2. Move daysRemaining to a shared util with unit tests around IST midnight.
  3. Add export const dynamic='force-dynamic' or compute days-left client-side.
- **Acceptance:**
  - Unit test: 2026-09-29T19:00Z (00:30 IST next day) gives IST date.
  - Days left updates after midnight without restart.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Statutory clock accuracy.

### GAP-CITIZEN-GRIEVANCES-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Register CTA '+ Register Grievance' keeps a literal '+' in the translated string (messages en.json grievances.register).
- **Verified evidence:** en.json grievances.register = '+ Register Grievance' used at grievances/page.tsx:56.
- **Files to change:** `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Change to 'Register grievance' and add a plus icon in JSX if wanted.
- **Acceptance:**
  - Button text has no leading +.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/grievances/new  —  `citizen/grievances-new.html`

- **Source:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`
- **Design reference:** `redesign/citizen/grievances-new.html`

### GAP-CITIZEN-GRIEVANCES-NEW-01  ·  HIGH  ·  confirmed  ·  theme CONSENT (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** DPDP consent is checked in the browser only: dpdpConsent is absent from the POST body (new/page.tsx:46-52), so no consent record, timestamp or notice version reaches the server or the audit trail; §4(a)/180-day retention promises are unenforceable from this screen.
- **Verified evidence:** new/page.tsx:218-223 body has subject, description, category, complainantName only; dpdpConsent used just to enable submit (:421) and guard (:210). No consent flag/time/noticeVersion sent. Server handling cannot be verified; may derive nothing. Retention (180 days) is claimed in en.json dpdpNoticeBody but not enforceable from UI.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add dpdpConsent: { given: true, noticeVersion, purpose: 'grievance_redressal' } to body (timestamp server-side).
  2. Define zod schema for body in packages/types shared with backend and validate at the boundary.
  3. Backend: persist consent and emit audit event; confirm contract before web change ships.
- **Acceptance:**
  - Request payload contains consent object (component test).
  - Backend record shows consent time/version.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP; API contract change must be released together.

### GAP-CITIZEN-GRIEVANCES-NEW-02  ·  HIGH  ·  partly  ·  theme PROCESS (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Applicant name' is free text sent as complainantName; a signed-in officer can file on anyone's behalf with no contact field, no identity link and no acknowledgement of who filed (new/page.tsx:46-52).
- **Verified evidence:** Applicant name is free text -> complainantName (new/page.tsx:222). No identity link, contact or filed-by in the body; the proxy adds auth so the server can know the officer, but the UI never shows filed-by and never captures citizenId. Whether the server records the filing officer is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`
- **Fix steps:**
  1. Add mode selector 'Filing on behalf of citizen' with contact fields (mobile/email) and optional citizen lookup.
  2. Send channel/filedBy on server side; backend must store actor.
  3. Show 'Filed by' on success/ detail.
- **Acceptance:**
  - Officer-filed grievance stores complainant contact and filing actor.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII; needs product decision on identity proofing.
- **Depends on:** GAP-CITIZEN-GRIEVANCES-NEW-04

### GAP-CITIZEN-GRIEVANCES-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme FEEDBACK (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Success gives no acknowledgement or grievance number: the page redirects to the register immediately (new/page.tsx:63-64); the citizen never sees a reference to quote.
- **Verified evidence:** new/page.tsx:235-236 after res.ok does router.push('/citizen/grievances') and refresh; response body is not read, so no grievanceNo. The list page also generates GRV-<id8> if no number (grievances/_data.ts:38-41).
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Parse response JSON and read id/grievanceNo (if API returns them).
  2. Show a success panel with the number and Copy/Print acknowledgement and buttons 'View' (/citizen/requests/{id}) and 'Register another'.
  3. Fallback to redirect with ?created=<no> banner if body is empty.
- **Acceptance:**
  - After submit user sees grievance number before leaving the page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; response shape not verifiable.
- **Depends on:** GAP-CITIZEN-GRIEVANCES-01

### GAP-CITIZEN-GRIEVANCES-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme CONSENT (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Contact details are promised in the DPDP notice ('name, contact details') but no contact field exists in the form (messages en.json grievances.dpdpNoticeBody vs new/page.tsx:100-165).
- **Verified evidence:** en.json grievances.dpdpNoticeBody says data processed includes 'name, contact details, and grievance description'; form (new/page.tsx:257-333) has name, category, subject, description only.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add optional/required mobile and email inputs (validated with zod) and send as complainantContact.
  2. Or remove 'contact details' from the notice until collected.
  3. Mask contact in lists via a shared mask helper (none exists yet: create lib/mask.ts).
- **Acceptance:**
  - Notice matches collected fields.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PII; API must accept the field.
- **Depends on:** GAP-CITIZEN-GRIEVANCES-NEW-02

### GAP-CITIZEN-GRIEVANCES-NEW-05  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Category labels and the two validation messages are hard-coded English (new/page.tsx:23-29,35,40) and an 'Applicant name *' label carries a literal asterisk in the translation.
- **Verified evidence:** new/page.tsx:195-201 CATEGORIES labels English literals; :207,:212 validation messages hard-coded; en.json applicantNameLabel 'Applicant name *' and consentCheckboxLabel ends with ' *' inside the string. Also the category list is hardcoded with only 5 values.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Move category and validation strings to grievances.* keys.
  2. Strip literal '*' from translations; add required indicator via component/CSS.
  3. Fetch categories from backend if available.
- **Acceptance:**
  - grep shows no English literals in JSX.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-GRIEVANCES-NEW-06  ·  LOW  ·  confirmed  ·  theme TENANTCONFIG (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Notice hard-codes mailto:dpo@gov.in for every tenant (new/page.tsx:196).
- **Verified evidence:** new/page.tsx:359 hard-codes href="mailto:dpo@gov.in" and the visible address is inside en.json dpdpNoticeBody, not tenant config.
- **Files to change:** `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/lib/orgConfig.ts`
- **Fix steps:**
  1. Read DPO email from orgConfig (lib/orgConfig.ts) or tenant settings; pass via t.rich value.
  2. Remove address from the translation string and inject as {email}.
- **Acceptance:**
  - Different tenant config shows its own DPO address.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; need tenant config field (check orgConfig).


---
## /citizen/intake  —  `citizen/intake.html`

- **Source:** `apps/web/src/app/(app)/citizen/intake/page.tsx`
- **Design reference:** `redesign/citizen/intake.html`

### GAP-CITIZEN-INTAKE-01  ·  HIGH  ·  confirmed  ·  theme OTHER (was UUID)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The intake form has only a Service UUID and a channel — no applicant, contact or form answers — so 'Application Intake' cannot capture an application; the real data-entry flow lives in the services/[serviceKey]/apply runtime (IntakePanel.tsx:62-83 vs services/_components/ServiceRuntimeFlow.tsx).
- **Verified evidence:** IntakePanel.tsx:37-38 POSTs /v1/citizen/intake/drafts with only { serviceId, channel }; there is no applicant, contact, or formData field (form lines 60-90). The real capture flow is services/_components/ServiceRuntimeFlow.tsx (sends formData: values at :138/:199 and operatorId for counter mode). The page therefore creates an empty draft that is then 'acknowledged' with a tracking number.
- **Files to change:** `apps/web/src/app/(app)/citizen/intake/page.tsx`, `apps/web/src/app/(app)/citizen/intake/IntakePanel.tsx`
- **Fix steps:**
  1. Decide: retire draft creation here and make /citizen/intake a Track-only page plus a 'Start application' link to /citizen/catalogue, or embed ServiceRuntimeFlow.
  2. If retained: remove saveDraft/submitDraft from IntakePanel and keep doTrack.
  3. Update citizenIntake.pageTitle/pageSubtitle to match.
  4. Redirect counter staff to services/[serviceKey]/apply?counter=1 (check how counterMode is passed).
- **Acceptance:**
  - Manual: no path on /citizen/intake can submit an application with no answers.
  - Track by tracking number still works.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Removing the draft path may break staff habits; confirm the server rejects empty formData at submit (cannot verify - citizen-service not in snapshot).
- **Depends on:** GAP-CITIZEN-INTAKE-02

### GAP-CITIZEN-INTAKE-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Service ID (UUID) must be typed by hand; the catalogue does not display it (IntakePanel.tsx:66-67).
- **Verified evidence:** IntakePanel.tsx:65-66 is a free-text input (placeholder '00000000-0000-4000-8000-000000000000', label 'Service ID (UUID)' in en.json:633). catalogue/page.tsx links rows by serviceKey (:51) and never prints the id, so a user cannot obtain the UUID from the UI. CatalogueService (citizenPartials.ts:19-29) does carry id, name, channels.
- **Files to change:** `apps/web/src/app/(app)/citizen/intake/IntakePanel.tsx`, `apps/web/src/app/(app)/citizen/intake/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In page.tsx (server) call getCatalogueServices() and pass {id,name,serviceKey,channels} to IntakePanel.
  2. Replace the input with a <select> or SmartCombobox (_components/SmartCombobox.tsx; no EntityPicker exists in the repo) showing name + owner department.
  3. Filter the channel <select> to the chosen service's channels array so disallowed channels are not offered.
  4. Show RefreshErrorState if the catalogue load fails; drop the UUID placeholder.
- **Acceptance:**
  - Component test: options render service names; selecting one posts its id.
  - Channel list follows service.channels.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-INTAKE-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Submit for acknowledgement' has no confirmation and the draft disappears on success (IntakePanel.tsx:41-44); losing the draft id means a second submit cannot be retried.
- **Verified evidence:** IntakePanel.tsx:43-47 submitDraft() posts .../submit immediately from a plain Button with no ConfirmDialog, then setDraft(null) (:47) so the draft id is dropped; the ack is kept in state (ack.applicationId, trackingNo) and tracking number is prefilled into trackNo, so the user is not left without a reference. Retry after failure is possible (draft is only cleared on success). Overstated: 'second submit cannot be retried' is true only after success, which is correct behaviour.
- **Files to change:** `apps/web/src/app/(app)/citizen/intake/IntakePanel.tsx`
- **Fix steps:**
  1. Wrap the submit in ConfirmDialog (ds/ConfirmDialog) with description that submission issues a tracking number; reason not needed (not a maker-checker action).
  2. Keep draft visible (disabled) until ack arrives; leave as is on error.
  3. Show applicationId next to trackingNo in the ack block.
- **Acceptance:**
  - Click 'Submit for acknowledgement': dialog appears; cancel leaves draft.
  - After success the tracking number remains visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-INTAKE-04  ·  MEDIUM  ·  confirmed  ·  theme PII (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Assisted/counter channels record assistedBy but the form does not ask who is assisting or capture the applicant's consent for assisted entry (IntakePanel.tsx:84-86).
- **Verified evidence:** IntakePanel.tsx:84-86 only displays draft.assistedBy returned from the server. The form sends { serviceId, channel } (:38) with no operatorId and no consent field. ServiceRuntimeFlow sends operatorId only when counterMode && assistedBy (:139) and also has no consent capture (grep 'consent' finds nothing in services/). Whether the server derives assistedBy from the JWT is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/citizen/intake/IntakePanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. When channel is 'counter' or 'assisted', show read-only 'Assisting officer' (from session) and a required checkbox 'Applicant has consented to assisted entry (DPDP)'.
  2. Send consent flag/operatorId in the draft body once the backend contract is agreed.
  3. Disable Save draft until consent is ticked for assisted channels.
- **Acceptance:**
  - Selecting 'Counter' shows consent checkbox; Save stays disabled until ticked.
  - Request body contains the consent flag.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP consent evidence; needs backend field + audit event.
- **Depends on:** GAP-CITIZEN-INTAKE-01

### GAP-CITIZEN-INTAKE-05  ·  MEDIUM  ·  partly  ·  theme COPY (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status and channel printed as raw codes ('submitted', 'counter', 'api'); the 'API' option is an untranslated literal (IntakePanel.tsx:75,105).
- **Verified evidence:** IntakePanel.tsx:105 prints '{track.trackingNo} - status {track.status} ({track.channel})' with raw codes, and ack line :98 prints status raw; draft line :83 prints draft.channel raw ('counter'). The 'API' option (:75) is a literal, unlike the other channel options that use t(). Theme FABRICATED is wrong - nothing is hard-coded data. English hard-coded strings also: 'Draft saved (...)', 'status', 'assisted by'.
- **Files to change:** `apps/web/src/app/(app)/citizen/intake/IntakePanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Render status via <StatusPill status=...> (humanises snake_case).
  2. Map channel codes to t('channel*') labels through one helper; add channelApi key.
  3. Move 'Draft saved', 'status', 'assisted by' literals into citizenIntake messages in all 5 locales.
- **Acceptance:**
  - Track result shows 'Submitted' pill and 'Counter (assisted)' label, not raw codes.
  - 'API' option is translated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/notices  —  `citizen/notices.html`

- **Source:** `apps/web/src/app/(app)/citizen/notices/page.tsx`
- **Design reference:** `redesign/citizen/notices.html`

### GAP-CITIZEN-NOTICES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch shows four real zero stats and 'No notices published' under the badge (notices/page.tsx:10-29 never null-gates on source; NoticesTable.tsx:50-52).
- **Verified evidence:** notices/page.tsx:8-9 destructures source but never gates: StatCards at :26-29 receive notices.length and filtered counts (0 on error, since the loader falls back to []). NoticesTable.tsx:50-52 shows EmptyState 'No notices published' when rows are empty, with DataSourceBadge above it (provenance 'error-no-data') - contradictory. Note useSeededResource may serve cached rows, so the table can be right while the stats (page.tsx) are 0.
- **Files to change:** `apps/web/src/app/(app)/citizen/notices/page.tsx`, `apps/web/src/app/(app)/citizen/notices/NoticesTable.tsx`
- **Fix steps:**
  1. In page.tsx compute errored = source==='error'; show '—' for all four StatCard values when errored (mirror portal/page.tsx).
  2. In NoticesTable, when provenance is error-no-data render <RefreshErrorState error={toHumanError('load',{area:'public notices'})} backHref='/citizen'/> instead of EmptyState (as payments/page.tsx does).
  3. Better: compute stats from the useSeededResource rows inside a client wrapper so stats and table share one data source.
- **Acceptance:**
  - Component test: source='error' + no cache -> stats show '—' and Retry button, no 'No notices published'.
  - source='api' with [] -> genuine empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CITIZEN-NOTICES-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Expired notices stay on the board: 'Expiry' is a column but nothing hides or flags rows past expiry (NoticesTable.tsx:66) — a citizen-facing notice board listing lapsed hearings.
- **Verified evidence:** NoticesTable.tsx:66 passes expiry as a plain column; no code filters or flags rows whose expiry < today, and the page has no active/expired filter. Whether /api/v1/citizen/notices already excludes expired rows cannot be verified (citizen-service absent). Route is staff-side inside the (app) shell, not a public board.
- **Files to change:** `apps/web/src/app/(app)/citizen/notices/NoticesTable.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Derive isExpired = expiry && new Date(expiry) < startOfTodayIST in the tableRows map.
  2. Add a 'Status' column showing an 'Expired' StatusPill (key 'expired' is already mapped 'bad') vs 'Active'.
  3. Add Segmented filter Active / Expired / All defaulting to Active.
  4. Count only active notices in the stat cards.
- **Acceptance:**
  - Notice with expiry yesterday shows 'Expired' and is hidden under the default Active filter.
  - Notice without expiry stays Active.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; decide whether expired hearings stay visible for record.
- **Depends on:** GAP-CITIZEN-NOTICES-04

### GAP-CITIZEN-NOTICES-03  ·  MEDIUM  ·  partly  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Type column uses cellType 'status', so 'Statutory'/'Tender' render through StatusPill, whose colour map is for workflow statuses (NoticesTable.tsx:68).
- **Verified evidence:** NoticesTable.tsx:68 sets cellType:'status' for type; DataTable.tsx:127 renders <StatusPill status=...>. STATUS_MAP has no 'statutory', 'tender' or 'public hearing' keys, so they fall back to variant 'info' (neutral blue) with humanizeStatus label ('Public Hearing' etc.). Labels are correct; only the semantic colour (workflow good/warn/bad) is not applicable. Overstated - no wrong colour is shown.
- **Files to change:** `apps/web/src/app/(app)/citizen/notices/NoticesTable.tsx`
- **Fix steps:**
  1. Drop cellType:'status' for the type column and render a neutral badge via a custom render/`pill mut` class, or leave as is if info-blue is acceptable.
  2. If kept, add explicit 'statutory'/'tender'/'public hearing': 'info' entries to STATUS_MAP for intent clarity.
- **Acceptance:**
  - Type column renders neutral pills; no status semantics implied.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-NOTICES-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Dates (published, expiry) printed raw, not formatIndianDate (NoticesTable.tsx:66-67).
- **Verified evidence:** NoticesTable.tsx:44-45 pass n.published and n.expiry through unformatted and the DataTable columns (:66-67) have no cellType/format, so ISO strings or API text print raw. formatIndianDate exists in lib/formatters.ts:2 and is used by the sibling CitizenRequestsClient. Also empty expiry would print blank rather than '—'.
- **Files to change:** `apps/web/src/app/(app)/citizen/notices/NoticesTable.tsx`
- **Fix steps:**
  1. Import formatIndianDate from @/lib/formatters.
  2. In tableRows map set published: formatIndianDate(n.published), expiry: formatIndianDate(n.expiry) (returns '—' when absent).
  3. Keep sort on raw ISO by adding hidden publishedRaw if DataTable sorts on displayed strings.
- **Acceptance:**
  - Row with 2026-03-05T00:00Z shows '05/03/2026'; null expiry shows '—'.
  - Sorting by Published stays chronological.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; sort order regression if DataTable sorts by string.

### GAP-CITIZEN-NOTICES-05  ·  LOW  ·  partly  ·  theme FEATURE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Read-only route; no publish/withdraw action or link to the notice document (page tree has no mutation).
- **Verified evidence:** Route is read-only: NoticesTable has no actions and CitizenNotice (_data/loaders.ts:3420-3428) has no document/url field, so no link to the notice document is possible from current data. No publish/withdraw endpoint is referenced anywhere in apps/web (grep). This is a missing feature rather than a dead route/link; backend contract cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/notices/NoticesTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend whether notices have attachmentUrl/documentId and publish/withdraw endpoints.
  2. If yes add optional field to CitizenNotice and a 'View' link column; add a withdraw ActionButton with requireReason.
  3. If no, record as backlog and remove finding.
- **Acceptance:**
  - Notice with attachment shows a working View link.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Publishing a public notice is a statutory act; needs audit event and maker-checker.


---
## /citizen/payments  —  `citizen/payments.html`

- **Source:** `apps/web/src/app/(app)/citizen/payments/page.tsx`
- **Design reference:** `redesign/citizen/payments.html`

### GAP-CITIZEN-PAYMENTS-01  ·  HIGH  ·  partly  ·  theme MONEY

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Money is printed exactly as the API string with a separate 'Currency' column and 'INR 1500' in the receipt line (payments/page.tsx:48-49; PaymentPanel.tsx:32) — no ₹ symbol, no lakh grouping, no paise→rupee conversion (CLAUDE.md: money is paise bigint).
- **Verified evidence:** payments/page.tsx:48-49 prints s.baseAmount (string from citizenGaps.ts:59, default '0') and s.currency in separate columns; PaymentPanel.tsx:32 prints `${body.currency} ${body.amount}` ('INR 1500'). No formatMoney/formatRupees (lib/formatters.ts:67,90). Unit of baseAmount (paise vs rupees) is not documented in the client; the designer uses baseAmountPaise (feeTypes.ts:41) but this endpoint's unit cannot be verified (citizen-service absent). Money not shown as INR with grouping is real.
- **Files to change:** `apps/web/src/app/(app)/citizen/payments/page.tsx`, `apps/web/src/app/(app)/citizen/payments/PaymentPanel.tsx`, `apps/web/src/app/_data/citizenGaps.ts`
- **Fix steps:**
  1. Confirm unit with backend fee schedule response; document it in the FeeSchedule interface.
  2. If paise: render baseAmount with formatMoney(); if rupees: formatRupees().
  3. Drop the Currency column (or only show when currency !== 'INR').
  4. PaymentPanel:32 use the same formatter for body.amount and keep receipt number.
- **Acceptance:**
  - Schedule with baseAmount '150000' (paise) shows '₹1,500.00'.
  - Receipt line shows '₹1,500.00' not 'INR 1500'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money: wrong unit assumption would show 100x error - verify before merge.

### GAP-CITIZEN-PAYMENTS-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Record & issue receipt' posts a financial record on one click with no confirmation, no amount preview and no payer/receipt-mode fields; subject: {} means fee exemptions are never applied (PaymentPanel.tsx:25-30,52).
- **Verified evidence:** PaymentPanel.tsx:25-30 posts {applicationId, scheduleId, subject: {}} on submit (no ConfirmDialog; button :52). Confirmed: no confirmation, no amount preview, no payer/receipt-mode/instrument fields, subject is always {} (so any exemption keyed on subject cannot apply - whether the server applies exemptions from the application is cannot-verify). Also line :31 throws raw res.text() into the visible error.
- **Files to change:** `apps/web/src/app/(app)/citizen/payments/PaymentPanel.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Before posting, fetch/compute the fee for schedule+application (endpoint used by services/_data/runtimeApi.ts payments/intent may be reusable - check) and show amount in a ConfirmDialog.
  2. Add fields payment mode (cash/cheque/DD), instrument reference, payer name; send in body once backend accepts.
  3. Add ActionButton/ConfirmDialog with requireReason for the offline record (audit trail).
  4. Replace throw new Error(await res.text()) with useFormError (as IntakePanel does).
  5. Show receipt link/print after success.
- **Acceptance:**
  - Submitting opens a dialog with amount; cancel sends nothing.
  - Server error shows plain-language message, not raw body.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Financial record creation; a wrong click posts a receipt. Needs audit event and maker-checker decision.
- **Depends on:** GAP-CITIZEN-PAYMENTS-01

### GAP-CITIZEN-PAYMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** On a failed schedules fetch the list shows RefreshErrorState but the payment form silently offers 'No schedules' (payments/page.tsx:20,27-30; PaymentPanel.tsx:47).
- **Verified evidence:** page.tsx:27 passes schedules.map(...) (empty on fetch error) to PaymentPanel regardless of `errored`; PaymentPanel.tsx:47 then renders option 'No schedules' and the submit stays disabled (!scheduleId). Only the list card below (page.tsx:29-32) shows RefreshErrorState. Also PaymentPanel's useState(scheduleId) initialises from schedules[0] once and will not update after router.refresh() recovery.
- **Files to change:** `apps/web/src/app/(app)/citizen/payments/page.tsx`, `apps/web/src/app/(app)/citizen/payments/PaymentPanel.tsx`
- **Fix steps:**
  1. Pass a `loadFailed={errored}` prop; when true render RefreshErrorState in place of the form.
  2. Add useEffect (or key={schedules[0]?.id}) so scheduleId re-initialises after a refresh recovers data.
- **Acceptance:**
  - Simulate fetch error: form is replaced by retry state.
  - Retry succeeds -> select is populated and submit enabled.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CITIZEN-PAYMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme COPY (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Subtitle promises payment intents, receipts and maker-checker refunds; the page offers only offline payment recording — no receipts list, no refund workflow (payments/page.tsx:18-21).
- **Verified evidence:** en.json:669 subtitle promises 'payment intents, receipts and maker-checker refunds'; payments/page.tsx renders only PaymentPanel (offline record) and a schedules list. No refund UI exists in the citizen web tree (grep 'refund' finds nothing); receipts are only shown in the service-runtime TrackClient/ServiceRuntimeFlow. Payment intents exist only in services/_data/runtimeApi.ts:195.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/citizen/payments/page.tsx`
- **Fix steps:**
  1. Short term: reword citizenPayments.pageSubtitle in all 5 locales to what the page does ('Fee schedules and offline payment recording').
  2. Long term (decision): build receipts list and maker-checker refund flow (needs endpoints not visible in snapshot) with ConfirmDialog requireReason and maker!=checker check server-side.
- **Acceptance:**
  - Subtitle matches functionality.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy only for the short-term fix; refund workflow is L and money-sensitive.

### GAP-CITIZEN-PAYMENTS-06  ·  MEDIUM  ·  partly  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Application ID is a hand-typed UUID (PaymentPanel.tsx:49-50); the success line is not announced with the receipt link or a print action.
- **Verified evidence:** PaymentPanel.tsx:49-50 is a hand-typed UUID input (label 'Application ID (UUID)' en.json:673). Success message :32 is a plain text status with receipt number only - no link to a receipt and no print action (PrintButton/PrintDocumentLink exist in _components). role=status makes it announced to screen readers, so the 'not announced' phrase is inaccurate.
- **Files to change:** `apps/web/src/app/(app)/citizen/payments/PaymentPanel.tsx`
- **Fix steps:**
  1. Replace the UUID input with a picker over open applications awaiting payment (needs a list endpoint - verify) or accept trackingNo and resolve it via /v1/citizen/intake/track/{trackingNo} (exists in IntakePanel).
  2. After success render a link to the receipt (if a receipt route/PDF exists) and <PrintButton>.
  3. Add confirmation per PAYMENTS-02.
- **Acceptance:**
  - Entering a tracking number resolves to the application before payment.
  - Success block has Print receipt action.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-PAYMENTS-02

### GAP-CITIZEN-PAYMENTS-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No total or count in the schedules card header, unlike appeals/catalogue/certificates/eligibility (payments/page.tsx:25).
- **Verified evidence:** payments/page.tsx:25 header is <strong>{t('listTitle')}</strong> only. Sibling pages (catalogue/appeals/certificates/eligibility) show counts per observation; low-impact consistency issue.
- **Files to change:** `apps/web/src/app/(app)/citizen/payments/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Append `(${schedules.length})` (or a pill) to the card header when not errored; add listTitleCount key in 5 locales.
- **Acceptance:**
  - Header reads 'Fee schedules (3)'; hidden on error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/portal  —  `citizen/portal.html`

- **Source:** `apps/web/src/app/(app)/citizen/portal/page.tsx`
- **Design reference:** `redesign/citizen/portal.html`

### GAP-CITIZEN-PORTAL-01  ·  MEDIUM  ·  partly  ·  theme NUMFMT (was MONEY)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Avg. Resolution Days shows a bare number ('6') with no unit or decimal handling; toLocaleString('en-IN') on a float gives up to 3 decimals (page.tsx:46).
- **Verified evidence:** portal/page.tsx:46 uses metrics.avgResolutionDays.toLocaleString('en-IN') - default maxFractionDigits is 3, so 6.3333333 shows '6.333'. The unit is not missing: the card label is 'Avg. Resolution Days' (en.json statAvgResolutionDays). Theme MONEY is wrong (not money). Value is a number per mapCitizenPortalMetrics (loaders.ts:3383).
- **Files to change:** `apps/web/src/app/(app)/citizen/portal/page.tsx`
- **Fix steps:**
  1. Use toLocaleString('en-IN', { maximumFractionDigits: 1 }).
  2. Optionally append a 'days' unit suffix via t().
- **Acceptance:**
  - 6.3333 renders '6.3'; 6 renders '6'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-PORTAL-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error state offers only the amber badge — no retry or help, unlike appeals/catalogue/etc. which use RefreshErrorState (page.tsx:20).
- **Verified evidence:** portal/page.tsx:18-20,36: on error the stats show '—' (UX-013 already fixed zeros) and PageHeader actions shows DataSourceBadge only; no RefreshErrorState/retry. Other citizen pages (payments/page.tsx:29) use RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/citizen/portal/page.tsx`
- **Fix steps:**
  1. When errored render <RefreshErrorState error={toHumanError('load',{area:'citizen portal metrics'})} backHref='/citizen' /> below the header (keep '—' cards or replace them).
  2. Import toHumanError from @/lib/messages.
- **Acceptance:**
  - Force loader error: Retry button visible and calls router.refresh().
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** RefreshErrorState

### GAP-CITIZEN-PORTAL-03  ·  LOW  ·  confirmed  ·  theme NAV (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stat cards are not links: 'Active Requests' does not lead to /citizen/requests (page.tsx:23-48).
- **Verified evidence:** portal/page.tsx:23-48 StatCard usage has no href/onClick (ds StatCard exposes neither per grep). /citizen/requests exists. Low-value nicety.
- **Files to change:** `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/(app)/citizen/portal/page.tsx`
- **Fix steps:**
  1. Add optional href prop to StatCard (wrap in Link, focus ring).
  2. Set href='/citizen/requests' on Active Requests and Resolved This Month, '/citizen/catalogue' on Published Services.
- **Acceptance:**
  - Click Active Requests navigates to /citizen/requests; keyboard focusable.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** StatCard is shared; regression test across dashboards.

### GAP-CITIZEN-PORTAL-04  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Loading state is a bare .skeleton div with aria-label 'Loading…' — no header or stat placeholders (portal/loading.tsx:1-6).
- **Verified evidence:** portal/loading.tsx:3-5 returns a single div.skeleton with aria-label; notices/loading.tsx is identical. Page shape is PageHeader + 4-card StatGrid. Theme FABRICATED is wrong -> LOADING.
- **Files to change:** `apps/web/src/app/(app)/citizen/portal/loading.tsx`, `apps/web/src/app/(app)/citizen/notices/loading.tsx`
- **Fix steps:**
  1. Use ds Skeleton components to draw header line plus 4 StatCard-shaped blocks in a StatGrid.
  2. Keep role=status and aria-label from t('loading').
- **Acceptance:**
  - Throttle network: loading shows header and 4 card placeholders, no layout jump.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/requests  —  `citizen/requests.html`

- **Source:** `apps/web/src/app/(app)/citizen/requests/page.tsx`
- **Design reference:** `redesign/citizen/requests.html`

### GAP-CITIZEN-REQUESTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch reads as good news: page.tsx:24 renders only the badge; stats show real 0s and the table says 'No service requests' (page.tsx:8-29; CitizenRequestsClient.tsx:60).
- **Verified evidence:** requests/page.tsx:10,24 only renders <DataSourceBadge> when source==="error"; loader getCitizenRequests (_data/loaders.ts:3336) falls back to [] so StatCards (page.tsx:26-29) print 0 and CitizenRequestsClient.tsx:59-60 shows EmptyState 'No service requests'. No notFound() involved. RefreshErrorState (ds/RefreshErrorState.tsx) exists and is unused here.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/page.tsx`, `apps/web/src/app/(app)/citizen/requests/CitizenRequestsClient.tsx`
- **Fix steps:**
  1. In page.tsx, after the loader call, if source==="error" return <PageHeader/> + <RefreshErrorState error={{what,next,actions:["retry","back"]}} backHref="/citizen"/> (copy from a citizenRequests.loadError next-intl key) instead of stats+table.
  2. Alternatively keep header, but pass value="—" to the four StatCards when source==="error".
  3. Add loadError/loadErrorNext keys to messages/en.json (and hi.json) under citizenRequests.
  4. Drop the DataSourceBadge-only branch at line 24.
- **Acceptance:**
  - Component/RSC test: mock getCitizenRequests -> {data:[],source:"error"}; page shows retry error state, no 'No service requests' text, no '0' stat.
  - Manual: block /api/v1/citizen/requests in devtools, reload; Retry button re-fetches via router.refresh().
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.
- **Depends on:** RefreshErrorState

### GAP-CITIZEN-REQUESTS-02  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** DPDP: citizen phone numbers are printed unmasked and unconditionally in the register (CitizenRequestsClient.tsx:32,48) for any signed-in user; no role gate or masking.
- **Verified evidence:** CitizenRequestsClient.tsx:13,32,48 always renders citizenPhone (raw value or '—') as a plain column; DataTable is filterable/sortable. page.tsx has no role/permission check and there is no <Masked> component in ds/ (only unrelated 'Masked' hits in admin/integrations). Whether the backend already strips/masks phone for low-privilege roles cannot be verified (citizen-service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/CitizenRequestsClient.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx: props {value, kind:"phone"|"email"|"name", canReveal, onReveal}; renders 98xxxxx210 style mask; reveal click POSTs a PII-access audit event (reason-less or via ConfirmDialog) and un-masks for the session.
  2. In page.tsx resolve the viewer's permissions server-side (existing session/permission helper) and pass canRevealPii to the client.
  3. In CitizenRequestsClient replace the citizenPhone cell with a render: (row)=> <Masked kind="phone" .../> and default to masked.
  4. Remove raw phone from the filterable/searchable text or keep it searchable only when canReveal.
- **Acceptance:**
  - Unit test Masked: 9876543210 renders as 98******10; reveal not offered when canReveal=false.
  - Manual: user without PII permission sees masked phone; reveal by permitted user writes an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP; backend must also enforce (masking client-side alone is cosmetic); audit event needs a backend endpoint.

### GAP-CITIZEN-REQUESTS-03  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Log Request' is shown to every user with the module; the created record goes to POST /v1/citizen/grievances with no complainant/consent fields (LogRequestButton.tsx:23-28), while the dedicated /citizen/grievances/new form collects name and DPDP consent — two intake paths with different obligations.
- **Verified evidence:** LogRequestButton.tsx:25-28 POSTs only {category,subject,description} to /api/proxy/v1/citizen/grievances; no complainant name/contact/consent. The dedicated grievances/new form collects complainantName (grievances/new page ~line 50) and a mandatory DPDP consent checkbox (lines 17,38-40,164-206). The button is rendered unconditionally in page.tsx:22. Whether the backend fills complainant from the session cannot be verified (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/LogRequestButton.tsx`, `apps/web/src/app/(app)/citizen/requests/page.tsx`, `apps/web/src/app/(app)/citizen/grievances/new/page.tsx`
- **Fix steps:**
  1. Decide: either remove LogRequestButton and link to /citizen/grievances/new, or make LogRequestButton reuse the same form.
  2. If keeping it, add complainantName, contact and the DPDP consent checkbox + notice (extract shared <GrievanceIntakeFields> from grievances/new) and send them in the POST body.
  3. Gate the button by a create-grievance permission.
  4. Switch error handling to useFormError (LogRequestButton.tsx:30,36 surfaces raw res.text()).
- **Acceptance:**
  - Submitting without consent is blocked with a message.
  - POST body contains complainantName and consent flag; both intake paths produce identical records.
  - User without create permission does not see the button.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** DPDP: records logged without consent/complainant; product owner must pick a single intake path.

### GAP-CITIZEN-REQUESTS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Breached' segment filters status==='breached' (CitizenRequestsClient.tsx:41-42) but no stat counts breaches and the SLA/breach state is never explained on this page; subtitle promises 'SLA & routing' yet there is no SLA column.
- **Verified evidence:** CitizenRequestsClient.tsx:41-42 filters status==="breached"; page.tsx:12-14 stats count open/resolved/rejected/total only; COLUMNS (lines 27-34) have no SLA/due column; en.json citizenRequests.pageSubtitle = 'Grievances and service requests with SLA & routing.' Whether the API ever emits status 'breached' (vs a separate sla field) cannot be verified: CitizenRequestSummary type comes from an absent package.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/CitizenRequestsClient.tsx`, `apps/web/src/app/(app)/citizen/requests/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Confirm with API contract how breach is expressed (status vs slaBreached/dueAt field).
  2. Add an SLA/due column with text+colour (reuse clockCell pattern from rti/RTIClient.tsx:63-77) and a 'Breached' StatCard in page.tsx computed from the same predicate as the segment.
  3. If no SLA data exists, remove the 'Breached' option and change pageSubtitle to drop 'SLA & routing'.
- **Acceptance:**
  - Breached count in StatCard equals rows shown under Breached segment.
  - Subtitle promise matches visible columns.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; misleading SLA display on a grievance register.

### GAP-CITIZEN-REQUESTS-05  ·  MEDIUM  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Segmented options 'All/Grievance/Service/Breached' are hard-coded English literals, not next-intl keys (CitizenRequestsClient.tsx:21).
- **Verified evidence:** CitizenRequestsClient.tsx:21 SEG_OPTIONS=["All","Grievance","Service","Breached"] are English literals; ds/Segmented.tsx:9-21 takes string[] and uses the string as key, value and label, so the filter logic (lines 37-43) compares against the same English literals. Not fabricated data; it's an i18n gap.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/CitizenRequestsClient.tsx`, `apps/web/src/app/_components/ds/Segmented.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Extend Segmented to accept options as {value,label}[] (keep string[] backward compatible).
  2. Add citizenRequests.segAll/segGrievance/segService/segBreached keys (en + hi).
  3. Use stable ids 'all'|'grievance'|'service'|'breached' for state and filter; labels via t().
- **Acceptance:**
  - Switching locale to hi changes segment labels; filtering still works.
  - Existing Segmented callers with string[] unaffected (snapshot test).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared Segmented change touches many pages.
- **Depends on:** Segmented

### GAP-CITIZEN-REQUESTS-06  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was UUID)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Request No shown here is the API's requestNo, but the detail page recomputes its own 'GR-' + first 8 chars of the UUID (RequestDetailClient.tsx:158), so the same record carries two different numbers.
- **Verified evidence:** List shows API requestNo (CitizenRequestsClient.tsx:28,9) from /v1/citizen/requests; requests/[id]/RequestDetailClient.tsx:158 builds `GR-${grievance.id.slice(0,8).toUpperCase()}` for header and subtitle, ignoring any server number. Row links go to /citizen/requests/<id> (rowLinkKey=id), so the same record displays two numbers. Detail loads a grievance object; whether it carries requestNo/grievanceNo cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`, `apps/web/src/app/(app)/citizen/_data/loaders.ts`
- **Fix steps:**
  1. Check the grievance detail payload for a server-issued number; add it to the detail type/mapper in citizen/_data/loaders.ts.
  2. Use it in RequestDetailClient instead of slicing the UUID; if the API lacks it, ask backend to return requestNo on GET grievance.
  3. Show '—' rather than a synthesised number when absent.
- **Acceptance:**
  - Open a row from the list: the number in the list equals the detail header.
  - No client-side id slicing remains (grep 'slice(0, 8)').
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Citizens/officers quoting the wrong reference number in correspondence.


---
## /citizen/requests/[id]  —  `citizen/requests-detail.html`

- **Source:** `apps/web/src/app/(app)/citizen/requests/[id]/page.tsx`
- **Design reference:** `redesign/citizen/requests-detail.html`

### GAP-CITIZEN-REQUESTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ERRORTEXT (was LOADING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Load failure prints the raw response body to the clerk: throw new Error(await res.text()) then {loadError} in a <p role=alert> (RequestDetailClient.tsx:52,141) — violates the RouteError 'never show server text' rule.
- **Verified evidence:** RequestDetailClient.tsx:52 throws new Error(await res.text()) and :56 stores e.message in loadError, rendered in <p role=alert> at :141. Same pattern for mutations (:89,106,115,124) shown through formError (:250) and ActionButton error (ActionButton.tsx:49 e.message). Server text is displayed, against RouteError's rule. Retry button exists.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`
- **Fix steps:**
  1. Replace the load catch with toHumanError('load',{area:'request'}) and render <ErrorState error onRetry={()=>load()} backHref='/citizen/requests'>.
  2. Use useFormError (as IntakePanel) for fromResponse in addAction/resolve/escalate/reopen so thrown messages are plain-language.
  3. Distinguish 404 (existing not-found EmptyState) from errors.
- **Acceptance:**
  - Mock 500 with body 'pg: relation ...': UI shows plain message + Retry, not raw text.
  - Escalate failure shows friendly error in dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CITIZEN-REQUESTS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme FABRICATED (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Displayed Request No is synthesised as 'GR-' + id.slice(0,8) (RequestDetailClient.tsx:158) and will not match the list page's requestNo.
- **Verified evidence:** RequestDetailClient.tsx:158 builds requestNo = 'GR-' + id.slice(0,8).toUpperCase(); Grievance type (_data/loaders.ts:31-42) has no requestNo field. The list (CitizenRequestsClient.tsx:9,28) shows the API's requestNo and links rows to /citizen/requests/{id} (rowLinkPrefix). Unless the API format equals GR-<id8> the two will differ; whether list ids are grievance ids is cannot-verify (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`, `apps/web/src/app/(app)/citizen/_data/loaders.ts`
- **Fix steps:**
  1. Add requestNo?: string to Grievance and toGrievance mapper (loaders.ts ~:55) from r.requestNo.
  2. Use grievance.requestNo ?? '—' in RequestDetailClient (no synthesis).
  3. Confirm with backend that GET /v1/citizen/grievances/{id} returns requestNo.
- **Acceptance:**
  - Detail header requestNo equals the number in the list row.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong reference numbers given to citizens over phone.

### GAP-CITIZEN-REQUESTS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Escalate defaults the reason to 'Escalated by officer' and Reopen to 'Reopened' when the dialog reason is empty (RequestDetailClient.tsx:113,122) — audit trail gets a placeholder instead of an enforced reason though requireReason is set.
- **Verified evidence:** RequestDetailClient.tsx:113,122 default reasons exist, but the ActionButtons pass requireReason (:175,187,201) and ConfirmDialog disables Confirm until trimmed reason length >= minReasonLength=1 (ConfirmDialog.tsx:170-174), so the fallback strings are unreachable from the UI - dead defensive code, not a live audit-trail issue. Resolve sends note only; no minimum length is set for escalate/reopen. Server audit behaviour cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`
- **Fix steps:**
  1. Remove the '|| "Escalated by officer"' and '|| "Reopened"' fallbacks; throw if reason is empty.
  2. Set minReasonLength (e.g. 10) on escalate/reopen ActionButtons if backend enforces one.
- **Acceptance:**
  - Unit test: escalate() called with empty reason throws; dialog blocks empty reason.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-REQUESTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme ASYNC (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Endpoints answer asynchronously (202): notice 'Resolution submitted.' appears but status may not change until reload (RequestDetailClient.tsx:70-78) — no pending status indicator.
- **Verified evidence:** RequestDetailClient.tsx:72-77 afterMutate sets a notice, calls load() and router.refresh() immediately; with 202/async processing the fetched status can still be old, and the notice text ('Resolution submitted.') is the only cue. No pending state on StatusPill or auto-poll.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`
- **Fix steps:**
  1. Track pendingAction state set in afterMutate; show a 'Processing...' pill next to status and disable the action buttons.
  2. Poll load() every 3s (max ~5 tries) until status/actions changes, then clear pending and notice.
  3. Use aria-live for completion.
- **Acceptance:**
  - After Resolve, status shows Processing then flips to Resolved without manual reload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; avoid duplicate submissions while pending.

### GAP-CITIZEN-REQUESTS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme ENUMLABEL (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Priority, category and actionType printed as raw snake_case codes (RequestDetailClient.tsx:222,225,265).
- **Verified evidence:** RequestDetailClient.tsx:164,222 (category), :224 (priority) and :266 (a.actionType e.g. 'info_sought') print raw API values. Status uses StatusPill (humanised); these three do not. humanizeStatus (lib/formatters.ts:44) is available.
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`
- **Fix steps:**
  1. Wrap category, priority and actionType with humanizeStatus() (or map actionType to the existing t('action*') keys used in the select).
  2. Apply in the subtitle too.
- **Acceptance:**
  - 'info_sought' shows 'Info Sought'; priority 'high' shows 'High'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CITIZEN-REQUESTS-DETAIL-07  ·  LOW  ·  partly  ·  theme MISSING (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No link back to the citizen/complainant and no assignee shown despite assignedTo in the type (_data/loaders.ts:38).
- **Verified evidence:** Grievance type has assignedTo (loaders.ts:38) and departmentRef; the detail page renders departmentRef (:225) but not assignedTo. No complainant/citizen field exists in the Grievance type at all, so a link to the citizen cannot be built from current data. Theme DEADROUTE is wrong (no dead link).
- **Files to change:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx`, `apps/web/src/app/(app)/citizen/_data/loaders.ts`
- **Fix steps:**
  1. Show assignedTo as 'Assigned to' field (resolve to a name if a user-lookup loader exists; otherwise hide the raw UUID).
  2. Ask backend whether GET grievance returns complainant/citizen id before adding a link.
- **Acceptance:**
  - Assigned officer name displays when present, '—' otherwise.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PII: complainant identity must respect field-level masking.


---
## /citizen/rti  —  `citizen/rti.html`

- **Source:** `apps/web/src/app/(app)/citizen/rti/page.tsx`
- **Design reference:** `redesign/citizen/rti.html`

### GAP-CITIZEN-RTI-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch reads as 'no RTI applications': rti/page.tsx:26 renders only the badge; stats are real zeros and RTIClient shows the EmptyState (page.tsx:12-32; RTIClient.tsx:186-188) — on a statutory 30-day register.
- **Verified evidence:** rti/page.tsx:12,26 shows only DataSourceBadge on source==='error'; getRTIApplications (_data/loaders.ts:3345) returns [] on failure so stats (page.tsx:28-31) show 0 and RTIClient.tsx:186-188 renders EmptyState. Same shape as CITIZEN-REQUESTS-01.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/page.tsx`
- **Fix steps:**
  1. In page.tsx return header + <RefreshErrorState> when source==="error" (citizenRti.loadError keys).
  2. Or pass '—' to all four StatCards and skip RTIClient.
- **Acceptance:**
  - Mock source:'error': retry state appears, no zeros, no 'no applications' empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-CITIZEN-REQUESTS-01

### GAP-CITIZEN-RTI-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Transfer succeeds silently and the row does not update: after a 2xx the dialog closes with only a comment 'Soft-refresh: the server component will revalidate on next navigation' — no router.refresh(), no confirmation, and the row keeps its Transfer button (RTIClient.tsx:104-112).
- **Verified evidence:** RTIClient.tsx:105-112: after res.ok it does setTransferId(null) and only a comment (line 112) says the server component will revalidate; no router.refresh (router not imported), no success message. Additionally the loader uses revalidateSeconds:120 (loaders.ts:3348, apiClient.ts:137 -> next.revalidate) so even router.refresh() may serve cached data until the cache is invalidated. Row keeps Transfer button since TRANSFERABLE is based on stale status. The reasonLabel 'Transfer to (public authority name)' (line 205) is a literal.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Import useRouter; after 2xx call router.refresh() and set a role=status notice ('RTI transferred to <authority> under §6(3)').
  2. Optimistically mark the row as forwarded (local state) until refresh lands.
  3. Make the RTI list fetch tag-based (next.tags + revalidateTag from a server action/route) or revalidateSeconds:0 so refresh shows new data.
  4. Move reasonLabel to i18n.
- **Acceptance:**
  - After confirming transfer, a success message shows and the row's Transfer button disappears without navigation.
  - Component test: mock 200 -> router.refresh called.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Duplicate transfers if the user cannot see it worked; statutory 5-day transfer.
- **Depends on:** GAP-CITIZEN-RTI-DETAIL-05

### GAP-CITIZEN-RTI-03  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Register RTI' requires a raw CPIO reference UUID typed by hand (RegisterRTIButton.tsx:9,23-26, label 'CPIO reference (UUID)'); users cannot look up the CPIO by name/authority.
- **Verified evidence:** RegisterRTIButton.tsx:9,23-26 enforce a UUID regex; label en.json citizenRti.cpioLabel = 'CPIO reference (UUID)' (messages/en.json:789), input id new-rti-cpio is free text (line 61). No CPIO lookup endpoint or picker is present in the web code; ds has no EntityPicker (only _components/SmartCombobox.tsx). Available CPIO directory endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/RegisterRTIButton.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Confirm/ask backend for a CPIO/public-authority lookup (e.g. GET /v1/citizen/rti/cpios?q=).
  2. Replace the input with SmartCombobox (or a new ds EntityPicker) showing name + authority, storing the id.
  3. Drop UUID_RE user-facing check and the '(UUID)' label; keep the id only in the request body.
  4. Move literal error strings (lines 24,35,36,41) to i18n / useFormError.
- **Acceptance:**
  - User picks a CPIO by name; POST body cpioRef is that id.
  - No UUID text is shown or typed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong CPIO routing of an RTI application.

### GAP-CITIZEN-RTI-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Due (30-day)' counts by status (received|under_review|forwarded), not by deadline, and 'Appeals' counts isFirstAppeal only (page.tsx:14-16) — neither matches the Overdue segment's date logic (RTIClient.tsx:120-124).
- **Verified evidence:** rti/page.tsx:14 pendingReply = status in received|under_review|forwarded (labelled 'Due (30-day)'), :16 appeals = isFirstAppeal. RTIClient.tsx:119-124: 'Due' segment uses the same status test, but 'Overdue' uses daysRemaining<0 && !CLOSED. So no stat corresponds to Overdue, and 'Due (30-day)' includes already-overdue items. Not a dead route.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/page.tsx`, `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`
- **Fix steps:**
  1. Compute Due-within-deadline, Overdue counts using the shared isRtiClosed + daysRemaining helpers (lib/rtiStatus.ts/rtiClock.ts), passing today from the server.
  2. Add an 'Overdue' StatCard and relabel 'Due' to 'Open'/'Due in 30 days' to match its predicate.
  3. Rename statDue key/copy in en.json accordingly.
- **Acceptance:**
  - Overdue stat equals rows in the Overdue segment; Open stat equals Due segment.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Statutory-breach visibility on the RTI register.
- **Depends on:** GAP-CITIZEN-RTI-DETAIL-05, GAP-CITIZEN-RTI-DETAIL-04

### GAP-CITIZEN-RTI-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Closed-status sets disagree: list CLOSED = replied|closed|appeal (RTIClient.tsx:37) but detail treats responded|appealed or any response as closed (RTIDetailClient.tsx closed=…), so the same RTI can show 'Closed' in one view and a running clock in the other.
- **Verified evidence:** Duplicate of RTI-DETAIL-05. RTIClient.tsx:37 CLOSED={replied,closed,appeal}; RTIDetailClient.tsx:157 also treats responded/appealed and any response as closed. Also stat 'Replied' (page.tsx:15) counts only status==='replied'.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`, `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`, `apps/web/src/lib/rtiStatus.ts`
- **Fix steps:**
  1. Implement as in GAP-CITIZEN-RTI-DETAIL-05 (single isRtiClosed helper).
- **Acceptance:**
  - Same as RTI-DETAIL-05.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-RTI-DETAIL-05

### GAP-CITIZEN-RTI-06  ·  MEDIUM  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** DPDP: applicant names are shown to every signed-in user (RTIClient.tsx:151); RTI applicant identity is protected personal data.
- **Verified evidence:** RTIClient.tsx:149 (observation said 151) renders applicantName in a plain column; rows built at line 136. No role check in rti/page.tsx and no Masked component in ds. Backend-side masking/RBAC for the /v1/citizen/rti list cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`, `apps/web/src/app/(app)/citizen/rti/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. Reuse ds/Masked (created in GAP-CITIZEN-REQUESTS-02) with kind='name'.
  2. Pass canRevealPii from the server page and default to masked initials for non-CPIO roles.
  3. Audit-log reveal actions.
- **Acceptance:**
  - User without CPIO/PIO role sees masked applicant name.
  - Reveal writes an audit event.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** DPDP/RTI applicant confidentiality.
- **Depends on:** GAP-CITIZEN-REQUESTS-02

### GAP-CITIZEN-RTI-07  ·  LOW  ·  confirmed  ·  theme DATEFMT (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** TODAY is computed once at module load in UTC (page.tsx:8), same day-skew risk as grievances; 'Yes/No' in 1st Appeal? are literals (RTIClient.tsx:144).
- **Verified evidence:** rti/page.tsx:8 `const TODAY = new Date().toISOString().slice(0,10)` is evaluated once per server process/build (module scope), so it goes stale after midnight and is UTC (IST date differs 00:00-05:30). It is passed as `today` to RTIClient (line 33). RTIClient.tsx:144 uses literal 'Yes'/'No'; SEG_OPTIONS 'All/Due/Overdue' (line 25), 'Transfer to…' (205) also literals. Not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/page.tsx`, `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`, `apps/web/src/lib/rtiClock.ts`
- **Fix steps:**
  1. Move TODAY into the Page function, compute the Asia/Kolkata date, and mark the route dynamic (or compute in the client).
  2. Use t('yes')/t('no') keys and i18n segment labels (see GAP-CITIZEN-REQUESTS-05).
  3. Share the day helper with detail (GAP-CITIZEN-RTI-DETAIL-04).
- **Acceptance:**
  - Test: with fake timers at 23:30 UTC on day N the page treats day N+1 (IST) as today.
  - hi locale shows translated Yes/No.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Off-by-one day on statutory deadlines.
- **Depends on:** GAP-CITIZEN-RTI-DETAIL-04


---
## /citizen/rti/[id]  —  `citizen/rti-detail.html`

- **Source:** `apps/web/src/app/(app)/citizen/rti/[id]/page.tsx`
- **Design reference:** `redesign/citizen/rti-detail.html`

### GAP-CITIZEN-RTI-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ERRORCOPY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Load failure surfaces the raw response body to the clerk: res.text() into loadError rendered in <p role=alert> (RTIDetailClient.tsx:66,136-143).
- **Verified evidence:** RTIDetailClient.tsx:66 `throw new Error((await res.text()) || ...)`, caught at 70 into loadError and rendered at 136-143 in <p role=alert>. Same raw-body pattern in respond (line 103) and fileAppeal (line 116). The sibling RTIClient uses useFormError/toHumanError instead.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`
- **Fix steps:**
  1. In load(), replace res.text() with the useFormError('RTI application') helper (lib/useFormError) -> fromResponse(res,'load') and fromException for network errors.
  2. Render the human {what,next} via RefreshErrorState/ErrorState with retry (replace the <p role=alert> block).
  3. Apply the same to respond() and fileAppeal() so no backend body reaches the UI.
- **Acceptance:**
  - Mock a 500 with body '{"stack":...}': UI shows catalogued message, not the body.
  - Retry button re-calls load().
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, useFormError

### GAP-CITIZEN-RTI-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UPLOAD (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Response 'document' is only a URL typed into the ConfirmDialog reason field ('Response document URL (https://…)') — no upload, virus-scan or hash; the link is rendered with target=_blank (RTIDetailClient.tsx:94-103,235).
- **Verified evidence:** RTIDetailClient.tsx:69-78 (real lines ~169-178) use ActionButton requireReason with reasonLabel 'Response document URL (https://…)'; respond() (93-104) only tests /^https?:\/\//i and POSTs {responseUrl}. Responses render as <a href={r.responseUrl} target=_blank rel=noopener noreferrer> at line 235. No upload, scan or hash. ds/FileUpload.tsx exists in _components. Backend URL validation/allow-list cannot be verified. The <a href> renders server data unvalidated at render time.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`, `apps/web/src/app/_components/FileUpload.tsx`
- **Fix steps:**
  1. Replace the URL-in-reason-field with a dedicated respond dialog: file input (FileUpload -> object-storage upload endpoint returning a document id) plus optional remarks.
  2. POST {documentId} (backend to store hash + AV-scan status); show scan status on the response row.
  3. Keep ConfirmDialog for the irreversible 'dispose' step and emit an audit event server-side.
  4. Until then, validate href at render: allow only https and known storage hosts.
- **Acceptance:**
  - Uploading a file produces a response row with filename/hash; a javascript: URL is never rendered as href.
  - Respond without a file is blocked.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Statutory RTI disposal record; needs backend upload+scan endpoint (not visible in snapshot).

### GAP-CITIZEN-RTI-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** isOverdue is returned by the API (_data/loaders.ts:140) but the clock is recomputed in the browser from local midnight (RTIDetailClient.tsx:16-19); it can disagree with the list page's UTC TODAY and with the server.
- **Verified evidence:** RTIDetailClient.tsx:16-19 StatutoryClock builds today with new Date().setHours(0,0,0,0) (browser-local midnight) and diffs against new Date(deadline). loaders.ts:156 (not 140) maps isOverdue but RTIDetailClient never reads it. The list (rti/page.tsx:8, RTIClient.tsx:29-35) uses UTC date at module load with both dates parsed as UTC, so the two views can differ by a day depending on browser TZ.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`, `apps/web/src/app/(app)/citizen/rti/page.tsx`, `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a shared helper lib/rtiClock.ts: daysRemaining(deadlineIso, nowIso) computed in Asia/Kolkata calendar days.
  2. Detail: pass server 'now' (from page.tsx) and use rti.isOverdue as the authority for the overdue flag, helper only for the day count.
  3. List: use same helper, compute per request instead of a module-level constant.
- **Acceptance:**
  - Unit test daysRemaining across TZ=UTC and TZ=Asia/Kolkata for 23:30 IST -> same result.
  - List and detail show identical days-left for the same RTI.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Statutory deadline display; off-by-one could hide a breach.
- **Depends on:** GAP-CITIZEN-RTI-07

### GAP-CITIZEN-RTI-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'closed' set here (replied|closed|appeal|responded|appealed or any response) differs from the list's CLOSED (RTIClient.tsx:37).
- **Verified evidence:** Detail: RTIDetailClient.tsx:157 closed = status in [replied,closed,appeal,responded,appealed] || responses.length>0. List: RTIClient.tsx:37 CLOSED = {replied,closed,appeal}. Diverging vocabularies: 'responded'/'appealed' only in detail; 'appeal' status closes the clock in both. Actual backend status enum cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`, `apps/web/src/app/(app)/citizen/rti/RTIClient.tsx`, `apps/web/src/lib/rtiStatus.ts`
- **Fix steps:**
  1. Get the canonical status enum from the RTI API contract.
  2. Create lib/rtiStatus.ts exporting RTI_CLOSED, isRtiClosed(status, responsesCount) and use it in RTIClient (CLOSED/isOverdue) and RTIDetailClient.
  3. Also feed rti/page.tsx stats (statReplied, statDue) from it.
- **Acceptance:**
  - Unit test isRtiClosed for each status.
  - Same RTI shows 'Closed' in list and 'Disposed' in detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong choice hides an open clock.
- **Depends on:** GAP-CITIZEN-RTI-05

### GAP-CITIZEN-RTI-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme MISSING (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No record of first-appeal outcome, hearing or transfer history: appeals show only 'First appeal — status' and date (RTIDetailClient.tsx:250-253); the §6(3) transfer done from the list leaves no trace here.
- **Verified evidence:** Appeals list (RTIDetailClient.tsx:250-253) prints only appealType label, a.status and createdAt. RtiAppeal (loaders.ts:136-143 mapper) has id, appealType, grounds, status, createdAt only - grounds is fetched but not displayed; no decision/hearing/outcome fields. RtiDetail (loaders.ts ~105-126) has no transfer fields, and the list's transfer POST (RTIClient.tsx:100) leaves nothing to show. Whether the API returns such data is unverifiable (rti service absent).
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`, `apps/web/src/app/(app)/citizen/_data/loaders.ts`
- **Fix steps:**
  1. Ask backend to expose appeal decision/hearing date/outcome and a transfers[] (toAuthority, transferredAt, by) on GET /v1/citizen/rti/:id.
  2. Extend RtiDetail/mappers in citizen/_data/loaders.ts.
  3. Render grounds, hearing date, outcome per appeal and a Transfer history card with formatIndianDate.
- **Acceptance:**
  - After a transfer from the list, the detail shows the new authority and date.
  - Appeal shows grounds and outcome when present.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Statutory audit trail incomplete; backend contract change.

### GAP-CITIZEN-RTI-DETAIL-07  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Appeal type labels and 'Response submitted.' style notices are partly literals (RTIDetailClient.tsx:119,177 notices) while others are translated.
- **Verified evidence:** Appeal type labels ARE translated (t('appealFirstShort'/'appealCicShort') at line 251). What is true: notices 'Appeal submitted. It will appear once processed.' (line 119) and 'Response submitted.' (line 177) plus reasonLabel/confirmTitle/confirmDescription (lines 171-174), 'Enter a valid response document URL' (95), subtitle '· RTI Act 2005' (line 163) and fallback error strings are English literals.
- **Files to change:** `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add citizenRti.noticeAppealSubmitted, noticeResponseSubmitted, respondReasonLabel, respondConfirmTitle, respondConfirmDescription, invalidResponseUrl, and error fallbacks (en + hi).
  2. Replace literals in RTIDetailClient with t().
- **Acceptance:**
  - No English literal remains in JSX/props in RTIDetailClient (grep for quotes in props).
  - hi locale shows Hindi notices.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /citizen/services/[serviceKey]  —  `citizen/services-serviceKey.html`

- **Source:** `apps/web/src/app/(app)/citizen/services/[serviceKey]/page.tsx`
- **Design reference:** `redesign/citizen/services-serviceKey.html`

### GAP-CITIZEN-SERVICES-SERVICEKEY-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A failed lookup is rendered as a 404: `if (!service || source === "error") notFound()` (page.tsx:31; same on apply/page.tsx:30). A gateway blip tells a citizen the service does not exist, with no retry — and it is cached 30s (revalidateSeconds).
- **Verified evidence:** [serviceKey]/page.tsx:31 and apply/page.tsx:30 call notFound() when !service || source==='error'. fetchJson returns source 'error' for missing base URL, missing auth cookie (401), any non-OK (incl. 5xx), invalid payload and network failure (apiClient.ts:108-166), and result carries status. So a gateway blip or expired session shows the 404 page with no retry. Caching: revalidate 30s applies to fetch; whether Next caches a non-OK response is version-dependent (not verified), but the blip itself is not the issue.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/[serviceKey]/page.tsx`, `apps/web/src/app/(app)/citizen/services/[serviceKey]/apply/page.tsx`
- **Fix steps:**
  1. Use result.status: if status===404 (or source==='api' and !service) -> notFound(); if status===401 redirect to login; otherwise render RefreshErrorState (toHumanError('load',{area:'service details'})) with backHref /citizen/catalogue inside the PageHeader shell.
  2. Extract the shared loadService into services/_data/loadService.ts (both pages duplicate it).
  3. Add a segment loading.tsx (see -06).
- **Acceptance:**
  - Unit/page test: mock fetchJson {source:'error',status:503} -> retry UI, not notFound; {status:404} -> notFound.
  - Manual: stop gateway, load /citizen/services/x -> error with Retry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Do not treat 403 as retryable.
- **Depends on:** RefreshErrorState

### GAP-CITIZEN-SERVICES-SERVICEKEY-03  ·  MEDIUM  ·  partly  ·  theme PERF (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Resume lookup GETs every draft of the citizen and filters by serviceId/status client-side (runtimeApi.ts:97-103, ServicePageClient.tsx:31) — over-fetches form data (PII) just to show a banner.
- **Verified evidence:** ServicePageClient.tsx:31 calls listDraftsForService(service.id) (runtimeApi.ts:97-106) which GETs /api/proxy/v1/citizen/intake/drafts (no serviceId query param) and filters serviceId/status==='draft' client-side, mapping full formData into the browser only to read drafts[0].id. Over-fetch is real; it is the citizen's own drafts so not cross-user, and a masking/role reveal (suggested fix) does not apply. Also !res.ok silently returns [] (no banner). Whether the backend supports ?serviceId filter is cannot-verify (intake service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/app/(app)/citizen/services/_components/ServicePageClient.tsx`
- **Fix steps:**
  1. If the intake API supports it, pass serviceId & status=draft as query params; otherwise add that filter to the backend (needs=backend).
  2. Return a lightweight {id} projection (or add a HEAD/count endpoint) so formData is not sent for the banner.
  3. In listDraftsForService stop copying formData for the banner use-case (split into hasDraftForService and full listDrafts).
- **Acceptance:**
  - Network tab on service page: response contains no formData fields.
  - Unit: helper returns first draft id for matching service only.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-SERVICES-SERVICEKEY-04  ·  MEDIUM  ·  partly  ·  theme I18N (was MONEY)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded English outside next-intl: 'working day(s)' (ServicePageClient.tsx:84), 'Continue where you left off —' (ServicePageClient.tsx:159), 'from ₹' / 'Fee on approval' (runtimeApi.ts:243-247) on a page that is otherwise translated and aimed at Odia/Hindi-speaking citizens.
- **Verified evidence:** Hard-coded English confirmed: ServicePageClient.tsx:84 `${slaDays} working day(s)`, :159 'Continue where you left off —', runtimeApi.ts:243-247 formatFee 'Fee on approval' and 'from ₹'. Also channelDisabledMessage (runtimeApi.ts) is English, and :42 uses fallback hex. Theme MONEY is wrong (I18N) but formatFee does divide minor by 100 with toLocaleString - float division of a number, only display; acceptable but should use shared formatINR/paise helper. Other translated keys exist (slaPromise, resumeDraft).
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/ServicePageClient.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add ICU plural keys workingDays ({days, plural, one {# working day} other {# working days}}), continueWhereLeftOff, feeFrom ('from {amount}'), feeOnApproval to citizenServices in all locales.
  2. Change formatFee/formatFeeExact to return structured data or accept t; format amount with the shared paise formatter (formatINR from lib/formatters) rather than minor/100.
  3. Use the same for channelDisabledMessage.
- **Acceptance:**
  - Locale hi: fee, SLA and resume banner in Hindi.
  - Unit: formatFee(150000,'INR') -> ₹1,500; null -> localised 'Fee on approval'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify amounts identical before/after (paise).

### GAP-CITIZEN-SERVICES-SERVICEKEY-05  ·  LOW  ·  confirmed  ·  theme UX (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The ☐ glyph on each required document (ServicePageClient.tsx:116) looks like a checkbox but is not interactive; the resume banner and the primary button both link to the same href (ServicePageClient.tsx:159-173).
- **Verified evidence:** ServicePageClient.tsx:115-117 renders an aria-hidden '☐' glyph before each required document (non-interactive, misleading affordance). Resume banner link (:159-163) and primary CTA (:168-174) both use applyHref, so they are the same target (CTA label switches to resumeApplication when a draft exists, making the banner redundant).
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/ServicePageClient.tsx`
- **Fix steps:**
  1. Replace ☐ with a bullet or lucide FileText icon (aria-hidden) or plain list markers.
  2. Remove the separate resume banner or keep only the banner text without link since the CTA already says 'Resume application'.
  3. Move 'Continue where you left off' into i18n (see -04).
- **Acceptance:**
  - Visual: no checkbox glyph; only one resume link/CTA.
  - Axe passes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-SERVICES-SERVICEKEY-04

### GAP-CITIZEN-SERVICES-SERVICEKEY-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No segment loading.tsx: falls back to citizen/loading.tsx, a 7xl-wide skeleton for a 640px page.
- **Verified evidence:** No loading.tsx under citizen/services or [serviceKey]/ (directory listing confirms). Falls back to citizen/loading.tsx: min-h-screen bg-slate-50 with max-w-7xl blocks, while the page is a 640px centred card.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/[serviceKey]/loading.tsx`, `apps/web/src/app/(app)/citizen/services/[serviceKey]/track/[trackingNo]/loading.tsx`
- **Fix steps:**
  1. Create [serviceKey]/loading.tsx with a maxWidth 640 card skeleton (title, two stat blocks, list) using the 'skeleton' class as TrackClient does.
  2. Reuse same for apply/ if desired.
  3. Use t('msg.loading') for aria-label like surveys/loading.tsx.
- **Acceptance:**
  - Navigate to service page throttled: skeleton width matches final card, no layout shift.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /citizen/services/[serviceKey]/apply  —  `citizen/services-serviceKey-apply.html`

- **Source:** `apps/web/src/app/(app)/citizen/services/[serviceKey]/apply/page.tsx`
- **Design reference:** `redesign/citizen/services-serviceKey-apply.html`

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Payment failure is swallowed after submit: createPaymentIntent/confirmPayment are wrapped in an empty catch with 'payment is best-effort' (ServiceRuntimeFlow.tsx:206-219). The citizen presses 'Pay (sandbox) & submit', sees 'Application submitted', and may never have paid; the fee screen never says so.
- **Verified evidence:** ServiceRuntimeFlow.tsx:206-219: after submitDraft, if service.feeFromMinor!=null && ack.applicationId, createPaymentIntent+confirmPayment('sandbox') sit in try/catch with an empty handler (comment 'payment is best-effort', line 217), then setStep('submitted'). Also when submitDraft returns applicationId '' (PENDING case) the payment block is skipped entirely and silently. The submitted screen shows no payment status.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`
- **Fix steps:**
  1. Track paymentState ('paid'|'failed'|'skipped') in component state; set 'failed' in the catch and log via the existing telemetry helper (no console.log).
  2. On the submitted step, show payment status; on failed/skipped show a warning with 'Pay now' retry (re-run createPaymentIntent/confirmPayment for ack.applicationId) and a pay-at-counter fallback.
  3. Do not present 'Application submitted' as paid; wording 'Submitted - payment pending'.
  4. Server should also flag unpaid fee-bearing applications (backend).
- **Acceptance:**
  - Mock createPaymentIntent to reject: submitted screen shows 'Payment not completed' + retry.
  - Fee-free service unaffected.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money: applications proceed unpaid, revenue leakage and citizen confusion.
- **Depends on:** GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-02, GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-03

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-02  ·  HIGH  ·  confirmed  ·  theme PAYMENT (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Production citizen UI exposes test wording: button 'Pay (sandbox) & submit' and the fee note 'For Test runs, sandbox capture posts a receipt and GL journal…' (en.json citizenServices.paySandboxAndSubmit / feeSummaryNote; ServiceRuntimeFlow.tsx:394). confirmPayment defaults to mode 'sandbox' (runtimeApi.ts:216), so real fee-bearing services record a sandbox receipt.
- **Verified evidence:** en.json:860 feeSummaryNote 'For Test runs, sandbox capture posts a receipt and GL journal...' rendered at ServiceRuntimeFlow.tsx:352; button label paySandboxAndSubmit 'Pay (sandbox) & submit' at :394 (en.json:865). onSubmit hardcodes confirmPayment(paymentId,'sandbox') (:215) and runtimeApi.ts:216 defaults mode to 'sandbox'. Nothing selects gateway mode by environment. Whether backend rejects sandbox capture in production cannot be verified. Not a ConfirmDialog issue; theme tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add an environment/feature flag (server-provided runtime config, e.g. payments.mode) and pass it into ServiceRuntimeFlow.
  2. When mode=gateway: button 'Pay & submit', redirect to gateway, confirmPayment(id,'gateway',gatewayRef) on return; hide the test note.
  3. When sandbox: keep the note but show a visible 'TEST MODE' badge only in non-production.
  4. Remove default param 'sandbox' from confirmPayment (require explicit mode).
- **Acceptance:**
  - Production config renders no 'sandbox' wording (grep DOM).
  - confirmPayment call without mode fails type-check.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money: fake receipts + GL journals for real fees; CLAUDE.md audit trail.
- **Depends on:** GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-01

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-03  ·  HIGH  ·  confirmed  ·  theme ASYNC (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** submitDraft resolves with trackingNo 'PENDING' when the 200ms wait plus draft/application lookups miss (runtimeApi.ts:164-186); the submitted screen then prints 'PENDING' as the tracking number and links to /track/PENDING, which will fail. Submission is asynchronous (202) but the UI pretends to have a number.
- **Verified evidence:** runtimeApi.ts:156-187: after POST submit (202 ok) it waits 200ms, reads the draft and applications; any miss returns trackingNo 'PENDING' (line 186). ServiceRuntimeFlow.tsx:220 setTrackingNo(ack.trackingNo) then the submitted screen (:401-431) prints it, offers copy, and links to /citizen/services/<key>/track/PENDING. The payment block is also skipped in that case (applicationId '').
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`
- **Fix steps:**
  1. Change TrackingAck.trackingNo to string|null; return null instead of 'PENDING' when not yet issued.
  2. On the submitted screen with null tracking: show 'Application received - your tracking number will appear shortly', poll GET drafts/:id (a few times with backoff) and update, hide copy/track link until available.
  3. Alternatively have the backend return trackingNo synchronously in the 202 body (preferred).
  4. Run payment step after tracking/applicationId is resolved.
- **Acceptance:**
  - Mock submit with empty app list: UI shows pending state, not 'PENDING'; link absent.
  - When polling resolves, number and link appear.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Citizen loses proof of submission; payments not created.
- **Depends on:** GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-01

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-04  ·  MEDIUM  ·  confirmed  ·  theme AUDIT (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Counter mode never records the operator: ServiceRuntimeFlow accepts assistedBy but apply/page.tsx:45 does not pass it, so saveDraft never sends operatorId (ServiceRuntimeFlow.tsx:134-140) and assisted applications are unattributed.
- **Verified evidence:** apply/page.tsx:45 renders <ServiceRuntimeFlow service counterMode/> without assistedBy (prop declared at ServiceRuntimeFlow.tsx:30,84, default null). Autosave adds operatorId only when counterMode&&assistedBy (:139). onSubmit's own saveDraft call (:195-201) never sends operatorId at all, even if assistedBy were set. Whether the backend attributes the JWT user server-side cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/[serviceKey]/apply/page.tsx`, `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`
- **Fix steps:**
  1. In apply/page.tsx (server) read the session user id via the existing server session helper and pass assistedBy={counterMode ? userId : null}; require an authenticated officer role for ?counter=1 (else redirect).
  2. In onSubmit's saveDraft, add the same `...(counterMode && assistedBy ? {operatorId: assistedBy} : {})`.
  3. Prefer the backend deriving operator from the token and ignoring client-sent operatorId.
- **Acceptance:**
  - Counter-mode draft/application record has operatorId of the logged-in officer.
  - Non-officer opening ?counter=1 is redirected.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Assisted-application accountability; ?counter=1 is currently client-selectable by anyone.

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-05  ·  MEDIUM  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** DPDP: autosave persists partial personal data (name, mobile, address) on every field change after 800ms (ServiceRuntimeFlow.tsx:152-155) with no purpose/consent notice before the form starts and no way to discard a saved draft.
- **Verified evidence:** Autosave: ServiceRuntimeFlow.tsx:152-155 debounces 800ms and saves all values via saveDraft/updateDraft (runtimeApi.ts:116-154) on every change. Draft is auto-resumed on load (:106-121, latest draft). No 'consent'/'discard' strings or controls exist in the component (grep). Masked component is not relevant to this finding (citizen enters own data). Backend retention/encryption of drafts cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a DPDP purpose/consent notice + checkbox on the first form section before enabling autosave (reuse the grievances/new consent block).
  2. Gate the autosave effect on consent; before consent keep values in memory only.
  3. Add 'Discard draft' button calling a DELETE draft endpoint (needs backend) and clearing local state; show 'Resume saved draft?' prompt instead of silent restore.
- **Acceptance:**
  - Autosave does not fire until consent is ticked.
  - Discard removes the draft (GET drafts no longer lists it).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP: purpose limitation/consent for partial personal data; needs draft DELETE endpoint.

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-06  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Validation covers only required, mobile and email (runtimeApi.ts:256-265); Aadhaar/PIN-like fields get no format check, and Back button uses variant='primary' identical to Next (ServiceRuntimeFlow.tsx:321,391), so the two are indistinguishable.
- **Verified evidence:** runtimeApi.ts:256-265 validateField checks required, apiName containing 'mobile', and 'email' only, by substring on apiName; no Aadhaar (12 digit/Verhoeff), PIN (6 digit) or PAN checks. Back button is variant='primary' at ServiceRuntimeFlow.tsx:321 and :392, identical to Next (:325) and Submit (:393). Theme tag is wrong (validation/visual hierarchy, not masking).
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`
- **Fix steps:**
  1. Have field metadata (type/validation from the published form design) drive validation; fall back to apiName heuristics for aadhaar (/^\d{12}$/), pincode (/^\d{6}$/).
  2. Change the Back buttons to variant='ghost' (Button variant used elsewhere e.g. RegisterRTIButton cancel).
  3. Keep Aadhaar values masked in review step.
- **Acceptance:**
  - validateField('aadhaar_no','1234') returns an error; valid 12 digits pass.
  - Back button renders visually secondary.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; server validation must still be authoritative.

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-07  ·  MEDIUM  ·  partly  ·  theme MONEY

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Money: formatFeeExact divides paise by 100 with a float (runtimeApi.ts:250-254) and prints no GST/breakup; the only demand line is the service fee. Lakh grouping relies on toLocaleString('en-IN').
- **Verified evidence:** runtimeApi.ts:243-254 formatFee/formatFeeExact do minor/100 then toLocaleString('en-IN') with max 2 fraction digits. This is display-only division of an integer paise value (no accumulation/rounding of computed money), so precision risk is low, but it bypasses the shared lib/formatters.ts formatMoney (line 90) required by CLAUDE.md. buildDemandLines (:413-421) returns a single application-fee line; no GST/breakup exists in the data type (Pick of feeFromMinor,feeCurrency,name). Whether the API supplies a tax breakup cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace the /100 logic in formatFee and formatFeeExact with formatMoney(minor) (keep the 'from ' prefix and non-INR currency suffix handling).
  2. If the published-service payload exposes tax/breakup lines, extend buildDemandLines to emit them; otherwise ask backend.
  3. Add unit tests for 0, 100, 123456789 (lakh grouping) paise.
- **Acceptance:**
  - formatFeeExact(1234500,'INR') === '₹12,345' via formatMoney.
  - Fee screen shows breakup lines when the API provides them.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Money display; verify no change to rounding for existing fee values.

### GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-08  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Step labels 'Form/Review/Fee/Done' and 'Saving…/Saved just now/Offline — retrying' are hard-coded English (runtimeApi.ts:292-297, ServiceRuntimeFlow.tsx:317).
- **Verified evidence:** Literals confirmed: JOURNEY_STEPS labels 'Form/Review/Fee/Done' at runtimeApi.ts:292-297 (journeyStepsForService returns them, JourneyRail renders step.label), save-state strings at ServiceRuntimeFlow.tsx:317. Others in the same flow: 'Channel not available' ErrorState (:~150), channelDisabledMessage (runtimeApi.ts:272-275), validation messages (:257-262), submit fallback error (:~230), and apply/page.tsx:37 `Apply — ${service.name}`. Not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/ServiceRuntimeFlow.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/app/(app)/citizen/services/[serviceKey]/apply/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Keep step ids in runtimeApi and map label via t(`journey.${id}`) inside JourneyRail.
  2. Add citizenServices.saving/savedJustNow/offlineRetrying and validation/channel messages (en+hi) and use t() in the component.
  3. Make validateField return message keys, translated by the caller.
  4. Translate the 'Apply — ' page title.
- **Acceptance:**
  - hi locale shows translated step labels and save state.
  - grep finds no English literals in JSX of ServiceRuntimeFlow.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /citizen/services/[serviceKey]/track/[trackingNo]  —  `citizen/services-serviceKey-track-trackingNo.html`

- **Source:** `apps/web/src/app/(app)/citizen/services/[serviceKey]/track/[trackingNo]/page.tsx`
- **Design reference:** `redesign/citizen/services-serviceKey-track-trackingNo.html`

### GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Every fetch failure is shown as a wrong tracking number: trackApplication throws 'Tracking number not found.' for any non-OK response (runtimeApi.ts:231) and TrackClient prints it under 'Tracking unavailable' (TrackClient.tsx:56-68). Citizens who just paid may conclude their application was lost.
- **Verified evidence:** runtimeApi.ts:227-232 trackApplication throws the single message 'Tracking number not found.' for ANY !res.ok (404, 401, 5xx, proxy blip). TrackClient.tsx:38-40 stores e.message, and :56-67 renders ErrorState 'Tracking unavailable' + 'Tracking number not found. Check the tracking number and try again...' with actions ['back'] only (no retry) and backHref /citizen/catalogue. A network throw from fetch() is shown as the raw browser message. Note the 'show — instead of 0' part of the suggested fix does not apply to this page.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/app/(app)/citizen/services/_components/TrackClient.tsx`
- **Fix steps:**
  1. In runtimeApi.ts create class TrackingError {kind:'not_found'|'unavailable', status} and throw not_found only for res.status===404; for other statuses/network throw unavailable (do not echo res.text()).
  2. In TrackClient keep error state as {kind}; add a retry counter in useEffect deps (or a load() callback) so Retry re-runs the fetch.
  3. not_found: ErrorState 'We could not find this tracking number' with actions ['back'] and back link to /citizen/services/{serviceKey}.
  4. unavailable: render ErrorState with actions ['retry','back'] using toHumanError('load',{area:'application status'}) and onRetry=load; explicitly say the application is not lost if the citizen has paid/submitted.
  5. Move all strings to citizenServices keys (trackNotFoundTitle, trackUnavailableTitle...) in en/hi/kn/ta/te.
- **Acceptance:**
  - Unit test: mock fetch 404 -> not_found copy; 500 and rejected fetch -> unavailable copy with a Retry button; retry success renders the timeline.
  - Manual: block /api/proxy/v1/citizen/intake/track/* with 503 -> no 'not found' wording appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only screen. Must not leak backend error text to citizens.
- **Depends on:** GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-06

### GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-03  ·  MEDIUM  ·  partly  ·  theme STUB (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The Notifications card is a permanent EmptyState — no fetch is made (TrackClient.tsx:104-113) — so the copy 'will appear here when the office sends them' can never come true on this screen.
- **Verified evidence:** True that the Notifications card is a permanent EmptyState with no fetch (TrackClient.tsx:106-112 - line numbers 104-113 roughly right), so the promise 'will appear here when the office sends them' (en.json noMessagesMessage, line 879) can never be fulfilled. But the theme is not I18N: the strings are already next-intl keys (t('notificationsTitle'), t('noMessagesTitle')). Also note hi.json has citizenServices keys but kn/ta/te do not (grep found 0 hits), so those locales fall back. No citizen per-application notifications endpoint was visible in the snapshot (only /citizen/alerts route exists); backend cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/TrackClient.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decide: either wire the card to a real per-application notification feed (needs backend endpoint keyed by trackingNo - confirm it exists) or remove the card.
  2. If no feed yet: delete the Notifications card from TrackClient.tsx, or change copy to a static line linking to /citizen/alerts ('Updates about your application are sent by SMS/email').
  3. If feed exists: add fetch in TrackClient with loading/error states (RefreshErrorState-style) and list rows via a shared notification-row component.
  4. Add the missing citizenServices keys to kn/ta/te.
- **Acceptance:**
  - Manual: tracking page never shows a message that cannot occur; if feed wired, a sent SMS appears within one refresh.
  - Unit: card absent (or shows real rows) for mocked feed.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; copy/UX only, but promising notifications that never arrive misleads citizens.

### GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Certificate-ready check (issued, approved, completed, confirmed; TrackClient.tsx:84-86) differs from the timeline 'issued' list, which also includes closed and resolved (runtimeApi.ts:331): a resolved grievance shows all steps done yet 'Not issued yet'.
- **Verified evidence:** TrackClient.tsx:84-86 certificateReady list is [issued, approved, completed, confirmed] on ack.status.trim().toLowerCase(); runtimeApi.ts:331 trackingLaneIndex issued list is [issued, approved, completed, closed, resolved, confirmed] (after normalizeStatus, which turns spaces/underscores to '-'). For status 'closed' or 'resolved' the timeline shows the last lane current/done while the certificate card says 'Not issued yet'. Suggested fix (ConfirmDialog/maker-checker) is irrelevant: read-only page, no action.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/TrackClient.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`
- **Fix steps:**
  1. Export an isTerminalStatus(status) helper from runtimeApi.ts that uses normalizeStatus and a single ISSUED_STATUSES const; use it in trackingLaneIndex.
  2. Replace the inline array in TrackClient.tsx:84 with the helper.
  3. Decide with product whether 'closed'/'resolved' (grievance closure) should show 'certificate' card at all; if not, show a closure-note variant (notIssuedMessage already mentions closure note) rather than 'Not issued yet'.
  4. Add unit test over all statuses asserting timeline-last-lane === certificate-ready.
- **Acceptance:**
  - Unit: for each status in ISSUED_STATUSES both trackingLaneIndex and certificateReady agree; 'RESOLVED' and 'under_review' handled case/underscore-insensitively.
  - Manual: resolved grievance shows closure card, not 'Not issued yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-05  ·  MEDIUM  ·  partly  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status pill prints the raw status string (e.g. 'under-review', 'payment_due') via StatusPill (TrackClient.tsx:94); the timeline normalises but the pill does not.
- **Verified evidence:** TrackClient.tsx:94 passes ack.status to StatusPill, but StatusPill (ds/StatusPill.tsx:52-56) runs humanizeStatus, so the label is humanised, not raw: 'payment_due' -> 'Payment Due', but hyphenated 'under-review' -> 'Under-review' (humanizeStatus splits only on whitespace/underscore). Tone lookup uses STATUS_MAP keys with spaces ('under review'), so hyphenated/underscored statuses fall to the neutral 'info' tone. So not raw, but inconsistent label and no meaningful tone.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/citizen/services/_components/TrackClient.tsx`
- **Fix steps:**
  1. In humanizeStatus split on [\s_-]+ (check callers' tests first).
  2. In StatusPill normalise the lookup key (replace [_-] with space) before STATUS_MAP lookup and add 'payment due','fee pending','awaiting payment','issued','resolved','in review','assigned' entries.
  3. Optionally pass label={t('status.'+normalized)} in TrackClient for localised labels.
- **Acceptance:**
  - Unit: StatusPill status='under-review' renders 'Under Review' with warn class; 'payment_due' warn; 'issued' good.
  - Check other StatusPill users' snapshots.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component; changing tone mapping affects every page using StatusPill - review snapshots.

### GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Tracking unavailable' and the 'Check the tracking number…' sentence are hard-coded outside next-intl (TrackClient.tsx:60-62); the error back link goes to the catalogue, not the service (TrackClient.tsx:66).
- **Verified evidence:** TrackClient.tsx:60-62 hard-codes 'Tracking unavailable' and 'Check the tracking number and try again, or ask at the counter with your receipt.' outside next-intl (also the 'Not found' fallback at :39 and runtimeApi.ts:231 message). :64 backHref='/citizen/catalogue' rather than the service, though the page header (track/[trackingNo]/page.tsx:19) already has a back-to-service button. Theme is I18N, not FABRICATED.
- **Files to change:** `apps/web/src/app/(app)/citizen/services/_components/TrackClient.tsx`, `apps/web/src/app/(app)/citizen/services/_data/runtimeApi.ts`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add keys trackErrTitle, trackErrNext to citizenServices in en/hi (and kn/ta/te).
  2. Use t() in TrackClient error branch; drop the concatenated ${error}.
  3. Set backHref to `/citizen/services/${serviceKey}`.
  4. Do together with -01 (same block).
- **Acceptance:**
  - Switch locale to hi: error state renders Hindi.
  - Back link goes to the service page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-01


---
## /citizen/surveys  —  `citizen/surveys.html`

- **Source:** `apps/web/src/app/(app)/citizen/surveys/page.tsx`
- **Design reference:** `redesign/citizen/surveys.html`

### GAP-CITIZEN-SURVEYS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Failed fetch reads as good news: loader returns [] (loaders.ts:3447-3453), stat cards print 0 and the table says 'No surveys found' (page.tsx:10-29, SurveysTable.tsx:50); only the small DataSourceBadge signals the error.
- **Verified evidence:** loaders.ts:3447-3453 getCitizenSurveys passes [] as empty; on error fetchJson returns {data:[],source:'error'}. page.tsx:10-12 computes active/completed/total from [] so StatCards show 0 (values are numbers, StatCard's '—' logic only triggers on null/NaN). SurveysTable.tsx:84-86 shows EmptyState 'No surveys found' when rows empty (unless cache fallback). Only DataSourceBadge (SurveysTable.tsx:83) signals error. error.tsx exists only for thrown errors.
- **Files to change:** `apps/web/src/app/(app)/citizen/surveys/page.tsx`, `apps/web/src/app/(app)/citizen/surveys/SurveysTable.tsx`
- **Fix steps:**
  1. In page.tsx: if source==='error' pass '—' to all four StatCards (as contacts/page.tsx does with stat()).
  2. In SurveysTable, when provenance is error/no cache, render RefreshErrorState (toHumanError('load',{area:'surveys'})) instead of EmptyState.
  3. Keep the cached-rows path (useSeededResource) but show the stale badge.
- **Acceptance:**
  - Unit: source='error' and empty cache -> stat values '—' and retry UI, no 'No surveys found'.
  - source='api' with [] -> 0 and empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-CITIZEN-SURVEYS-02

### GAP-CITIZEN-SURVEYS-02  ·  MEDIUM  ·  confirmed  ·  theme STALE (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stat cards and table can disagree: stats are computed from the server prop (page.tsx:8-12) but rows come from useSeededResource, which may substitute a cached copy (SurveysTable.tsx:21-26). The UX-012 comment fixed the badge but not the counters.
- **Verified evidence:** page.tsx:10-12 stats come from server prop `surveys`; SurveysTable.tsx:56-61 useSeededResource swaps in cached rows when server source is error or empty (resource.ts:229-250), so the table can list cached surveys while cards show 0. Comment UX-012 (page.tsx:16-19) only moved the badge. Theme is not FABRICATED.
- **Files to change:** `apps/web/src/app/(app)/citizen/surveys/page.tsx`, `apps/web/src/app/(app)/citizen/surveys/SurveysTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into the client component (SurveysTable or new SurveysSummary) that owns useSeededResource, computing counts from `rows`.
  2. Render stats as '—' when provenance is error and rows are empty.
  3. Share one pure helper summarizeSurveys(rows) (see -03).
- **Acceptance:**
  - Unit: server error + cached 3 rows -> cards and table both reflect 3 rows with stale badge.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-SURVEYS-01

### GAP-CITIZEN-SURVEYS-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Status matching is case-sensitive string equality with 'Active' / 'Completed' (page.tsx:10-11); any other status (Draft, Closed, 'active') is counted only in Total Surveys, so the cards do not add up.
- **Verified evidence:** page.tsx:10-11 uses strict equality to 'Active'/'Completed'; status is a free string (CitizenSurvey.status: string, loaders.ts:3442) mapped with no validation, so 'active', 'Draft', 'Closed' count only in the Total card. Backend status vocabulary cannot-verify (no citizen service in the snapshot; hrms engagement surveys are a different endpoint).
- **Files to change:** `apps/web/src/app/(app)/citizen/surveys/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add normalizeSurveyStatus(s) (trim+lowercase) and use in the counts.
  2. Confirm status enum with the citizen service and add a zod enum schema (responseSchema) to getCitizenSurveys.
  3. Optionally add a 'Draft/Other' card or make the cards sum to Total.
- **Acceptance:**
  - Unit: statuses 'active','ACTIVE ',' Active' all counted; unknown status counted under other.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CITIZEN-SURVEYS-02

### GAP-CITIZEN-SURVEYS-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Completion is a free string column (CitizenSurvey.completion, loaders.ts:3442) typed as a string, so a sort on it is lexical unless DataTable parses percentages (DataTable not read); no progress bar.
- **Verified evidence:** completion is a string (loaders.ts CitizenSurvey.completion). DataTable compareValues (ds/DataTable.tsx:160-170) tries Number() then falls back to localeCompare with numeric:true, so '72%' vs '100%' sort correctly via natural ordering; but values with mixed formats ('72 %', '—') could misorder. No progress bar is true (SurveysTable.tsx:98 plain text). Claim 'lexical sort' is overstated.
- **Files to change:** `apps/web/src/app/(app)/citizen/surveys/SurveysTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Parse completion into a number (0-100) in the mapper; keep string only for display.
  2. Add a render cell with a small progress bar (use existing ds progress component if present) and aria-valuenow.
  3. Sort on the numeric field.
- **Acceptance:**
  - Unit: completion '9%' < '10%' when sorted asc; bar renders with correct width.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-SURVEYS-05  ·  LOW  ·  partly  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Register is read-only: no create-survey action, no row link to results, though the empty copy says surveys 'will appear here once created' — no route exists to create one under citizen/surveys.
- **Verified evidence:** SurveysTable.tsx:84-86/en.json emptyMessage says surveys 'will appear here once created'. No create route exists under citizen/surveys (only page, table, error, loading) and rows have no link. But this is the citizen-facing portal register, so creation may belong to another module (hrms engagement has POST surveys/:id at services/hrms-service gap-features/routes.ts:284, a different domain); whether a citizen survey create/result UI is in scope is a product decision.
- **Files to change:** `apps/web/src/app/(app)/citizen/surveys/SurveysTable.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decide scope: if read-only, reword emptyMessage to 'No surveys are published right now.' (all locales).
  2. If results should be viewable, add /citizen/surveys/[id] and set rowLinkKey/rowLinkPrefix on DataTable.
- **Acceptance:**
  - Empty copy no longer implies a create flow; if detail added, row click navigates.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CITIZEN-SURVEYS-06  ·  LOW  ·  partly  ·  theme LOADING (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stat icons are emoji on hard-coded hex backgrounds (page.tsx:26-29); loading.tsx has no header/stat placeholders.
- **Verified evidence:** page.tsx:26-29 passes emoji strings, but StatIcon maps icon strings to lucide icons (ds/StatIcon.tsx imports lucide), so emoji are not rendered raw; hard-coded hex iconBg values (#eef2ff etc.) are real and bypass tokens. surveys/loading.tsx is a bare skeleton block with no header or stat placeholders (confirmed).
- **Files to change:** `apps/web/src/app/(app)/citizen/surveys/page.tsx`, `apps/web/src/app/(app)/citizen/surveys/loading.tsx`
- **Fix steps:**
  1. Drop iconBg overrides or replace with design tokens (var(--info-bg) etc.); verify StatIcon has mappings for these emoji.
  2. Rewrite loading.tsx: PageHeader skeleton, StatGrid of four skeleton cards, table skeleton.
- **Acceptance:**
  - Dark-mode: icon backgrounds follow tokens.
  - Loading shows 4 stat placeholders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-CITIZEN-APPEALS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Filing window is a free-entry number field (default 30) sent from the browser as windowDays (AppealPanel.tsx:23,30,49): the citizen can enter 3650 and the client-side window check is meaningless unless the server derives the limit from the decision type. Server behaviour undeterminable (citizen-service absent).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['POST /v1/citizen/appeals', 'GET /api/v1/citizen/appeals']`
- **Question:** Does the server derive the appeal filing window from the decision type and ignore or reject client-sent windowDays?
- **How to verify:** Open appeals handler; POST with windowDays=3650 for a decision whose limit is 30 and check outcome.
- **Test to add:** Given a decision dated 90 days ago with a 30-day limit, when POST appeal with windowDays=3650, then 422 APPEAL_WINDOW_EXPIRED.
- **Impact if wrong:** Time-barred appeals accepted; statutory breach; high.
- **Web change if wrong:** Remove windowDays field from AppealPanel.tsx:23,30,49; show server-provided limit.

### GAP-CITIZEN-CERTIFICATES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The 'public QR verify' lives inside the authenticated (app) shell: verifying requires sign-in and the ModuleGate, so a third party scanning a certificate QR cannot use it (certificates/page.tsx; CertificateVerify.tsx:35 calls /api/proxy). A separate unauthenticated verify route is undeterminable from this tree.
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['GET /api/proxy/v1/citizen/certificates/verify/:id']`
- **Question:** Is there a public unauthenticated verify endpoint returning only minimal validity data (no PII) that a QR can resolve?
- **How to verify:** Check gateway public allowlist and certificates verify route auth; curl without a token.
- **Test to add:** Given no auth header, when GET verify with valid certificate no, then 200 {valid, issuedTo(masked), issuedOn}; invalid gives valid:false, rate limited.
- **Impact if wrong:** Third parties cannot verify certificates; trust failure, or PII leak if opened badly; high.
- **Web change if wrong:** Add an unauthenticated route outside the (app) shell, e.g. app/(public)/verify/[id], calling the public endpoint.

### GAP-CITIZEN-DOCUMENTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Upload' sends no file: upload('upload') posts JSON { applicationId, serviceId, docType } only (DocumentPanel.tsx:36-39) — there is no file-picker control, so it cannot attach a document. Whether the API accepts a bare declaration is undeterminable (citizen-service absent).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['POST /v1/citizen/documents/upload', 'POST /v1/citizen/documents/digilocker-fetch', 'GET /v1/citizen/documents/checklist']`
- **Question:** Does /documents/upload accept a JSON declaration without a file, or does it require a presigned or multipart file with size/type/virus checks?
- **How to verify:** Open upload handler and schema; POST {applicationId,serviceId,docType} and see if a document is marked uploaded.
- **Test to add:** Given JSON without file reference, when POST upload, then 400 FILE_REQUIRED; with file, content-type and size are validated.
- **Impact if wrong:** Applications marked complete with no evidence; high.
- **Web change if wrong:** Add file picker with presign/multipart upload in DocumentPanel.tsx.

### GAP-CITIZEN-FEEDBACK-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No endpoint referenced anywhere in the tree; whether a feedback API exists is undeterminable (citizen-service absent from snapshot).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['(none referenced) expected POST /v1/citizen/feedback']`
- **Question:** Does a citizen feedback endpoint exist, with validation, rate limit and citizen ownership?
- **How to verify:** Search citizen-service routes for feedback; if none, raise a backend ticket.
- **Test to add:** Given a signed-in citizen, when POST feedback with rating 1-5 and text, then 201; anonymous or oversize input rejected.
- **Impact if wrong:** Feedback page has nothing to submit to; medium.
- **Web change if wrong:** Keep the form disabled/labelled as unavailable until the endpoint exists.

### GAP-CITIZEN-PAYMENTS-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Recording payment is available to every signed-in user with the module enabled; no role gate for a cashier action. Audit behaviour undeterminable (citizen-service absent).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['POST /v1/citizen/payments/offline']`
- **Question:** Is recording an offline payment restricted to a cashier role and audited with operator id, receipt no and amount?
- **How to verify:** Open payments/offline route guard; curl with a citizen token expecting 403; inspect audit row after a cashier call.
- **Test to add:** Given a citizen role, when POST offline payment, then 403; given cashier, then 201 with audit actor and unique receipt.
- **Impact if wrong:** Fraudulent payment marking, fee leakage; high.
- **Web change if wrong:** Hide PaymentPanel record form for non-cashier roles.

### GAP-CITIZEN-PORTAL-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Metrics come from citizen-service portal/metrics (loaders.ts:3355-3361 comment); service absent, so definitions of 'active' and 'resolved' are undeterminable.
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['GET /v1/citizen/portal/metrics']`
- **Question:** How are active and resolved defined (statuses included, time window, SLA) in portal/metrics?
- **How to verify:** Open citizen-service requests/routes.ts portal/metrics query and compare status sets to grievance enum.
- **Test to add:** Given grievances in each status, when GET metrics, then active counts open+in-progress+escalated and resolved counts resolved only (not closed-reopened).
- **Impact if wrong:** Misleading public KPIs; low.
- **Web change if wrong:** Relabel KPI cards to the true definition.

### GAP-CITIZEN-REQUESTS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** citizen-service is not in the snapshot (services/ = hrms-service only) — route handlers, RBAC, statuses and audit behaviour behind /api/v1/citizen/* are undeterminable.
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['GET/POST /api/proxy/v1/citizen/grievances', 'GET /api/v1/crm/grievances (loader)']`
- **Question:** What RBAC, status enum and audit apply to grievance list and create, and is list scoped to caller or department?
- **How to verify:** Open grievances routes; call list as citizen and as officer and compare row sets; check audit on create.
- **Test to add:** Given citizen A, when GET grievances, then only A's rows; creating emits audit row.
- **Impact if wrong:** Cross-citizen data exposure; high.
- **Web change if wrong:** Filter/labels per scope; none if server scopes.

### GAP-CITIZEN-REQUESTS-DETAIL-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Officer actions (Resolve, Escalate, Reopen, Add action) are rendered for every signed-in user; the only gate is grievance status (RequestDetailClient.tsx:172-210). No requireAnyRole; server RBAC is undeterminable (no citizen-service in snapshot).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['POST /v1/citizen/grievances/:id/{resolve,escalate,reopen,actions}']`
- **Question:** Are resolve, escalate and add-action limited to officer roles and reopen to the owning citizen, with 403 otherwise?
- **How to verify:** Open grievances route guards; curl resolve with a citizen token and with another citizen's reopen.
- **Test to add:** Given non-officer, when POST resolve, then 403; given other citizen, when reopen, then 403/404.
- **Impact if wrong:** Any user can close or escalate grievances; high.
- **Web change if wrong:** Gate buttons in RequestDetailClient.tsx:172-210 by role.

### GAP-CITIZEN-RTI-DETAIL-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Record response is offered to every signed-in user, and File appeal is offered even before any response or deadline breach (RTIDetailClient.tsx:168-186); no role gate, and a citizen-side action (appeal) sits next to a PIO-side action (respond) on one screen. Server RBAC undeterminable (citizen-service absent).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['GET /v1/citizen/rti/:id', 'POST /v1/citizen/rti/:id/respond', 'POST /v1/citizen/rti/:id/appeal']`
- **Question:** Is respond restricted to PIO role, appeal to the applicant, and is appeal refused before a response or deadline breach?
- **How to verify:** Open rti routes; curl respond as applicant (expect 403), appeal on a fresh RTI (expect 409).
- **Test to add:** Given applicant token, when POST respond, then 403; given RTI within deadline without response, when POST appeal, then 409 APPEAL_NOT_ALLOWED.
- **Impact if wrong:** Applicant can answer own RTI; premature appeals; statutory risk; high.
- **Web change if wrong:** Split PIO and applicant actions by role; show appeal only when eligible.

### GAP-CITIZEN-SERVICES-SERVICEKEY-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** ?counter=1 is a client-controlled query flag (page.tsx:26); the UI only mirrors the server CHANNEL_NOT_ALLOWED gate. Whether the server verifies the operator behind counter mode cannot be determined: no citizen backend exists in the snapshot.
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['GET /api/v1/citizen/catalogue/published/lookup', 'POST /v1/citizen/intake (channel)']`
- **Question:** Does the server verify an authenticated operator/role before accepting channel=counter, rejecting CHANNEL_NOT_ALLOWED otherwise?
- **How to verify:** Open intake handler channel check; POST with channel=counter using a citizen token.
- **Test to add:** Given citizen token, when POST intake channel=counter, then 403 CHANNEL_NOT_ALLOWED; operator token succeeds with operator id audited.
- **Impact if wrong:** Citizens spoof counter channel bypassing online rules; medium.
- **Web change if wrong:** Derive counterMode from session role rather than ?counter=1.

### GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Access control cannot be seen from the UI: the route takes only a tracking number and displays status, service and certificate state with no citizen ownership check on the client (TrackClient.tsx:27-43). Whether /intake/track/:no is scoped to the caller or enumerable is undeterminable — no citizen backend in this snapshot (DPDP).
- **Service:** `citizen-service`  ·  **Endpoint(s):** `['GET /v1/citizen/intake/track/:trackingNo']`
- **Question:** Is tracking lookup scoped to the caller (or requires a secret), and are tracking numbers non-guessable and rate limited?
- **How to verify:** Open intake/track handler; request another citizen's tracking no with a different token and unauthenticated; check number format entropy.
- **Test to add:** Given citizen B token, when GET track for citizen A's number, then 403/404; sequential guesses are rate limited.
- **Impact if wrong:** Enumeration of citizen applications (DPDP breach); high.
- **Web change if wrong:** Add ownership indicator or OTP step on the track page if server cannot scope.
