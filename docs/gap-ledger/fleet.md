# Detailed gap file — module `fleet`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 8, BACKEND-VERIFY 1



---
## /fleet  —  `fleet/home.html`

- **Source:** `apps/web/src/app/(app)/fleet/page.tsx`
- **Design reference:** `redesign/fleet/home.html`

### GAP-FLEET-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows confident zeros: fetchJson falls back to {0,0,0,0} (page.tsx:20-22) and the KPIs render "0 Total Vehicles / 0 Overdue Maintenance" under only a header badge (page.tsx:39,51-54). Overdue = 0 on failure reads as "nothing overdue" for a safety-relevant number; no RefreshErrorState or dashes.
- **Verified evidence:** fleet/page.tsx:20-22 passes a {0,0,0,0} fallback to fetchJson, which returns that fallback with source 'error' on any failure (apiClient.ts:119-172); the page only shows a DataSourceBadge in PageHeader actions (39) and KpiCards print the zeros (51-54), including 'Overdue Maintenance 0'. No RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/fleet/page.tsx`
- **Fix steps:**
  1. Change fallback to nulls: DashboardStats fields number|null (or make loader data null on error).
  2. When source==='error' return <RefreshErrorState error={{what:'Could not load fleet figures',...}} backHref='/dashboard'/> or render KpiCard value '-' with the badge.
  3. Make KpiCard accept number|null and print '-' for null.
- **Acceptance:**
  - Test: error source -> no '0' KPI values, Try again visible.
  - Success with real 0 overdue still prints 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Safety-relevant overdue counts must never read as zero on failure.

### GAP-FLEET-HOME-02  ·  MEDIUM  ·  partly  ·  theme DSCONSIST (was MONEY)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** KpiCard hard-codes fallback hex colours (#27ae60, #e67e22, #c0392b) and ignores DS StatCard (page.tsx:93-98,112); numbers are printed with no lakh/locale grouping and no link from a KPI (e.g. Overdue Maintenance) to the filtered list.
- **Verified evidence:** Confirmed: KpiCard (fleet/page.tsx:84-116) is a local component using var(--good, #27ae60) etc. fallbacks (95-97) and inline styles, not ds StatCard (which visits/page.tsx uses); {value} printed raw (110) with no toLocaleString('en-IN'); KPIs are not links. 'MONEY' theme is wrong - values are counts. Lakh grouping only matters above 99,999 vehicles, so negligible.
- **Files to change:** `apps/web/src/app/(app)/fleet/page.tsx`
- **Fix steps:**
  1. Replace KpiCard with ds StatCard/StatGrid (as in field/visits/page.tsx:43-46), mapping variants to its tones.
  2. Wrap Overdue/Due KPIs in Link to /assets/fleet/maintenance (filter param if supported).
  3. Format with toLocaleString('en-IN').
- **Acceptance:**
  - Visual regression: KPI strip matches other dashboards in light/dark.
  - Clicking Overdue Maintenance navigates to maintenance list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-FLEET-HOME-01

### GAP-FLEET-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Module is a thin hub over other modules: 3 of 4 tiles leave /fleet for /assets/fleet/* and /estab/vehicles (page.tsx:65-77), so breadcrumb and Sidebar context change mid-flow; fleet is not in Sidebar.tsx and has no layout.tsx, so a tenant that disabled Assets can still open /fleet.
- **Verified evidence:** Tiles at fleet/page.tsx:65,70,75 link to /assets/fleet/maintenance, /assets/fleet/devices, /estab/vehicles; only 'Vehicles' stays under /fleet. No layout.tsx in app/(app)/fleet (dir has loading.tsx, page.tsx, vehicles/); Sidebar.tsx has no Fleet item (only Assets line 69, Field Ops line 123) though navRouteManifest.ts:59 lists /fleet. Assets and estab layouts apply ModuleGate (assets/layout.tsx), so a tenant with assets disabled can still open /fleet and /fleet/vehicles (whether the API then refuses is unverified).
- **Files to change:** `apps/web/src/app/(app)/fleet/layout.tsx`, `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Create app/(app)/fleet/layout.tsx mirroring field/layout.tsx with <ModuleGate moduleKey="assets">.
  2. Decide IA: add a Fleet entry under Assets in Sidebar.tsx or move /fleet under /assets/fleet.
  3. Optionally add breadcrumb parents to AutoBreadcrumb so cross-module tiles keep context.
