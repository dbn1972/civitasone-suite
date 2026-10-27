# Detailed gap file — module `locations`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 28, BACKEND-VERIFY 8



---
## /locations  —  `locations/home.html`

- **Source:** `apps/web/src/app/(app)/locations/page.tsx`
- **Design reference:** `redesign/locations/home.html`

### GAP-LOCATIONS-HOME-02  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Tile notes name the backend ('Location master list from location-service', page.tsx:10) and the tile is called 'Locations' while its page is titled 'Offices & branches' (list/page.tsx:8).
- **Verified evidence:** locations/page.tsx:10 note 'Location master list from location-service'; tile label 'Locations' (l.10) vs list/page.tsx:8 title 'Offices & branches'. Both true.
- **Files to change:** `apps/web/src/app/(app)/locations/page.tsx`, `apps/web/src/app/(app)/locations/list/page.tsx`
- **Fix steps:**
  1. Pick one name (e.g. 'Offices & branches') and use it for tile, page title and breadcrumb.
  2. Reword note without the service name, e.g. 'All offices, branches and facilities'.
- **Acceptance:**
  - Tile label equals page title.
  - No service names on the hub.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LOCATIONS-HOME-03  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** locations/loading.tsx is a four-stat dashboard skeleton (loading.tsx:3-15) applied to the hub, list tables and full-height map pages alike; not-found.tsx has no action back to the hub.
- **Verified evidence:** locations/loading.tsx is a tailwind skeleton with 4 stat boxes and a big block (l.2-14, uses bg-slate classes rather than ds skeleton), applied to all children since no nested loading.tsx exists. not-found.tsx renders only EmptyState with no action (l.5-9). error.tsx already uses RouteError with a back link. Note also not-found for a segment is only triggered by notFound(); unknown URLs use app-level not-found.
- **Files to change:** `apps/web/src/app/(app)/locations/loading.tsx`, `apps/web/src/app/(app)/locations/not-found.tsx`, `apps/web/src/app/(app)/locations/maps/loading.tsx`, `apps/web/src/app/(app)/locations/list/loading.tsx`
- **Fix steps:**
  1. Make locations/loading.tsx a neutral ds skeleton (header + list rows) using SkeletonCard like library/loading.tsx.
  2. Add maps/loading.tsx with a full-height block for the map pages.
  3. Give not-found.tsx an action (Link to /locations) via EmptyState action prop or a button.
- **Acceptance:**
  - Hub/table/map routes each show a matching skeleton.
  - 404 inside locations offers a back link.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /locations/geofences  —  `locations/geofences.html`

- **Source:** `apps/web/src/app/(app)/locations/geofences/page.tsx`
- **Design reference:** `redesign/locations/geofences.html`

### GAP-LOCATIONS-GEOFENCES-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1961, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: every row is flattened to ID/Name/Detail/Status/Meta by a field-guessing mapper (_data.ts:28-76), so the Geofence records are shown without their defining attributes; the ID column prints the first 8 characters of a raw id (ModuleListTable.tsx:50).
- **Verified evidence:** locations/_data.ts:28-76 mapRows guesses id/label/sublabel/status/meta from fixed key names and drops every other field; ModuleListTable.tsx:40-54 renders columns ID/Name/Detail/Status/Meta and prints row.id.slice(0,8) at :50. So Geofence records show no defining attributes.
- **Files to change:** `apps/web/src/app/(app)/locations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/locations/geofences/page.tsx`
- **Fix steps:**
  1. Create a typed mapper for Geofence in locations/_data.ts (only fields the endpoint really returns; confirm against location-service response, not visible in this snapshot).
  2. Build a locations-specific table component (or ModuleListTable columns prop) with named columns instead of Detail/Meta.
  3. Drop the ID column or show it only as a copyable secondary value; show the name as primary.
  4. Use the new component from the page.
- **Acceptance:**
  - Table headers are the domain's real attributes.
  - No 8-char raw id column for end users.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs correct API field names, so confirm with location-service.
- **Depends on:** GAP-LOCATIONS-LIST-02

