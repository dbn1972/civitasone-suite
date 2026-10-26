# Detailed gap file — module `field`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 23, BACKEND-VERIFY 3



---
## /field  —  `field/home.html`

- **Source:** `apps/web/src/app/(app)/field/page.tsx`
- **Design reference:** `redesign/field/home.html`

### GAP-FIELD-HOME-01  ·  MEDIUM  ·  partly  ·  theme NAVUX (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub is purely static: no counts, no "open tasks today" or sync-conflict indicator, so a supervisor must open all five lists to learn anything; tiles all render the same 📁 icon (LinkTiles.tsx:53-60), which removes the visual cue that would distinguish them.
- **Verified evidence:** Hub is static: field/page.tsx:5-17 is a plain NavTile list with no fetch, so no counts or conflict indicator (true). The icon claim is true: LinkTiles.tsx TILE_ICONS (10-49) has no Tasks/Visits/Routes/Agents/Offline Sync keys and tileIcon() (53-61) falls to default 📁 because the hrefs contain none of dashboard/employees/leave/payroll/procurement/orders, so all five tiles get 📁 (line 60, not 53-60 range wholesale). The stated theme DATEFMT and fix text (dates) do not relate to this observation.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`, `apps/web/src/app/(app)/field/page.tsx`
- **Fix steps:**
  1. Add Tasks, Visits, Routes, Agents, 'Offline Sync' entries to TILE_ICONS in LinkTiles.tsx (e.g. ✅ 📍 🧭 👷 🔄) or add an optional icon field to NavTile in packages/types and use it.
  2. Optionally add StatCard counts above the tiles in field/page.tsx (open tasks, open visits) using existing loaders getFieldTasks/getFieldVisitsDetailed, rendering '-' on source==='error'.
  3. Skip the sync-conflict indicator unless the sync API exposes conflicts (unverified).
- **Acceptance:**
  - Manual: /field shows five distinct icons.
  - Unit: tileIcon returns non-📁 for each Field tile title.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; counts add 2 server fetches per hub load.
- **Depends on:** GAP-FLEET-HOME icon mapping shared LinkTiles

### GAP-FIELD-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme LAYOUT (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Grid is 4 columns for 5 tiles (page.tsx:17) leaving an orphan tile on its own row at desktop width.
- **Verified evidence:** field/page.tsx:17 uses columns='four'; LinkTiles.tsx:64 maps to .g-4 = repeat(4,1fr) (civitas-ds.css:101), so 5 tiles give 4+1; below 1080px it is 2 columns (css:106) giving 2+2+1, again an orphan. Only the mobile rule (css:427) avoids it.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`, `apps/web/src/app/(app)/field/page.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Add a columns='auto' (or 'five') variant to LinkTiles that uses grid-template-columns:repeat(auto-fit,minmax(220px,1fr)) via a new .g-auto class in civitas-ds.css.
  2. Use it in field/page.tsx:17.
  3. Alternatively reorder into 3+2 with columns='three' (still leaves gap; auto-fit preferred).
- **Acceptance:**
  - Visual check at 1440px and 1024px: no single orphan tile stretched on its own row; tiles wrap evenly.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic only; LinkTiles is shared, keep existing variants untouched.

### GAP-FIELD-HOME-03  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile descriptions promise more than the destination pages deliver: Agents "territories, and performance" and Offline Sync "conflict resolution" have no such data or action (see agents/page.tsx:16, sync/page.tsx:16).
- **Verified evidence:** field/page.tsx:9 says Agents 'Field agent roster, territories, and performance' but agents/page.tsx:16 says 'Agent roster derived from assigned field tasks' and _data.ts:91 getFieldAgents calls the SAME /api/v1/field/tasks endpoint, so the page lists tasks (id = task id), not agents, with no territory or performance. field/page.tsx:10 promises 'conflict resolution' but sync/page.tsx:16 is a read-only list of pulled changes with no resolve action.
- **Files to change:** `apps/web/src/app/(app)/field/page.tsx`, `apps/web/src/app/(app)/field/agents/page.tsx`, `apps/web/src/app/(app)/field/_data.ts`
- **Fix steps:**
  1. Reword tile descriptions in field/page.tsx:9-10 to what exists (e.g. 'Agents with assigned tasks', 'Pending device sync changes').
  2. Alternatively (bigger) aggregate tasks by agentId in getFieldAgents so rows are agents; territory/performance need a backend endpoint (not visible).
  3. Track conflict resolution as separate backend+web feature.
- **Acceptance:**
  - Tile text matches the destination page description.
  - If aggregation is built: unit test grouping 3 tasks of 2 agents yields 2 rows.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None for copy change; aggregation guesses field names (agentId) unverified against service.


---
## /field/agents  —  `field/agents.html`

- **Source:** `apps/web/src/app/(app)/field/agents/page.tsx`
- **Design reference:** `redesign/field/agents.html`

### GAP-FIELD-AGENTS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 PQ: ALREADY-FIXED — getFieldAgentsDetailed added in #1923; agent names resolved via separate endpoint (GAP-FIELD-AGENTS-01))
- **W0 note:** partly fixed by #1923 — One row per agent with task count from /field/agents endpoint; Agent column still shows raw agentId not a resolved name
- **First-pass claim:** "Agents" is the Tasks endpoint: getFieldAgents fetches /api/v1/field/tasks (_data.ts:91) and mapRows does no grouping, so the page titled "Agent roster" lists tasks, one row per task, with the agent visible only if agentId is a row's fallback id (_data.ts:37,58). No territories or performance figures exist although the hub promises "Field agent roster, territories, and performance" (field/page.tsx:9).
- **Verified evidence:** field/_data.ts:91 getFieldAgents = moduleLoader('/api/v1/field/tasks',...) same endpoint as getFieldTasks (:88); mapRows (:28-77) maps one row per payload item with no grouping. id prefers row.id (:33), agentId only as later fallback (:37); agentId also appears at the tail of the sublabel chain (:58) after description/status/etc., so the agent is effectively never shown for tasks that have a status. Page description honestly says 'derived from assigned field tasks' (agents/page.tsx:16) but hub tile field/page.tsx:9 promises 'roster, territories, and performance'. No territory/performance data path exists. Field-service is absent, so the task payload shape cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/(app)/field/agents/page.tsx`, `apps/web/src/app/(app)/field/page.tsx`
- **Fix steps:**
  1. Verify with field-service whether a /field/agents (or /agents) endpoint exists; if yes point getFieldAgents at it with a typed mapper.
  2. If not, write a dedicated groupTasksByAgent(mapRows input) in _data.ts: one row per agentId with counts of tasks (open/completed) and last activity; label = agent name (resolved) not id.
  3. Change hub tile text (field/page.tsx:9) to 'Agents and their assigned tasks' until territories/performance exist.
  4. Keep page copy consistent.
