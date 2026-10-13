# Detailed gap file — module `journeys`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 12, BACKEND-VERIFY 4



---
## /journeys  —  `journeys/home.html`

- **Source:** `apps/web/src/app/(app)/journeys/page.tsx`
- **Design reference:** `redesign/journeys/home.html`

### GAP-JOURNEYS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles promise more than the sub-pages deliver: "Design and activate" (Builder) and "drop-off analysis, and conversions" (Analytics) both land on the same generic ID/Name/Detail/Status/Meta list (builder/page.tsx, analytics/page.tsx, ModuleListTable.tsx).
- **Verified evidence:** journeys/page.tsx:6,9 tile copy 'Design and activate multi-step customer journeys' and 'drop-off analysis, and conversions' link to builder and analytics pages, which are the same generic ModuleListTable lists (builder/page.tsx, analytics/page.tsx; analytics reuses the executions endpoint, _data.ts:91).
- **Files to change:** `apps/web/src/app/(app)/journeys/page.tsx`
- **Fix steps:**
  1. Reword the Builder and Analytics tiles to what exists ('Journey definitions', 'Execution outcomes') until real features ship.
  2. Track real features in GAP-JOURNEYS-BUILDER-01 / ANALYTICS-01.
- **Acceptance:**
  - Tile text matches destination page content.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-JOURNEYS-BUILDER-01, GAP-JOURNEYS-ANALYTICS-01

### GAP-JOURNEYS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile counts/status absent — nothing on the hub says how many journeys are running (page.tsx:6-11).
- **Verified evidence:** journeys/page.tsx:12-18 is a synchronous component with static NavTile array (l.5-10) and no data fetch; LinkTiles gets no counts. Loaders exist (getJourneyActive etc.) that could supply counts.
- **Files to change:** `apps/web/src/app/(app)/journeys/page.tsx`, `apps/web/src/app/(app)/journeys/_data.ts`
- **Fix steps:**
  1. Make Page async, call getJourneyActive() and getJourneyBuilder() with Promise.all.
  2. Add StatGrid above tiles: journeys defined, running executions (status filter), with '—' when source==='error'.
  3. Optionally pass a badge/count to LinkTiles if it supports it (check NavTile type in @civitasone/types).
- **Acceptance:**
  - Hub shows running count matching Active page row count.
  - Failed fetch shows '—', not 0.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; 'running' definition depends on unverified status values.
- **Depends on:** RefreshErrorState

### GAP-JOURNEYS-HOME-03  ·  LOW  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Module gate key is "journey" while route and nav are "journeys" (layout.tsx:5) — fuzzy substring match in isModuleEnabled makes it work, but a tenant flag named "journeys" versus "journey" is ambiguous.
- **Verified evidence:** layout.tsx:5 uses moduleKey="journey"; Sidebar.tsx:127 also uses moduleKey "journey" for href /journeys, so nav and gate agree. isModuleEnabled (lib/moduleVisibility.ts:44-45) matches by equality or substring either direction, so a tenant flag named 'journeys' or 'journey' both pass (also could false-match unrelated names). Real issue is only the fuzzy matching ambiguity, low impact.
- **Files to change:** `apps/web/src/lib/moduleVisibility.ts`
- **Fix steps:**
  1. Confirm canonical module id in tenant config and document it.
  2. Make isModuleEnabled exact-match with an alias map ({journey:['journeys']}) instead of substring both ways.
  3. Add unit tests for alias behaviour across modules.
- **Acceptance:**
  - Flag 'journeys' and 'journey' enable the module; unrelated names (e.g. 'journal') do not.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium if tightened: tenants relying on substring matches could lose module access; audit all moduleKey values first.

### GAP-JOURNEYS-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx skeleton (four KPI cards + table) does not match the loaded hub (JourneysLoading).
- **Verified evidence:** journeys/loading.tsx renders 4 KPI cards and a h-96 table block with min-h-screen wrapper; the hub (page.tsx) is only a heading plus a four-tile grid, and sub-pages are tables. The single loading.tsx covers all journeys routes. Minor.
- **Files to change:** `apps/web/src/app/(app)/journeys/loading.tsx`
- **Fix steps:**
  1. Add journeys/loading.tsx variant for hub: header + 4 tile placeholders in columns=four grid.
  2. Add loading.tsx under active/analytics/builder/templates with header + table skeleton, or keep table skeleton only in those.