### GAP-LOCATIONS-GEOFENCES-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** Closed by 12cf99f32 (UAT B4, 2026-10-27): register has an add-geofence form and per-row activate/deactivate for the roles the service allows (POST/PUT /v1/geofences), 202 shown as received then Done when visible, copy no longer says read-only; the register already sorts/filters/paginates (15 per page). Tests: GeofenceActions.test.tsx, page.manage.test.tsx.
- **W2 note:** copy says read-only and pagination/filter exist; a create/edit UI is a feature build (backend has POST/PUT /v1/geofences) - NEEDS OWNER DECISION
- **W0 note:** partly fixed by #1961 — table now has sort/filter/pagination; copy still does not say the register is read-only and there is no manage UI
- **First-pass claim:** Read-only list with no filter, search, pagination, create, edit or archive: ModuleListTable maps every returned row into the DOM (ModuleListTable.tsx:47-57); the subtitle promises definitions to manage but the route offers no action.
- **Verified evidence:** Read-only list confirmed: page.tsx passes rows to ModuleListPage/ModuleListTable, which has no search, filter, pagination or actions and maps all rows (ModuleListTable.tsx:48-56). Overstated: the description is 'Geofence definitions from location-service' (page.tsx:16), it does not promise management. The hub note (locations/page.tsx) makes no action promise either. No create/edit/archive UI exists for this entity in the tree.
- **Files to change:** `apps/web/src/app/(app)/locations/geofences/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Decide whether this entity is read-only by design; if so, update copy to say so.
  2. If management is required, add an endpoint check with backend, then a create/edit/archive component modelled on locations/list/LocationActions.tsx.
  3. Add client-side search and pagination to ModuleListTable (shared change) for large registers.
- **Acceptance:**
  - List with >50 rows paginates.
  - Users with the manage role see the action, others do not.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-LIST-01

### GAP-LOCATIONS-GEOFENCES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862 (ModuleListTable) and #1961 (page), verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load stacks the 'showing nothing' badge on the generic 'No records / Nothing to show yet' EmptyState (ModuleListTable.tsx:33-35), which reads as an empty register; no retry.
- **Verified evidence:** locations/_data.ts fetchJson falls back to [] and page passes source; ModuleListTable.tsx:33 renders DataSourceBadge ('Couldn't load — showing nothing', DataSourceBadge.tsx:72) and, when data is empty, EmptyState 'No records / Nothing to show yet' at :34-35 (useSeededResource resolves provenance error-no-data only when no cache). Both appear together; no retry control. RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance==='error-no-data' render <RefreshErrorState> (retry = router.refresh()) instead of the EmptyState.
  2. Keep EmptyState only for source==='api' with zero rows.
  3. Do this once in the shared component so all ModuleListPage users benefit.
- **Acceptance:**
  - Component test: source='error' with no cache shows retry, not 'No records'.
  - source='api', rows=[] still shows 'No records'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component used by many modules, test them.
- **Depends on:** shared:ModuleListTable

### GAP-LOCATIONS-GEOFENCES-05  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W2 locations: closed by #2046)
- **W0 note:** partly fixed by #1961 — typed Shape/Radius columns added; MonitoringMap.recordHref still sends geofence markers to /locations?geofence=<id> and hub note unchanged
- **First-pass claim:** A geofence list shows no geometry, radius or linked location, and the hub promises 'Geofence definitions and checks' (locations/page.tsx:11) but there is no check action; the mapper drops those fields entirely.
- **Verified evidence:** Table shows only mapped generic fields (_data.ts:28-76 has no geometry/radius/locationId keys), so no geometry, radius or linked location appears. Hub note 'Geofence definitions and checks' is at locations/page.tsx:12-13 (line 11 in the review is off); no check action exists on the geofence page. Additionally MonitoringMap.recordHref sends geofence markers to /locations?geofence=<id> (MonitoringMap.tsx:56-57), which the hub ignores. The real geofence API field names are not visible here.
- **Files to change:** `apps/web/src/app/(app)/locations/_data.ts`, `apps/web/src/app/(app)/locations/page.tsx`, `apps/web/src/app/(app)/locations/geofences/page.tsx`, `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.tsx`
- **Fix steps:**
  1. Confirm geofence response fields with location-service; add them to a typed mapper.
  2. Add columns for shape/radius and linked location (link to /locations/list?...).
  3. Either build a geofence detail/check page or change the hub note to 'Geofence definitions'.
  4. Point MonitoringMap geofence recordHref to /locations/geofences.
- **Acceptance:**
  - Geofence rows show radius/geometry type and location name.
  - Hub note matches available actions.
  - Clicking a geofence marker's Open record lands on a working page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; depends on API shape.
- **Depends on:** GAP-LOCATIONS-GEOFENCES-01

### GAP-LOCATIONS-GEOFENCES-06  ·  LOW  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W2 locations: closed by #2046)
- **W0 note:** partly fixed by #1961 — PageHeader back link done; title still "Locations — Geofences" and subtitle still says "from location-service"
- **First-pass claim:** Title pattern 'Locations — X' with em dash and the service name in the description ('from location-service') differs from the hub tile wording (locations/page.tsx:10-13); page uses a raw <a href> back link rather than the PageHeader back prop (page.tsx:14-16).
- **Verified evidence:** Confirmed in page.tsx: title 'Locations — X' with em dash, description 'X from location-service' (names the backend), and a raw <a href="/locations"> inside a hand-written nav.back (page.tsx:12-14) instead of PageHeader back prop (ModuleListPage renders PageHeader without back). Line refs to locations/page.tsx:10-13 are correct for the hub tile wording, which also names 'location-service' only on the first tile. Raw <a> triggers a full page load, not client navigation.
- **Files to change:** `apps/web/src/app/(app)/locations/geofences/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add an optional back prop to ModuleListPage and forward it to PageHeader; remove the hand-written nav/ArrowLeft/<a> from the page.
  2. Retitle to the tile label (e.g. 'Geofences') and drop 'from location-service' from description.
  3. Apply the same in the 3 sibling pages.
- **Acceptance:**
  - Back link is a client-side Link via PageHeader.
  - No backend service name in visible copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /locations/infrastructure  —  `locations/infrastructure.html`

- **Source:** `apps/web/src/app/(app)/locations/infrastructure/page.tsx`
- **Design reference:** `redesign/locations/infrastructure.html`

### GAP-LOCATIONS-INFRASTRUCTURE-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1961, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: every row is flattened to ID/Name/Detail/Status/Meta by a field-guessing mapper (_data.ts:28-76), so the Infrastructure asset records are shown without their defining attributes; the ID column prints the first 8 characters of a raw id (ModuleListTable.tsx:50).
- **Verified evidence:** locations/_data.ts:28-76 mapRows guesses id/label/sublabel/status/meta from fixed key names and drops every other field; ModuleListTable.tsx:40-54 renders columns ID/Name/Detail/Status/Meta and prints row.id.slice(0,8) at :50. So Infrastructure asset records show no defining attributes.
- **Files to change:** `apps/web/src/app/(app)/locations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/locations/infrastructure/page.tsx`
- **Fix steps:**
  1. Create a typed mapper for Infrastructure asset in locations/_data.ts (only fields the endpoint really returns; confirm against location-service response, not visible in this snapshot).
  2. Build a locations-specific table component (or ModuleListTable columns prop) with named columns instead of Detail/Meta.
  3. Drop the ID column or show it only as a copyable secondary value; show the name as primary.
  4. Use the new component from the page.
- **Acceptance:**
  - Table headers are the domain's real attributes.
  - No 8-char raw id column for end users.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs correct API field names, so confirm with location-service.
- **Depends on:** GAP-LOCATIONS-LIST-02