- **Acceptance:**
  - Two tasks for the same agentId produce one row with task count 2.
  - Hub tile text matches page capability.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; grouping in the browser tier is only safe for small task lists (cap unknown).
- **Depends on:** GAP-FIELD-AGENTS-04

### GAP-FIELD-AGENTS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as "nothing here": on source "error" the page passes rows=[] and the table renders EmptyState "No records / Nothing to show yet for this module." under the amber badge (ModuleListTable.tsx:35, ModuleListPage.tsx:28); no Try again action, unlike RefreshErrorState on sibling pages.
- **Verified evidence:** agents/page.tsx:8-19 passes data (fallback []) and source into ModuleListPage -> ModuleListTable (line 90 of ModuleListPage passes source 'error'). ModuleListTable.tsx:19-24 uses useSeededResource; with no cached copy provenance is 'error-no-data', the table shows DataSourceBadge (amber 'Couldn't load — showing nothing') and then, since data.length===0, EmptyState 'No records / Nothing to show yet for this module.' (:34-35). No retry action. If a cached copy exists it correctly shows saved data. Affects all ModuleListPage users, not only agents.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance==='error-no-data' (or !offline && source==='error' && data.length===0) render <RefreshErrorState error={toHumanError('load',{area: title})}/> instead of EmptyState; add a title prop from ModuleListPage.
  2. Keep EmptyState only for source 'api' with empty data.
  3. Drop the redundant DataSourceBadge in the error-no-data case.
- **Acceptance:**
  - Mock 500: page shows the error card with Try again.
  - Mock 200 []: shows 'No records'.
  - Offline with cache: still shows saved rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component, check all ModuleListPage consumers visually.

### GAP-FIELD-AGENTS-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw values printed: ID is the first 8 characters of the id (ModuleListTable.tsx:50) and Meta prints ISO timestamps or codes verbatim (_data.ts:61-67), e.g. "2026-09-27T09:14:00.000Z"; Status is raw lower-case text without a pill (ModuleListTable.tsx:53).
- **Verified evidence:** ModuleListTable.tsx:50 prints row.id.slice(0,8) in mono; :53 prints row.status raw (or '—') with no pill; _data.ts:61-67 sets meta to code ?? currency ?? updatedAt ?? createdAt verbatim (ISO string), so tasks show '2026-09-27T09:14:00.000Z'.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/field/_data.ts`
- **Fix steps:**
  1. Render status with <StatusPill status={row.status}/> (humanized by the component).
  2. In mapRows format date-like meta with formatIndianDate from @/lib/formatters (detect updatedAt/createdAt fields separately rather than sniffing strings).
  3. Hide the ID column or show formatInternalRef(row.id) if a reference is real; never truncated uuid.
- **Acceptance:**
  - Status shows a coloured, capitalized pill.
  - Meta shows '27 Sep 2026' style date.
  - No 8-char uuid fragments remain.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; ModuleListTable is shared by many modules, review for regressions.
- **Depends on:** GAP-FIELD-AGENTS-04

### GAP-FIELD-AGENTS-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** One generic mapper for five different entities (_data.ts:28-77): label/sublabel/status fall through key lists (name, title, code, type…), so columns Detail and Meta mean different things per row and per endpoint; no typed columns, sorting, filtering or pagination on any list.
- **Verified evidence:** field/_data.ts:28-77 mapRows is one generic mapper used by five loaders (tasks, routes, visits, agents, sync: :88-92); label/sublabel/meta come from long ?? chains (:42-67) so the same column means different things per row. ModuleListTable has fixed columns ID/Name/Detail/Status/Meta and no sort/filter/pagination; only visits has ?limit=100 (:90). Also visits has a typed loader already (FieldVisitRow, :95-121).
- **Files to change:** `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/field/tasks/page.tsx`, `apps/web/src/app/(app)/field/routes/page.tsx`, `apps/web/src/app/(app)/field/sync/page.tsx`
- **Fix steps:**
  1. Define typed view models (FieldTaskRow, FieldRouteRow, AgentRow, SyncRow) and per-entity mappers, following documents/_data/loaders.ts style.
  2. Give ModuleListTable an optional columns prop ({key,header,render}[]) with the generic five-column layout as default.
  3. Add ?q, ?sort, ?page searchParams and pass limit/offset to the endpoints once the field-service supports them (unverified).
  4. Migrate field pages one by one.
- **Acceptance:**
  - Tasks page shows Title, Assignee, Due, Status columns.
  - Sorting by column works server-side.
  - Generic modules keep working with default columns.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Medium: large refactor touching shared table, do incrementally.
- **Depends on:** GAP-FIELD-AGENTS-01, GAP-FIELD-AGENTS-03


---
## /field/routes  —  `field/routes.html`

- **Source:** `apps/web/src/app/(app)/field/routes/page.tsx`
- **Design reference:** `redesign/field/routes.html`

### GAP-FIELD-ROUTES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as "nothing here": on source "error" the page passes rows=[] and the table renders EmptyState "No records / Nothing to show yet for this module." under the amber badge (ModuleListTable.tsx:35, ModuleListPage.tsx:28); no Try again action, unlike RefreshErrorState on sibling pages.
- **Verified evidence:** ModuleListPage.tsx:28 passes source==='error'?'error':'api' to ModuleListTable; ModuleListTable.tsx:19-24,33-35 uses useSeededResource, which on server failure with no cache yields provenance 'error-no-data' (lib/sync/resource.ts:209-213) -> DataSourceBadge shows amber 'Couldn't load - showing nothing' (DataSourceBadge.tsx:71) AND the table still renders EmptyState 'No records / Nothing to show yet for this module.' (ModuleListTable.tsx:35). There is no retry; RefreshErrorState (_components/ds/RefreshErrorState.tsx, router.refresh()) is not used. When a cached copy exists the cached rows are shown with a 'Showing saved data' badge, which is fine. So the failure is flagged by a badge but contradicted by the empty state and has no Try again.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx branch on provenance === 'error-no-data' before the data.length === 0 check.
  2. In that branch render <RefreshErrorState error={{what:'Could not load these records', next:'Check your connection and try again.', actions:['retry','back']}} backHref='/field' /> (import from ./ds; HumanError shape in lib/messages) instead of EmptyState, and drop the redundant badge for that state.
  3. Keep EmptyState only for provenance 'live' with zero rows; keep the 'cached' badge path unchanged.
  4. Add an optional backHref prop to ModuleListTable/ModuleListPage so each module can supply its own back target.
  5. Because ModuleListTable is shared, this one change fixes every ModuleListPage consumer (field tasks/routes/agents/sync and others).
- **Acceptance:**
  - Component test: mock useSeededResource to return {provenance:'error-no-data', data:[]}; expect a Try again button and no 'No records' text; clicking it calls router.refresh.
  - Mock provenance 'live' with []: 'No records' EmptyState still renders.
  - Manual: stop the gateway, load /field/tasks with empty cache -> error state with retry; restart gateway, click Try again -> rows appear.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component: verify other ModuleListPage screens' tests that assert the EmptyState on error; offline-cached path must be unchanged.
- **Depends on:** shared ModuleListTable fix (any GAP-*-FAILMASK for ModuleListTable)

### GAP-FIELD-ROUTES-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw values printed: ID is the first 8 characters of the id (ModuleListTable.tsx:50) and Meta prints ISO timestamps or codes verbatim (_data.ts:61-67), e.g. "2026-09-27T09:14:00.000Z"; Status is raw lower-case text without a pill (ModuleListTable.tsx:53).
- **Verified evidence:** ModuleListTable.tsx:50 renders <span className='mono'>{row.id.slice(0, 8)}</span> (a truncated UUID/key); :53 renders {row.status ?? '-'} as plain text with no StatusPill (StatusPill.tsx maps status to variant); :54 prints row.meta verbatim, and _data.ts:61-67 builds meta from code, currency, updatedAt, createdAt in that order, so ISO strings like 2026-09-27T09:14:00.000Z appear whenever no code/currency exists. Confirmed.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/../lib/formatters.ts`
- **Fix steps:**
  1. In ModuleListTable.tsx replace the {row.status ?? '-'} cell with <StatusPill status={row.status} /> when defined (import from ./ds), else '-'.
  2. Stop showing the truncated id as the first column: make ID optional (prop showId=false default) or replace with the human code/name; keep the id only as row key/link.
  3. In _data.ts mapRows stop concatenating ISO strings into meta: add a metaKind/`meta` typed field (e.g. {value, kind:'date'|'text'}) or split into separate `updatedAt` on ModuleRowSummary (packages/types) and format with formatIndianDate at render.
  4. Add a formatIndianDateTime helper in lib/formatters.ts (IST, dd/MM/yyyy HH:mm) since only formatIndianDate exists, and use it for timestamps.
  5. Add per-module column config to ModuleListPage (see the generic-mapper finding) so labels like 'Detail'/'Meta' get real names.
- **Acceptance:**
  - Unit test: mapRows on {id:'a1b2c3d4-...', status:'pending', updatedAt:'2026-09-27T09:14:00.000Z'} renders 'Pending' pill and '27/09/2026 ...' (IST), never the raw ISO or slice(0,8) id.
  - Manual: /field/tasks shows coloured status pills and readable dates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table used by many modules; changing columns needs snapshot updates. Status text differences may break existing tests. Note packages/types ModuleRowSummary change affects all loaders.
- **Depends on:** ModuleListTable shared component

### GAP-FIELD-ROUTES-04  ·  MEDIUM  ·  confirmed  ·  theme DSCONSIST (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** One generic mapper for five different entities (_data.ts:28-77): label/sublabel/status fall through key lists (name, title, code, type…), so columns Detail and Meta mean different things per row and per endpoint; no typed columns, sorting, filtering or pagination on any list.
- **Verified evidence:** _data.ts:28-77 mapRows is one generic mapper: id falls through id/key/code/name/agentId/...; label through name/title/label/code/type...; sublabel through description/status/state/category/tier/programName/agentId; meta through code/currency/updatedAt/createdAt/points/balance. All five loaders (_data.ts:88-92) share it and ModuleListTable.tsx:37-58 renders fixed columns ID/Name/Detail/Status/Meta with no sort, filter or pagination (plain <table>, not DataTable). Field-service response shapes cannot be verified (service not in snapshot), so per-entity columns must be confirmed against its OpenAPI.
- **Files to change:** `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/(app)/field/routes/page.tsx`
- **Fix steps:**
  1. Define typed row types per entity in field/_data.ts (FieldTaskRow, FieldRouteRow, FieldAgentRow, FieldSyncChange) modelled on the existing FieldVisitRow/getFieldVisitsDetailed pattern (_data.ts:95-121), with a mapResponse reading payload.data.
  2. Confirm real field names against the field-service API contract before coding (no service source in this snapshot).
  3. Rebuild each page with ds DataTable (sortable, filterable, pageSize, exportable as needed) and named columns like the visits page, instead of ModuleListPage.
  4. Pass limit/offset (or cursor) to the endpoint where supported and show total; if the API cannot page, raise as backend work.
  5. Remove the unused generic paths from mapRows once no caller remains.
- **Acceptance:**
  - Component test: tasks page renders columns Title, Assignee, Due, Status pill from a fixture; clicking header sorts.
  - Manual: with >20 tasks the table paginates and filter box narrows rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Endpoint field names unverified; wrong mapping would show blanks. Pagination needs backend support for large sets.
- **Depends on:** GAP-FIELD-TASKS-05 (assignee column)


---
## /field/sync  —  `field/sync.html`

- **Source:** `apps/web/src/app/(app)/field/sync/page.tsx`
- **Design reference:** `redesign/field/sync.html`

### GAP-FIELD-SYNC-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W2 PQ: ALREADY-FIXED — 7-day rolling window (since = now - 7d) and limit=100 added in #1961; description updated (GAP-FIELD-SYNC-01))
- **W0 note:** partly fixed by #1923 — Pull uses 7-day since plus limit 100 with window note (refined in #1961); sync still generic ModuleListPage rows with no device/entity/updatedAt typed columns
- **First-pass claim:** The pull always uses since=1970-01-01 (_data.ts:92) so every visit returns all changes ever recorded, unbounded; the description admits "since epoch (pull window)" (page.tsx:16). It also pulls, not shows device sync status or conflicts as the hub promises: "Device sync status and conflict resolution" (field/page.tsx:10) — no device column and no resolve action exist.
- **Verified evidence:** Client side true: _data.ts:92 hard-codes since=1970-01-01T00:00:00.000Z with no limit param; sync/page.tsx:16 states 'since epoch (pull window)'. Whether the server returns an unbounded set or caps/paginates cannot be verified (field-service not in snapshot), so 'unbounded' is unproven. Also true: field/page.tsx:10 promises device sync status and conflict resolution but the page is the generic list (no device column, no resolve action; mapRows has no device field).
- **Files to change:** `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/(app)/field/sync/page.tsx`, `apps/web/src/app/(app)/field/page.tsx`
- **Fix steps:**
  1. Check field-service sync/pull contract (limit, cursor, since semantics) - backend owner.
  2. Change getFieldSync to pass a recent since (e.g. last 7 days computed at request time) plus limit, and show the window in the description.
  3. Add device/entity/updatedAt columns via a typed row rather than the generic mapper.
  4. Remove 'conflict resolution' from the hub copy until an action exists (see HOME-03).
- **Acceptance:**
  - Unit: getFieldSync URL contains a since within 7 days and a limit.
  - Manual: sync page loads quickly with large history and shows the window text.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Narrowing the window may hide older unsynced changes that operators expect to see; needs product decision on window.
- **Depends on:** GAP-FIELD-HOME-03

### GAP-FIELD-SYNC-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as "nothing here": on source "error" the page passes rows=[] and the table renders EmptyState "No records / Nothing to show yet for this module." under the amber badge (ModuleListTable.tsx:35, ModuleListPage.tsx:28); no Try again action, unlike RefreshErrorState on sibling pages.
- **Verified evidence:** ModuleListPage.tsx:28 passes source==='error'?'error':'api' to ModuleListTable; ModuleListTable.tsx:19-24,33-35 uses useSeededResource, which on server failure with no cache yields provenance 'error-no-data' (lib/sync/resource.ts:209-213) -> DataSourceBadge shows amber 'Couldn't load - showing nothing' (DataSourceBadge.tsx:71) AND the table still renders EmptyState 'No records / Nothing to show yet for this module.' (ModuleListTable.tsx:35). There is no retry; RefreshErrorState (_components/ds/RefreshErrorState.tsx, router.refresh()) is not used. When a cached copy exists the cached rows are shown with a 'Showing saved data' badge, which is fine. So the failure is flagged by a badge but contradicted by the empty state and has no Try again.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx branch on provenance === 'error-no-data' before the data.length === 0 check.
  2. In that branch render <RefreshErrorState error={{what:'Could not load these records', next:'Check your connection and try again.', actions:['retry','back']}} backHref='/field' /> (import from ./ds; HumanError shape in lib/messages) instead of EmptyState, and drop the redundant badge for that state.
  3. Keep EmptyState only for provenance 'live' with zero rows; keep the 'cached' badge path unchanged.
  4. Add an optional backHref prop to ModuleListTable/ModuleListPage so each module can supply its own back target.
  5. Because ModuleListTable is shared, this one change fixes every ModuleListPage consumer (field tasks/routes/agents/sync and others).
- **Acceptance:**
  - Component test: mock useSeededResource to return {provenance:'error-no-data', data:[]}; expect a Try again button and no 'No records' text; clicking it calls router.refresh.
  - Mock provenance 'live' with []: 'No records' EmptyState still renders.
  - Manual: stop the gateway, load /field/tasks with empty cache -> error state with retry; restart gateway, click Try again -> rows appear.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component: verify other ModuleListPage screens' tests that assert the EmptyState on error; offline-cached path must be unchanged.
- **Depends on:** shared ModuleListTable fix (any GAP-*-FAILMASK for ModuleListTable)

### GAP-FIELD-SYNC-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 PQ: closed — showId={false} added to field/sync/page.tsx to hide UUID column; metaKind "datetime" added to _data.ts + ModuleListTable for IST date+time display (GAP-FIELD-SYNC-04))
- **W0 note:** partly fixed by #1923 — Status pill and formatted date meta done; ModuleListTable still shows UUID ids truncated to 8 chars and date-only (no IST time)
- **First-pass claim:** Raw values printed: ID is the first 8 characters of the id (ModuleListTable.tsx:50) and Meta prints ISO timestamps or codes verbatim (_data.ts:61-67), e.g. "2026-09-27T09:14:00.000Z"; Status is raw lower-case text without a pill (ModuleListTable.tsx:53).
- **Verified evidence:** ModuleListTable.tsx:50 renders <span className='mono'>{row.id.slice(0, 8)}</span> (a truncated UUID/key); :53 renders {row.status ?? '-'} as plain text with no StatusPill (StatusPill.tsx maps status to variant); :54 prints row.meta verbatim, and _data.ts:61-67 builds meta from code, currency, updatedAt, createdAt in that order, so ISO strings like 2026-09-27T09:14:00.000Z appear whenever no code/currency exists. Confirmed.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/../lib/formatters.ts`
- **Fix steps:**
  1. In ModuleListTable.tsx replace the {row.status ?? '-'} cell with <StatusPill status={row.status} /> when defined (import from ./ds), else '-'.
  2. Stop showing the truncated id as the first column: make ID optional (prop showId=false default) or replace with the human code/name; keep the id only as row key/link.
  3. In _data.ts mapRows stop concatenating ISO strings into meta: add a metaKind/`meta` typed field (e.g. {value, kind:'date'|'text'}) or split into separate `updatedAt` on ModuleRowSummary (packages/types) and format with formatIndianDate at render.
  4. Add a formatIndianDateTime helper in lib/formatters.ts (IST, dd/MM/yyyy HH:mm) since only formatIndianDate exists, and use it for timestamps.
  5. Add per-module column config to ModuleListPage (see the generic-mapper finding) so labels like 'Detail'/'Meta' get real names.
- **Acceptance:**
  - Unit test: mapRows on {id:'a1b2c3d4-...', status:'pending', updatedAt:'2026-09-27T09:14:00.000Z'} renders 'Pending' pill and '27/09/2026 ...' (IST), never the raw ISO or slice(0,8) id.
  - Manual: /field/tasks shows coloured status pills and readable dates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table used by many modules; changing columns needs snapshot updates. Status text differences may break existing tests. Note packages/types ModuleRowSummary change affects all loaders.
- **Depends on:** ModuleListTable shared component


---
## /field/tasks  —  `field/tasks.html`

- **Source:** `apps/web/src/app/(app)/field/tasks/page.tsx`
- **Design reference:** `redesign/field/tasks.html`

### GAP-FIELD-TASKS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as "nothing here": on source "error" the page passes rows=[] and the table renders EmptyState "No records / Nothing to show yet for this module." under the amber badge (ModuleListTable.tsx:35, ModuleListPage.tsx:28); no Try again action, unlike RefreshErrorState on sibling pages.
- **Verified evidence:** ModuleListPage.tsx:28 passes source==='error'?'error':'api' to ModuleListTable; ModuleListTable.tsx:19-24,33-35 uses useSeededResource, which on server failure with no cache yields provenance 'error-no-data' (lib/sync/resource.ts:209-213) -> DataSourceBadge shows amber 'Couldn't load - showing nothing' (DataSourceBadge.tsx:71) AND the table still renders EmptyState 'No records / Nothing to show yet for this module.' (ModuleListTable.tsx:35). There is no retry; RefreshErrorState (_components/ds/RefreshErrorState.tsx, router.refresh()) is not used. When a cached copy exists the cached rows are shown with a 'Showing saved data' badge, which is fine. So the failure is flagged by a badge but contradicted by the empty state and has no Try again.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx branch on provenance === 'error-no-data' before the data.length === 0 check.
  2. In that branch render <RefreshErrorState error={{what:'Could not load these records', next:'Check your connection and try again.', actions:['retry','back']}} backHref='/field' /> (import from ./ds; HumanError shape in lib/messages) instead of EmptyState, and drop the redundant badge for that state.
  3. Keep EmptyState only for provenance 'live' with zero rows; keep the 'cached' badge path unchanged.
  4. Add an optional backHref prop to ModuleListTable/ModuleListPage so each module can supply its own back target.
  5. Because ModuleListTable is shared, this one change fixes every ModuleListPage consumer (field tasks/routes/agents/sync and others).
- **Acceptance:**
  - Component test: mock useSeededResource to return {provenance:'error-no-data', data:[]}; expect a Try again button and no 'No records' text; clicking it calls router.refresh.
  - Mock provenance 'live' with []: 'No records' EmptyState still renders.
  - Manual: stop the gateway, load /field/tasks with empty cache -> error state with retry; restart gateway, click Try again -> rows appear.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component: verify other ModuleListPage screens' tests that assert the EmptyState on error; offline-cached path must be unchanged.
- **Depends on:** shared ModuleListTable fix (any GAP-*-FAILMASK for ModuleListTable)

### GAP-FIELD-TASKS-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw values printed: ID is the first 8 characters of the id (ModuleListTable.tsx:50) and Meta prints ISO timestamps or codes verbatim (_data.ts:61-67), e.g. "2026-09-27T09:14:00.000Z"; Status is raw lower-case text without a pill (ModuleListTable.tsx:53).
- **Verified evidence:** ModuleListTable.tsx:50 renders <span className='mono'>{row.id.slice(0, 8)}</span> (a truncated UUID/key); :53 renders {row.status ?? '-'} as plain text with no StatusPill (StatusPill.tsx maps status to variant); :54 prints row.meta verbatim, and _data.ts:61-67 builds meta from code, currency, updatedAt, createdAt in that order, so ISO strings like 2026-09-27T09:14:00.000Z appear whenever no code/currency exists. Confirmed.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/../lib/formatters.ts`
- **Fix steps:**
  1. In ModuleListTable.tsx replace the {row.status ?? '-'} cell with <StatusPill status={row.status} /> when defined (import from ./ds), else '-'.
  2. Stop showing the truncated id as the first column: make ID optional (prop showId=false default) or replace with the human code/name; keep the id only as row key/link.
  3. In _data.ts mapRows stop concatenating ISO strings into meta: add a metaKind/`meta` typed field (e.g. {value, kind:'date'|'text'}) or split into separate `updatedAt` on ModuleRowSummary (packages/types) and format with formatIndianDate at render.
  4. Add a formatIndianDateTime helper in lib/formatters.ts (IST, dd/MM/yyyy HH:mm) since only formatIndianDate exists, and use it for timestamps.
  5. Add per-module column config to ModuleListPage (see the generic-mapper finding) so labels like 'Detail'/'Meta' get real names.
- **Acceptance:**
  - Unit test: mapRows on {id:'a1b2c3d4-...', status:'pending', updatedAt:'2026-09-27T09:14:00.000Z'} renders 'Pending' pill and '27/09/2026 ...' (IST), never the raw ISO or slice(0,8) id.
  - Manual: /field/tasks shows coloured status pills and readable dates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table used by many modules; changing columns needs snapshot updates. Status text differences may break existing tests. Note packages/types ModuleRowSummary change affects all loaders.
- **Depends on:** ModuleListTable shared component

### GAP-FIELD-TASKS-03  ·  MEDIUM  ·  confirmed  ·  theme DSCONSIST (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** One generic mapper for five different entities (_data.ts:28-77): label/sublabel/status fall through key lists (name, title, code, type…), so columns Detail and Meta mean different things per row and per endpoint; no typed columns, sorting, filtering or pagination on any list.
- **Verified evidence:** _data.ts:28-77 mapRows is one generic mapper: id falls through id/key/code/name/agentId/...; label through name/title/label/code/type...; sublabel through description/status/state/category/tier/programName/agentId; meta through code/currency/updatedAt/createdAt/points/balance. All five loaders (_data.ts:88-92) share it and ModuleListTable.tsx:37-58 renders fixed columns ID/Name/Detail/Status/Meta with no sort, filter or pagination (plain <table>, not DataTable). Field-service response shapes cannot be verified (service not in snapshot), so per-entity columns must be confirmed against its OpenAPI.
- **Files to change:** `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/(app)/field/tasks/page.tsx`
- **Fix steps:**
  1. Define typed row types per entity in field/_data.ts (FieldTaskRow, FieldRouteRow, FieldAgentRow, FieldSyncChange) modelled on the existing FieldVisitRow/getFieldVisitsDetailed pattern (_data.ts:95-121), with a mapResponse reading payload.data.
  2. Confirm real field names against the field-service API contract before coding (no service source in this snapshot).
  3. Rebuild each page with ds DataTable (sortable, filterable, pageSize, exportable as needed) and named columns like the visits page, instead of ModuleListPage.
  4. Pass limit/offset (or cursor) to the endpoint where supported and show total; if the API cannot page, raise as backend work.
  5. Remove the unused generic paths from mapRows once no caller remains.
- **Acceptance:**
  - Component test: tasks page renders columns Title, Assignee, Due, Status pill from a fixture; clicking header sorts.
  - Manual: with >20 tasks the table paginates and filter box narrows rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Endpoint field names unverified; wrong mapping would show blanks. Pagination needs backend support for large sets.
- **Depends on:** GAP-FIELD-TASKS-05 (assignee column)

### GAP-FIELD-TASKS-04  ·  LOW  ·  confirmed  ·  theme NAVUX (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Back link is a full-page <a href="/field"> (page.tsx:12) not next/link, and the title uses an em-dash "Field — X" pattern instead of PageHeader back/backLabel that Field Visits uses (visits/page.tsx:39-40). Hard-coded English.
- **Verified evidence:** tasks/page.tsx:11-13 hand-builds a breadcrumb nav with a plain <a href='/field'> (full page load, no next/link) and ArrowLeft; title 'Field - Tasks' (line 15, em dash) is hard-coded English. visits/page.tsx:36-41 uses <PageHeader back='/field' backLabel='Field Operations'>. Same pattern in routes, sync, agents pages. Note the nav lacks the heading id target too (aria-labelledby='page-heading' relies on PageHeader).
- **Files to change:** `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/(app)/field/tasks/page.tsx`, `apps/web/src/app/(app)/field/routes/page.tsx`, `apps/web/src/app/(app)/field/sync/page.tsx`, `apps/web/src/app/(app)/field/agents/page.tsx`
- **Fix steps:**
  1. Add optional back and backLabel props to ModuleListPage and forward them to PageHeader (MP:22).
  2. In the four field pages delete the manual <nav>/<a> and pass back='/field' backLabel='Field Operations'.
  3. Change titles to 'Tasks', 'Routes', 'Agents', 'Offline Sync' (module context comes from the back link); route strings through the existing i18n/messages helper if used elsewhere.
  4. Keep slugify cache key stable: cacheKey derives from title (MP:16,28), so changing the title changes the offline cache key - pass an explicit cacheKey prop to preserve it or accept a one-time cache reset.
- **Acceptance:**
  - Click back link: client-side navigation, no full reload.
  - Titles no longer contain an em dash; offline cache still restores after title change.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Title change alters slugified offline cache key, dropping existing cached lists once.
- **Depends on:** shared ModuleListPage

### GAP-FIELD-TASKS-05  ·  LOW  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — Assignee column added (raw assigneeId, not name); no Assign/Mark complete actions and hub copy still says completion tracking
- **First-pass claim:** No create/assign/complete control exists on this page although the module description promises "Field task assignments and completion tracking" (field/page.tsx:6); tasks can only be listed here. Task assignee is not a column, so the list cannot be read by agent.
- **Verified evidence:** No create/assign/complete controls in tasks/page.tsx (only ModuleListPage). The mapper (_data.ts:51-59) only surfaces agentId as a last-resort sublabel after description/status, so assignee is effectively never displayed. field-service mutation endpoints cannot be verified (service absent), so which actions exist is unknown.
- **Files to change:** `apps/web/src/app/(app)/field/tasks/page.tsx`, `apps/web/src/app/(app)/field/_data.ts`
- **Fix steps:**
  1. Confirm field-service task endpoints (create/assign/complete) and roles allowed.
  2. Add typed FieldTaskRow with assignee (agent name/id), due date and status, rendered in DataTable; show agent name not id (needs agent lookup/backend).
  3. Add client action buttons (Assign, Mark complete) via server actions with zod validation and audit-emitting backend endpoints, or change hub copy to read-only wording.
- **Acceptance:**
  - List shows Assignee column.
  - Completing a task changes status and appears in audit log (backend).
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Mutations on field assignments need audit events and role checks (CLAUDE.md rule 8, 9); do not ship without backend endpoints.
- **Depends on:** GAP-FIELD-TASKS-03


---
## /field/visits  —  `field/visits.html`

- **Source:** `apps/web/src/app/(app)/field/visits/page.tsx`
- **Design reference:** `redesign/field/visits.html`

### GAP-FIELD-VISITS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as "no visits": on error data=[] so the stats show real zeros (Visits 0, Open 0) and the table shows "No visits yet — Check in on a field task…" beside a small amber badge (visits/page.tsx:20-22,42-45,62-63); sibling list pages null their stats.
- **Verified evidence:** visits/page.tsx:20-22 takes data from getFieldVisitsDetailed whose fallback is [] (_data.ts:112); on error data=[] so StatCard values 'Visits' and 'Open' render 0 (44-45) and DataTable shows emptyTitle 'No visits yet' (62-63); only a small badge is shown (42). No RefreshErrorState. (The claim that sibling pages null their stats was not checked.)
- **Files to change:** `apps/web/src/app/(app)/field/visits/page.tsx`
- **Fix steps:**
  1. Import RefreshErrorState from ds and early-return it when source==='error' (backHref '/field') for the whole body.
  2. Alternatively render '-' in StatCards and hide the table; prefer full error state.
  3. Drop the standalone DataSourceBadge for that case.
- **Acceptance:**
  - Test: mock loader source 'error' -> Try again shown, no '0' stats or 'No visits yet'.
  - source 'api' with [] -> zeros and empty state remain.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FIELD-VISITS-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W2 PQ: closed — open-visit elapsed time shown as "open Xh" / "open <1h" in the Duration column; openVisitHours helper used; test added in visits/page.test.tsx (GAP-FIELD-VISITS-02))