- **Acceptance:**
  - Navigating to /journeys shows tile skeletons, /journeys/active shows table skeleton.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /journeys/active  —  `journeys/active.html`

- **Source:** `apps/web/src/app/(app)/journeys/active/page.tsx`
- **Design reference:** `redesign/journeys/active.html`

### GAP-JOURNEYS-ACTIVE-01  ·  MEDIUM  ·  partly  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Rows are executions with no journey name, enrolled citizen/contact or current step — Name comes from name/title/label/code/type keys (_data.ts:38-46), so a row may read as a bare id; "Monitor running journeys" has no pause/stop control.
- **Verified evidence:** active/page.tsx passes rows from getJourneyActive (/api/v1/journeys/executions, _data.ts:89) through mapRows: label = name/title/label/code/type/entityType/direction else id (_data.ts:42-50), so a row can read as a bare id; no journey name, contact or step field is mapped. The 'no pause/stop control' claim is true: ModuleListTable.tsx has no actions column and no journeys route has mutating UI. Theme I18N is wrong. Execution payload field names cannot be verified (journey-service absent).
- **Files to change:** `apps/web/src/app/(app)/journeys/_data.ts`, `apps/web/src/app/(app)/journeys/active/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm execution schema (journeyId, journeyName, contactId, currentStep, status) with journey-service owner (cannot-verify).
  2. Add a dedicated mapExecutions() in journeys/_data.ts and a typed JourneyExecutionRow in place of guessed keys.
  3. Create ActiveJourneysTable.tsx with columns Journey, Contact, Current step, Status (StatusPill), Started (formatIndianDate).
  4. Add Pause/Stop row actions with ConfirmDialog only if backend endpoints exist; otherwise remove 'Monitor running journeys' promise.
- **Acceptance:**
  - Rows show journey name instead of raw id when name present.
  - No pause control shown unless endpoint is wired.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low for display; medium for pause/stop (state changes, needs audit event).
- **Depends on:** GAP-JOURNEYS-ACTIVE-02

### GAP-JOURNEYS-ACTIVE-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:44) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-53), so columns mean different things per row and status is unstyled plain text (ModuleListTable.tsx:47).
- **Verified evidence:** active/page.tsx renders shared ModuleListPage -> ModuleListTable.tsx: ID is row.id.slice(0,8) in a mono span (l.50), Detail = row.sublabel, Status = row.status raw text with no StatusPill (l.53), Meta = row.meta (l.54). mapRows in journeys/_data.ts:28-77 picks fields from ~10 candidate keys with fallbacks (sublabel falls back to status, so Detail can duplicate Status; meta may be code, currency, timestamp or points), so column meaning varies per row. Timestamps in meta are unformatted ISO.
- **Files to change:** `apps/web/src/app/(app)/journeys/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/journeys/active/page.tsx`
- **Fix steps:**
  1. Replace the generic mapRows for journeys with a typed mapper per endpoint (journeys, executions, triggers) in journeys/_data.ts.
  2. Build a journey-specific table (DataTable from ds) with fixed columns and StatusPill for status; format dates with formatIndianDate.
  3. Keep ModuleListTable for other modules; in it at minimum render status via <StatusPill> and format ISO meta.
  4. Hide the truncated id or turn it into a link once a detail route exists.
- **Acceptance:**
  - Status renders as a pill in all rows.
  - Detail never repeats Status; date columns show dd Mon yyyy.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; shared ModuleListTable change affects other modules, so scope to journeys or gate behind a prop.
- **Depends on:** GAP-JOURNEYS-ACTIVE-01


---
## /journeys/analytics  —  `journeys/analytics.html`

- **Source:** `apps/web/src/app/(app)/journeys/analytics/page.tsx`
- **Design reference:** `redesign/journeys/analytics.html`

### GAP-JOURNEYS-ANALYTICS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Analytics is not analytics: getJourneyAnalytics and getJourneyActive both fetch /api/v1/journeys/executions (_data.ts:83,85) and render the identical table; there is no drop-off, conversion or funnel metric or chart despite the subtitle (analytics/page.tsx:16-19).
- **Verified evidence:** journeys/_data.ts:89 and :91: getJourneyActive and getJourneyAnalytics both call /api/v1/journeys/executions; analytics/page.tsx:14-19 renders the same ModuleListPage with copy 'Execution outcomes for drop-off and conversion analysis.' No chart, funnel, count or conversion computation exists. Whether journey-service exposes an analytics endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/journeys/analytics/page.tsx`, `apps/web/src/app/(app)/journeys/_data.ts`
- **Fix steps:**
  1. Decide (decision): compute funnel client-side from executions (status counts, completed/total) or request a /journeys/analytics endpoint from backend.
  2. Add typed getJourneyAnalytics() with mapper returning {total, running, completed, failed, byStep[]}.
  3. Render StatGrid (total, completion rate) plus a bar chart reusing the CategoryBarChart pattern from knowledge/dashboard with real labels and values.
  4. Show RefreshErrorState when source==="error"; if no metrics are feasible, remove the tile/page and the 'drop-off' copy.
