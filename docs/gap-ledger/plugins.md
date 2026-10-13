# Detailed gap file — module `plugins`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 21, BACKEND-VERIFY 1, REFUTED 1



---
## /plugins  —  `plugins/home.html`

- **Source:** `apps/web/src/app/(app)/plugins/page.tsx`
- **Design reference:** `redesign/plugins/home.html`

### GAP-PLUGINS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Segment loading.tsx paints three stat blocks and a table skeleton (loading.tsx:20-38) although the hub is tiles-only, so content jumps; the tile grid is three columns for four tiles (ModuleHub.tsx:26-34).
- **Verified evidence:** plugins/loading.tsx:24-37 renders three stat cards (g-4) plus a five-row table skeleton though the hub page.tsx is tiles only; that loading file is segment-wide so sub-pages (installed) use it correctly. ModuleHub.tsx:27 renders LinkTiles columns 'three' (LinkTiles.tsx:64 g-3) for the 4 plugin tiles, leaving an orphan tile.
- **Files to change:** `apps/web/src/app/(app)/plugins/loading.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`, `apps/web/src/app/(app)/plugins/page.tsx`
- **Fix steps:**
  1. Add a 'columns' prop to ModuleHub passing through to LinkTiles and set columns='four' in plugins/page.tsx.
  2. Add plugins/page-level skeleton: keep segment loading.tsx but wrap hub in Suspense boundary with tile-grid skeleton, or add hub-specific loading via route group.
- **Acceptance:**
  - Manual: /plugins shows 4 tiles in one row at desktop widths.
  - Load /plugins on slow network; skeleton shows tile grid.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; ModuleHub is shared, default unchanged.
- **Depends on:** ModuleHub

### GAP-PLUGINS-HOME-03  ·  LOW  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub subtitle lists "Installed plugins, marketplace catalogue, hooks and registry" but Installed and Registry are two different endpoints for near-identical concepts (installed/page.tsx:15 vs registry/page.tsx:8).
- **Verified evidence:** Subtitle at plugins/page.tsx:7. Installed uses getPlugins -> /api/v1/plugins/items (loaders.ts:754-759); Registry uses getPluginRegistry -> /api/v1/plugins (_data.ts:89). Two endpoints are real; whether they overlap in meaning is cannot-verify (plugin-service absent).
- **Files to change:** `apps/web/src/app/(app)/plugins/page.tsx`, `apps/web/src/app/(app)/plugins/registry/page.tsx`
- **Fix steps:**
  1. Confirm with plugin-service owners the difference between installed items and registry.
  2. Reword tile notes to state it ('Registry: all plugins known to the platform') or merge pages.
- **Acceptance:**
  - Copy review: Installed and Registry tile notes are clearly distinct.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLUGINS-HOME-04  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Sub-pages use a lucide ArrowLeft back link and a Breadcrumb aria-label on a <nav> that contains a single link (installed/page.tsx:32-34).
- **Verified evidence:** installed/page.tsx (~line 32-34), hooks/page.tsx and registry/page.tsx wrap a lucide ArrowLeft plus one <a href='/plugins'> in <nav aria-label='Breadcrumb'>; a one-item breadcrumb is not a breadcrumb, and notifications pages use PageHeader back prop instead. Also plain <a>, not next/link.
- **Files to change:** `apps/web/src/app/(app)/plugins/installed/page.tsx`, `apps/web/src/app/(app)/plugins/hooks/page.tsx`, `apps/web/src/app/(app)/plugins/registry/page.tsx`, `apps/web/src/app/(app)/plugins/marketplace/page.tsx`
- **Fix steps:**
  1. Remove the nav/ArrowLeft blocks.
  2. Pass back='/plugins' backLabel='Plugins' to PageHeader (or ModuleListPage if it supports it; otherwise add the prop).
- **Acceptance:**
  - Manual: each sub-page shows the standard PageHeader back link; no Breadcrumb nav landmark.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /plugins/hooks  —  `plugins/hooks.html`

- **Source:** `apps/web/src/app/(app)/plugins/hooks/page.tsx`
- **Design reference:** `redesign/plugins/hooks.html`

