# Detailed gap file — module `admin`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 130, BACKEND-VERIFY 34



---
## /admin  —  `admin/home.html`

- **Source:** `apps/web/src/app/(app)/admin/page.tsx`
- **Design reference:** `redesign/admin/home.html`

### GAP-ADMIN-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** 13 of the 28 admin routes have no tile: audit-log, bulk-scan, config, devices, discovery, gateway-config, gateway-routes, org, role-features, roles, scheduled-jobs, settings and users are reachable only by URL (gateway-config/-routes via links on /admin/gateways). page.tsx:6-22 holds the tile list.
- **Verified evidence:** admin/page.tsx:6-22 lists 15 tiles (14 /admin/* routes + /tenant-admin). Directory listing of apps/web/src/app/(app)/admin shows 27 route folders with page.tsx each; the 13 without a tile are exactly those listed (audit-log, bulk-scan, config, devices, discovery, gateway-config, gateway-routes, org, role-features, roles, scheduled-jobs, settings, users). '28 admin routes' = 27 + the hub. gateway-config/routes are linked only from gateways/page.tsx:22-24.
- **Files to change:** `apps/web/src/app/(app)/admin/page.tsx`
- **Fix steps:**
  1. Add NavTile entries for the 13 missing routes with descriptions, grouped with the existing `section` field of NavTile (e.g. Platform, Tenants and billing, Security and access, Operations).
  2. Confirm with product that each of the 13 is meant for platform admins (some, like users/roles, may be tenant-level) before exposing.
  3. Add a test that fails when a folder under admin/ with page.tsx has no tile or an allow-list entry.
- **Acceptance:**
  - All 13 routes reachable from /admin.
  - Unit test compares tile hrefs with the admin route manifest (navRouteManifest.ts).
  - Tiles grouped under section headings.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Exposes privileged pages (roles, users, audit-log); check route-level authorisation, not only nav visibility.
- **Depends on:** GAP-ADMIN-HOME-04

### GAP-ADMIN-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Tile descriptions over-promise for read-only pages: “Invoices — Billing invoices and payments” and “Operators — Platform team accounts” (page.tsx:14,16), yet those routes only list rows with no payment or account actions.
- **Verified evidence:** admin/page.tsx:12 'Billing invoices and payments' and :17 'Platform team accounts' (obs cited 14,16). InvoicesTable.tsx and OperatorsTable.tsx only define DataTable columns (invoiceNo, tenant, amount, period, dueDate, status / name, role, lastLogin, twoFaStatus, permissions) with no Button/onClick/href: read-only lists, no payment or account actions. Titles use i18n (getTranslations) but tile descriptions are hard-coded English. Also InvoicesTable amount column has no cellType:'amount' (money formatting for paise, CLAUDE.md rule 11).
- **Files to change:** `apps/web/src/app/(app)/admin/page.tsx`
- **Fix steps:**
  1. Reword: Invoices -> 'Billing invoices register (read-only)'; Operators -> 'Platform team directory and 2FA status'.
  2. Move tile titles/descriptions to next-intl messages under `admin`.
  3. Separately check InvoicesTable amount handling (cellType 'amount' expects paise via formatMoney).
- **Acceptance:**
  - Tile copy matches what the destination page can do.
  - Copy served from message catalogue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ADMIN-HOME-04  ·  LOW  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Hub is not in the Sidebar: Sidebar.tsx:142 only links “Tenant Admin” (/tenant-admin); /admin itself is unreachable from navigation. Tiles are a flat list of 15 with no grouping (LinkTiles supports `section`, unused).
- **Verified evidence:** Sidebar.tsx contains a single admin-related entry (:142 'Tenant Admin' -> /tenant-admin); no '/admin' item in Sidebar/AppShell/TopBar. /admin appears only in navRouteManifest.ts:21 and GlobalSearch.tsx:82 (module search landing) and as back links. The hub is therefore reachable by URL, search or back links only. adminTiles (page.tsx:6-22) has no `section` values although LinkTiles.tsx:66-76 supports grouping; 15 tiles in one flat grid. Whether nav visibility is intentionally hidden for non-platform users is cannot-verify.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`, `apps/web/src/app/(app)/admin/page.tsx`
- **Fix steps:**
  1. Add { icon: Shield/Settings, label: 'Platform Admin', href: '/admin', moduleKey: null } to the PLATFORM group in Sidebar.tsx, shown only to platform-admin role (use the existing role gating pattern in Sidebar props).
  2. Add `section` to each NavTile (LinkTiles groups consecutive tiles by section).
  3. Update the nav manifest test if needed.
- **Acceptance:**
  - Platform-admin user sees the item and lands on /admin; tenant users do not.
  - Tile grid shows section headings.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Nav exposure of platform-level admin; gate by role.

### GAP-ADMIN-HOME-05  ·  LOW  ·  partly  ·  theme ICONS (was FABRICATED)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Tile icons are picked by title from a hard-coded TILE_ICONS map (LinkTiles.tsx:10) with a 📁 fallback — none of the admin titles is in the map, so all 15 tiles get the folder emoji, which is what the As-coded panel shows.
- **Verified evidence:** LinkTiles.tsx:10-49 TILE_ICONS has no admin titles, but tileIcon (:53-61) also falls back on href substrings: '/admin/sa-dashboard' contains 'dashboard' -> 📊, so SA Dashboard gets the chart icon; the other 14 tiles get 📁 (FolderOpen via StatIcon.tsx:102). Not 'all 15'. The emoji is mapped to a lucide icon by StatIcon, so the result is a generic folder icon rather than literal emoji. Not fabricated data; it is an undifferentiated-icon issue (FABRICATED tag is wrong).
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`, `apps/web/src/app/(app)/admin/page.tsx`, `packages/types (NavTile, add optional icon) - not in snapshot`
- **Fix steps:**
  1. Add an optional `icon` field to NavTile and let tileIcon() prefer tile.icon (packages/types is not in the snapshot; verify before editing).
  2. Set icons in adminTiles (e.g. 🏢 Tenants, 🧾 Invoices, 🚩 Feature Flags, 🔑 Entitlements) using emoji already mapped in StatIcon.tsx.
  3. Alternative if the type change is not wanted: add the admin titles to TILE_ICONS.
- **Acceptance:**
  - Admin hub tiles show distinct icons.
  - Unmapped emoji still falls back to folder icon.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; TILE_ICONS is shared, keys are title-based so avoid collisions (e.g. 'Assets').


---
## /admin/api-monitoring  —  `admin/api-monitoring.html`

- **Source:** `apps/web/src/app/(app)/admin/api-monitoring/page.tsx`
- **Design reference:** `redesign/admin/api-monitoring.html`

### GAP-ADMIN-API-MONITORING-02  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (healthy = status==="healthy"; degraded = status==="degraded"; Down = total − healthy − degraded) while the table reads the useSeededResource cache (sa.api-monitoring); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs ApiMonitoringTable.tsx).
- **Verified evidence:** Cards are computed server-side from the loader result (api-monitoring/page.tsx:6-8,18-21) but the table renders `rows` from useSeededResource (ApiMonitoringTable.tsx:7), which on server error falls back to the IndexedDB cache (lib/sync/resource.ts:241-249) and shows a 'Showing saved data' badge (DataSourceBadge.tsx:65-68). Cards therefore read 0/0/0/0 (StatCard shows real 0, not dash) while the table is populated.
- **Files to change:** `apps/web/src/app/(app)/admin/api-monitoring/page.tsx`, `apps/web/src/app/(app)/admin/api-monitoring/ApiMonitoringTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into a client component (e.g. ApiMonitoringSummary inside ApiMonitoringTable.tsx) that derives endpoints/healthy/degraded/down from the hook's `rows`, so cards and table share one data source.
  2. Keep page.tsx as a thin server component: fetch, pass `endpoints` + `source`, render <ApiMonitoringTable/> (which now renders StatGrid + Card).
  3. When provenance is 'error-no-data' pass null to StatCard values (StatCard.tsx displayValue renders the dash).
  4. When provenance==='cached' add delta/label 'as of <cachedAt>' on the cards or rely on the badge placed above the grid.
- **Acceptance:**
  - Component test: mock useSeededResource to return cached rows with serverSource 'error'; cards show the counts of the cached rows, not 0.
  - Manual: load page, go offline/block /api/v1/admin/api-monitoring, reload: table and cards agree and badge says saved data.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only ops screen. Same pattern must be applied to editions so both are fixed together.
- **Depends on:** GAP-ADMIN-EDITIONS-02, GAP-ADMIN-API-MONITORING-03

### GAP-ADMIN-API-MONITORING-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** On fetch failure with nothing cached, page.tsx:6-21 gets data [] so all four cards print 0 (StatCard passes 0 through), ApiMonitoringTable shows only the amber badge (DataSourceBadge.tsx:71 'Couldn't load - showing nothing') plus the DataTable EmptyState 'No API data' (ApiMonitoringTable.tsx:25). No RefreshErrorState / retry; error.tsx only catches thrown errors. Loader result carries `status` (apiClient.ts:142-144) but it is unused, so a 403 looks identical. Sibling pages (metadata/records/page.tsx:21-24) render RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/admin/api-monitoring/page.tsx`, `apps/web/src/app/(app)/admin/api-monitoring/ApiMonitoringTable.tsx`
- **Fix steps:**
  1. In page.tsx keep the whole loader result; if source==='error' render <LoadErrorState result={res} area='API monitoring' backHref='/admin'/> (ds/LoadErrorState.tsx: 403 -> PermissionDenied, else RefreshErrorState with router.refresh retry).
  2. Because the table has an offline cache fallback, only show the error state when the hook reports provenance 'error-no-data' (do this inside ApiMonitoringTable) so cached data still displays.
  3. Pass null (dash) to the four StatCards when errored.
  4. Set emptyMessage to a genuine empty message only when source==='api'.
- **Acceptance:**
  - Test: loader returns {source:'error',status:500} with no cache -> RefreshErrorState with Retry visible, cards show dash, no zero.
  - Test: status 403 -> PermissionDenied, no retry button.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Avoid hiding cached data behind the error state (offline support regression).
- **Depends on:** GAP-ADMIN-API-MONITORING-02

### GAP-ADMIN-API-MONITORING-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** “Down” is derived as total − healthy − degraded (api-monitoring/page.tsx:21), so an endpoint with status “unknown”, “maintenance” or a missing status is counted as Down and paints the card red.
- **Verified evidence:** api-monitoring/page.tsx:21 computes Down as endpoints.length - healthy - degraded; healthy/degraded compare lower-cased String(e.status) (lines 7-8). Any other or missing status (String(undefined)='undefined') counts as Down and the card uses the red icon bg #fce7ee. The backend status vocabulary is not visible (admin-service absent).
- **Files to change:** `apps/web/src/app/(app)/admin/api-monitoring/page.tsx`
- **Fix steps:**
  1. Define const DOWN=new Set(['down','unhealthy','error','offline','failed']) (confirm the real enum with the API owner) and count down = filter(status in DOWN).
  2. Add an 'Unknown / other' count (endpoints - healthy - degraded - down) and show it as a fifth card or a delta on Endpoints.
  3. Ideally share the normaliser with the StatusPill map (see -05).
- **Acceptance:**
  - Unit test: rows with status healthy, degraded, down, maintenance, undefined -> healthy 1, degraded 1, down 1, other 2.
  - Manual: endpoint with status 'maintenance' does not increment Down.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ops dashboard misclassification only. Needs the status enum from admin-service (cannot verify here).
- **Depends on:** GAP-ADMIN-API-MONITORING-05

### GAP-ADMIN-API-MONITORING-05  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (ApiMonitoringTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** True: Row = Record<string, unknown> (ApiMonitoringTable.tsx:5) and loader returns Record<string, unknown>[] (loaders.ts:4264-4269), columns keyed by loose strings. Mis-described: StatusPill's fallback is 'info' (blue), not grey (StatusPill.tsx:57), and STATUS_MAP has no healthy/degraded/down/unhealthy/unknown keys at all, so every monitoring status renders as the same blue pill and Healthy vs Degraded vs Down are not colour-distinguishable. API response shape cannot be verified (admin-service not in snapshot).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/admin/api-monitoring/ApiMonitoringTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add to STATUS_MAP in StatusPill.tsx: healthy:'good', degraded:'warn', down:'bad', unhealthy:'bad', unknown:'mut', maintenance:'mut'.
  2. Add type ApiEndpointRow {service,endpoint,p95Latency,errorRate,requestsPerMin,status} in loaders.ts, map in getSAApiMonitoring (mirrors AdminAuditLogEntry style) and use it in ApiMonitoringTable instead of Record<string,unknown>.
  3. Format errorRate with formatPercent (lib/formatters.ts:190) and p95Latency as number once the API unit is confirmed.
- **Acceptance:**
  - Component test: StatusPill status='degraded' has class 'pill warn', 'down' -> 'pill bad'.
  - Type-check: renaming a column key to a non-existent field fails tsc.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** StatusPill is shared by ~80 tables; new keys change colour only for those literal statuses.
- **Depends on:** GAP-ADMIN-API-MONITORING-04


---
## /admin/audit-log  —  `admin/audit-log.html`

- **Source:** `apps/web/src/app/(app)/admin/audit-log/page.tsx`
- **Design reference:** `redesign/admin/audit-log.html`

### GAP-ADMIN-AUDIT-LOG-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Permission denial is presented as an outage: audit-service excludes tenant_admin (page.tsx:6-15 comment), the loader collapses the 403 to source:"error", and the page shows “Couldn’t load audit events — showing nothing” with zeroed stat cards and “No audit events match — Adjust the filters above” (page.tsx:37, AuditLogTable.tsx emptyTitle). The user cannot tell forbidden from failed from empty.
- **Verified evidence:** audit-log/page.tsx:13-18 documents that tenant_admin gets a real 403 relayed as source:'error'. Page renders only <DataSourceBadge source message="Couldn't load audit events - showing nothing"> (line 33), four StatCards with 0 (35-38) and AuditLogTable emptyTitle 'No audit events match' / 'Adjust the filters above' (AuditLogTable.tsx:65-67). The loader result includes status 403 and errorMessage (apiClient.ts:142-144) but the page ignores them; ds/LoadErrorState.tsx already maps 403 to PermissionDenied. Line refs in the finding were off (comment is 13-18).
- **Files to change:** `apps/web/src/app/(app)/admin/audit-log/page.tsx`, `apps/web/src/app/(app)/admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. Change page.tsx to keep the whole result: const res = await getAdminAuditLogEntries().
  2. If res.source==='error' return the page header plus <LoadErrorState result={res} area='audit events' backHref='/admin' requiredRoles={['audit_officer','audit_admin','super_admin','platform_admin']}/> (403 -> access restricted, other -> retry).
  3. Remove the DataSourceBadge and the zeroed StatCards in the error branch (or pass null so they show a dash).
  4. Only render 'No audit events match' when source==='api' and rows are empty; make emptyMessage depend on whether a filter is active.
  5. Decision: hide the Audit Log link from tenant_admin nav if they can never load it.
- **Acceptance:**
  - Test: mock loader {source:'error',status:403} -> 'Access restricted' shown, no stat cards, no empty-table text.
  - Test: status 500 -> Retry button calls router.refresh; status 200 with [] -> 'No audit events yet'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but the requiredRoles copy must match audit-service (source not in snapshot, cannot verify).
- **Depends on:** GAP-ADMIN-DEVICES-02

### GAP-ADMIN-AUDIT-LOG-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Only the newest 200 events are fetched (getAdminAuditLogEntries → /api/v1/admin/audit-logs?limit=200, loaders.ts:4926); the four stats, outcome filter and search all operate on that window client-side, yet the card says “Loaded events” without saying it is capped, and there is no date-range or server-side search for a platform audit trail.
- **Verified evidence:** getAdminAuditLogEntries fetches '/api/v1/admin/audit-logs?limit=200' (loaders.ts:4925-4926); page stats (page.tsx:22-24), outcome filter (AuditLogTable.tsx:18-21) and DataTable search all run client-side on those rows. Card label is 'Loaded events' (page.tsx:35) with no cap notice; no date-range or server search UI. Whether audit-service supports cursor/date/q params cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/admin/audit-log/page.tsx`, `apps/web/src/app/(app)/admin/audit-log/AuditLogTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Quick fix: when entries.length===200 show 'Latest 200 events - refine with the date filter' and relabel card 'Latest events'.
  2. Loader: accept {from,to,outcome,q,cursor} and forward as query params (after backend confirms names); return {rows,nextCursor,total}.
  3. Read filters from searchParams in page.tsx and make the outcome control and a date-range input navigate (router.replace) instead of filtering locally.
  4. Stats (success/failure/actors) must come from a server aggregate endpoint or be dropped; do not derive from a window.
- **Acceptance:**
  - Manual: with >200 seeded events, page states cap and date filter returns events older than the newest 200.
  - Test: changing outcome updates the URL query and triggers a new fetch.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Audit trail completeness: today an auditor can miss events without knowing.
- **Depends on:** GAP-ADMIN-AUDIT-LOG-05

### GAP-ADMIN-AUDIT-LOG-03  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** The audit trail can be exported to CSV (AuditLogTable.tsx exportable, exportFilename “audit-log”) by anyone who can load the page, and the export itself emits no audit event (CLAUDE.md: every mutation/sensitive read audited).
- **Verified evidence:** Real: AuditLogTable.tsx:63-64 sets exportable/exportFilename; DataTable builds the CSV entirely in the browser (DataTable.tsx:274-289) from already-loaded rows (max 200), with no audit call and no role/permission gate prop; page has no requireAnyRole. Overstated: the real access gate is audit-service on the GET (page.tsx:13-16) so only permitted roles see rows; whether that read/exports are audited server-side cannot be verified. Extra: csvCellValue (DataTable.tsx:267-272) does no formula-injection escaping for actor/resource strings.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. Add optional DataTable prop onExport?:(rows)=>void|Promise<void> (called before download) and exportDisabled?:boolean.
  2. In AuditLogTable pass onExport that POSTs an export-audit event through /api/proxy to an audit-emitting endpoint (backend to provide; name is a decision) with filename, row count and filters.
  3. Gate exportable on a role/permission check (requireAnyRole in page.tsx, pass canExport).
  4. In csvCellValue prefix cells starting with = + - @ with an apostrophe.
- **Acceptance:**
  - Test: clicking CSV calls onExport once with row count before the Blob is created.
  - Test: cell '=cmd()' is exported as "'=cmd()".
  - Manual: user without export permission sees no CSV button.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Compliance: export of the audit trail is itself a sensitive read. Shared DataTable change affects ~80 tables (formula escaping is safe to ship globally).
- **Depends on:** GAP-ADMIN-DEVICES-04

### GAP-ADMIN-AUDIT-LOG-04  ·  LOW  ·  partly  ·  theme UUID

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Raw identifiers are printed as-is: actor falls back to the literal “system”, action is a code string, resource is an unlinked free string (AuditLogTable.tsx columns) — no actor name, no link to the resource.
- **Verified evidence:** Table prints String(e.actor), <code>{action}</code> and resource text as-is (AuditLogTable.tsx:49-51) with no links. The loader defaults actor to 'system' (loaders.ts:4933). Whether the API already returns a name/email or a UUID for actor/resource cannot be verified (audit-service absent), so 'raw identifiers' may only apply to some rows.
- **Files to change:** `apps/web/src/app/(app)/admin/audit-log/AuditLogTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Extend AdminAuditLogEntry with optional actorName/resourceHref only if the API provides them; otherwise ask backend to add actorDisplayName and resourceType/resourceId.
  2. Render actor as name with id in a title tooltip; render 'System' (humanized) for the fallback.
  3. Map action codes through humanizeStatus or a small label map; link resource to its detail route when resourceType is known.
- **Acceptance:**
  - Test: entry with actorName renders name, not id; entry without renders 'System'.
  - Manual: click a resource opens its page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-ADMIN-AUDIT-LOG-05  ·  LOW  ·  confirmed  ·  theme DESIGN-SYSTEM (was WIRING)

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Outcome filter is a hand-rolled row of Buttons with aria-pressed and text-transform hacks (AuditLogTable.tsx:31-42) instead of the DS Segmented control.
- **Verified evidence:** Outcome filter is a hand-rolled map of ghost/primary Buttons with aria-pressed and inline fontSize/textTransform (AuditLogTable.tsx:27-40; finding said 31-42). ds/Segmented.tsx exists (options:string[], value, onChange). Caveat: Segmented uses role='tablist'/'tab' without tabpanels, so swap is a consistency win, not an a11y one.
- **Files to change:** `apps/web/src/app/(app)/admin/audit-log/AuditLogTable.tsx`, `apps/web/src/app/_components/ds/Segmented.tsx`
- **Fix steps:**
  1. Replace the button row with <Segmented options={['All','Success','Failure']} value=... onChange=.../> mapping to the union type.
  2. Delete inline style overrides and textTransform.
  3. If server-side filtering (AUDIT-LOG-02) lands, make onChange update searchParams.
- **Acceptance:**
  - Test: clicking Failure filters rows to outcome 'failure'; All restores.
  - Visual: control matches other Segmented usages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.
- **Depends on:** GAP-ADMIN-AUDIT-LOG-02


---
## /admin/bulk-scan  —  `admin/bulk-scan.html`

- **Source:** `apps/web/src/app/(app)/admin/bulk-scan/page.tsx`
- **Design reference:** `redesign/admin/bulk-scan.html`

### GAP-ADMIN-BULK-SCAN-03  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Engineering language in the UI: “There is no … implementation anywhere in the platform … left as an honest placeholder until that backend is built” is shown verbatim to end users (page.tsx notice block). Subtitle promises capability the page does not have.
- **Verified evidence:** bulk-scan/page.tsx:35-37 renders in a role=status box: 'This feature has no backend yet. There is no bulk-scan job queue implementation anywhere in the platform ... left as an honest placeholder until that backend is built.'; also 43-45 ('requires a real scan-job backend'). Subtitle (line 18) 'Queue a WCAG/CWV/accessibility scan across multiple government domains at once.' promises a working feature. Intent is documented in the file header (3-12) as deliberate honesty, but copy is developer-facing.
- **Files to change:** `apps/web/src/app/(app)/admin/bulk-scan/page.tsx`
- **Fix steps:**
  1. Decision: retire the route (notFound / remove) or keep as 'Coming soon'.
  2. If kept: change subtitle to 'Bulk accessibility scans are coming soon.' and replace notice with user copy such as 'Not available yet. Bulk scanning is planned for a future release.' (next-intl key).
  3. Remove references to 'backend', 'implementation', 'platform' in the card texts.
  4. Remove or hide the disabled Queue button (see -04).
- **Acceptance:**
  - Manual: page text contains no engineering words (backend, implementation).
  - Snapshot test on the copy keys.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Do not turn button back on without a real endpoint.
- **Depends on:** GAP-ADMIN-BULK-SCAN-04

### GAP-ADMIN-BULK-SCAN-04  ·  LOW  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Not linked from the /admin hub (admin/page.tsx has no tile) — an unreachable placeholder; disabled control uses hard-coded #9ca3af/opacity .7 inline styles rather than the DS Button disabled state.
- **Verified evidence:** Hub tiles (admin/page.tsx:6-22) contain no Bulk Scan tile and grep of apps/web/src finds no other link to /admin/bulk-scan (only a comment in library/page.tsx:45) - reachable only by URL. The disabled control is a native <button> with inline background #9ca3af, opacity 0.7, cursor not-allowed (bulk-scan/page.tsx:46-62) rather than ds Button.
- **Files to change:** `apps/web/src/app/(app)/admin/bulk-scan/page.tsx`, `apps/web/src/app/(app)/admin/page.tsx`
- **Fix steps:**
  1. Preferred: delete the fake button and card; if kept use <Button disabled> from ds (Button.tsx) with no inline colours.
  2. Either add a hub tile (only once real) or remove the route folder so a URL cannot reach a dead page.
  3. Use design tokens (var(--...)) for the notice colours instead of #fffbeb/#92400e.
- **Acceptance:**
  - Manual: /admin/bulk-scan is either 404 or reachable from the hub, never orphaned.
  - Grep: no '#9ca3af' in the file.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-BULK-SCAN-03


---
## /admin/config  —  `admin/config.html`

- **Source:** `apps/web/src/app/(app)/admin/config/page.tsx`
- **Design reference:** `redesign/admin/config.html`

### GAP-ADMIN-CONFIG-01  ·  HIGH  ·  partly  ·  theme WIRING (was PII)

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** The form is never loaded from the server: useState seeds platformName “CivitasOne”, supportEmail “support@civitasone.in”, locale en-IN, 5 attempts, 30 min, strong-passwords on (page.tsx:12-21) and there is no GET. Opening the page and pressing Save PATCHes those defaults over whatever is actually configured — silent config overwrite.
- **Verified evidence:** Confirmed: config/page.tsx:12-21 seeds useState with platformName 'CivitasOne', supportEmail 'support@civitasone.in', en-IN, 5 attempts, 30 min, enforceStrongPassword true; no GET/useEffect; handleSave PATCHes the whole form (34-38). Not verifiable/possibly worse: the only GET of this resource (tenant-admin/platform-config/page.tsx:4-19,25) returns {controllable:{cacheTtl,rateLimits,logLevel,debugModeUntil,notifications},infrastructure} - none of the form's fields exist there - so the PATCH body may be rejected or ignored by admin-service (absent from snapshot). Also the browser fetches '/api/v1/admin/platform-config' directly (not /api/proxy) and no app/api/v1 route or next.config exists in the snapshot, so it may not authenticate/route at all. No role guard on this page (tenant-admin version uses requireAnyRole). Theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/admin/config/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decision first: confirm with admin-service owner what PATCH /v1/admin/platform-config accepts (zod schema) and whether platformName/supportEmail/etc. exist; align the form with the real GET shape or remove the page.
  2. Add getPlatformConfig loader (fetchJson) in a server component page.tsx; pass config as initial state to a client ConfigForm; on source==='error' render LoadErrorState instead of the form.
  3. Submit through fetch('/api/proxy/v1/admin/platform-config') and send only changed fields; disable Save until dirty.
  4. Add requireAnyRole(['platform_admin','super_admin']) like tenant-admin/platform-config/page.tsx:29.
  5. Add ConfirmDialog before saving security fields (maxLoginAttempts, sessionTimeoutMin, enforceStrongPassword).
- **Acceptance:**
  - Test: page renders values returned by the GET, not literals; Save is disabled until a field changes.
  - Test: GET failure shows error state and no form (cannot overwrite).
  - Manual: change one field, PATCH body contains only that field.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: security policy (login attempts, session timeout, strong password) can be silently reset to defaults by an admin who just presses Save.
- **Depends on:** GAP-ADMIN-CONFIG-04

### GAP-ADMIN-CONFIG-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Mutation is a browser-side PATCH to /api/v1/admin/platform-config (page.tsx:34) while CLAUDE.md says route handlers must enqueue commands (202 Accepted); the success banner says “saved successfully” without knowing whether the command has been applied.
- **Verified evidence:** config/page.tsx:34-38 does a browser PATCH to /api/v1/admin/platform-config and line 44 always says 'Platform configuration saved successfully.' on any res.ok. CLAUDE.md:91 requires route handlers to enqueue a command and return 202, so success may mean 'accepted', not 'applied'. The backend's actual response (200 vs 202) cannot be verified (admin-service absent); the browser-direct URL also bypasses /api/proxy (see CONFIG-01).
- **Files to change:** `apps/web/src/app/(app)/admin/config/page.tsx`
- **Fix steps:**
  1. Send via /api/proxy/v1/admin/platform-config with an x-idempotency-key header (proxy forwards it, api/proxy/[...path]/route.ts FORWARD list).
  2. Branch on res.status===202: show 'Change submitted - it may take a minute to apply' and re-fetch the config after a short delay/poll.
  3. Reserve 'saved successfully' for 200 with the returned values re-rendered into the form.
- **Acceptance:**
  - Test: mocked 202 -> pending message, not 'saved successfully'.
  - Test: 200 -> form reset to returned values.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: false success on security settings.
- **Depends on:** GAP-ADMIN-CONFIG-01

### GAP-ADMIN-CONFIG-05  ·  MEDIUM  ·  partly  ·  theme DESIGN-SYSTEM (was PII)

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Styling is inline hex (#d1d5db, #b42318, #ecfdf5…) and raw inputs rather than DS inputs (page.tsx:9-11); the Support Email default is a real-looking domain baked into client code; the Maintenance Message has no on/off switch so it is unclear when it is shown.
- **Verified evidence:** Inline hex and raw inputs confirmed: config/page.tsx:7-9 (finding said 9-11), 65, 75 use #d1d5db, #b42318, #fef2f2, #ecfdf5 and native <input>/<select>/<textarea>. supportEmail default 'support@civitasone.in' is hardcoded at line 14 (also a CLAUDE.md hardcoded-value violation; placeholder at 113 uses example.gov.in). Maintenance message has only text state (18,147-158) with no enable toggle or schedule. Nothing PII-related, so theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/admin/config/page.tsx`
- **Fix steps:**
  1. Replace inline styles with the DS form classes/tokens (var(--...)) and shared field components used elsewhere.
  2. Delete the hardcoded supportEmail default; initial value comes from server config (CONFIG-01); use placeholder only.
  3. Add a 'Maintenance mode' switch bound to a backend field (confirm exists) and disable the message textarea until on.
- **Acceptance:**
  - Grep: no '#' hex literals in the file.
  - Manual: Maintenance message field is disabled when the switch is off.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; maintenance switch needs a backend field (cannot verify).
- **Depends on:** GAP-ADMIN-CONFIG-01


---
## /admin/devices  —  `admin/devices.html`

- **Source:** `apps/web/src/app/(app)/admin/devices/page.tsx`
- **Design reference:** `redesign/admin/devices.html`

### GAP-ADMIN-DEVICES-01  ·  HIGH  ·  confirmed  ·  theme AUTHZ (was PII)

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** GET /v1/hrms/devices/admin has no requireRole (device-trust/routes.ts:201-203; contrast block/unblock/policy at :254,:285,:327 which require hr_admin, it_admin, super_admin). Any authenticated employee can list every device in the tenant with employee names, codes, departments and last IP (DPDP personal data).
- **Verified evidence:** services/hrms-service/src/modules/device-trust/routes.ts:201-203: GET /v1/hrms/devices/admin calls resolveContext only, no requireRole; block (254), unblock (285) and policy PATCH (327) require hr_admin/it_admin/super_admin. Query is tenant-scoped only (WHERE d.tenant_id, lines ~203-221, LIMIT 200) and the response includes employeeName, employeeCode, department, lastIp, deviceId (lines ~232-250). Web page also has no role guard. Note the web table itself does not display lastIp/department, but the API returns them to any authenticated user.
- **Files to change:** `services/hrms-service/src/modules/device-trust/routes.ts`, `apps/web/src/app/(app)/admin/devices/page.tsx`
- **Fix steps:**
  1. In routes.ts after resolveContext add requireRole(ctx, ['hr_admin','it_admin','super_admin']) (same list as block/unblock); also gate GET /v1/hrms/devices/policy (line 318) if it should not be world-readable.
  2. Add route test: employee token -> 403 FORBIDDEN; hr_admin -> 200.
  3. Web: add requireAnyRole in devices/page.tsx and handle 403 via LoadErrorState (see DEVICES-02).
  4. Optionally emit an audit event for the list read (sensitive read per CLAUDE.md).
- **Acceptance:**
  - Integration test (vitest+supertest): role 'employee' GET /v1/hrms/devices/admin -> 403; 'it_admin' -> 200 with data.
  - Manual: log in as ordinary employee, /admin/devices shows access restricted.
- **Needs:** backend  ·  **Effort:** XS <1h  ·  **Risk:** DPDP exposure today (names, codes, departments, IPs across tenant). Check that no employee-facing screen/mobile app consumes /devices/admin (none in apps/web; mobile not in snapshot).
- **Depends on:** GAP-ADMIN-DEVICES-02

### GAP-ADMIN-DEVICES-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** A failed fetch reads as an empty estate: getData() keeps only r.data (page.tsx:30) and never shows a DataSourceBadge, so an outage renders “Total Devices 0, Trusted 0, Blocked 0” — a security-posture dashboard that looks clean when it is blind.
- **Verified evidence:** devices/page.tsx:22-31 getData returns only r.data (discarding source/status); DevicesPage never renders a DataSourceBadge or error state, so a failed fetch gives items [] and StatCards Total/Trusted/Blocked/Flagged/Android/iOS all 0 (62-67) plus an empty DataTable. Posture screen looks clean when blind.
- **Files to change:** `apps/web/src/app/(app)/admin/devices/page.tsx`
- **Fix steps:**
  1. Return the full LoaderResult from getData (or use the existing loader pattern) and branch on source==='error'.
  2. Render <LoadErrorState result={res} area='devices' backHref='/admin'/> instead of the stats and table.
  3. Pass null to StatCards while errored (never 0).
- **Acceptance:**
  - Test: fetchJson mocked source 'error' status 500 -> retry state, no zeros.
  - Test: status 403 -> PermissionDenied.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-DEVICES-01

### GAP-ADMIN-DEVICES-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Subtitle promises “block, flag, or trust” but the page has no action controls (page.tsx:60-70); block/unblock exist only as API endpoints (routes.ts:252,:283) with no UI, and there is no path to change policy (GET/PATCH /v1/hrms/devices/policy).
- **Verified evidence:** Subtitle 'block, flag, or trust' (devices/page.tsx:58); the page only renders StatGrid + read-only DataTable (61-70), no action column or dialogs. Backend has PATCH /v1/hrms/devices/:id/block (routes.ts:252), /unblock (283), GET/PATCH /devices/policy (318,325) with no web caller (grep of apps/web finds none).
- **Files to change:** `apps/web/src/app/(app)/admin/devices/page.tsx`, `apps/web/src/app/(app)/admin/devices/DevicesTable.tsx (new)`
- **Fix steps:**
  1. Quick: reword subtitle to 'Monitor devices accessing organization data' if actions are out of scope.
  2. Build: create client DevicesTable.tsx with row action Block/Unblock using ds ActionButton + ConfirmDialog (reason textarea) calling fetch('/api/proxy/v1/hrms/devices/'+id+'/block', PATCH {reason}).
  3. router.refresh() after success and toast; show actions only for hr_admin/it_admin/super_admin.
  4. Optional second card for policy via GET/PATCH /devices/policy.
- **Acceptance:**
  - Test: clicking Block opens ConfirmDialog; confirming sends PATCH with reason and refreshes.
  - Test: 403 shows error toast and row unchanged.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Blocking a device cuts an employee's access; needs a confirmation and clear reason capture.
- **Depends on:** GAP-ADMIN-DEVICES-01

### GAP-ADMIN-DEVICES-04  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** DataTable is passed only `exportable` (page.tsx:70): no pageSize, sort or filter, so up to 200 rows (LIMIT 200, routes.ts:~230) render in one unpaginated table; the CSV export of employee/device data has no audit event and no role gate.
- **Verified evidence:** Confirmed: <DataTable columns rows exportable /> only (devices/page.tsx:70); sortable/filterable/pageSize default off (DataTable.tsx:70-72), so up to 200 rows (routes.ts:221 LIMIT 200; finding said ~230) render in one long table; CSV is client-side with no audit or gate (DataTable.tsx:274-289). Nuance: CSV contains only displayed columns (name, device, platform, OS, app version, last active, logins, status, flags), not lastIp/department/employeeCode.
- **Files to change:** `apps/web/src/app/(app)/admin/devices/page.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add sortable filterable filterPlaceholder='Search employee or device...' pageSize={25} exportFilename='devices'.
  2. Apply the shared export gating/audit hook from GAP-ADMIN-AUDIT-LOG-03 (onExport + canExport).
  3. Add a status Segmented filter (All/Trusted/Flagged/Blocked) using the API's ?status= param.
- **Acceptance:**
  - Manual: table shows 25 rows/page with pager, search narrows, sort by Last Active works.
  - Test: export triggers audit call (once hook exists).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-AUDIT-LOG-03, GAP-ADMIN-DEVICES-01

### GAP-ADMIN-DEVICES-05  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** lastSeen is printed as the raw ISO timestamp (no formatter, page.tsx:55); Total Devices counts platform “web” rows while Android + iOS cards do not sum to it; flaggedReason is a free string. The page sits under /admin but is an HR-module resource (hrms-service) and is not in the /admin hub.
- **Verified evidence:** True: lastSeen column has no render so DataTable prints String(value) = raw ISO (devices/page.tsx:48; DataTable.tsx:138); flaggedReason is free text (51); Total = items.length (62) while only Android and iOS are counted (39-40), so other platforms (e.g. web) are unaccounted; /admin/devices is not in hub tiles (admin/page.tsx:6-22) and is backed by hrms-service. Caveat: 'web rows' is inferred; platform values are not visible in the snapshot. formatIndianDate (lib/formatters.ts:2) is date-only dd/MM/yyyy and no datetime/IST formatter exists (AuditLogTable has its own local formatWhen).
- **Files to change:** `apps/web/src/app/(app)/admin/devices/page.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts using toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) returning dash for invalid; unit-test.
  2. Give lastSeen column render: (r)=>formatIndianDateTime(r.lastSeen); reuse it in AuditLogTable.formatWhen.
  3. Add an 'Other' card or replace Android/iOS with a platform breakdown that sums to Total.
  4. Humanize flaggedReason (humanizeStatus) and add a hub tile or move the page under HR admin.
- **Acceptance:**
  - Test: formatIndianDateTime('2026-09-01T10:00:00Z') -> '01 Sept 2026, 3:30 pm' style IST string; null -> dash.
  - Manual: cards Android + iOS + Other = Total.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-AUDIT-LOG-05


---
## /admin/discovery  —  `admin/discovery.html`

- **Source:** `apps/web/src/app/(app)/admin/discovery/page.tsx`
- **Design reference:** `redesign/admin/discovery.html`

### GAP-ADMIN-DISCOVERY-03  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Engineering language in the UI: “There is no … implementation anywhere in the platform … left as an honest placeholder until that backend is built” is shown verbatim to end users (page.tsx notice block). Subtitle promises capability the page does not have.
- **Verified evidence:** discovery/page.tsx:36-39 shows 'This feature has no backend yet. There is no service registry or health-scanner implementation anywhere in the platform ... left as an honest placeholder until that backend is built.' plus line 46 'requires a real discovery backend'; subtitle (line 19) 'Scan and monitor all internal and external services connected to the platform.' promises a capability the page lacks. Deliberate per header 3-13 but developer-facing.
- **Files to change:** `apps/web/src/app/(app)/admin/discovery/page.tsx`
- **Fix steps:**
  1. Decision: retire the route or keep as 'Coming soon'.
  2. If kept: subtitle 'Service discovery is coming soon.' and user-facing notice (next-intl key); drop words backend/implementation.
  3. Remove the 'Initiate Scan' card and 'Registered Services' empty card or collapse into one 'Coming soon' EmptyState.
- **Acceptance:**
  - Manual: no engineering wording on the page.
  - Snapshot test on copy.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-DISCOVERY-04

### GAP-ADMIN-DISCOVERY-04  ·  LOW  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Not linked from the /admin hub (admin/page.tsx has no tile) — an unreachable placeholder; disabled control uses hard-coded #9ca3af/opacity .7 inline styles rather than the DS Button disabled state.
- **Verified evidence:** No Service Discovery tile in admin/page.tsx:6-22 and no other link in apps/web/src (only a comment in library/page.tsx:45), so the page is URL-only. Disabled native <button> uses inline background #9ca3af and opacity 0.7 (discovery/page.tsx:50-62) instead of ds Button.
- **Files to change:** `apps/web/src/app/(app)/admin/discovery/page.tsx`, `apps/web/src/app/(app)/admin/page.tsx`
- **Fix steps:**
  1. Remove the disabled button or use <Button disabled> from ds.
  2. Remove the route or link it from the hub once real (tiles in admin/page.tsx).
  3. Replace hex colours with tokens.
- **Acceptance:**
  - Manual: route is either 404 or linked, not orphaned.
  - Grep: no '#9ca3af'.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-DISCOVERY-03


---
## /admin/editions  —  `admin/editions.html`

- **Source:** `apps/web/src/app/(app)/admin/editions/page.tsx`
- **Design reference:** `redesign/admin/editions.html`

### GAP-ADMIN-EDITIONS-02  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (Active = status==="active"; Total Tenants = Σ Number(tenants); Deprecated = total − active) while the table reads the useSeededResource cache (sa.editions); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs EditionsTable.tsx).
- **Verified evidence:** editions/page.tsx:6-8,18-21 derive all cards from the server loader (getSAEditions, loaders.ts:4229) while EditionsTable.tsx:7 renders rows from useSeededResource('sa.editions') which falls back to cache on error (lib/sync/resource.ts:241-249). On failure with a cache hit the badge says saved data, the table is populated and cards show 0 (Total Editions 0, Active 0, Total Tenants 0, Deprecated 0).
- **Files to change:** `apps/web/src/app/(app)/admin/editions/page.tsx`, `apps/web/src/app/(app)/admin/editions/EditionsTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into EditionsTable (client) and compute total/active/tenants/other from the hook's `rows`.
  2. Keep page.tsx thin: fetch and pass editions + source.
  3. Pass null to StatCards on error-no-data.
- **Acceptance:**
  - Component test: cached rows + server error -> cards match cached rows.
  - Manual: offline reload shows consistent numbers.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-API-MONITORING-02, GAP-ADMIN-EDITIONS-03

### GAP-ADMIN-EDITIONS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** With no cache and a failed fetch, cards show 0 (editions/page.tsx:18-21), DataTable shows EmptyState 'No editions - No platform editions configured' (EditionsTable.tsx:24), and only the amber DataSourceBadge (line 15) signals failure; no RefreshErrorState/retry, status/403 ignored (apiClient.ts:142-144).
- **Files to change:** `apps/web/src/app/(app)/admin/editions/page.tsx`, `apps/web/src/app/(app)/admin/editions/EditionsTable.tsx`
- **Fix steps:**
  1. Keep full loader result; render <LoadErrorState result area='editions' backHref='/admin'/> when provenance is 'error-no-data' (inside EditionsTable, so cached data still shows).
  2. Null the StatCards when errored.
  3. Use empty-state copy only when source==='api'.
- **Acceptance:**
  - Test: error 500 no cache -> retry UI, dash cards.
  - Test: 403 -> PermissionDenied.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-EDITIONS-02, GAP-ADMIN-API-MONITORING-03

### GAP-ADMIN-EDITIONS-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was I18N)

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** “Deprecated” is total − active (editions/page.tsx:20), so drafts or retired editions with any non-“active” status are all labelled Deprecated. The card is also mis-iconed with a clipboard.
- **Verified evidence:** editions/page.tsx:21 (finding said :20) sets Deprecated to editions.length - active where active is status==='active' (line 7), so draft/retired/any other status count as Deprecated. The card icon is 📋 (line 21). Valid status values are not visible (admin-service absent).
- **Files to change:** `apps/web/src/app/(app)/admin/editions/page.tsx`
- **Fix steps:**
  1. Count deprecated as status==='deprecated' (confirm enum) and show 'Other' or 'Draft' separately.
  2. Change icon to a matching one (e.g. archive) and rename label if statuses differ.
  3. Move labels to next-intl keys if the page is localized (admin namespace exists, admin/page.tsx:25).
- **Acceptance:**
  - Unit test: editions [active, draft, deprecated] -> Active 1, Deprecated 1, Draft 1.
  - Visual: icon matches meaning.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-EDITIONS-06

### GAP-ADMIN-EDITIONS-05  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Pricing is a free-text column with no ₹ formatting and no indication of paise vs rupee (EditionsTable.tsx); edition and tenant counts cannot be drilled into — no link to /admin/entitlements or /admin/tenants.
- **Verified evidence:** Pricing is a plain column (key 'pricing', no cellType) in EditionsTable.tsx:20, printed via String(value) (DataTable.tsx:138); no formatting. Whether the API sends paise, rupees or a text string cannot be verified (admin-service absent), so the paise-vs-rupee claim is unproven. Drill-down is true: no rowHref (EditionsTable.tsx:24) although DataTable supports rowHref (DataTable.tsx:56) and /admin/entitlements and /admin/tenants routes exist.
- **Files to change:** `apps/web/src/app/(app)/admin/editions/EditionsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm the pricing field type with the backend; if minor units use cellType:'amount' (formatMoney) or 'rupees' (formatRupees) per DataTable.tsx:127-138; if free text, keep but label as such.
  2. Add rowHref={(r)=>'/admin/entitlements?edition='+encodeURIComponent(String(r.name))} (confirm the entitlements page accepts a filter) and a Tenants link to /admin/tenants.
  3. Never use float math on the amount.
- **Acceptance:**
  - Test: pricing 149900 (paise) renders as the formatted rupee string (if amount).
  - Manual: clicking an edition row opens entitlements.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display: a paise/rupee mix-up shows a 100x wrong price; confirm unit before formatting.

### GAP-ADMIN-EDITIONS-06  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1802 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (EditionsTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** Row = Record<string, unknown> and string keys (EditionsTable.tsx:5,18-22) - true. Mis-described: unknown statuses map to StatusPill 'info' (blue), not grey (StatusPill.tsx:57); STATUS_MAP has 'active', 'draft', 'inactive', 'archived', 'retired' but not 'deprecated', so a deprecated edition renders blue.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/admin/editions/EditionsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add deprecated:'mut' (and sunset if used) to STATUS_MAP.
  2. Add EditionRow type {name,modulesIncluded,pricing,tenants,status} in loaders.ts and map in getSAEditions; use it in EditionsTable.
  3. Confirm status enum with backend and align.
- **Acceptance:**
  - Component test: StatusPill 'deprecated' -> 'pill mut'.
  - tsc fails if column key not in EditionRow.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared StatusPill map.
- **Depends on:** GAP-ADMIN-API-MONITORING-05


---
## /admin/entitlements  —  `admin/entitlements.html`

- **Source:** `apps/web/src/app/(app)/admin/entitlements/page.tsx`
- **Design reference:** `redesign/admin/entitlements.html`

### GAP-ADMIN-ENTITLEMENTS-02  ·  MEDIUM  ·  partly  ·  theme STATE-MISMATCH (was FABRICATED)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (Active = status==="active"; Revoked = total − active; Editions = distinct edition strings) while the table reads the useSeededResource cache (sa.entitlements); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs EntitlementsTable.tsx).
- **Verified evidence:** entitlements/page.tsx:6-8,17-20 computes all four StatCards from the server loader result (getSAEntitlements returns data [] with source 'error' on failure, loaders.ts:4257). EntitlementsTable.tsx:7 renders rows from useSeededResource('sa.entitlements'), which falls back to the encrypted cache when the server result is empty/errored (resource.ts useSeededResource). So on failure with a cache hit the cards show 0 while the table shows cached rows and the badge says 'Showing saved data'. True, but nothing is fabricated/hard-coded, so the FABRICATED tag and the suggested fix are wrong; it is a provenance mismatch (the exact UX-002 class the file comments claim to have fixed for the badge only). Same applies when the server result is legitimately empty and a stale cache exists.
- **Files to change:** `apps/web/src/app/(app)/admin/entitlements/page.tsx`, `apps/web/src/app/(app)/admin/entitlements/EntitlementsTable.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx (no change; already renders null as em dash)`
- **Fix steps:**
  1. Move the StatGrid out of page.tsx into a client component (e.g. EntitlementsSummary in EntitlementsTable.tsx) that receives the same useSeededResource result, or lift the StatGrid into EntitlementsTable and render it above the DataTable.
  2. Compute total/active/other counts from `rows` (the hook's data), not from the server prop.
  3. When provenance === 'error-no-data' pass null to every StatCard value so it shows an em dash; when 'cached' add a delta/sub-label 'as of <cachedAt>'.
  4. Keep page.tsx as a thin server component that only passes entitlements and source.
- **Acceptance:**
  - Component test: mock useSeededResource to return provenance 'cached' with 3 rows and server prop [] -> Total card shows 3, not 0.
  - Component test: provenance 'error-no-data' -> all four cards show an em dash.
  - Manual: load page online, go offline, hard refresh -> cards and table agree.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only display. Do not change useSeededResource semantics, other screens rely on it.
- **Depends on:** GAP-ADMIN-GATEWAYS-02, GAP-ADMIN-ENTITLEMENTS-03

### GAP-ADMIN-ENTITLEMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** page.tsx:6-21 passes the failed loader's [] straight into StatCard as real numbers (0/0/0/0); EntitlementsTable.tsx:16-25 shows the DataTable EmptyState ('No entitlements configured.') and only DataSourceBadge (:15, amber pill 'Couldn't load — showing nothing') signals failure. No RefreshErrorState or retry on this route; error.tsx only catches thrown errors, and the loader never throws. Sibling example that does it right: projects/dashboard/page.tsx:29 gates on source==='error'.
- **Files to change:** `apps/web/src/app/(app)/admin/entitlements/page.tsx`, `apps/web/src/app/(app)/admin/entitlements/EntitlementsTable.tsx`, `apps/web/src/app/(app)/admin/invoices/page.tsx (same pattern, optional)`
- **Fix steps:**
  1. In EntitlementsTable, when provenance === 'error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'entitlements'})} backHref='/admin'/> instead of the DataTable (RefreshErrorState is a client component using router.refresh, ds/RefreshErrorState.tsx).
  2. Pass null (not 0) to StatCard values in the same state; StatCard.displayValue already renders an em dash.
  3. Keep DataSourceBadge for the 'cached' state only.
  4. Extract this into a shared <SeededListState> wrapper because the same pattern is repeated in gateways, invoices, operators, editions.
- **Acceptance:**
  - Component test: provenance 'error-no-data' -> role=alert error with Retry button, no EmptyState text, stat values are em dash.
  - Clicking Retry calls router.refresh (mock next/navigation).
  - Empty but successful response still shows 'No entitlements' EmptyState and zeros.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; make sure a legitimately empty registry is not shown as an error.
- **Depends on:** GAP-ADMIN-ENTITLEMENTS-02, RefreshErrorState

### GAP-ADMIN-ENTITLEMENTS-04  ·  MEDIUM  ·  partly  ·  theme LAYOUT (was CAP)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Entitlements are labelled “Matrix” but rendered as a flat list (EntitlementsTable.tsx); Limit is a string and Used a number with no over-limit cue, so a tenant at or above its cap is not visible.
- **Verified evidence:** Card title 'Entitlement Matrix' (page.tsx:22) over a flat DataTable (EntitlementsTable.tsx:16-26) with columns module/edition/tenant/limit/used/status; no edition x module grid exists. 'used' and 'limit' are rendered raw from Record<string,unknown> rows with no comparison, so an at/over-limit row has no visual cue (confirmed). The claimed types (limit string, used number) cannot be verified because admin-service is not in the snapshot. The suggested fix (server-side pagination) does not match the finding: the loader (loaders.ts:4257) sends no paging params and DataTable pages client-side at 15 rows; whether the API caps results is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/entitlements/EntitlementsTable.tsx`, `apps/web/src/app/(app)/admin/entitlements/page.tsx`
- **Fix steps:**
  1. Rename the card to 'Entitlements' (or build a real module x edition matrix if the product wants it; decision).
  2. Add a computed 'Usage' column via a render function: parse limit/used as numbers (treat 'unlimited'/null as no cap) and show used/limit with ProgressBar (ds/ProgressBar) and a 'bad' pill at >=100%, 'warn' at >=90%.
  3. Add a stat card 'At/over limit' from the same rows.
  4. Confirm API response shape with backend before typing rows as a zod-parsed EntitlementRow.
- **Acceptance:**
  - Unit test: used=100, limit='100' -> row rendered with over-limit indicator and text (not colour alone).
  - limit null/'unlimited' -> no indicator.
  - Card heading matches actual layout.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong parsing of limit strings could show false over-limit warnings.

### GAP-ADMIN-ENTITLEMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Editions card counts distinct String(e.edition ?? "") (entitlements/page.tsx:22): rows without an edition collapse into an empty-string “edition”, inflating the count by one.
- **Verified evidence:** entitlements/page.tsx:20 uses new Set(entitlements.map(e => String(e.edition ?? ''))).size; rows with undefined/null edition all map to '' and add one extra distinct value. Also case/whitespace variants count separately. (Observation cited line 22; actual line 20.)
- **Files to change:** `apps/web/src/app/(app)/admin/entitlements/page.tsx`
- **Fix steps:**
  1. Build the set from non-empty trimmed values: new Set(rows.map(e => String(e.edition ?? '').trim()).filter(Boolean)).size.
  2. Optionally lower-case for the count only if editions are case-insensitive keys (verify with backend).
  3. Fold into the summary component from ENTITLEMENTS-02 so it counts the displayed rows.
- **Acceptance:**
  - Unit test: rows [{edition:'psu'},{edition:'psu'},{}] -> Editions = 1.
  - Rows all without edition -> 0 (or em dash).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.
- **Depends on:** GAP-ADMIN-ENTITLEMENTS-02

### GAP-ADMIN-ENTITLEMENTS-06  ·  LOW  ·  partly  ·  theme TYPES (was STATUS)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (EntitlementsTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** EntitlementsTable.tsx:5-6 defines Row = Record<string, unknown> and loaders.ts:4257 types the result the same, so columns keys are unchecked (confirmed). StatusPill (ds/StatusPill.tsx:5-39) maps active/expired/draft but not 'revoked', 'suspended' or 'trial'; unknown values fall to variant 'info' (blue, civitas-ds.css:127), not grey as stated. Real status enum is cannot-verify (admin-service absent).
- **Files to change:** `apps/web/src/app/(app)/admin/entitlements/EntitlementsTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Define EntitlementRow type (module, edition, tenant, limit, used, status) in loaders.ts and a zod schema passed as fetchJson responseSchema; type getSAEntitlements as LoaderResult<EntitlementRow[]>.
  2. Type DataTable<EntitlementRow> and columns with keyof EntitlementRow.
  3. Once the enum is confirmed with backend, add revoked/suspended -> bad|warn to STATUS_MAP.
- **Acceptance:**
  - tsc fails if a column key is not in EntitlementRow.
  - StatusPill test: 'revoked' renders class pill bad.
  - Invalid payload yields source 'error' rather than crashing.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; StatusPill map change affects every screen using it, add only unambiguous keys.

### GAP-ADMIN-ENTITLEMENTS-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** “Revoked” = total − active (page.tsx:21) also counts suspended/expired/draft entitlements.
- **Verified evidence:** page.tsx:7 counts active = status==='active' and :19 renders 'Revoked' as entitlements.length - active, so suspended/expired/draft/trial all count as revoked. (Observation cited line 21; actual line 19.)
- **Files to change:** `apps/web/src/app/(app)/admin/entitlements/page.tsx`
- **Fix steps:**
  1. Count revoked as status === 'revoked' explicitly, and add an 'Other / inactive' bucket or rename card to 'Not active'.
  2. Reuse the same status normaliser (lower-case) as `active`.
  3. Move to the shared summary from ENTITLEMENTS-02.
- **Acceptance:**
  - Unit test: statuses [active, revoked, expired, draft] -> Active 1, Revoked 1, Not active 3 (or per chosen labels).
  - Label matches its count semantics.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible; need the real status enum to name buckets.
- **Depends on:** GAP-ADMIN-ENTITLEMENTS-02


---
## /admin/feature-flags  —  `admin/feature-flags.html`

- **Source:** `apps/web/src/app/(app)/admin/feature-flags/page.tsx`
- **Design reference:** `redesign/admin/feature-flags.html`

### GAP-ADMIN-FEATURE-FLAGS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** Kill switch is one click with no confirmation and no undo: the button calls POST /:id/kill immediately (FeatureFlagsManager.tsx:66-75,177), after which both the Kill button and the Enabled toggle are disabled (`disabled={flag.killSwitch …}`, :169,:178). A mis-click permanently disables a platform feature for every tenant from this screen.
- **Verified evidence:** apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx:174-183 Kill button onClick={() => void handleKillSwitch(flag.id)} -> :66-73 callApi(`/${id}/kill`,'POST') immediately, no dialog, no reason in the body, no audit context sent. After success refresh() sets killSwitch true and both the Kill button (:178) and toggle (:169) are disabled; there is no un-kill control on this screen. Whether the backend has an un-kill or emits audit events cannot be verified (admin-service not in snapshot). ds/ConfirmDialog.tsx already supports danger + requireReason (maker-checker) with focus trap and Esc.
- **Files to change:** `apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx`
- **Fix steps:**
  1. Add state killTarget: AdminFeatureFlagRow | null; the Kill button only sets it.
  2. Render <ConfirmDialog open danger requireReason title='Kill switch: <name>' description='Disables this feature for every tenant immediately.' busy={busyId===id} errorMessage={error} onConfirm={reason => handleKillSwitch(id, reason)} onCancel=...>.
  3. Send { reason } as JSON body in callApi(`/${id}/kill`,'POST',{reason}) only after confirming the backend schema accepts it (zod at route).
  4. Confirm with backend that the kill route emits an audit event and enforces a permission distinct from toggle; add an un-kill route/UI or state in the dialog that it is irreversible from this screen.
  5. Remove the inline #dc2626/#ccc styling (see -05) so the danger variant carries.
- **Acceptance:**
  - Component test: clicking Kill opens the dialog and no fetch is made; Confirm disabled until reason non-empty; confirming POSTs once with reason.
  - Esc/cancel leaves flag unchanged.
  - Backend test (separate): kill emits audit event containing actor + reason.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High-impact action (platform-wide feature disable); the reason field needs a backend contract or it will be dropped/rejected.

### GAP-ADMIN-FEATURE-FLAGS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Failed load looks like an empty registry: on source:"error" the badge shows but the table still renders “No feature flags configured yet.” and four zero cards (FeatureFlagsManager.tsx:~103,:143), inviting the operator to create duplicates.
- **Verified evidence:** apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx:122 renders only DataSourceBadge source={source}; on source 'error' initialFlags is [] (loaders.ts:4994) so :129-132 show four 0 cards and :157-159 shows 'No feature flags configured yet.' with an enabled '+ Create Flag' button (:138). Observation line numbers (~103,~143) were off. Note the badge here uses the legacy `source` prop (no cache), which is correct for this page since it does not use useSeededResource.
- **Files to change:** `apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx`, `apps/web/src/app/(app)/admin/feature-flags/page.tsx`
- **Fix steps:**
  1. If source==='error' render <RefreshErrorState error={toHumanError('load',{area:'feature flags'})} backHref='/admin'/> in place of the stat grid and registry card.
  2. Otherwise keep the current UI; pass null to StatCards when errored.
  3. Disable '+ Create Flag' while errored to avoid duplicate key creation.
  4. After a client refresh() failure (line 58 silently returns), surface an error too.
- **Acceptance:**
  - Component test: source 'error' -> alert with Retry, no 'No feature flags' text, no Create button.
  - source 'api' with [] -> empty message and enabled Create.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-ADMIN-FEATURE-FLAGS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Flags can only be created (always enabled:false), toggled or killed: rollout %, segments, name and description cannot be edited afterwards (no PATCH path in FeatureFlagsManager.tsx), so “gradual rollout controls” in the subtitle is only settable at creation; the `owner` field in AdminFeatureFlagRow is never shown.
- **Verified evidence:** apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx:78 only PUTs {enabled}; :69 kill; :100 POST on create with name/description/rolloutPercent/targetSegments; no edit path, so rollout %, segments, name and description are fixed after creation (subtitle at :121 promises 'gradual rollout controls'). AdminFeatureFlagRow.owner (loaders.ts:4991) is mapped but never rendered in the table (:147-153). Whether the backend PUT accepts rolloutPercent/targetSegments is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add an Edit action per row opening a dialog (reuse the create form as FlagForm with defaultValues) that PUTs {rolloutPercent,targetSegments,name,description} to /feature-flags/manage/:id.
  2. Validate the form with a zod schema (key pattern, 0-100 integer, segments array) before submit.
  3. Add an Owner column bound to flag.owner, or delete owner from the row type if the API does not fill it.
  4. Confirm with backend which fields PUT accepts; if none, change the subtitle instead.
- **Acceptance:**
  - Editing rollout 10 -> 50 sends PUT with rolloutPercent 50 and the table updates after refresh.
  - Owner column shows value or em dash.
  - Killed flags cannot be edited.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Rollout changes affect live traffic; require confirm on rollout increase and audit event server-side.
- **Depends on:** GAP-ADMIN-FEATURE-FLAGS-01

### GAP-ADMIN-FEATURE-FLAGS-05  ·  MEDIUM  ·  confirmed  ·  theme DS-CONSISTENCY (was CAP)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Table is a hand-rolled <table className="data-table"> inside overflowX:auto (:139-186) instead of DataTable — no sort/filter/pagination and no mobile transform; toggle is a bare checkbox in a .toggle label, kill button overrides the DS danger style with inline #dc2626/#ccc.
- **Verified evidence:** apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx:143-188 hand-rolled <table className='data-table'> in overflowX:auto instead of DataTable (no sort/filter/pagination; the DataTable in ds/DataTable.tsx supports sortable/filterable/pageSize). Toggle is a checkbox in label.toggle (:168-171). Kill Button variant='danger' is overridden with inline #dc2626/#ccc, padding, radius (:180). Registry is small so pagination is minor; the real risk is the inline colours and a11y. Note DataTable has a mobile transform only if that is implemented in ds; not re-verified.
- **Files to change:** `apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx`
- **Fix steps:**
  1. Replace the table with <DataTable<AdminFeatureFlagRow> columns=[...] sortable filterable pageSize={15}> using render/cellType for Status, Rollout and actions (check DataTable column render API before use).
  2. Delete the inline style on the Kill Button; rely on variant='danger' and use disabled for killed state.
  3. Replace status <span className='pill'> with StatusPill or keep getStatusBadge but map to existing pill classes.
  4. Add a visible text label 'On/Off' next to the toggle and role='switch' for the input.
- **Acceptance:**
  - Filter box narrows flags by name/key.
  - Snapshot: no inline hex colour left in the file.
  - Keyboard: toggle and kill reachable and announced with names.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep aria-labels on row actions.

### GAP-ADMIN-FEATURE-FLAGS-06  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Create dialog uses a div.modal-overlay with role="dialog" aria-modal but no focus management or Escape handling in this file; success of create closes silently with no toast.
- **Verified evidence:** apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx:192-193 create modal is a div.modal-overlay role='dialog' aria-modal='true' with no focus move, focus trap, Escape handler or overlay-click close (none in this file; no grep hit for keydown/Escape), and no focus return. Create success just does setShowModal(false) then refresh() (:111-112) with no toast; useToast exists in ds/Toast.tsx (requires ToastProvider, not verified mounted for this route).
- **Files to change:** `apps/web/src/app/(app)/admin/feature-flags/FeatureFlagsManager.tsx`
- **Fix steps:**
  1. Extract the form into a modal that reuses the focus/Esc logic of ds/ConfirmDialog (or add a generic ds Dialog wrapper if ConfirmDialog cannot host a form).
  2. On mount focus the Name input; on close return focus to the '+ Create Flag' button.
  3. Call useToast().success('Flag created') after a successful create.
  4. Close on Escape and overlay click unless creating is true.
- **Acceptance:**
  - Component test: Escape closes the modal; focus starts in Name and returns to trigger.
  - Successful create shows a toast with the flag name.
  - axe: no focus-order violations.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-FEATURE-FLAGS-01


---
## /admin/gateway-config  —  `admin/gateway-config.html`

- **Source:** `apps/web/src/app/(app)/admin/gateway-config/page.tsx`
- **Design reference:** `redesign/admin/gateway-config.html`

### GAP-ADMIN-GATEWAY-CONFIG-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** A failed config load is displayed as a security downgrade: with config === null the JWT Verification card evaluates to “Off” and Upstream Timeout falls back to a fabricated “15s” (page.tsx:130-131: `config?.jwtEdgeVerify === "true" ? "Enforcing" : … "Audit" : "Off"`, `?? 15000`), beside the error banner. An operator scanning the cards sees “JWT: Off”.
- **Verified evidence:** apps/web/src/app/(app)/admin/gateway-config/page.tsx:113-134: when the load fails fetchConfig sets error (:34-37) and config stays null; the page still renders the StatGrid where :130 evaluates config?.jwtEdgeVerify === 'true' ? 'Enforcing' : ... 'audit' ? 'Audit' : 'Off' -> 'Off', and :131 `${(config?.upstreamTimeoutMs ?? 15000)/1000}s` -> '15s' (fabricated default). Rate Limit (:133) and Breakers (:132) do correctly show an em dash. Error banner is at :136-140 with no retry.
- **Files to change:** `apps/web/src/app/(app)/admin/gateway-config/page.tsx`
- **Fix steps:**
  1. Compute const errored = !config; render JWT Verification as config ? label : null and Upstream Timeout as config ? `${config.upstreamTimeoutMs/1000}s` : null so StatCard shows an em dash.
  2. Render <RefreshErrorState> (or ErrorState with onRetry={() => { setLoading(true); void fetchConfig(); }}) when config is null and error is set; do not show the four stat cards then.
  3. Replace the exact-match ternary with a lookup so an unexpected jwtEdgeVerify value shows 'Unknown', not 'Off'.
  4. Add a retry that re-calls fetchConfig.
- **Acceptance:**
  - Component test: fetch /api/v1/admin/platform-config/gateway returns 500 -> no 'Off' and no '15s' text, retry control present.
  - Successful load with 'off' still shows 'Off'.
  - Unknown value 'x' -> 'Unknown'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Security-signal accuracy: showing JWT 'Off' falsely is misleading, but removing the ternary fallback must not hide a real 'off' setting.

### GAP-ADMIN-GATEWAY-CONFIG-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Breaker status is read from /api/ops/breakers (page.tsx:57), a different prefix from every other admin call (/api/v1/admin/…); on failure the card shows ErrorState and the stat card shows “—” but Save stays enabled. Numbers are unbounded text→Number (NumberInput onChange Number(e.target.value)) so an empty field becomes 0 before server validation.
- **Verified evidence:** apps/web/src/app/(app)/admin/gateway-config/page.tsx:57 fetches /api/ops/breakers (other calls use /api/v1/admin/platform-config/gateway, :33/:89) - true, but the route handler under apps/web/src/app/api/ops was not found in the snapshot (cannot-verify whether it exists or is proxied). Breaker failure shows ErrorState (:216-217) and stat card em dash (:132) - true. 'Save stays enabled' is only mildly relevant: Save (:247) is independent of breaker status. NumberInput (:267-278) uses onChange(Number(e.target.value)); an empty field becomes 0, and min/max are only HTML attributes on inputs not inside a <form>, so nothing blocks Save. Save is disabled while saving (:247) already. Server validation errors are shown per field via formError.fieldError, so server-side validation exists in some form (backend not verifiable).
- **Files to change:** `apps/web/src/app/(app)/admin/gateway-config/page.tsx`
- **Fix steps:**
  1. Define a zod schema GatewayConfigSchema with the same min/max as the NumberInput props (authRateLimitMax 3-1000, bodyLimitBytes 1024-52428800, rateLimitMax 10-100000, rateLimitTenantMax 10-10000, cbFailureThreshold 1-50, cbRecoveryMs 1000-300000, upstreamTimeoutMs 1000-120000) and refine tenantMax <= rateLimitMax if backend requires it.
  2. Keep NumberInput value as string state (or number | ''), parse on blur; do not coerce '' to 0.
  3. In handleSave run schema.safeParse(config); on failure set field errors and return without fetching.
  4. Disable Save while invalid or unchanged (dirty check against the loaded config).
  5. Confirm with backend whether /api/ops/breakers is a real route; if it should live under /api/v1/admin, move it.
- **Acceptance:**
  - Unit test: clearing Global Rate Limit and pressing Save shows a field error and sends no PATCH.
  - Value below min is rejected client-side with the min in the message.
  - Unchanged form has Save disabled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Config saved live at the edge (page subtitle: changes take effect immediately); a wrong bound could block a valid emergency change, copy bounds from the backend schema.

### GAP-ADMIN-GATEWAY-CONFIG-05  ·  LOW  ·  confirmed  ·  theme DS-CONSISTENCY (was PII)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Inline hex colours (#6b7280, #d1d5db, #059669…) and a fixed 1fr 1fr grid (page.tsx:~150) that does not collapse on phones; raw ms/bytes fields with a derived-unit hint instead of unit-aware inputs.
- **Verified evidence:** apps/web/src/app/(app)/admin/gateway-config/page.tsx:149 gridTemplateColumns '1fr 1fr' fixed (no responsive collapse; the same file has no media query; inline styles can't collapse). Inline hex colours at :159,:173,:202,:207,:219,:223,:230-231,:260,:262,:278. Fields are raw numbers in ms/bytes with derived-unit hints (:173 formatBytes, :202/:207 seconds). Not PII: the PII tag is wrong; no secrets are shown on this page.
- **Files to change:** `apps/web/src/app/(app)/admin/gateway-config/page.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Replace the inline grid with an existing DS grid class (e.g. className='grid g-2' if defined; otherwise add .g-2 with a 1-column media query in civitas-ds.css).
  2. Replace hex colours with tokens (--mut, --bad, --good, --line).
  3. Optionally add a duration/size input (value + unit select) as a small shared component; not required.
  4. Use the shared Select/Input component if ds provides one.
- **Acceptance:**
  - At 375px width the cards stack in one column with no horizontal scroll.
  - No hex literal remains in gateway-config/page.tsx.
  - Dark theme readable.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /admin/gateway-routes  —  `admin/gateway-routes.html`

- **Source:** `apps/web/src/app/(app)/admin/gateway-routes/page.tsx`
- **Design reference:** `redesign/admin/gateway-routes.html`

### GAP-ADMIN-GATEWAY-ROUTES-02  ·  MEDIUM  ·  confirmed  ·  theme RAW-ID (was UUID)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Raw ids: the ID column prints row.id.slice(0, 8) in monospace (ModuleListTable.tsx:50), so “hrms-leave-requests” and “hrms-leave-approvals” both render as “hrms-lea”; the id is derived by a fallback chain id ?? key ?? code ?? name ?? agentId … ?? `row-N` (gateway-routes/_data.ts:34-46) built for many modules, not for route entries.
- **Verified evidence:** _components/ModuleListTable.tsx:50 renders <span className='mono'>{row.id.slice(0, 8)}</span>, so ids sharing an 8-char prefix ('hrms-leave-requests', 'hrms-leave-approvals') both show 'hrms-lea' (React key uses full id at :49, so no crash). ID derivation chain is in gateway-routes/_data.ts:54-63 (obs cited 34-46), generic for many modules and ends in `row-N`. Actual catalogue ids/fields cannot be verified (gateway-service absent).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/admin/gateway-routes/_data.ts`, `apps/web/src/app/(app)/admin/gateway-routes/page.tsx`
- **Fix steps:**
  1. Build a dedicated GatewayRoutesTable (client, DataTable) for this page instead of ModuleListPage, with a route-specific mapper in _data.ts.
  2. In that table show the full route id (or method + path) with title attribute and copy affordance; drop slice(0,8).
  3. In ModuleListTable itself, show the label first and put the id in a title/tooltip; only truncate UUID-shaped ids (regex) and not slugs.
  4. Remove `row-N` synthetic ids from display.
- **Acceptance:**
  - Unit test: two rows with ids 'hrms-leave-requests' and 'hrms-leave-approvals' render distinguishable text.
  - UUID ids still shortened with full value in title.
  - Existing ModuleListPage users' tests updated.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** ModuleListTable is shared by many module pages; change truncation conditionally to avoid snapshot churn.
- **Depends on:** GAP-ADMIN-GATEWAY-ROUTES-03

### GAP-ADMIN-GATEWAY-ROUTES-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Generic ModuleListPage table for a route catalogue: columns ID / Name / Detail / Status / Meta (ModuleListTable.tsx:41-47) with no path/method/upstream columns, no search, sort or pagination; Detail repeats Status when the row has no description (sublabel = description ?? status) and Meta is a raw ISO updatedAt string.
- **Verified evidence:** ModuleListTable.tsx:37-58 is a plain <table> with fixed columns ID/Name/Detail/Status/Meta, no filter/sort/pagination (DataTable not used). _data.ts:73-75 sublabel = description ?? status ?? state ..., so Detail duplicates Status when there is no description (:82 status is the same field); meta :83-86 = code ?? currency ?? updatedAt ?? createdAt, raw string. mapRows into ModuleRowSummary drops any path/method/upstream fields, so those columns cannot be shown without a new mapper; the catalogue payload shape is cannot-verify (gateway-service absent). Fix text about server-side pagination in the input does not apply.
- **Files to change:** `apps/web/src/app/(app)/admin/gateway-routes/_data.ts`, `apps/web/src/app/(app)/admin/gateway-routes/page.tsx`, `apps/web/src/app/(app)/admin/gateway-routes/GatewayRoutesTable.tsx (new)`
- **Fix steps:**
  1. Confirm the /api/v1/gateway/catalogue response fields with gateway-service; define GatewayRouteRow {id, method, path, upstream, status, updatedAt} and a zod responseSchema in fetchJson.
  2. Create GatewayRoutesTable.tsx using DataTable with sortable, filterable, pageSize 25 and useSeededResource + DataSourceBadge like GatewaysTable.
  3. Format updatedAt with the shared date formatter from lib/formatters (tenant locale).
  4. Show '—' rather than repeating status when there is no description.
  5. Render RefreshErrorState on error-no-data.
- **Acceptance:**
  - Table shows Method, Path, Upstream, Status, Updated.
  - Search 'leave' filters rows.
  - Date renders as a localised date, not an ISO string.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; read-only catalogue.
- **Depends on:** GAP-ADMIN-GATEWAY-ROUTES-02

### GAP-ADMIN-GATEWAY-ROUTES-04  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Bespoke <nav className="back"> with a lucide ArrowLeft and “Admin” link (page.tsx:9-14) instead of PageHeader back=/admin used by sibling pages; card title “Records” and empty copy “Nothing to show yet for this module.” are module-agnostic.
- **Verified evidence:** gateway-routes/page.tsx:11-13 uses a bespoke <nav aria-label='Breadcrumb' className='back'> with a lucide ArrowLeft and a plain <a href='/admin'> (full page reload, not next/link). Sibling admin pages use PageHeader back='/admin' (e.g. gateways/page.tsx:19). ModuleListPage renders PageHeader without a back prop (ModuleListPage.tsx:23). Card title 'Records' (ModuleListTable.tsx:27) and empty copy 'Nothing to show yet for this module.' (:35) are generic.
- **Files to change:** `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/admin/gateway-routes/page.tsx`
- **Fix steps:**
  1. Add optional back/backLabel props to ModuleListPage and forward them to PageHeader.
  2. Delete the custom <nav> and ArrowLeft import in gateway-routes/page.tsx; pass back='/admin'.
  3. Add optional cardTitle/emptyTitle/emptyMessage props to ModuleListPage->ModuleListTable with the current text as defaults; pass 'Routes' and 'No routes registered'.
  4. Add a Retry error state (see ENTITLEMENTS-03).
- **Acceptance:**
  - Back link renders via PageHeader on this route and works client-side.
  - Empty catalogue shows route-specific copy.
  - Other ModuleListPage pages unchanged (snapshots).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** ModuleListPage is shared; props must be optional.
- **Depends on:** GAP-ADMIN-GATEWAY-ROUTES-03


---
## /admin/gateways  —  `admin/gateways.html`

- **Source:** `apps/web/src/app/(app)/admin/gateways/page.tsx`
- **Design reference:** `redesign/admin/gateways.html`

### GAP-ADMIN-GATEWAYS-02  ·  MEDIUM  ·  partly  ·  theme STATE-MISMATCH (was FABRICATED)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (Active = status==="active"; Degraded = status==="degraded"; Standby = total − active − degraded) while the table reads the useSeededResource cache (sa.gateways); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs GatewaysTable.tsx).
- **Verified evidence:** gateways/page.tsx:6-8,27-30 compute the four cards from the server loader result (getSAGateways returns [] on error, loaders.ts:4222) while GatewaysTable.tsx:7 renders rows from useSeededResource('sa.gateways'), which falls back to cache; with cache hit, cards read 0 against a populated table and the badge says 'Showing saved data'. Real but nothing is fabricated/hard-coded, so FABRICATED tag and suggested fix are wrong; same root cause as ENTITLEMENTS-02.
- **Files to change:** `apps/web/src/app/(app)/admin/gateways/page.tsx`, `apps/web/src/app/(app)/admin/gateways/GatewaysTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into GatewaysTable (or a client GatewaysSummary) using the rows from useSeededResource.
  2. Pass null to StatCards when provenance === 'error-no-data'.
  3. Keep page.tsx thin (header, links, table).
- **Acceptance:**
  - Component test: provenance 'cached' with 4 rows -> Total 4.
  - provenance 'error-no-data' -> em dashes.
  - Online load unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-ENTITLEMENTS-02, GAP-ADMIN-GATEWAYS-03

### GAP-ADMIN-GATEWAYS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** gateways/page.tsx:27-30 shows zeros on error (loader returns [] with source 'error'); GatewaysTable.tsx:15-25 renders DataSourceBadge plus DataTable EmptyState 'No communication gateways configured.' when there is no cache; no RefreshErrorState or retry. That message is actively wrong on failure ('none configured' vs 'couldn't load').
- **Files to change:** `apps/web/src/app/(app)/admin/gateways/page.tsx`, `apps/web/src/app/(app)/admin/gateways/GatewaysTable.tsx`
- **Fix steps:**
  1. In GatewaysTable render <RefreshErrorState error={toHumanError('load',{area:'gateways'})} backHref='/admin'/> when provenance === 'error-no-data'.
  2. Pass null to the stat cards in that state.
  3. Use the shared wrapper proposed for ENTITLEMENTS-03.
- **Acceptance:**
  - Component test: error-no-data -> Retry button, no EmptyState.
  - Legitimately empty -> EmptyState and zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-ENTITLEMENTS-03, RefreshErrorState

### GAP-ADMIN-GATEWAYS-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Standby = total − active − degraded (gateways/page.tsx:30): a failed/down gateway is reported as Standby with the same red icon, hiding an outage.
- **Verified evidence:** gateways/page.tsx:30 Standby = gateways.length - active - degraded, so any other status (down, failed, error, inactive, unknown) is counted as Standby - confirmed. The 'same red icon' claim is overstated: the card uses icon 📨 with iconBg #fce7ee (pink), not a red alert icon. StatusPill (ds/StatusPill.tsx) has no 'degraded', 'down' or 'standby' keys, so those rows fall to the neutral 'info' pill in the table. Actual status enum is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/gateways/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Count standby explicitly (status === 'standby') and add a 'Down / failed' card for down|failed|error; put remaining values into 'Other'.
  2. Give the Down card a bad-tone icon and background.
  3. Add degraded -> warn, down -> bad, standby -> mut to StatusPill STATUS_MAP once the enum is confirmed.
- **Acceptance:**
  - Unit test: statuses [active, down, standby, degraded] -> Active 1, Degraded 1, Standby 1, Down 1.
  - Down row renders a red pill.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Ops signal; misclassification could hide outages, confirm enum with backend first.
- **Depends on:** GAP-ADMIN-GATEWAYS-02

### GAP-ADMIN-GATEWAYS-05  ·  LOW  ·  partly  ·  theme TYPES (was STATUS)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (GatewaysTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** GatewaysTable.tsx:5-6 Row = Record<string, unknown> and columns keyed by strings (:17-24); loader getSAGateways types rows as Record<string, unknown> (loaders.ts:4222). Confirmed. StatusPill lacks degraded/down/standby (StatusPill.tsx:5-39); fallback is variant 'info' (blue, civitas-ds.css:127), not grey. successRate and messagesPerDay render raw (no number/percent format).
- **Files to change:** `apps/web/src/app/(app)/admin/gateways/GatewaysTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Define GatewayRow {type, provider, messagesPerDay:number, successRate:number, lastChecked:string, status:string} with zod responseSchema after confirming API shape.
  2. Type DataTable<GatewayRow>; format successRate as percent and lastChecked via lib/formatters.
  3. Add StatusPill keys per GATEWAYS-04.
- **Acceptance:**
  - tsc error on unknown column key.
  - successRate 0.987 renders '98.7%' (or per API unit).
  - 'degraded' renders warn pill.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; unit of successRate unknown, verify before formatting.
- **Depends on:** GAP-ADMIN-GATEWAYS-04

### GAP-ADMIN-GATEWAYS-06  ·  LOW  ·  partly  ·  theme NAV (was PII)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** “Communication Gateways” (SMS/email/WhatsApp/push) and the “API gateway” (gateway-config / gateway-routes) share the word gateway; the cross-links sit in an unstyled <p className="back"> (gateways/page.tsx:21-25) rather than as page actions.
- **Verified evidence:** gateways/page.tsx:21-25 has <p className='back'> with two plain <a> links (Edge config, API route catalogue) - confirmed; they are not page actions and use full-page navigation instead of next/link. 'Unstyled' is not verified (.back class is used by PageHeader too). The naming ambiguity is real (title 'Communication Gateways' vs gateway-config/routes = API gateway); the PII tag is wrong, no PII involved.
- **Files to change:** `apps/web/src/app/(app)/admin/gateways/page.tsx`
- **Fix steps:**
  1. Pass the two links to PageHeader actions (PageHeader supports `actions`) as Button/Link variant='ghost' labelled 'API gateway: edge config' and 'API gateway: route catalogue'.
  2. Use next/link.
  3. Rename the page title to 'Notification Gateways' (decision) or add a one-line subtitle clarifying difference.
- **Acceptance:**
  - Links appear in the header actions area and navigate client-side.
  - Title/labels no longer use bare 'gateway' for both concepts.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; renaming affects docs/i18n.


---
## /admin/integrations  —  `admin/integrations.html`

- **Source:** `apps/web/src/app/(app)/admin/integrations/page.tsx`
- **Design reference:** `redesign/admin/integrations.html`

### GAP-ADMIN-INTEGRATIONS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Failed load masquerades as “Not configured”: on GET failure the error alert renders, rows stays [], and byProvider is empty so every card shows the grey “Not configured” pill (page.tsx:97-131) with no retry; an operator could re-enter and propose over a live secret thinking nothing was set.
- **Verified evidence:** integrations/page.tsx:26-50 load(): on !res.ok sets error and returns, rows stays []; line 98 renders a plain <div class=alert bad> (no retry); line 99-145 still render every provider card because loading=false; byProvider (59-63) is empty so status = "unconfigured" (113) -> grey 'Not configured' pill via StatusBadge (IntegrationDrawer.tsx:407-410); stat cards 65-67 show real zeros (Connected 0/Configured 0/Failing 0). Worse, opening a card runs the drawer's own load (IntegrationDrawer.tsx:72-77): if it also fails, detail stays null, the form is editable and 'Propose change' is enabled (398, disabled={loading} only) and expectedVersion is omitted (165) so the proposal carries no optimistic-lock version. Note this is a client component using fetch, so RefreshErrorState (router.refresh) would NOT re-run load(); the original fix text is slightly off.
- **Files to change:** `apps/web/src/app/(app)/admin/integrations/page.tsx`, `apps/web/src/app/(app)/admin/integrations/_components/IntegrationDrawer.tsx`, `apps/web/src/app/_components/ds/ErrorState.tsx (reuse only)`
- **Fix steps:**
  1. In page.tsx, when `error` is set and rows is empty (first load failed), return <ErrorState error={toHumanError("load",{area:"integrations"})} onRetry={() => load()} backHref="/admin" /> instead of the category grid (RefreshErrorState is server-refresh only; use ErrorState with the existing load callback).
  2. Pass null (not String(0)) to the Connected/Configured/Failing StatCards while error is set or loading, so they render "—"; keep Providers = PROVIDER_META.length.
  3. If a reload after onChanged fails while stale rows exist, keep the grid but show the alert with a Retry button and a 'may be out of date' note.
  4. In IntegrationDrawer.tsx, when load() fails set a `loadFailed` flag; render an inline ErrorState with retry and disable 'Propose change' (line 398) and the form until detail has loaded, so nobody proposes blind.
  5. Replace the raw alert with role="alert" copy from toHumanError (already via useFormError) and move focus to the retry button.
- **Acceptance:**
  - Component test: mock fetch to return 500 for GET /api/proxy/v1/admin/integrations -> no 'Not configured' pill is rendered, a Retry button is; stat cards show '—'.
  - Click Retry with fetch now returning rows -> grid renders with real statuses.
  - Drawer test: detail GET fails -> 'Propose change' is disabled and retry is shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Behavioural risk only in the drawer gating: ensure a legitimately unconfigured provider (200 with data unconfigured) still allows first-time setup.

### GAP-ADMIN-INTEGRATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Approve applies a credential change with one click and no ConfirmDialog (IntegrationDrawer.tsx:360), and Reject sends a hard-coded reason “Rejected from Admin UI” (:191) — no way to state why; the SFTP “Run ingestion now?” action, by contrast, has a ConfirmDialog (IngestionRunsView.tsx:156).
- **Verified evidence:** IntegrationDrawer.tsx:360 Approve button calls decide("approve") directly; decide() (184-206) POSTs {} for approve and hard-codes {reason:"Rejected from Admin UI"} for reject (191) - the operator cannot supply a reason and the stored rejectedReason shown in history (385) is always that string. ConfirmDialog exists in ds with requireReason/minReasonLength (ConfirmDialog.tsx) and IngestionRunsView.tsx:152-162 uses it for 'Run ingestion now?'. UI text (364) states segregation of duties but enforcement (proposer != approver) and audit-event emission live in admin-service integration-settings, which is not in this snapshot (only hrms-service present) -> backend part cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/integrations/_components/IntegrationDrawer.tsx`, `services/admin-service/src/modules/integration-settings (not in snapshot - verify)`
- **Fix steps:**
  1. Add state `decision: null | "approve" | "reject"` in IntegrationDrawer; Approve/Reject buttons (360-361) set it instead of calling decide().
  2. Render <ConfirmDialog open={decision!==null} title=... danger={decision==="reject"} requireReason={decision==="reject"} minReasonLength={10} description={summary of what changes: provider, env, secretChanged flag from ChangeRow}> ; for approve show a prominent warning when env === "prod" and secretChanged is true.
  3. Change decide(action, reason?) to send {reason} on reject (from the dialog) and optionally {note} on approve; delete the hard-coded string at line 191.
  4. Wire busy/errorMessage props of ConfirmDialog to the existing busy/error state so failures show inside the dialog.
  5. Hide/disable Approve when pending.proposedBy equals the current user id (needs current user from session hook) as a courtesy; backend must remain the authority.
  6. Backend: confirm approve/reject routes reject same-user approval (403) and emit audit events with reason and correlationId; add if missing.
- **Acceptance:**
  - Component test: click Approve -> no fetch fired until the dialog's Confirm is pressed.
  - Click Reject -> Confirm disabled until a reason of >=10 chars is typed; POST body contains that reason, not 'Rejected from Admin UI'.
  - Backend integration test: approving own proposal returns 403; approve/reject each write one audit event.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approving applies a live credential change to prod; a missed confirmation is a business risk. Do not weaken the existing 'A different admin must approve' flow while adding the dialog.

### GAP-ADMIN-INTEGRATIONS-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Raw ids in the UI: “Proposed by {pending.proposedBy.slice(0, 8)}…” shows a truncated user UUID rather than a name (IntegrationDrawer.tsx:~356); Test connection surfaces “✗ {status}: {error}” raw from the provider (:~333).
- **Verified evidence:** IntegrationDrawer.tsx:357 prints `Proposed by {pending.proposedBy.slice(0, 8)}…` (ChangeRow.proposedBy is a user id, providers.ts ChangeRow) - a truncated UUID, not a person. Line 345 renders `✗ {status}: {error ?? "failed"}` from the test endpoint envelope; the comment at 220-223 says this is intentional diagnostic output, so that half is a deliberate product decision, though the provider error string is still shown verbatim and could include hostnames/paths. Line 284 also prints d.lastError raw. History rows (382-388) show no actor at all.
- **Files to change:** `apps/web/src/app/(app)/admin/integrations/_components/IntegrationDrawer.tsx`, `apps/web/src/app/(app)/admin/integrations/_components/providers.ts`, `services/admin-service/src/modules/integration-settings (add proposedByName/approvedByName to ChangeRow response - not in snapshot)`
- **Fix steps:**
  1. Backend: extend the pending/history ChangeRow payload with proposedByName and approvedByName (resolved server-side from the user directory); add the fields to ChangeRow in providers.ts.
  2. In IntegrationDrawer.tsx:357 render `Proposed by {pending.proposedByName ?? "another admin"}` plus a formatted timestamp; never render the id.
  3. Add actor names and decision time to each history <li> (382-388).
  4. Map test failures: keep status label but pass `error` through a small sanitiser/lookup (unauthorized, timeout, DNS, TLS -> plain-language line) and put the raw provider text behind a <details> 'Technical detail'; same for d.lastError at 284.
- **Acceptance:**
  - Component test with pendingChange {proposedBy:"3f2a...uuid", proposedByName:"A. Rao"} -> text 'Proposed by A. Rao' and no 8-char UUID fragment in the DOM.
  - Test result {ok:false,status:'failed',error:'ECONNREFUSED 10.0.0.5:443'} -> summary line is plain language; raw text only inside the collapsed details.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low. Name resolution must respect tenant scoping; do not leak operator identities across tenants.

### GAP-ADMIN-INTEGRATIONS-05  ·  MEDIUM  ·  partly  ·  theme A11Y (was PII)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Environment switcher is a row of <span role="tab" tabIndex=0> with only Enter handled (page.tsx:86-92; drawer :257-263): no Space key, no aria-controls/tabpanel, no arrow navigation; “Configured” = hasSecret || enabled (:67), so an enabled-but-empty provider counts as configured.
- **Verified evidence:** Env switcher: page.tsx:86-95 and IntegrationDrawer.tsx:257-266 are <span role="tab" tabIndex={0}> with onKeyDown handling only Enter (91, 262): no Space, no roving tabindex, no arrow/Home/End, no aria-controls/tabpanel - true. Ds already ships Tabs.tsx (roving tabindex, Enter/Space/arrows/Home/End) and Segmented.tsx (Enter+Space), so fix is reuse. 'Configured' = hasSecret || enabled (page.tsx:67) - true in code; whether an enabled-but-empty provider can exist depends on admin-service (not in snapshot): the card's own badge (113) uses row.status, so the Configured stat can disagree with the card pills. Theme tag PII is wrong (nothing here is PII; the fix text about Masked/CSV does not apply).
- **Files to change:** `apps/web/src/app/_components/ds/Tabs.tsx`, `apps/web/src/app/(app)/admin/integrations/page.tsx`, `apps/web/src/app/(app)/admin/integrations/_components/IntegrationDrawer.tsx`
- **Fix steps:**
  1. Extend ds Tabs.tsx with optional `ariaLabel`, `idPrefix` props; give each tab id/aria-controls and export a matching TabPanel (role=tabpanel, aria-labelledby).
  2. Replace both hand-rolled `.seg` spans (page.tsx:86-95, drawer 257-266) with <Tabs tabs={[...ENV_SCOPES]} active={env} onChange={...} ariaLabel="Environment scope"/>, wrapping the provider grid / form in the tabpanel.
  3. Redefine the stat: configured = rows where status !== "unconfigured" (or hasSecret) - drop `|| r.enabled` unless product confirms enabled-without-config is meaningful; align with the card pill.
- **Acceptance:**
  - Component test: focus the selected env tab, press ArrowRight -> next env activates and receives focus; Space activates a focused tab.
  - axe: no aria-required-children / aria-valid-attr-value violations on the page; tabpanel labelled by its tab.
  - Stat test: row {enabled:true, hasSecret:false, status:'unconfigured'} -> Configured count 0 and card shows 'Not configured'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Tabs is used widely; add props as optional so existing call sites are unaffected.
- **Depends on:** ds/Tabs (extend)

### GAP-ADMIN-INTEGRATIONS-06  ·  LOW  ·  partly  ·  theme A11Y (was PII)

- [x] **Status** — PR #1801 (merged)
- **First-pass claim:** Positive: secrets are write-only (password inputs, “leave blank to keep”, masked value), maker-checker with segregation of duties and change history are present. Drawer overlay is a custom cd-overlay div rather than the DS ConfirmDialog/Drawer; text-only loading.
- **Verified evidence:** Positives are true: secret inputs are type=password autoComplete=off (IntegrationDrawer.tsx:298-306), placeholder '<masked> - leave blank to keep' (302), buildConfig sends a secret only if typed (133-135), maker-checker + segregation-of-duties note (173, 364) and change history (375-390). Negatives: drawer is a custom `.cd-overlay` div (238-251) with role=dialog aria-modal and an Escape handler (118-123) but no focus trap, no initial focus and no focus return (ConfirmDialog in ds has all three); loading is text-only 'Loading…' (100, 270) while sibling pages use skeletons (loading.tsx exists for the route but the in-page state is text). Card also prints secretMasked (page.tsx:131-133) - depends on backend mask format (cannot-verify). Not a PII defect; theme PII is wrong. Minor: password fields should use autoComplete="new-password" to stop managers autofilling.
- **Files to change:** `apps/web/src/app/(app)/admin/integrations/_components/IntegrationDrawer.tsx`, `apps/web/src/app/_components/ds/Drawer.tsx (new, extract from ConfirmDialog focus-trap logic)`, `apps/web/src/app/(app)/admin/integrations/page.tsx`
- **Fix steps:**
  1. Create ds <Drawer> (portal, role=dialog, aria-modal, focus trap, ESC/overlay close, focus return) by extracting the trap logic already in ConfirmDialog.tsx; export from ds/index.ts.
  2. Render IntegrationDrawer content inside <Drawer title=provider.label onClose=...> replacing the cd-overlay markup.
  3. Swap the 'Loading…' divs for the ds Skeleton component.
  4. Set autoComplete="new-password" on secret inputs.
- **Acceptance:**
  - Component test: open drawer -> focus moves inside; Tab from last control wraps to first; Escape closes and focus returns to the provider card.
  - Secret input has type=password and autocomplete=new-password; value is empty after load.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep the existing Escape and overlay-click behaviour and the busy guard on Close.
- **Depends on:** ds/Drawer (new)


---
## /admin/invoices  —  `admin/invoices.html`

- **Source:** `apps/web/src/app/(app)/admin/invoices/page.tsx`
- **Design reference:** `redesign/admin/invoices.html`

### GAP-ADMIN-INVOICES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was FABRICATED)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (Paid = status==="paid"; Overdue = status==="overdue"; Pending = total − paid − overdue) while the table reads the useSeededResource cache (sa.invoices); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs InvoicesTable.tsx).
- **Verified evidence:** invoices/page.tsx:6-8,18-21 compute all four cards server-side from `invoices` returned by getSAInvoices (loaders.ts:4250, fetchJson returns data [] on any failure). InvoicesTable.tsx:7 renders rows from useSeededResource("sa.invoices", invoices, source, d=>d.length===0), which falls back to the encrypted offline cache when the server result is empty/errored (resource.ts:213-238). So with a server failure and a warm cache: table shows cached rows + 'Showing saved data' badge (DataSourceBadge.tsx) while cards show 0. Not 'fabricated' data - it is a two-data-path mismatch; theme tag FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/admin/invoices/page.tsx`, `apps/web/src/app/(app)/admin/invoices/InvoicesTable.tsx`
- **Fix steps:**
  1. Move the StatGrid out of invoices/page.tsx into the client table component (InvoicesTable.tsx) so it is computed from the SAME `rows` returned by useSeededResource("sa.invoices") - one data path for cards and table.
  2. Extract the count logic into a pure exported helper (e.g. computeXStats(rows)) in the same folder so it can be unit-tested; keep the server page rendering only PageHeader + <Card>.
  3. When provenance === "error-no-data" pass null to every StatCard value (StatCard.displayValue already renders "—" for null); when provenance === "cached" compute from cached rows and rely on DataSourceBadge to say the data is saved.
  4. Keep DataSourceBadge where it is (it already reads the same provenance).
- **Acceptance:**
  - Component test: mock useSeededResource -> {data: 3 rows incl. 1 paid, provenance:'cached'} with server prop invoices=[] -> Total Invoices 3, Paid 1 (matches table).
  - provenance:'error-no-data' -> all four cards show '—'.
  - provenance:'live' with genuinely empty list -> cards show 0.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Page changes from server-computed to client-computed stats; check no test imports the old page-level markup.
- **Depends on:** shared SeededStats pattern (also used by metering/onboarding/operators)

### GAP-ADMIN-INVOICES-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** page.tsx:6-21: on fetch failure getSAInvoices returns [] + source:'error' (apiClient.ts:109-172), the cards render 0/0/0/0 as real numbers (StatCard would print '—' only for null/NaN); InvoicesTable shows the amber DataSourceBadge ('Couldn't load — showing nothing') and DataTable's EmptyState 'No invoices'. No RefreshErrorState/LoadErrorState and no retry; a 403 is also indistinguishable from an outage. Siblings do null the stats (crm/service-requests/page.tsx:21 `source==="error" ? "—" : ...`, revenue/refunds/page.tsx:166) and LoadErrorState exists (ds/LoadErrorState.tsx: 403 -> PermissionDenied, else retry). error.tsx only catches thrown errors, not source:'error'.
- **Files to change:** `apps/web/src/app/(app)/admin/invoices/page.tsx`, `apps/web/src/app/(app)/admin/invoices/InvoicesTable.tsx`
- **Fix steps:**
  1. In page.tsx keep `const result = await getSAInvoices()`; when result.source === "error" AND no cache will be shown, render <LoadErrorState result={result} area="invoices" backHref="/admin" /> (server-refresh retry, 403-aware) instead of cards + table.
  2. Because the cached-copy fallback lives client-side, do the branch in the client table wrapper: if provenance === "error-no-data" render the error state (pass `result` fields status/errorMessage as props), if "cached" render table + badge.
  3. Pass null to StatCard values in the error case (see INVOICES-03).
  4. Keep DataSourceBadge for the cached case.
- **Acceptance:**
  - Test: loader returns {source:'error', status:500}, no cache -> Retry button shown, no 'No invoices' empty state, cards '—'.
  - status 403 -> 'Access restricted' (PermissionDenied), no retry.
  - Click Retry -> router.refresh called.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Ensure the offline-cache fallback (intentional PWA behaviour) still renders when the server is unreachable.
- **Depends on:** GAP-ADMIN-INVOICES-03

### GAP-ADMIN-INVOICES-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Pending = total − paid − overdue (invoices/page.tsx:20) also counts draft, cancelled and void invoices as Pending.
- **Verified evidence:** invoices/page.tsx:20 `value={invoices.length - paid - overdue}` - Pending is a remainder, so any status other than paid/overdue (draft, void, cancelled, refunded, partially paid, etc.) inflates it. The actual status enum of /v1/billing/invoices is not in this snapshot (no billing service) -> which values occur is cannot-verify, but the arithmetic flaw is certain.
- **Files to change:** `apps/web/src/app/(app)/admin/invoices/page.tsx (or the extracted stats helper)`, `packages/types (invoice status enum, if absent)`
- **Fix steps:**
  1. Confirm the invoice status enum with the billing API owner and add it to @civitasone/types.
  2. Compute Pending explicitly: count of status in {sent, issued, pending, partially_paid} (whatever the enum defines) - not a remainder.
  3. Add a fifth 'Other/Void' bucket or show it as a subtitle so cards sum to Total, or drop draft/void rows from Total.
  4. Unit-test the pure stats helper with each enum value.
- **Acceptance:**
  - Unit test: rows [paid, overdue, draft, void, sent] -> Pending 1 (sent), not 3.
  - Cards' visible numbers reconcile with a status filter on the table.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Finance-visible number; get billing owner sign-off on the definition of Pending before shipping.
- **Depends on:** GAP-ADMIN-INVOICES-03

### GAP-ADMIN-INVOICES-06  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1850 (merged): via #1849 in #1850
- **First-pass claim:** Read-only register: no invoice detail, PDF/print, mark-paid or reminder action; the page is reachable from the /admin tile “Invoices — Billing invoices and payments”, which promises payments handling.
- **Verified evidence:** invoices/page.tsx and InvoicesTable.tsx render only a DataTable with sort/filter/CSV export (InvoicesTable.tsx:25); no row link, detail route (folder has no [id]), print/PDF, mark-paid or reminder action. Entry tile admin/page.tsx:12 describes it as 'Billing invoices and payments'. It is a working read-only register, not a dead route; the gap is missing function/expectation mismatch. Mutation endpoints (mark-paid, reminder) are not verifiable here - billing service absent.
- **Files to change:** `apps/web/src/app/(app)/admin/page.tsx (tile copy)`, `apps/web/src/app/(app)/admin/invoices/InvoicesTable.tsx`, `apps/web/src/app/(app)/admin/invoices/[id]/page.tsx (new, if detail approved)`
- **Fix steps:**
  1. Short term: change tile description at admin/page.tsx:12 to 'Billing invoice register (read-only)'.
  2. Add a `render` column for Invoice No linking to /admin/invoices/[id] and build the detail page (line items, tenant, status history) via a new getSAInvoiceById loader.
  3. Add PDF/print using the existing PrintDocumentLink/PrintButton components once a document endpoint exists.
  4. Add mark-paid / send-reminder as ActionButton + ConfirmDialog (requireReason) only after billing-service exposes audited commands; money amounts must stay in paise.
- **Acceptance:**
  - Tile text matches actual capabilities.
  - Clicking an invoice number opens the detail page; unknown id shows the not-found state (not a blank page).
  - Mark-paid emits an audit event (backend test) and requires a reason.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Payments actions touch money and receivables; do not ship mark-paid without maker-checker and audit. Copy-only fix is XS.

### GAP-ADMIN-INVOICES-07  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (InvoicesTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** Confirmed: `type Row = Record<string, unknown>` (InvoicesTable.tsx:5) and string-keyed columns (17-24) with no compile-time link to the API. StatusPill (ds/StatusPill.tsx) maps lowercased text to good/warn/mut/bad and falls back to 'info' (blue), NOT grey as stated; known keys include paid, overdue, draft, pending, failed but not 'sent', 'issued', 'void', 'cancelled', 'partially paid', 'billed' so those render as blue info pills. Extra defect found: the Amount column (line 19) has no cellType/render, so DataTable prints the raw value via String() (DataTable.tsx:141) - no ₹/paise formatting, contrary to the money-in-paise rule; the unit of the field is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/invoices/InvoicesTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `packages/types (Invoice type)`, `apps/web/src/app/_data/loaders.ts (getSAInvoices typed mapper)`
- **Fix steps:**
  1. Define `SAInvoice` (invoiceNo, tenant, amountMinor, currency, period, dueDate, status) in packages/types and give getSAInvoices a zod responseSchema/mapper (pattern: AdminOrgUnit loader).
  2. Type the table as DataTable<SAInvoice> with keyof-checked column keys.
  3. Set the Amount column to cellType:"amount" (formatMoney) once the field is confirmed to be paise.
  4. Add missing invoice statuses (sent, issued, void, cancelled, partially_paid) to STATUS_MAP with deliberate tones.
- **Acceptance:**
  - tsc fails if a column key is not on SAInvoice.
  - Test: StatusPill status='void' renders 'mut', 'sent' renders 'warn'.
  - Amount 125000 (paise) renders ₹1,250.00.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display: confirm unit (paise vs rupees) before enabling formatMoney or amounts will be off by 100x.
- **Depends on:** GAP-ADMIN-INVOICES-05


---
## /admin/metering  —  `admin/metering.html`

- **Source:** `apps/web/src/app/(app)/admin/metering/page.tsx`
- **Design reference:** `redesign/admin/metering.html`

### GAP-ADMIN-METERING-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was FABRICATED)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (Billed = status==="billed"; Overdue = status==="overdue"; Pending = total − billed − overdue) while the table reads the useSeededResource cache (sa.metering); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs MeteringTable.tsx).
- **Verified evidence:** metering/page.tsx:6-8,18-21 compute cards server-side from getSAMetering (loaders.ts:4208); MeteringTable.tsx:7 renders from useSeededResource("sa.metering") with cache fallback, so on server failure + warm cache the table is populated ('Showing saved data') while cards read 0. Two data paths; not fabricated data (theme wrong).
- **Files to change:** `apps/web/src/app/(app)/admin/metering/page.tsx`, `apps/web/src/app/(app)/admin/metering/MeteringTable.tsx`
- **Fix steps:**
  1. Move the StatGrid out of metering/page.tsx into the client table component (MeteringTable.tsx) so it is computed from the SAME `rows` returned by useSeededResource("sa.metering") - one data path for cards and table.
  2. Extract the count logic into a pure exported helper (e.g. computeXStats(rows)) in the same folder so it can be unit-tested; keep the server page rendering only PageHeader + <Card>.
  3. When provenance === "error-no-data" pass null to every StatCard value (StatCard.displayValue already renders "—" for null); when provenance === "cached" compute from cached rows and rely on DataSourceBadge to say the data is saved.
  4. Keep DataSourceBadge where it is (it already reads the same provenance).
- **Acceptance:**
  - Cached provenance with server rows [] -> 'Metered Tenants' equals table row count.
  - error-no-data -> cards '—'.
  - live empty -> 0.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-INVOICES-03

### GAP-ADMIN-METERING-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** Same mechanism as INVOICES-04: metering/page.tsx:18-21 shows real zeros on source:'error'; MeteringTable.tsx:15 only shows the amber DataSourceBadge + DataTable empty state 'No metering data'; no LoadErrorState/retry. Sibling pages null stats (crm/service-requests/page.tsx:21).
- **Files to change:** `apps/web/src/app/(app)/admin/metering/page.tsx`, `apps/web/src/app/(app)/admin/metering/MeteringTable.tsx`
- **Fix steps:**
  1. Client table wrapper: when provenance === "error-no-data" render <LoadErrorState result={{status, errorMessage}} area="usage metering" backHref="/admin" /> instead of the empty DataTable (pass status/errorMessage from the server page as props).
  2. Null the StatCard values in that case (shared with METERING-03).
  3. Keep DataSourceBadge for provenance 'cached'.
- **Acceptance:**
  - 500 with no cache -> Retry visible, no 'No metering data' empty state.
  - 403 -> PermissionDenied variant.
  - Retry triggers router.refresh.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-METERING-03, GAP-ADMIN-INVOICES-04

### GAP-ADMIN-METERING-05  ·  MEDIUM  ·  partly  ·  theme OTHER (was CAP)

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Pending = total − billed − overdue (metering/page.tsx:20) counts any unknown status as Pending; metered usage (API calls, storage, users) has no cap or entitlement comparison, although /admin/entitlements holds the limits.
- **Verified evidence:** Pending = meters.length - billed - overdue (metering/page.tsx:20) is a remainder that absorbs any unknown status - true. Columns (MeteringTable.tsx:18-24) show apiCalls, storage, users, amount with no limit/quota comparison - true. That /admin/entitlements holds the limits is plausible (route folder admin/entitlements exists; getSAEntitlements loader at loaders.ts ~4262) but entitlement field names and whether limits map to apiCalls/storage/users are cannot-verify. Theme CAP and its 'server-side pagination' fix text do not match this observation (DataTable is client-paginated pageSize 15 over the full fetch, a separate concern).
- **Files to change:** `apps/web/src/app/(app)/admin/metering/page.tsx`, `apps/web/src/app/(app)/admin/metering/MeteringTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Compute Pending from an explicit status list (see INVOICES-05) and show remaining rows as 'Other'.
  2. Confirm with entitlements owner which limit fields correspond to apiCalls/storage/users; add a limit-aware loader that joins on tenant id via HTTP (no cross-service SQL).
  3. Add 'Usage vs limit' ProgressBar cells (ds ProgressBar exists) with warn >=80%, bad >=100%, plus a text cue (not colour only).
- **Acceptance:**
  - Row with status 'draft' is not counted in Pending.
  - Tenant at 92% of API-call limit shows warn cell with '92% of limit' text.
  - Tenant with no entitlement record shows '—' (no divide by zero).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Cap display is only meaningful if entitlement units match metering units; mismatch would show false overage warnings.
- **Depends on:** GAP-ADMIN-METERING-03

### GAP-ADMIN-METERING-06  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (MeteringTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** Confirmed: Row = Record<string, unknown> and string column keys (MeteringTable.tsx:5,18-24). StatusPill falls back to 'info' (blue) not grey (ds/StatusPill.tsx); its map lacks 'billed', 'unbilled', 'pending billing' so the 'billed' status the page counts renders as an info pill while 'overdue' is red. Also Amount (₹) column (line 23) has no cellType so raw values print unformatted; storage is a free string. Unit (paise vs rupees) is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/metering/MeteringTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `packages/types (SAMeter type)`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add `SAMeter` type in packages/types and a typed mapper on getSAMetering.
  2. Use DataTable<SAMeter> with checked keys; set Amount to cellType:"amount" once paise is confirmed.
  3. Add 'billed' (good) and other confirmed metering statuses to STATUS_MAP.
- **Acceptance:**
  - tsc rejects unknown column key.
  - StatusPill 'billed' renders good tone.
  - Amount cell formatted via formatMoney.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money unit assumption; verify before formatting.
- **Depends on:** GAP-ADMIN-INVOICES-07


---
## /admin/onboarding  —  `admin/onboarding.html`

- **Source:** `apps/web/src/app/(app)/admin/onboarding/page.tsx`
- **Design reference:** `redesign/admin/onboarding.html`

### GAP-ADMIN-ONBOARDING-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was FABRICATED)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (New Requests = stage==="new request"; Ready = stage==="go-live pending"; In Progress = stages not in [new request, go-live pending, completed]; In Queue = every row incl. completed) while the table reads the useSeededResource cache (sa.onboarding); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs OnboardingTable.tsx).
- **Verified evidence:** onboarding/page.tsx:6-10,19-22 compute cards from getSAOnboarding (loaders.ts:4243) on the server; OnboardingTable.tsx:7 renders from useSeededResource("sa.onboarding") with cache fallback -> cards 0 vs populated table on cached provenance. Two data paths; not fabricated (theme wrong).
- **Files to change:** `apps/web/src/app/(app)/admin/onboarding/page.tsx`, `apps/web/src/app/(app)/admin/onboarding/OnboardingTable.tsx`
- **Fix steps:**
  1. Move the StatGrid out of onboarding/page.tsx into the client table component (OnboardingTable.tsx) so it is computed from the SAME `rows` returned by useSeededResource("sa.onboarding") - one data path for cards and table.
  2. Extract the count logic into a pure exported helper (e.g. computeXStats(rows)) in the same folder so it can be unit-tested; keep the server page rendering only PageHeader + <Card>.
  3. When provenance === "error-no-data" pass null to every StatCard value (StatCard.displayValue already renders "—" for null); when provenance === "cached" compute from cached rows and rely on DataSourceBadge to say the data is saved.
  4. Keep DataSourceBadge where it is (it already reads the same provenance).
- **Acceptance:**
  - cached provenance, server [] -> New Requests count equals table rows with stage 'new request'.
  - error-no-data -> '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-INVOICES-03

### GAP-ADMIN-ONBOARDING-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** Same as INVOICES-04: onboarding/page.tsx:19-22 show real zeros on source:'error'; only DataSourceBadge (OnboardingTable.tsx:15) + DataTable EmptyState 'No requests' ('No tenant onboarding requests in queue' - actively wrong when the load failed); no retry.
- **Files to change:** `apps/web/src/app/(app)/admin/onboarding/page.tsx`, `apps/web/src/app/(app)/admin/onboarding/OnboardingTable.tsx`
- **Fix steps:**
  1. Client table wrapper renders <LoadErrorState area="onboarding requests" backHref="/admin"/> when provenance === "error-no-data".
  2. Null StatCard values in that state.
  3. Keep DataSourceBadge for cached provenance.
- **Acceptance:**
  - 500/no cache -> Retry visible, no empty-queue message.
  - 403 -> access restricted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-ONBOARDING-02, GAP-ADMIN-INVOICES-04

### GAP-ADMIN-ONBOARDING-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** “In Queue” counts every row including Completed (onboarding/page.tsx:20 uses queue.length), so completed tenants inflate the queue; In Progress also swallows unknown or blocked stages (page.tsx:8).
- **Verified evidence:** onboarding/page.tsx:19 `value={queue.length}` labelled 'In Queue' counts every row including stage 'completed'; inProgress (line 8) = everything not in [new request, go-live pending, completed], so unknown, blocked, rejected or cancelled stages are counted as In Progress. (Observation cites page.tsx:20/8; actual lines 19 and 8.) Real stage enum is cannot-verify (no backend/mock data in snapshot).
- **Files to change:** `apps/web/src/app/(app)/admin/onboarding/page.tsx (or extracted stats helper)`
- **Fix steps:**
  1. Confirm stage enum with tenant-service owner and type it.
  2. Compute In Queue = rows whose stage !== completed (and !== rejected/cancelled if they exist).
  3. Compute In Progress from an explicit allow-list of active stages; surface unknown stages as 'Other' or via a console-free telemetry warning.
  4. Unit-test the helper with each stage.
- **Acceptance:**
  - Rows [new request, completed, completed] -> In Queue 1.
  - Row with stage 'blocked' is not counted In Progress unless the allow-list says so.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Operators may rely on the current number; announce definition change.
- **Depends on:** GAP-ADMIN-ONBOARDING-02

### GAP-ADMIN-ONBOARDING-05  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1841 (merged)
- **First-pass claim:** Contact column prints requester name/e-mail (personal data, DPDP) in a table shared with every viewer and exportable as CSV (OnboardingTable.tsx exportFilename “onboarding-queue”); no masking, no role gate.
- **Verified evidence:** OnboardingTable.tsx:19 renders a 'contact' column (requester name/e-mail per the observation; field content cannot be verified without the API) with exportable + exportFilename="onboarding-queue" (line 24); DataTable.downloadCsv (DataTable.tsx:274-291) exports every sorted row client-side with no role check, no audit call, and no CSV formula-injection escaping (values starting = + - @ are written raw). No <Masked> component exists in the repo (grep found none). Whether the viewer needs the full contact is a product decision; access to /admin is presumably limited to platform admins, but no page-level role gate is visible in admin/ (no admin/layout.tsx; gating may be in (app)/layout.tsx or middleware - not verified). So the 'shared with every viewer' claim is only partly evidenced.
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/admin/onboarding/OnboardingTable.tsx`, `apps/web/src/lib/audit (client audit-event helper - check existing) / backend export-audit endpoint`
- **Fix steps:**
  1. Create ds <Masked value kind="email|phone|text" canReveal onReveal> that renders j***@domain style by default and reveals on explicit click for permitted roles, calling an audit endpoint on reveal.
  2. Add a `render` for the Contact column using <Masked> (and mask in csvCellValue via a column `csvValue`/`sensitive` flag).
  3. Add DataTable props `onExport?: (rowCount) => void` and `exportGate?: boolean`; OnboardingTable passes a handler that POSTs an export audit event (who, page, row count, filters) and hides the button unless the user has an export permission.
  4. Escape formula-leading characters in downloadCsv (prefix with ') for every consumer.
  5. Backend: add an audited export/reveal endpoint (per CLAUDE.md rule 8, every mutation/sensitive access emits an audit event).
- **Acceptance:**
  - Contact cell shows masked value for a user without reveal permission; click reveal fires one audit request.
  - CSV export button absent without permission; with permission it fires an audit event and file contains masked contact unless reveal allowed.
  - Cell '=cmd|...' is exported as text, not a formula.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII (DPDP): changes what operators can copy out; coordinate with data-protection owner. Masking may hinder support workflows - provide audited reveal.
- **Depends on:** shared <Masked>, GAP-ADMIN-OPERATORS-06

### GAP-ADMIN-ONBOARDING-06  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (OnboardingTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** Row = Record<string, unknown> and string keys (OnboardingTable.tsx:5,18-22) - true. StatusPill unknown values fall back to 'info' (blue), not grey; the stages used by the page ('new request', 'go-live pending') are not in STATUS_MAP so they render info-blue, and 'completed' renders good. Also StatusPill humanizeStatus label is used, fine.
- **Files to change:** `apps/web/src/app/(app)/admin/onboarding/OnboardingTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `packages/types (SAOnboardingRequest type)`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Define SAOnboardingRequest with a stage union in packages/types; typed mapper in getSAOnboarding.
  2. Type DataTable<SAOnboardingRequest>.
  3. Add 'new request' (info), 'go-live pending' (warn), and other stages to STATUS_MAP.
- **Acceptance:**
  - tsc rejects invalid column key.
  - 'go-live pending' renders warn tone.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-INVOICES-07

### GAP-ADMIN-ONBOARDING-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1841 (merged)
- **First-pass claim:** Queue rows do not link to the wizard at /admin/tenant-provision, so a “New Request” cannot be actioned from this page.
- **Verified evidence:** OnboardingTable.tsx:17-22 has no render/link on any column; rows are not clickable. The wizard route exists at apps/web/src/app/(app)/admin/tenant-provision/page.tsx and is linked from the admin index tile (admin/page.tsx:9). Whether tenant-provision can accept a prefill/request id is cannot-verify without reading it or the backend.
- **Files to change:** `apps/web/src/app/(app)/admin/onboarding/OnboardingTable.tsx`, `apps/web/src/app/(app)/admin/tenant-provision/page.tsx`
- **Fix steps:**
  1. Read tenant-provision/page.tsx to see whether it accepts ?requestId=; add prefill from GET /v1/admin/onboarding/{id} if not.
  2. Add a `render` on the Organisation column (or an Actions column) that links to /admin/tenant-provision?requestId=<id> for stage 'new request' / 'go-live pending'.
  3. Show a disabled 'Open wizard' with tooltip for completed rows.
- **Acceptance:**
  - Row with stage 'new request' has an Open wizard link containing its id.
  - Wizard opens prefilled with the requester's org.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; provisioning is a privileged action - ensure the wizard still validates the request id server-side.


---
## /admin/operators  —  `admin/operators.html`

- **Source:** `apps/web/src/app/(app)/admin/operators/page.tsx`
- **Design reference:** `redesign/admin/operators.html`

### GAP-ADMIN-OPERATORS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Account state is inferred from the 2FA column: active = String(o.status ?? o.twoFaStatus ?? "") not suspended/disabled (operators/page.tsx:8). When the row carries no `status`, twoFaStatus “Disabled” counts the operator as Suspended, so an active operator without 2FA is reported as suspended — and the table only shows the 2FA pill, never the account status.
- **Verified evidence:** operators/page.tsx:7: active = String(o.status ?? o.twoFaStatus ?? "").toLowerCase() not 'suspended' and not 'disabled'; when the row has no `status`, twoFaStatus 'Disabled' (2FA off) makes the operator not-active and line 21 Suspended = total - active counts them as Suspended. Table (OperatorsTable.tsx:18-22) has no account-status column - only the 2FA pill - so the mistake is invisible. Whether the API actually sends `status` is cannot-verify (admin-service operators route absent), which decides how often it bites; the fallback is wrong regardless. High severity is fair: an operator card claiming staff are suspended (or hiding true suspensions) on the access-control page.
- **Files to change:** `apps/web/src/app/(app)/admin/operators/page.tsx (or extracted helper)`, `apps/web/src/app/(app)/admin/operators/OperatorsTable.tsx`, `packages/types (SAOperator type)`
- **Fix steps:**
  1. Confirm the operator account-status field with admin-service; type it (active|suspended|invited|...).
  2. Compute Active/Suspended from `status` only; if status is missing count the row as 'Unknown' and show '—' for Suspended instead of guessing.
  3. Never fall back to twoFaStatus.
  4. Add an Account Status column with cellType:"status" next to the 2FA column; add 'suspended' (bad) in STATUS_MAP (already 'disabled'? verify).
- **Acceptance:**
  - Row {status:'active', twoFaStatus:'Disabled'} counts as Active and Suspended stays 0.
  - Row {twoFaStatus:'Disabled'} with no status -> counted Unknown, not Suspended.
  - Table shows account status distinct from 2FA.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Access-control reporting: wrong Suspended count could hide risk or trigger needless action; verify API contract first.
- **Depends on:** GAP-ADMIN-OPERATORS-03

### GAP-ADMIN-OPERATORS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was FABRICATED)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Stat cards are computed in page.tsx from the server-fetched rows (Active = status (or twoFaStatus) not suspended/disabled; 2FA Enabled = twoFaStatus==="enabled"; Suspended = total − active) while the table reads the useSeededResource cache (sa.operators); when the badge says “Showing saved data” the cards read 0 against a populated table (page.tsx stat block vs OperatorsTable.tsx).
- **Verified evidence:** operators/page.tsx:6-21 cards computed from getSAOperators (loaders.ts:4236); OperatorsTable.tsx:7 renders from useSeededResource("sa.operators") with cache fallback -> on cached provenance table populated, cards 0 (and Suspended = 0 - 0 = 0). Note twoFa count is also computed on the same server rows. Not fabricated (theme wrong).
- **Files to change:** `apps/web/src/app/(app)/admin/operators/page.tsx`, `apps/web/src/app/(app)/admin/operators/OperatorsTable.tsx`
- **Fix steps:**
  1. Move the StatGrid out of operators/page.tsx into the client table component (OperatorsTable.tsx) so it is computed from the SAME `rows` returned by useSeededResource("sa.operators") - one data path for cards and table.
  2. Extract the count logic into a pure exported helper (e.g. computeXStats(rows)) in the same folder so it can be unit-tested; keep the server page rendering only PageHeader + <Card>.
  3. When provenance === "error-no-data" pass null to every StatCard value (StatCard.displayValue already renders "—" for null); when provenance === "cached" compute from cached rows and rely on DataSourceBadge to say the data is saved.
  4. Keep DataSourceBadge where it is (it already reads the same provenance).
- **Acceptance:**
  - cached provenance, server [] -> Total Operators equals table rows.
  - error-no-data -> '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-INVOICES-03

### GAP-ADMIN-OPERATORS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: cards render real zeros, and the DataTable shows its own EmptyState; only a small amber DataSourceBadge signals the error (no RefreshErrorState, no retry). Sibling pages in other modules null the stats.
- **Verified evidence:** Same as INVOICES-04: operators/page.tsx:18-21 render zeros on source:'error', including Active 0 and Suspended 0 on a security page; only DataSourceBadge + EmptyState 'No platform operators configured' (OperatorsTable.tsx:24) - which is misleading on failure. No retry, no 403 handling.
- **Files to change:** `apps/web/src/app/(app)/admin/operators/page.tsx`, `apps/web/src/app/(app)/admin/operators/OperatorsTable.tsx`
- **Fix steps:**
  1. Client table wrapper renders <LoadErrorState area="platform operators" backHref="/admin"/> on provenance 'error-no-data'.
  2. Null StatCard values in that state.
  3. Keep DataSourceBadge for cached provenance.
- **Acceptance:**
  - 500/no cache -> retry shown, not 'No platform operators configured'.
  - 403 -> access restricted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-OPERATORS-03, GAP-ADMIN-INVOICES-04

### GAP-ADMIN-OPERATORS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1850 (merged): via #1846 in #1850
- **First-pass claim:** Privileged-account directory with no management actions (no invite, suspend, reset 2FA, role change) and no audit link, though the page is the platform team’s access-control surface; the Permissions column is free text.
- **Verified evidence:** operators/page.tsx and OperatorsTable.tsx render a read-only directory: columns name, role, lastLogin, twoFaStatus, permissions (OperatorsTable.tsx:18-22) with no actions, no link to /admin/audit-log (route exists) and `permissions` printed via String(row[key]) (free text / array toString). Backend operator management endpoints (invite, suspend, reset 2FA, role change) cannot be verified - admin-service not in snapshot - so scope of the fix depends on them.
- **Files to change:** `apps/web/src/app/(app)/admin/operators/OperatorsTable.tsx`, `apps/web/src/app/(app)/admin/operators/page.tsx`, `apps/web/src/app/(app)/admin/operators/[id]/page.tsx (new)`, `services/admin-service operators module (verify)`
- **Fix steps:**
  1. Decide scope with product/security: view-only with audit link (XS) vs full management (L).
  2. Minimum: add PageHeader action 'View audit log' -> /admin/audit-log filtered to operator events, and render Permissions as chips (split array) via column render.
  3. Full: add Invite, Suspend/Reinstate, Reset 2FA, Change role as ActionButton + ConfirmDialog(requireReason) with maker-checker for role changes; each backed by an audited backend command (CQRS, 202).
  4. Prevent self-suspension and last-super-admin removal in both UI and backend.
- **Acceptance:**
  - Audit-log link opens filtered list.
  - Suspend requires reason, emits audit event, and card counts update.
  - Attempting to suspend own account is rejected.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Privileged-access management: high blast radius (lockout, privilege escalation). Needs maker-checker and audit.
- **Depends on:** GAP-ADMIN-OPERATORS-02

### GAP-ADMIN-OPERATORS-06  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1841 (merged)
- **First-pass claim:** Operator names and last-login times are exportable to CSV (OperatorsTable.tsx exportable) without role gate or export audit event.
- **Verified evidence:** OperatorsTable.tsx:24 exportable + exportFilename="operators"; DataTable.downloadCsv (DataTable.tsx:274-291) writes name, role, lastLogin, 2FA, permissions client-side with no role gate, no audit event, and no formula-injection escaping. Whether the /admin area is restricted to platform admins is not verified (no admin/layout.tsx; check (app)/layout.tsx/middleware). Operator names are workforce personal data; last-login is behavioural data.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/admin/operators/OperatorsTable.tsx`, `backend audit endpoint (verify existing)`
- **Fix steps:**
  1. Add DataTable props `exportable` gating callback `canExport` and `onExport({rowCount, filter})`.
  2. OperatorsTable: canExport from session permission (e.g. admin.operators.export), onExport posts an audit event (who/when/rows/filters) before download; abort download if the audit call fails.
  3. Escape leading = + - @ in CSV cells.
  4. Consider dropping lastLogin from export or masking name unless permitted.
- **Acceptance:**
  - User without export permission sees no Export button.
  - Export click sends exactly one audit event with row count; file downloads.
  - Cell beginning '=' is neutralised in the CSV.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP/audit compliance; audit-before-download ordering could block exports if the audit service is down - decide fail-closed vs fail-open.
- **Depends on:** GAP-ADMIN-ONBOARDING-05

### GAP-ADMIN-OPERATORS-07  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Rows are Record<string, unknown> and columns are keyed by loose strings, so the table has no compile-time link to the API shape (OperatorsTable.tsx); status pills rely on StatusPill’s text→variant map, unknown values fall back to grey.
- **Verified evidence:** Confirmed: Row = Record<string, unknown>, string column keys (OperatorsTable.tsx:5,18-22). StatusPill unknown -> 'info' (blue) not grey; the 2FA column values 'Enabled'/'Disabled' (page.tsx:8,20) map: 'enabled' is not in STATUS_MAP -> info-blue, 'disabled' not in STATUS_MAP either -> info-blue, so a missing-2FA operator looks identical to an enabled one (no red/warn cue). 'inactive' exists in the map but not 'disabled'/'suspended'.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/admin/operators/OperatorsTable.tsx`, `packages/types (SAOperator type)`
- **Fix steps:**
  1. Add 'enabled' (good), 'disabled' (warn for 2FA; bad for account), 'suspended' (bad) to STATUS_MAP - or, better, give the 2FA column a `render` with explicit mapping (enabled=good 'Enabled', otherwise warn 'Not enabled') so account-status semantics don't clash.
  2. Type rows with SAOperator; typed mapper in getSAOperators.
- **Acceptance:**
  - 2FA 'Disabled' renders warn tone with text (not colour only).
  - tsc rejects invalid column key.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** StatusPill is shared; adding 'disabled' globally changes other tables - prefer the column-level render.
- **Depends on:** GAP-ADMIN-OPERATORS-02


---
## /admin/org  —  `admin/org.html`

- **Source:** `apps/web/src/app/(app)/admin/org/page.tsx`
- **Design reference:** `redesign/admin/org.html`

### GAP-ADMIN-ORG-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Rename commits on blur as well as Enter (OrgHierarchyManager.tsx:167-172): clicking away saves immediately, and pressing Enter unmounts the input which can also blur — handleRename compares against `units` that is only refreshed after the PATCH, so a second identical PATCH can be sent.
- **Verified evidence:** OrgHierarchyManager.tsx:164-174: rename input commits on onBlur (167) and on Enter (169). handleRename (232-244) compares against `units` (236-237), which is only replaced after the PATCH via refresh() (243), and has no in-flight guard (busy is set but not checked). Enter calls onRename then setEditingId(null) unmounts the input; whether React fires a second onBlur on that unmount is browser/React-version dependent (Chrome may blur a removed focused node), so a duplicate PATCH is possible, not certain. More concrete: Escape (170) calls onCancelRename and unmounts the input, which can also trigger blur and COMMIT the edited text the user meant to cancel. Blur-saves-on-click-away is confirmed.
- **Files to change:** `apps/web/src/app/(app)/admin/org/OrgHierarchyManager.tsx`
- **Fix steps:**
  1. In OrgTreeNode, keep a ref `settledRef` set true on Enter/Escape before unmounting; onBlur returns early when settledRef.current is true.
  2. Escape must set settledRef and cancel without saving; blur with unchanged value must be a no-op.
  3. In handleRename add `if (busy) return` (or a Set of in-flight ids) and compare against the latest units via a ref or functional check.
  4. Optionally remove blur-commit and add explicit Save/Cancel icon buttons for clarity.
- **Acceptance:**
  - Test: type new name + Enter -> exactly one PATCH (fetch mock call count 1).
  - Type new name + Escape -> zero PATCH calls.
  - Type new name + click elsewhere -> one PATCH.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; renames are non-monetary but propagate to org displays and approvals routing - avoid unintended renames.

### GAP-ADMIN-ORG-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1841 (merged)
- **First-pass claim:** Structure is only additive: no delete, deactivate, move/reparent or head-of-unit assignment although AdminOrgUnit carries parentId and headUserId (loaders.ts:5015) and the backend supports reparent; “Every change saves immediately” with no confirm or undo.
- **Verified evidence:** UI is additive only: OrgTreeNode (128-208) offers Rename (179) and '+ Add child' (180); CreateUnitForm has no parent picker or head; no delete/deactivate/move. AdminOrgUnit carries parentId and headUserId (loaders.ts:5015-5023) - true. Text 'Every change saves immediately' at OrgHierarchyManager.tsx:269 - true, no confirm/undo. 'Backend supports reparent' is cannot-verify: tenant-service is not in the snapshot; the page comment (org/page.tsx:4-14) says the module is 'cycle-checked on reparent', which supports it, but delete/deactivate endpoints are unknown. Unit changes are org-structure edits, not credentials, so ConfirmDialog with mandatory reason is warranted only for destructive/reparent actions, not for every add.
- **Files to change:** `apps/web/src/app/(app)/admin/org/OrgHierarchyManager.tsx`, `apps/web/src/app/_data/loaders.ts (units already typed)`, `services/tenant-service org-hierarchy module (verify routes; add deactivate)`
- **Fix steps:**
  1. Verify tenant-service org-hierarchy routes for PATCH parentId/headUserId and DELETE/deactivate; record findings.
  2. Add 'Move' (parent select excluding self and descendants) and 'Set head' (user picker) actions to OrgTreeNode using PATCH /{id}.
  3. Add 'Deactivate' as ActionButton + ConfirmDialog(danger, requireReason) that shows the number of child units affected; block when children exist unless reassigned.
  4. Replace the 'saves immediately' note with a toast (ds Toast) offering Undo for rename/move where the backend allows it; otherwise state clearly that the change is immediate.
  5. Ensure backend emits an audit event per structure change.
- **Acceptance:**
  - Moving a unit under its own descendant is prevented in UI and rejected by backend.
  - Deactivate requires reason; audit event created.
  - Assigning head persists headUserId and shows the name.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Org tree drives approval routing and RBAC scoping; a wrong reparent or deactivate can misroute approvals - require audit and, for prod tenants, consider maker-checker.
- **Depends on:** ds ConfirmDialog, EntityPicker (user) - check existence

### GAP-ADMIN-ORG-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Tree accessibility: <ul role="tree"> holds <li> without role="treeitem", aria-expanded or arrow-key navigation, and nodes cannot be collapsed — a large department tree renders fully expanded; row buttons are labelled only “Rename” / “+ Add child” with no unit name in the accessible name.
- **Verified evidence:** OrgHierarchyManager.tsx:282 <ul role="tree"> with <li> children lacking role="treeitem" (160), no aria-expanded/aria-level/aria-selected, nested <ul role="group"> (188) is attached to the li not to a treeitem, no arrow-key handling, no collapse control (children always rendered, 187-205). Action buttons (179-180) read only 'Rename' / '+ Add child' with no unit name in the accessible name (the rename input does include the name, 173). Type is conveyed by colour dot (162, aria-hidden) plus a text pill (178) so colour-only is not an issue. Theme tag I18N is wrong (a11y).
- **Files to change:** `apps/web/src/app/(app)/admin/org/OrgHierarchyManager.tsx`
- **Fix steps:**
  1. Give each <li> role="treeitem" with aria-level={depth+1}, aria-expanded (when it has children), aria-selected; keep child <ul role="group">.
  2. Add expand/collapse chevron Button (aria-expanded, aria-label=`Collapse ${node.name}`) with local expanded state (default expanded to depth 1 for large trees).
  3. Implement roving tabindex + Arrow Up/Down/Left/Right, Home/End per WAI-ARIA tree pattern, or switch to a plain nested list without role=tree (simpler and valid).
  4. Set aria-label on buttons: `Rename ${node.name}`, `Add child unit under ${node.name}`.
- **Acceptance:**
  - axe: no aria-required-children/aria-required-parent violations.
  - ArrowRight on a collapsed node expands it; ArrowDown moves focus to next visible item.
  - Screen-reader name of the button includes the unit name.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; if the full tree pattern is too costly, dropping role=tree is a valid minimal fix.

### GAP-ADMIN-ORG-05  ·  LOW  ·  partly  ·  theme OTHER (was FAILMASK)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Unit type colours are hard-coded hex in TYPE_COLORS (:9-15) with 10.5px pills; “Code (optional)” is unvalidated free text; a failed load and an empty tree differ only by one sentence (:279).
- **Verified evidence:** TYPE_COLORS hard-coded hex at OrgHierarchyManager.tsx:12-18 (obs said 9-15) and used at 162/178/304; type pill fontSize 10.5 (178) - true. Also hard-coded #b42318/#fef2f2/#fecaca at 123, 262. 'Code (optional)' input (111-118) is trimmed only, unvalidated - true (no length/charset check; backend validation unknown). Failed-load vs empty: overstated - line 260 renders DataSourceBadge with 'Couldn't load the org hierarchy - showing nothing' when source==='error', in addition to the differing sentence at 279; but there is still no retry, and the tree shows the 'no units yet, add one' CTA-style page alongside (top-level add button active), inviting creation on a failed load. Also refresh() (220-230) swallows failures silently (`if (!res.ok) return;`), so after a successful create the tree may not update with no message.
- **Files to change:** `apps/web/src/app/(app)/admin/org/OrgHierarchyManager.tsx`, `apps/web/src/app/(app)/admin/org/page.tsx`
- **Fix steps:**
  1. When source === "error" and no units, render <LoadErrorState result={...} area="organisation hierarchy" backHref="/admin"/> (server page passes status/errorMessage) instead of the empty tree, and disable '+ Add top-level unit'.
  2. Make refresh() set an error ('Saved, but the tree could not be refreshed - reload') on failure instead of returning silently.
  3. Replace TYPE_COLORS hex with CSS tokens (var(--info), var(--good), ...) and raise the pill to >=12px.
  4. Validate Code in CreateUnitForm (e.g. /^[A-Z0-9_-]{1,20}$/i, trim, uppercase) and show field error; mirror the backend rule (verify in tenant-service).
- **Acceptance:**
  - source='error' with no units -> Retry button, no 'No organisational units yet' text, Add button disabled.
  - Code 'a b!' shows a validation message and no POST is sent.
  - Pill font size >= 12px and colours resolve from tokens in dark mode.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** ds LoadErrorState


---
## /admin/role-features  —  `admin/role-features.html`

- **Source:** `apps/web/src/app/(app)/admin/role-features/page.tsx`
- **Design reference:** `redesign/admin/role-features.html`

### GAP-ADMIN-ROLE-FEATURES-02  ·  HIGH  ·  confirmed  ·  theme COUNT-MISMATCH (was FABRICATED)

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Matrix rows come only from the hard-coded FEATURE_KEYS (RoleFeaturesManager.tsx:16), but “Active grants” counts every grant returned by the API (:131 totalGrants). A grant for a key outside the list is counted yet can never be seen or revoked in the UI; the number and the visible ticks disagree.
- **Verified evidence:** RoleFeaturesManager.tsx:16-23 FEATURE_KEYS (16 keys) drives matrix rows (:210). totalGrants (:131) = every grant from GET /v1/policy/role-features with granted=true (loader loaders.ts:5104-5118 does not filter to known keys or known roles). A grant with an off-list featureKey (or a role not in roles) is counted in 'Active grants' (:159) and listed in the Preview modal (:246, via roleGrants :130) but has no checkbox, so it cannot be revoked from the UI.
- **Files to change:** `apps/web/src/app/(app)/admin/role-features/RoleFeaturesManager.tsx`
- **Fix steps:**
  1. Build rows as union of FEATURE_KEYS and distinct g.featureKey values from grants (useMemo), sorted; mark keys not in FEATURE_KEYS with a 'not in catalogue' pill.
  2. Derive totalGrants from grants whose role is in roles[] (or label the card 'Active grants (all roles)') so the number equals visible ticks plus orphans.
  3. Render orphan rows with the same checkbox so handleToggleGrant can DELETE them by existing.id.
  4. Show a count of grants for roles not in the roles list in a small note if any.
- **Acceptance:**
  - Component test: initialGrants contains {featureKey:'legacy.thing',roleName:'hr_admin',granted:true}; a row 'legacy.thing' renders with a checked checkbox.
  - Sum of checked boxes across the matrix equals the 'Active grants' value.
  - Unchecking the orphan calls DELETE /api/proxy/v1/policy/role-features/{id}.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only display change plus revoke of stale grants (access-control data) - revoke stays a deliberate click.

### GAP-ADMIN-ROLE-FEATURES-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Toggling any checkbox fires an immediate POST/DELETE with no confirmation, including admin.settings and admin.users (:16-23, :221); the revoke is removed from local state on the 202 while the backend applies it asynchronously (:90-91), so the matrix can show a state the server has not reached.
- **Verified evidence:** Confirmed: handleToggleGrant (RoleFeaturesManager.tsx:79-104) POSTs/DELETEs on checkbox onChange (:221) with no ConfirmDialog, including admin.settings/admin.users (:22); no reason captured, no maker-checker in client. Overstated: the UI does disclose async apply - :91/:100 show 'the change is queued and may take a moment to fully apply.' Also on grant, if the response has no id (:98-99) the grant is not added locally but the notice still says 'Granted', leaving the checkbox unchecked. Audit emission/maker-checker enforcement is server-side (policy-service not in snapshot) - cannot verify.
- **Files to change:** `apps/web/src/app/(app)/admin/role-features/RoleFeaturesManager.tsx`
- **Fix steps:**
  1. Use useConfirmAction/ConfirmDialog from @/app/_components/ds around handleToggleGrant (and handlePresetApply) with requireReason and danger for revokes and for admin.* keys.
  2. Pass the reason in the POST/DELETE body only if policy-service accepts one (verify in services/policy-service role-features module); otherwise log it via the audit event on server.
  3. When POST returns ok without id, refetch GET /api/proxy/v1/policy/role-features and replace grants instead of showing 'Granted'.
  4. Keep the queued notice; add aria-busy on the row while pending.
- **Acceptance:**
  - Clicking an admin.users checkbox opens the dialog; no fetch until Confirm; Cancel leaves checkbox unchanged.
  - Confirm with empty reason keeps Confirm disabled.
  - POST 202 with empty body triggers refetch, checkbox ends checked.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Access-control screen: a wrong toggle changes who sees finance/admin features; dialog reduces mis-clicks. Backend must persist reason/audit for it to be meaningful.
- **Depends on:** ConfirmDialog

### GAP-ADMIN-ROLE-FEATURES-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Presets loop one POST per feature and break on the first failure (:110-123): a failed 3rd call leaves a partial preset applied, and the banner reports only the error, not how many succeeded.
- **Verified evidence:** handlePresetApply (RoleFeaturesManager.tsx:106-128) loops sequential POSTs, skips already-granted, and on first failure sets error and break (:121-123). Earlier successes stay applied (setGrants at :118). The success notice (:127) is set only if granted>0 but the render at :151 hides notice whenever error is set, so the user sees only the error and never how many succeeded or which feature failed (error text is generic roleFeatureError()).
- **Files to change:** `apps/web/src/app/(app)/admin/role-features/RoleFeaturesManager.tsx`
- **Fix steps:**
  1. Track succeeded[] and failed feature in handlePresetApply; after loop set a single summary message: 'Granted N of M; failed at <feature>. Applied grants were kept.'
  2. Render summary in the alert/status region (allow notice and error together, drop the !error guard at :151).
  3. Optionally continue past failures and list all failed keys, then refetch GET to resync.
  4. Ask for confirmation of the whole preset via ConfirmDialog (see -03).
- **Acceptance:**
  - Mock POST: ok, ok, 500 -> banner reads 'Granted 2 of 5 ... failed at <key>'; two ticks are checked.
  - All ok -> notice 'Granted N features'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Partial application of access grants is possible by design (no bulk endpoint); message must not imply rollback.
- **Depends on:** GAP-ADMIN-ROLE-FEATURES-03

### GAP-ADMIN-ROLE-FEATURES-05  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Preview modal is role=dialog with no Esc handler, focus trap or backdrop click (:235-255) and hard-codes #fff/#f0fdf4 backgrounds, so it stays light in dark mode.
- **Verified evidence:** Preview modal (RoleFeaturesManager.tsx:234-256) is role='dialog' aria-modal with only a Close button (:239): no Escape handler, no backdrop click, no focus move/trap/restore, no inert background. Inline colours #fff (:236), #666 (:241), #999 (:244), #f0fdf4/#16a34a (:247-248) ignore dark theme. Caveat: I found no CSS defining .modal-overlay/.modal-content anywhere in the repo (grep excluding node_modules), so the overlay may not even be positioned as an overlay - verify in browser. ConfirmDialog (ds/ConfirmDialog.tsx) already implements Esc, overlay click, trap and inert but has no 'info' variant.
- **Files to change:** `apps/web/src/app/(app)/admin/role-features/RoleFeaturesManager.tsx`, `apps/web/src/app/_components/ds/Modal.tsx (new, or extend ConfirmDialog)`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Create a shared ds <Modal open title onClose> extracted from ConfirmDialog's focus/Esc/overlay/inert logic (portal, role='dialog').
  2. Replace the hand-rolled preview block with <Modal>; remove Close-only handling.
  3. Replace #fff/#f0fdf4/#666/#999/#16a34a with CSS variables (--panel, --ink2, --mut, --good-bg).
  4. Define .modal-overlay/.modal-content in civitas-ds.css or delete the class use.
- **Acceptance:**
  - Component test: open preview, press Escape -> dialog removed, focus returns to Preview button.
  - Tab cycles within dialog only.
  - Toggle data-theme=dark -> modal background follows --panel.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared Modal reused by FeatureFlagsManager, PlansClient, WebhooksClient, DomainClient which use the same class pattern.
- **Depends on:** GAP-ADMIN-SCHEDULED-JOBS-05

### GAP-ADMIN-ROLE-FEATURES-06  ·  LOW  ·  confirmed  ·  theme COPY-I18N (was FABRICATED)

- [x] **Status** — PR #1806 (merged)
- **First-pass claim:** Badge “Couldn't load role/feature data — showing nothing” (:145) is shown when either of two fetches fails without saying which; all strings are hard-coded English (no next-intl keys); loading.tsx is Tailwind utility classes unlike the sibling routes' .skeleton.
- **Verified evidence:** page.tsx:23-27 merges rolesSource and grantsSource into one 'error' value, so RoleFeaturesManager.tsx:145 shows the same message 'Couldn't load role/feature data - showing nothing' for either failure. Strings in the file (titles, presets, table headers, notices :91/:100/:127, 'Preview: As') are hard-coded English although 181 other files use useTranslations. loading.tsx uses Tailwind (animate-pulse, bg-gray-200) whereas sa-dashboard/loading.tsx and tech-admin/loading.tsx use className 'skeleton'. Note: role_feature_grants failing hides all ticks, so a partial failure (roles ok, grants failed) shows an empty matrix that looks like 'no grants'.
- **Files to change:** `apps/web/src/app/(app)/admin/role-features/page.tsx`, `apps/web/src/app/(app)/admin/role-features/RoleFeaturesManager.tsx`, `apps/web/src/app/(app)/admin/role-features/loading.tsx`, `apps/web/messages/*.json`
- **Fix steps:**
  1. Pass rolesSource and grantsSource separately; message names the failed part ('roles' / 'current grants').
  2. When grantsSource==='error' disable checkboxes and presets (prevents POSTing over unknown state) and render RefreshErrorState.
  3. Move visible strings to next-intl keys (useTranslations('admin.roleFeatures')).
  4. Rewrite loading.tsx with SkeletonCard/SkeletonTable from ds or the .skeleton class.
- **Acceptance:**
  - Grants fetch fails -> badge mentions grants, checkboxes disabled.
  - Rendering with locale hi shows translated headings (where catalogue exists).
  - Loading route renders the same skeleton as sibling routes.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Disabling writes when grants unknown avoids duplicate/blind grants.
- **Depends on:** RefreshErrorState


---
## /admin/roles  —  `admin/roles.html`

- **Source:** `apps/web/src/app/(app)/admin/roles/page.tsx`
- **Design reference:** `redesign/admin/roles.html`

### GAP-ADMIN-ROLES-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Switching the role select (:142) re-runs the fetch effect (:66) and overwrites `selected`, silently discarding unsaved toggles; the save button count (:163) is the only hint they existed.
- **Verified evidence:** RolesPermissionsManager.tsx:142 select onChange calls setSelectedRoleId, which re-runs the effect at :66-86 -> fetchRolePermissions then setBaseline/setSelected (:79-82), replacing `selected` with server keys and resetting saveState to idle (:71). Unsaved toggles are dropped with no prompt; the only cue was the 'Save N changes' label (:163).
- **Files to change:** `apps/web/src/app/(app)/admin/roles/RolesPermissionsManager.tsx`
- **Fix steps:**
  1. Replace onChange with handleRoleChange(nextId): if changedCount>0 open ConfirmDialog 'Discard N unsaved changes?' (danger); switch only on confirm.
  2. Keep select value bound to selectedRoleId until confirmed.
  3. Add a beforeunload listener while changedCount>0.
- **Acceptance:**
  - Toggle one permission, change role -> dialog appears; Cancel keeps role and toggle.
  - Confirm -> new role loaded, changedCount 0.
  - No dialog when nothing changed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents silent loss of RBAC edits.
- **Depends on:** ConfirmDialog

### GAP-ADMIN-ROLES-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** “Total permissions” is permissions.length from a limit=200 request (loaders.ts getAdminPermissionsList) — a tenant with more keys shows a truncated checklist and count with no notice; “Granted to selected role” (:130) counts unsaved toggles as granted.
- **Verified evidence:** loaders.ts:4901 getAdminPermissionsList requests /api/v1/admin/permissions?limit=200 and returns only the array (no total). RolesPermissionsManager.tsx:129 shows permissions.length as 'Total permissions' and renders every row (:182); more than 200 keys would be silently truncated. :130 'Granted to selected role' = selected.size (:117), which includes unsaved toggles and any granted keys absent from the truncated list. Whether the endpoint supports offset/total is cannot-verify (admin-service not in snapshot).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/admin/roles/RolesPermissionsManager.tsx`, `apps/web/src/app/(app)/admin/roles/page.tsx`
- **Fix steps:**
  1. Extend getAdminPermissionsList to return {rows,total?,truncated: rows.length>=200}.
  2. When truncated show a banner 'Showing first 200 permissions' and label the card 'Loaded permissions'.
  3. Compute 'Granted to selected role' from baseline.size and show '+N unsaved' separately.
  4. If the API supports offset/total, page through until exhausted (needs backend confirmation).
- **Acceptance:**
  - Loader test: 200 rows -> truncated true, banner rendered.
  - Toggle 2 checkboxes -> granted card unchanged, '+2 unsaved' shown.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong counts could mislead an RBAC reviewer.

### GAP-ADMIN-ROLES-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** System roles are selectable but show only a notice (:171-173): a reviewer cannot see what super_admin/platform_admin hold, although the role GET is already fetched by the effect for them.
- **Verified evidence:** Effect (RolesPermissionsManager.tsx:66-86) has no isSystem guard, so selecting a system role does fetch GET /api/proxy/v1/admin/roles/:id and fills `selected`, but the render branch (:171-173) shows only 'is a system role - its permissions are fixed' and the list is never drawn. Whether the backend returns permissions for system roles is cannot-verify; page.tsx comment says GET /v1/admin/roles/:id exists.
- **Files to change:** `apps/web/src/app/(app)/admin/roles/RolesPermissionsManager.tsx`
- **Fix steps:**
  1. Render the same checklist for system roles with every checkbox disabled and a read-only banner; use the loaded `selected`.
  2. Make the loading and loadError branches apply to system roles too (reorder ternary so isSystem only disables).
  3. Keep Save disabled (already :159).
- **Acceptance:**
  - Select super_admin with GET returning keys -> checked disabled boxes listed.
  - Checkbox click does nothing; Save disabled.
  - GET fails -> role='alert' load error shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; exposes permission list of privileged roles to anyone who can open /admin/roles (no route gate) - confirm backend GET is role-guarded.

### GAP-ADMIN-ROLES-06  ·  LOW  ·  partly  ·  theme DARKMODE-UX (was FABRICATED)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Checklist is a grid of full-width labels with hard-coded #4f46e5/#eef2ff (dark mode), unlabeled flat list of every permission key with no grouping or search; loading is plain text, not a Skeleton.
- **Verified evidence:** Hard-coded #4f46e5/#eef2ff (RolesPermissionsManager.tsx :190-191) do not adapt to dark mode. Loading state is plain text 'Loading current permissions...' (:175) and roles route has no loading.tsx (dir lists only manager+page). No grouping or search over the flat list (:182). Overstated: each row is a <label> wrapping the checkbox, so controls are labelled; 'full-width' is by design.
- **Files to change:** `apps/web/src/app/(app)/admin/roles/RolesPermissionsManager.tsx`, `apps/web/src/app/(app)/admin/roles/loading.tsx (new)`
- **Fix steps:**
  1. Swap #4f46e5/#eef2ff for CSS variables (--primary, --primary-bg) defined for both themes.
  2. Group permissions by key prefix (split on first '.' or ':') with <fieldset><legend> and per-group select-all.
  3. Add a filter input above the list.
  4. Use SkeletonRow/SkeletonTable for loading and add roles/loading.tsx.
- **Acceptance:**
  - Dark theme: selected row background uses theme token.
  - Typing 'hr' filters rows.
  - Loading shows skeleton, not text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; UI only. Filtering must not drop hidden checked keys from the PATCH payload (selected set unchanged).
- **Depends on:** GAP-ADMIN-ROLES-04


---
## /admin/sa-dashboard  —  `admin/sa-dashboard.html`

- **Source:** `apps/web/src/app/(app)/admin/sa-dashboard/page.tsx`
- **Design reference:** `redesign/admin/sa-dashboard.html`

### GAP-ADMIN-SA-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** The dashboard endpoint has no route (page.tsx:19-24 comment), so every load is the fallback {}: Active Tenants renders “0” (:11 Number(activeTenants ?? 0)) — a fabricated zero rather than “—” like the other cards — and the KPI table is permanently empty. Real tenant count exists on /admin/tenants.
- **Verified evidence:** sa-dashboard/page.tsx:11 `Number(dashboard.activeTenants ?? 0)` renders '0' (StatCard displayValue only maps null/NaN to a dash, page.tsx:93 passes number 0). Users (:18), uptime (:27-28) and services (:34-37) all use '-' when unknown, so tenants is the only fabricated zero. Comment :19-24 states GET /api/v1/admin/sa-dashboard has no matching route, and loader getSADashboard (loaders.ts:4278) falls back to {} on error, so metrics (SADashboardTable.tsx:5) is always []. Route absence itself is cannot-verify (admin-service is not in the snapshot; only hrms-service is). /admin/tenants/page.tsx:5-7 derives real counts from getSATenants().
- **Files to change:** `apps/web/src/app/(app)/admin/sa-dashboard/page.tsx`
- **Fix steps:**
  1. Compute tenants = dashboard.activeTenants == null ? null : Number(dashboard.activeTenants) and pass null to StatCard (renders dash).
  2. Optionally fetch getSATenants() in Promise.all and fall back to count of status==='active' when dashboard lacks the field.
  3. Show a DataSourceBadge/notice when dashboard came back as {} (no metrics), not only on source==='error'.
- **Acceptance:**
  - Render with getSADashboard -> {data:{},source:'api'}: Active Tenants card shows dash, not 0.
  - With activeTenants:0 from API the card shows 0.
  - With tenants fallback list of 3 active -> shows 3.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; do not present the tenant-list fallback as the dashboard endpoint's number without a label.
- **Depends on:** GAP-ADMIN-SA-DASHBOARD-03

### GAP-ADMIN-SA-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Subtitle promises “health, revenue and growth” (:43) but no revenue or growth figure exists anywhere on the page; empty copy “Connect to a live platform.” (SADashboardTable.tsx:24) is developer language for an operator.
- **Verified evidence:** page.tsx:43 subtitle 'Platform-wide health, revenue and growth overview.' but the page renders only tenants, users, uptime, services and a KPI table sourced from dashboard.metrics; no revenue/growth field is read anywhere. SADashboardTable.tsx:24 empty copy 'Dashboard metrics not available. Connect to a live platform.' is developer wording.
- **Files to change:** `apps/web/src/app/(app)/admin/sa-dashboard/page.tsx`, `apps/web/src/app/(app)/admin/sa-dashboard/SADashboardTable.tsx`
- **Fix steps:**
  1. Change subtitle to 'Platform-wide tenants, users, uptime and service status.' (or add revenue/growth only once a real field exists).
  2. Change emptyMessage to plain operator copy, e.g. 'Platform KPIs are not being reported yet.'
  3. Move both strings to next-intl keys.
- **Acceptance:**
  - Snapshot/RTL test: subtitle no longer contains 'revenue'.
  - Empty table shows the new message; no 'Connect to a live platform'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ADMIN-SA-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Two of four stat cards (Total Users, Platform Uptime) are always “—” with only a grey icon tint as the cue (:50-51); no text explains it is unavailable, not zero-ever.
- **Verified evidence:** page.tsx:49-50 Total Users and Platform Uptime pass '-' plus a grey iconBg (#f2f4f7, :50 only for uptime; users always #ecfdf3 at :49) as the only unavailable cue. StatCard (ds/StatCard.tsx) has no hint/note prop, so no text says 'not reported'. Correction: users card is not grey-tinted, only uptime and services are. Both values stay a dash whenever the backend returns null/no route.
- **Files to change:** `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/(app)/admin/sa-dashboard/page.tsx`
- **Fix steps:**
  1. Add optional `note?: string` prop to StatCard rendered under the value in .lab-like small text.
  2. Pass note='Not reported by the platform yet' for users/uptime when null and note='Ops snapshot unavailable' for services when opsUnavailable.
  3. Give StatCard title/aria-label 'unavailable' for the dash so screen readers do not read 'dash'.
- **Acceptance:**
  - Card with value null renders '-' and the note text.
  - Cards with a value render no note.
  - axe: no colour-only cue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatCard is shared by ~all dashboards; new prop is optional so no behaviour change elsewhere.
- **Depends on:** GAP-ADMIN-SA-DASHBOARD-04

### GAP-ADMIN-SA-DASHBOARD-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Data badge is shown only for the dashboard fetch (:45); a failed /v1/admin/operations (super-admin only, and page has no gate) collapses Services to “—” with no message.
- **Verified evidence:** page.tsx:45 DataSourceBadge is rendered only when the dashboard fetch errored (source==='error'); opsSource (from getSAOperationsSnapshot, loaders.ts:4291, /api/v1/admin/operations documented as requireSuperAdmin-gated) only feeds servicesLabel (:34-37) which collapses to a dash with no message. Confirmed. Role gate: there is no admin layout.tsx and no role check in this page or middleware.ts, so a non-super-admin lands on the page and sees dashes (roleGuard.requireAnyRole exists at lib/auth/roleGuard.ts and is used only in hr/layout.tsx). Server enforcement of super-admin is cannot-verify (admin-service absent).
- **Files to change:** `apps/web/src/app/(app)/admin/sa-dashboard/page.tsx`, `apps/web/src/app/(app)/admin/layout.tsx (new, or per-page)`
- **Fix steps:**
  1. Call requireAnyRole(['super_admin','platform_admin']) from @/lib/auth/roleGuard in sa-dashboard/page.tsx (or an admin/sa layout) with redirect to /dashboard.
  2. Show a second DataSourceBadge with message 'Service status could not be loaded' when opsSource==='error', and 'Service manager not reachable' when pm2Available===false.
  3. Show badge for the dashboard fetch as now.
- **Acceptance:**
  - Session without super_admin -> redirected.
  - ops fetch 403/500 -> visible message and Services dash.
  - Both ok -> no badges.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Role list must match identity-service role names (super_admin/platform_admin per moduleVisibility.ts:42) or admins lock themselves out; server guard remains the real control.
- **Depends on:** ROLEGUARD-admin-layout

### GAP-ADMIN-SA-DASHBOARD-05  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Status column uses StatusPill, whose STATUS_MAP has no healthy/degraded/warning keys (ds/StatusPill.tsx:5-38), so those values render as neutral blue; SADashboardTable accepts `source` but never uses it (:4).
- **Verified evidence:** ds/StatusPill.tsx:5-39 STATUS_MAP has no healthy/degraded/warning/ok/down/unhealthy keys; unknown status falls to variant 'info' (:53) rendered as .pill.info. SADashboardTable.tsx:13 uses cellType 'status' -> DataTable cellValue (DataTable.tsx:127) -> StatusPill. SADashboardTable.tsx:4 destructures `source = 'api'` and never uses it. The actual status values the backend emits for metrics are cannot-verify (endpoint has no route per page.tsx:19-24).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/admin/sa-dashboard/SADashboardTable.tsx`
- **Fix steps:**
  1. Add to STATUS_MAP: healthy/ok/operational/online/running -> good; degraded/warning/slow -> warn; down/unhealthy/offline/stopped/critical -> bad.
  2. Remove the unused `source` prop from SADashboardTable (and the caller at page.tsx:99) or use it to switch emptyMessage on error.
  3. Add unit test in StatusPill tests for each new key.
- **Acceptance:**
  - StatusPill status='degraded' renders class 'pill warn'; 'healthy' -> 'pill good'.
  - ESLint no-unused-vars clean for SADashboardTable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is app-wide; the new keys must not change any existing page that used those words expecting neutral blue (grep 'healthy|degraded|running|stopped' usages first).
- **Depends on:** GAP-ADMIN-TECH-ADMIN-02


---
## /admin/scheduled-jobs  —  `admin/scheduled-jobs.html`

- **Source:** `apps/web/src/app/(app)/admin/scheduled-jobs/page.tsx`
- **Design reference:** `redesign/admin/scheduled-jobs.html`

### GAP-ADMIN-SCHEDULED-JOBS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Delete (🗑️) and Run Now call the API on one click with no ConfirmDialog (ScheduledJobsManager.tsx:112-128, :241-243): a mis-click deletes a job or fires a payroll/report command immediately.
- **Verified evidence:** ScheduledJobsManager.tsx:241 Run Now onClick -> handleRunNow (:112-119) POST /v1/admin/scheduled-jobs/:id/run-now; :243 Delete onClick -> handleDelete (:121-128) DELETE; neither opens a ConfirmDialog (component not imported). Also handleToggle (:103-110) disables/enables a job on one click. Payload/target are arbitrary (targetService/targetCommand from the create form :284-303) so Run Now can fire any command. Server-side audit/maker-checker is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/scheduled-jobs/ScheduledJobsManager.tsx`
- **Fix steps:**
  1. Wrap Delete in ActionButton/useConfirmAction from @/app/_components/ds: danger, requireReason, title 'Delete job <name>?'.
  2. Wrap Run Now in a confirm (description shows targetService -> targetCommand); requireReason for jobs whose targetService is finance/hrms.
  3. Optionally confirm before disabling an enabled job.
  4. Send the reason to the API only if the admin-service DELETE/run-now routes accept it; otherwise keep it in the audit event server-side.
  5. Use the error surfaced by throw inside onConfirm so ConfirmDialog errorMessage shows failures.
- **Acceptance:**
  - Click Delete -> dialog; no DELETE request until Confirm (fetch mock call count 0).
  - Confirm with empty reason keeps button disabled.
  - Escape cancels; focus returns to the row button.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Destructive/side-effecting operations (payroll/report commands); confirmation reduces mis-click risk but maker-checker needs backend support.
- **Depends on:** ConfirmDialog

### GAP-ADMIN-SCHEDULED-JOBS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** After every mutation the list is refreshed by refresh(), which silently returns on a non-OK or thrown response (:95-100); the toggle then still shows the pre-change state even though the server changed.
- **Verified evidence:** refresh() (ScheduledJobsManager.tsx:92-101) returns silently on !res.ok or thrown fetch and only sets jobs when body.data is an array. handleToggle/RunNow/Delete (:103-128) call refresh() only after callApi ok, and toggle checkbox is controlled by job.enabled (:262), so a failed refresh leaves the old state (a deleted job stays listed; a toggled job shows old value) although the server changed, with no message. Also refresh only accepts `{data:[...]}` whereas the server loader accepts array/data/items (apiMappers getArrayPayload); if the proxy returns a bare array the list never updates. Response shape is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/scheduled-jobs/ScheduledJobsManager.tsx`
- **Fix steps:**
  1. Make refresh() return boolean; on failure setError('Saved, but the list could not be reloaded. Reload the page.') using toHumanError('load').
  2. Apply the mutation locally on success first (setJobs(map/filter)), then refresh in background.
  3. Accept array, data, or items in refresh via a shared parse helper mirroring getArrayPayload.
  4. Show a Refresh button (router.refresh()).
- **Acceptance:**
  - Mock PUT ok, GET 500 -> alert shown and toggle reflects new value.
  - DELETE ok, GET throws -> row removed and alert shown.
  - GET returns bare array -> list updates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ADMIN-SCHEDULED-JOBS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** History fetch errors are swallowed to an empty array (:137-138), so “No execution history available.” (:329) is shown for both a job that never ran and an unreachable service.
- **Verified evidence:** openHistory (ScheduledJobsManager.tsx:130-142): non-OK responses go through res.json().catch(()=>({})) -> setHistoryRecords([]) (:136); thrown errors -> setHistoryRecords([]) (:137-138). Render at :329 shows 'No execution history available.' for both empty and failed. Also stale records from a prior job are not cleared on open (loading flag hides them).
- **Files to change:** `apps/web/src/app/(app)/admin/scheduled-jobs/ScheduledJobsManager.tsx`
- **Fix steps:**
  1. Add historyError state; set from toHumanError('load',{area:'execution history'}) when !res.ok or on catch.
  2. Render the error with role='alert' and a Retry button that calls openHistory(historyJobId) instead of the empty message.
  3. Clear historyRecords at the start of openHistory.
- **Acceptance:**
  - History GET 500 -> error text + Retry, not 'No execution history'.
  - 200 with [] -> empty message.
  - Retry success shows rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ADMIN-SCHEDULED-JOBS-05  ·  MEDIUM  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** History panel is position:fixed width 480px (:322), wider than a 390px phone viewport; the table inside has no mobile transform. Running pill animates with no prefers-reduced-motion guard (:42).
- **Verified evidence:** Confirmed: history panel is position:fixed width:480 (ScheduledJobsManager.tsx:322), overflowing a 390px viewport (right-anchored via insetInlineEnd so left part is clipped); its table (:332) has no mobile transform. Refuted: reduced motion - globals-animations.css:100-108 has a blanket @media (prefers-reduced-motion: reduce) that sets animation-duration 0.01ms !important and iteration-count 1 for all elements, covering the inline animation at :42. Also `pulse` keyframes are not defined in repo CSS (only via Tailwind if animate-pulse is generated), so the pill may not animate at all. Theme tag PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/admin/scheduled-jobs/ScheduledJobsManager.tsx`
- **Fix steps:**
  1. Change panel style width to `min(480px, 100vw)` and maxWidth:'100vw'.
  2. Wrap the history table in overflow-x:auto or use ds DataTable with the mobile card transform.
  3. Move the running-pill animation to a CSS class (or drop it) and rely on the existing reduced-motion rule.
  4. Reuse the shared Modal/SidePanel (see ROLE-FEATURES-05) for Esc/focus handling.
- **Acceptance:**
  - At 390px viewport the panel width equals viewport, no horizontal page scroll.
  - Table scrolls inside panel.
  - No inline animation style remains.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-ROLE-FEATURES-05

### GAP-ADMIN-SCHEDULED-JOBS-06  ·  LOW  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** cronToHuman (:28-38) drops AM/PM (“Every day at 8:00” vs preset “8:00 AM”) and returns raw cron for ranges such as 1-5; Target Service list is hard-coded (missing procurement/tenant services); load failure shows “Create one to get started.” (:225).
- **Verified evidence:** cronToHuman (ScheduledJobsManager.tsx:28-38) prints `${hour}:${min}` in 24h with no AM/PM (preset labels at :19-21 say '8:00 AM') and returns raw cron for anything else, e.g. '0 9 * * 1-5'. Bug beyond the report: any cron with dom/mon/dow all '*' that is not the two special cases (e.g. '*/30 * * * *', '0 */2 * * *') falls into the 'Every day at' branch (:36) and prints garbage like 'Every day at *:*/30'. Target Service <option> list (:284-292) is hard-coded to 6 services; which real services are missing (procurement/tenant) is cannot-verify from this snapshot (only hrms-service present). Empty state :225 'No scheduled jobs configured. Create one to get started.' also shows when the load failed (badge at :192 shows separately). Timezone hard-coded 'Asia/Kolkata' (:163).
- **Files to change:** `apps/web/src/app/(app)/admin/scheduled-jobs/ScheduledJobsManager.tsx`, `apps/web/src/lib/cron.ts (new)`, `apps/web/src/lib/cron.test.ts (new)`
- **Fix steps:**
  1. Extract cronToHuman to lib/cron.ts; only humanize when min/hour are integers, format hour with formatTime (12h AM/PM), and return the raw cron otherwise.
  2. Add ranges/steps handling for 1-5 ('weekdays') or fall back to raw.
  3. Guard the 'Create one to get started' text with source!=='error'; show 'Could not load jobs' instead.
  4. Source Target Service options from an API list if one exists (verify in admin-service) else keep the picklist but sync with real service names.
- **Acceptance:**
  - Unit: '0 8 * * *' -> 'Every day at 8:00 AM'; '*/30 * * * *' -> raw cron; '0 9 * * 1-5' -> 'Weekdays at 9:00 AM' or raw.
  - source==='error' -> no 'Create one' copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display-only.


---
## /admin/settings  —  `admin/settings.html`

- **Source:** `apps/web/src/app/(app)/admin/settings/page.tsx`
- **Design reference:** `redesign/admin/settings.html`

### GAP-ADMIN-SETTINGS-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Every section starts from hard-coded constants (page.tsx:123-130, 188-196, 261-268, 324-330) and there is no GET: Save PATCHes the whole values object (:43), so saving one field overwrites the real server settings with the seed defaults for every untouched field — including a blank smtpPass (:193) that can wipe the stored SMTP password.
- **Verified evidence:** settings/page.tsx has no GET/loader: each section's useSectionState initial values are hard-coded (General :123-130, Email :188-196 incl. smtpPass:'' at :193, Security :261-268, Integrations :324-330). save() (:36-56) PATCHes JSON.stringify(values) - the whole object - to /api/proxy/v1/admin/settings/{general|email|security|integrations}. Saving after editing one field therefore submits seed defaults for all untouched fields (org name 'Ministry of Finance...', smtp host smtp.nic.in, empty ipWhitelist, sessionTimeout 30, etc.) and an empty smtpPass. Whether admin-service treats '' as 'clear' or 'unchanged' and whether it merges is cannot-verify (service absent), but the client sends a blank password unconditionally.
- **Files to change:** `apps/web/src/app/(app)/admin/settings/page.tsx`, `apps/web/src/app/(app)/admin/settings/page.tsx (convert to server component + client sections)`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add a getAdminSettings() loader (verify GET route exists at /v1/admin/settings/* in admin-service; if not, raise backend ticket) and pass real values as `initial` to each section.
  2. In save(), send only changed fields (diff values against initial) and omit smtpPass unless the user typed one; render password field placeholder 'unchanged'.
  3. Never show secrets: keep password write-only and server returns hasPassword:boolean.
  4. Show 'Settings could not be loaded' (RefreshErrorState) and disable Save when the GET failed.
  5. Confirm before saving Security/Email sections via ConfirmDialog.
- **Acceptance:**
  - Edit only fromName -> PATCH body contains only {fromName}.
  - Load fails -> Save disabled and error state shown.
  - No request body includes smtpPass unless user typed it.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: can overwrite live SMTP credentials, IP allow-list and MFA/session policy for the whole tenant with demo defaults. Handles secrets (PII/credentials).
- **Depends on:** GAP-ADMIN-SETTINGS-03

### GAP-ADMIN-SETTINGS-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Tenant Config tab shows fabricated facts as if real — tenant “Ministry of Finance”, domain finmin.nic.in, Keycloak realm finmin-prod, DB schema and “42 GB / 100 GB” (:370-405) — labelled platform_admin-only but rendered for everyone; infrastructure identifiers are exposed and wrong for every real tenant.
- **Verified evidence:** TenantConfigSection (settings/page.tsx:369-407) hard-codes usedGb=42/totalGb=100 (:370-371), tenant 'Ministry of Finance', domain 'finmin.nic.in', Keycloak realm 'finmin-prod', DB schema 'fin******', license 'Enterprise - 500 users' (:384-388). Header pill says 'Read-only - platform_admin' (:380) but there is no role check: the tab is in TABS (:19) for every visitor, admin has no layout guard and no middleware role logic. Values are not fetched from any endpoint.
- **Files to change:** `apps/web/src/app/(app)/admin/settings/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Remove the constants; load real tenant config from an existing endpoint (getAdminTenantDetail loaders.ts:4808 / tenants/[id]) or show 'Not available' if none.
  2. Show the tab only when session roles include platform_admin/super_admin (requireAnyRole or pass roles from a server wrapper via getSessionRoles).
  3. Mask realm/schema with the shared masked-value pattern, reveal only for platform_admin with audit.
  4. Drop the storage meter unless a usage endpoint exists.
- **Acceptance:**
  - Non-platform_admin: tab absent and section not rendered.
  - platform_admin: values equal tenant detail API, not 'Ministry of Finance'.
  - No hard-coded tenant strings remain (grep).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Exposes/mis-states infrastructure identifiers (Keycloak realm, DB schema); wrong data on a govt admin screen.

### GAP-ADMIN-SETTINGS-03  ·  HIGH  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** IP whitelist (:265, 322-330) is saved as free text with no CIDR validation and no warning if the admin's own IP is excluded; a bad allow-list can lock out every user including the admin. Same for session timeout / attempts: values are only HTML min/max, empty input becomes 0 via Number() (:286-292).
- **Verified evidence:** Security tab (settings/page.tsx:261-268, 285-292, 312-315): ipWhitelist is a free textarea (:313) sent verbatim; no CIDR parsing, no check that the admin's own IP is inside. sessionTimeoutMin/maxLoginAttempts/passwordMinLen use `Number(e.target.value)` (:286, 289, 292): an emptied input becomes 0, and min/max attributes are only browser hints for form submit (no <form>, save is onClick), so 0 or out-of-range values are sent. useFormError shows server field errors only. Server-side zod validation is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/admin/settings/page.tsx`, `apps/web/src/lib/validation/securitySettings.ts (new)`, `apps/web/src/lib/validation/securitySettings.test.ts (new)`
- **Fix steps:**
  1. Create zod schema: sessionTimeoutMin int 5-480, maxLoginAttempts int 1-20, passwordMinLen int 8-64, ipWhitelist lines each valid IPv4/IPv6 CIDR (max lines).
  2. Keep numeric inputs as strings in state; parse on save; run safeParse in save() and show per-field errors through FieldRow.
  3. Add a lockout guard: fetch current client IP from an existing endpoint if available (else ConfirmDialog warning 'Make sure your own IP is included') before saving a non-empty list.
  4. Disable Save while any field invalid.
- **Acceptance:**
  - Unit: '10.0.0.0/33' and 'abc' rejected; '10.0.0.0/8' accepted.
  - Clearing session timeout shows 'Enter 5-480' and Save disabled; no PATCH sent.
  - Non-empty allow-list save opens the lockout warning dialog.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** High: a wrong allow-list or 0-minute session timeout can lock out all users including admins.
- **Depends on:** ConfirmDialog

### GAP-ADMIN-SETTINGS-04  ·  MEDIUM  ·  confirmed  ·  theme STATE-LOSS (was NAVUX)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Tabs unmount their section (:436-440), so edits are lost when switching tabs although the header comment (:9-11) claims per-section Save avoids losing sibling-tab edits; the unsaved dot disappears with the section.
- **Verified evidence:** Page (settings/page.tsx:435-441) renders only the active section, so switching tabs unmounts it and discards its useSectionState (values, dirty). Header comment :9 claims per-section Save 'avoids losing sibling-tab edits' - true only if you save first. The amber unsaved dot (SaveButton :74) disappears with the section, and no warning is given on tab switch.
- **Files to change:** `apps/web/src/app/(app)/admin/settings/page.tsx`
- **Fix steps:**
  1. Render all sections always and hide inactive ones with the `hidden` attribute (state preserved), or lift useSectionState to the page.
  2. Show a dot on the tab label for dirty sections (lift dirty flags via onDirtyChange).
  3. Add beforeunload while any section is dirty.
  4. Swap hand-rolled tabs for ds <Tabs> (has arrow-key nav) - see -07.
- **Acceptance:**
  - Edit Email host, switch to Security and back -> value and dirty dot retained.
  - Dirty tab label shows indicator.
  - Closing tab prompts beforeunload when dirty.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keeping sections mounted means several forms may be dirty at once - each Save stays per-section.
- **Depends on:** GAP-ADMIN-SETTINGS-07

### GAP-ADMIN-SETTINGS-05  ·  MEDIUM  ·  partly  ·  theme UPLOAD (was PII)

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Logo drop zone is not operable: the visible zone is a div, the file input is 0×0 and only stores the file name as logoUrl (:148-152); nothing is uploaded and the “browse” span has no handler.
- **Verified evidence:** Logo zone (settings/page.tsx:146-151): the dashed div has no onClick/onDrop/onDragOver; the 'browse' span (:148) has no handler; the file input (:150) is absolutely positioned, width 0/height 0/opacity 0. onChange stores only f.name into logoUrl (:150) and nothing is uploaded, so PATCH general sends a bare filename as logoUrl. Overstated: the field label 'Logo' is <label htmlFor={id-logo}> (FieldRow :109), so clicking the label text does open the picker, and the input has an aria-label; drag-and-drop and clicking the visible zone do nothing. Theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/admin/settings/page.tsx`, `apps/web/src/app/_components/ds/FileUpload.tsx`
- **Fix steps:**
  1. Replace the div with ds <FileUpload> (exists, exported from ds index) or make the zone a <label htmlFor> wrapping a visually-hidden but focusable input, with keyboard focus ring.
  2. Validate type png/svg and size <= 2 MB (as the copy states) on the client before upload.
  3. Upload through an existing object-storage/asset endpoint (verify in admin-service) and store the returned URL in logoUrl; if none exists, hide the control (backend gap).
  4. Show preview and remove button.
- **Acceptance:**
  - Click zone opens picker; keyboard Enter/Space on the zone opens it.
  - File > 2 MB rejected with message.
  - PATCH payload logoUrl is a URL returned by upload, not a file name.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; SVG upload is an XSS vector - sanitize server-side.
- **Depends on:** GAP-ADMIN-SETTINGS-01

### GAP-ADMIN-SETTINGS-07  ·  LOW  ·  confirmed  ·  theme A11Y-COPY (was PII)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Subtitle omits the fifth tab (Tenant Config); default From name “CivitasOne HRMS” and USD option are product-inconsistent for a Government edition; tabs are span role=tab without arrow-key navigation or tabpanel labelling.
- **Verified evidence:** Subtitle (settings/page.tsx:417) lists 'General, Email, Security, and Integrations' but TABS has a fifth 'Tenant Config' (:19). Defaults fromName 'CivitasOne HRMS' (:194) and currency option USD (:163) are product-inconsistent for the Govt edition. Tabs are <span role=tab> with Enter/Space only (:422-433): no ArrowLeft/Right/Home/End, no roving tabindex (all tabIndex=0), no ids/aria-controls; tabpanel has only aria-label (:435). ds/Tabs.tsx already implements roving tabindex and arrow keys.
- **Files to change:** `apps/web/src/app/(app)/admin/settings/page.tsx`, `apps/web/src/app/_components/ds/Tabs.tsx`
- **Fix steps:**
  1. Fix subtitle text (or generate from TABS).
  2. Change default fromName to the tenant/org name from real settings (see -01) and make currency list edition-driven (INR only for Govt).
  3. Use ds <Tabs> for the tablist; extend it with id/aria-controls and add id + aria-labelledby on the tabpanel.
  4. Move strings to next-intl.
- **Acceptance:**
  - ArrowRight moves focus and selection to next tab; only the selected tab has tabIndex 0.
  - tabpanel has aria-labelledby the active tab id.
  - Subtitle mentions all five tabs.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Ds Tabs is shared; adding optional id props must not change other consumers.
- **Depends on:** GAP-ADMIN-SETTINGS-01


---
## /admin/tech-admin  —  `admin/tech-admin.html`

- **Source:** `apps/web/src/app/(app)/admin/tech-admin/page.tsx`
- **Design reference:** `redesign/admin/tech-admin.html`

### GAP-ADMIN-TECH-ADMIN-02  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Status pills go through StatusPill whose STATUS_MAP has no running/stopped/degraded keys (ds/StatusPill.tsx:5-38), so Running, Stopped and Degraded all render as the same neutral blue pill — the one thing this page exists to show is not colour-coded.
- **Verified evidence:** TechAdminTable.tsx:19 status column cellType 'status' -> DataTable cellValue (DataTable.tsx:127) -> StatusPill; ds/StatusPill.tsx:5-39 STATUS_MAP has no running/stopped/degraded/online/offline keys, so all fall to 'info' (:53) = same blue pill. Page computes running/stopped by string compare (tech-admin/page.tsx:7-8) and 'Degraded' card as services.length - running - stopped (:21), which also counts any unknown status (e.g. 'online', 'errored') as degraded. Actual status vocabulary from /api/v1/admin/health/services is cannot-verify (admin-service absent; PM2 states are online/stopped/errored per sa-dashboard comments).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/admin/tech-admin/page.tsx`
- **Fix steps:**
  1. Add STATUS_MAP entries: running/online/healthy -> good; degraded/warning -> warn; stopped/errored/down/offline -> bad.
  2. In page.tsx compute Degraded from an explicit 'degraded' match and add an 'Unknown' bucket rather than subtraction.
  3. Confirm the real enum with admin-service health route before finalising key list.
- **Acceptance:**
  - StatusPill 'running' -> pill good; 'stopped' -> pill bad; 'degraded' -> pill warn.
  - Row with status 'foo' appears in Unknown, not Degraded card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is app-wide; check other screens using these words.
- **Depends on:** GAP-ADMIN-SA-DASHBOARD-05

### GAP-ADMIN-TECH-ADMIN-04  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Stat cards are computed from the server fetch (page.tsx:7-9) while the table shows useSeededResource rows and its own badge (TechAdminTable.tsx:7,15): on a cached fallback the cards can read 0/0/0/0 above a table of saved rows.
- **Verified evidence:** tech-admin/page.tsx:7-8,18-21 stat cards derive from server-fetched `services` (getSATechAdmin, revalidate 30s). TechAdminTable.tsx:7 wraps the same rows in useSeededResource('sa.tech-admin', services, source, isEmpty); when the server list is empty/errored the hook (lib/sync/resource.ts:240-252) substitutes the cached copy and badge reports 'cached' (:15), but the cards still read 0/0/0/0 (Services length 0 - not a dash). Note the hook's effect deps [cacheKey, serverSource] (resource.ts:262) also mean later server re-renders with new initialData are not re-applied.
- **Files to change:** `apps/web/src/app/(app)/admin/tech-admin/page.tsx`, `apps/web/src/app/(app)/admin/tech-admin/TechAdminTable.tsx`
- **Fix steps:**
  1. Move the stat cards into TechAdminTable (client) and compute them from the hook's `rows`, or lift the hook to a client wrapper that renders cards + table.
  2. When provenance==='error-no-data' show dashes for the cards.
  3. Pass the same cached label under the cards (single DataSourceBadge).
- **Acceptance:**
  - Server list [] + cache with 5 rows -> cards show 5 total and matching running count, badge says saved data.
  - No cache + server error -> cards show dash.
  - Live data -> unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ADMIN-TECH-ADMIN-05  ·  LOW  ·  partly  ·  theme FRESHNESS (was VALIDATION)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** No manual refresh, no “last checked” time (data revalidates every 30s server-side); Memory and Uptime are unformatted strings from the API; Port/DB Conns align inconsistently (DB Conns right, Port left).
- **Verified evidence:** Confirmed: no refresh control or 'last checked' time on the page (tech-admin/page.tsx, TechAdminTable.tsx); loader uses revalidateSeconds:30 (loaders.ts:4271-4276) so server data can be up to 30s stale without indication; alignment inconsistent: Port left (default), DB Conns align 'right' (TechAdminTable.tsx:20) so header/cell text align differently from neighbours. Memory/Uptime are rendered via String(row[key]) (DataTable.tsx:138) - whether the API sends pre-formatted strings or raw numbers is cannot-verify. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/admin/tech-admin/page.tsx`, `apps/web/src/app/(app)/admin/tech-admin/TechAdminTable.tsx`
- **Fix steps:**
  1. Add a Refresh button calling router.refresh() and show 'Checked <time>' using a fetchedAt prop set in the server page (new Date().toISOString()).
  2. Add render functions for memory (bytes -> MB/GB) and uptime (seconds -> 'Xd Yh') after confirming API field types.
  3. Right-align numeric columns consistently (port, dbConnections) with tabular numbers.
- **Acceptance:**
  - Click Refresh re-fetches and updates the checked time.
  - memory 536870912 renders '512 MB'; uptime 90061 renders '1d 1h'.
  - Numeric columns align right.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; formatting depends on unverified API types.
- **Depends on:** GAP-ADMIN-TECH-ADMIN-04


---
## /admin/tenant-provision  —  `admin/tenant-provision.html`

- **Source:** `apps/web/src/app/(app)/admin/tenant-provision/page.tsx`
- **Design reference:** `redesign/admin/tenant-provision.html`

### GAP-ADMIN-TENANT-PROVISION-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** Subtitle says “Step-by-step wizard for onboarding new tenants” (page.tsx:26) but the page is a read-only list with no button, link or form; an operator expecting to onboard a tenant here has nowhere to act. Onboarding is a separate route (admin/onboarding).
- **Verified evidence:** tenant-provision/page.tsx:26 subtitle reads 'Step-by-step wizard for onboarding new tenants'; the component (lines 20-51) renders only StatGrid + read-only DataTable of the hard-coded PROVISIONING_STEPS (9-18). No Link/Button/form. The comment at 5-8 admits the wizard is 'not-yet-built'. admin/page.tsx tile also says 'New tenant onboarding wizard'. Sibling /admin/onboarding exists (page.tsx renders a queue via getSAOnboarding) but is also read-only.
- **Files to change:** `apps/web/src/app/(app)/admin/tenant-provision/page.tsx`, `apps/web/src/app/(app)/admin/page.tsx`
- **Fix steps:**
  1. Change PageHeader subtitle in tenant-provision/page.tsx to describe what it is: 'Reference: the steps a new tenant goes through. The guided wizard is not available yet.'
  2. Change the adminTiles description for 'Tenant Provisioning' in admin/page.tsx to match ('Provisioning steps reference').
  3. Add PageHeader `actions` with a <Link className="btn btn-secondary" href="/admin/onboarding">Open onboarding queue</Link> so the operator has a next action.
  4. If product wants the wizard, raise a separate story; do not add a fake submit.
- **Acceptance:**
  - Open /admin/tenant-provision: subtitle no longer promises a wizard and a working link to /admin/onboarding is present.
  - Admin hub tile description matches the page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Copy only; no data or approval impact.

### GAP-ADMIN-TENANT-PROVISION-02  ·  HIGH  ·  partly  ·  theme STATICDATA (was FABRICATED)

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** “Templates Ready” = PROVISIONING_STEPS.length (page.tsx:31) and every Status is the hard-coded literal “Template Ready”: the tile and pills assert readiness that nothing checks, in a screen where the code's own comment concedes the wizard is not built.
- **Verified evidence:** Verified: 'Templates Ready' StatCard value = PROVISIONING_STEPS.length (page.tsx:31) and every row has status 'Template Ready' (10-17), so the tile is tautological and duplicates 'Total Steps' (28). However the file comment (5-8) explicitly labels it static documentation and nothing is fetched or claimed as live tenant data, so 'fabricated' is overstated: it is a meaningless/misleading metric rather than invented tenant data.
- **Files to change:** `apps/web/src/app/(app)/admin/tenant-provision/page.tsx`
- **Fix steps:**
  1. Delete the 'Templates Ready' StatCard (line 31) and the per-row `status` field/column (40) from Step type and PROVISIONING_STEPS.
  2. Optionally replace the column with a plain 'Required' badge (see -04).
  3. Keep the 'reference only' wording from -01 so the table is not read as tenant state.
- **Acceptance:**
  - Page shows 3 tiles (Total, Required, Optional) and no Status column.
  - No literal 'Template Ready' remains in the file (grep).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes a meaningless metric.
- **Depends on:** GAP-ADMIN-TENANT-PROVISION-01

### GAP-ADMIN-TENANT-PROVISION-03  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** No role gate in the route tree; harmless data today, but the route will host a privileged wizard (admin user creation, DNS switch) when built and inherits no protection.
- **Verified evidence:** Confirmed there is no role gate: (app)/admin/ has no layout.tsx (only loading.tsx, not-found.tsx, page.tsx and subfolders) and (app)/layout.tsx only checks the access cookie exists. middleware.ts has no role logic for /admin. Precedent exists: (app)/tenant-admin/layout.tsx calls requireAnyRole(['tenant_admin','platform_admin','super_admin']) from lib/auth/roleGuard.ts. But this page today is static text (no data, no actions) so exposure is nil; the observation itself concedes that. Server-side enforcement of the future admin-service endpoints cannot be verified (admin-service not in snapshot; only services/hrms-service present). This is a route-tree-wide issue shared with all /admin/* pages.
- **Files to change:** `apps/web/src/app/(app)/admin/layout.tsx`
- **Fix steps:**
  1. Create (app)/admin/layout.tsx modelled on tenant-admin/layout.tsx: call requireAnyRole(ALLOWED) with the platform-operator roles (decision: which of platform_admin / super_admin; tenant_admin must NOT be allowed for platform pages like tenants, provisioning).
  2. If some /admin/* pages (e.g. users, roles) are meant for tenant_admin, put the gate in per-page layouts instead of the shared one, or use a two-tier allow-list.
  3. Add a unit test that a session without the role is redirected to /dashboard.
- **Acceptance:**
  - Sign in as viewer: GET /admin/tenant-provision redirects to /dashboard.
  - Sign in as platform_admin: page renders.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrongly narrow role list could lock legitimate admins out of all /admin pages; confirm role names with Keycloak realm.
- **Depends on:** GAP-ADMIN-USERS-04

### GAP-ADMIN-TENANT-PROVISION-04  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** “Template Ready” is not in StatusPill's map (ds/StatusPill.tsx:5-38) so it renders as the neutral blue fallback; Required is plain text, so required vs optional is not scannable.
- **Verified evidence:** StatusPill STATUS_MAP (ds/StatusPill.tsx:5-39) has no 'template ready' key; line 53 falls back to 'info', so the pill renders in the info (blue) variant via DataTable cellType 'status' (DataTable.tsx:127). Correct. 'Required' column is a plain string cell (page.tsx:39) so required/optional is not visually distinct. The real fix is not to add 'template ready' to the shared map (it is not a real status) but to drop the status column (see -02).
- **Files to change:** `apps/web/src/app/(app)/admin/tenant-provision/page.tsx`
- **Fix steps:**
  1. Remove the status column (per -02) rather than adding a 'template ready' key to StatusPill.
  2. For the Required column add a `render` returning <span className="pill good">Required</span> or <span className="pill mut">Optional</span>.
- **Acceptance:**
  - Required rows show a filled pill, Optional a muted pill.
  - No pill falls back to the blue default on this page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ADMIN-TENANT-PROVISION-02

### GAP-ADMIN-TENANT-PROVISION-05  ·  LOW  ·  partly  ·  theme OTHER (was LOADING)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Sortable columns on eight static rows re-order a procedure whose order is meaningful (step 1-8); loading.tsx/error.tsx wrap a page with no async work.
- **Verified evidence:** DataTable is `sortable` (page.tsx:43) with no default sortKey, so order stays 1-8 until a user clicks a header; sorting by description/name is harmless on a reference list but by Step it could be reversed. loading.tsx and error.tsx exist (skeleton and RouteError, backHref /admin) on a page with no async work: they are the standard per-route convention and are dead but harmless code. Overstated; low value.
- **Files to change:** `apps/web/src/app/(app)/admin/tenant-provision/page.tsx`
- **Fix steps:**
  1. Remove `sortable` from the DataTable at page.tsx:43 (rows are a fixed ordered procedure).
  2. Leave loading.tsx/error.tsx (route-convention boilerplate) or delete them; no user impact.
- **Acceptance:**
  - Clicking column headers does nothing / headers are not sort buttons; rows remain 1-8.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /admin/tenants  —  `admin/tenants.html`

- **Source:** `apps/web/src/app/(app)/admin/tenants/page.tsx`
- **Design reference:** `redesign/admin/tenants.html`

### GAP-ADMIN-TENANTS-02  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** StatusPill has no trial/suspended keys (ds/StatusPill.tsx:5-38), so Trial and Suspended render as the neutral blue fallback next to a green Active — the KPI tiles use amber/red but the table does not.
- **Verified evidence:** StatusPill STATUS_MAP (StatusPill.tsx:5-39) has 'active' but no 'trial' or 'suspended'; TenantsTable.tsx:20 uses cellType 'status', so those render via the 'info' fallback (line 53) while tiles at tenants/page.tsx:131-132 use amber/red backgrounds. Confirmed.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add `trial: "warn"` and `suspended: "bad"` to STATUS_MAP in StatusPill.tsx (also unblocks GSTN-07, users).
  2. Check other tables using status 'suspended' (grep) for visual regressions.
- **Acceptance:**
  - Component test: <StatusPill status="suspended"/> has class 'pill bad'; 'trial' -> 'pill warn'.
  - Tenants table shows Suspended in red.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component; low risk.
- **Depends on:** shared StatusPill map

### GAP-ADMIN-TENANTS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Stat tiles come from the server fetch (page.tsx:6-13) while the table reads a possibly cached copy (TenantsTable.tsx:7): after a failed refresh the tiles can show 0 above saved rows.
- **Verified evidence:** tenants/page.tsx:5-12 computes all four tiles from the server `tenants` (empty [] with source 'error' from getSATenants, loaders.ts:4201). TenantsTable.tsx:7 uses useSeededResource('sa.tenants', ...) (resource.ts:215-256) which, when serverSource is 'error' or empty, loads the offline cache copy into `rows`. So tiles read 0 while the table shows cached rows (badge says cached). Same pattern as USERS-05.
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/page.tsx`, `apps/web/src/app/(app)/admin/tenants/TenantsTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into a client component (e.g. TenantsSummary) or into TenantsTable so tiles are computed from the `rows` returned by useSeededResource.
  2. Alternatively hide tiles or show '—' when source === 'error'.
  3. Keep server page passing only initial data + source.
- **Acceptance:**
  - Simulate fetch failure with a cached copy: tiles and table count match.
  - Live load unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ADMIN-TENANTS-04  ·  MEDIUM  ·  partly  ·  theme NAVIGATION (was DEADROUTE)

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** No way to reach Tenant Provisioning from this page (no action in PageHeader, page.tsx:17); the directory is a dead-end for the one workflow that adds rows to it.
- **Verified evidence:** PageHeader supports an `actions` prop (PageHeader.tsx:15) but tenants/page.tsx:17-ish (line 127) passes none, so no link to provisioning/onboarding. The hub admin/page.tsx has tiles for both. But 'the one workflow that adds rows' is overstated: /admin/tenant-provision is a static reference page, and onboarding is a read-only queue; no tenant-creation action exists anywhere in the web snapshot.
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/page.tsx`
- **Fix steps:**
  1. Add actions={<Link href="/admin/onboarding" className="btn btn-secondary">Onboarding queue</Link>} to PageHeader.
  2. Only add a 'New tenant' primary button once a create flow exists.
- **Acceptance:**
  - Tenants page header has a working link to the onboarding queue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ADMIN-TENANT-PROVISION-01

### GAP-ADMIN-TENANTS-05  ·  LOW  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** Failed load and genuinely empty directory share the “No tenants registered.” copy; Created shows the API string verbatim (createdDate) with no locale formatting; Users uses a plain number column.
- **Verified evidence:** TenantsTable.tsx:21-24 emptyMessage 'No tenants registered.' is used for both cases, BUT the DataSourceBadge (:16) reports error-no-data/cached provenance from the same hook, so a failed load is not fully silent. createdDate is rendered as the raw API string (TenantsTable.tsx:21) with no formatter (getSATenants applies no mapper), and 'Users' is right-aligned numeric (fine; sorting numeric depends on values). Format of createdDate from the API cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/TenantsTable.tsx`
- **Fix steps:**
  1. Make emptyTitle/emptyMessage depend on `provenance === 'error-no-data'` (as AdminUsersManager does with `source`).
  2. Give the Created column a render using formatDate from lib/formatters.ts (verify helper name) with a '—' fallback.
- **Acceptance:**
  - On failure with no cache, empty state says 'Couldn't load tenants'.
  - Created shows locale date (e.g. 12 Sep 2026).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /admin/tenants/[id]  —  `admin/tenants-detail.html`

- **Source:** `apps/web/src/app/(app)/admin/tenants/[id]/page.tsx`
- **Design reference:** `redesign/admin/tenants-detail.html`

### GAP-ADMIN-TENANTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was ROLEGATE)

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** “Tenant not found — it may have been removed” is shown whenever tenant is null (page.tsx:17), but getAdminTenantDetail falls back to null on any failed fetch (loaders.ts getAdminTenantDetail): a backend outage or a 403 is reported as a deleted tenant, and detailResult.source is ignored for this branch.
- **Verified evidence:** getAdminTenantDetail (loaders.ts:4808-4814) returns fetchJson(...,null,...); apiClient.ts fetchJson (111-165) returns {data: empty, source:'error', status, errorCode} on 401/403/404/5xx, network error, or invalid payload. page.tsx:17 branches on `!tenant` only and shows 'Tenant not found / may have been removed' (22-26); detailResult.source/status is only used to derive `source` at :15 for the modules table, which is unreachable in this branch. So a 403 or outage is reported as deleted tenant.
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In page.tsx, before `if (!tenant)`, branch on detailResult.source === 'error': if detailResult.status === 404 keep the not-found EmptyState; otherwise render <RefreshErrorState error={toHumanError('load',{area:'tenant'})}/> (already imported in this file's siblings).
  2. For status 403 render an access-denied message instead (LoaderResult already carries `status`).
  3. Add tests for 404 -> not found, 403 -> access denied, 500 -> load error.
- **Acceptance:**
  - Mock fetch 500: page shows load-error state, not 'Tenant not found'.
  - Mock fetch 404: page shows 'Tenant not found'.
  - Mock 403: shows access message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only changes error copy paths.

### GAP-ADMIN-TENANTS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme INJECTION (was OTHER)

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** The route param is interpolated raw into the backend path (`/api/v1/admin/tenants/${id}` and `${id}/config`, loaders.ts) with no encodeURIComponent or format check, so `%2e%2e/…` style ids can address other admin endpoints from the server-side fetch.
- **Verified evidence:** loaders.ts:4809 and :4820 interpolate `${id}` raw into '/api/v1/admin/tenants/${id}' and '/config'. Route param comes from page.tsx:7 unvalidated. True that no encodeURIComponent/format check exists (only 15 encodeURIComponent uses in loaders.ts). Mitigations/limits: the request is made with the caller's own bearer token (apiClient.ts serverAuthHeaders), so it cannot exceed the user's privileges (gateway must enforce), and only GET is possible. The client-side proxy (api/proxy/[...path]/route.ts:36-38) blocks '..' segments but this server loader path has no equivalent guard. Impact: SSRF-lite/path confusion, low.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/admin/tenants/[id]/page.tsx`
- **Fix steps:**
  1. In loaders.ts add a small helper `seg(id)` = encodeURIComponent(id) and use it in getAdminTenantDetail and getAdminTenantModules paths.
  2. In page.tsx (or the loaders) validate id against the tenant id format (uuid or slug regex); if invalid call notFound() from next/navigation.
  3. Apply the same helper to sibling loaders that interpolate ids (e.g. getWebhookDeliveries at 4770).
- **Acceptance:**
  - Unit test: id '..%2Fusers' results in notFound()/no upstream call to /admin/users.
  - Valid uuid still loads.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ADMIN-TENANTS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme LABEL (was I18N)

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** “Active Users” is the sum of each module's users (page.tsx:33); a person using three modules counts three times, so the tile overstates users. Label and data meaning disagree.
- **Verified evidence:** page.tsx:33 totalUsers = sum of module.users, shown as 'Active Users' (44) and the table column is also 'Active Users' (TenantModulesTable.tsx:74). Mapping in loaders.ts getAdminTenantModules (4820-4838) takes per-module `users` from /config (number or 0). Whether one person is counted per module depends on the backend field semantics, which cannot be seen (admin-service absent), but summing per-module counts cannot deduplicate users, and the tile is not a tenant user count. Label/data mismatch is real; also missing users silently become 0 (line 4831).
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Rename tile to 'Module seats in use' (or hide it) unless the backend exposes a distinct tenant-level active-user count.
  2. If backend has such a field (e.g. on /api/v1/admin/tenants/:id), add it to AdminTenantDetail and use it for the tile.
  3. Show '—' instead of 0 when `users` is not a number (loaders.ts:4831).
- **Acceptance:**
  - Tile label no longer claims 'Active Users' for a sum.
  - With modules A(10), B(10) the tile does not read 20 users unless labelled seats.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Reporting accuracy only.

### GAP-ADMIN-TENANTS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme MISSINGFEATURE (was DEADROUTE)

- [x] **Status** — PR #1832 (merged)
- **First-pass claim:** Detail is view-only although “Enabled” and “Status” invite action; domain and settings are loaded (AdminTenantDetail) but never shown; no link back to provisioning or a suspend action.
- **Verified evidence:** Verified AdminTenantDetail (loaders.ts:4795-4803) includes domain, region and settings; page.tsx uses name, edition, status, region only (38-46), so domain and settings are indeed loaded and unused. 'Enabled' and 'Status' are read-only StatCards/table cells, not controls, so they do not 'invite action' in themselves. No link to provisioning/onboarding and no suspend/edit action exist on the page. Backend suspend/edit endpoints cannot be verified (admin-service absent) so do not invent one.
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/[id]/page.tsx`
- **Fix steps:**
  1. Show domain in the subtitle or a details Card (tenant.domain), drop unused `settings` from the type or render a read-only key/value list.
  2. Add PageHeader actions: Link to /admin/onboarding.
  3. Only add Suspend/Activate after a backend endpoint is confirmed; then use ConfirmDialog with requireReason.
- **Acceptance:**
  - Detail page shows the tenant domain.
  - Header has a link to the onboarding queue.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Suspending a tenant is high impact; needs maker-checker and audit event when added.

### GAP-ADMIN-TENANTS-DETAIL-06  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** Two different empty-module strings (page.tsx:56 vs TenantModulesTable.tsx:43); Usage Level (High/Medium/Low) is a neutral-blue StatusPill fallback (ds/StatusPill.tsx:5-38).
- **Verified evidence:** Two empty strings confirmed: page.tsx:56 'No modules configured for this tenant.' vs TenantModulesTable.tsx:106 'No modules have been configured for this tenant.' (the latter is nearly unreachable since page guards length 0). Usage level uses cellType 'status' (TenantModulesTable.tsx:76) so 'High/Medium/Low' goes through StatusPill (StatusPill.tsx:53) and falls back to 'info'. Additional defect found: TenantModulesTable.tsx:81 uses the constant cache key 'admin.tenant.modules' for every tenant id, so a cached fallback (useSeededResource on error/empty) can show one tenant's modules on another tenant's page.
- **Files to change:** `apps/web/src/app/(app)/admin/tenants/[id]/TenantModulesTable.tsx`, `apps/web/src/app/(app)/admin/tenants/[id]/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Pass tenantId into TenantModulesTable and use cache key `admin.tenant.modules:${id}` (real bug, do first).
  2. Delete the duplicate empty-state copy in TenantModulesTable or align it with page.tsx.
  3. Add 'high','medium','low' to StatusPill STATUS_MAP (good/warn/mut) or render usage via a local pill.
- **Acceptance:**
  - Visit tenant A then tenant B while API fails for B: B does not show A's modules.
  - Usage High/Medium/Low render distinct pill tones.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cache-key fix touches offline cache only; adding 'high' etc. to the shared map may recolour other tables using those words.
- **Depends on:** shared StatusPill map


---
## /admin/users  —  `admin/users.html`

- **Source:** `apps/web/src/app/(app)/admin/users/page.tsx`
- **Design reference:** `redesign/admin/users.html`

### GAP-ADMIN-USERS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Suspend / Activate fires a PATCH on one click (AdminUsersManager.tsx:193-197) with no ConfirmDialog, and nothing stops an admin suspending their own account or the last tenant admin; a mis-click locks a person (or everyone) out of the platform.
- **Verified evidence:** AdminUsersManager.tsx:193-206 toggleStatus PATCHes /api/proxy/v1/admin/users/:id/status immediately from the row button (283-292); no ConfirmDialog is imported (import line 3 only Button, DataTable). No client guard against acting on the current user or the last tenant admin (the component does not receive the current user id or roles). Disabled only for locked/deactivated (287). Server-side self-suspend/last-admin protection cannot be verified (identity-service/admin-service absent). ConfirmDialog with danger/requireReason exists (ds/ConfirmDialog.tsx) and is used in billing InvoiceActions.
- **Files to change:** `apps/web/src/app/(app)/admin/users/AdminUsersManager.tsx`, `apps/web/src/app/(app)/admin/users/page.tsx`
- **Fix steps:**
  1. Add state `confirmUser`; make the Suspend/Activate button open <ConfirmDialog danger={status==='active'} requireReason title='Suspend <name>?' .../> and call toggleStatus(user, reason) on confirm.
  2. Pass currentUserId (from getSessionSub/JWT sub in page.tsx) to AdminUsersManager; disable Suspend on own row with an explanatory tooltip.
  3. Include the reason in the PATCH body only if backend accepts it (cannot verify); otherwise omit.
  4. Ask backend to reject self-suspend and last-tenant-admin suspend with a 409 and surface toHumanError.
- **Acceptance:**
  - Click Suspend: dialog opens, nothing sent until Confirm.
  - Own row Suspend is disabled.
  - Cancel closes with no request (assert fetch not called).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Access-control action: a mis-click locks a user out; fix reduces that. Reason field needs backend support and an audit event (CLAUDE rule 8).

### GAP-ADMIN-USERS-03  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Directory and “Total users” are capped by getAdminUsersList's ?limit=200 (loaders.ts) with no pagination or truncation notice; a department of 1,240 staff shows 200 users and a Total of 200. The DataTable's 25/page is client-side only.
- **Verified evidence:** loaders.ts:4853 getAdminUsersList requests '/api/v1/admin/users?limit=200'; getArrayPayload (apiMappers.ts:40) returns only the array, discarding any total/next cursor. users/page.tsx:36 'Total users' = users.length, so >200 users shows 200 with no notice. DataTable pageSize 25 (AdminUsersManager.tsx:312) paginates the 200 client-side. Backend pagination contract (cursor, total) cannot be verified.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/admin/users/page.tsx`, `apps/web/src/app/(app)/admin/users/AdminUsersManager.tsx`
- **Fix steps:**
  1. Extend getAdminUsersList to return {rows,total,nextCursor} if the API provides them; otherwise detect rows.length === 200 and set `truncated`.
  2. Show a banner 'Showing first 200 users – refine search' and label the tile '200+' when truncated.
  3. Long-term: server-side search/filter/page via query params (?q=&status=&cursor=) from AdminUsersManager.
- **Acceptance:**
  - With API returning 200 rows, page shows the truncation notice and Total tile reads '200+'.
  - With 50 rows no notice.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Admins may believe a user does not exist; low data risk.

### GAP-ADMIN-USERS-04  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** No role gate in the route tree (no admin/layout.tsx, no requireAnyRole in page.tsx); the whole page is reachable by any signed-in user.
- **Verified evidence:** No (app)/admin/layout.tsx exists (ls of (app)/admin shows none), users/page.tsx has no requireAnyRole, middleware.ts has no role rules; (app)/layout.tsx only requires an access cookie. So any signed-in user can render the page shell; the data itself depends on gateway/backend authz (cannot verify). Precedent: tenant-admin/layout.tsx uses requireAnyRole.
- **Files to change:** `apps/web/src/app/(app)/admin/layout.tsx`, `apps/web/src/app/(app)/admin/users/layout.tsx`
- **Fix steps:**
  1. Create admin/layout.tsx (or users/layout.tsx) calling requireAnyRole([...]) from lib/auth/roleGuard.ts, same shape as tenant-admin/layout.tsx.
  2. Decide role set: users management probably tenant_admin + platform_admin + super_admin.
  3. Confirm gateway/identity-service enforce the same roles on /v1/admin/users*.
- **Acceptance:**
  - Viewer visiting /admin/users is redirected to /dashboard.
  - tenant_admin sees the page.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** UI gate is convenience only; server enforcement is the real control.
- **Depends on:** GAP-ADMIN-TENANT-PROVISION-03

### GAP-ADMIN-USERS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** Stat tiles are computed once on the server (page.tsx:23-25) while Suspend/Activate updates only the client list (:200-205): after suspending someone Active/Suspended still show the old counts until a reload.
- **Verified evidence:** Tiles computed server-side at users/page.tsx:23-25 from initialUsers; AdminUsersManager keeps `users` in useState (182) and updates it on a successful toggle (203) but the tiles are rendered by the server page and never recompute; router.refresh is not called. Roles edit does not affect counts.
- **Files to change:** `apps/web/src/app/(app)/admin/users/page.tsx`, `apps/web/src/app/(app)/admin/users/AdminUsersManager.tsx`
- **Fix steps:**
  1. Move the four StatCards into AdminUsersManager (or a UsersSummary client component) and compute from `users` state.
  2. Or call router.refresh() after a successful status PATCH.
- **Acceptance:**
  - Suspend an active user: Active tile decrements and Suspended increments immediately without reload.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ADMIN-TENANTS-03

### GAP-ADMIN-USERS-06  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** Export CSV (:208-217) joins raw name/email/employee code with commas and no quoting, so a name containing a comma shifts columns and a value starting with = is a spreadsheet-formula risk; it exports personal data (DPDP) unmasked with no audit record visible client-side.
- **Verified evidence:** downloadCsv (AdminUsersManager.tsx:208-219) builds rows with [name,email,empCode,status,mfa].join(',') (210) with no quoting or escaping, so commas/quotes/newlines in names corrupt columns and a value starting with = + - @ is a CSV-injection vector. Contrast DataTable.tsx:275-283 which at least quotes commas/quotes/newlines (but does not neutralise formulas either). Export is generated entirely client-side from already-fetched data: no server call, so no audit event exists for the PII export (CLAUDE rule 8 spirit; DPDP). Exports current status filter but not the search text.
- **Files to change:** `apps/web/src/app/(app)/admin/users/AdminUsersManager.tsx`, `apps/web/src/lib/csv.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Create lib/csv.ts `toCsv(rows)` that quotes every field, doubles quotes and prefixes a single quote to cells starting with = + - @ tab or CR; reuse it in DataTable.downloadCsv.
  2. Replace the join in downloadCsv with toCsv.
  3. Gate export behind a role check and log it: POST an audit event to a backend endpoint (needs backend: e.g. an export-audit route) before creating the blob.
  4. Consider a confirm dialog stating the file contains personal data.
- **Acceptance:**
  - Unit test toCsv: 'Doe, John' -> '"Doe, John"'; '=cmd|x' -> "'=cmd|x".
  - Export triggers an audit event (network assertion).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PII/DPDP: unmasked export with no audit trail; formula injection into Excel.

### GAP-ADMIN-USERS-07  ·  LOW  ·  partly  ·  theme A11Y (was PII)

- [x] **Status** — PR #1813 (merged)
- **First-pass claim:** Status filter is span role=tab with no tabpanel/arrow-key handling (:232-244); the roles sheet has no Esc/focus trap and is fixed 380px wide (:130); Reset Password is a permanently disabled button whose only explanation is a title tooltip, unreachable by touch/keyboard.
- **Verified evidence:** Theme should be A11Y not PII. Verified: status filter is <span role=tab> (AdminUsersManager.tsx:234-244) with tabIndex 0 on every tab and only Enter/Space handling, no arrow keys, no tabpanel/aria-controls (the shared ds/Tabs.tsx does implement roving tabindex and arrows). Sheet (128-130): role=dialog aria-modal, backdrop click closes but no Esc handler, no focus trap or focus return, width fixed 380 (overflows <380px screens). Reset Password (293-303) is a disabled Button with only a title tooltip, so keyboard/touch users cannot reach the explanation.
- **Files to change:** `apps/web/src/app/(app)/admin/users/AdminUsersManager.tsx`, `apps/web/src/app/_components/ds/Tabs.tsx`
- **Fix steps:**
  1. Replace the inline tablist with ds <Tabs tabs={[...STATUS_FILTERS]} active={filter} onChange=.../>.
  2. Rebuild EditRolesSheet on the ConfirmDialog/Modal focus-trap logic (or add Esc keydown, initial focus and focus return); set width: min(380px,100vw).
  3. Replace disabled Reset Password button with visible helper text or a link to the Keycloak admin console.
- **Acceptance:**
  - Left/Right arrows move between filters.
  - Esc closes the roles sheet; Tab stays inside it; returns focus to Edit Roles button.
  - Reset Password explanation visible without hover.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-ADMIN-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in page.tsx, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. The hub lists Tenants, Operators, Integrations (API keys) and Invoices for whoever loads /admin. The only possible gate is admin-service (absent from this snapshot — undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-API-MONITORING-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/admin/api-monitoring, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/api-monitoring`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/api-monitoring for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/api-monitoring and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/api-monitoring, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/api-monitoring/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-API-MONITORING-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1850 (merged): via #1846 in #1850
- **First-pass claim:** Error Rate and p95 are unformatted strings/numbers from the API (ApiMonitoringTable.tsx columns); no unit on Error Rate, no threshold colouring, no last-checked time — a stale snapshot cannot be told apart from live.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/api-monitoring`
- **Question:** Does each row carry errorRate with a defined unit (ratio 0-1 vs percent), p95 in ms, and a generatedAt/lastCheckedAt timestamp?
- **How to verify:** Open the admin-service api-monitoring handler/response schema; curl the endpoint as super_admin and inspect errorRate, p95, and any timestamp field.
- **Test to add:** Given seeded metrics, when GET api-monitoring, then each row has errorRate (documented unit), p95Ms number and top-level generatedAt ISO string.
- **Impact if wrong:** Operators misread error rate by 100x or act on stale data during incidents.
- **Web change if wrong:** Format errorRate with % and unit, colour by threshold in ApiMonitoringTable.tsx, and render a 'Last checked' stamp from the response.

### GAP-ADMIN-BULK-SCAN-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in page.tsx, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. A placeholder, but it is still a live route for every user. The only possible gate is admin-service (absent from this snapshot — undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `none (page is a placeholder; no endpoint called)`
- **Question:** Once a bulk-scan endpoint exists in admin-service, is it restricted to super_admin/platform_admin?
- **How to verify:** Confirm no bulk-scan route exists in admin-service routes; when added, verify the guard and curl as employee expecting 403.
- **Test to add:** Given employee JWT, when calling the future bulk-scan endpoint, then 403.
- **Impact if wrong:** Low today (no data); any future endpoint would be open to every user.
- **Web change if wrong:** Add requireSuperAdmin() to the page now, or remove the route until a backend exists.

### GAP-ADMIN-BULK-SCAN-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1854 (merged)
- **First-pass claim:** No backend exists for this feature: page.tsx comment states no bulk-scan route or job/registry service is registered in admin-service or any other service; nothing under services/ in this snapshot provides it. The screen can only be a placeholder — the Designed state above cannot be made functional from code.
- **Service:** `admin-service (or a future bulk-scan/jobs service)`  ·  **Endpoint(s):** `none registered`
- **Question:** Is any bulk-scan route or job/registry service planned or registered in admin-service or elsewhere?
- **How to verify:** Search all service repos/gateway catalogue for 'bulk-scan'; check gateway-service /api/v1/gateway/catalogue for a matching prefix.
- **Test to add:** Given the gateway catalogue, when listing routes, then a bulk-scan prefix is present (or the web route is removed).
- **Impact if wrong:** Dead nav item advertises a feature that does not exist.
- **Web change if wrong:** Hide the nav entry and route behind a feature flag, or keep as an explicit 'Not available' placeholder.

### GAP-ADMIN-CONFIG-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in the page, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. PATCH /api/v1/admin/platform-config (page.tsx:34) changes login-attempt limits, session timeout and self-registration for the whole platform; the only possible gate is admin-service, absent from this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET/PATCH /api/v1/admin/platform-config`
- **Question:** Does admin-service return 403 on GET/PATCH /api/v1/admin/platform-config for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET/PATCH /api/v1/admin/platform-config and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET/PATCH /api/v1/admin/platform-config, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/config/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-CONFIG-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Security-weakening changes need no confirmation: Allow self-registration on, Enforce strong passwords off, Max Login Attempts up to 20, Session Timeout up to 1440 min submit straight away (page.tsx:132-215). No ConfirmDialog, no audit-log link, no “changed by” trail (CLAUDE.md: every mutation audited; whether admin-service emits it is undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `PATCH /api/v1/admin/platform-config`
- **Question:** Does PATCH platform-config validate bounds (max login attempts, session timeout), emit an audit event with actor and before/after values, and require super_admin?
- **How to verify:** Open the platform-config handler: check zod bounds and @civitasone/events emit; PATCH with maxLoginAttempts=999 expecting 422 and then check the audit store for an entry on a valid change.
- **Test to add:** Given super_admin, when PATCH selfRegistration=true, then 200 and an audit event {actor, before, after} is emitted; when maxLoginAttempts=999, then 422.
- **Impact if wrong:** Silent weakening of platform security with no trail (CLAUDE.md rule 8 violation).
- **Web change if wrong:** Add ConfirmDialog for security-weakening changes and a link to audit-log filtered on platform-config.

### GAP-ADMIN-DISCOVERY-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in page.tsx, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. A placeholder, but it is still a live route for every user. The only possible gate is admin-service (absent from this snapshot — undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `none (page is a placeholder; no endpoint called)`
- **Question:** Once a discovery endpoint exists in admin-service, is it restricted to super_admin/platform_admin?
- **How to verify:** Confirm no discovery route exists in admin-service; when added, verify the guard and curl as employee expecting 403.
- **Test to add:** Given employee JWT, when calling the future discovery endpoint, then 403.
- **Impact if wrong:** Low today (no data); any future endpoint would be open to every user.
- **Web change if wrong:** Add requireSuperAdmin() to admin/discovery/page.tsx now, or remove the route until a backend exists.

### GAP-ADMIN-DISCOVERY-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** No backend exists for this feature: page.tsx comment states no discovery route or job/registry service is registered in admin-service or any other service; nothing under services/ in this snapshot provides it. The screen can only be a placeholder — the Designed state above cannot be made functional from code.
- **Service:** `admin-service (or a future bulk-scan/jobs service)`  ·  **Endpoint(s):** `none registered`
- **Question:** Is any discovery route or job/registry service planned or registered in admin-service or elsewhere?
- **How to verify:** Search all service repos/gateway catalogue for 'discovery'; check /api/v1/gateway/catalogue.
- **Test to add:** Given the gateway catalogue, when listing routes, then a discovery prefix is present (or the web route is removed).
- **Impact if wrong:** Dead nav item advertises a feature that does not exist.
- **Web change if wrong:** Hide the nav entry and route behind a feature flag, or keep as an explicit 'Not available' placeholder.

### GAP-ADMIN-EDITIONS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/admin/editions, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/editions`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/editions for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/editions and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/editions, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/editions/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-ENTITLEMENTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/admin/entitlements, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/entitlements`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/entitlements for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/entitlements and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/entitlements, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/entitlements/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-FEATURE-FLAGS-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in the page, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. Toggling, killing and creating platform-wide flags (/api/proxy/v1/admin/feature-flags/manage) is offered to any user who opens the page; admin-service is absent from this snapshot so the server gate is undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy)`
- **Question:** Does admin-service return 403 on GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy) for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy) and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy), then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/feature-flags/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-GATEWAY-CONFIG-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** “Changes take effect immediately” with no confirmation: setting JWT Edge Verification to Off/Audit, body limit up to 50 MB or rate limits up to 100000/min is one click on “Save Changes” (page.tsx:80-104,239-241) — no ConfirmDialog, no diff, no rollback, and no audit trail link (CLAUDE.md: every mutation audited; server-side emission undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `PATCH /api/v1/admin/platform-config/gateway`
- **Question:** Does the gateway-config PATCH enforce safe bounds (body limit, rate limits, jwtEdgeMode enum), emit an audit event with before/after, and support rollback?
- **How to verify:** Open the platform-config/gateway handler; PATCH jwtEdgeMode=off, bodyLimitMb=500, rateLimit=1e7 expecting 422 (or explicit super_admin-only allowance); check audit emission.
- **Test to add:** Given super_admin, when PATCH jwtEdgeMode=off, then audit event with actor+diff is emitted; when rateLimit exceeds max, then 422.
- **Impact if wrong:** One click can disable edge JWT verification platform-wide with no trail.
- **Web change if wrong:** Add ConfirmDialog with diff for risky values, show last-changed-by, and link to audit-log.

### GAP-ADMIN-GATEWAY-CONFIG-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in the page, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. PATCH /api/v1/admin/platform-config/gateway (page.tsx:81) changes edge auth for the whole platform; the only possible gate is admin-service (absent from this snapshot — undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET/PATCH /api/v1/admin/platform-config/gateway`
- **Question:** Does admin-service return 403 on GET/PATCH /api/v1/admin/platform-config/gateway for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET/PATCH /api/v1/admin/platform-config/gateway and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET/PATCH /api/v1/admin/platform-config/gateway, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/gateway-config/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-GATEWAY-ROUTES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in the page, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. The API route catalogue (internal service paths) is exposed to any signed-in user; the loader calls /api/v1/gateway/catalogue on gateway-service, absent from this snapshot (undeterminable).
- **Service:** `gateway-service`  ·  **Endpoint(s):** `GET /api/v1/gateway/catalogue`
- **Question:** Does gateway-service return 403 on GET /api/v1/gateway/catalogue for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In gateway-service repo open the route file registering GET /api/v1/gateway/catalogue and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/gateway/catalogue, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/gateway-routes/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-GATEWAYS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/admin/gateways, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/gateways`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/gateways for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/gateways and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/gateways, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/gateways/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-INTEGRATIONS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in the page, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. This screen writes third-party credentials (API keys, SMTP passwords, PFMS certificate, SFTP private key) via /api/proxy/v1/admin/integrations; the maker-checker rule is enforced only if admin-service does (absent from this snapshot — undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET/POST/PATCH /api/v1/admin/integrations (via /api/proxy); GET /api/v1/admin/api-keys`
- **Question:** Does admin/integrations reject non-admin callers, enforce maker-checker for credential writes, mask secrets on read, and audit every write?
- **How to verify:** Open the integrations route file: check role guard, maker-checker (creator != approver) and response redaction; POST a credential as tenant user expecting 403, GET as super_admin and confirm secrets are masked.
- **Test to add:** Given a pending credential change by user A, when A approves it, then 403; when B approves, then 200 and audit event; GET never returns plaintext secret.
- **Impact if wrong:** Third-party credentials (SMTP, PFMS, SFTP key) changed or leaked by unauthorised or unreviewed users.
- **Web change if wrong:** Add role gate to page.tsx and surface pending/approval state in IntegrationDrawer.

### GAP-ADMIN-INVOICES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/billing/invoices, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/billing/invoices`
- **Question:** Does admin-service return 403 on GET /api/v1/billing/invoices for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/billing/invoices and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/billing/invoices, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/invoices/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-INVOICES-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** Money without formatting: the Amount column is a bare { key: "amount", align: "right" } (InvoicesTable.tsx:20) so DataTable prints whatever the API returns — no paise→rupee conversion, no ₹ sign, no lakh grouping (CLAUDE.md: money is paise bigint). A paise value would read 100× too large. Whether the API sends paise or rupees is undeterminable (billing-service absent).
- **Service:** `billing-service`  ·  **Endpoint(s):** `GET /api/v1/billing/invoices`
- **Question:** Is invoice amount returned as integer paise (bigint as string) or rupees, and is the unit documented in the response schema?
- **How to verify:** Open billing-service invoices schema/handler; curl as super_admin and compare a known invoice total against the stored value.
- **Test to add:** Given an invoice of Rs 1,18,000.00, when GET invoices, then amount equals 11800000 (paise) or documented rupee field.
- **Impact if wrong:** Invoice totals shown 100x wrong to operators.
- **Web change if wrong:** Add render in InvoicesTable.tsx amount column using the shared paise-to-INR formatter (lakh grouping) or map from rupees accordingly.

### GAP-ADMIN-METERING-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/billing/metering, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/billing/metering`
- **Question:** Does admin-service return 403 on GET /api/v1/billing/metering for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/billing/metering and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/billing/metering, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/metering/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-METERING-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** Header claims rupees but nothing converts: the column is { key: "amount", label: "Amount (₹)", align: "right" } (MeteringTable.tsx:23) with no render function, so a paise value would be displayed as rupees ×100 and no lakh grouping is applied. Unit sent by billing-service is undeterminable (absent).
- **Service:** `billing-service`  ·  **Endpoint(s):** `GET /api/v1/billing/metering`
- **Question:** Is invoice amount returned as integer paise (bigint as string) or rupees, and is the unit documented in the response schema?
- **How to verify:** Open billing-service metering schema/handler; curl as super_admin and compare a known usage amount to its stored value.
- **Test to add:** Given metered usage costing Rs 2,500.50, when GET metering, then amount is 250050 paise (or documented rupee value).
- **Impact if wrong:** Invoice totals shown 100x wrong to operators.
- **Web change if wrong:** Add render in MeteringTable.tsx converting paise to INR with lakh grouping, or drop the (Rs) header if paise.

### GAP-ADMIN-ONBOARDING-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/admin/onboarding, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/onboarding`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/onboarding for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/onboarding and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/onboarding, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/onboarding/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-OPERATORS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate anywhere on this route: page.tsx has no requireAnyRole/requireSuperAdmin, there is no admin/layout.tsx, and the (app)/layout.tsx only hides Finance nav by role. The route is a platform-operator console yet renders for any signed-in user; the only possible gate is the admin-service behind /api/v1/admin/operators, which is not in this snapshot (undeterminable).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/operators`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/operators for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/operators and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/operators, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/operators/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-ORG-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate in the route tree: no requireAnyRole/requireSuperAdmin in the page, no admin/layout.tsx, and (app)/layout.tsx only hides Finance nav by role. Creating and renaming organisational units (/api/proxy/v1/admin/org-hierarchy POST/PATCH) is open to anyone who reaches the page; tenant-service (org-hierarchy, cycle-checked reparent) is absent from this snapshot, so the server gate is undeterminable.
- **Service:** `tenant-service`  ·  **Endpoint(s):** `GET/POST/PATCH /api/v1/admin/org-hierarchy (via /api/proxy)`
- **Question:** Does org-hierarchy POST/PATCH require tenant_admin (or higher), tenant-scope the unit, reject reparent cycles, and audit each change?
- **How to verify:** In tenant-service repo open the route file registering GET/POST/PATCH /api/v1/admin/org-hierarchy (via /api/proxy) and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET/POST/PATCH /api/v1/admin/org-hierarchy (via /api/proxy), then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/org/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-ROLE-FEATURES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate in the route tree (no admin/layout.tsx; page.tsx has no requireAnyRole). Editing which features every role can see is reachable by any signed-in user; server-side enforcement is undeterminable because policy-service is not in this snapshot.
- **Service:** `policy-service`  ·  **Endpoint(s):** `GET/PUT /api/v1/policy/role-features`
- **Question:** Does policy-service return 403 on GET/PUT /api/v1/policy/role-features for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In policy-service repo open the route file registering GET/PUT /api/v1/policy/role-features and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET/PUT /api/v1/policy/role-features, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/role-features/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-ROLES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** No role gate in the route tree (no admin/layout.tsx, no requireAnyRole in page.tsx): editing what a role may do is reachable by any signed-in user; server enforcement undeterminable (identity/admin-service absent).
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions`
- **Question:** Does admin-service return 403 on GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/roles/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-ROLES-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** Save sends the complete desired permission set (RolesPermissionsManager.tsx:37) after one click: no diff preview, no confirmation and no reason capture when granting privileged keys; the Saved. status (:154) is the only feedback. Audit of the mutation is undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `PUT/PATCH /api/v1/admin/roles/{id}/permissions`
- **Question:** Does the permissions endpoint diff old vs new sets, emit an audit event listing granted/revoked keys with actor, and block editing system roles or escalating beyond the caller's own permissions?
- **How to verify:** Open the role-permissions handler: check audit emit payload and isSystem guard; PUT as tenant admin adding super_admin-only keys expecting 403.
- **Test to add:** Given role R with keys {a}, when PUT {a,b}, then audit event has added=[b], removed=[]; when caller lacks b, then 403.
- **Impact if wrong:** Unaudited privilege grants; permission escalation.
- **Web change if wrong:** Add diff preview + ConfirmDialog (with reason) before save in RolesPermissionsManager.tsx.

### GAP-ADMIN-SCHEDULED-JOBS-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** The create form accepts a free-text Target Command and arbitrary JSON Payload for any of six services (:259-315) and the route has no role gate (no admin/layout.tsx, no requireAnyRole): any signed-in user can schedule commands against finance/hrms/audit services. Server authorization and audit are undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET/POST/PATCH /api/v1/admin/scheduled-jobs, GET .../{id}/history`
- **Question:** Does scheduled-jobs POST restrict callers to super_admin/platform_admin, validate targetService/command against an allow-list and payload schema, and audit creation?
- **How to verify:** In admin-service repo open the route file registering GET/POST/PATCH /api/v1/admin/scheduled-jobs, GET .../{id}/history and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given employee JWT, when POST scheduled-jobs, then 403; given super_admin with targetCommand not in allow-list, then 422; valid job emits audit event.
- **Impact if wrong:** Arbitrary command execution against finance/hrms/audit services by any user.
- **Web change if wrong:** Gate the page, and replace free-text command with a select from an allow-list endpoint.

### GAP-ADMIN-SETTINGS-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1839 (merged)
- **First-pass claim:** No role gate in the route tree for a page that edits SMTP credentials, MFA enforcement and integrations; changes are mutations whose audit is undeterminable client-side. Send test email POSTs with no body (:204), so it tests stored, not on-screen, credentials.
- **Service:** `admin-service`  ·  **Endpoint(s):** `PATCH /api/v1/admin/settings/{general,email,security,integrations}; POST /api/v1/admin/settings/email/test`
- **Question:** Do admin settings endpoints require tenant_admin+, audit each mutation, mask SMTP password on read, and does email/test use stored credentials (or accept an optional body)?
- **How to verify:** In admin-service repo open the route file registering PATCH /api/v1/admin/settings/{general,email,security,integrations}; POST /api/v1/admin/settings/email/test and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given employee JWT, when PATCH settings/email, then 403; given tenant_admin, then 200 + audit event; GET never returns plaintext password.
- **Impact if wrong:** SMTP/MFA policy changed by unauthorised users, or credentials leaked.
- **Web change if wrong:** Gate the page; send on-screen values in email/test body if the server supports it, else label the button 'Test saved settings'.

### GAP-ADMIN-TECH-ADMIN-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: ports, DB connection counts and memory per service are infrastructure detail shown to anyone who can open /admin/tech-admin; server-side check undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/health/services`
- **Question:** Does admin-service return 403 on GET /api/v1/admin/health/services for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/health/services and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/health/services, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/tech-admin/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-TECH-ADMIN-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1812 (merged)
- **First-pass claim:** “Degraded” is computed as everything that is neither “running” nor “stopped” (page.tsx:21); any other backend vocabulary (e.g. PM2 “online”/“errored”, which sa-dashboard already reads) is counted as Degraded, so the tile can be wrong without any row being degraded. Status vocabulary undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/health/services`
- **Question:** What is the closed set of values for each service's status field (running/stopped vs PM2 online/errored/degraded) in health/services?
- **How to verify:** Open the health/services handler and its status type/enum; curl it and list distinct status values.
- **Test to add:** Given services with statuses online, errored, stopped, when GET health/services, then status values are within the documented enum.
- **Impact if wrong:** Degraded tile miscounts, hiding real outages or raising false alarms.
- **Web change if wrong:** Map the real vocabulary explicitly in tech-admin/page.tsx (running/online = up, errored/degraded = degraded, stopped = down).

### GAP-ADMIN-TENANTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree: the cross-tenant directory (every tenant, edition, user count) is reachable by any signed-in user; row links open the detail page, also ungated. Server enforcement undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/tenants`
- **Question:** Does admin-service return 403 on GET /api/v1/tenants for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/tenants and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given a JWT with role=employee, when GET/PATCH GET /api/v1/tenants, then 403 and no body data; given super_admin, then 200.
- **Impact if wrong:** Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/tenants/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-TENANTS-DETAIL-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1784 (merged)
- **First-pass claim:** No role gate in the route tree; any signed-in user who guesses a tenant id (the row link exposes it) sees another tenant's edition, status, region and module usage. Server enforcement undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `GET /api/v1/admin/tenants/{id}, GET /api/v1/admin/tenants/{id}/config, tenant modules usage`
- **Question:** Does GET /admin/tenants/{id} return 403/404 unless the caller is platform staff or a member of that tenant?
- **How to verify:** In admin-service repo open the route file registering GET /api/v1/admin/tenants/{id}, GET /api/v1/admin/tenants/{id}/config, tenant modules usage and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
- **Test to add:** Given tenant-A user, when GET /admin/tenants/{tenant-B id}, then 403 or 404.
- **Impact if wrong:** Cross-tenant data disclosure by ID guessing (IDOR).
- **Web change if wrong:** Add requireSuperAdmin()/requireAnyRole in admin/tenants/[id]/page.tsx (or admin/layout.tsx) and hide the nav entry.

### GAP-ADMIN-USERS-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1783 (merged)
- **First-pass claim:** The Edit Roles sheet lists every role returned by getAdminRolesList including isSystem ones (:148, page.tsx:21) and saves the full role set (:108) with no confirm: a tenant admin can tick super_admin/platform_admin for anyone. Whether the server refuses is undeterminable (identity/admin-service absent).
- **Service:** `admin-service`  ·  **Endpoint(s):** `PUT/PATCH /api/v1/admin/user-roles/{userId}; GET /api/v1/admin/roles`
- **Question:** Does user-roles assignment refuse system roles (super_admin/platform_admin) unless the caller is platform staff, and does GET roles hide them from tenant admins?
- **How to verify:** Open the user-roles handler and check isSystem/hierarchy guard; as tenant_admin PUT roles=[super_admin] for a user expecting 403.
- **Test to add:** Given tenant_admin, when assigning super_admin to user X, then 403 and no change; audit event on successful assignments.
- **Impact if wrong:** Tenant admin can mint platform super-admins (full privilege escalation).
- **Web change if wrong:** Filter isSystem roles out of the Edit Roles sheet and add confirm on save in AdminUsersManager.tsx.