- **Acceptance:**
  - With assets module disabled, /fleet shows 'Module Not Enabled'.
  - Fleet reachable from sidebar (if IA decision adds it).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Gate change could lock users out of fleet where only 'fleet' feature was expected; confirm module key.


---
## /fleet/vehicles  —  `fleet/vehicles.html`

- **Source:** `apps/web/src/app/(app)/fleet/vehicles/page.tsx`
- **Design reference:** `redesign/fleet/vehicles.html`

### GAP-FLEET-VEHICLES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as "No vehicles registered yet — Register your first government vehicle": vehicles=[] on error, header shows "Vehicles (0)" and the empty-state CTA copy, with only a small badge beside the button (vehicles/page.tsx:84-98,107-108); no retry.
- **Verified evidence:** vehicles/page.tsx: getVehicles falls back to [] (fetchJson at :62 of file, source 'error'); Card title `Vehicles (${vehicles.length})` (98) shows 'Vehicles (0)', DataTable emptyTitle 'No vehicles registered yet' with 'Register your first government vehicle' (106-107) and only a small badge in actions (94). No retry. Note mapVehicles returns null for unexpected shapes, which also becomes source 'error' via apiClient.
- **Files to change:** `apps/web/src/app/(app)/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. When source==='error' return <RefreshErrorState .../> with backHref='/fleet' in place of the Card.
  2. Show count only on success.
  3. Keep empty-state copy only for source 'api' with no rows.
- **Acceptance:**
  - Error source: Try again visible, no 'Vehicles (0)'.
  - Empty success: empty-state CTA still shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FLEET-VEHICLES-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Missing status is silently reported as Active: STATUS_LABELS[String(row.status ?? "active")] (vehicles/page.tsx:56), so a vehicle with null status (or a decommissioned one whose status the API omits) is shown as serviceable; and In Maintenance / Decommissioned are absent from StatusPill's map so they fall back to the neutral "info" pill rather than warn/mut (StatusPill.tsx:1-38).
- **Verified evidence:** vehicles/page.tsx:56 STATUS_LABELS[String(row.status ?? 'active')] defaults missing status to Active. The column uses cellType 'status' (72) so StatusPill receives the label 'In Maintenance'/'Decommissioned', lower-cased 'in maintenance'/'decommissioned' - neither is in STATUS_MAP (StatusPill.tsx:5-39), so both fall to 'info' (line 53); only Active gets 'good'.
- **Files to change:** `apps/web/src/app/(app)/fleet/vehicles/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Stop defaulting: if row.status is null/undefined show '-' (or 'Unknown') with a neutral pill.
  2. Add 'in maintenance' (warn) and 'decommissioned' (mut) keys to STATUS_MAP in StatusPill.tsx (additive; check tests referencing the map).
  3. Alternatively pass raw status and label to StatusPill.
- **Acceptance:**
  - Unit: mapVehicles with status undefined yields 'Unknown', not Active.
  - StatusPill renders warn for 'In Maintenance' and mut for 'Decommissioned'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared StatusPill change affects other screens using those words (unlikely).

