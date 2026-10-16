# Detailed gap file — module `telephony`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 27, BACKEND-VERIFY 6



---
## /telephony  —  `telephony/home.html`

- **Source:** `apps/web/src/app/(app)/telephony/page.tsx`
- **Design reference:** `redesign/telephony/home.html`

### GAP-TELEPHONY-HOME-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Telephony has no entry in the sidebar (ds/Sidebar.tsx lists no /telephony item; only navRouteManifest.ts:122 and GlobalSearch.tsx:76 know the route), so a call-centre agent can reach the module only via search or a typed URL. This kit has no Telephony NAV id: data-active is set to 'helpdesk', the nearest Citizen-services parent.
- **Verified evidence:** ds/Sidebar.tsx has no /telephony item (Citizen Services group lists helpdesk, catalogue, citizen, designer at :91-97); '/telephony' appears only in navRouteManifest.ts:122 and GlobalSearch.tsx:76. The 'data-active helpdesk' remark concerns the redesign kit HTML and is cannot-verify here.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`, `apps/web/src/app/_components/navRouteManifest.ts`
- **Fix steps:**
  1. Add a Telephony item (Phone icon, href /telephony, moduleKey 'telephony') to the Citizen Services group in Sidebar.tsx.
  2. Confirm moduleKey matches moduleVisibility keys / ModuleGate in telephony/layout.tsx.
  3. Update the manifest test/snapshot if any.
- **Acceptance:**
  - Manual: user with telephony enabled sees Telephony in sidebar and it highlights on /telephony/*.
  - Manual: module disabled -> item hidden.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TELEPHONY-HOME-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was UUID)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Fourth tile 'Call Log (legacy)' ships in production navigation and duplicates 'Call Log' (page.tsx:12); the legacy view is the generic ModuleListPage with raw IDs.
- **Verified evidence:** telephony/page.tsx:12 does list 'Call Log (legacy)' -> /telephony/list, which is the generic ModuleListPage. It is a duplicate tile, but the raw-ID issue is in ModuleListTable (id.slice(0,8)); theme UUID is secondary.
- **Files to change:** `apps/web/src/app/(app)/telephony/page.tsx`
- **Fix steps:**
  1. Remove the legacy link from the hub links array.
  2. Replace /telephony/list page with redirect('/telephony/calls') (see LIST-05).
- **Acceptance:**
  - Manual: hub shows three tiles.
  - Manual: /telephony/list redirects.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Bookmarks to /telephony/list need the redirect.
- **Depends on:** GAP-TELEPHONY-LIST-05

### GAP-TELEPHONY-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** No live-status or SLA summary on the hub although the module is described as a live call centre; agents must open Call Log to see whether anything is queued.
- **Verified evidence:** Hub is a static ModuleHub with four links and no data (page.tsx:4-16); no queued/ringing/SLA summary. The data exists via /v1/telephony/calls (calls/page.tsx computes live and slaMet).
- **Files to change:** `apps/web/src/app/(app)/telephony/page.tsx`, `apps/web/src/app/(app)/telephony/calls/page.tsx`
- **Fix steps:**
  1. Extract call summary calc (live, abandoned, slaMet) into a shared hook/helper.
  2. Make the hub a client component (or child of ModuleHub) showing StatGrid of live, abandoned, SLA% with error/loading states.
  3. Reuse RefreshErrorState on failure.
- **Acceptance:**
  - Manual: hub shows queued count matching Call Log.
  - Test: API failure shows error, not zeros.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Avoid showing 0 on failure.
- **Depends on:** RefreshErrorState

### GAP-TELEPHONY-HOME-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** All four tiles use the generic folder glyph: none of their titles appear in the TILE_ICONS map (LinkTiles.tsx:52-61).
- **Verified evidence:** LinkTiles.tileIcon (LinkTiles.tsx:52-61) looks up TILE_ICONS[title] then href substrings; 'Call Log', 'Agent Queue', 'Dispositions', 'Call Log (legacy)' are not keys and hrefs match none, so all get the folder glyph.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add 'Call Log': '📞', 'Agent Queue': '🎧', 'Dispositions': '🗂' to TILE_ICONS.
- **Acceptance:**
  - Manual: telephony hub tiles show distinct icons.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /telephony/agents  —  `telephony/agents.html`

- **Source:** `apps/web/src/app/(app)/telephony/agents/page.tsx`
- **Design reference:** `redesign/telephony/agents.html`

### GAP-TELEPHONY-AGENTS-01  ·  HIGH  ·  confirmed  ·  theme LOADING (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Load/failed states are misreported: useOfflineResource initialises source to "cache" (resource.ts:66), so cacheNote is truthy at first paint and the 'Loading …' fallback (agents/page.tsx:71) never shows; if the first fetch fails with no cache the page says 'Showing saved data.' over an empty table (agents/page.tsx:59-62, resource.ts:115-120). The hook's error value is not destructured.
- **Verified evidence:** resource.ts:66 useState<ResourceSource>('cache'); agents/page.tsx:59-62 cacheNote is truthy when source==='cache' so it renders from first paint and `cacheNote ?? (loading ? ...)` (line 71) never reaches 'Loading agents...'. On failure with no cache resource.ts:115-120 sets error but source stays 'cache'; page (line 49) does not destructure `error`, so it says 'Showing saved data.' over an empty table with KPIs 0.
- **Files to change:** `apps/web/src/app/(app)/telephony/agents/page.tsx`, `apps/web/src/lib/sync/resource.ts`
- **Fix steps:**
  1. In agents/page.tsx destructure `error, refresh, loading, source, cachedAt` from useOfflineResource.
  2. Compute `showingCache = source==='cache' && cachedAt!==null` (or offline); show 'Showing saved data' only then. Show 'Loading...' while loading && no data.
  3. If `error` (no cache) render RefreshErrorState with onRetry={refresh} and hide the empty table/zero KPIs (show '-').
  4. Long-term fix in resource.ts: initial `source` should be a neutral 'loading' (or null) not 'cache' (line 66) - check other consumers first.
- **Acceptance:**
  - Test (mock fetch pending): 'Loading agents...' visible, no 'saved data'.
  - Test (mock fetch 500, empty cache): error state with Retry, no 'saved data' text.
  - Test (cache hit + offline): 'Showing saved data from <date>'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low-medium; changes shared hook only if resource.ts default is touched - other screens depend on it.
- **Depends on:** GAP-TELEPHONY-CALLS-01, RefreshErrorState

### GAP-TELEPHONY-AGENTS-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Presence colours are wrong: PRESENCE maps to 'good'/'warn'/'mut' (agents/page.tsx:22-27) but StatusPill looks the value up in a table of status words (ds/StatusPill.tsx:5-42) that has no such keys, so available, busy and offline all render as neutral 'info'; only wrap_up ('review') gets the warn colour by coincidence. The one signal this board exists for is unreadable.
- **Verified evidence:** agents/page.tsx:22-27 PRESENCE values 'good','warn','review','mut'; StatusPill.tsx:5-42 STATUS_MAP has no keys 'good','warn','mut' (variants, not statuses), so lookups fall to 'info' (line ~58). 'review' is a key (warn). So available/busy/offline all render info; wrap_up warn.
- **Files to change:** `apps/web/src/app/(app)/telephony/agents/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add an optional `variant?: PillVariant` prop to StatusPill (export the type) that bypasses STATUS_MAP.
  2. In agents/page.tsx pass `variant` (available->good, busy->warn, wrap_up->warn, offline->mut) with label from status.
  3. Alternatively add keys available/busy/wrap_up/offline to STATUS_MAP; prefer variant prop as these words are ambiguous elsewhere.
