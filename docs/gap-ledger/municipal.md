# Detailed gap file — module `municipal`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 20



---
## /municipal  —  `municipal/home.html`

- **Source:** `apps/web/src/app/(app)/municipal/page.tsx`
- **Design reference:** `redesign/municipal/home.html`

### GAP-MUNICIPAL-HOME-01  ·  HIGH  ·  confirmed  ·  theme STATS (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "Citizen apply links" is printed as MUNICIPAL_SERVICE_CATALOG.length = 17 (page.tsx), but 6 services (building, animal, drainage, parks, refund, swm) have no citizenServiceKey (types.ts), so only 11 links exist; "Officer lists" and "Citizen apply links" are the same number by construction.
- **Verified evidence:** apps/web/src/app/(app)/municipal/page.tsx:24-25 both StatCards use MUNICIPAL_SERVICE_CATALOG.length (17). Catalog has 17 entries (_data/services/index.ts:23-41); 6 configs (building, animal, drainage, parks, refund, swm) have citizenServiceKey commented out, so 11 have citizen links. Officer lists=17 is correct as a count of consoles but duplicates the other stat.
- **Files to change:** `apps/web/src/app/(app)/municipal/page.tsx`, `apps/web/src/app/(app)/municipal/_data/services/index.ts`
- **Fix steps:**
  1. Add export const CITIZEN_LINK_COUNT = MUNICIPAL_SERVICE_CATALOG.filter(s => s.citizenServiceKey).length in _data/services/index.ts.
  2. Use it for the 'Citizen apply links' StatCard value (page.tsx:25).
  3. Optionally relabel 'Officer lists' to 'Officer consoles'.
- **Acceptance:**
  - Unit test: CITIZEN_LINK_COUNT === 11 with current catalog and changes when a key is added.
  - Hub shows 17 and 11.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-MUNICIPAL-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** All 17 tiles render for every user and tenant (page.tsx) though enablement is only checked in [serviceKey]/layout.tsx (ModuleGate); a disabled module is discovered only after the click, and no role gating exists on the hub (layout.tsx).
- **Verified evidence:** apps/web/src/app/(app)/municipal/page.tsx:40,63 maps all catalog entries with no entitlement check; ModuleGate is applied only in apps/web/src/app/(app)/municipal/[serviceKey]/layout.tsx:22 (moduleKey=config.moduleKey); municipal/layout.tsx just returns children. So disabled modules show tiles that lead to the 'Module Not Enabled' screen. Role gating: none on hub; server enforcement cannot be verified (backend absent).
- **Files to change:** `apps/web/src/app/(app)/municipal/page.tsx`
- **Fix steps:**
  1. Make hub call getEnabledModules() and isModuleEnabled() from @/lib/moduleVisibility (same as ModuleGate) and filter sec5/reference lists by svc.moduleKey.
  2. Compute stat counts from the filtered list.
  3. If role-based visibility is required, decide source of role claims (decision) and reuse the shared role guard; keep server checks authoritative.
- **Acceptance:**
  - Test: with 'trade' disabled, its tile and Quick link are absent.
  - All-enabled tenant still shows 17 tiles.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Hiding is UX only; must not replace server authorization. Wrong filter could hide a needed console.
- **Depends on:** GAP-MUNICIPAL-HOME-01

### GAP-MUNICIPAL-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle exposes internal spec vocabulary to officers: "BRD Section 5 — 16 Sec5 services plus shop reference" (page.tsx), and the card is headed "Reference template"; neither means anything to a municipal clerk.
- **Verified evidence:** apps/web/src/app/(app)/municipal/page.tsx:19 subtitle 'Officer consoles and citizen entry points for BRD Section 5 — {n} Sec5 services plus shop reference.' and :60 heading 'Reference template'; internal spec vocabulary.
- **Files to change:** `apps/web/src/app/(app)/municipal/page.tsx`
- **Fix steps:**
  1. Subtitle: 'Officer consoles and citizen entry points for municipal services.'
  2. Rename 'Reference template' to 'Other services' (or drop section if shop should join the list).
  3. Rename 'Sec5 services' stat label to 'Municipal services'.