### GAP-LOCATIONS-INFRASTRUCTURE-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** Closed by 13a32fc65 (UAT B4, 2026-10-27): register has an add-asset form for the roles the service allows (POST /v1/locations/infrastructure; the service has no edit or archive endpoint, so none is offered and the copy says so); the register already sorts/filters/paginates. Tests: InfrastructureActions.test.tsx.
- **W2 note:** copy says read-only; a create UI is a feature build (backend has POST /v1/locations/infrastructure) - NEEDS OWNER DECISION
- **W0 note:** partly fixed by #1961 — table now has sort/filter/pagination; copy still does not say the register is read-only and there is no manage UI
- **First-pass claim:** Read-only list with no filter, search, pagination, create, edit or archive: ModuleListTable maps every returned row into the DOM (ModuleListTable.tsx:47-57); the subtitle promises definitions to manage but the route offers no action.
- **Verified evidence:** Read-only list confirmed: page.tsx passes rows to ModuleListPage/ModuleListTable, which has no search, filter, pagination or actions and maps all rows (ModuleListTable.tsx:48-56). Overstated: the description is 'Infrastructure assets from location-service' (page.tsx:16), it does not promise management. The hub note (locations/page.tsx) makes no action promise either. No create/edit/archive UI exists for this entity in the tree.
- **Files to change:** `apps/web/src/app/(app)/locations/infrastructure/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Decide whether this entity is read-only by design; if so, update copy to say so.
  2. If management is required, add an endpoint check with backend, then a create/edit/archive component modelled on locations/list/LocationActions.tsx.
  3. Add client-side search and pagination to ModuleListTable (shared change) for large registers.
- **Acceptance:**
  - List with >50 rows paginates.
  - Users with the manage role see the action, others do not.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-LIST-01

### GAP-LOCATIONS-INFRASTRUCTURE-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862 (ModuleListTable) and #1961 (page), verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load stacks the 'showing nothing' badge on the generic 'No records / Nothing to show yet' EmptyState (ModuleListTable.tsx:33-35), which reads as an empty register; no retry.
- **Verified evidence:** locations/_data.ts fetchJson falls back to [] and page passes source; ModuleListTable.tsx:33 renders DataSourceBadge ('Couldn't load — showing nothing', DataSourceBadge.tsx:72) and, when data is empty, EmptyState 'No records / Nothing to show yet' at :34-35 (useSeededResource resolves provenance error-no-data only when no cache). Both appear together; no retry control. RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance==='error-no-data' render <RefreshErrorState> (retry = router.refresh()) instead of the EmptyState.
  2. Keep EmptyState only for source==='api' with zero rows.
  3. Do this once in the shared component so all ModuleListPage users benefit.
- **Acceptance:**
  - Component test: source='error' with no cache shows retry, not 'No records'.
  - source='api', rows=[] still shows 'No records'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component used by many modules, test them.
- **Depends on:** shared:ModuleListTable

### GAP-LOCATIONS-INFRASTRUCTURE-05  ·  LOW  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W2 locations: closed by #2046)
- **W0 note:** partly fixed by #1961 — PageHeader back link done; title still "Locations — ..." and subtitle still says "from location-service"
- **First-pass claim:** Title pattern 'Locations — X' with em dash and the service name in the description ('from location-service') differs from the hub tile wording (locations/page.tsx:10-13); page uses a raw <a href> back link rather than the PageHeader back prop (page.tsx:14-16).
- **Verified evidence:** Confirmed in page.tsx: title 'Locations — X' with em dash, description 'X from location-service' (names the backend), and a raw <a href="/locations"> inside a hand-written nav.back (page.tsx:12-14) instead of PageHeader back prop (ModuleListPage renders PageHeader without back). Line refs to locations/page.tsx:10-13 are correct for the hub tile wording, which also names 'location-service' only on the first tile. Raw <a> triggers a full page load, not client navigation.
- **Files to change:** `apps/web/src/app/(app)/locations/infrastructure/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add an optional back prop to ModuleListPage and forward it to PageHeader; remove the hand-written nav/ArrowLeft/<a> from the page.
  2. Retitle to the tile label (e.g. 'Geofences') and drop 'from location-service' from description.
  3. Apply the same in the 3 sibling pages.
- **Acceptance:**
  - Back link is a client-side Link via PageHeader.
  - No backend service name in visible copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LOCATIONS-INFRASTRUCTURE-06  ·  LOW  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** Closed by d955c80cc (UAT B4, 2026-10-27): infrastructure assets carry an optional assetId (migration 0027, POST/list/get) and the register links the name to /assets/<id> when present, plain text when not; the add form has an optional asset picker. Tests: services/location-service/tests/infrastructure-asset-link.test.ts, InfrastructureActions.test.tsx.
- **W2 note:** the infrastructure API carries no asset-service id, so rows cannot link to /assets/:id; monitoring markers now open the register - NEEDS OWNER DECISION
- **First-pass claim:** Infrastructure rows carry no link to the Assets module although Map Monitoring links infrastructure markers to /assets/:refId (maps/_components/MonitoringMap.tsx recordHref).
- **Verified evidence:** MonitoringMap.tsx:52-53 links infrastructure markers to /assets/<refId>; the infrastructure list uses ModuleListTable rows with no href (ModuleListTable.tsx:48-56) and mapRows keeps only the row id, which may not equal the assets refId. app/(app)/assets/[id] exists. Whether infrastructure id equals asset id is cannot-verify without location-service.
- **Files to change:** `apps/web/src/app/(app)/locations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/locations/infrastructure/page.tsx`
- **Fix steps:**
  1. Confirm which field on /api/v1/locations/infrastructure maps to the asset id (refId?).
  2. Carry that in ModuleRowSummary (or a locations-specific row type) and render the name as <Link href=/assets/{refId}>.
  3. Hide the link when the field is absent.
- **Acceptance:**
  - Clicking an infrastructure name opens /assets/<id>.
  - Rows without an asset ref show plain text.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong id would 404.
- **Depends on:** GAP-LOCATIONS-INFRASTRUCTURE-01


---
## /locations/jurisdictions  —  `locations/jurisdictions.html`

- **Source:** `apps/web/src/app/(app)/locations/jurisdictions/page.tsx`
- **Design reference:** `redesign/locations/jurisdictions.html`

### GAP-LOCATIONS-JURISDICTIONS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1961, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic table: every row is flattened to ID/Name/Detail/Status/Meta by a field-guessing mapper (_data.ts:28-76), so the Jurisdiction records are shown without their defining attributes; the ID column prints the first 8 characters of a raw id (ModuleListTable.tsx:50).
- **Verified evidence:** locations/_data.ts:28-76 mapRows guesses id/label/sublabel/status/meta from fixed key names and drops every other field; ModuleListTable.tsx:40-54 renders columns ID/Name/Detail/Status/Meta and prints row.id.slice(0,8) at :50. So Jurisdiction records show no defining attributes.
- **Files to change:** `apps/web/src/app/(app)/locations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/locations/jurisdictions/page.tsx`
- **Fix steps:**
  1. Create a typed mapper for Jurisdiction in locations/_data.ts (only fields the endpoint really returns; confirm against location-service response, not visible in this snapshot).
  2. Build a locations-specific table component (or ModuleListTable columns prop) with named columns instead of Detail/Meta.
  3. Drop the ID column or show it only as a copyable secondary value; show the name as primary.
  4. Use the new component from the page.
- **Acceptance:**
  - Table headers are the domain's real attributes.
  - No 8-char raw id column for end users.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs correct API field names, so confirm with location-service.
- **Depends on:** GAP-LOCATIONS-LIST-02