- **W0-10 note:** review found the W0 tick partly — Pill now 'in progress'/'overdue' >12h (visits.ts:63-72, page.tsx:65) with unit tests, but the Open-for-duration column (fix step 2) is absent: columns at field/visits/page.tsx:78-86 only show Duration for completed (durationMinutes), open visits show a dash
- **First-pass claim:** Open and Completed render identically: StatusPill maps both "open" and "completed" to the green variant (StatusPill.tsx:6-12), so the one distinction this page ranks by (visits.ts:36-43) is invisible; "open" should read as in-progress, and long-open visits (no check-out) have no age or warning.
- **Verified evidence:** visits.ts:26-28 returns 'open' or 'completed'; DataTable renders cellType 'status' with StatusPill (DataTable.tsx:127), and StatusPill.tsx:9,12 maps both 'completed' and 'open' to 'good'. Open visits rank first (visits.ts:36-43) but look identical to completed. No age/warning for long-open visits.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/field/visits/page.tsx`, `apps/web/src/app/(app)/field/visits/visits.ts`
- **Fix steps:**
  1. Do not change global 'open' mapping blindly (used elsewhere); pass a distinct status word from visitStatus, e.g. 'in progress' (mapped warn at StatusPill.tsx:16) for open visits, with label 'Open'.
  2. Add an Open-for-duration column (hours since checkInAt via a pure helper in visits.ts) and mark visits open >12h with a 'bad' pill (e.g. status 'overdue').
  3. Keep 'completed' good.
- **Acceptance:**
  - Unit: visitStatus/helper returns warn variant for open <12h, bad for >12h, good for completed.
  - Visual: open and completed pills differ in colour.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Changing StatusPill map for 'open' globally would recolour other modules - avoid.

### GAP-FIELD-VISITS-03  ·  HIGH  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by ##1923 — Done: role gate (FIELD_VISIT_LOCATION_ROLES) on GPS column + CSV export, coords rounded to 3dp, agent/task cols (raw ids), purpose note. Remains: no audited full-precision reveal; agent/task shown as ids not resolved names
- **First-pass claim:** Precise GPS positions of field staff are shown and CSV-exported (exportable, visits/page.tsx:59-60; formatCoord visits.ts:21-24) with no role gate, no masking/rounding and no purpose note — location of an identifiable employee is personal data (DPDP). The row has no agent or task column, so a coordinate cannot be traced to a person or job from the screen (agentId/taskId fetched, never shown).
- **Verified evidence:** Confirmed: precise lat/lon (check-in only) rendered in the GPS column (visits/page.tsx:28, formatCoord visits.ts:21-24 = full-precision decimal strings) and the DataTable has exportable (59-60) with the CSV path exporting row values; the page has no role/permission check (field/layout.tsx only applies ModuleGate for tenant module enablement) and no purpose note. agentId/taskId are in FieldVisitRow (_data.ts:97-98) but not in Row/columns, so a coordinate cannot be traced to a person from the screen. Whether the gateway/backend enforces roles for /api/v1/field/visits cannot be verified (service absent). The DPDP framing is a policy judgement, not a code fact.
- **Files to change:** `apps/web/src/app/(app)/field/visits/page.tsx`, `apps/web/src/app/(app)/field/visits/visits.ts`, `apps/web/src/app/(app)/field/_data.ts`
- **Fix steps:**
  1. Decide policy with DPO: who may see agent locations and whether CSV export of them is allowed.
  2. Gate the page/export by role claim (use the existing permission helper/PermissionDenied component) and hide exportable for non-privileged roles.
  3. Round coordinates (e.g. 3 decimals) by default in formatCoord with full precision behind an explicit reveal that emits an audit event (backend).
  4. Add Agent and Task columns (names resolved server-side) so rows are meaningful, plus a short purpose note under the header.
- **Acceptance:**
  - Non-privileged role sees PermissionDenied or rounded coordinates and no Export button.
  - Privileged export succeeds and an audit event is recorded.
  - Unit: formatCoord rounds to configured precision.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP exposure of employee location; over-restriction could block supervisors' legitimate use.

### GAP-FIELD-VISITS-04  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by ##1923 — Done: KPI labels 'latest N' when total>shown, date+time via formatIndianDateTime. Remains: still hard-coded limit=100 (FIELD_VISITS_LIMIT), no date-range filter/pagination
- **First-pass claim:** limit=100 hard-coded with no pagination or date filter (_data.ts:112), so the "Visits" KPI silently caps at 100 and Open counts only within that window; check-in shows date only (formatIndianDate) — no time, though duration is shown.
- **Verified evidence:** _data.ts:112 (and :90) hard-code ?limit=100; the page has no pagination or date filter, and StatCard 'Visits' = data.length (visits/page.tsx:44), 'Open' counted within the same 100 (22), so both cap silently. Check-in uses formatIndianDate (27), which is date-only (formatters.ts:2-7), while duration is shown.
- **Files to change:** `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/(app)/field/visits/page.tsx`, `apps/web/src/app/../lib/formatters.ts`
- **Fix steps:**
  1. Ask backend for a total (or counts endpoint) and date-range/cursor params on /api/v1/field/visits; unverified since service absent.
  2. Add date-range filter via searchParams and pass from/to/limit/offset to getFieldVisitsDetailed; use DataTable pageSize.
  3. Label KPIs 'Showing latest 100' until real totals exist.
  4. Add formatIndianDateTime in lib/formatters.ts and use for check-in (and check-out).
- **Acceptance:**
  - Test: >100 visits shows correct total or explicit 'latest 100' label.
  - Check-in cell shows date and time in IST.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** KPI accuracy for supervisors; backend support unknown.

### GAP-FIELD-VISITS-05  ·  MEDIUM  ·  partly  ·  theme DEADCODE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Notes and outcome are free text printed as-is (outcome underscore replace only, visits.ts:30-34); visit id never shown. getFieldVisits (list flavour, _data.ts:90) is exported but unused by this page.
- **Verified evidence:** Notes printed as-is (visits/page.tsx:31, React escapes so no injection); outcome only has underscores replaced (visits.ts:30-33, no capitalisation); visit id is in Row (line 25) but not a column (true but not necessarily a defect). getFieldVisits (_data.ts:90) is exported and has no importers (grep) - true dead code. 'PII' tag is a stretch: free-text notes may contain personal data but nothing is exposed beyond the existing access.
- **Files to change:** `apps/web/src/app/(app)/field/visits/visits.ts`, `apps/web/src/app/(app)/field/_data.ts`, `apps/web/src/app/(app)/field/visits/page.tsx`
- **Fix steps:**
  1. Delete getFieldVisits (_data.ts:90).
  2. Make outcomeLabel title-case via humanizeStatus (lib/formatters.ts:44).
  3. Truncate long notes with title/expand in the table cell; optionally link rows to a visit detail via DataTable rowHref if a detail route exists (not present).
- **Acceptance:**
  - grep shows no getFieldVisits references after removal; build passes.
  - outcomeLabel('no_show') === 'No show'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Trivial.


---
## Backend verification items (service code absent from snapshot)

### GAP-FIELD-HOME-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** [partial: hub strings now next-intl en+hi (UAT B2, @@HASH_GAP-FIELD-HOME-04@@); remaining: server-side edition entitlement - gateway-service module-guard ROUTE_TO_MODULE has no field mapping so /api/v1/field is not entitlement-gated at the edge (outside this lane, needs gateway change + fail-open/closed decision)]
- **First-pass claim:** Hard-coded English strings, no next-intl; field-service is not in the snapshot so tile availability per edition (Govt/PSU/Small Office) is undeterminable.
- **Service:** `field-service`  ·  **Endpoint(s):** `['GET /api/v1/field/tasks', 'GET /api/v1/field/routes', 'GET /api/v1/field/visits']`
- **Question:** Is the field module entitled per edition (Govt/PSU/Small Office) so tiles for unavailable features return 403/404 rather than empty?
- **How to verify:** Check edition entitlement config in field-service/policy-service for each endpoint.
- **Test to add:** Given a Small Office tenant without field entitlement when GET /v1/field/routes then 403 with entitlement error code.
- **Impact if wrong:** Tiles shown for features the edition does not own.
- **Web change if wrong:** Filter hub tiles by entitlement in field/page.tsx and move strings into next-intl messages.

### GAP-FIELD-ROUTES-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by ##1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Route rows show no stop count, distance, agent or map: the hub describes "AI-optimized daily routes" (field/page.tsx:8) but the page only lists generic label/sub-label, and the only route-optimisation output (stops order) is not surfaced. Backend field-service absent: whether the API returns stops is undeterminable.
- **Service:** `field-service`  ·  **Endpoint(s):** `['GET /api/v1/field/routes']`
- **Question:** Does GET /v1/field/routes return stops (ordered), distance and assigned agent per route?
- **How to verify:** Open the routes handler in field-service and inspect the response schema; curl and inspect a route with stops.
- **Test to add:** Given a route with 3 stops when GET routes then each item includes stops[] ordered, agentId and distanceKm.
- **Impact if wrong:** Hub claims AI-optimised routes but page shows only labels.
- **Web change if wrong:** Extend mapRows in field/_data.ts:60-76 and the routes page to show stop count, distance and agent.

### GAP-FIELD-SYNC-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Conflicts are indistinguishable: Status is raw text; nothing highlights a conflict row and nothing lets the officer resolve it. Row shape from field-service sync/pull is undeterminable (service absent).
- **Service:** `field-service`  ·  **Endpoint(s):** `['GET /api/v1/field/sync/pull?since=']`
- **Question:** Does sync/pull return a typed row with an explicit conflict status/flag and is there an endpoint to resolve conflicts?
- **How to verify:** Open the sync pull handler in field-service; inspect the row schema and any conflict/resolve route.
- **Test to add:** Given two offline edits of one record when pulled then the row has status=conflict and a resolve endpoint accepts a chosen version.
- **Impact if wrong:** Silent data conflicts in field records.
- **Web change if wrong:** Highlight conflict rows and add a resolve action in field/sync/page.tsx once the contract is known.