- **Acceptance:**
  - Analytics page shows at least completion counts distinct from Active table.
  - Error source shows retry, not zeros.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Medium; presenting derived rates from a possibly paginated list could mislead.
- **Depends on:** GAP-JOURNEYS-HOME-01

### GAP-JOURNEYS-ANALYTICS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:44) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-53), so columns mean different things per row and status is unstyled plain text (ModuleListTable.tsx:47).
- **Verified evidence:** analytics/page.tsx renders shared ModuleListPage -> ModuleListTable.tsx: ID is row.id.slice(0,8) in a mono span (l.50), Detail = row.sublabel, Status = row.status raw text with no StatusPill (l.53), Meta = row.meta (l.54). mapRows in journeys/_data.ts:28-77 picks fields from ~10 candidate keys with fallbacks (sublabel falls back to status, so Detail can duplicate Status; meta may be code, currency, timestamp or points), so column meaning varies per row. Timestamps in meta are unformatted ISO.
- **Files to change:** `apps/web/src/app/(app)/journeys/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/journeys/analytics/page.tsx`
- **Fix steps:**
  1. Replace the generic mapRows for journeys with a typed mapper per endpoint (journeys, executions, triggers) in journeys/_data.ts.
  2. Build a journey-specific table (DataTable from ds) with fixed columns and StatusPill for status; format dates with formatIndianDate.
  3. Keep ModuleListTable for other modules; in it at minimum render status via <StatusPill> and format ISO meta.
  4. Hide the truncated id or turn it into a link once a detail route exists.
- **Acceptance:**
  - Status renders as a pill in all rows.
  - Detail never repeats Status; date columns show dd Mon yyyy.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; shared ModuleListTable change affects other modules, so scope to journeys or gate behind a prop.
- **Depends on:** GAP-JOURNEYS-ACTIVE-01


---
## /journeys/builder  —  `journeys/builder.html`

- **Source:** `apps/web/src/app/(app)/journeys/builder/page.tsx`
- **Design reference:** `redesign/journeys/builder.html`