### GAP-LOCATIONS-JURISDICTIONS-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** Closed by d982da37a (UAT B4, 2026-10-27): register has an assign form (office and unit chosen by name, level, primary) and a per-row revoke for the roles the service allows (POST/DELETE /v1/jurisdictions), 202 reported as received, copy no longer says read-only; the register already sorts/filters/paginates. Tests: JurisdictionActions.test.tsx.
- **W2 note:** copy says read-only; assign/revoke UI is a feature build (backend has POST/DELETE /v1/jurisdictions) - NEEDS OWNER DECISION
- **W0 note:** partly fixed by #1961 — table now has sort/filter/pagination; copy still does not say the register is read-only and there is no manage UI
- **First-pass claim:** Read-only list with no filter, search, pagination, create, edit or archive: ModuleListTable maps every returned row into the DOM (ModuleListTable.tsx:47-57); the subtitle promises definitions to manage but the route offers no action.
- **Verified evidence:** Read-only list confirmed: page.tsx passes rows to ModuleListPage/ModuleListTable, which has no search, filter, pagination or actions and maps all rows (ModuleListTable.tsx:48-56). Overstated: the description is 'Jurisdiction records from location-service' (page.tsx:16), it does not promise management. The hub note (locations/page.tsx) makes no action promise either. No create/edit/archive UI exists for this entity in the tree.
- **Files to change:** `apps/web/src/app/(app)/locations/jurisdictions/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Decide whether this entity is read-only by design; if so, update copy to say so.
  2. If management is required, add an endpoint check with backend, then a create/edit/archive component modelled on locations/list/LocationActions.tsx.
  3. Add client-side search and pagination to ModuleListTable (shared change) for large registers.
- **Acceptance:**
  - List with >50 rows paginates.
  - Users with the manage role see the action, others do not.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-LIST-01

### GAP-LOCATIONS-JURISDICTIONS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1862 (ModuleListTable) and #1961 (page), verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load stacks the 'showing nothing' badge on the generic 'No records / Nothing to show yet' EmptyState (ModuleListTable.tsx:33-35), which reads as an empty register; no retry.
- **Verified evidence:** locations/_data.ts fetchJson falls back to [] and page passes source; ModuleListTable.tsx:33 renders DataSourceBadge ('Couldn't load — showing nothing', DataSourceBadge.tsx:72) and, when data is empty, EmptyState 'No records / Nothing to show yet' at :34-35 (useSeededResource resolves provenance error-no-data only when no cache). Both appear together; no retry control. RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance==='error-no-data' render <RefreshErrorState> (retry = router.refresh()) instead of the EmptyState.
  2. Keep EmptyState only for source==='api' with zero rows.
  3. Do this once in the shared component so all ModuleListPage users benefit.
- **Acceptance:**
  - Component test: source='error' with no cache shows retry, not 'No records'.
  - source='api', rows=[] still shows 'No records'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component used by many modules, test them.
- **Depends on:** shared:ModuleListTable

### GAP-LOCATIONS-JURISDICTIONS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by caf37b7f4 (UAT B4, 2026-10-27): jurisdiction table now shows Level, Office, Unit, Parent unit and LGD code; parent and LGD code are resolved from the administrative hierarchy (/v1/hierarchy: parentId, lgdCode), so no jurisdiction API change was needed; hub copy ('Which offices cover which administrative units') makes no boundary claim. Tests: _data.test.ts, _tables.test.tsx.
- **W2 note:** Level, resolved Office/Unit names and Primary shown, hub copy fixed; parent and LGD code are not on the jurisdiction API and there is no offices list endpoint - NEEDS OWNER DECISION
- **W0 note:** partly fixed by #1961 — typed mapper with Level/Office/Unit columns added; no parent or LGD code column and hub note unchanged
- **First-pass claim:** The hub describes 'Administrative jurisdiction boundaries' (locations/page.tsx:12) but the table shows no boundary, level, parent or LGD code, only whichever of code/updatedAt the mapper picks as Meta.
- **Verified evidence:** Hub note 'Administrative jurisdiction boundaries' is locations/page.tsx:12. _data.ts:28-76 maps only name/description/status/code-or-updatedAt, so no level, parent, boundary or LGD code column exists. Real API fields not visible here.
- **Files to change:** `apps/web/src/app/(app)/locations/_data.ts`, `apps/web/src/app/(app)/locations/jurisdictions/page.tsx`
- **Fix steps:**
  1. Confirm jurisdiction response fields (level, parentId, lgdCode) with location-service.
  2. Add a typed mapper and named columns (Level, Parent name, LGD code).
  3. Reword hub note if boundaries are not available.
- **Acceptance:**
  - Jurisdiction table shows level and parent.
  - Hub copy matches content.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-JURISDICTIONS-01

### GAP-LOCATIONS-JURISDICTIONS-06  ·  LOW  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W2 locations: closed by #2046)
- **W0 note:** partly fixed by #1961 — PageHeader back link done; title still "Locations — Jurisdictions" and subtitle still says "from location-service"
- **First-pass claim:** Title pattern 'Locations — X' with em dash and the service name in the description ('from location-service') differs from the hub tile wording (locations/page.tsx:10-13); page uses a raw <a href> back link rather than the PageHeader back prop (page.tsx:14-16).
- **Verified evidence:** Confirmed in page.tsx: title 'Locations — X' with em dash, description 'X from location-service' (names the backend), and a raw <a href="/locations"> inside a hand-written nav.back (page.tsx:12-14) instead of PageHeader back prop (ModuleListPage renders PageHeader without back). Line refs to locations/page.tsx:10-13 are correct for the hub tile wording, which also names 'location-service' only on the first tile. Raw <a> triggers a full page load, not client navigation.
- **Files to change:** `apps/web/src/app/(app)/locations/jurisdictions/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add an optional back prop to ModuleListPage and forward it to PageHeader; remove the hand-written nav/ArrowLeft/<a> from the page.
  2. Retitle to the tile label (e.g. 'Geofences') and drop 'from location-service' from description.
  3. Apply the same in the 3 sibling pages.
- **Acceptance:**
  - Back link is a client-side Link via PageHeader.
  - No backend service name in visible copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /locations/list  —  `locations/list.html`

- **Source:** `apps/web/src/app/(app)/locations/list/page.tsx`
- **Design reference:** `redesign/locations/list.html`