### GAP-PLUGINS-HOOKS-01  ·  HIGH  ·  partly  ·  theme MISSINGFEATURE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Hooks run tenant code on business events, yet the page is a read-only generic list with no enabled/disabled control, owner plugin or failure count; there is no way to see which plugin owns a hook (mapRows keeps only label/sublabel/status/meta, _data.ts:52-64).
- **Verified evidence:** hooks/page.tsx:12-18 renders the generic ModuleListPage (read-only, no controls). mapRows (_data.ts:68-74) keeps only id/label/sublabel/status/meta so any owner-plugin, enabled or failure fields are dropped. Theme DEADROUTE is wrong: the route exists and works. Whether /api/v1/plugins/hooks returns owner/failure fields cannot be verified (plugin-service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/plugins/hooks/page.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`, `apps/web/src/app/(app)/plugins/HooksTable.tsx`
- **Fix steps:**
  1. Confirm the /api/v1/plugins/hooks fields (owner plugin, enabled, failure count, last run) with plugin-service owners.
  2. Replace the generic mapRows use in getPluginHooks (_data.ts:91) with a typed, zod-validated mapper that keeps those fields.
  3. Create HooksTable.tsx (DataTable) with columns Hook, Event, Owner plugin, Status pill, Failures, Last run.
  4. Only if an enable/disable endpoint exists, add an ActionButton with requireReason mirroring PluginActions.tsx.
  5. Swap ModuleListPage for PageHeader + HooksTable.
- **Acceptance:**
  - With a fixture containing owner and failures, the table shows both columns.
  - A hook with failures>0 shows a warning pill.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Hooks execute tenant code on business events; any toggle needs role gating, reason and audit event server-side.
- **Depends on:** GAP-PLUGINS-HOOKS-02

### GAP-PLUGINS-HOOKS-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic five-column table for every plugin list: ID is a truncated UUID, Status prints the raw string with no pill, Meta prints raw ISO timestamps or codes (ModuleListTable.tsx:46-52) — no plugin-specific columns (version, publisher, scope).
- **Verified evidence:** ModuleListTable.tsx:40-44 hardcodes headers ID/Name/Detail/Status/Meta; ID is row.id.slice(0,8) in a mono span (line 50); status printed raw via `row.status ?? "—"` (line 53) with no StatusPill; meta printed raw (line 54, from _data.ts:61-67: code/currency/updatedAt/createdAt). No version/publisher/scope columns. Shared by all four plugin list pages via ModuleListPage.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginCatalogTable.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`, `apps/web/src/app/(app)/plugins/hooks/page.tsx`
- **Fix steps:**
  1. Create (app)/plugins/PluginCatalogTable.tsx using DataTable from _components/ds with columns Name, Detail, Status (cellType:'status' -> StatusPill), Updated (formatted date).
  2. Only add Version/Publisher/Scope columns after confirming the plugin-service response carries them (service not in snapshot); extend the mapper in _data.ts to keep them.
  3. Drop the truncated-UUID ID column; keep id only as row key.
  4. Replace ModuleListPage on this page with PageHeader + the new table (keep DataSourceBadge/offline via useSeededResource).
- **Acceptance:**
  - Component test: row {name:'A',status:'active'} renders StatusPill 'Active' and no 8-char id text.
  - Manual: no raw ISO timestamp appears in the table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only.

### GAP-PLUGINS-HOOKS-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** mapRows treats a non-array object as one row (extractRows returns [payload], _data.ts:19-26), so an error-shaped JSON body becomes a bogus record with id "row-1" instead of an error state.
- **Verified evidence:** _data.ts:18-26 extractRows returns [payload] for a bare object (line 25) and mapRows falls back to id `row-${index+1}` (line 41). But fetchJson (_data/apiClient.ts:119-172) already returns source:'error' with empty data for non-2xx, 401 and missing base URL, so an error body on a failed HTTP status never reaches mapRows. The bogus row appears only if the gateway returns HTTP 200 with an error-shaped object.
- **Files to change:** `apps/web/src/app/(app)/plugins/_data.ts`
- **Fix steps:**
  1. In (app)/plugins/_data.ts make extractRows return [] instead of [payload] for a plain object with no known array key.
  2. Return null from mapResponse when the shape is unrecognised so fetchJson yields source:'error'; or pass a per-loader zod responseSchema option as getTickets does in _data/loaders.ts.
  3. Remove the synthetic `row-N` id fallback (line 41); skip rows lacking any real id.
  4. Make the page render RefreshErrorState when source==='error' (ModuleListPage currently only forwards source to ModuleListTable).
- **Acceptance:**
  - Unit test: mapRows({error:'x',message:'y'}) returns [] and the loader reports source:'error'.
  - Unit test: {data:[{id:'1',name:'p'}]} still maps to one row.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared by all plugin loaders, check other route groups do not copy the same helper.

### GAP-PLUGINS-HOOKS-04  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** No filter, sort or pagination on this list (ModuleListTable.tsx), unlike Installed which uses DataTable sortable/filterable.
- **Verified evidence:** ModuleListTable.tsx:49-58 renders a plain <table> over every row: no filter, sort or pagination. PluginsTable.tsx:24-27 (Installed) uses DataTable sortable+filterable, but with no pageSize either. Loaders (_data.ts:88-91) pass no limit/page params; whether plugin-service paginates cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginCatalogTable.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`
- **Fix steps:**
  1. Render the list through DataTable with sortable, filterable and pageSize={15} in the shared PluginCatalogTable.
  2. Add pageSize to PluginsTable too for consistency.
  3. If plugin-service supports page/limit, thread them through getPlugin* loaders; otherwise leave client paging and note the cap.
  4. Use distinct empty copy for 'none registered' vs 'no match' (DataTable emptyMessage).
- **Acceptance:**
  - Component test: 30 rows show 15 and a pager; typing in the filter narrows rows.
  - Clicking the Name header reorders rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PLUGINS-HOOKS-02


---
## /plugins/installed  —  `plugins/installed.html`

- **Source:** `apps/web/src/app/(app)/plugins/installed/page.tsx`
- **Design reference:** `redesign/plugins/installed.html`

### GAP-PLUGINS-INSTALLED-01  ·  HIGH  ·  confirmed  ·  theme LOGIC (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Install button is rendered on every row, including plugins that are already Enabled (PluginActions.tsx:47-58), next to Disable; there is no "installed" state distinct from enabled/disabled, so the list is labelled Installed but offers Install.
- **Verified evidence:** PluginActions.tsx:43-54 always renders an 'Install' ActionButton for every row, then Disable if enabled (55-66) or Enable (67-78). No installed/available state exists; PluginRow carries only id/name/status. Data comes from /api/v1/plugins/items so every row is already tenant-provisioned; Install on an Enabled row is meaningless and offers re-provisioning with data access (confirmDescription line 48). Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginActions.tsx`, `apps/web/src/app/(app)/plugins/PluginsTable.tsx`
- **Fix steps:**
  1. Decide semantics with plugin-service owners: what status values exist (enabled, disabled, available/not-installed, pending, error).
  2. In PluginActions.tsx render Install only when status is 'available'/'not_installed'; render Enable/Disable only when installed.
  3. Map each known status to a StatusPill variant and surface unknown ones as-is (see INSTALLED-04).
  4. Move Install to the Marketplace page (see MARKETPLACE-01) if Installed should list only installed plugins.
- **Acceptance:**
  - Component test: status 'enabled' renders Disable only; 'disabled' renders Enable only; 'available' renders Install only.
  - No row shows more than one primary action.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong action could re-provision a plugin with tenant-data access.
- **Depends on:** GAP-PLUGINS-MARKETPLACE-01, GAP-PLUGINS-INSTALLED-04

### GAP-PLUGINS-INSTALLED-02  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Plugin-wide impact without a gate or dependency check: Disable "immediately removes this feature for all tenant users" (PluginActions.tsx:66) yet the only safeguard is a free-text reason; no role check in page.tsx or PluginsTable.tsx, and no confirmation of dependent workflows.
- **Verified evidence:** No role check in installed/page.tsx or PluginsTable.tsx; app/(app)/plugins has no layout.tsx, so only the tenant-level ModuleGate applies elsewhere and none here. The confirm dialog does exist: PluginActions.tsx:61-64 confirmDescription warns 'immediately removes this feature for all tenant users', with requireReason (line 63) via ActionButton. Other modules use requireAnyRole (lib/auth/roleGuard.ts, e.g. crm/document-types/layout.tsx:14). No dependent-workflow check is possible client side. Server enforcement in plugin-service cannot be verified (absent).
- **Files to change:** `apps/web/src/app/(app)/plugins/layout.tsx`, `apps/web/src/app/(app)/plugins/installed/page.tsx`, `apps/web/src/app/(app)/plugins/PluginActions.tsx`
- **Fix steps:**
  1. Add (app)/plugins/layout.tsx calling requireAnyRole(<admin roles>, '/plugins') from lib/auth/roleGuard, as crm layouts do; decide the role list.
  2. Hide or disable PluginActions for callers without the tenant-admin role (pass a canManage prop from the server page).
  3. Ask backend for a dependents endpoint (workflows/hooks depending on the plugin) and show them in the Disable confirmDescription; cannot-verify that one exists.
  4. Confirm plugin-service enforces role and emits an audit event on enable/disable/install.
- **Acceptance:**
  - Non-admin role gets redirect from /plugins/installed.
  - Admin sees Disable with reason required; submit disabled until reason entered.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Plugin toggles affect all tenant users; the UI guard is cosmetic without server enforcement.
- **Depends on:** GAP-PLUGINS-INSTALLED-01

### GAP-PLUGINS-INSTALLED-03  ·  MEDIUM  ·  partly  ·  theme ERRORS (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Error text leaks the raw response body: `throw new Error((await res.text()) || ...)` (PluginActions.tsx:37) surfaces whatever the gateway returns to the confirm dialog.
- **Verified evidence:** PluginActions.tsx:34 `throw new Error((await res.text()) || ...)` does surface the raw proxy response body into the ActionButton dialog error. The dialog itself already exists with mandatory reason (requireReason). Maker-checker/audit are not applicable client-side. Does /api/proxy return sanitized bodies? proxy route not opened; body may be JSON error text shown verbatim.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginActions.tsx`
- **Fix steps:**
  1. Parse the response: try res.json() and read a message/code field; map via toHumanError from @/lib/messages (as installed/page.tsx does).
  2. Fall back to a generic `Could not ${verb} the plugin.` message; never print the raw body.
  3. Log the raw body via the app's telemetry, not console.log.
- **Acceptance:**
  - Unit test: fetch mock returning 500 with body '<html>stack</html>' shows the generic message only.
  - 403 shows a permission message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLUGINS-INSTALLED-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** A row with no id gets all three buttons disabled with no explanation (PluginActions.tsx:41,45-77) and the status cell treats any non-"enabled" string ("pending", "error") as Disabled (PluginsTable.tsx:14-17).
- **Verified evidence:** PluginActions.tsx:39 `disabled = !plugin.id` disables all three buttons with no tooltip/explanation (run() would throw at line 16 anyway). PluginsTable.tsx:17-19 StatusCell shows 'Enabled' only for exact 'enabled', everything else (pending, error, suspended) as 'Disabled' with the grey pill; installed/page.tsx stat 'Disabled' = total - enabled inherits this.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginsTable.tsx`, `apps/web/src/app/(app)/plugins/PluginActions.tsx`, `apps/web/src/app/(app)/plugins/installed/page.tsx`
- **Fix steps:**
  1. Replace StatusCell with StatusPill (label humanized, unknown statuses kept as-is).
  2. Compute the Disabled stat from status==='disabled' and add a separate 'Other' count or hide it.
  3. When id is missing, render a text 'Not manageable' with title/aria-describedby instead of three dead buttons.
  4. Show Enable only for 'disabled', Disable only for 'enabled'.
- **Acceptance:**
  - Row status 'error' displays 'Error' (not 'Disabled') and no Enable button.
  - Row with no id shows explanatory text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PLUGINS-INSTALLED-01

### GAP-PLUGINS-INSTALLED-05  ·  MEDIUM  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pill relies on text but Enable/Disable/Install are three same-weight buttons per row; on phones the actions column overflows since DataTable columns are right-aligned inline-flex (PluginActions.tsx:44).
- **Verified evidence:** Buttons are wrapped in `inline-flex; gap:8; justify-content:flex-end` (PluginActions.tsx:42) inside a right-aligned DataTable column (PluginsTable.tsx:35); no flex-wrap, so three buttons (Install/Enable/Disable-Install) may overflow on narrow screens; DataTable wraps in .tbl-wrap (scroll) so overflow is horizontal scroll not clipping. Status pill has a text label (PluginsTable.tsx:19). 'Same weight' is partly wrong: Install is ghost, Enable primary, Disable danger. Theme PII is wrong. Not rendered-tested.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginActions.tsx`
- **Fix steps:**
  1. Add flexWrap:'wrap' to the wrapper div (line 42).
  2. After INSTALLED-01 only one or two buttons remain per row; verify at 360px width.
  3. Consider an overflow menu for secondary actions.
- **Acceptance:**
  - At 360px viewport the actions cell wraps without horizontal page scroll.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PLUGINS-INSTALLED-01


---
## /plugins/marketplace  —  `plugins/marketplace.html`

- **Source:** `apps/web/src/app/(app)/plugins/marketplace/page.tsx`
- **Design reference:** `redesign/plugins/marketplace.html`

### GAP-PLUGINS-MARKETPLACE-01  ·  HIGH  ·  confirmed  ·  theme MISSINGFEATURE (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Marketplace is described as "Discover and install plugins" (home tile) but the page has no Install action: PluginActions is only mounted on /plugins/installed (installed/page.tsx:58), so a user must find the plugin again there and it may not be listed until provisioned.
- **Verified evidence:** marketplace/page.tsx:12-18 uses ModuleListPage only; PluginActions is imported solely by PluginsTable (used in installed/page.tsx). plugins/page.tsx describes Marketplace as 'Discover and install plugins'. Install is POST /api/proxy/v1/plugins/install with {pluginId, reason} (PluginActions.tsx:20-21). Marketplace rows use ids from /api/v1/plugins/marketplace; whether those ids match the install endpoint's pluginId cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/plugins/marketplace/page.tsx`, `apps/web/src/app/(app)/plugins/MarketplaceTable.tsx`, `apps/web/src/app/(app)/plugins/PluginActions.tsx`
- **Fix steps:**
  1. Create MarketplaceTable.tsx (DataTable) whose row action mounts an install-only variant of PluginActions (split PluginActions into InstallButton/ToggleButtons).
  2. Hide Install for plugins already installed (needs an installed flag from the marketplace API; cannot-verify).
  3. On success router.refresh() and link to /plugins/installed.
  4. Alternatively reword the home tile to 'Browse available plugins' if install is intentionally elsewhere.
- **Acceptance:**
  - Marketplace row shows Install with reason-required dialog.
  - Successful install shows the plugin under /plugins/installed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Install grants tenant-data access; keep reason and role gating.
- **Depends on:** GAP-PLUGINS-INSTALLED-01

### GAP-PLUGINS-MARKETPLACE-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle "Marketplace listings from plugin-service." names an internal service to end users (marketplace/page.tsx:15).
- **Verified evidence:** marketplace/page.tsx:15 description="Marketplace listings from plugin-service." is rendered as the PageHeader subtitle to end users. Same pattern likely in other ModuleListPage callers.
- **Files to change:** `apps/web/src/app/(app)/plugins/marketplace/page.tsx`
- **Fix steps:**
  1. Change description to user-facing copy, e.g. 'Browse plugins available to install for your organisation.'
  2. Grep other ModuleListPage callers for 'from <service>' wording and fix together.
- **Acceptance:**
  - Page subtitle contains no service name.
  - grep -r 'from .*-service\.' apps/web/src/app returns none in user-visible strings.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PLUGINS-MARKETPLACE-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic five-column table for every plugin list: ID is a truncated UUID, Status prints the raw string with no pill, Meta prints raw ISO timestamps or codes (ModuleListTable.tsx:46-52) — no plugin-specific columns (version, publisher, scope).
- **Verified evidence:** ModuleListTable.tsx:40-44 hardcodes headers ID/Name/Detail/Status/Meta; ID is row.id.slice(0,8) in a mono span (line 50); status printed raw via `row.status ?? "—"` (line 53) with no StatusPill; meta printed raw (line 54, from _data.ts:61-67: code/currency/updatedAt/createdAt). No version/publisher/scope columns. Shared by all four plugin list pages via ModuleListPage.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginCatalogTable.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`, `apps/web/src/app/(app)/plugins/marketplace/page.tsx`
- **Fix steps:**
  1. Create (app)/plugins/PluginCatalogTable.tsx using DataTable from _components/ds with columns Name, Detail, Status (cellType:'status' -> StatusPill), Updated (formatted date).
  2. Only add Version/Publisher/Scope columns after confirming the plugin-service response carries them (service not in snapshot); extend the mapper in _data.ts to keep them.
  3. Drop the truncated-UUID ID column; keep id only as row key.
  4. Replace ModuleListPage on this page with PageHeader + the new table (keep DataSourceBadge/offline via useSeededResource).
- **Acceptance:**
  - Component test: row {name:'A',status:'active'} renders StatusPill 'Active' and no 8-char id text.
  - Manual: no raw ISO timestamp appears in the table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PLUGINS-MARKETPLACE-04  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** mapRows treats a non-array object as one row (extractRows returns [payload], _data.ts:19-26), so an error-shaped JSON body becomes a bogus record with id "row-1" instead of an error state.
- **Verified evidence:** _data.ts:18-26 extractRows returns [payload] for a bare object (line 25) and mapRows falls back to id `row-${index+1}` (line 41). But fetchJson (_data/apiClient.ts:119-172) already returns source:'error' with empty data for non-2xx, 401 and missing base URL, so an error body on a failed HTTP status never reaches mapRows. The bogus row appears only if the gateway returns HTTP 200 with an error-shaped object.
- **Files to change:** `apps/web/src/app/(app)/plugins/_data.ts`
- **Fix steps:**
  1. In (app)/plugins/_data.ts make extractRows return [] instead of [payload] for a plain object with no known array key.
  2. Return null from mapResponse when the shape is unrecognised so fetchJson yields source:'error'; or pass a per-loader zod responseSchema option as getTickets does in _data/loaders.ts.
  3. Remove the synthetic `row-N` id fallback (line 41); skip rows lacking any real id.
  4. Make the page render RefreshErrorState when source==='error' (ModuleListPage currently only forwards source to ModuleListTable).
- **Acceptance:**
  - Unit test: mapRows({error:'x',message:'y'}) returns [] and the loader reports source:'error'.
  - Unit test: {data:[{id:'1',name:'p'}]} still maps to one row.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; same fix as HOOKS-03.
- **Depends on:** GAP-PLUGINS-HOOKS-03

### GAP-PLUGINS-MARKETPLACE-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** No filter, sort or pagination on this list (ModuleListTable.tsx), unlike Installed which uses DataTable sortable/filterable.
- **Verified evidence:** ModuleListTable.tsx:49-58 renders a plain <table> over every row: no filter, sort or pagination. PluginsTable.tsx:24-27 (Installed) uses DataTable sortable+filterable, but with no pageSize either. Loaders (_data.ts:88-91) pass no limit/page params; whether plugin-service paginates cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginCatalogTable.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`
- **Fix steps:**
  1. Render the list through DataTable with sortable, filterable and pageSize={15} in the shared PluginCatalogTable.
  2. Add pageSize to PluginsTable too for consistency.
  3. If plugin-service supports page/limit, thread them through getPlugin* loaders; otherwise leave client paging and note the cap.
  4. Use distinct empty copy for 'none registered' vs 'no match' (DataTable emptyMessage).
- **Acceptance:**
  - Component test: 30 rows show 15 and a pager; typing in the filter narrows rows.
  - Clicking the Name header reorders rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PLUGINS-MARKETPLACE-03


---
## /plugins/registry  —  `plugins/registry.html`

- **Source:** `apps/web/src/app/(app)/plugins/registry/page.tsx`
- **Design reference:** `redesign/plugins/registry.html`

### GAP-PLUGINS-REGISTRY-01  ·  MEDIUM  ·  partly  ·  theme COPY (was VALIDATION)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** "Installed plugin registry." (registry/page.tsx:15) duplicates the Installed screen: Installed reads /api/v1/plugins/items (_data.ts:90 vs loaders.ts:755) while Registry reads /api/v1/plugins, with different columns and no actions — two entry points for the same idea, and the home tile calls it "Registered plugin catalogue".
- **Verified evidence:** registry/page.tsx:15 description 'Installed plugin registry.' while getPluginRegistry reads /api/v1/plugins (_data.ts:89) and Installed reads /api/v1/plugins/items (loaders.ts getPlugins, /api/v1/plugins/items). Home tile says 'Registered plugin catalogue' (plugins/page.tsx). Different endpoints and no actions on Registry, so copy overlaps with Installed; whether the data differs cannot be verified (plugin-service absent). Theme VALIDATION is wrong (no form).
- **Files to change:** `apps/web/src/app/(app)/plugins/registry/page.tsx`, `apps/web/src/app/(app)/plugins/page.tsx`
- **Fix steps:**
  1. Confirm with plugin-service owners what /api/v1/plugins lists (all known plugins vs installed).
  2. Reword registry description and the home tile to one consistent meaning, e.g. 'Catalogue of registered plugin definitions (all versions)'.
  3. If identical to Installed, remove the Registry link and route.
- **Acceptance:**
  - Registry and Installed copy distinguish the two lists.
  - Home tile text matches page subtitle.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PLUGINS-REGISTRY-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic five-column table for every plugin list: ID is a truncated UUID, Status prints the raw string with no pill, Meta prints raw ISO timestamps or codes (ModuleListTable.tsx:46-52) — no plugin-specific columns (version, publisher, scope).
- **Verified evidence:** ModuleListTable.tsx:40-44 hardcodes headers ID/Name/Detail/Status/Meta; ID is row.id.slice(0,8) in a mono span (line 50); status printed raw via `row.status ?? "—"` (line 53) with no StatusPill; meta printed raw (line 54, from _data.ts:61-67: code/currency/updatedAt/createdAt). No version/publisher/scope columns. Shared by all four plugin list pages via ModuleListPage.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginCatalogTable.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`, `apps/web/src/app/(app)/plugins/registry/page.tsx`
- **Fix steps:**
  1. Create (app)/plugins/PluginCatalogTable.tsx using DataTable from _components/ds with columns Name, Detail, Status (cellType:'status' -> StatusPill), Updated (formatted date).
  2. Only add Version/Publisher/Scope columns after confirming the plugin-service response carries them (service not in snapshot); extend the mapper in _data.ts to keep them.
  3. Drop the truncated-UUID ID column; keep id only as row key.
  4. Replace ModuleListPage on this page with PageHeader + the new table (keep DataSourceBadge/offline via useSeededResource).
- **Acceptance:**
  - Component test: row {name:'A',status:'active'} renders StatusPill 'Active' and no 8-char id text.
  - Manual: no raw ISO timestamp appears in the table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PLUGINS-REGISTRY-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** mapRows treats a non-array object as one row (extractRows returns [payload], _data.ts:19-26), so an error-shaped JSON body becomes a bogus record with id "row-1" instead of an error state.
- **Verified evidence:** _data.ts:18-26 extractRows returns [payload] for a bare object (line 25) and mapRows falls back to id `row-${index+1}` (line 41). But fetchJson (_data/apiClient.ts:119-172) already returns source:'error' with empty data for non-2xx, 401 and missing base URL, so an error body on a failed HTTP status never reaches mapRows. The bogus row appears only if the gateway returns HTTP 200 with an error-shaped object.
- **Files to change:** `apps/web/src/app/(app)/plugins/_data.ts`
- **Fix steps:**
  1. In (app)/plugins/_data.ts make extractRows return [] instead of [payload] for a plain object with no known array key.
  2. Return null from mapResponse when the shape is unrecognised so fetchJson yields source:'error'; or pass a per-loader zod responseSchema option as getTickets does in _data/loaders.ts.
  3. Remove the synthetic `row-N` id fallback (line 41); skip rows lacking any real id.
  4. Make the page render RefreshErrorState when source==='error' (ModuleListPage currently only forwards source to ModuleListTable).
- **Acceptance:**
  - Unit test: mapRows({error:'x',message:'y'}) returns [] and the loader reports source:'error'.
  - Unit test: {data:[{id:'1',name:'p'}]} still maps to one row.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; same fix as HOOKS-03.
- **Depends on:** GAP-PLUGINS-HOOKS-03

### GAP-PLUGINS-REGISTRY-04  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** No filter, sort or pagination on this list (ModuleListTable.tsx), unlike Installed which uses DataTable sortable/filterable.
- **Verified evidence:** ModuleListTable.tsx:49-58 renders a plain <table> over every row: no filter, sort or pagination. PluginsTable.tsx:24-27 (Installed) uses DataTable sortable+filterable, but with no pageSize either. Loaders (_data.ts:88-91) pass no limit/page params; whether plugin-service paginates cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/plugins/PluginCatalogTable.tsx`, `apps/web/src/app/(app)/plugins/_data.ts`
- **Fix steps:**
  1. Render the list through DataTable with sortable, filterable and pageSize={15} in the shared PluginCatalogTable.
  2. Add pageSize to PluginsTable too for consistency.
  3. If plugin-service supports page/limit, thread them through getPlugin* loaders; otherwise leave client paging and note the cap.
  4. Use distinct empty copy for 'none registered' vs 'no match' (DataTable emptyMessage).
- **Acceptance:**
  - Component test: 30 rows show 15 and a pager; typing in the filter narrows rows.
  - Clicking the Name header reorders rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PLUGINS-REGISTRY-02


---
## Backend verification items (service code absent from snapshot)

### GAP-PLUGINS-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No role gate on a module that installs and disables tenant-wide plugins: plugins/ has no layout.tsx or ModuleGate and no requireAnyRole, so every signed-in user gets the tiles and the Installed page controls. Server RBAC undeterminable (plugin-service absent).
- **Service:** `plugin-service`  ·  **Endpoint(s):** `['GET /api/v1/plugins/items', 'POST /api/v1/plugins/install', 'POST /api/v1/plugins/:id/:verb']`
- **Question:** install/enable/disable must require tenant_admin/platform_admin and be audited; list may be broader.
- **How to verify:** Open plugin-service route files; check role guard on install and verb routes. curl POST install as employee expecting 403.
- **Test to add:** Given employee JWT, when POST plugins/install, then 403.
- **Impact if wrong:** Any user can install or disable tenant-wide plugins.
- **Web change if wrong:** Add plugins/layout.tsx role gate and hide PluginActions for non-admins.


---
## Refuted by deep pass — do NOT implement

### GAP-PLUGINS-INSTALLED-06 · /plugins/installed
- **First-pass claim:** Reason label is per action ("Reason for installing/disabling/enabling") but the reason is optional in the enable POST body only when empty (PluginActions.tsx:25-28), inconsistent with requireReason.
- **Why refuted:** PluginActions.tsx:21-27 (run) sends reason in install and enable/disable bodies (`reason ? JSON.stringify({reason}) : undefined`), but all three ActionButtons set requireReason (lines 50, 63, 76) with per-action reasonLabel, so the reason is always non-empty in practice; the empty-reason branch is unreachable defensive code, not an inconsistency the user sees. Theme I18N is wrong; strings are hardcoded English but that is a separate concern.