### GAP-JOURNEYS-BUILDER-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "Journey Builder — Design and activate multi-step customer journeys" (home tile) is a read-only list: no canvas, no create/edit/activate/pause control exists anywhere in the journeys route tree (builder/page.tsx:8-21).
- **Verified evidence:** builder/page.tsx:8-21 is a read-only ModuleListPage over GET /api/v1/journeys (_data.ts:88). The journeys tree contains only page.tsx, active, analytics, builder, templates pages plus layout/loading/error; grep of the folder finds no forms, create/edit/activate/pause controls or canvas. Home tile (journeys/page.tsx:6) promises 'Design and activate'. Backend write endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/journeys/page.tsx`, `apps/web/src/app/(app)/journeys/builder/page.tsx`
- **Fix steps:**
  1. Decision: build a builder (new journeys/builder/new + [id] routes with step editor) or relabel.
  2. Short term: change the tile title/description to 'Journey Definitions — View journey definitions' and page description accordingly.
  3. If building: zod-validated create form, activate/pause via ConfirmDialog with reason, audit event emitted by service, maker-checker if required.
  4. Reuse the typed journey table from GAP-JOURNEYS-ACTIVE-02.
- **Acceptance:**
  - Tile copy matches real capability.
  - If builder built: create->activate flow works and writes audit event.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Medium; activating journeys sends citizen communications.
- **Depends on:** GAP-JOURNEYS-ACTIVE-02

### GAP-JOURNEYS-BUILDER-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:44) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-53), so columns mean different things per row and status is unstyled plain text (ModuleListTable.tsx:47).
- **Verified evidence:** builder/page.tsx renders shared ModuleListPage -> ModuleListTable.tsx: ID is row.id.slice(0,8) in a mono span (l.50), Detail = row.sublabel, Status = row.status raw text with no StatusPill (l.53), Meta = row.meta (l.54). mapRows in journeys/_data.ts:28-77 picks fields from ~10 candidate keys with fallbacks (sublabel falls back to status, so Detail can duplicate Status; meta may be code, currency, timestamp or points), so column meaning varies per row. Timestamps in meta are unformatted ISO.
- **Files to change:** `apps/web/src/app/(app)/journeys/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/journeys/builder/page.tsx`
- **Fix steps:**
  1. Replace the generic mapRows for journeys with a typed mapper per endpoint (journeys, executions, triggers) in journeys/_data.ts.
  2. Build a journey-specific table (DataTable from ds) with fixed columns and StatusPill for status; format dates with formatIndianDate.
  3. Keep ModuleListTable for other modules; in it at minimum render status via <StatusPill> and format ISO meta.
  4. Hide the truncated id or turn it into a link once a detail route exists.
- **Acceptance:**
  - Status renders as a pill in all rows.
  - Detail never repeats Status; date columns show dd Mon yyyy.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; shared ModuleListTable change affects other modules, so scope to journeys or gate behind a prop.
- **Depends on:** GAP-JOURNEYS-ACTIVE-01


---
## /journeys/templates  —  `journeys/templates.html`

- **Source:** `apps/web/src/app/(app)/journeys/templates/page.tsx`
- **Design reference:** `redesign/journeys/templates.html`

### GAP-JOURNEYS-TEMPLATES-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Templates are backed by the /journeys/triggers endpoint (_data.ts:84): trigger rules are not reusable journey blueprints, and the home tile promises "Reusable journey templates for common scenarios" — the copy admits the reinterpretation only on this page (templates/page.tsx:17).
- **Verified evidence:** _data.ts:90 getJourneyTemplates fetches /api/v1/journeys/triggers; templates/page.tsx:16 describes 'Reusable trigger rules used as journey templates'; home tile (journeys/page.tsx:8) says 'Reusable journey templates for common scenarios'. Triggers are rules, not blueprints; whether journey-service has a templates endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/journeys/page.tsx`, `apps/web/src/app/(app)/journeys/templates/page.tsx`, `apps/web/src/app/(app)/journeys/_data.ts`
- **Fix steps:**
  1. Decision with backend: add /journeys/templates or rename the concept to 'Triggers'.
  2. If rename: change tile title/desc, page title 'Journeys — Triggers', and route/nav.
  3. If backend adds templates: update the loader path and typed mapper, remove reinterpretation copy.
- **Acceptance:**
  - Tile, page title and data source describe the same concept.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-JOURNEYS-HOME-01