### GAP-LOCATIONS-LIST-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** The description tells users to 'Add a branch' but the route renders none: LocationActions.tsx (create branch office, archive with reason) is never imported (list/page.tsx has 14 lines; only useFormError.ts:11 mentions it in a comment), so the add/archive flows are unreachable dead code.
- **Verified evidence:** locations/list/page.tsx (14 lines) renders only ModuleListPage; LocationActions.tsx (Create Branch Office form, archive) is exported at :58 but grep shows no importer anywhere in apps/web/src (only a comment in lib/useFormError.ts:11). Description l.11 says 'Add a branch'. The create form POSTs and archive PATCHes /api/proxy/v1/locations/{id}/archive (l.116-122).
- **Files to change:** `apps/web/src/app/(app)/locations/list/page.tsx`, `apps/web/src/app/(app)/locations/list/LocationActions.tsx`
- **Fix steps:**
  1. Import LocationActions in list/page.tsx and pass rows={data} as ModuleListPage children.
  2. Gate it behind the manage roles (same pattern as maps/page.tsx getSessionRoles + canManage).
  3. Add archive buttons per row in the table (LocationActions exposes archive at :115).
- **Acceptance:**
  - Manager sees Create Branch Office and can add a branch; row appears after router.refresh().
  - Non-manager does not see the form.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium; enables writes, so verify role gate and backend authz.
- **Depends on:** GAP-LOCATIONS-LIST-02