- **Acceptance:**
  - Component test: available renders good class, offline renders mut class, busy warn.
  - Manual/contrast check in light and dark.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TELEPHONY-AGENTS-03  ·  MEDIUM  ·  confirmed  ·  theme LIVE (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises 'Live' presence but the hook fetches once on mount and on online/sync events only (resource.ts:134-150); there is no polling or push, so routing decisions may use minutes-old presence with no 'as of' timestamp.
- **Verified evidence:** Subtitle 'Live agent presence' (agents/page.tsx:69) but resource.ts:74-152 fetches on mount and on tick (online/sync message) only; no interval or SSE, no 'as of' time on live data (cachedAt is null after live fetch, resource.ts:113).
- **Files to change:** `apps/web/src/app/(app)/telephony/agents/page.tsx`, `apps/web/src/lib/sync/resource.ts`
- **Fix steps:**
  1. Change subtitle to 'Agent presence and queue assignment' or add polling.
  2. If live is needed: add `pollMs` option to useOfflineResource (setInterval bumping tick while document visible) and pass 15000.
  3. Show 'Updated hh:mm' using a lastFetchedAt returned by the hook.
  4. Add a Refresh button calling refresh().
- **Acceptance:**
  - Test with fake timers: two fetches after pollMs.
  - Manual: presence changes in service appear within interval.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; polling load on telephony-service; a push channel is the alternative (decision).
- **Depends on:** GAP-TELEPHONY-AGENTS-01

### GAP-TELEPHONY-AGENTS-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Queue column shows queueId.slice(0,8) — a truncated UUID, not a queue name (agents/page.tsx:45); userId is fetched but not shown.
- **Verified evidence:** agents/page.tsx:45 renders r.queueId.slice(0,8) or 'Unassigned'. AgentRow carries userId (line 15) but no queue name; no queues endpoint or page is visible in the snapshot (telephony has agents, calls, dispositions, list only).
- **Files to change:** `apps/web/src/app/(app)/telephony/agents/page.tsx`
- **Fix steps:**
  1. Ask backend whether /v1/telephony/agents can embed queueName, or a /v1/telephony/queues lookup exists.
  2. Render queueName; fallback 'Unknown queue' (never an id slice).
  3. Add queueName to AgentRow.
- **Acceptance:**
  - Unit: row with queueName shows name; without shows 'Unknown queue'.
  - Manual: no hex shown.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TELEPHONY-AGENTS-05  ·  MEDIUM  ·  partly  ·  theme FEATURE (was ROLEGATE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Read-only board: no way to change presence, reassign a queue or open the agent's current call; no role check separates a supervisor from a line agent (ModuleGate only, layout.tsx:5).
- **Verified evidence:** Page is read-only (agents/page.tsx:82, no actions) and telephony/layout.tsx:5-7 only wraps ModuleGate, so no supervisor/agent distinction - true as observed. Whether the API exposes presence/reassign endpoints or role claims for it cannot be verified (telephony-service absent), so it is a missing feature/decision, not a defect in existing code.
- **Files to change:** `apps/web/src/app/(app)/telephony/agents/page.tsx`
- **Fix steps:**
  1. Decide with product if supervisors need presence override / reassignment.
  2. If yes: add role-gated controls via the shared permission hook and ConfirmDialog; server must enforce and emit audit events.
  3. If no: document as read-only.
- **Acceptance:**
  - Manual: line agent sees no controls; supervisor sees them (once built).
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Medium; presence overrides affect call routing and need audit events.

### GAP-TELEPHONY-AGENTS-06  ·  LOW  ·  confirmed  ·  theme STYLE (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Breadcrumb is a plain <nav class='back'> with an <a href='/telephony'> full-page link and lucide icon rather than AutoBreadcrumb / next/link (agents/page.tsx:66-68). Status-line colour #92400e is hard-coded (agents/page.tsx:70).
- **Verified evidence:** agents/page.tsx:66-68 custom <nav class='back'> with lucide ArrowLeft and plain <a href='/telephony'> (full reload, not next/link); :70 hard-coded color #92400e. AutoBreadcrumb.tsx exists in app/_components; PageHeader accepts `back` (used in inventory/[id]/page.tsx).
- **Files to change:** `apps/web/src/app/(app)/telephony/agents/page.tsx`
- **Fix steps:**
  1. Replace the nav with PageHeader back='/telephony' (or AutoBreadcrumb).
  2. Replace #92400e with the design token used for warn text (e.g. var(--warn-fg)) or a shared <StatusLine/>.
- **Acceptance:**
  - Manual: back navigation is client-side, no reload.
  - grep: no hard-coded hex in file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /telephony/calls  —  `telephony/calls.html`

- **Source:** `apps/web/src/app/(app)/telephony/calls/page.tsx`
- **Design reference:** `redesign/telephony/calls.html`

### GAP-TELEPHONY-CALLS-01  ·  HIGH  ·  confirmed  ·  theme LOADING (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Load/failed states are misreported: useOfflineResource initialises source to "cache" (resource.ts:66), so cacheNote is truthy at first paint and the 'Loading …' fallback (calls/page.tsx:111) never shows; if the first fetch fails with no cache the page says 'Showing saved data.' over an empty table (calls/page.tsx:99-102, resource.ts:115-120). The hook's error value is not destructured.
- **Verified evidence:** Same defect as AGENTS-01: calls/page.tsx:86 (hook, error not destructured), :99-102 cacheNote truthy from initial source='cache' (resource.ts:66), :110-111 'Loading calls...' unreachable; on failed first fetch with no cache resource.ts:115-120 leaves 'Showing saved data.' over empty table and 0 KPIs / 100% SLA.
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`, `apps/web/src/lib/sync/resource.ts`
- **Fix steps:**
  1. In calls/page.tsx destructure `error, refresh, loading, source, cachedAt` from useOfflineResource.
  2. Compute `showingCache = source==='cache' && cachedAt!==null` (or offline); show 'Showing saved data' only then. Show 'Loading...' while loading && no data.
  3. If `error` (no cache) render RefreshErrorState with onRetry={refresh} and hide the empty table/zero KPIs (show '-').
  4. Long-term fix in resource.ts: initial `source` should be a neutral 'loading' (or null) not 'cache' (line 66) - check other consumers first.
- **Acceptance:**
  - Test pending fetch shows 'Loading calls...'.
  - Test 500 with empty cache shows error+Retry and '-' KPIs.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-TELEPHONY-AGENTS-01, RefreshErrorState

### GAP-TELEPHONY-CALLS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** SLA Answered defaults to 100% when no call has an SLA result (calls/page.tsx:97): an empty or unscored log reads as a perfect score.
- **Verified evidence:** calls/page.tsx:95-97 slaPct = slaScored>0 ? round(met/scored*100) : 100; also shows 100% while loading/error since calls is [].
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`
- **Fix steps:**
  1. Return null when slaScored===0 and render '-' in the StatCard.
  2. Show '-' also when loading or errored.
  3. Show 'n scored' as hint.
- **Acceptance:**
  - Unit: no scored calls -> '-'; 3 of 4 met -> 75%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; SLA reporting misstatement in a govt helpdesk context.
- **Depends on:** GAP-TELEPHONY-CALLS-01

### GAP-TELEPHONY-CALLS-03  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pills mostly render neutral: 'queued', 'ringing', 'answered' and 'abandoned' are not keys in StatusPill's map (ds/StatusPill.tsx:5-42), so an abandoned call is the same blue as a ringing one; only 'completed' is green (calls/page.tsx:64).
- **Verified evidence:** StatusPill STATUS_MAP (StatusPill.tsx:5-42) lacks queued, ringing, answered -> info; completed -> good (confirmed). 'abandoned' is not shown as a status in code; the page treats it as a boolean `abandoned` (calls/page.tsx:31,94) and no evidence a status value 'abandoned' exists. Direction pill uses 'info'/'review' (line 61) fine.
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add optional `variant` prop to StatusPill (shared with AGENTS-02).
  2. Map call status: queued/ringing -> warn, answered -> good, completed -> good, abandoned/missed/failed -> bad; also pass bad when r.abandoned.
  3. Verify status enum with telephony API types.
- **Acceptance:**
  - Component test per status variant.
  - Manual: abandoned call visibly red.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TELEPHONY-AGENTS-02

### GAP-TELEPHONY-CALLS-04  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: caller numbers are shown with the last four digits to every telephony user (calls/page.tsx:37-43, 63); no role gate or reveal-with-audit for the full number, and the callee number, agent, recording flag and linkedRefId are fetched but never shown — the 'Linked' column names a type but cannot open the ticket.
- **Verified evidence:** maskPhone (calls/page.tsx:37-43) masks all but last 4 digits, used at :63; comment (lines 5-7) says API also masks - so masking exists and is deliberate, but there is no role-gated reveal with audit. calleeNumber, agentId, hasRecording, linkedRefId are typed (17-30) but no column renders them; 'Linked' (line 78-82) prints only the type, no link. Whether last-4 exposure satisfies DPDP is a policy decision; no shared <Masked> component exists (grep finds only integration secret strings).
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`, `apps/web/src/app/_components/Masked.tsx`
- **Fix steps:**
  1. Decide policy: last-4 acceptable for all, reveal for supervisors only.
  2. If reveal needed: create <Masked value onReveal> calling a backend reveal endpoint that writes an audit event; gate with role check.
  3. Add Agent, Recording (icon) columns and make Linked a link to the ticket route once the route mapping for linkedRefType is known.
- **Acceptance:**
  - Test: default render shows masked; reveal absent for non-supervisor.
  - Manual: audit event created on reveal (backend).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** High (PII/DPDP): reveal must be server-audited; do not fetch full numbers to client by default.

### GAP-TELEPHONY-CALLS-05  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Counts (Total, Answered, Abandoned, SLA %) are computed client-side over whatever list the API returns, with no date range, queue filter or pagination parameter in the request (calls/page.tsx:86-97); the numbers are not 'today' or 'this month'.
- **Verified evidence:** calls/page.tsx:86-90 requests /v1/telephony/calls with no params; stats at :92-97 are client-side counts over the returned list (label 'Total Calls' not scoped). The API's default window/cap is unverifiable (service absent).
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`, `apps/web/src/lib/sync/resource.ts`
- **Fix steps:**
  1. Add date-range (Today/7d/30d) and queue filter controls; pass as query in the hook path (include in cacheKey).
  2. Use server summary counts if available.
  3. Label KPIs with the selected range; add pagination (cursor) to DataTable.
- **Acceptance:**
  - Test: changing range refetches with `from`/`to` query and new cacheKey.
  - Manual: totals match server for range.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; needs backend query params.
- **Depends on:** GAP-TELEPHONY-CALLS-01

### GAP-TELEPHONY-CALLS-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Wait/Talk print raw seconds ('184s'), not mm:ss (calls/page.tsx:53-55); 'abandoned' calls have neither.
- **Verified evidence:** calls/page.tsx:53-55 secs() returns `${v}s` (e.g. '184s'); null -> '-' so abandoned calls (null wait/talk from API, assumed) show '-'. No duration formatter exists in lib/formatters.ts.
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDuration(seconds) -> 'm:ss' / 'h:mm:ss' to lib/formatters.ts.
  2. Use it in secs(); for abandoned calls show wait time if provided.
  3. Keep tabular-nums alignment.
- **Acceptance:**
  - Unit: 184 -> '3:04'; 0 -> '0:00'; null -> '-'; 3670 -> '1:01:10'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TELEPHONY-CALLS-07  ·  LOW  ·  confirmed  ·  theme STYLE (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Five StatCards in a four-column StatGrid; hard-coded #92400e status colour and plain <a href='/telephony'> breadcrumb (calls/page.tsx:106-108, 111).
- **Verified evidence:** calls/page.tsx:114-120 renders five StatCards inside StatGrid, which is `grid g-4` (ds/StatGrid.tsx:5), so the fifth wraps onto its own row; :106-108 plain <a href='/telephony'> with lucide icon; :110 color #92400e.
- **Files to change:** `apps/web/src/app/(app)/telephony/calls/page.tsx`, `apps/web/src/app/_components/ds/StatGrid.tsx`
- **Fix steps:**
  1. Drop or merge one card (e.g. fold Live into Total hint) to make four, or add a `cols` prop to StatGrid (g-5).
  2. Use PageHeader back / AutoBreadcrumb with next/link.
  3. Replace #92400e with a token.
- **Acceptance:**
  - Visual check at desktop and mobile widths: no orphan card.
  - grep: no hard-coded hex.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TELEPHONY-AGENTS-06


---
## /telephony/dispositions  —  `telephony/dispositions.html`

- **Source:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`
- **Design reference:** `redesign/telephony/dispositions.html`

### GAP-TELEPHONY-DISPOSITIONS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Load/failed states are misreported: useOfflineResource initialises source to "cache" (resource.ts:66), so cacheNote is truthy at first paint and the 'Loading …' fallback (dispositions/page.tsx:84) never shows; if the first fetch fails with no cache the page says 'Showing saved data.' over an empty table (dispositions/page.tsx:72-75, resource.ts:115-120). The hook's error value is not destructured.
- **Verified evidence:** resource.ts:66 useState<ResourceSource>('cache'); dispositions/page.tsx:71-75 cacheNote is truthy when source==='cache', so the '{cacheNote ?? (loading ? ...)}' at :84 never reaches 'Loading'. On first fetch failure with no cache the hook sets error (resource.ts:115-120) but source stays 'cache', so 'Showing saved data.' shows over an empty table. page.tsx:62 does not destructure error.
- **Files to change:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`, `apps/web/src/lib/sync/resource.ts`, `apps/web/src/app/(app)/telephony/calls/page.tsx`
- **Fix steps:**
  1. Destructure error (and revalidating) from useOfflineResource in dispositions/page.tsx.
  2. Show cacheNote only when cachedAt is set (a real cache hit) or offline, not merely source==='cache'.
  3. Show 'Loading dispositions…' while loading && !cachedAt.
  4. When error && no rows render an error state with retry (create shared RefreshErrorState; hook exposes a tick-based refresh if present, else add refresh() to OfflineResource).
  5. Apply same fix to calls/page.tsx and agents page which share the pattern; consider making initial source null/'none' in resource.ts.
- **Acceptance:**
  - Component test: mock fetch pending -> 'Loading dispositions…' visible, no 'saved data'.
  - Mock fetch 500 with empty cache -> error state with Retry, no 'Showing saved data'.
  - Mock cache hit + fetch fail -> 'Showing saved data from <time>'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared hook change affects every useOfflineResource screen; run their tests.
- **Depends on:** RefreshErrorState

### GAP-TELEPHONY-DISPOSITIONS-02  ·  MEDIUM  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says 'share of resolved calls' but the denominator is every completed call that has a disposition (dispositions/page.tsx:35-38, 82); 'Resolved' is also a row in the same table, so the copy is circular.
- **Verified evidence:** PageHeader subtitle at page.tsx:81 says 'share of resolved calls'. aggregate() (:33-43) divides by completed calls with a disposition, not by resolved calls; 'Resolved' is itself a disposition row. Copy is wrong, line refs slightly off (subtitle is :81).
- **Files to change:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`
- **Fix steps:**
  1. Change subtitle to 'Completed-call wrap-up codes and their share of completed calls with a wrap-up code.'
  2. Keep denominator logic (or extend per -03).
- **Acceptance:**
  - Manual: subtitle no longer says 'resolved calls'.
  - Unit: shares computed over completed-with-disposition total.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-TELEPHONY-DISPOSITIONS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Totals disagree with the Call Log: 'Completed' counts only completed calls that carry a disposition (dispositions/page.tsx:35), while Call Log 'Answered' counts answered + completed (calls/page.tsx:92); completed calls with no wrap-up code vanish silently instead of appearing as 'No disposition'.
- **Verified evidence:** dispositions/page.tsx:35 filters status==='completed' && disposition; calls/page.tsx:92 'answered' counts answered||completed. Completed calls with null disposition are dropped, so totals differ from Call Log and gaps are invisible.
- **Files to change:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`
- **Fix steps:**
  1. In aggregate(), bucket completed calls with null disposition under a 'No disposition' row (key '__none').
  2. Add a 'Completed' StatCard total that counts all completed calls, and show 'No disposition' count.
  3. Label the card 'Completed (with wrap-up)' or align to Call Log wording.
- **Acceptance:**
  - Unit: 3 completed (1 null disposition) -> rows include 'No disposition' count 1; total 3.
  - Manual: Completed figure reconciles with Call Log completed count.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; reporting accuracy.
- **Depends on:** GAP-TELEPHONY-DISPOSITIONS-02

### GAP-TELEPHONY-DISPOSITIONS-04  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Aggregation is client-side over the full call list (same request as Call Log, no date or queue filter, dispositions/page.tsx:61-66); percentages describe an unspecified window and may not sum to 100 because of per-row rounding (dispositions/page.tsx:41).
- **Verified evidence:** Page calls the same '/v1/telephony/calls' as Call Log with no params (page.tsx:63-66) and aggregates in aggregate(); no date/queue filter. Rounding per row (:41 Math.round) can make shares not sum to 100. Whether the API caps/paginates the list is cannot-verify (telephony-service absent from web snapshot).
- **Files to change:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`, `apps/web/src/lib/sync/resource.ts`
- **Fix steps:**
  1. Add date-range (and queue) filter controls and pass them as query params in the path.
  2. Show the active window in the subtitle.
  3. If backend offers a grouped endpoint, use it; otherwise state 'based on latest N calls'.
  4. Use largest-remainder rounding or show one decimal so shares sum to 100.
- **Acceptance:**
  - Manual: choosing a range changes request query and counts.
  - Unit: shares from [1,1,1] sum to 100 with the rounding helper.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Aggregating a truncated list misrepresents SLA quality metrics.

### GAP-TELEPHONY-DISPOSITIONS-05  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Only 'resolved' and 'escalated' are hard-coded as headline cards (dispositions/page.tsx:68-69); any other or tenant-defined wrap-up code is visible only in the table. Codes are humanised by replacing '_' only, no title case.
- **Verified evidence:** Cards for 'resolved' and 'escalated' are hard-coded (page.tsx:68-69), other codes appear only in the table; humanised only via replace(/_/g,' ') at :49. Not fabricated data: values derive from the API. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`
- **Fix steps:**
  1. Render top-N dispositions as StatCards dynamically instead of two fixed keys.
  2. Add a shared humaniseCode helper (replace _ and title-case) in lib/labels.ts and use it in the column render.
- **Acceptance:**
  - Unit: humaniseCode('no_answer') === 'No answer'.
  - Manual: a tenant-specific code appears as a card/row with clean label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-TELEPHONY-DISPOSITIONS-06  ·  LOW  ·  partly  ·  theme A11Y (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Table is sortable but not filterable, unlike its siblings; ProgressBar has no role or label of its own (ds/ProgressBar.tsx:6-12), relying on an adjacent sr-only span.
- **Verified evidence:** DataTable is called with sortable but not filterable (page.tsx:104; DataTable supports opt-in filterable, DataTable.tsx:72). ProgressBar (ds/ProgressBar.tsx:6-12) renders a div with no role/aria; page adds an adjacent sr-only span. No PII is shown, so theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/telephony/dispositions/page.tsx`, `apps/web/src/app/_components/ds/ProgressBar.tsx`
- **Fix steps:**
  1. Pass filterable and filterPlaceholder to DataTable.
  2. Add role='progressbar', aria-valuenow/min/max and optional label prop to ProgressBar; drop the duplicate sr-only span.
- **Acceptance:**
  - Component test: ProgressBar exposes role progressbar with aria-valuenow.
  - Manual: typing in filter narrows dispositions.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** ProgressBar is shared; check other usages for duplicate announcements.


---
## /telephony/list  —  `telephony/list.html`

- **Source:** `apps/web/src/app/(app)/telephony/list/page.tsx`
- **Design reference:** `redesign/telephony/list.html`

### GAP-TELEPHONY-LIST-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** The generic mapper requires a name/title/subject/label/code/contractNo/fileNo on each row and skips the rest (loaders.ts:1661-1671, 1821); the call payload used by /telephony/calls has none of those fields (calls/page.tsx:21-38), so this page shows 'No records' even when the call log is full.
- **Verified evidence:** getTelephonyCalls = moduleLoader -> mapModuleRows (loaders.ts:1701, 1821). mapModuleRows (~:1661-1671) drops rows without id AND one of name/title/subject/label/code/contractNo/fileNo. Call rows (calls/page.tsx:21-38) carry none of these, so every row is skipped and an empty list is returned as a successful 'No records'. Theme should be WIRING not I18N.
- **Files to change:** `apps/web/src/app/(app)/telephony/list/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Best: replace page with redirect to /telephony/calls (see LIST-05).
  2. Alternatively write a dedicated mapTelephonyCalls loader labelling rows by direction + masked number + status.
- **Acceptance:**
  - Test: mapModuleRows on a call payload currently returns [] (regression proof); after fix page redirects or lists calls.
  - Manual: with calls present, /telephony/list no longer says No records.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TELEPHONY-LIST-05

### GAP-TELEPHONY-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic ID/Name/Detail/Status/Meta columns say nothing about a call; ID is the first 8 characters of a UUID (ModuleListTable.tsx:50) — a raw id shown to users.
- **Verified evidence:** ModuleListTable.tsx:50 renders row.id.slice(0,8) in a mono span and headers are generic ID/Name/Detail/Status/Meta (:37-46).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/telephony/list/page.tsx`
- **Fix steps:**
  1. Preferred: remove page (LIST-05).
  2. For the shared table: hide ID column by default or accept a columns prop; show label instead of id.
- **Acceptance:**
  - Manual: no truncated UUID visible.
  - Snapshot test of ModuleListTable with optional idColumn=false.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** ModuleListTable is used by many modules; add opt-out prop, do not change defaults blindly.
- **Depends on:** GAP-TELEPHONY-LIST-05

### GAP-TELEPHONY-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Title 'Telephony — Call' and description 'loaded from the Telephony service API' expose implementation wording (list/page.tsx:8-9); DataSourceBadge's own header says user copy must avoid 'API' wording (DataSourceBadge.tsx:55-61).
- **Verified evidence:** list/page.tsx:8-9 title 'Telephony — Call', description 'Read-only list loaded from the Telephony service API.' DataSourceBadge.tsx:55-61 states the no-'API' wording rule. Strings are hard-coded English.
- **Files to change:** `apps/web/src/app/(app)/telephony/list/page.tsx`
- **Fix steps:**
  1. Remove page via redirect; otherwise retitle 'Call log' and description 'Read-only list of calls.' via next-intl.
- **Acceptance:**
  - Manual: no 'API' or 'service' wording.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-TELEPHONY-LIST-05

### GAP-TELEPHONY-LIST-05  ·  LOW  ·  confirmed  ·  theme OTHER (was VALIDATION)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Duplicate of Call Log listed as 'Call Log (legacy)' in production navigation (telephony/page.tsx:12); candidate for removal or redirect to /telephony/calls.
- **Verified evidence:** telephony/page.tsx:12 links 'Call Log (legacy)' to /telephony/list, which duplicates /telephony/calls and renders empty (LIST-01). Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/telephony/list/page.tsx`, `apps/web/src/app/(app)/telephony/page.tsx`
- **Fix steps:**
  1. Replace list/page.tsx with redirect('/telephony/calls') from next/navigation.
  2. Delete the legacy tile from the hub links.
  3. Remove /telephony/list from navRouteManifest/search if present.
- **Acceptance:**
  - Manual: /telephony/list lands on /telephony/calls.
  - Hub no longer shows legacy tile.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-TELEPHONY-HOME-05  ·  LOW  ·  verified  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by gap-backend-verify.test.ts — telephony-service callRoutes/agentRoutes both invoke requireRole(ctx, TELEPHONY_ROLES); tested in services/telephony-service/tests/gap-backend-verify.test.ts)
- **First-pass claim:** No telephony-service exists in the services/ snapshot (only hrms-service); routes behind /v1/telephony/* cannot be verified — undeterminable.
- **Service:** `telephony-service`  ·  **Endpoint(s):** `['GET /v1/telephony/*']`
- **Question:** Do the routes behind the telephony hub exist and enforce a telephony role and tenant scope?
- **How to verify:** Open telephony-service route registration; call each hub endpoint with an unauthorised role expecting 403.
- **Test to add:** Given user without telephony role; when GET /v1/telephony/calls; then 403.
- **Impact if wrong:** Call data exposed to unauthorised staff.
- **Web change if wrong:** none unless gate missing; then add ModuleGate/role check on the hub.

### GAP-TELEPHONY-AGENTS-07  ·  LOW  ·  verified  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by gap-backend-verify.test.ts — agentViewSchema (validators.ts) includes all AgentRow fields incl. queueName; sendValidated enforces schema on every response; RLS tenant isolation tested in gap-backend-verify.test.ts GAP-TELEPHONY-AGENTS-07 suite)
- **First-pass claim:** telephony-service is absent from the services/ snapshot; the /v1/telephony/agents contract cannot be verified — undeterminable.
- **Service:** `telephony-service`  ·  **Endpoint(s):** `['GET /v1/telephony/agents']`
- **Question:** Does the agents endpoint return {data:[{...}]} with the fields AgentRow expects, tenant-scoped and role-guarded?
- **How to verify:** Open telephony-service agents route and DTO; curl with a token and diff against AgentRow in agents/page.tsx.
- **Test to add:** Given tenant with 2 agents; when GET agents; then data length 2 with all AgentRow fields; other tenant's agents absent.
- **Impact if wrong:** Wrong or missing agent data; cross-tenant leak.
- **Web change if wrong:** Adjust toAgents mapper/AgentRow if fields differ.

### GAP-TELEPHONY-CALLS-08  ·  LOW  ·  verified  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by gap-backend-verify.test.ts — CALL_STATUSES = queued|ringing|answered|completed|missed|abandoned (transitions.ts). SLA: server computes slaAnswered boolean via toSummary() using waitSeconds <= threshold (default 20 s, or queue-specific slaAnswerSeconds). callSummarySchema verified in gap-backend-verify.test.ts GAP-TELEPHONY-CALLS-08 suite)
- **First-pass claim:** telephony-service is absent from the services/ snapshot; call lifecycle statuses and SLA definition cannot be verified — undeterminable.
- **Service:** `telephony-service`  ·  **Endpoint(s):** `['GET /v1/telephony/calls']`
- **Question:** What are the call lifecycle status values and how is SLA computed (threshold, field)?
- **How to verify:** Open telephony-service call status enum and any SLA config; compare with calls/page.tsx status and SLA logic.
- **Test to add:** Given calls in each status and a call breaching threshold; when GET calls; then status values match the enum and sla flag equals server rule.
- **Impact if wrong:** Wrong SLA reporting to supervisors.
- **Web change if wrong:** Align status map and SLA calc in calls/page.tsx to the enum; prefer server-provided sla flag.

### GAP-TELEPHONY-DISPOSITIONS-07  ·  LOW  ·  verified  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by gap-backend-verify.test.ts — DISPOSITIONS enum (transitions.ts): resolved, callback_scheduled, escalated, transferred, information_provided, wrong_number, voicemail, no_resolution. Finished-call status is exactly "completed" (CALL_STATUSES). callSummarySchema accepts disposition as nullable string. Tested in gap-backend-verify.test.ts GAP-TELEPHONY-DISPOSITIONS-07 suite)
- **First-pass claim:** telephony-service is absent from the services/ snapshot; the set of disposition codes and the 'completed' status value cannot be verified — undeterminable.
- **Service:** `telephony-service`  ·  **Endpoint(s):** `['GET /v1/telephony/calls']`
- **Question:** What disposition codes exist and is the finished-call status literally 'completed'?
- **How to verify:** Open telephony-service disposition enum and call status enum.
- **Test to add:** Given calls with each disposition; when GET calls; then dispositions belong to the enum and completed calls have status 'completed'.
- **Impact if wrong:** Disposition report counts wrong or empty.
- **Web change if wrong:** Update the filter/grouping in dispositions/page.tsx to the real enum values.

### GAP-TELEPHONY-LIST-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Reads /api/v1/telephony/calls server-side (loaders.ts:1821) while the new Call Log reads /api/proxy/v1/telephony/calls client-side (resource.ts:103); two gateway paths for one resource — which is authoritative is undeterminable.
- **Service:** `telephony-service`  ·  **Endpoint(s):** `['GET /api/v1/telephony/calls (server, loaders.ts:1821)', 'GET /api/proxy/v1/telephony/calls (client, resource.ts:103)']`
- **Question:** Do both gateway paths reach the same telephony-service /v1/telephony/calls route with identical auth and shape?
- **How to verify:** Check the gateway route table and telephony-service route; curl both paths with the same token and diff responses.
- **Test to add:** Given same token; when GET both paths; then identical JSON body and same 403 behaviour for unauthorised users.
- **Impact if wrong:** Inconsistent call lists between pages.
- **Web change if wrong:** Standardise both on one path in loaders.ts:1821 or resource.ts:103.

### GAP-TELEPHONY-LIST-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** telephony-service is absent from the services/ snapshot; the list endpoint's row fields cannot be verified — undeterminable.
- **Service:** `telephony-service`  ·  **Endpoint(s):** `['GET /api/v1/telephony/calls']`
- **Question:** Does each row contain the fields the list renders (id, direction, agent, status, duration, timestamp)?
- **How to verify:** Open telephony-service call DTO; run web ModuleList mapper against a live response.
- **Test to add:** Given a call; when GET calls; then row has all mapper fields non-null-or-documented.
- **Impact if wrong:** Blank columns in the list.
- **Web change if wrong:** Adjust mapper in telephony list/page.tsx to actual field names.