- **Acceptance:**
  - No 'BRD', 'Sec5' or 'template' strings in rendered hub.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-MUNICIPAL-HOME-04  ·  LOW  ·  confirmed  ·  theme UX (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Quick links silently truncate to the first 6 Sec5 services with slice(0, 6) (page.tsx) and no "more" affordance; the other 10 are reachable only from the tile grid.
- **Verified evidence:** apps/web/src/app/(app)/municipal/page.tsx:80 sec5.slice(0, 6) with no 'view all' affordance. Sec5 has 16 services so 10 omitted from Quick links; all remain reachable via tile grid above (:40).
- **Files to change:** `apps/web/src/app/(app)/municipal/page.tsx`
- **Fix steps:**
  1. Either drop the arbitrary slice (list all 16) or add a heading note 'Showing 6 of 16' with an anchor link to the tile grid.
  2. Better: choose quick links by usage/pinned services rather than catalog order.
- **Acceptance:**
  - Quick links either list all Sec5 services or show a visible 'more' link.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-MUNICIPAL-HOME-05  ·  LOW  ·  partly  ·  theme A11Y (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Whole Card is wrapped in a Link and the icon is an emoji with aria-hidden (page.tsx); tile has no accessible name beyond h3+p text and there is no route-level loading/error/not-found in this segment.
- **Verified evidence:** apps/web/src/app/(app)/municipal/page.tsx:41,64 wrap Card in Link with aria-hidden emoji (:43). The link's accessible name is the concatenated h3+p+CTA text, which is valid, though verbose; the 'no accessible name' claim is overstated. Reference tiles (:64-72) have no CTA text. Confirmed: no loading.tsx/error.tsx/not-found.tsx under municipal/ (find returned none); a parent (app)/error.tsx exists, so errors are caught generically. Not a dead-route issue.
- **Files to change:** `apps/web/src/app/(app)/municipal/page.tsx`, `apps/web/src/app/(app)/municipal/loading.tsx`, `apps/web/src/app/(app)/municipal/error.tsx`
- **Fix steps:**
  1. Add aria-label={svc.label} (or aria-labelledby h3 id) to each tile Link to give a concise name.
  2. Add municipal/loading.tsx using SkeletonCard/StatGrid matching the hub.
  3. Add municipal/error.tsx using shared RouteError (app/_components/RouteError.tsx) with retry and back link.
- **Acceptance:**
  - Screen reader announces service label only for tile link.
  - Throttled load shows skeleton; thrown error shows RouteError with retry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /municipal/[serviceKey]  —  `municipal/serviceKey.html`

- **Source:** `apps/web/src/app/(app)/municipal/[serviceKey]/page.tsx`
- **Design reference:** `redesign/municipal/serviceKey.html`

### GAP-MUNICIPAL-SERVICEKEY-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** On fetch failure the page shows Total records 0 and In progress 0 as facts; the only hint is the third card reading "Unavailable" (page.tsx, source only feeds that card). No DataSourceBadge/RefreshErrorState, unlike the sibling applications page (applications/page.tsx).
- **Verified evidence:** [serviceKey]/page.tsx:18 destructures {data:list, source} from fetchMunicipalList; on failure fetchJson returns the empty result (municipalApi.ts:22-28; apiClient.ts:117-126 also for missing token/base URL). Line 35 renders `list.meta.total || list.rows.length` = 0 and line 36 `pending` = 0; only line 37 uses source (Live/Unavailable). No DataSourceBadge/RefreshErrorState, whereas applications/page.tsx:27,43-51 shows badge + EmptyState on source==='error'. notFound() is NOT used on error (only on unknown key, line 16), so that part of the fix is already satisfied.
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/page.tsx`
- **Fix steps:**
  1. In page.tsx compute `const failed = source === "error"`.
  2. When failed, render StatCard values as "—" for Total records and In progress.
  3. Render <RefreshErrorState error={toHumanError("load",{area:config.label})} backHref="/municipal"/> (ds/RefreshErrorState, client wrapper with router.refresh) above the StatGrid instead of/in addition to the third card.
  4. Drop the 'API' StatCard (see -03) or show it only when failed.
- **Acceptance:**
  - Component/page test: mock fetchMunicipalList => source 'error'; Total records and In progress show '—', retry button present.
  - Healthy fetch with 0 rows still shows 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-03

### GAP-MUNICIPAL-SERVICEKEY-02  ·  HIGH  ·  partly  ·  theme COUNTS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "In progress" is computed from the first page only (fetchMunicipalList is called without query, municipalApi.ts, default pageSize 20 in records.ts) and counts every status not in approved/issued/completed/closed/resolved (page.tsx) — rejected, cancelled, expired and "—" all count as in progress, and for a 214-record service the figure is capped at 20.
- **Verified evidence:** page.tsx:18 calls fetchMunicipalList(config) with no query, so only the first page is requested (municipalApi.ts:14-20 builds page/status only; no pageSize sent). page.tsx:19 counts every status not in approved/issued/completed/closed/resolved as 'in progress' (rejected/cancelled/expired/'—' included). True. However the '20' cap is overstated: 20 is only the parse-side fallback (records.ts:73,88 uses meta.pageSize from the response, else rows.length||20); the real server page size is not visible in this snapshot. Total (line 35) uses meta.total so it is correct; only In progress is page-scoped.
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/page.tsx`, `apps/web/src/app/(app)/municipal/_data/municipalApi.ts`
- **Fix steps:**
  1. Do not derive counts client-side from page 1. Either call the list with per-status filters (fetchMunicipalList supports query.status) and read meta.total, or use a summary/count endpoint if backend has one.
  2. If no such endpoint, label the tile 'In progress (this page)' or remove it.
  3. Exclude terminal negative states (rejected, cancelled, expired) from 'in progress' using a shared status-group constant in _data/records.ts.
  4. Show '—' when status is '—'/unknown rather than counting it.
- **Acceptance:**
  - Unit test: rows with statuses rejected/cancelled/approved/submitted => in-progress count only counts submitted-like states.
  - With meta.total=214 and 20 rows, tile does not display a number derived from the 20 rows without a page-scope label.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong workload numbers shown to officers; needs backend status-count endpoint (cannot-verify: municipal services absent from snapshot).
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-01

### GAP-MUNICIPAL-SERVICEKEY-03  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "API — Live / Unavailable" (page.tsx) uses the "API unavailable" / "Live API" wording the DataSourceBadge doc comment says was removed (DataSourceBadge.tsx), and the Officer workspace card prints the raw gateway path in a code tag (page.tsx) to municipal officers.
- **Verified evidence:** page.tsx:37 renders StatCard label 'API' with value 'Live'/'Unavailable' - the wording DataSourceBadge.tsx:57-60 says was removed (Requirement 5.2). page.tsx:46 prints `config.listPath` in a <code> to officers. Strings are hard-coded English (next-intl is in the repo, src/i18n + messages/*.json, but this page uses none). Status is text ('Live'/'Unavailable') so not colour-only.
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Remove the 'API' StatCard; failure is conveyed by RefreshErrorState (-01).
  2. Rewrite the Officer workspace card copy without gateway path (e.g. 'Scrutiny queues, approvals and permits for {label} are in the {resourceLabel} list').
  3. Move remaining strings to next-intl (getTranslations in this server component) keys in messages/en.json (+hi/kn/ta/te).
- **Acceptance:**
  - Rendered page contains neither 'API' card nor '/api' / listPath text.
  - Strings resolve from en.json; hi locale renders translated text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-01

### GAP-MUNICIPAL-SERVICEKEY-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Six services (building, animal, drainage, parks, refund, swm) have no citizenServiceKey so CitizenServiceLinks returns null (CitizenServiceLinks.tsx) and the page silently has no citizen section; officers get no explanation of how citizens apply for those.
- **Verified evidence:** CitizenServiceLinks.tsx:12 returns null when !config.citizenServiceKey. services/{building,animal,drainage,parks,refund,swm}.ts each carry the comment 'citizenServiceKey intentionally omitted - no citizen-service manifest exists yet' (line 14); the other 9 of 15 services set it. The service home page (page.tsx:41) therefore silently omits the section. Note: 15 services exist (not 21 - grep count included types/index).
- **Files to change:** `apps/web/src/app/(app)/municipal/_components/CitizenServiceLinks.tsx`, `apps/web/src/app/(app)/municipal/[serviceKey]/page.tsx`
- **Fix steps:**
  1. In CitizenServiceLinks, replace `return null` with a muted note: 'Applications for this service are recorded by officers at the counter; no online citizen form is published yet.'
  2. Optionally link to the counter-entry route if one exists (counterMode prop already exists); do not invent one.
  3. Keep the applications/page.tsx guard (it already conditionally renders).
- **Acceptance:**
  - Visit /municipal/swm: explanatory note shown in place of the citizen section.
  - Visit /municipal/fire: Apply online / Service page links unchanged.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy must be confirmed with product: is counter-only intake the true process?

### GAP-MUNICIPAL-SERVICEKEY-05  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Unknown serviceKey → notFound() (layout.tsx) with no municipal not-found.tsx; no loading.tsx in the segment.
- **Verified evidence:** Unknown key -> notFound() in both [serviceKey]/layout.tsx:16 and page.tsx:16; find shows no not-found.tsx, loading.tsx or error.tsx anywhere under (app)/municipal, so it falls through to root app/not-found.tsx (generic '404 - Page not found', no back link) and, for slow fetches (force-dynamic, page.tsx:8), no skeleton. Errors fall to (app)/error.tsx. Real but low impact.
- **Files to change:** `apps/web/src/app/(app)/municipal/not-found.tsx`, `apps/web/src/app/(app)/municipal/loading.tsx`, `apps/web/src/app/(app)/municipal/error.tsx`
- **Fix steps:**
  1. Add municipal/not-found.tsx using EmptyState + link back to /municipal ('Service not found').
  2. Add municipal/loading.tsx with ds Skeleton mirroring PageHeader + 3 StatCards + Card.
  3. Add municipal/error.tsx wrapping shared RouteError (as notifications/error.tsx does) with backHref='/municipal'.
- **Acceptance:**
  - /municipal/does-not-exist shows the municipal not-found with a back link.
  - Throttled network shows skeleton on /municipal/trade.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /municipal/[serviceKey]/applications  —  `municipal/serviceKey-applications.html`

- **Source:** `apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx`
- **Design reference:** `redesign/municipal/serviceKey-applications.html`

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-01  ·  HIGH  ·  partly  ·  theme PAGINATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Only the first page is ever shown: fetchMunicipalList(config) is called without {status,page} (page.tsx vs municipalApi.ts) and the DataTable has no pager wired to the server, so a service with 214 records silently shows 20 rows with no "showing 20 of N" and no way to reach the rest; client-side filter only searches those 20.
- **Verified evidence:** apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx:43 calls fetchMunicipalList(config) with no query although municipalApi.ts:14 accepts {status,page}; page reads no searchParams; RecordsTable.tsx passes no pageSize and no server pager; meta (total/page) is parsed in records.ts:137-141 but never rendered. So user cannot reach page 2 or see total. '20 rows' is the parser default, the actual server page size is unverifiable (backend absent). DataTable filter searches only loaded rows (true).
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx`, `apps/web/src/app/(app)/municipal/_components/RecordsTable.tsx`, `apps/web/src/app/(app)/municipal/_data/municipalApi.ts`
- **Fix steps:**
  1. Accept searchParams {page,status,q} in the page and pass to fetchMunicipalList (validate with zod).
  2. Return meta from fetchMunicipalList (already in data.meta) and render 'Showing X-Y of N' plus Prev/Next Links that update ?page=.
  3. Optionally pass q to server if API supports it (unverified); otherwise label filter 'filters this page'.
- **Acceptance:**
  - With mocked meta.total=214,pageSize=20 page shows 'Showing 1-20 of 214' and Next goes to ?page=2 calling API with page=2.
  - Out-of-range page handled.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; confirm API page/pageSize params exist per service.
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-05

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-02  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT (was WIRING)

- [x] **Status** (W0 2026-10-13, W2 PQ-C re-confirmed: ISO dates still formatted by detailEntries, records.test.ts passes; closed by ##1924)
- **First-pass claim:** Updated column prints the raw API string (records.ts pickField returns the ISO timestamp verbatim) instead of a formatted date; reference/title fall back to "—" when the configured fields are absent (records.ts), giving a row with three dashes and only a raw-id link target.
- **Verified evidence:** apps/web/src/app/(app)/municipal/_data/records.ts:117 updatedAt via pickField returns ISO string verbatim; RecordsTable.tsx:261 shows it with no formatter. records.ts:101 pickField returns '—' for missing reference/title/status, so a row can show dashes; row link still uses id (RecordsTable.tsx:264-265).
- **Files to change:** `apps/web/src/app/(app)/municipal/_components/RecordsTable.tsx`, `apps/web/src/app/(app)/municipal/_data/records.ts`
- **Fix steps:**
  1. Add render on the Updated column using formatIndianDate (@/lib/formatters).
  2. When reference is '—' fall back to a short id via formatInternalRef.
  3. Verify numberFields/titleFields per service against API types (services absent, cannot verify).
- **Acceptance:**
  - Row with updatedAt ISO shows dd Mon yyyy.
  - Row with no reference shows short id, not '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Error state has no Retry and treats every failure alike; the EmptyState copy blames role or gateway ("Check that you are signed in with the correct municipal role…", page.tsx) but a 403 vs a 500 cannot be told apart, and the table never shows stale data.
- **Verified evidence:** apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx:70-77 error branch is a plain EmptyState (no retry) with copy blaming role/gateway. fetchJson returns status (apiClient.ts:144) but municipalApi.ts:28 drops it (returns only data, source), so 403 vs 500 cannot be told apart in the page. Also DataSourceBadge (:53) shown on error.
- **Files to change:** `apps/web/src/app/(app)/municipal/_data/municipalApi.ts`, `apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx`
- **Fix steps:**
  1. Return status/errorMessage from fetchMunicipalList and fetchMunicipalDetail.
  2. Replace EmptyState with <RefreshErrorState error={toHumanError(status===403?'forbidden':'load',{area:...})} backHref=.../> (check toHumanError kinds in lib/messages).
  3. Remove role/gateway wording.
- **Acceptance:**
  - Mock 500 shows retry button; mock 403 shows permission message.
  - Empty success list still shows 'No ... yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by ##1924 — Done: subtitle uses config.description, 'Live' dropped. Remains: person-name subject (e.g. trade ownerName) in list still unmasked (no Masked in RecordsTable)
- **First-pass claim:** Subtitle "Live list from /api/v1/trade/applications" (page.tsx) exposes the gateway path; "Live" contradicts the DataSourceBadge policy. Subject falls back to ownerName (trade.ts titleFields) which is a natural person's name shown without masking.
- **Verified evidence:** apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx:49 subtitle `Live list from ${config.listPath}` prints e.g. /api/v1/trade/applications; RecordsTable.tsx:271 empty message also says 'Live'. trade.ts titleFields ['businessName','ownerName'] so ownerName appears in Subject column unmasked when businessName absent. DataSourceBadge policy itself not verified.
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx`, `apps/web/src/app/(app)/municipal/_components/RecordsTable.tsx`, `apps/web/src/app/(app)/municipal/_data/services/trade.ts`
- **Fix steps:**
  1. Change subtitle to config.description or '{n} records'.
  2. Drop 'Live' from empty message.
  3. Use <Masked kind='name'> for person-name subject (or config flag titleIsPerson) once Masked exists.
- **Acceptance:**
  - No '/api/' in rendered page.
  - Person-name subjects are masked with permitted reveal.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Masking a search column affects officer lookup; agree policy.
- **Depends on:** Masked component, GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-05  ·  LOW  ·  confirmed  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by ##1950 — Done: status filter tabs from per-service statusVocabulary (#1950) bound to ?status=. Remains: 'issued' StatusPill still maps to neutral info, not green
- **First-pass claim:** No status filter/segmented control although the API accepts ?status (municipalApi.ts); statuses are free text so StatusPill shows unmapped values (e.g. "issued") in the neutral info colour (StatusPill.tsx map).
- **Verified evidence:** apps/web/src/app/(app)/municipal/_data/municipalApi.ts:14-17 supports status query but page.tsx passes none and has no Segmented/filter UI. StatusPill.tsx STATUS_MAP has no 'issued', so falls back to 'info' (StatusPill.tsx:53); humanizeStatus label fine. Municipal status vocabulary unverifiable (backend absent).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/municipal/[serviceKey]/applications/page.tsx`
- **Fix steps:**
  1. Add a Segmented control (ds/Segmented.tsx) bound to ?status= and pass to fetchMunicipalList.
  2. Add issued/scrutiny/rejected/etc. to STATUS_MAP after confirming enum from service.
  3. Optionally config statusOptions per service.
- **Acceptance:**
  - Selecting 'Approved' calls list with status=approved.
  - 'issued' renders green pill.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** StatusPill is shared; new mappings alter colours app-wide.
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-01


---
## /municipal/[serviceKey]/applications/[id]  —  `municipal/serviceKey-applications-detail.html`

- **Source:** `apps/web/src/app/(app)/municipal/[serviceKey]/applications/[id]/page.tsx`
- **Design reference:** `redesign/municipal/serviceKey-applications-detail.html`

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W2 PQ: closed by #2034; detailEntries is now an allow-list, PII masked incl. nested/free text. Audited reveal NOT built -- NEEDS OWNER DECISION)
- **W0-10 note:** review found the W0 tick partly — default masking via Masked + piiFields/hiddenFields in records.ts:174-260, but: only trade.ts defines piiFields; heuristic piiKindForKey (records.ts:183) omits names/address; no permission-gated reveal with audit (RecordDetailPanel.tsx:53 uses Masked only) as acceptance requires
- **First-pass claim:** Generic dump of the whole record: detailEntries() skips only tenantId/createdBy/updatedBy/version (records.ts) and prints every other field, including applicant/owner name, mobile, address and any identity or document numbers the service returns, with no masking or role gate — DPDP exposure the code cannot rule out (backend absent).
- **Verified evidence:** apps/web/src/app/(app)/municipal/_data/records.ts:152-161 detailEntries skips only tenantId/createdBy/updatedBy/version and renders every other key; RecordDetailPanel.tsx:206-231 prints all values verbatim. No masking component exists in ds (no Masked in app/_components/ds), and no role gate beyond ModuleGate. Which PII fields the backend returns cannot be verified (services absent), but trade config titleFields include ownerName.
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/(app)/municipal/_data/records.ts`, `apps/web/src/app/(app)/municipal/_components/RecordDetailPanel.tsx`, `apps/web/src/app/(app)/municipal/_data/services/types.ts`
- **Fix steps:**
  1. Create ds <Masked value kind='phone|aadhaar|pan|email|name'> with reveal button gated by a permission and emitting an audit event on reveal.
  2. Add optional piiFields: readonly string[] (and hiddenFields) to MunicipalServiceConfig and fill per service.
  3. In detailEntries return {key, label, value, pii} and in RecordDetailPanel render pii values via <Masked>.
  4. Add key-name heuristics (mobile, phone, aadhaar, pan, email, address) as default fallback.
  5. Add 'id' and document/identity numbers to the deny/mask list.
- **Acceptance:**
  - Test: record with mobile '9876543210' renders masked (98xxxxxx10) by default.
  - Reveal requires permission and triggers audit call (mock).
  - Fields in hiddenFields never render.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; must agree field lists with service owners; reveal must be audited.
- **Depends on:** Masked component, audit reveal endpoint

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme WORKFLOW (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W2 PQ-A note (#2037):** re-verified, no change: RecordActions is officer-role gated and wired for trade only; other services have no workflow endpoints. Needs owner decision plus per-service backend contracts.
- **W0 note:** partly fixed by ##1934 — Done: roadmap copy removed; RecordActions (officer-role gated) + RecordHistory added. Remains: only trade has a workflow config; other services stay read-only with no actions
- **First-pass claim:** An officer console with no officer actions: the card literally tells staff "Actions (approve, inspect, issue) will wire to workflow tasks in a follow-up pass" (RecordDetailPanel.tsx). Nothing on this route approves, rejects, inspects or issues, so scrutiny must happen outside the app; no audit trail or history is shown either.
- **Verified evidence:** apps/web/src/app/(app)/municipal/_components/RecordDetailPanel.tsx:198-201 says 'Actions (approve, inspect, issue) will wire to workflow tasks in a follow-up pass.' The page ([id]/page.tsx:130-161) has no action buttons and no history/audit section. Theme FABRICATED is wrong: this is missing functionality, not fake data.
- **Files to change:** `apps/web/src/app/(app)/municipal/_components/RecordDetailPanel.tsx`, `apps/web/src/app/(app)/municipal/[serviceKey]/applications/[id]/page.tsx`, `apps/web/src/app/(app)/municipal/_components/RecordActions.tsx`
- **Fix steps:**
  1. Remove the 'follow-up pass' sentence from user copy immediately.
  2. Decide workflow contract (task endpoints per service; not visible in snapshot) and add client <RecordActions> with approve/reject/inspect/issue using ConfirmDialog and idempotent POST.
  3. Add read-only 'History' card from the service's audit/timeline endpoint once available.
  4. Gate actions by role.
- **Acceptance:**
  - Panel copy has no roadmap text.
  - Once wired: approving changes status and appends a history entry; unauthorised role sees no buttons.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** State-changing approvals on licences; needs audit event and role checks server-side.
- **Depends on:** workflow task API, GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by ##1924 — Done: ISO dates formatted, nested objects as key/value lines, id skipped, fieldOrder support. Remains: fieldOrder populated only for trade; other services sort alphabetically (status not first)
- **First-pass claim:** Fields are sorted alphabetically by label (records.ts), burying Status/Owner/Reference; nested objects are shown as raw JSON in a pre block (records.ts), timestamps as raw ISO strings, booleans as Yes/No, and the internal record Id is shown as a normal field.
- **Verified evidence:** apps/web/src/app/(app)/municipal/_data/records.ts:160 sorts by label (localeCompare) - confirmed; :170 nested values JSON.stringify'd into <pre> - confirmed; :166 strings incl. ISO timestamps unformatted - confirmed; 'id' not in skip set (:153) - confirmed. Booleans as Yes/No (:165) is fine, not a defect.
- **Files to change:** `apps/web/src/app/(app)/municipal/_data/records.ts`, `apps/web/src/app/(app)/municipal/_components/RecordDetailPanel.tsx`, `apps/web/src/app/(app)/municipal/_data/services/types.ts`
- **Fix steps:**
  1. Add per-service optional fieldOrder to config; put status, reference, owner/title first, rest alphabetical.
  2. Add 'id' to skip set (show reference instead).
  3. In formatDetailValue detect ISO date strings / *At keys and format with formatIndianDate from @/lib/formatters (add a date-time variant if IST time needed).
  4. Render objects as nested key/value rows instead of JSON.
- **Acceptance:**
  - Unit test: '2026-03-04T10:00:00Z' renders as a formatted IST date.
  - Status appears before other fields.
  - No raw '{' JSON for address objects.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only.

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Developer-facing copy reaches users: "Verify your role and that the gateway route is registered" (page.tsx) and "Read-only view loaded from the municipal service API" (RecordDetailPanel.tsx).
- **Verified evidence:** apps/web/src/app/(app)/municipal/[serviceKey]/applications/[id]/page.tsx:122 'Verify your role and that the gateway route is registered.' and RecordDetailPanel.tsx:198-199 'Read-only view loaded from the municipal service API.' Developer wording. Also the error branch does not use RefreshErrorState (no retry).
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/applications/[id]/page.tsx`, `apps/web/src/app/(app)/municipal/_components/RecordDetailPanel.tsx`
- **Fix steps:**
  1. Replace error branch with <RefreshErrorState error={toHumanError('load',{area:'this record'})} backHref=... />; use status 403 (loader status) for a permission message.
  2. Delete 'municipal service API' sentence.
- **Acceptance:**
  - Error render has Retry and no 'gateway' text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-03

### GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-05  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "Citizen track" links to the service landing page, not to the citizen's own application status (citizenServiceHref, index.ts); there is no not-found for a valid key with a bad id beyond the EmptyState, and no loading.tsx.
- **Verified evidence:** [id]/page.tsx:141 links to `/citizen/services/${config.citizenServiceKey}` (service landing), bypassing citizenServiceHref helper; CitizenServiceLinks.tsx:283 itself says 'track via service page', so intended. No loading.tsx under municipal/ confirmed. 'no not-found' is partly wrong: the page shows EmptyState 'Record not found' (:119) but fetchMunicipalDetail returns only source api|error, so it cannot distinguish 404, and no HTTP 404 is set. Whether a per-application citizen track route exists cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/municipal/[serviceKey]/applications/[id]/loading.tsx`, `apps/web/src/app/(app)/municipal/_data/municipalApi.ts`, `apps/web/src/app/(app)/municipal/[serviceKey]/applications/[id]/page.tsx`
- **Fix steps:**
  1. Add loading.tsx with skeleton header + details card.
  2. Pass through LoaderResult.status in fetchMunicipalDetail; call notFound() on 404, show RefreshErrorState otherwise.
  3. Use citizenServiceHref(); rename button 'Citizen service page' unless a status-tracking route is confirmed.
- **Acceptance:**
  - Bad id returns 404 page; 500 shows retry.
  - Loading state visible on slow API.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-03