### GAP-LOCATIONS-LIST-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Generic ModuleListTable prints raw 8-character ids and an unlabelled Detail/Meta pair (ModuleListTable.tsx:40-50) for a register of offices: no type, parent, LGD code or address, although the create form collects type, parent and LGD code (LocationActions.tsx:16-24,96-101).
- **Verified evidence:** ModuleListTable.tsx:40-54 prints Detail/Meta columns and row.id.slice(0,8) at :50. LocationActions.tsx:16-24 lists types state..branch and collects name, type, LGD code, parent (l.60-64), none shown in the table because mapRows (locations/_data.ts, but the list uses getLocations in _data/loaders.ts:1822) flattens rows.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/locations/list/page.tsx`
- **Fix steps:**
  1. Add a LocationTable client component with columns Name, Type, Parent, LGD code, Status.
  2. Map fields from the locations API response (confirm names; same fields as the create form).
  3. Resolve parentId to parent name from the same rows list.
  4. Use it in list/page.tsx.
- **Acceptance:**
  - Rows show type and parent name.
  - No raw id shown.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-LIST-01, GAP-LOCATIONS-GEOFENCES-01

### GAP-LOCATIONS-LIST-03  ·  MEDIUM  ·  partly  ·  theme I18N

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Vocabulary conflict: hub tile 'Locations' (locations/page.tsx:10), this page 'Offices & branches', and a type list that includes State/District/Block/Ward (LocationActions.tsx:16-24) while the copy speaks of a head office and branches; the 'Getting Started' example-offices switch it mentions is not linked.
- **Verified evidence:** Vocabulary mismatch is real: hub 'Locations', page 'Offices & branches', LOCATION_TYPES includes state/district/block/ward (LocationActions.tsx:16-24) under a form titled 'Create Branch Office'. The page description mentions Getting Started; the sidebar has a 'Getting Started' item (/setup, Sidebar.tsx:49) but the page text is not a link. Strings are hard-coded English.
- **Files to change:** `apps/web/src/app/(app)/locations/list/page.tsx`, `apps/web/src/app/(app)/locations/list/LocationActions.tsx`
- **Fix steps:**
  1. Decide the domain term; retitle form 'Add location' and limit types shown if only offices are intended.
  2. Make 'Getting Started' a Link to /setup in the description.
  3. Move strings to next-intl.
- **Acceptance:**
  - Copy consistent across hub, page, form.
  - Getting Started link navigates to /setup.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-HOME-02

### GAP-LOCATIONS-LIST-05  ·  LOW  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Success/error text lives in an aria-live line with minHeight 18 (LocationActions.tsx:141-155); after create the form clears but focus is not moved.
- **Verified evidence:** LocationActions.tsx:214-223 has separate aria-live regions (assertive error, polite success) with minHeight 18; on success the fields clear (l.107-111) and router.refresh() runs but no focus management exists (grep for focus finds none). Theme I18N is wrong; it is accessibility. Since the component is currently unused (LIST-01) this is latent.
- **Files to change:** `apps/web/src/app/(app)/locations/list/LocationActions.tsx`
- **Fix steps:**
  1. Keep a ref to the name input; after success call ref.current?.focus() or focus the success message (tabIndex=-1).
  2. Keep role/aria-live as is.
- **Acceptance:**
  - After adding, focus is on the name field or status message.
  - Screen reader announces 'Branch office added'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LOCATIONS-LIST-01


---
## /locations/maps  —  `locations/maps.html`

- **Source:** `apps/web/src/app/(app)/locations/maps/page.tsx`
- **Design reference:** `redesign/locations/maps.html`

### GAP-LOCATIONS-MAPS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Delete removes a layer with one click and no ConfirmDialog (MapViewer.tsx:320, deleteLayer at 134-146): a mis-click deletes a shared GIS layer for the whole tenant; unlike LocationActions Archive, no reason or confirmation.
- **Verified evidence:** apps/web/src/app/(app)/locations/maps/_components/MapViewer.tsx:316-324 Delete button onClick calls deleteLayer(layer.id) directly; deleteLayer (134-150) issues DELETE /api/proxy/v1/locations/map-layers/:id then reload, no confirm, no reason. canManage is only a UI gate from page.tsx:4,13 (roles list). ConfirmDialog with requireReason exists at apps/web/src/app/_components/ds/ConfirmDialog.tsx. Server-side audit/maker-checker cannot be seen (locations-service absent from snapshot; only services/hrms-service exists).
- **Files to change:** `apps/web/src/app/(app)/locations/maps/_components/MapViewer.tsx`
- **Fix steps:**
  1. Add state pendingDelete: MapLayer|null in MapViewer.
  2. Change the Delete button onClick (line 320) to setPendingDelete(layer).
  3. Render <ConfirmDialog open danger requireReason title='Delete layer' description naming layer.name and 'removed for all users'> from @/app/_components/ds.
  4. On confirm call deleteLayer(id, reason); send reason in the DELETE request (query or body only if the API accepts it - confirm with locations-service owner).
  5. Keep focus return to the trigger (dialog does this) and show a toast/status on success.
  6. Do not add maker!=checker in the UI; request it from backend if policy requires.
- **Acceptance:**
  - Component test: click Delete on a layer -> fetch DELETE not called until dialog confirmed; Cancel leaves layer listed.
  - Confirm button disabled until reason non-empty.
  - Manual: as gis_admin delete a layer, dialog appears, layer removed after confirm, error shows on failure.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low UI risk; audit event and maker-checker must be enforced by the backend, which is not verifiable here.

### GAP-LOCATIONS-MAPS-02  ·  HIGH  ·  confirmed  ·  theme OFFLINE (was OTHER)

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** The map depends on runtime CDNs: Leaflet from unpkg.com and OpenStreetMap public tile servers by default (CivitasMap.tsx:69-73,98-103). In a Govt/PSU deployment behind a restricted network, or offline, the map is blank with no message, and every viewer's IP and viewed area go to third parties.
- **Verified evidence:** apps/web/src/app/_components/maps/CivitasMap.tsx:98-103 loads leaflet.css/js from unpkg.com (with SRI) inside an iframe srcDoc; 69-73 defaults tiles to https://{s}.tile.openstreetmap.org. The override reads window.__CIVITAS_MAP_TILE_URL which nothing in the repo sets; the header comment (line 10,68) names NEXT_PUBLIC_MAP_TILE_URL which is never read. Additionally apps/web/src/middleware.ts:70-80 sets CSP default-src 'self', script-src 'self' nonce, img-src 'self' data: blob: on all routes (matcher line 109); a srcdoc iframe inherits the embedder CSP, so unpkg script and tile images are very likely blocked even online (verify in browser). No error UI: if L is undefined the iframe is blank; GeoJSON fetch failures are swallowed (line ~150).
- **Files to change:** `apps/web/src/app/_components/maps/CivitasMap.tsx`, `apps/web/public/vendor/leaflet/ (new: leaflet.js, leaflet.css, images)`, `apps/web/src/middleware.ts`, `apps/web/src/app/(app)/locations/maps/page.tsx`
- **Fix steps:**
  1. Vendor leaflet 1.9.4 into apps/web/public/vendor/leaflet and reference it from srcDoc via absolute same-origin URLs (and allow it in CSP; sandbox iframe has an opaque origin so use absolute URL or inline the css/js).
  2. Make tile URL a server-read env (e.g. MAP_TILE_URL) passed from page.tsx as a prop to CivitasMap; delete the window.__CIVITAS_MAP_TILE_URL path and fix the comment.
  3. Add the tile host to CSP img-src (and connect-src for geojson/WMS hosts) from the same env; document an on-prem tile server option for Govt/PSU.
  4. In generated HTML, add a load check (typeof L === 'undefined' or tile 'tileerror' events) that postMessage's a failure to the parent; render a visible 'Map could not load' message with Retry.
  5. Escape tileUrl/layer values when interpolated into the script (JSON.stringify instead of '${tileUrl}').
- **Acceptance:**
  - Manual: block unpkg.com and openstreetmap.org in devtools -> map still renders with configured internal tile server.
  - Manual: with tile host unreachable a visible error message shows, not a blank frame.
  - Network tab: no requests to unpkg.com on the maps page; CSP console shows no violations.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** CSP change touches every route; decide which tile provider is approved for data-residency before choosing default.

### GAP-LOCATIONS-MAPS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Layer visibility toggles are local state only (MapViewer.tsx:103-108) and reset on reload; Delete/Add re-fetch and reset toggles too (MapViewer.tsx:125,143); there is no per-user persistence.
- **Verified evidence:** MapViewer.tsx:103-107 toggleVisibility only mutates React state in layers. load() (72-93) replaces layers from the API via normalizeLayers (visible = l.visible !== false, line 59), and both createLayer (line 125) and deleteLayer (line 143) call load(), so any local toggles are lost; reload also resets. No localStorage or user-preference call exists.
- **Files to change:** `apps/web/src/app/(app)/locations/maps/_components/MapViewer.tsx`
- **Fix steps:**
  1. Keep hidden layer ids in a separate state Set<string> hydrated from localStorage key (e.g. civitas.maps.hiddenLayers) in a try/catch.
  2. Derive visible = server.visible && !hidden.has(id) in visibleLayers instead of mutating layers.
  3. toggleVisibility updates the Set and writes localStorage; on load() prune ids no longer present.
  4. If cross-device persistence is wanted, decide on a user-preference endpoint (unverified) - otherwise document browser-local scope.
- **Acceptance:**
  - Test: toggle layer off, trigger add/delete (load()) -> layer stays off.
  - Test: remount component -> toggle state restored from storage.
  - Storage unavailable (throws) -> page still works with defaults.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; storage is per-browser only.

### GAP-LOCATIONS-MAPS-05  ·  LOW  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Layout grid uses inline minmax(240px,320px) with className 'map-layout' (MapViewer.tsx:259-264); the collapse rule is not in the files read, and the map is a fixed 70vh, so on a phone the panel may overflow — verify. Enum values (tile, wms, geojson) are shown raw.
- **Verified evidence:** MapViewer.tsx:256-264 sets inline gridTemplateColumns 'minmax(0,1fr) minmax(240px,320px)' with className map-layout; no CSS rule for .map-layout exists anywhere in the repo (grep of css/ts/tsx), and inline style cannot be overridden by a media query without !important. On a ~360px phone the panel keeps 240px+ so the map column collapses to ~90px (crushed rather than overflowing); map height is fixed 70vh (265). Raw enum shown at line 312 (layer.sourceType) and in the select options (214), so the 'tile/wms/geojson' claim is true. The suggested fix text (Masked/CSV) does not apply - no PII here.
- **Files to change:** `apps/web/src/app/(app)/locations/maps/_components/MapViewer.tsx`, `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.tsx (same class)`, `apps/web/src/app/globals.css (or the ds stylesheet)`
- **Fix steps:**
  1. Remove the inline gridTemplateColumns; define .map-layout in the ds stylesheet as 1 column by default and 'minmax(0,1fr) minmax(240px,320px)' at min-width 900px.
  2. Reduce map height on small screens (e.g. 60vh, min-height 320px) via the same class.
  3. Add a SOURCE_LABELS map {tile:'Tile (XYZ)', wms:'WMS', geojson:'GeoJSON'} and use it for the badge and select options while keeping raw values in the payload.
  4. Apply the same class fix in MonitoringMap.tsx:245.
- **Acceptance:**
  - Manual at 360px width: layers panel stacks below the map, map at full width, no horizontal scroll.
  - At 1280px layout is unchanged two-column.
  - Select and layer rows show 'Tile (XYZ)', 'WMS', 'GeoJSON' labels.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; CSS only.


---
## /locations/maps/monitoring  —  `locations/maps-monitoring.html`

- **Source:** `apps/web/src/app/(app)/locations/maps/monitoring/page.tsx`
- **Design reference:** `redesign/locations/maps-monitoring.html`

### GAP-LOCATIONS-MAPS-MONITORING-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** 'Live' is not live: the subtitle says live monitoring (MonitoringMap.tsx:156) but data loads on filter change or manual Refresh only; no polling or push, and no last-updated time is shown.
- **Verified evidence:** MonitoringMap.tsx:156 says 'Live geospatial monitoring'; load() (l.90-118) runs on filter change via useEffect (l.120-124) and Refresh button (l.221). No setInterval, SSE or last-updated stamp. Note the page lives in maps/_components (not monitoring/).
- **Files to change:** `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.tsx`
- **Fix steps:**
  1. Either drop 'Live' from the subtitle or add polling (setInterval 30-60s in the effect, paused when document.hidden).
  2. Store lastUpdated in state on success and show 'Updated hh:mm' near Refresh.
- **Acceptance:**
  - Subtitle matches behaviour.
  - Last-updated time changes after Refresh.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; polling adds load, keep interval long.

### GAP-LOCATIONS-MAPS-MONITORING-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Alerts and Active are counted over the filtered result (MonitoringMap.tsx:149-150): filtering Status to 'active' makes Alerts read 0 (grey), which can hide alerts that exist.
- **Verified evidence:** MonitoringMap.tsx:149-150 count alerts/active over `markers`, which are the server-filtered results of the current status/domain filter (query params l.95-97). Filtering status=active therefore gives Alerts 0 with grey icon (l.165).
- **Files to change:** `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.tsx`
- **Fix steps:**
  1. Show the stat cards from an unfiltered summary: fetch once without status (or a separate summary call) and keep counts in separate state, or label cards 'in current view'.
  2. Optionally show the count of alerts across all statuses when the filter hides them.
- **Acceptance:**
  - With status=active, Alerts still shows real alert count (or is labelled 'in view').
  - No filter: unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; extra request per load.

### GAP-LOCATIONS-MAPS-MONITORING-05  ·  LOW  ·  confirmed  ·  theme LABELS (was STATUS)

- [x] **Status** (W2 locations: closed by #2046)
- **W2 note:** domain/status labels and 4-decimal coordinates done; self-hosted Leaflet/tile URL done under MAPS-02
- **First-pass claim:** Raw enum strings (land_parcel, maintenance) appear in selects and the details panel (MonitoringMap.tsx:44-45,268-272); coordinates printed to five decimals; runtime Leaflet/OSM dependency as on the Map Viewer (CivitasMap.tsx:69-103).
- **Verified evidence:** MonitoringMap.tsx:46-47 uses raw values in options (l.190-192, 205-207 show d or s) e.g. land_parcel, and details panel prints selected.domain/status raw (l.266-269); coordinates use toFixed(5) (l.272). CivitasMap.tsx loads Leaflet from unpkg and OSM tiles (l.72-73, 98-130) at runtime; the same as the Map Viewer.
- **Files to change:** `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.tsx`, `apps/web/src/app/_components/maps/CivitasMap.tsx`
- **Fix steps:**
  1. Add DOMAIN_LABELS/STATUS_LABELS maps and use them in options and the details panel; use the ds StatusPill for status with text.
  2. Round coordinates to 4 decimals.
  3. Track self-hosting Leaflet/tiles separately (bundle leaflet, configurable tile URL) for offline/CSP.
- **Acceptance:**
  - Options read 'Land parcel', 'Maintenance'.
  - Coordinates shown to 4 decimals.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; self-hosting tiles is a separate decision.


---
## Backend verification items (service code absent from snapshot)

### GAP-LOCATIONS-HOME-01  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 locations: closed by #2046)
- **W2 note:** ALREADY-FIXED: employee token gets 403 on map-markers/geofences/infrastructure/map-layers; test added in svc112-map-layers.test.ts
- **First-pass claim:** No segment layout: /locations and all children skip requireAnyRole and ModuleGate (legal/ has both in layout.tsx:6-11); every authenticated user can open the location master, geofences and monitoring map. location-service is not in the snapshot, so server-side role checks are undeterminable.
- **Service:** `location-service`  ·  **Endpoint(s):** `['GET /api/v1/locations', '/geofences', '/locations/map-markers']`
- **Question:** Does location-service enforce role/entitlement checks so a basic employee token is rejected for master data and monitoring map?
- **How to verify:** Open location-service route preHandlers; curl GET /v1/locations/map-markers with employee JWT expecting 403.
- **Test to add:** Given employee-role token, when GET geofences, then 403.
- **Impact if wrong:** Sensitive site/infrastructure data visible to every user.
- **Web change if wrong:** Add layout.tsx with requireAnyRole + ModuleGate for locations.

### GAP-LOCATIONS-GEOFENCES-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 locations: closed by #2046)
- **W2 note:** ALREADY-FIXED: gateway registry.ts:92 routes /api/v1/geofences to location-service
- **First-pass claim:** Loader path /api/v1/geofences (_data.ts:89) sits outside the /api/v1/locations prefix used by the list and infrastructure loaders (_data.ts:88,91); whether the gateway routes it to location-service is undeterminable (location-service is not in the snapshot).
- **Service:** `location-service`  ·  **Endpoint(s):** `['GET /api/v1/geofences']`
- **Question:** Does the gateway route /api/v1/geofences to location-service?
- **How to verify:** Open gateway registry.ts for a geofences prefix; curl /api/v1/geofences via gateway expecting 200 not 404.
- **Test to add:** Given gateway running, when GET /api/v1/geofences with valid token, then 200 array from location-service.
- **Impact if wrong:** Geofences page permanently empty.
- **Web change if wrong:** Change path in locations/_data.ts:89 to /api/v1/locations/geofences if that is the routed prefix.

### GAP-LOCATIONS-INFRASTRUCTURE-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 locations: closed by #2046)
- **W2 note:** ALREADY-FIXED: GET /v1/locations/infrastructure returns the list ahead of /:id (svc114-infrastructure.test.ts:40)
- **First-pass claim:** Path /api/v1/locations/infrastructure (_data.ts:91) shares the /api/v1/locations/:id shape, so 'infrastructure' may be captured as an id by the locations router; undeterminable without location-service.
- **Service:** `location-service`  ·  **Endpoint(s):** `['GET /api/v1/locations/infrastructure']`
- **Question:** Is the static route /locations/infrastructure registered before /locations/:id so it is not captured as an id?
- **How to verify:** Open location-service router registration order; curl GET /v1/locations/infrastructure expecting an array, not 400/404 invalid id.
- **Test to add:** When GET /locations/infrastructure, then 200 list, and GET /locations/:uuid still resolves.
- **Impact if wrong:** Infrastructure page always empty or errors.
- **Web change if wrong:** Move loader path to a distinct prefix (locations/_data.ts:91).

### GAP-LOCATIONS-JURISDICTIONS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 locations: closed by #2046)
- **W2 note:** ALREADY-FIXED: gateway registry.ts:93 routes /api/v1/jurisdictions to location-service
- **First-pass claim:** Loader path /api/v1/jurisdictions (_data.ts:90) is outside the /api/v1/locations prefix; routing is undeterminable (no location-service in the snapshot).
- **Service:** `location-service`  ·  **Endpoint(s):** `['GET /api/v1/jurisdictions']`
- **Question:** Does the gateway route /api/v1/jurisdictions to location-service?
- **How to verify:** Check gateway registry.ts; curl via gateway expecting 200.
- **Test to add:** When GET /api/v1/jurisdictions, then 200 list.
- **Impact if wrong:** Jurisdictions page empty.
- **Web change if wrong:** Change path in _data.ts:90 to the routed prefix.

### GAP-LOCATIONS-LIST-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by 87553bf6b (UAT B4, 2026-10-27): archive refuses with 409 IN_USE while hrms reports current employees at the location and fails closed (503 REFERENCES_UNVERIFIABLE) when it cannot check; asset-service locationId is its own functional-location master so assets are not a reference. Tests: location-archive-edit-real-db.test.ts, hrms-client.test.ts, LocationsListTable.test.tsx.
- **W2 note:** archive already 409s on active children, takes a reason and audits (location-archive-edit-real-db.test.ts); blocking on linked assets/employees is a cross-service check - NEEDS OWNER DECISION
- **First-pass claim:** If mounted, archive is a one-step PATCH with reason (LocationActions.tsx:115-122) and no check that active records (assets, employees) reference the office; audit on create/archive and the location-service contract are undeterminable (service absent from snapshot).
- **Service:** `location-service`  ·  **Endpoint(s):** `['POST /api/v1/locations', 'PATCH /api/v1/locations/:id/archive']`
- **Question:** Does archive reject (409) when assets/employees still reference the location, require a reason, and audit both create and archive?
- **How to verify:** Open location-service archive handler; seed a location with a linked asset, curl PATCH archive expecting 409; inspect audit rows.
- **Test to add:** Given location with 1 active asset, when PATCH archive with reason, then 409 IN_USE; with none, 200 and audit locations.archived with reason.
- **Impact if wrong:** Orphaned assets/employees pointing at an archived office.
- **Web change if wrong:** Show 409 message in LocationActions.tsx:115-122.

### GAP-LOCATIONS-MAPS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 locations: closed by #2046)
- **First-pass claim:** Add layer accepts any Source URL as free text with a name check only (MapViewer.tsx:110); no scheme allow-list, https requirement or preview, so a mixed-content or hostile tile/WMS host can be added by any manage role; server-side validation in location-service is undeterminable.
- **Service:** `location-service`  ·  **Endpoint(s):** `['POST /api/v1/locations/map-layers']`
- **Question:** Does map-layers create validate sourceUrl (https only, host allow-list, type) and restrict to admin roles with audit?
- **How to verify:** Open map-layers create validator; curl POST sourceUrl 'http://evil.example/{z}/{x}/{y}.png' as admin expecting 422.
- **Test to add:** Given http:// or javascript: URL, when POST layer, then 422; non-admin gets 403; success writes audit.
- **Impact if wrong:** Mixed content or hostile tile host injected into all users' maps.
- **Web change if wrong:** Add https-only and scheme check in MapViewer.tsx:110.

### GAP-LOCATIONS-MAPS-MONITORING-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by 83b66e56e (UAT B4, 2026-10-27): GET /v1/locations/cadastral/parcels/:id added and a parcel detail page at /locations/parcels/[id]; the monitoring map links parcel markers there (infrastructure/geofence markers already open their registers). Tests: services/location-service/tests/cadastral-parcel-detail.test.ts, parcels/[id]/page.test.tsx, MonitoringMap.test.tsx.
- **W2 note:** infrastructure/geofence markers open their registers; parcel markers have no page so the link is hidden - parcel detail page is a feature build
- **First-pass claim:** 'Open record' links are unreliable: geofence goes to /locations?geofence=<id> and land_parcel to /locations/list?ref=<id> (MonitoringMap.tsx:52-58), but neither the hub nor the list page reads those query params; only infrastructure has a real target (/assets/:refId) and that route's acceptance of an infrastructure refId is undeterminable.
- **Service:** `location-service`  ·  **Endpoint(s):** `['GET /api/v1/locations/map-markers', 'GET /assets/:refId (asset route)']`
- **Question:** Does map-markers return refType/refId that map to routable records, and does /assets/:refId accept an infrastructure refId?
- **How to verify:** Open location-service map-markers DTO; click each marker type in the running app and verify target opens the record.
- **Test to add:** Given a geofence marker, when Open record clicked, then landing page shows that geofence; infrastructure refId resolves at /assets/:refId.
- **Impact if wrong:** Dead-end links from the monitoring map.
- **Web change if wrong:** Point geofence/parcel links at real detail routes or read the query params in MonitoringMap.tsx:52-58.

### GAP-LOCATIONS-MAPS-MONITORING-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (W2 locations: INTERIM in #2046)
- **W2 note:** truncated flag + notice done and parcel filter value fixed; as-of date is disabled (service keeps no history) and viewport bbox needs iframe bounds - NEEDS OWNER DECISION
- **First-pass claim:** Header comment documents the API filters as domain, status and bbox (MonitoringMap.tsx:6), but the page sends domain, status and date and never bbox (MonitoringMap.tsx:95-97): 'As of date' may be silently ignored and every marker is fetched unbounded; the map caps display at 200 markers (CivitasMap.tsx:20). map-markers contract undeterminable (location-service absent).
- **Service:** `location-service`  ·  **Endpoint(s):** `['GET /api/v1/locations/map-markers?domain&status&date|bbox']`
- **Question:** Does map-markers honour a date (as-of) parameter, accept bbox, and cap results with total/truncated flag?
- **How to verify:** Open the map-markers query schema in location-service; curl with date=2020-01-01 and compare to no date; curl with bbox.
- **Test to add:** Given markers created after 2021, when GET with date=2020-01-01, then they are excluded; response includes total > returned when capped.
- **Impact if wrong:** As-of view shows wrong state; unbounded payloads.
- **Web change if wrong:** Send bbox from map viewport and show truncation notice (MonitoringMap.tsx:95-97).
