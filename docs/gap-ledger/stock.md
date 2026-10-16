# Detailed gap file — module `stock`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 42, BACKEND-VERIFY 4



---
## /stock  —  `stock/home.html`

- **Source:** `apps/web/src/app/(app)/stock/page.tsx`
- **Design reference:** `redesign/stock/home.html`

### GAP-STOCK-HOME-01  ·  HIGH  ·  partly  ·  theme ROUTING (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1796, verified on main 9c5e9e9e9)
- **First-pass claim:** Stock list rows link to /stock/<id> (list/StockListClient.tsx:58-59 rowLinkPrefix="/stock/") but the segment has no [id] route — every row click resolves to stock/not-found.tsx (item detail exists only at inventory/[id]/page.tsx).
- **Verified evidence:** list/StockListClient.tsx:58 rowLinkPrefix="/stock/" and DataTable builds `${prefix}${id}` (ds/DataTable.tsx:212). No app/(app)/stock/[id] exists; item detail is (app)/inventory/[id]/page.tsx, whose comment (REL-023) says next.config.mjs redirects /stock/:path* -> /inventory/:path*. next.config is absent from this snapshot so runtime behaviour cannot be confirmed: without the redirect the row goes to stock/not-found.tsx; with it, the row works (but so would every /stock/* page redirect).
- **Files to change:** `apps/web/src/app/(app)/stock/list/StockListClient.tsx`
- **Fix steps:**
  1. Set rowLinkPrefix="/inventory/" in StockListClient (detail lives at inventory/[id]) or add stock/[id]/page.tsx re-exporting the inventory page.
  2. Verify next.config redirect rules (absent from snapshot) do not shadow /stock/list, /stock/ledger.
- **Acceptance:**
  - E2E: click a row on /stock/list -> item detail renders, not 'Page not found'.
  - No redirect loop for /stock/list.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; verify redirect config first.

### GAP-STOCK-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub omits New Item (/stock/items/new) and New Entry (/stock/ledger/new); both are reachable only from list/ledger toolbars (stock/page.tsx:9-11).
- **Verified evidence:** stock/page.tsx:9-11 lists only Dashboard, Stock List, Stock Ledger. /stock/items/new and /stock/ledger/new exist (items/new/page.tsx, ledger/new/page.tsx) and are reachable from list toolbar (list/page.tsx '+ New Item') and dashboard '+ New'.
- **Files to change:** `apps/web/src/app/(app)/stock/page.tsx`
- **Fix steps:**
  1. Add hub links { href:'/stock/items/new', label:'New Item' } and { href:'/stock/ledger/new', label:'New Stock Entry' } with notes.
  2. Add icons in LinkTiles TILE_ICONS.
- **Acceptance:**
  - Hub shows 5 tiles; both new links navigate to forms.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-STOCK-HOME-04

### GAP-STOCK-HOME-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Description promises 'GRN tracking' and 'inventory valuation' but no GRN route exists under stock/; GRNs surface only as a count pill on the dashboard (dashboard/page.tsx:43).
- **Verified evidence:** stock/page.tsx:6 description says 'GRN tracking and inventory valuation'. No GRN route under (app)/stock; dashboard shows only a count pill (dashboard/page.tsx:43). GRN screens exist under (app)/procurement/grn. Valuation is shown as Stock Value stat (list/dashboard) and per-item totalValue, so valuation claim is roughly true.
- **Files to change:** `apps/web/src/app/(app)/stock/page.tsx`
- **Fix steps:**
  1. Reword description to 'Stock-keeping units, stock ledger and inventory valuation' or add a hub link to /procurement/grn ('Goods Receipts').
- **Acceptance:**
  - Description mentions only features reachable from the hub.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-STOCK-HOME-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** LinkTiles icon map has only 'Dashboard' among these titles; 'Stock List' and 'Stock Ledger' fall back to the generic folder glyph (LinkTiles.tsx:52-61).
- **Verified evidence:** LinkTiles.tsx TILE_ICONS (lines 10-49) has 'Dashboard' and 'Stock' but no 'Stock List' / 'Stock Ledger'; tileIcon() (54-61) falls to href checks (only 'dashboard' matches) then default 📁.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add 'Stock List': '📦', 'Stock Ledger': '📒', 'New Item', 'New Stock Entry' to TILE_ICONS.
- **Acceptance:**
  - Hub tiles show distinct icons, no 📁.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-STOCK-HOME-02

### GAP-STOCK-HOME-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No Help Centre slug passed to ModuleHub (help prop unset), unlike hubs that expose 'How this works'.
- **Verified evidence:** stock/page.tsx passes no `help` to ModuleHub although ModuleHub/PageHeader support it (ModuleHub.tsx:13 -> PageHeader href /help/${help}). Whether a Help Centre article for stock exists cannot be confirmed here.
- **Files to change:** `apps/web/src/app/(app)/stock/page.tsx`
- **Fix steps:**
  1. Add help="<stock-slug>" once a Help Centre stock article exists; create the article if missing.
- **Acceptance:**
  - 'How this works' link appears on /stock and resolves (not 404).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /stock/dashboard  —  `stock/dashboard.html`

- **Source:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`
- **Design reference:** `redesign/stock/dashboard.html`

### GAP-STOCK-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Deltas '+120' and '+1.8%' are string literals (page.tsx:24-25) shown as up-trend chips regardless of data, including on error and at zero — fabricated trend signals on a financial figure.
- **Verified evidence:** dashboard/page.tsx:24-25 pass literal delta="+120" and delta="+1.8%" with `up` to StatCard for SKUs and Stock Value; they are not derived from data, render on error and at zero. GetStockDashboard payload (loaders.ts:3865-3880) has no previous-period field to compute a delta from.
- **Files to change:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`
- **Fix steps:**
  1. Remove delta/up props from the SKUs and Stock Value StatCards (page.tsx:24-25).
  2. If a trend is wanted, add prior-period fields to StockDashboard type + StockDashboardSchema (needs backend) and compute delta in the page; otherwise omit.
  3. Never render a delta when source==="error".
- **Acceptance:**
  - Render with source="api": no '+120'/'+1.8%' chips appear.
  - Component test: page with error result shows no delta chips.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes fabricated financial trend signal.
- **Depends on:** GAP-STOCK-DASHBOARD-02

### GAP-STOCK-DASHBOARD-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** On fetch failure the page shows a small amber badge and then real-looking zeros (SKUs 0, ₹0.00, Low Stock 0) because fetchJson returns STOCK_DASHBOARD_EMPTY (page.tsx:12, loaders.ts:3865-3891). The sibling list page shows '—' plus RefreshErrorState instead; a zero low-stock count on error can mask a stock-out.
- **Verified evidence:** getStockDashboard -> fetchJson (apiClient.ts:111-170) returns STOCK_DASHBOARD_EMPTY (all 0, loaders.ts:3865-3870) with source:"error" on any failure. page.tsx:12 only shows DataSourceBadge (small amber pill) and still renders data.totalSKUs=0, formatMoney(0)=₹0.00, lowStockAlerts=0 (page.tsx:24-26). Sibling list/page.tsx computes null values -> '—' and renders <RefreshErrorState toHumanError("load",{area}) /> when errored. mapStockDashboard (loaders.ts:3872-3879) also coerces missing numeric fields to 0.
- **Files to change:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In dashboard/page.tsx set `const errored = source==="error"`; compute display values as null when errored and pass '—' (or formatMoney(null)) to the StatCards.
  2. Copy list/page.tsx: render <RefreshErrorState error={toHumanError("load",{area:"stock dashboard"})} /> in place of the movements/GRN cards when errored.
  3. In mapStockDashboard return null when a field is not a number instead of defaulting to 0.
  4. Keep DataSourceBadge or drop it once RefreshErrorState is shown.
- **Acceptance:**
  - Component test: getStockDashboard mocked as {source:'error'} -> no '0' or '₹0.00' text, '—' shown, retry state present.
  - Payload missing lowStockAlerts -> page shows error/'—', not 0.
  - Healthy payload with real 0 low-stock still shows 0.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; behaviour change only on failure paths. A hidden low-stock count is a stock-out risk today.
- **Depends on:** GAP-STOCK-DASHBOARD-01

### GAP-STOCK-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Stock Movements' card is hard-wired to EmptyState — it never renders data (page.tsx:36) — and 'GRNs this month' shows a non-zero pill next to 'No recent GRNs' (page.tsx:43-45), contradicting itself.
- **Verified evidence:** page.tsx:36 renders <EmptyState title="No recent movements"> unconditionally; no movements loader is called. page.tsx:43 shows pill {data.grnsThisMonth} beside an unconditional EmptyState 'No recent GRNs' (45). A getStockLedger loader exists (StockLedgerEntryListSchema imported at loaders.ts:314) that could feed movements; no GRN list source exists under stock/ (GRN UI is under (app)/procurement/grn).
- **Files to change:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Fetch recent movements via the existing stock ledger loader (limit ~5) and render a DataTable, falling back to EmptyState only when the list is truly empty and not errored.
  2. For GRNs card: link the count to /procurement/grn and drop the 'No recent GRNs' EmptyState (or render real list if a stock GRN endpoint is added).
  3. Hide the pill when source==='error' (shows '—').
- **Acceptance:**
  - With 3 ledger entries, Stock Movements card lists them.
  - grnsThisMonth=5 -> card does not say 'No recent GRNs'.
  - Error state shows no contradictory pill.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; read-only display.
- **Depends on:** GAP-STOCK-DASHBOARD-02

### GAP-STOCK-DASHBOARD-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Stock-outs StatCard is a static '—' (page.tsx:27): a KPI with no data source.
- **Verified evidence:** page.tsx:27 <StatCard label="Stock-outs" value="—" /> is a literal; StockDashboard (loaders.ts:3865-3870) has no stock-out field. Items list has per-item qty from which a count could be derived client-side but only for the paged list.
- **Files to change:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decide source: add stockOuts to the dashboard endpoint + StockDashboardSchema, or derive from items with qty<=0.
  2. Wire value through mapStockDashboard; until then remove the tile.
- **Acceptance:**
  - Tile shows a real number when API supplies it.
  - No static '—' tile remains when there is no source.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; but a permanent '—' on a stock-out KPI misleads.

### GAP-STOCK-DASHBOARD-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** '+ New' is ambiguous: it opens the ledger entry form, not a new item (page.tsx:19). Hub note promises 'low-stock alerts' but only a count is shown.
- **Verified evidence:** page.tsx:19 '+ New' is <a href="/stock/ledger/new">, which is the stock-entry form, not a new item (new item is /stock/items/new). stock/page.tsx:9 hub note says 'Overview with low-stock alerts' but the dashboard only shows the count StatCard (page.tsx:26); no alert list or link to low-stock (inventory/low-stock exists).
- **Files to change:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`, `apps/web/src/app/(app)/stock/page.tsx`
- **Fix steps:**
  1. Rename button to '+ New Entry' (or split into '+ New Item' -> /stock/items/new and '+ New Entry') using next/link.
  2. Link Low Stock StatCard to the low-stock view (/inventory/low-stock) or change hub note to 'Overview of SKUs, value and low-stock count'.
- **Acceptance:**
  - Button label matches destination.
  - Hub note matches dashboard content.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-STOCK-HOME-02

### GAP-STOCK-DASHBOARD-07  ·  LOW  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Export is print-to-PDF of the whole page (PrintExportButton.tsx header comment); no data export.
- **Verified evidence:** Export is PrintExportButton -> window.print() (stock/_components/PrintExportButton.tsx header comment: stock-service exposes no export endpoint). True, but the dashboard holds only aggregate counts and value, no PII, so the PII theme does not apply; the gap is functional (no data export).
- **Files to change:** `apps/web/src/app/(app)/stock/_components/PrintExportButton.tsx`
- **Fix steps:**
  1. If real export needed, agree endpoint with stock-service (GET /v1/stock/... export) - not visible in this snapshot.
  2. Relabel button 'Print' until a data export exists.
- **Acceptance:**
  - Button reads 'Print' and opens print dialog.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None (no PII on this page).

### GAP-STOCK-DASHBOARD-08  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Card links and buttons use plain <a href> (page.tsx:19,34) instead of next/link, forcing full page loads.
- **Verified evidence:** page.tsx:19 (<a href="/stock/ledger/new" className="btn primary">) and page.tsx:34 (<a className="lnk" href="/stock/list">) are plain anchors; Link from next/link is not imported (list/page.tsx uses it).
- **Files to change:** `apps/web/src/app/(app)/stock/dashboard/page.tsx`
- **Fix steps:**
  1. import Link from "next/link" and replace both <a> with <Link>.
- **Acceptance:**
  - Click '+ New' -> client-side navigation, no full document reload (network tab).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /stock/items/new  —  `stock/items-new.html`

- **Source:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Design reference:** `redesign/stock/items-new.html`

### GAP-STOCK-ITEMS-NEW-01  ·  HIGH  ·  partly  ·  theme VALIDATION

- [~] **Status** (W2 stock: partial; 202→'submitted'/201→'created' distinction fixed; list revalidation within 60s cache still applies for the 201 sync path — acknowledged limitation of async queue)
- **W0 note:** partly fixed by #1916 — 202 vs 200/201 messages are distinct, but the list is still revalidated on a 60 s cache (getStockItems revalidateSeconds:60) so a 201 create is not shown immediately
- **First-pass claim:** Create returns 200/202 (queue path) and the page immediately says 'Stock item created.' then redirects to /stock/list after 700 ms (page.tsx:108-114); the list loader revalidates for 60 s (loaders.ts:3891-3897) and the consumer applies the write asynchronously, so the new SKU commonly is not on the list the clerk lands on.
- **Verified evidence:** submit() (page.tsx:107-114) treats res.ok||202 as success, sets 'Stock item created.', router.refresh(), pushes /stock/list after 700 ms. list loader getStockItems revalidates 60 s (loaders.ts:3891-3897). The stale-list part is verifiable; that the server applies the write asynchronously (queue consumer) cannot be verified - stock-service is not in the snapshot, though the code comment/202 handling implies it.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Distinguish res.status===202 -> message 'Item submitted; it will appear shortly' vs 200/201 'created'.
  2. Replace setTimeout+router.refresh with revalidation: server action/route calling revalidatePath('/stock/list') or set stock list loader to no-store.
  3. On 202 optionally show pending row or poll until item appears.
- **Acceptance:**
  - Create item (mock 201): list shows it immediately.
  - Mock 202: message says submitted, not created.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; users may double-create if item not visible - pair with duplicate-code error.

### GAP-STOCK-ITEMS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** When the category or UOM lookup fails, the clerk is asked to type a UUID (page.tsx:147-153, 163-168) — an id no clerk knows; the form is 'usable' only in name.
- **Verified evidence:** On lookup failure page.tsx:60-61/78-79 set error text 'Enter the UUID manually' and lines 147-153/163-168 render a text input placeholder 'UUID of stock category'/'UUID of UOM'.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Replace UUID fallback with a Retry button that re-runs the fetch, keeping the select disabled; block submit until lookups load.
  2. Extract the two fetches into a shared useLookup hook or use <EntityPicker> with search.
- **Acceptance:**
  - Simulate 500 on /v1/stock/categories -> 'Retry' shown, no UUID input; retry succeeds -> select populated.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; removes an unusable path.

### GAP-STOCK-ITEMS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Item code is free text with no format hint, example or uniqueness check; duplicate codes surface only as a generic save error (page.tsx:141-144).
- **Verified evidence:** Item code input (page.tsx:143) is required free text, no pattern, placeholder, or helper. Errors go through useFormError.fromResponse (line 109) which builds fieldErrors but the page only shows message; fieldErrors never displayed. Uniqueness enforcement is backend (not visible).
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Add zod schema (code: trimmed, uppercase pattern, max length) validated on submit.
  2. Show hint/example under the field.
  3. Render formError.fieldErrors.code inline (aria-describedby) so a duplicate-code 409 points to the field.
- **Acceptance:**
  - Enter blank/space code -> inline error, no request.
  - Mock 409 duplicate with fieldErrors.code -> message under Item code.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-STOCK-ITEMS-NEW-08

### GAP-STOCK-ITEMS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was I18N)

- [x] **Status** (W2 PQ: closed by this PR — step="any" + no Math.round; fractional UOM values accepted; error message updated)
- **W0 note:** partly fixed by #1916 — Math.trunc/silent clamp removed, negatives rejected and UOM symbol shown; fields are still step=1 and Math.round'd so fractional UOMs (2.5 kg) cannot be entered
- **First-pass claim:** Reorder level/quantity are silently truncated with Math.trunc and clamped at 0 (page.tsx:102-103); the fields carry no unit label, and fractional units of measure (e.g. 2.5 kg) cannot be expressed.
- **Verified evidence:** page.tsx:102-103 send Math.max(0, Math.trunc(Number(...))); inputs at 187/191 are step="1" with no unit; 'abc' becomes NaN -> Math.max(0,NaN)=NaN -> JSON null. Fractional UOMs (kg) cannot be expressed.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Show selected UOM symbol next to the reorder fields.
  2. Allow step per UOM (need allowsFraction on Uom - backend) or step="any"; drop Math.trunc.
  3. Validate finite >=0 with zod before submit rather than silently clamping.
- **Acceptance:**
  - Enter -5 -> error, not silently 0.
  - UOM kg accepts 2.5.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; quantity semantics must match backend integer/decimal schema (not visible).

### GAP-STOCK-ITEMS-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W2 stock: closed; Cancel is now a button; dirty form opens ConfirmDialog before navigating; beforeunload still covers tab-close)
- **W0 note:** partly fixed by #1916 — Cancel link and beforeunload dirty guard added; guard does not cover in-app client navigation (Cancel/back link shows no confirm prompt)
- **First-pass claim:** No Cancel button and no unsaved-changes guard; the only exit is the header back link (page.tsx:127-129, 201).
- **Verified evidence:** Only PageHeader back="/stock/list" (line 128); form has a single submit button (line 201); no beforeunload/dirty guard.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Add a Cancel <Link className="btn ghost" href="/stock/list"> next to submit.
  2. Track dirty state and confirm on cancel/route change (beforeunload + ConfirmDialog).
- **Acceptance:**
  - Type in a field, click Cancel -> confirm prompt; untouched form leaves silently.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-STOCK-ITEMS-NEW-06  ·  LOW  ·  confirmed  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Banner colours are hard-coded hex (#fef2f2 / #ecfdf3) and inputs use an inline style object rather than tokens (page.tsx:22, 132).
- **Verified evidence:** Banner uses #fef2f2/#ecfdf3 (line 132) and error text #b91c1c (149,165); inputStyle (22) uses var(--line) but literal padding/radius. Not a fabrication issue.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Move banner/inputs to ds classes (e.g. existing banner error/success variants, .input) or CSS variables.
  2. Share inputStyle with ledger/new via a ds component.
- **Acceptance:**
  - Dark theme banner readable; grep finds no hex in file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-STOCK-LEDGER-NEW-09

### GAP-STOCK-ITEMS-NEW-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Item type 'Fixed asset' overlaps the Assets module and 'Service' is not a stockable item; the options are not explained (page.tsx:180-182).
- **Verified evidence:** Options at page.tsx:180-182 (Consumable, Fixed asset, Service) have no help text. Whether fixed_asset/service are accepted by backend cannot be verified (stock-service absent); the overlap with Assets is a product call.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Add helper text per type or remove fixed_asset/service after product confirms.
- **Acceptance:**
  - Helper text visible under Item type.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-STOCK-ITEMS-NEW-08  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Error text is not tied to fields with aria-describedby; invalid state is only in banner/inline paragraph (page.tsx:132, 149).
- **Verified evidence:** Banner has role=alert/status (line 132) but inputs carry no aria-invalid/aria-describedby; lookup error <p role=alert> (149,165) is not linked to its input. formError.fieldErrors unused.
- **Files to change:** `apps/web/src/app/(app)/stock/items/new/page.tsx`
- **Fix steps:**
  1. Render per-field error <p id=...> from formError.fieldErrors and set aria-invalid + aria-describedby on inputs.
  2. Link lookup error text to select/input via aria-describedby.
- **Acceptance:**
  - Screen reader announces error with the field; axe passes.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.
- **Depends on:** GAP-STOCK-ITEMS-NEW-03


---
## /stock/ledger  —  `stock/ledger.html`

- **Source:** `apps/web/src/app/(app)/stock/ledger/page.tsx`
- **Design reference:** `redesign/stock/ledger.html`

### GAP-STOCK-LEDGER-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 PQ: closed by #2036)
- **First-pass claim:** On fetch failure the page shows the amber badge and then zero totals plus the normal 'No ledger entries' empty state (ledger/page.tsx:16, StockLedgerClient.tsx:61-62): an outage is presented as a genuinely empty ledger and ₹0.00 balances. The list page handles this correctly with '—' and RefreshErrorState (list/page.tsx:36-39).
- **Verified evidence:** ledger/page.tsx:9-16,29-31 - getStockLedger() returns data [] on error (loaders.ts:3907-3913); page only adds DataSourceBadge, then computes totals from [] and calls formatMoney(0) for Receipts/Issues/Net, and StockLedgerClient.tsx:61-62 renders EmptyState 'No ledger entries'. Contrast list/page.tsx:12-15,31-38 which uses errored -> '-' and RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/page.tsx`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`
- **Fix steps:**
  1. In page.tsx add `const errored = source === 'error'`; null out totalReceipts/totalIssues/netBalance when errored (as list/page.tsx does).
  2. Render StatCard values as '-' when null (formatMoney(null) already returns '-').
  3. When errored render <RefreshErrorState error={toHumanError('load',{area:'stock ledger'})}/> inside the card instead of <StockLedgerClient>.
  4. Keep the empty-state branch only for source==='api' && entries.length===0.
- **Acceptance:**
  - Component/RSC test: mock getStockLedger -> {data:[],source:'error'}; expect RefreshErrorState, no 'No ledger entries', no '0.00'.
  - Manual: stop the API; /stock/ledger shows '-' KPIs and a retry state.
  - With api+[] still shows the empty state and Rs 0.00 is acceptable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only. Prevents clerks reading an outage as zero stock movement.
- **Depends on:** RefreshErrorState

### GAP-STOCK-LEDGER-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [~] **Status** (W2 stock: partial; mapper now uses '—' instead of id slices; warehouseName absent from stock_ledger rows — full fix needs backend join. NEEDS OWNER DECISION)
- **First-pass claim:** 'Warehouse' column renders entry.party (StockLedgerClient.tsx:47) but mapStockLedgerEntries never sets party (apiMappers.ts:981-992), so the column is always '—'; the create form also treats warehouse as a raw UUID.
- **Verified evidence:** StockLedgerClient.tsx:47 renders entry.party ?? '-'; mapStockLedgerEntries (apiMappers.ts:962-993) never sets party or a warehouse field, so the column is always '-'. Create form ledger/new/page.tsx:168-169 has a free-text 'Warehouse ID (optional)' input with placeholder 'UUID', sent as fromWarehouseId/toWarehouseId (lines 90-91). Whether the ledger API returns warehouse id/name per row cannot be seen (service absent).
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`, `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Confirm ledger row payload fields (warehouseId / warehouseName) with the stock-service contract.
  2. Add `warehouseName` to StockLedgerEntry and map it in mapStockLedgerEntries (fallback '-' not id slice).
  3. Use entry.warehouseName in StockLedgerClient row; if API only has ids, resolve via a warehouses lookup loader.
  4. In ledger/new replace the UUID input with the shared entity picker/select fed by a warehouses list; submit id, show name.
- **Acceptance:**
  - Unit test mapper: row with warehouseName -> entry.warehouseName set.
  - Manual: ledger rows show warehouse names; new-entry form has no UUID text box.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low. Wrong warehouse id on a stock entry misstates inventory, so validate picker output server-side.

### GAP-STOCK-LEDGER-03  ·  MEDIUM  ·  confirmed  ·  theme UUID (was OTHER)

- [~] **Status** (W2 stock: partial; mapper uses toText(row.itemCode)/'—' fallback — no id slice; itemCode/itemName still absent from stock_ledger rows, backend join needed. NEEDS OWNER DECISION)
- **First-pass claim:** Item cell prints itemCode = itemId.slice(0,8).toUpperCase() and, without itemName in the payload, the id prefix again (apiMappers.ts:983-984) — clerks see 'A3F91C2E' rather than the SKU code from the item register.
- **Verified evidence:** apiMappers.ts:983-984 - itemCode = itemId.slice(0,8).toUpperCase() (or entry id prefix); itemName = row.itemName ?? itemId.slice(0,8). Client joins `${itemCode} ${itemName}` (StockLedgerClient.tsx:46), so without itemName the cell prints the id prefix twice. No SKU code is read from the row (row.itemCode is not consulted).
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Read `toText(row.itemCode) ?? toText(row.sku)` in mapStockLedgerEntries if the API supplies it; otherwise ask backend to add itemCode/itemName to the ledger response.
  2. Never fall back to id slices: use '-' / 'Unknown item'.
  3. Client: render name with code as secondary text only when present.
- **Acceptance:**
  - Mapper test: row with itemCode+itemName -> shown; row with only itemId -> 'Unknown item', no hex prefix.
  - Manual: ledger Item column shows SKU and name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; ledger API field names unverified here.
- **Depends on:** GAP-STOCK-LEDGER-02

### GAP-STOCK-LEDGER-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #2063)
- **W0 note:** partly fixed by #1789 — mapper now emits signedQuantity/direction from qtyIn/qtyOut, but StockLedgerClient.tsx:48 still derives the +/- sign from type==='issue'
- **First-pass claim:** Qty sign logic: only type 'issue' gets '-' (StockLedgerClient.tsx:48); transfer-out and negative adjustments (qtyOut > 0) render as '+' — quantity direction is wrong for two of four entry types.
- **Verified evidence:** StockLedgerClient.tsx:48 prefixes '-' only when type==='issue', else '+'. Mapper (apiMappers.ts:973) folds quantity = qtyIn>0 ? qtyIn : qtyOut and drops direction; type transfer/adjustment (lines 976-980) can be outbound, so those show '+'. Direction is lost at mapping.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`
- **Fix steps:**
  1. In mapStockLedgerEntries add `signedQuantity = qtyIn - qtyOut` (or `direction: 'in'|'out'`).
  2. StockLedgerClient: derive sign/format from signedQuantity (Intl en-IN with signDisplay 'exceptZero'), not from type.
  3. Use same sign in a 'Balance' check so running balance matches.
- **Acceptance:**
  - Unit test: transfer with qtyOut=5 -> '-5'; adjustment qtyIn=3 -> '+3'; issue -> '-'.
  - Manual: sum of signed qty on a page equals balance delta.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Medium; wrong movement direction misleads stock audit.

### GAP-STOCK-LEDGER-05  ·  MEDIUM  ·  confirmed  ·  theme LABEL (was MONEY)

- [x] **Status** (W2 stock: closed; StatCard renamed 'Net Receipts − Issues'; column renamed 'Balance qty'. Product decision on including transfers/adjustments still open)
- **First-pass claim:** Net Balance = receipts − issues (page.tsx:12) ignores transfers and adjustments, and the table's 'Balance' column is a quantity — two different 'balance' meanings on one screen, one in ₹ and one in units.
- **Verified evidence:** page.tsx:10-12 Net Balance = receipts - issues (transfer/adjustment excluded); totalValue = unitCost*quantity in paise (mapper line ~986) and shown via formatMoney (paise-correct). The table 'Balance' column (Client:30,50) is balanceQty (units). So one screen has a rupee 'Net Balance' and a unit 'Balance'. Money handling itself uses formatMoney; no float rupee math seen.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/page.tsx`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`
- **Fix steps:**
  1. Rename KPI to 'Net Receipts - Issues (value)' or drop it; rename column to 'Balance qty'.
  2. Optionally include adjustments (signed value) using the signed quantity from LEDGER-04.
  3. Prefer server-provided totals (see LEDGER-08).
- **Acceptance:**
  - Manual: labels distinguish value vs quantity.
  - Unit: KPI with transfer entries unchanged; with adjustment included when spec says so.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; needs product decision on what 'net balance' means (inventory valuation).
- **Depends on:** GAP-STOCK-LEDGER-04

### GAP-STOCK-LEDGER-06  ·  LOW  ·  partly  ·  theme FILTER (was DATEFMT)

- [x] **Status** (W2 PQ: closed by #2063)
- **First-pass claim:** Segmented filter offers only All/Receipts/Issues; transfer and adjustment entries can't be isolated, and header totals never reflect the active filter.
- **Verified evidence:** StockLedgerClient.tsx:22,36-41 offers All/Receipts/Issues only (transfer/adjustment unfilterable) - true. Header StatCards are computed in server page.tsx:10-12 from all entries and do not react to the filter - true. Date formatting already uses formatIndianDate (Client:45), so the DATEFMT theme/fix text does not apply.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`, `apps/web/src/app/(app)/stock/ledger/page.tsx`
- **Fix steps:**
  1. Add 'Transfers' and 'Adjustments' to SEG_OPTIONS and filter by type generically (map label->type).
  2. Either label KPIs 'All entries' or move KPI computation into the client to follow the filter.
- **Acceptance:**
  - Unit: selecting Transfers shows only type 'transfer' rows.
  - Manual: KPI label states scope.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-STOCK-LEDGER-07  ·  LOW  ·  confirmed  ·  theme OTHER (was WIRING)

- [x] **Status** (W2 PQ: closed by #2063)
- **First-pass claim:** referenceNo (entryId prefix) is mapped (apiMappers.ts:990) but not shown, so an entry cannot be quoted in an audit query; rows are not links.
- **Verified evidence:** mapper apiMappers.ts:990 sets referenceNo = entryId.slice(0,8); StockLedgerClient rows (43-51) and COLUMNS (24-31) omit it, and DataTable is not given rowLinkPrefix. No stock/ledger/[id] page exists (only ledger/new).
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`
- **Fix steps:**
  1. Add referenceNo to LedgerEntry interface and a 'Ref' column (monospace).
  2. Show full entry id/reference from API rather than an 8-char slice, if a proper voucher number exists (else backend).
  3. Do not add row links unless a ledger detail route is built.
- **Acceptance:**
  - Manual: each row shows a reference that can be quoted.
  - Unit: column present in COLUMNS.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-STOCK-LEDGER-08  ·  LOW  ·  partly  ·  theme CAP

- [x] **Status** (W2 PQ: closed by this PR — ledger/page.tsx passes from/to/type/cursor/limit from searchParams to getStockLedger; stat totals remain over the returned page since no server aggregate endpoint yet)
- **W0 note:** partly fixed by #1816 — getStockLedger now accepts limit/from/to, but ledger/page.tsx passes none, no cursor, and totals are still summed client-side over the returned page
- **First-pass claim:** Ledger has no pagination parameters in the loader (loaders.ts:3907-3913); totals are computed client-side over the returned page only.
- **Verified evidence:** loaders.ts:3907-3913 getStockLedger() calls /api/v1/stock/ledger with no limit/cursor/filter; totals (page.tsx:10-12) and table paging (DataTable pageSize=15, Client:69) are client-side over whatever the API returns. Whether the API caps results is not verifiable (stock-service absent).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/stock/ledger/page.tsx`, `apps/web/src/app/(app)/stock/ledger/StockLedgerClient.tsx`
- **Fix steps:**
  1. Extend getStockLedger(params:{type,from,to,cursor,limit}) and pass via searchParams from page.tsx.
  2. Request aggregate totals from the API (or a summary endpoint) instead of summing the page.
  3. Drive segmented filter from a query param.
- **Acceptance:**
  - Test: loader builds query string with cursor/limit.
  - Manual: with >page-size entries totals equal server aggregate.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; needs backend pagination/summary contract.
- **Depends on:** GAP-STOCK-LEDGER-05


---
## /stock/ledger/new  —  `stock/ledger-new.html`

- **Source:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Design reference:** `redesign/stock/ledger-new.html`

### GAP-STOCK-LEDGER-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [~] **Status** (W2 PQ: INTERIM — transfers intentionally not offered; no warehouse list endpoint exists. NEEDS OWNER DECISION to add GET /v1/stock/warehouses before this can be wired)
- **W0 note:** partly fixed by #1929 — the raw warehouse-UUID input was removed, but transfers are still not offered (single/no warehouse, no from/to pair; ENTRY_TYPES has receipt/issue/adjustment only)
- **First-pass claim:** Transfer cannot be expressed: a single free-text 'Warehouse ID' is sent as toWarehouseId for every type except issue (fromWarehouseId) and never both (page.tsx:89-91), so a transfer has no source/destination pair. The field is a raw UUID with no picker (page.tsx:168-169).
- **Verified evidence:** Single warehouseId state (page.tsx:40); postEntry lines 89-92 sets fromWarehouseId only for issue, else toWarehouseId; transfer never sends both. Input is placeholder 'UUID' (169). Header comment (6-8) shows the API accepts both fromWarehouseId and toWarehouseId.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Add fromWarehouse/toWarehouse state; show From for issue/transfer, To for receipt/transfer/adjustment as required.
  2. Replace UUID input with a warehouse select/<EntityPicker> (needs warehouses list endpoint - not confirmed in snapshot).
  3. Zod: transfer requires both and from!=to.
- **Acceptance:**
  - Transfer with only one warehouse blocked with error.
  - Transfer body contains both ids (test on fetch mock).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; stock movement posted to wrong/missing warehouse.

### GAP-STOCK-LEDGER-NEW-02  ·  HIGH  ·  partly  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** (W2 PQ: closed by this PR — adjustment direction (increase/decrease) added; step="any" for qty; on-hand warning shown for issue when qty > onHand)
- **First-pass claim:** Quantity is min=1, step=1 for every type (page.tsx:160-163) and there is no direction control, so an adjustment cannot reduce stock and fractional units cannot be entered; issue has no on-hand check before the irreversible post.
- **Verified evidence:** Quantity min=1 step=1 (page.tsx:161), Math.round(Number(qty)) (76); no direction control so adjustment cannot be negative, no fractional. No on-hand check client-side (backend unknown). The claim about 'no confirm' is wrong: postEntry is gated by ConfirmDialog with requireReason (101-118, 181-194), and reason is appended to notes (80-82).
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Add direction (increase/decrease) for adjustment, sending signed qty or separate field per API.
  2. Allow decimal qty when UOM permits; remove Math.round.
  3. For issue show on-hand for selected item (item list already loaded) and warn/block when qty > on-hand.
- **Acceptance:**
  - Adjustment can decrease stock.
  - Issue > on-hand shows error before dialog.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; inventory quantities.
- **Depends on:** GAP-STOCK-LEDGER-NEW-01

### GAP-STOCK-LEDGER-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W2 stock: closed; receipt rate now required and >0; issue/adjustment rate stays optional; float conversion (rupeesInputToMinorNumber) already fixed in W1)
- **W1 note:** W1 SF-12 #2003 fixed the float Math.round(Number(x)*100) conversion (now rupeesInputToMinorNumber from lib/money, covered by money.sf12.test.ts). Still open: require a rate for receipts and reject 0 unless confirmed.
- **First-pass claim:** Rate is optional and defaults to 0 (page.tsx:76-77): a zero-rate receipt is accepted and will distort weighted-average valuation; the ₹→paise conversion uses Math.round(Number(x)*100) on a float.
- **Verified evidence:** page.tsx:77 rateMinor = Math.round(Number(rate||"0")*100): blank rate becomes 0 and is posted for receipts; float multiplication (e.g. 1.005*100=100.49999999999999). No decimal-string paise helper found under src/lib (only formatMoney/formatRupees).
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add rupeesToPaise(str) in lib (regex ^\d+(\.\d{1,2})?$, integer math via BigInt/string split) and use it.
  2. Require rate for receipt (and transfer/adjustment if valued); reject 0 unless explicitly confirmed.
  3. Unit-test 0.29, 1.005 (rejected), 19.99.
- **Acceptance:**
  - '19.99' -> 1999; '1.005' rejected.
  - Receipt with blank rate blocked.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** High; inventory valuation (WAVG) distorted by 0-rate receipts.

### GAP-STOCK-LEDGER-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1929, verified on main 9c5e9e9e9)
- **First-pass claim:** useFormError('stock item') is reused for entries (page.tsx:44), so load/save failures read 'We couldn't save your stock item' on an entry form.
- **Verified evidence:** page.tsx:44 useFormError("stock item"); its messages use `area` (useFormError.ts:108) so load/save errors say stock item on the entry form.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Change to useFormError("stock entry").
- **Acceptance:**
  - Save failure reads 'stock entry'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-STOCK-LEDGER-NEW-06  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W2 PQ: closed by #2063)
- **First-pass claim:** Default date is new Date().toISOString().slice(0,10) (page.tsx:36) — the UTC date, so between 00:00 and 05:30 IST the form pre-fills yesterday; no backdating limit or period-lock hint.
- **Verified evidence:** page.tsx:36 useState(new Date().toISOString().slice(0,10)) is the UTC date; 00:00-05:30 IST yields yesterday. No min/max or period-lock hint (backend rule cannot be verified). Also SSR/CSR hydration is n/a (client page).
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add todayIst() helper (Intl.DateTimeFormat 'en-CA', timeZone 'Asia/Kolkata') and use it for default.
  2. Set max=today on the date input; surface period-lock error from backend.
- **Acceptance:**
  - Mock clock 2026-09-29T20:00Z -> default 2026-09-30.
  - Future date rejected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong posting date affects period reports.

### GAP-STOCK-LEDGER-NEW-07  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by this PR — lines array with add/remove UI; multiple items posted in one request)
- **First-pass claim:** One line item per entry (items array of length 1, page.tsx:87); a delivery with several SKUs needs several posts and several reasons.
- **Verified evidence:** Body has `items: [{ itemId, qty, rateMinor }]` (page.tsx:87); single item state. API accepts an array.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Convert item/qty/rate to a lines array with add/remove row UI.
  2. Validate each line; send all lines in one POST.
- **Acceptance:**
  - Two lines posted in one request; one reason.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; multi-line atomicity depends on backend.
- **Depends on:** GAP-STOCK-LEDGER-NEW-03

### GAP-STOCK-LEDGER-NEW-08  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 PQ: closed by this PR — plain select replaced with EntityPicker; debounced search queries /v1/stock/items?search=&limit=20)
- **W0 note:** partly fixed by #1929 — items load now shows a Loading… state and Retry; still a plain <select> capped at limit=200 with no search, so items beyond 200 are unreachable
- **First-pass claim:** Item select loads limit=200 (page.tsx:50) and is a plain dropdown without search; larger registers are silently truncated. Item list is loaded with no loading indicator.
- **Verified evidence:** page.tsx:50 fetch items?limit=200; plain <select> (152); no loading state (only empty 'Select an item…'); more than 200 items silently missing.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Replace select with searchable <EntityPicker> querying /v1/stock/items?search=&limit=20.
  2. Show loading state while fetching.
- **Acceptance:**
  - Item beyond first 200 can be found by search.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-STOCK-LEDGER-NEW-09  ·  LOW  ·  confirmed  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1929, verified on main 9c5e9e9e9)
- **First-pass claim:** Banners use hard-coded hex backgrounds and inline style (page.tsx:127, 132).
- **Verified evidence:** Banners use inline background #fef2f2/#ecfdf3 at page.tsx:129 and 132 (report said 127,132); inputStyle line 26.
- **Files to change:** `apps/web/src/app/(app)/stock/ledger/new/page.tsx`
- **Fix steps:**
  1. Use shared banner/alert component with token colours.
- **Acceptance:**
  - No hex in file; dark mode ok.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-STOCK-ITEMS-NEW-06


---
## /stock/list  —  `stock/list.html`

- **Source:** `apps/web/src/app/(app)/stock/list/page.tsx`
- **Design reference:** `redesign/stock/list.html`

### GAP-STOCK-LIST-01  ·  HIGH  ·  partly  ·  theme WIRING (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1796, verified on main 9c5e9e9e9)
- **First-pass claim:** Every row is a link to /stock/<id> (StockListClient.tsx:58-59), but no [id] page exists under stock/ — clicking an item lands on stock/not-found.tsx. The item detail that consumes getStockItemById() lives under a different segment (inventory/[id]/page.tsx:2,35), so the list links to the wrong prefix.
- **Verified evidence:** True that stock/list rows link to /stock/<id> (StockListClient.tsx:58-59) and there is no stock/[id]/page.tsx; detail lives at inventory/[id]/page.tsx using getStockItemById. But its header comment (inventory/[id]/page.tsx:14-23) states next.config permanently redirects /stock/:path* -> /inventory/:path*, so the link would hop to inventory/[id], not stock/not-found. next.config is absent from this snapshot so the redirect (and whether /stock/list itself is unreachable dead code) cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/stock/list/StockListClient.tsx`
- **Fix steps:**
  1. Verify next.config redirects in the full repo.
  2. If redirect exists: change rowLinkPrefix to '/inventory/' (avoid extra hop) and consider deleting the unreachable stock/list route.
  3. If not: add stock/[id]/page.tsx re-exporting inventory/[id] or link to /inventory/.
- **Acceptance:**
  - Manual: click a row on the list -> item detail loads (no not-found).
  - Test: rowLinkPrefix value equals an existing route.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-STOCK-LIST-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [~] **Status** (W2 PQ: partial in #2036; dashes replace fabricated ids/units, but itemCode is not required and names are not joined from the backend, needs owner acceptance or a backend change)
- **First-pass claim:** Raw ids leak into cells: UOM falls back to uomId.slice(0,4) and Category to categoryId.slice(0,8) when the API returns ids not names (apiMappers.ts:1013-1014); item code falls back to the record id (apiMappers.ts:1005). A clerk sees 'a3f9' as a unit.
- **Verified evidence:** apiMappers.ts:1005 itemCode falls back to record id; :1013 category falls back to categoryId.slice(0,8); :1014 unit falls back to uomId.slice(0,4), else 'EA'. These reach StockListClient COLUMNS (unit, itemCode) directly.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/stock/list/StockListClient.tsx`
- **Fix steps:**
  1. Use only name fields (category/categoryName, unit/uomCode) in mapStockItemSummaries; fallback '-' rather than id slices; do not default to 'EA'/'General' silently.
  2. Require itemCode; skip or flag rows missing it instead of showing id.
  3. If API returns only ids, add backend join or a lookup loader for categories/UOMs.
- **Acceptance:**
  - Mapper test: row with only uomId -> unit '-' (no 4-char id).
  - Manual: list never shows hex fragments.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong UOM shown as 'EA' could mislead quantities.

### GAP-STOCK-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #2063)
- **First-pass claim:** isLowStock = currentStock <= minStockLevel (apiMappers.ts:1019); an item with reorderLevel 0 and stock 0 is 'Low Stock' but a brand-new item with no receipts also shows 'Low Stock' — indistinguishable from a real shortfall. Stock-outs are not separated.
- **Verified evidence:** apiMappers.ts:1010-1019 currentStock defaults to 0 and minStockLevel to 0; isLowStock = currentStock <= minStockLevel, so 0<=0 is 'Low Stock' for any new/no-reorder item; no separate out-of-stock state.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/stock/list/StockListClient.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. In mapper compute status: 'out' if currentStock<=0, 'low' if minStockLevel>0 && currentStock<=minStockLevel, else 'ok'.
  2. Add segments 'Out of stock' and keep 'Low stock'; show 'No reorder level' when min=0.
  3. Add STATUS_MAP keys 'out of stock' (bad).
- **Acceptance:**
  - Unit: stock 0/min 0 -> not 'low'; stock 0/min 5 -> 'out'; stock 3/min 5 -> 'low'.
  - Manual KPI 'Low Stock' excludes new items.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium; reorder decisions depend on it.

### GAP-STOCK-LIST-05  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** (W2 PQ: closed by this PR — status param forwarded from searchParams; KPI labels show "(this page)" when items.length >= 200)
- **W0 note:** partly fixed by #1816 — getStockItems accepts limit/offset, but list/page.tsx passes none and KPIs/Low-stock filter are still computed client-side over the returned page
- **First-pass claim:** Segmented tablist filters only client-side over the first API page; page.tsx loads /api/v1/stock/items with no limit/cursor, so SKU count, value and Low Stock are computed over whatever page the API returns (page.tsx:13-15).
- **Verified evidence:** loaders.ts:3891-3897 getStockItems() requests /api/v1/stock/items with no limit/cursor; page.tsx:13-15,31-34 compute SKU count, value, categories over the returned array and Client:36 filters client-side. API-side cap unverifiable.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/stock/list/page.tsx`, `apps/web/src/app/(app)/stock/list/StockListClient.tsx`
- **Fix steps:**
  1. Add page/limit/status params to getStockItems and read from searchParams.
  2. Use server totals for KPIs (or label them 'on this page').
  3. Move Low-stock filter to a query param.
- **Acceptance:**
  - Loader test: query string built.
  - Manual: KPI equals server total with >1 page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; needs backend contract.
- **Depends on:** GAP-STOCK-LEDGER-08

### GAP-STOCK-LIST-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #2063)
- **First-pass claim:** Status cell is coerced with 'as unknown as boolean' to satisfy cellType 'status' (StockListClient.tsx:41-46) — type-unsafe, and 'Low Stock' vs 'OK' relies on text mapping in DataTable.
- **Verified evidence:** StockListClient.tsx:39-42 overwrites boolean isLowStock with the string 'Low Stock'/'OK' via `as unknown as boolean`, and :57 casts rows `as unknown as Record<string,unknown>[]`. DataTable cellType status -> StatusPill (DataTable.tsx:127); 'low stock' is in STATUS_MAP (bad) but 'OK' is not, so it renders neutral info rather than good.
- **Files to change:** `apps/web/src/app/(app)/stock/list/StockListClient.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add `statusLabel: string` to the row model, keep isLowStock boolean.
  2. Point the column at statusLabel; drop both casts (type rows as StockRow & Record<string,unknown>).
  3. Add 'ok'/'in stock' to STATUS_MAP as good.
- **Acceptance:**
  - tsc passes with no `as unknown`.
  - Manual: OK renders green, Low Stock red.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** StatusPill

### GAP-STOCK-LIST-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #2063)
- **First-pass claim:** Table has no Category column even though Categories is a headline KPI and category is in the row data.
- **Verified evidence:** StockListClient COLUMNS (22-29) have no category column although StockItem.category exists (line 15) and page.tsx:15,34 shows a Categories KPI.
- **Files to change:** `apps/web/src/app/(app)/stock/list/StockListClient.tsx`
- **Fix steps:**
  1. Add { key:'category', label:'Category' } after Name.
  2. Optionally add a category filter Segmented.
- **Acceptance:**
  - Manual: Category column visible and sortable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-STOCK-HOME-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 stock: backend verified; stock-service present; GET /v1/stock/dashboard + /v1/stock/items enforce requireRole(ctx, STOCK_ROLES); 403 on missing role, 200 on valid role)
- **First-pass claim:** stock-service is not present in the services/ snapshot (only hrms-service), so endpoints behind these routes cannot be verified — undeterminable.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/dashboard', 'GET /api/v1/stock/items']`
- **Question:** Do the stock endpoints behind /stock exist with the shapes the loaders assume, and enforce stock roles?
- **How to verify:** Open stock-service routes; run contract tests from web zod schemas against responses; call with a role lacking stock access.
- **Test to add:** Given a stock-less user; when GET /api/v1/stock/items; then 403; given valid role then 200 matching schema.
- **Impact if wrong:** Hub renders empty/false data or leaks inventory.
- **Web change if wrong:** none unless contract mismatch; then adjust mappers.

### GAP-STOCK-DASHBOARD-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 stock: backend verified; inventoryValue = valuation.totalValuePaise (BigInt, explicitly named paise in dashboard/queries.ts); no 100x risk)
- **First-pass claim:** formatMoney(data.inventoryValue) assumes paise; the payload type is a bare number (loaders.ts:3872-3880) so rupee-vs-paise cannot be confirmed — stock-service is absent from the snapshot (undeterminable).
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/dashboard']`
- **Question:** Is inventoryValue returned in paise (minor units) as an integer?
- **How to verify:** Open stock-service dashboard handler and value computation (sum of qty*rate column type); curl and compare with a known ledger.
- **Test to add:** Given one item qty 10 at Rs 5.00; when GET dashboard; then inventoryValue===5000 (paise).
- **Impact if wrong:** 100x value misstatement on the dashboard.
- **Web change if wrong:** Fix formatMoney unit or add an explicit unit field to the loader type (loaders.ts:3872-3880).

### GAP-STOCK-LEDGER-NEW-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (W2 stock: backend verified; entry consumer audit() emits {service,action,resourceType,resourceId,outcome} only — reason/notes are NOT included. Structured reason field absent from POST validator. NEEDS OWNER DECISION: add reason to audit payload + validator)
- **First-pass claim:** The audit reason is folded into the free-text notes as 'Reason: …' (page.tsx:79-82) instead of a structured field; whether the server emits a proper audit event with it is undeterminable.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/stock/entries']`
- **Question:** Does stock-service accept a structured reason field and emit an audit event containing it, rather than parsing 'Reason:' from notes?
- **How to verify:** Open the stock entries schema (zod) and audit emission; check for reason/reasonCode column.
- **Test to add:** Given POST entry with reason; when saved; then audit event stock.entry.created has reason field; missing reason for adjustment types returns 422.
- **Impact if wrong:** Audit trail unusable for stock-adjustment investigations.
- **Web change if wrong:** Send reason as its own field in stock/ledger/new/page.tsx:79-82.

### GAP-STOCK-LIST-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (W2 stock: backend verified; ItemWithUom (item list response) has no totalValue field — mapper returns null → '—'. No 100x risk since field is absent. NEEDS OWNER DECISION: add totalValue (bigint paise) to GET /v1/stock/items response)
- **First-pass claim:** Money: 'Value ₹' column and Stock Value StatCard assume totalValue is paise (StockListClient.tsx:39 comment, formatMoney) but parseMinor() accepts any numeric string (apiMappers.ts:63-71); unit of the stock-service field cannot be verified — undeterminable.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/items']`
- **Question:** Is totalValue in paise as an integer for every item?
- **How to verify:** Open stock-service item DTO and value column types; curl items and compare with the ledger.
- **Test to add:** Given item worth Rs 100.00; when GET items; then totalValue===10000.
- **Impact if wrong:** 100x misstatement of stock value.
- **Web change if wrong:** Fix parseMinor/formatMoney assumption (apiMappers.ts:63-71) or read an explicit unit field.