### GAP-JOURNEYS-TEMPLATES-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:44) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-53), so columns mean different things per row and status is unstyled plain text (ModuleListTable.tsx:47).
- **Verified evidence:** templates/page.tsx renders shared ModuleListPage -> ModuleListTable.tsx: ID is row.id.slice(0,8) in a mono span (l.50), Detail = row.sublabel, Status = row.status raw text with no StatusPill (l.53), Meta = row.meta (l.54). mapRows in journeys/_data.ts:28-77 picks fields from ~10 candidate keys with fallbacks (sublabel falls back to status, so Detail can duplicate Status; meta may be code, currency, timestamp or points), so column meaning varies per row. Timestamps in meta are unformatted ISO.
- **Files to change:** `apps/web/src/app/(app)/journeys/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/journeys/templates/page.tsx`
- **Fix steps:**
  1. Replace the generic mapRows for journeys with a typed mapper per endpoint (journeys, executions, triggers) in journeys/_data.ts.
  2. Build a journey-specific table (DataTable from ds) with fixed columns and StatusPill for status; format dates with formatIndianDate.
  3. Keep ModuleListTable for other modules; in it at minimum render status via <StatusPill> and format ISO meta.
  4. Hide the truncated id or turn it into a link once a detail route exists.
- **Acceptance:**
  - Status renders as a pill in all rows.
  - Detail never repeats Status; date columns show dd Mon yyyy.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; shared ModuleListTable change affects other modules, so scope to journeys or gate behind a prop.
- **Depends on:** GAP-JOURNEYS-ACTIVE-01


---
## Backend verification items (service code absent from snapshot)

### GAP-JOURNEYS-ACTIVE-03  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** journey-service is not in the snapshot; the real row shape, permissions and pagination are undeterminable (no limit param on the request).
- **Service:** `journey-service`  ·  **Endpoint(s):** `['GET /api/v1/journeys/executions']`
- **Question:** GET /v1/journeys/executions must require a journeys role, tenant-scope, accept limit/cursor with a server default cap, and return {id,name,status,updatedAt} per row.
- **How to verify:** In journey-service open the handler for /api/v1/journeys/executions; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
- **Test to add:** Given 1,000 rows, when GET /api/v1/journeys/executions with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
- **Impact if wrong:** Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- **Web change if wrong:** Pass limit and add pagination/hasMore notice; for Templates map to a real templates endpoint if triggers is not one.

### GAP-JOURNEYS-ANALYTICS-03  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** journey-service is not in the snapshot; the real row shape, permissions and pagination are undeterminable (no limit param on the request).
- **Service:** `journey-service`  ·  **Endpoint(s):** `['GET /api/v1/journeys/executions']`
- **Question:** GET /v1/journeys/executions must paginate or aggregate server-side, since the analytics page derives metrics from the same unbounded list as Active.
- **How to verify:** In journey-service open the handler for /api/v1/journeys/executions; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
- **Test to add:** Given 1,000 rows, when GET /api/v1/journeys/executions with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
- **Impact if wrong:** Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- **Web change if wrong:** Pass limit and add pagination/hasMore notice; for Templates map to a real templates endpoint if triggers is not one.

### GAP-JOURNEYS-BUILDER-03  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** journey-service is not in the snapshot; the real row shape, permissions and pagination are undeterminable (no limit param on the request).
- **Service:** `journey-service`  ·  **Endpoint(s):** `['GET /api/v1/journeys']`
- **Question:** GET /v1/journeys must require a journeys role, tenant-scope, accept limit/cursor, and return definition summaries with id/name/status.
- **How to verify:** In journey-service open the handler for /api/v1/journeys; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
- **Test to add:** Given 1,000 rows, when GET /api/v1/journeys with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
- **Impact if wrong:** Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- **Web change if wrong:** Pass limit and add pagination/hasMore notice; for Templates map to a real templates endpoint if triggers is not one.

### GAP-JOURNEYS-TEMPLATES-03  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** journey-service is not in the snapshot; the real row shape, permissions and pagination are undeterminable (no limit param on the request).
- **Service:** `journey-service`  ·  **Endpoint(s):** `['GET /api/v1/journeys/triggers']`
- **Question:** GET /v1/journeys/triggers (loaded as 'templates') must return template/trigger definitions with id/name/description and paginate; confirm triggers are the intended data for a Templates page.
- **How to verify:** In journey-service open the handler for /api/v1/journeys/triggers; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
- **Test to add:** Given 1,000 rows, when GET /api/v1/journeys/triggers with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
- **Impact if wrong:** Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- **Web change if wrong:** Pass limit and add pagination/hasMore notice; for Templates map to a real templates endpoint if triggers is not one.