### GAP-FLEET-VEHICLES-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 PQ: closed by #PENDING)
- **W0 note:** partly fixed by #1924 — Odometer column added (en-IN km); driver still Assigned (id prefix) not a resolved name, no roster lookup
- **First-pass claim:** Driver is "Assigned"/"Unassigned" only — no driver name, so the log cannot answer who has the vehicle; odometerKm is fetched but never shown (vehicles/page.tsx:15,57).
- **Verified evidence:** mapVehicles (vehicles/page.tsx:46-58 in file) sets driver to 'Assigned'/'Unassigned' from assignedDriverId (57); odometerKm is in RawRow (15) but never mapped or displayed. Driver names would need a lookup that this page does not do; no endpoint visible.
- **Files to change:** `apps/web/src/app/(app)/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. Add odometer column formatted with toLocaleString('en-IN') + ' km'.
  2. Resolve driver name: use a backend-provided driverName if the vehicles API returns it (unverified) or fetch the driver roster and map assignedDriverId; else show Assigned with id label.
  3. Extend VehicleRow and columns accordingly.
- **Acceptance:**
  - Odometer column shows '12,345 km'.
  - Driver column shows a name when resolvable.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Driver identity is personal data; keep visible only to fleet roles.

### GAP-FLEET-VEHICLES-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead-end actions: "Register Vehicle" navigates to /assets/fleet/vehicles (a different module and page) using class "btn secondary" (vehicles/page.tsx:91), and rows are not clickable, so there is no vehicle detail, edit or decommission from this screen. Fuel is printed as the raw enum (e.g. "diesel").
- **Verified evidence:** Link at vehicles/page.tsx:91 (in file) 'Register Vehicle' goes to /assets/fleet/vehicles (a different module page) with class 'btn secondary'; DataTable supports rowHref (DataTable.tsx:56,175,211) but it is not passed, so rows are not clickable; fuelType is String(row.fuelType ?? '-') (55) i.e. raw enum e.g. 'diesel'. No detail route exists under fleet.
- **Files to change:** `apps/web/src/app/(app)/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. Rename/annotate button ('Register in Assets') or build register flow here; use 'btn primary' for the main action.
  2. Pass rowHref={(r)=>`/assets/fleet/vehicles/${r.id}`} only if that detail route exists (verify), else link to the assets list.
  3. Format fuel with humanizeStatus (lib/formatters.ts:44).
- **Acceptance:**
  - Row click navigates to the vehicle's page.
  - Fuel shows 'Diesel'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-FLEET-VEHICLES-05  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** No mobile transform noted for the 6-column table beyond DataTable defaults; hard-coded English; year shown as text so it sorts as a string (vehicles/page.tsx:49).
- **Verified evidence:** Year is String(row.year) (vehicles/page.tsx:54 in file, not 49); for 4-digit years string sort equals numeric sort, so the sort concern is negligible. Table uses pageSize 20, sortable, filterable; mobile behaviour of DataTable was not verified. UI strings are hard-coded English (also true elsewhere in the app; no i18n use seen in this page).
- **Files to change:** `apps/web/src/app/(app)/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. Keep year as number with align:'right' if numeric sort matters.
  2. Route labels through the app's i18n helper if the project mandates it (verify convention).
  3. Check DataTable mobile layout in a 375px viewport.
- **Acceptance:**
  - 375px viewport: table readable without page-level horizontal scroll.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-FLEET-HOME-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "Due Maintenance (7d)" label maps to scheduledMaintenance — the 7-day window lives only in the label; backend definition undeterminable (assets-service absent). Loading skeleton is a generic 6-card grid.
- **Service:** `assets-service`  ·  **Endpoint(s):** `['GET /api/v1/assets/fleet/dashboard']`
- **Question:** Does scheduledMaintenance count only vehicles with maintenance due within 7 days?
- **How to verify:** Open the fleet dashboard handler in assets-service; read the scheduledMaintenance query window.
- **Test to add:** Given 2 vehicles due in 3 days and 1 in 30 days when dashboard fetched then scheduledMaintenance=2.
- **Impact if wrong:** Label states 7d but count may include all future maintenance.
- **Web change if wrong:** Rename the label in fleet/page.tsx if the window differs.
