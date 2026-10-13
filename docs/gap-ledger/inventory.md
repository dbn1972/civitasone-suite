# Detailed gap file — module `inventory`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 46, BACKEND-VERIFY 16



---
## /inventory  —  `inventory/home.html`

- **Source:** `apps/web/src/app/(app)/inventory/page.tsx`
- **Design reference:** `redesign/inventory/home.html`

### GAP-INVENTORY-HOME-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failure is invisible: page.tsx:19-21 destructures only .data from getInventoryLowStock and forecast, so a down inventory-service renders a normal-looking hub with no chart and no warning; the Low Stock alert is the one number the hub exists to surface.
- **Verified evidence:** inventory/page.tsx:16 `const { data: lowStock } = await getInventoryLowStock()` ignores source; :18 uses forecast?.data.available and ignores its source; :37 renders the chart only if all true. On failure lowStock=[] so hub is identical to a healthy store with no alerts. Also note the hub itself shows no low-stock number at all (only the chart), so the 'one number the hub exists to surface' is not displayed even when healthy (see HOME-03).
- **Files to change:** `apps/web/src/app/(app)/inventory/page.tsx`
- **Fix steps:**
  1. Keep the whole result: const lowRes = await getInventoryLowStock().
  2. If lowRes.source==='error' render a card with <RefreshErrorState error={toHumanError('load',{area:'low-stock alerts'})}/> above the tiles (children slot of ModuleHub).
  3. Treat forecast failure separately: forecast source==='error' -> small inline note 'Forecast unavailable', not silence.
  4. Add a Low-stock count (see HOME-03) that shows '—' on error.
- **Acceptance:**
  - Mock low-stock 500: hub shows error card with Retry.
  - Mock forecast 500 with healthy low-stock: alert count shown, forecast note shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-INVENTORY-HOME-03, RefreshErrorState

### GAP-INVENTORY-HOME-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** "Item nearest reorder" is lowStock[0] (page.tsx:20) — the API order is not sorted by proximity to reorder level in the page, so the chart may show any low item.
- **Verified evidence:** page.tsx:17 picks lowStock[0] and never sorts, and the card title (:38) calls it 'item nearest reorder'. True that the page does not enforce ordering. Whether the API already returns worst-first cannot be verified (inventory-service absent), and low-stock items are by definition at/below reorder level, so 'nearest' is really 'furthest below'.
- **Files to change:** `apps/web/src/app/(app)/inventory/page.tsx`
- **Fix steps:**
  1. Sort client-side: pick the row with the smallest onHandQty/reorderLevel ratio (guard reorderLevel 0) or largest shortfall (reorderLevel-onHandQty).
  2. Retitle card to match the criterion, e.g. 'Demand forecast - most below reorder level'.
  3. Optionally let the user choose the item (select of top 5) and pass its itemId to getInventoryItemForecast.
- **Acceptance:**
  - Given rows [A ratio .9, B ratio .2] chart shows B regardless of API order.
  - reorderLevel 0 rows do not divide by zero.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-INVENTORY-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Ten tiles carry no counts or status (ModuleHub.tsx maps links to NavTile title/description only); nothing tells the store-keeper how many items are low, returns pending QC or counts pending approval.
- **Verified evidence:** ModuleHub.tsx:19-23 maps links to NavTile {title,href,description} only; page.tsx:24-35 defines 10 static links. No badge/count field is passed. NavTile type definition was not found in packages/types/src in this snapshot, so whether LinkTiles supports a badge prop is unverified.
- **Files to change:** `apps/web/src/app/_components/ModuleHub.tsx`, `apps/web/src/app/(app)/inventory/page.tsx`, `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Check LinkTiles/NavTile for a badge prop; if absent add optional `badge?: {text:string; tone?: 'warn'|'info'}` to ModuleHub links and render it.
  2. In inventory/page.tsx fetch counts in parallel: low-stock length (already loaded), pending-QC returns (getInventoryGoodsReturns filter qcStatus==='pending'), cycle counts with status pending_approval (getInventoryCycleCounts).
  3. Attach badges to the Low Stock, Goods Returns and Cycle-count tiles; show '—' for a failed fetch.
  4. Wrap in Promise.all to avoid serial latency.
- **Acceptance:**
  - Healthy data: Low Stock tile shows N, Goods Returns shows pending QC count.
  - One failed fetch shows '—' on that tile only.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Extra server fetches on the hub; keep them parallel and cached (revalidate 30s).
- **Depends on:** GAP-INVENTORY-HOME-01

### GAP-INVENTORY-HOME-04  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** totalDemand and confidence are mapped (_data.ts:200-214) but never shown next to the chart; the loading skeleton (loading.tsx) draws four stat cards the hub does not have.
- **Verified evidence:** _data.ts:218-224 map totalDemand and confidence, but page.tsx:39 passes only itemName and points to ForecastChart, which takes no such props (ForecastChart.tsx:11-14); so both are unused. loading.tsx:7-11 draws four stat cards plus a large block, while the hub has no stat cards (it has the optional forecast card and tiles). Because inventory/loading.tsx is the segment-level fallback it also shows for every sub-route, most of which have 2-4 StatCards, so 'wrong' is page-dependent.
- **Files to change:** `apps/web/src/app/(app)/inventory/page.tsx`, `apps/web/src/app/(app)/inventory/ForecastChart.tsx`, `apps/web/src/app/(app)/inventory/loading.tsx`
- **Fix steps:**
  1. Extend ForecastChart props with totalDemand and confidence and show 'Total 30-day demand: N units' and confidence via existing ConfidenceBar/PredictionBadge (ds/).
  2. Pass forecast.data.totalDemand/confidence from page.tsx.
  3. Rewrite loading.tsx to a header skeleton + tile grid skeleton using ds Skeleton; add per-route loading.tsx only where shapes differ.
- **Acceptance:**
  - Chart card shows total demand and confidence.
  - Hub loading skeleton contains no stat-card row.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /inventory/[id]  —  `inventory/detail.html`

- **Source:** `apps/web/src/app/(app)/inventory/[id]/page.tsx`
- **Design reference:** `redesign/inventory/detail.html`

### GAP-INVENTORY-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Outage masquerades as 404: getStockItemById falls back to null (loaders.ts:3899-3905) and the page returns "Item not found" at page.tsx:38-44 before the source==="error" badge (page.tsx:69) can render; the comment at page.tsx:110 even relies on this.
- **Verified evidence:** page.tsx:37-44 returns 'Item not found' whenever item is null. getStockItemById (loaders.ts:3899-3905) uses null as empty, and fetchJson returns null with source 'error' on any failure (apiClient.ts:142-157), so the badge at page.tsx:69 is unreachable on failure. The comment supporting this is at page.tsx:134 (not 110).
- **Files to change:** `apps/web/src/app/(app)/inventory/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status from getStockItemById; when source==='error' && status!==404 render <RefreshErrorState backHref='/inventory/list'/>.
  2. Keep 'Item not found' for 404 only.
  3. Update the ux-001-ok comment at line 134 and remove the unreachable badge.
- **Acceptance:**
  - source error status 503 -> retry state.
  - 404 -> not found.
  - Ok item renders unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-INVENTORY-CYCLE-COUNTS-DETAIL-01

### GAP-INVENTORY-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Qty sign is "-" only for type "issue" (page.tsx:46) and the mapper maps any unknown voucherType to "receipt" and uses qtyIn||qtyOut (apiMappers.ts:973-979), so stock-reducing adjustments/transfers show as "+".
- **Verified evidence:** page.tsx:50 sets '-' only for type==='issue'. Mapper (apiMappers.ts:971-979) does map 'transfer' and 'adjustment' to their own types (observation wrongly says they become receipt); only unknown voucherTypes fall back to 'receipt'. Quantity is qtyIn>0 ? qtyIn : qtyOut, discarding direction, so an adjustment/transfer with qtyOut shows '+', and unknown types with qtyOut show '+' too. Sign is wrong for stock-reducing adjustments/transfers.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/inventory/[id]/page.tsx`, `packages/types (StockLedgerEntry)`
- **Fix steps:**
  1. Add direction: 'in'|'out' to StockLedgerEntry, set from qtyOut>0 && qtyIn===0 in mapStockLedgerEntries.
  2. In page.tsx use entry.direction for the sign instead of type==='issue'.
  3. Map unknown voucherType to a neutral 'other' instead of 'receipt'.
  4. Add tests for adjustment out and transfer out.
- **Acceptance:**
  - Fixture voucherType adjustment qtyOut 5 -> '-5'.
  - transfer qtyIn 3 -> '+3'.
  - Unknown type not labelled Receipt.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Stock quantity display; verify with balance column.

### GAP-INVENTORY-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme DATA-MODEL (was WIRING)

- [x] **Status** — PR #1844 (merged)
- **First-pass claim:** Inventory route reads the /stock service while sibling inventory pages read /inventory (loaders.ts:3900 vs _data.ts); two item masters with different fields (itemCode vs sku).
- **Verified evidence:** loaders.ts:3892,3900 use /api/v1/stock/items while inventory/_data.ts:127 uses /api/v1/inventory/items; inventory rows expose sku (_data.ts:14,43) and the stock mapper uses itemCode (apiMappers.ts:1005). The inventory detail page thus reads a different endpoint than its sibling list pages. Whether these are two masters or one service aliased at the gateway cannot be verified (no inventory/stock service in snapshot).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. Confirm with backend whether /stock/items and /inventory/items are the same master.
  2. If yes, point loaders at one path and one item type (sku vs itemCode mapping in one mapper).
  3. If not, plan consolidation; until then document which page uses which.
- **Acceptance:**
  - Clicking an item from /inventory list opens a detail showing the same code/name.
  - One endpoint prefix used for items.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Data consistency between item masters; do not merge in UI.


---
## /inventory/bins  —  `inventory/bins.html`

- **Source:** `apps/web/src/app/(app)/inventory/bins/page.tsx`
- **Design reference:** `redesign/inventory/bins.html`

### GAP-INVENTORY-BINS-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (bins/page.tsx:20-27); the page badge is the legacy source-only DataSourceBadge while BinsTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** bins/page.tsx:11-12,23-25 compute stats from bins (empty on fetch error) so the StatCards show 0 (StatCard accepts null and renders a dash, ds/StatCard.tsx:8-13, but null is not passed). Line 20 renders legacy DataSourceBadge source='error' while BinsTable.tsx:32 uses useSeededResource and may show cached rows, so the page badge can say 'showing nothing' over cached data, and stats (0) disagree with the cached table. Empty table falls to DataTable default 'No records found' (DataTable.tsx:184) with no retry. Badge does show 'Couldn't load', so the outage is flagged but with contradictory numbers and no retry.
- **Files to change:** `apps/web/src/app/(app)/inventory/bins/page.tsx`, `apps/web/src/app/(app)/inventory/BinsTable.tsx`
- **Fix steps:**
  1. In page.tsx pass value={source === 'error' ? null : bins.length} (and active/withCapacity) to StatCard.
  2. Remove the page-level DataSourceBadge; move stats and badge into a client component fed by the same useSeededResource call as BinsTable (UX-002 pattern), or compute stats from the hook data.
  3. In BinsTable when provenance === 'error-no-data' && rows empty render <RefreshErrorState> instead of the DataTable empty state; use DataSourceBadge provenance prop for the cached note.
- **Acceptance:**
  - Test: source='error', no cache -> stat cards show a dash, RefreshErrorState with Retry, no 'No records found'.
  - Cached rows + error -> stats derived from cached rows, single 'Showing saved data' note.
  - source='api' with [] -> 0s and empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only register.

### GAP-INVENTORY-BINS-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Store column prints storeId.slice(0, 8) as a code chip (BinsTable.tsx:18) — a UUID fragment, not the store name; users cannot tell which store a bin belongs to.
- **Verified evidence:** BinsTable.tsx:18 renders <code>{r.storeId.slice(0, 8)}</code> as the Store column. InventoryBinRow (inventory/_data.ts:49-59) carries only storeId; no store name field is fetched from /api/v1/inventory/bins.
- **Files to change:** `apps/web/src/app/(app)/inventory/BinsTable.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. Ask backend whether /inventory/bins can return storeName (or add a stores lookup endpoint); add storeName?: string to InventoryBinRow.
  2. Render storeName ?? '—' in the Store column, with the id only as title attribute.
  3. If no name is available short-term, load stores list once in the page and map id->name server-side.
- **Acceptance:**
  - Fixture with storeName renders the name.
  - No 8-char UUID fragment visible.
  - Row without name shows '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; cross-service lookup must go through API, not SQL.

### GAP-INVENTORY-BINS-03  ·  MEDIUM  ·  confirmed  ·  theme MISSING (was DEADROUTE)

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** Register is read-only: no create/edit/deactivate control anywhere in the route tree, though the hub describes it as the place for bin locations (page.tsx, BinsTable.tsx).
- **Verified evidence:** Only bins/page.tsx and BinsTable.tsx exist under inventory/bins; no create/edit/deactivate control or route. The page is a read-only DataTable. Whether inventory-service exposes POST/PATCH for bins is not visible (no inventory service in snapshot).
- **Files to change:** `apps/web/src/app/(app)/inventory/bins/page.tsx`, `apps/web/src/app/(app)/inventory/bins/new/page.tsx`, `apps/web/src/app/(app)/inventory/BinsTable.tsx`
- **Fix steps:**
  1. Confirm bin create/update endpoints exist in inventory-service.
  2. Add a 'New bin' action and form (zod-validated, with store picker) at bins/new.
  3. Add row action deactivate via ActionButton with confirm, gated by an inventory-manager role, posting through /api/proxy/v1/inventory/bins/{id}.
  4. If no endpoint exists, reword the hub description to 'view'.
- **Acceptance:**
  - Authorised user can create a bin and see it after router.refresh().
  - Deactivate requires confirm and reflects in Status pill.
  - Unauthorised user sees no controls.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Writes to stock locations; must emit audit event server-side.
- **Depends on:** GAP-INVENTORY-BINS-02


---
## /inventory/cycle-counts/[id]  —  `inventory/cycle-counts-detail.html`

- **Source:** `apps/web/src/app/(app)/inventory/cycle-counts/[id]/page.tsx`
- **Design reference:** `redesign/inventory/cycle-counts-detail.html`

### GAP-INVENTORY-CYCLE-COUNTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Outage reads as "Cycle count not found — may have been removed or the ID is invalid" (page.tsx:19-30; loaders.ts:2549-2558 falls back to null); the badge at page.tsx:43 is unreachable when data is null.
- **Verified evidence:** page.tsx:18-29 returns 'Cycle count not found' whenever data is null. getCycleCountById (_data/loaders.ts:2549-2558) uses null as the empty value, and fetchJson returns {data: empty, source:'error', status} for any non-ok/invalid response (apiClient.ts:142-157), so a 500/timeout is indistinguishable from 404. The badge at page.tsx:43 is only reached when cycleCount is non-null, i.e. effectively unreachable when source==='error'.
- **Files to change:** `apps/web/src/app/(app)/inventory/cycle-counts/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In page.tsx destructure {data, source, status}; if source==='error' && status!==404 render <RefreshErrorState backHref='/inventory/list'/>.
  2. Keep the not-found EmptyState only for status 404 (or successful null payload).
  3. Remove the unreachable DataSourceBadge at line 43.
- **Acceptance:**
  - Mock loader {source:'error',status:503} -> retry error state, no 'not found'.
  - status 404 -> not found.
  - Retry triggers router.refresh().
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Approval screen: a masked outage may make supervisors think the count is gone.

### GAP-INVENTORY-CYCLE-COUNTS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme UUID (was PII)

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** Item and Warehouse print raw UUIDs (page.tsx:22,66-73) and the subtitle is "Item {uuid}"; approvedBy/rejectedBy are printed verbatim — likely user ids, not names (DPDP-safe but unusable).
- **Verified evidence:** page.tsx:38 subtitle 'Item {itemId}', :55 and :59 print itemId and warehouseId as raw mono UUIDs, :93 and :103 print approvedBy/rejectedBy verbatim. mapCycleCountDetail (apiMappers.ts:459-485) maps only ids; no item/warehouse/user name fields. Not a PII masking matter (Masked/theme PII is wrong): the issue is unusable identifiers.
- **Files to change:** `apps/web/src/app/(app)/inventory/cycle-counts/[id]/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Ask backend to return itemName, warehouseName and approvedByName/rejectedByName on GET cycle-counts/{id} (or provide lookups).
  2. Extend CycleCountDetail and mapCycleCountDetail with optional name fields.
  3. Render name ?? '—' with ids only as title attribute; change subtitle to item name.
- **Acceptance:**
  - Fixture with names renders names, no UUID text.
  - Missing name renders '—'.
  - Snapshot test of mapper.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; user identity shown to authorised approvers only.

### GAP-INVENTORY-CYCLE-COUNTS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** Failure text is res.text() thrown as Error (CycleCountActions.tsx:16,29); a stale-version 409 will surface the raw response body, not "someone else already decided this count".
- **Verified evidence:** CycleCountActions.tsx:21 and :30 throw new Error(await res.text() || fallback); useConfirmAction (ActionButton.tsx:48-49) displays e.message. So a 409 stale-version response body (likely a JSON error envelope, exact shape not visible) is shown raw to the supervisor.
- **Files to change:** `apps/web/src/app/(app)/inventory/cycle-counts/[id]/CycleCountActions.tsx`, `apps/web/src/lib/messages.ts`
- **Fix steps:**
  1. Add a helper (in lib/messages.ts or new lib/api/readError.ts) that parses the JSON error body and maps status 409 to 'Someone else already decided this count. Refresh to see the latest.', 403 to a permission message, else a generic message.
  2. Use it in approve() and reject() instead of res.text().
  3. After a 409 call router.refresh() so the new status shows.
- **Acceptance:**
  - Unit test: 409 response -> friendly message, no JSON text.
  - 500 -> generic message.
  - On 409 the page refreshes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Approval action; keep version sent for optimistic locking.

### GAP-INVENTORY-CYCLE-COUNTS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme MISSING (was DEADROUTE)

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** No link from a rejected/approved count to the resulting stock adjustment in the ledger; back link always goes to /inventory/list.
- **Verified evidence:** page.tsx:21,39 hard-code back='/inventory/list' (list page has the pending cycle counts table). CycleCountDetail (mapper lines 465-484) has no adjustment/ledger reference field, so no link is possible today. The reconcile route (inventory/reconcile) shows the ledger.
- **Files to change:** `apps/web/src/app/(app)/inventory/cycle-counts/[id]/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Ask backend to return adjustmentEntryId (or ledger reference) on approved counts.
  2. Add to CycleCountDetail and mapper.
  3. Show 'View stock adjustment' link to the ledger row when status is approved/auto_posted.
- **Acceptance:**
  - Approved fixture with adjustmentEntryId shows link.
  - Rejected count shows no link.
  - Back link unchanged.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /inventory/goods-returns  —  `inventory/goods-returns.html`

- **Source:** `apps/web/src/app/(app)/inventory/goods-returns/page.tsx`
- **Design reference:** `redesign/inventory/goods-returns.html`

### GAP-INVENTORY-GOODS-RETURNS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (goods-returns/page.tsx:23-30); the page badge is the legacy source-only DataSourceBadge while GoodsReturnsTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** goods-returns/page.tsx:10-12,26-28 derive Returns/Pending QC/Total Qty from returns=[] on failure (fetchJson empty value), so StatCards show 0 (StatCard would show '—' only for null). Table comes from GoodsReturnsTable.tsx:34-39 useSeededResource, which may replace data with a cached copy while the page badge (:23, legacy source-only DataSourceBadge) says 'Couldn't load — showing nothing' (DataSourceBadge.tsx:74-75, UX-002 note :9-15). The badge is at least rendered on error, so it is not fully silent.
- **Files to change:** `apps/web/src/app/(app)/inventory/goods-returns/page.tsx`, `apps/web/src/app/(app)/inventory/GoodsReturnsTable.tsx`
- **Fix steps:**
  1. In goods-returns/page.tsx: keep result=await loader(); compute derived stats only when source!=='error', otherwise pass null to StatCard (StatCard.tsx displayValue already renders '—' for null).
  2. Remove the page-level legacy <DataSourceBadge source='error'> (it cannot know about cached rows).
  3. In GoodsReturnsTable.tsx: destructure provenance from useSeededResource and render <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> above the table (same hook call, per UX-002 note in DataSourceBadge.tsx).
  4. When provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'goods returns'})} backHref='/inventory' /> instead of DataTable so it is not shown as 'No records found'.
  5. Stats that must reflect cached rows should be computed client-side from the hook's data (move the StatGrid into a small client wrapper) or shown as '—' while provenance!=='live'.
- **Acceptance:**
  - Mock loader source:'error' with empty cache: stat cards show '—' and a retry error state appears, no 'No records found'.
  - Error with cached rows: table shows rows plus 'Showing saved data ... could not refresh' badge, and no 'showing nothing' badge.
  - Healthy empty list still shows genuine 0 and the empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but decide stat behaviour for the cached case so figures do not disagree with the table.
- **Depends on:** RefreshErrorState, DataSourceBadge provenance

### GAP-INVENTORY-GOODS-RETURNS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Item, Store and Issue all print id.slice(0, 8) chips (GoodsReturnsTable.tsx:18,19,24); a QC inspector has to open the row to learn what item is being inspected.
- **Verified evidence:** GoodsReturnsTable.tsx:18,19,24 render r.itemId/storeId/originalIssueId .slice(0,8) in <code>. InventoryGoodsReturnRow (_data.ts:73-84) carries only ids, no names. Detail page (page.tsx:37-46) prints full UUIDs. Whether the API can embed item/store names is unknown (inventory-service absent).
- **Files to change:** `apps/web/src/app/(app)/inventory/GoodsReturnsTable.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`, `apps/web/src/app/(app)/inventory/goods-returns/[id]/page.tsx`
- **Fix steps:**
  1. Ask backend whether GET /api/v1/inventory/goods-returns can embed itemName/sku/storeName; otherwise resolve in the loader from getInventoryItems() (id->name/sku map) and a store lookup, without exceeding the 50-call pattern used in getInventorySubstitutes.
  2. Add itemName, sku, storeName to InventoryGoodsReturnRow and map them in _data.ts.
  3. Table: show 'SKU - name' in the Item column and store name; keep short id as a fallback tooltip only.
  4. Detail page: replace the three mono id fields with names, link Item to /inventory/[id].
- **Acceptance:**
  - Row for a known item shows its name/SKU, not 8 hex chars.
  - Unknown/deleted item falls back to short id without crashing.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Extra lookups add latency; cross-service reads must go via HTTP API, never joins.

### GAP-INVENTORY-GOODS-RETURNS-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** "Total Qty" sums qty across different items and units (page.tsx:12) — a number with no unit or meaning.
- **Verified evidence:** goods-returns/page.tsx:12 sums Number(r.qty) over all returns and shows it as 'Total Qty' (:28). Rows have no unit field (InventoryGoodsReturnRow), so the sum mixes items/UoMs; no per-item or unit context.
- **Files to change:** `apps/web/src/app/(app)/inventory/goods-returns/page.tsx`
- **Fix steps:**
  1. Remove the Total Qty StatCard, or replace with 'Units awaiting QC' only if all pending rows share a UoM.
  2. Prefer a more useful stat: oldest pending-QC age (from createdAt).
  3. If kept, add uom to the row (needs API) and group by unit.
- **Acceptance:**
  - Page no longer shows a unitless cross-item total.
  - Pending-QC age stat renders '—' on error.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /inventory/goods-returns/[id]  —  `inventory/goods-returns-detail.html`

- **Source:** `apps/web/src/app/(app)/inventory/goods-returns/[id]/page.tsx`
- **Design reference:** `redesign/inventory/goods-returns-detail.html`

### GAP-INVENTORY-GOODS-RETURNS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Verdict and disposition are independent (QcInspectionForm.tsx:24-25,72-98): a "Fail" can be recorded with disposition "restock", or a "Pass" with "scrap", and the only client-side rule is none — a failed-QC item could be returned to sellable stock.
- **Verified evidence:** QcInspectionForm.tsx:23-24 holds qcStatus and disposition as independent useState (defaults passed/restock); radios at :61-82, disposition <select> at :88-96 lists all three values regardless of verdict; handleSubmit :38-42 sends both unchecked. No cross-field rule client-side. Server-side rule cannot be checked (inventory-service is not in the snapshot; only hrms-service exists under services/).
- **Files to change:** `apps/web/src/app/(app)/inventory/goods-returns/[id]/QcInspectionForm.tsx`
- **Fix steps:**
  1. Add a helper allowedDispositions(qcStatus): passed -> ['restock'], failed -> ['quarantine','scrap'] (confirm the matrix with the store owner first).
  2. Derive the <option> list from allowedDispositions(qcStatus) and reset disposition to the first allowed value inside the qcStatus radio onChange handlers.
  3. Replace the default 'restock' with an empty placeholder and disable 'Record verdict' until a disposition is chosen.
  4. Add the same refine to the backend qcInspectionBody zod schema (reject failed+restock, passed+scrap) so the rule is not UI-only.
  5. Show a hint under the select explaining why options are limited.
- **Acceptance:**
  - Component test: choose Fail -> 'restock' option is absent and submit body never contains {qcStatus:'failed',disposition:'restock'}.
  - Component test: switching Fail->Pass resets a now-invalid disposition.
  - Backend test: PATCH /goods-returns/:id/inspect with failed+restock returns 400 (needs inventory-service).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Stock-integrity: wrong matrix could block a legitimate 'accept with concession' flow; agree the matrix (and 'conditional' status, which the mapper knows but the form never sends) before shipping.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-DETAIL-02

### GAP-INVENTORY-GOODS-RETURNS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme I18N

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Labels do not match values: "restock" is labelled "Return to vendor / restock" and "quarantine" "Accept with penalty (quarantine)" (QcInspectionForm.tsx:17-21); the comment admits the backend has no return-to-vendor or accept-with-penalty value, so the recorded disposition misstates what happened.
- **Verified evidence:** QcInspectionForm.tsx:8-19: DISPOSITIONS labels 'restock' as 'Return to vendor / restock' and 'quarantine' as 'Accept with penalty (quarantine)'; the header comment (:9-13) states the backend enum has only restock|quarantine|scrap. Detail page (page.tsx:67) and list table (GoodsReturnsTable.tsx:23) then render the raw value via StatusPill ('Restock'/'Quarantine'), so the record afterwards contradicts what the inspector picked. Backend enum itself not verifiable here (mapper set at apiMappers.ts:419 agrees).
- **Files to change:** `apps/web/src/app/(app)/inventory/goods-returns/[id]/QcInspectionForm.tsx`, `services/inventory-service/src/**/validators.ts (not in snapshot)`
- **Fix steps:**
  1. Decide: either add real 'return_to_vendor' and 'accept_with_penalty' dispositions to the backend enum + mapper set (apiMappers.ts:419) or relabel to the truthful values (Restock to stock / Quarantine / Scrap).
  2. Until the backend changes, set labels to exactly what is stored and drop the 'Return to vendor' and 'penalty' wording.
  3. Render the same label map on the detail page (page.tsx:67) and table (GoodsReturnsTable.tsx:23) via a shared DISPOSITION_LABELS const, passing label to StatusPill.
  4. If penalty is real, capture penalty amount as paise bigint with currency (CLAUDE.md rule 11) in a separate task.
- **Acceptance:**
  - Selecting each option stores and re-displays the same wording on detail and list.
  - No UI string claims a disposition the API cannot persist.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Business semantics: a return-to-vendor recorded as restock may put rejected stock back on hand; needs product sign-off.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-DETAIL-01

### GAP-INVENTORY-GOODS-RETURNS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Outage shows "Goods return not found … or you don't have access" (page.tsx:6,11-22): only .data is read from getGoodsReturnById, so a failed fetch is indistinguishable from a missing/forbidden record.
- **Verified evidence:** goods-returns/[id]/page.tsx:7 destructures only {data}; :9-20 shows EmptyState 'not found ... or you don't have access' whenever data is null. fetchJson returns {source:'error', status, errorMessage} with empty=null on any failure (apiClient.ts:125-144), so a 500/timeout/403 is rendered as not found. Also returns HTTP 200, not notFound().
- **Files to change:** `apps/web/src/app/(app)/inventory/goods-returns/[id]/page.tsx`
- **Fix steps:**
  1. Capture the full result: const result = await getGoodsReturnById(params.id).
  2. If result.source==='error' render <LoadErrorState result={result} area='goods return' backHref='/inventory/goods-returns' /> (already handles 403 vs transient; used for detail pages).
  3. Only when source==='api' and data is null render the not-found EmptyState (or call notFound() when result.status===404).
  4. Keep the existing PageHeader back link in every branch.
- **Acceptance:**
  - Mock fetch 500 -> page shows retry error state, not 'not found'.
  - Mock 403 -> permission-denied state.
  - Mock 404/null -> 'Goods return not found'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational only.
- **Depends on:** LoadErrorState

### GAP-INVENTORY-GOODS-RETURNS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** Irreversible verdict is submitted immediately with no ConfirmDialog (QcInspectionForm.tsx:33-52), unlike the cycle-count approve on a sibling route; on success router.push to the same URL gives no success message.
- **Verified evidence:** QcInspectionForm.tsx:30-55 posts PATCH .../inspect directly on submit with no ConfirmDialog; success does router.push to the same URL + router.refresh() (:49-50) with no toast, though the refreshed page flips to the read-only verdict (page.tsx:59-82), giving implicit feedback. Sibling CycleCountActions.tsx uses ActionButton (ConfirmDialog, requireReason). 'Irreversible' is unverified: the form is only shown while qcStatus==='pending' (page.tsx:86) so the UI cannot re-inspect, but backend re-inspect rules are not visible. Maker!=checker and audit event are backend concerns and not verifiable here (no inventory-service).
- **Files to change:** `apps/web/src/app/(app)/inventory/goods-returns/[id]/QcInspectionForm.tsx`
- **Fix steps:**
  1. Replace the submit handler with a two-step flow: on submit open ConfirmDialog (ds/ConfirmDialog.tsx) summarising verdict + disposition (e.g. 'Record FAIL and scrap 12 units?').
  2. Make notes required (requireReason / min length) when qcStatus==='failed' or disposition==='scrap'.
  3. On success show a Toast (ds/Toast.tsx) before router.refresh(); drop the redundant router.push to the same URL.
  4. Backend (separate): enforce inspector != creator and emit the audit event via @civitasone/events.
- **Acceptance:**
  - Clicking Record verdict opens a dialog; Cancel sends no request.
  - Failed verdict with empty notes cannot be confirmed.
  - After confirm a success toast shows and page shows verdict.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Affects stock state; maker-checker rule needs the role model confirmed with the backend team.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-DETAIL-01


---
## /inventory/issues  —  `inventory/issues.html`

- **Source:** `apps/web/src/app/(app)/inventory/issues/page.tsx`
- **Design reference:** `redesign/inventory/issues.html`

### GAP-INVENTORY-ISSUES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (issues/page.tsx:20-26); the page badge is the legacy source-only DataSourceBadge while MovementsTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** issues/page.tsx:10-12,23-24 derive Issue Lines and Total Qty from ledger=[] on failure, so StatCards read 0; MovementsTable.tsx:29-34 uses useSeededResource (cache fallback) and :36 filters client-side. Page badge (:20) is legacy source-only, so it can say 'showing nothing' over cached rows. Badge does render on error, so not fully silent.
- **Files to change:** `apps/web/src/app/(app)/inventory/issues/page.tsx`, `apps/web/src/app/(app)/inventory/receipts/page.tsx`, `apps/web/src/app/(app)/inventory/MovementsTable.tsx`
- **Fix steps:**
  1. In issues/page.tsx (and receipts/page.tsx, shared): keep result=await loader(); compute derived stats only when source!=='error', otherwise pass null to StatCard (StatCard.tsx displayValue already renders '—' for null).
  2. Remove the page-level legacy <DataSourceBadge source='error'> (it cannot know about cached rows).
  3. In MovementsTable.tsx: destructure provenance from useSeededResource and render <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> above the table (same hook call, per UX-002 note in DataSourceBadge.tsx).
  4. When provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'stock ledger'})} backHref='/inventory' /> instead of DataTable so it is not shown as 'No records found'.
  5. Stats that must reflect cached rows should be computed client-side from the hook's data (move the StatGrid into a small client wrapper) or shown as '—' while provenance!=='live'.
- **Acceptance:**
  - Mock loader source:'error' with empty cache: stat cards show '—' and a retry error state appears, no 'No records found'.
  - Error with cached rows: table shows rows plus 'Showing saved data ... could not refresh' badge, and no 'showing nothing' badge.
  - Healthy empty list still shows genuine 0 and the empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but decide stat behaviour for the cached case so figures do not disagree with the table.
- **Depends on:** RefreshErrorState, DataSourceBadge provenance, GAP-INVENTORY-RECEIPTS-01

### GAP-INVENTORY-ISSUES-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Ledger is fetched with limit=200 and filtered to "issue" in the browser (page.tsx:11; _data.ts:135) — issue lines and Total Qty Issued silently cover only the newest 200 movements of all types.
- **Verified evidence:** _data.ts:135 fetches /api/v1/inventory/ledger?limit=200 with no movementType filter; issues/page.tsx:11 and MovementsTable.tsx:36 filter for 'issue' in the browser; so Issue Lines/Total Qty cover issues within the newest 200 movements only, and no 'showing first N' hint. Whether the API supports ?movementType= / pagination / totals is unknown (inventory-service absent).
- **Files to change:** `apps/web/src/app/(app)/inventory/_data.ts`, `apps/web/src/app/(app)/inventory/issues/page.tsx`, `apps/web/src/app/(app)/inventory/MovementsTable.tsx`
- **Fix steps:**
  1. Confirm with backend that ledger accepts movementType (or add it) plus offset/cursor and a totals endpoint.
  2. Add getInventoryLedger({movementType,page}) passing the filter server-side; keep default limit.
  3. Compute stats from server totals rather than the fetched page; if impossible, show 'Showing latest 200' notice when result length===200.
  4. Pass server pagination into DataTable instead of client-only pageSize.
- **Acceptance:**
  - With 500 seeded ledger rows of mixed types, Issue Lines equals the true issue count.
  - If capped, a visible 'latest 200' notice appears.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Totals shown to storekeepers may currently under-report; changing definitions changes numbers users have seen.
- **Depends on:** GAP-INVENTORY-RECEIPTS-02

### GAP-INVENTORY-ISSUES-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Item is an 8-char UUID chip (MovementsTable.tsx:45); the Type column repeats the single filtered value "issue" on every row and the store, reasonCode and indent reference the hub promises ("against indents") are not shown.
- **Verified evidence:** MovementsTable.tsx:45 renders itemId.slice(0,8) in <code>; :50-58 Type column shows constant kind (filtered to one value); columns list has no store, reasonCode or indent ref although InventoryLedgerRow (_data.ts:24-37) carries storeId and reasonCode. Indent reference is not in the row type, so cannot be shown without an API field. Subtitle at issues/page.tsx:19 does say 'against indents'.
- **Files to change:** `apps/web/src/app/(app)/inventory/MovementsTable.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. Resolve item names via item-master map (getInventoryItems) or an API-embedded itemName; show 'SKU - name'.
  2. Drop the Type column for single-kind views (conditionally add it only for mixed views).
  3. Add Store and Reason (reasonCode) columns; request an indent/reference field from the backend before promising indent links.
  4. Adjust subtitle if no indent ref is available.
- **Acceptance:**
  - Issues table shows item name, store and reason; no repeated 'issue' column.
  - Unresolvable item falls back to short id.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-02


---
## /inventory/items  —  `inventory/items.html`

- **Source:** `apps/web/src/app/(app)/inventory/items/page.tsx`
- **Design reference:** `redesign/inventory/items.html`

### GAP-INVENTORY-ITEMS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (items/page.tsx:22-30); the page badge is the legacy source-only DataSourceBadge while ItemsTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** items/page.tsx:10-14,25-28 stats (Total, Active, Consumables, Reorder Tracked) are computed from items=[] on failure -> 0; ItemsTable.tsx:45-50 uses useSeededResource; page badge :22 is the legacy source-only one.
- **Files to change:** `apps/web/src/app/(app)/inventory/items/page.tsx`, `apps/web/src/app/(app)/inventory/ItemsTable.tsx`
- **Fix steps:**
  1. In items/page.tsx: keep result=await loader(); compute derived stats only when source!=='error', otherwise pass null to StatCard (StatCard.tsx displayValue already renders '—' for null).
  2. Remove the page-level legacy <DataSourceBadge source='error'> (it cannot know about cached rows).
  3. In ItemsTable.tsx: destructure provenance from useSeededResource and render <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> above the table (same hook call, per UX-002 note in DataSourceBadge.tsx).
  4. When provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'item master'})} backHref='/inventory' /> instead of DataTable so it is not shown as 'No records found'.
  5. Stats that must reflect cached rows should be computed client-side from the hook's data (move the StatGrid into a small client wrapper) or shown as '—' while provenance!=='live'.
- **Acceptance:**
  - Mock loader source:'error' with empty cache: stat cards show '—' and a retry error state appears, no 'No records found'.
  - Error with cached rows: table shows rows plus 'Showing saved data ... could not refresh' badge, and no 'showing nothing' badge.
  - Healthy empty list still shows genuine 0 and the empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but decide stat behaviour for the cached case so figures do not disagree with the table.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-01

### GAP-INVENTORY-ITEMS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Demand Forecast column reads (row as Record).demandForecast (ItemsTable.tsx:27-30) but InventoryItemRow has no such field and getInventoryItems maps the response with plain listOf (_data.ts:126-132); unless the API embeds it the column is empty for every row.
- **Verified evidence:** ItemsTable.tsx:26-41 reads (r as Record).demandForecast via an unsafe cast and returns null when absent; InventoryItemRow (_data.ts:11-22) has no such field and getInventoryItems maps with listOf (_data.ts:126-132, no transformation). grep finds demandForecast nowhere else in apps/web/src, so nothing populates it client-side; whether the API embeds it cannot be verified (inventory-service absent). Forecast is available only via a per-item endpoint (getInventoryItemForecast, _data.ts:206).
- **Files to change:** `apps/web/src/app/(app)/inventory/ItemsTable.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. Ask backend whether GET /items includes demandForecast; if not, remove the column and the cast in ItemsTable.tsx.
  2. If wanted, add an optional typed field to InventoryItemRow and validate it in a mapper (no Record cast).
  3. Alternative: link each row to the item detail where getInventoryItemForecast already exists, instead of 50 per-row calls.
- **Acceptance:**
  - Column no longer renders as an always-empty header (or shows real badges).
  - tsc passes with no `as Record` cast.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-INVENTORY-ITEMS-03  ·  LOW  ·  partly  ·  theme WIRING

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** reorderQty is fetched but never shown; no create/edit control though /stock/items-new exists in the Stock module.
- **Verified evidence:** reorderQty is typed in InventoryItemRow (_data.ts:20) and unused in ItemsTable columns (:17-42): confirmed. No create/edit control on the page. But the referenced route is /stock/items/new (apps/web/src/app/(app)/stock/items/new/page.tsx), not /stock/items-new, and per the note in inventory/[id]/page.tsx the /stock/* -> /inventory/* redirect lives in next.config (not in the snapshot), so whether that create page is reachable could not be verified.
- **Files to change:** `apps/web/src/app/(app)/inventory/ItemsTable.tsx`, `apps/web/src/app/(app)/inventory/items/page.tsx`
- **Fix steps:**
  1. Add a 'Reorder Qty' column next to Reorder Level (align right).
  2. Add a 'New item' action in PageHeader actions linking to the item-create page, gated by the appropriate role; confirm the final route first.
  3. Optionally link rows to the item detail.
- **Acceptance:**
  - Reorder Qty column shows values.
  - 'New item' visible only to permitted roles and opens the create form.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Confirm route survives the /stock redirect.


---
## /inventory/list  —  `inventory/list.html`

- **Source:** `apps/web/src/app/(app)/inventory/list/page.tsx`
- **Design reference:** `redesign/inventory/list.html`

### GAP-INVENTORY-LIST-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch renders zero SKUs, zero value and "No stock items found — Add stock items to track inventory levels" (page.tsx:40-46; client:44-48) under a small badge; an outage reads as an unstocked store.
- **Verified evidence:** list/page.tsx:23-29 default items=[] on failure -> Total SKUs 0, Low Stock 0, formatMoney(0); InventoryStockListClient.tsx:55-61 shows EmptyState 'No stock items found - Add stock items to track inventory levels' when items.length===0; only a small legacy badge (:40) hints at the error. No cache fallback on this page.
- **Files to change:** `apps/web/src/app/(app)/inventory/list/page.tsx`, `apps/web/src/app/(app)/inventory/list/InventoryStockListClient.tsx`
- **Fix steps:**
  1. Keep result=await getStockItems(); if source==='error' render <RefreshErrorState error={toHumanError('load',{area:'stock items'})} backHref='/inventory'/> in place of stats + register (or pass null stats -> '—').
  2. Pass a `failed` prop to InventoryStockListClient so it never shows the 'Add stock items' empty state on failure.
  3. Format Stock Value with '—' when errored.
  4. Remove page-level badge once the error state is in place.
- **Acceptance:**
  - Mock /stock/items 500: no zero stats, no 'Add stock items' copy, Retry visible.
  - Genuinely empty list still shows the empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-INVENTORY-LIST-02  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** — PR #1844 (merged)
- **First-pass claim:** Item rows link to /stock/{id} (client:65) and the page reads /api/v1/stock/items while its sibling Item Master reads /api/v1/inventory/items — two item masters with different fields; navigation depends on a /stock→/inventory redirect (detail page comment, [id]/page.tsx:20-30).
- **Verified evidence:** InventoryStockListClient.tsx:65 sets rowLinkPrefix='/stock/'; list/page.tsx:24 reads getStockItems -> /api/v1/stock/items (loaders.ts:3891), while items/page.tsx reads /api/v1/inventory/items (_data.ts:127); field sets differ (stock: itemCode/currentStock/minStockLevel; inventory: sku/reorderLevel/itemType). inventory/[id]/page.tsx:17-30 comment says next.config permanently redirects /stock/:path* to /inventory/:path* so the link works via an extra hop. next.config is not in the snapshot, so the redirect is unverified; and whether the two endpoints share one item master server-side cannot be checked.
- **Files to change:** `apps/web/src/app/(app)/inventory/list/InventoryStockListClient.tsx`, `apps/web/src/app/(app)/inventory/list/page.tsx`
- **Fix steps:**
  1. Change rowLinkPrefix to '/inventory/' (page inventory/[id]/page.tsx exists) to drop the redirect hop.
  2. Confirm with backend whether /stock/items and /inventory/items are the same master; if yes, migrate list to getInventoryItems + stock levels and delete the duplicate loader/mapper.
  3. If different by design, label the pages distinctly (Item Master vs Stock Levels).
- **Acceptance:**
  - Clicking a row goes directly to /inventory/<id> with no redirect.
  - Item counts agree between Item Master and Stock Items for the same tenant.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low for the link change; data consolidation is a backend/product decision.

### GAP-INVENTORY-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Cycle-count queue prints Item and Warehouse as raw ids (page.tsx:13-14) and its source is ignored (page.tsx:23-26), so a failed count fetch silently hides work awaiting approval.
- **Verified evidence:** list/page.tsx:11-20 columns for itemId/warehouseId have no render, so raw full UUIDs print (not 8-char); :23-26 destructures only data from getInventoryCycleCounts, and :48 renders the card only when length>0, so a failed fetch hides pending approvals with no message.
- **Files to change:** `apps/web/src/app/(app)/inventory/list/page.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. Destructure the second result's source; if 'error' render a small RefreshErrorState/inline notice in the 'Cycle counts pending approval' card slot.
  2. Add itemName/warehouseName via item-master lookup (as GOODS-RETURNS-02) or API embed; render SKU-name and warehouse name.
  3. Keep ids only in the row link (rowLinkPrefix).
- **Acceptance:**
  - Cycle-count fetch 500: card shows 'Couldn't load pending approvals' with Retry.
  - Rows show item and warehouse names.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Pending approvals are approval work; silent hiding delays stock adjustments.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-02, GAP-INVENTORY-LIST-01


---
## /inventory/low-stock  —  `inventory/low-stock.html`

- **Source:** `apps/web/src/app/(app)/inventory/low-stock/page.tsx`
- **Design reference:** `redesign/inventory/low-stock.html`

### GAP-INVENTORY-LOW-STOCK-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (low-stock/page.tsx:19-25); the page badge is the legacy source-only DataSourceBadge while LowStockTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** low-stock/page.tsx:10-11,22-23 compute Items Low and Total Suggested Reorder from rows=[] on failure -> 0; LowStockTable.tsx:26-31 has cache fallback; page badge :19 is the legacy one.
- **Files to change:** `apps/web/src/app/(app)/inventory/low-stock/page.tsx`, `apps/web/src/app/(app)/inventory/LowStockTable.tsx`
- **Fix steps:**
  1. In low-stock/page.tsx: keep result=await loader(); compute derived stats only when source!=='error', otherwise pass null to StatCard (StatCard.tsx displayValue already renders '—' for null).
  2. Remove the page-level legacy <DataSourceBadge source='error'> (it cannot know about cached rows).
  3. In LowStockTable.tsx: destructure provenance from useSeededResource and render <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> above the table (same hook call, per UX-002 note in DataSourceBadge.tsx).
  4. When provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:'low-stock alerts'})} backHref='/inventory' /> instead of DataTable so it is not shown as 'No records found'.
  5. Stats that must reflect cached rows should be computed client-side from the hook's data (move the StatGrid into a small client wrapper) or shown as '—' while provenance!=='live'.
- **Acceptance:**
  - Mock loader source:'error' with empty cache: stat cards show '—' and a retry error state appears, no 'No records found'.
  - Error with cached rows: table shows rows plus 'Showing saved data ... could not refresh' badge, and no 'showing nothing' badge.
  - Healthy empty list still shows genuine 0 and the empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but decide stat behaviour for the cached case so figures do not disagree with the table.
- **Depends on:** GAP-INVENTORY-GOODS-RETURNS-01

### GAP-INVENTORY-LOW-STOCK-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** A failed fetch and a healthy store both render 0 low items — the worst place for a silent zero, since "no alerts" is the reassuring reading (page.tsx:19-24).
- **Verified evidence:** Same root as -01: low-stock/page.tsx:22 shows 'Items Low' = rows.length = 0 on both failure and healthy states, and LowStockTable renders empty DataTable. The failure badge (:19) exists but is small and the 0 alongside reads as all-clear.
- **Files to change:** `apps/web/src/app/(app)/inventory/low-stock/page.tsx`, `apps/web/src/app/(app)/inventory/LowStockTable.tsx`
- **Fix steps:**
  1. Pass value={source==='error' ? null : rows.length} to both StatCards ('—').
  2. In LowStockTable show a positive empty state 'No items below reorder level' only when provenance==='live', and RefreshErrorState when 'error-no-data'.
  3. Apply the shared pattern from GAP-INVENTORY-LOW-STOCK-01.
- **Acceptance:**
  - Error: '—' and retry state, never 'No items below reorder'.
  - Live empty: reassuring empty message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-INVENTORY-LOW-STOCK-01

### GAP-INVENTORY-LOW-STOCK-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** No action from a reorder alert: no "Raise indent / PO" link and no store column although the row is keyed by (itemId, storeId) (LowStockTable.tsx:16-23); status pill is constant so it carries no information.
- **Verified evidence:** LowStockTable.tsx:16-23 columns: SKU, Name, On Hand, Reorder Level, Suggested Reorder, and a Status column whose render ignores the row and always returns StatusPill breached 'LOW' (:22). storeId is in InventoryLowStockRow (_data.ts:39-47) but not shown; no rowHref or action. No link to indent/PO creation exists on this page; route names for those actions are not verifiable from this module.
- **Files to change:** `apps/web/src/app/(app)/inventory/LowStockTable.tsx`, `apps/web/src/app/(app)/inventory/low-stock/page.tsx`
- **Fix steps:**
  1. Add a Store column (name via lookup, else short id).
  2. Replace the constant pill with severity computed from onHandQty/reorderLevel (e.g. 'Out of stock' when 0, 'Critical' <=50%, 'Low').
  3. Add a per-row action 'Raise indent' linking to the indent-create route with itemId/storeId/suggestedReorderQty prefilled (confirm target route with procurement owner).
  4. Add rowHref to item detail /inventory/{itemId}.
- **Acceptance:**
  - Row with onHand 0 shows 'Out of stock'; row at 80% shows 'Low'.
  - Raise-indent link opens prefilled form.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Prefilled quantities feed procurement; confirm suggestedReorderQty semantics.


---
## /inventory/receipts  —  `inventory/receipts.html`

- **Source:** `apps/web/src/app/(app)/inventory/receipts/page.tsx`
- **Design reference:** `redesign/inventory/receipts.html`

### GAP-INVENTORY-RECEIPTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (receipts/page.tsx:20-26); the page badge is the legacy source-only DataSourceBadge while MovementsTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** receipts/page.tsx:10-12,23-24 compute Receipt Lines/Total Qty Received from ledger=[] on failure -> 0; same MovementsTable cache/badge mismatch as Issues (MovementsTable.tsx:29-34; badge at receipts/page.tsx:20).
- **Files to change:** `apps/web/src/app/(app)/inventory/receipts/page.tsx`, `apps/web/src/app/(app)/inventory/MovementsTable.tsx`
- **Fix steps:**
  1. Same change as GAP-INVENTORY-ISSUES-01 (shared MovementsTable + both pages).
  2. In receipts/page.tsx: keep result=await loader(); compute derived stats only when source!=='error', otherwise pass null to StatCard (StatCard.tsx displayValue already renders '—' for null).
  3. Remove the page-level legacy <DataSourceBadge source='error'> (it cannot know about cached rows).
  4. In MovementsTable.tsx: destructure provenance from useSeededResource and render <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> above the table (same hook call, per UX-002 note in DataSourceBadge.tsx).
- **Acceptance:**
  - Mock loader source:'error' with empty cache: stat cards show '—' and a retry error state appears, no 'No records found'.
  - Error with cached rows: table shows rows plus 'Showing saved data ... could not refresh' badge, and no 'showing nothing' badge.
  - Healthy empty list still shows genuine 0 and the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** As Issues; implement once for both pages.
- **Depends on:** GAP-INVENTORY-ISSUES-01

### GAP-INVENTORY-RECEIPTS-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** Same limit=200 unfiltered ledger fetch as Issues (page.tsx:11) — receipt totals are only for the newest 200 movements of all types, with no "showing first N" hint.
- **Verified evidence:** Ledger fetched via getInventoryLedger with fixed ?limit=200 (_data.ts:135) and filtered to 'receipt' client-side (receipts/page.tsx:11, MovementsTable.tsx:36); no cap notice. Description says 'page.tsx:11' which is right.
- **Files to change:** `apps/web/src/app/(app)/inventory/_data.ts`, `apps/web/src/app/(app)/inventory/receipts/page.tsx`
- **Fix steps:**
  1. Implement together with GAP-INVENTORY-ISSUES-02: server-side movementType filter, pagination and totals; show 'latest 200' notice as interim.
- **Acceptance:**
  - 500 mixed rows: Receipt Lines equals true total.
  - Interim notice appears when length===200.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** As Issues-02.
- **Depends on:** GAP-INVENTORY-ISSUES-02

### GAP-INVENTORY-RECEIPTS-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** No GRN / PO / supplier reference column though the subtitle says "GRN-in" (MovementsTable.tsx:43-60); the Type pill is constant "receipt" on every row.
- **Verified evidence:** MovementsTable.tsx:43-59 has Date, Item, Qty In, Balance, Rate, Value, Type; no GRN/PO/supplier column, and Type is constant 'receipt' in receipts view. The subtitle (receipts/page.tsx:19) says 'GRN-in'. But InventoryLedgerRow (_data.ts:24-37) has movementId and no PO/supplier field, so the columns cannot be added without an API change; the mislabel is the subtitle, not a missing mapping. Money uses formatMoney on minor units, fine.
- **Files to change:** `apps/web/src/app/(app)/inventory/MovementsTable.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`, `apps/web/src/app/(app)/inventory/receipts/page.tsx`
- **Fix steps:**
  1. Ask backend to expose GRN number / PO id / supplier on ledger rows (or a joined receipts endpoint).
  2. Map new fields in InventoryLedgerRow and add 'GRN / PO' column (link to procurement PO via id).
  3. Hide the Type column in single-kind mode.
  4. Until the API ships, reword subtitle to avoid promising GRN references.
- **Acceptance:**
  - Receipt row shows GRN and PO when present, '—' otherwise.
  - No constant Type column.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Cross-service data must come via API/events, not joins.
- **Depends on:** GAP-INVENTORY-ISSUES-03


---
## /inventory/reconcile  —  `inventory/reconcile.html`

- **Source:** `apps/web/src/app/(app)/inventory/reconcile/page.tsx`
- **Design reference:** `redesign/inventory/reconcile.html`

### GAP-INVENTORY-RECONCILE-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** It does not reconcile: Net = in − out + adjustments (page.tsx:29-32) is computed from the ledger alone and never compared to a physical count or the item balance, so "verify ledger balance" (subtitle) cannot ever show a discrepancy.
- **Verified evidence:** reconcile/page.tsx:23-30: totalIn (receipts), totalOut (issues), totalAdjusted (adjustments) come from getStockLedger (/api/v1/stock/ledger, loaders.ts:3907); Net Balance = in - out + adjustments is derived from the same ledger and is never compared to item balances (currentStock in getStockItems) or physical counts (cycle-counts). Subtitle (:44) promises to 'verify ledger balance'. Transfers are excluded from all stats. Error state is already handled correctly (:48-54, UX-013).
- **Files to change:** `apps/web/src/app/(app)/inventory/reconcile/page.tsx`, `apps/web/src/app/(app)/inventory/reconcile/StockLedgerTable.tsx`
- **Fix steps:**
  1. Load getStockItems() (or inventory items) and cycle-counts in parallel with the ledger.
  2. Per item compute ledger net vs onHand and flag rows where they differ (a Variance column + 'Discrepancies' StatCard); use the last ledger balance (entry.balance) as an alternative check.
  3. Optionally show latest cycle count physicalQty vs ledger balance.
  4. If reconciliation is out of scope, retitle the page 'Stock movements summary' and reword subtitle.
- **Acceptance:**
  - Seed item with onHand 10 but ledger net 8: page lists it as a discrepancy of 2.
  - Balanced data shows 0 discrepancies.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Product definition of 'reconcile' is needed; wrong logic could give false assurance to auditors.
- **Depends on:** GAP-INVENTORY-RECONCILE-02

### GAP-INVENTORY-RECONCILE-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Adjustments are always added (page.tsx:31) and the mapper stores qtyIn>0 ? qtyIn : qtyOut as an unsigned quantity, mapping unknown voucherTypes to "receipt" (apiMappers.ts:973-979): a stock-reducing adjustment inflates Net Balance and displays as "▲ +qty".
- **Verified evidence:** apiMappers.ts:971-978: quantity = qtyIn>0 ? qtyIn : qtyOut (unsigned); type from voucherType, anything not issue/transfer/adjustment becomes 'receipt' (default at :974). reconcile/page.tsx:29-30 always adds adjustments; StockLedgerTable.tsx:47-48 shows '+' for every non-issue (adjustments and transfers included) with green up-arrow. So a negative adjustment (qtyOut>0) is added to Net and displayed as +qty. Whether the API actually emits adjustment rows with qtyOut is not verifiable (backend absent) but the code path is real.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/inventory/reconcile/page.tsx`, `apps/web/src/app/(app)/inventory/reconcile/StockLedgerTable.tsx`
- **Fix steps:**
  1. In mapStockLedgerEntries add signedQuantity = qtyIn - qtyOut and keep quantity as absolute; add direction 'in'|'out'.
  2. reconcile/page.tsx: totalAdjusted = sum(signedQuantity); use signedQuantity for Net; count transfers separately.
  3. StockLedgerTable: derive sign/arrow/colour from signedQuantity, not from type==='issue'.
  4. Log/flag unknown voucherType instead of defaulting to 'receipt'.
  5. Add unit tests for the mapper.
- **Acceptance:**
  - Mapper test: {voucherType:'adjustment',qtyOut:5} -> signedQuantity -5.
  - Page test: receipts 10, issues 3, adjustment -2 => Net 5; row shows '- 2'.
  - Unknown voucherType is not counted as receipt.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Stock quantities shown to auditors; fix mapper carefully since stock detail page also uses mapStockLedgerEntries.

### GAP-INVENTORY-RECONCILE-03  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** Item Code is itemId.slice(0, 8).toUpperCase() from the mapper (apiMappers.ts:983), i.e. a UUID fragment, not the SKU shown on Stock Items; transfers are excluded from every stat.
- **Verified evidence:** apiMappers.ts:983 itemCode = itemId.slice(0,8).toUpperCase() (UUID fragment); and itemName falls back to id slice (:984); this is real. But StockLedgerTable.tsx:29 labels it 'Item Code' and page comment claims mapper is correct. Transfers are excluded from stats (page.tsx:23-30) - true, but only receipts/issues/adjustments are summed by design. Whether the ledger payload carries the SKU cannot be verified.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/inventory/reconcile/page.tsx`
- **Fix steps:**
  1. Ask backend to include sku/itemCode/itemName on /stock/ledger rows; map row.sku ?? row.itemCode before falling back to id.
  2. Otherwise join with getStockItems by itemId in the page.
  3. Add 'Transfers' count StatCard or a note that transfers are net-zero and excluded.
- **Acceptance:**
  - Ledger row shows SKU matching Stock Items page.
  - Transfers count visible.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-INVENTORY-RECONCILE-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** Hand-built breadcrumb uses var(--ink2) and className "crumbs"/"wrap", unlike the sibling back-link nav (page.tsx:34-40) — inconsistent within the module; ledger has no date range or store filter, and no export for audit.
- **Verified evidence:** Breadcrumb at reconcile/page.tsx:36-40 is hand-built (className 'crumbs', var(--ink2), Link) while sibling pages use <nav className='back'> with ArrowLeft (e.g. issues/page.tsx:16-18) or PageHeader back prop: confirmed. StockLedgerTable has no date-range/store filters (only text filter, :79-80) and no export: confirmed. The theme tag PII is wrong: nothing here is personal data or a secret.
- **Files to change:** `apps/web/src/app/(app)/inventory/reconcile/page.tsx`, `apps/web/src/app/(app)/inventory/reconcile/StockLedgerTable.tsx`
- **Fix steps:**
  1. Replace hand-built nav with PageHeader back='/inventory' (or the shared back nav used by siblings) and drop inline var(--ink2) style.
  2. Add date-range and store filter controls (server params if getStockLedger supports them).
  3. Add a CSV export using existing PrintExportButton/export helper (stock/_components/PrintExportButton), emitting an audit event server-side.
- **Acceptance:**
  - Breadcrumb matches siblings visually.
  - Filtering by date narrows rows and stats.
  - Export downloads visible rows.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Export of stock ledger is business data, not PII; log the export.


---
## /inventory/reservations  —  `inventory/reservations.html`

- **Source:** `apps/web/src/app/(app)/inventory/reservations/page.tsx`
- **Design reference:** `redesign/inventory/reservations.html`

### GAP-INVENTORY-RESERVATIONS-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (reservations/page.tsx:23-30); the page badge is the legacy source-only DataSourceBadge while ReservationsTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** reservations/page.tsx:10-12 computes stats from the loader data, which is [] on failure, so StatCards (l.28-30) show 0. A legacy DataSourceBadge source="error" IS rendered (l.24) so it is not silent, but the copy is "Couldn't load — showing nothing" while ReservationsTable.tsx:34-39 (useSeededResource) may render cached rows underneath (UX-002 mismatch). No RefreshErrorState; table empty text is DataTable default 'No records found'.
- **Files to change:** `apps/web/src/app/(app)/inventory/reservations/page.tsx`
- **Fix steps:**
  1. In page.tsx compute errored = source === "error".
  2. When errored, render <RefreshErrorState error={toHumanError("load",{area:"stock reservations"})} /> (pattern in knowledge/dashboard/page.tsx:137) instead of the StatGrid/Card, or pass "—" to the three StatCard values.
  3. Drop the standalone DataSourceBadge at l.24; move badge into ReservationsTable using the provenance prop from useSeededResource (see ModuleListTable.tsx:33) so cached rows are described honestly.
  4. If offline cache should still show rows, keep the table but suppress the zero stats (show "—").
- **Acceptance:**
  - Component test: mock getInventoryReservations to {data:[],source:"error"}; expect no '0' stat values and a retry control.
  - With cached rows present and error, badge reads 'Showing saved data…', not 'showing nothing'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only. Do not hide cached rows when offline.
- **Depends on:** RefreshErrorState

### GAP-INVENTORY-RESERVATIONS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** "Total Qty Held" sums qty of every reservation regardless of status (page.tsx:12), so released and expired holds inflate the number while the subtitle says it reduces available-to-promise.
- **Verified evidence:** page.tsx:12 sums Number(r.qty) over ALL reservations with no status filter; only `active` is counted separately (l.11). Released/expired/consumed holds inflate 'Total Qty Held' though the subtitle (l.20) says it reduces available-to-promise. Status value set for InventoryReservationRow.status is untyped string (_data.ts:68).
- **Files to change:** `apps/web/src/app/(app)/inventory/reservations/page.tsx`
- **Fix steps:**
  1. Change the reduce to sum qty only where r.status === "active" (same predicate as `active`).
  2. Rename label to 'Qty Held (active)' or keep label and add sublabel.
  3. Extract predicate into a small helper isActiveReservation(r) reused by both stats and a unit test.
  4. Confirm with inventory-service owner the exact status strings (cannot see inventory-service in snapshot).
- **Acceptance:**
  - Unit test: rows [{qty:5,status:'active'},{qty:3,status:'released'}] -> Total Qty Held 5.
  - Active count and held qty agree with filtered table.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; backend status enum unverified (inventory-service absent), so the 'active' literal is assumed as already used at l.11.

### GAP-INVENTORY-RESERVATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** Ref is refId.slice(0, 8) beside a refType (ReservationsTable.tsx:21) — not a link to the indent/PO; item/store are UUID chips (lines 17-18).
- **Verified evidence:** ReservationsTable.tsx:17,18,21 render itemId, storeId and refId as <code>{id.slice(0,8)}</code>; refType is plain text (l.20). No links. The row has no item/store name fields (_data.ts:61-71). An item detail route exists at inventory/[id]/page.tsx and items name is available from getInventoryItems (InventoryItemRow.name).
- **Files to change:** `apps/web/src/app/(app)/inventory/ReservationsTable.tsx`, `apps/web/src/app/(app)/inventory/reservations/page.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. In page.tsx also call getInventoryItems() (already exists in _data.ts) and pass an itemNames map to ReservationsTable.
  2. Render Item column as <Link href={`/inventory/${r.itemId}`}>{name ?? short id}</Link>.
  3. Ref column: map refType (indent/PO) to a link only if a detail route exists for it; otherwise show refType + short id as text with title attribute holding full id.
  4. Store column: no store list loader seen in inventory/_data.ts; show name only if a loader is added, else keep short id (cannot-verify store name endpoint).
- **Acceptance:**
  - Item cell shows item name and links to /inventory/<id>.
  - Rows with unknown item id still render fallback short id without crashing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; extra items fetch adds one request per page load.


---
## /inventory/substitutes  —  `inventory/substitutes.html`

- **Source:** `apps/web/src/app/(app)/inventory/substitutes/page.tsx`
- **Design reference:** `redesign/inventory/substitutes.html`

### GAP-INVENTORY-SUBSTITUTES-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Failed fetch reads as an empty, healthy store: stats are computed from [] so every StatCard shows 0 and the table shows the neutral "No records found" (substitutes/page.tsx:26-33); the page badge is the legacy source-only DataSourceBadge while SubstitutesTable.tsx renders from useSeededResource, so the badge can say "showing nothing" over cached rows (DataSourceBadge.tsx UX-002 note).
- **Verified evidence:** substitutes/page.tsx:9-14 stats derived from data that is [] on error (getInventorySubstitutes returns {data:[],source:"error"} when items fail, _data.ts:236-239), so stats show 0 / 0.0 (l.28-30). Legacy DataSourceBadge source="error" is rendered (l.24), so failure is flagged, but with 'showing nothing' copy that can contradict SubstitutesTable.tsx:94-99 cached rows. No RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/inventory/substitutes/page.tsx`
- **Fix steps:**
  1. Compute errored = source === "error" in page.tsx.
  2. Render <RefreshErrorState> (toHumanError('load',{area:'item substitutes'})) or show "—" in the three StatCards when errored.
  3. Replace legacy badge with provenance-based badge inside SubstitutesTable (as in ModuleListTable.tsx:33).
  4. Avg Priority: show "—" when substitutes.length===0 instead of 0.0.
- **Acceptance:**
  - Test with source="error": no numeric stat values, retry visible.
  - Cached rows + error: message says saved data.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-INVENTORY-SUBSTITUTES-02

### GAP-INVENTORY-SUBSTITUTES-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was FAILMASK)

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** N+1 fan-out capped at items.slice(0, 50) (_data.ts:243,257): a tenant with more than 50 items silently loses substitutes for the rest, and source is "api" if any one call succeeds (anyApi), so partial failure shows no badge at all.
- **Verified evidence:** _data.ts:243-258: items.slice(0,50) then Promise.all of one fetch per item; rows flatMap'd; source = anyApi ? "api" : "error" (l.257-258), so a partial failure (or items beyond 50) yields source "api" with no badge and silently missing rows. Page (page.tsx:24) only shows a badge for source==="error". Also getInventoryItems has no limit param, so 50 is arbitrary. Note: the suggested fix text (RefreshErrorState) doesn't address the cap; a partial state is needed.
- **Files to change:** `apps/web/src/app/(app)/inventory/_data.ts`, `apps/web/src/app/(app)/inventory/substitutes/page.tsx`
- **Fix steps:**
  1. Extend the loader return to include {truncated:boolean, failedCount:number} (e.g. a local type extending LoaderResult).
  2. Set truncated = items.length > 50; failedCount = results.filter(r=>r.source==='error').length; source 'error' only when all fail.
  3. In page.tsx show a warning note 'Showing substitutes for first 50 of N items' and 'k items could not be loaded' when non-zero.
  4. Longer-term: ask backend for a tenant-wide GET /inventory/substitutes (cannot verify existence; inventory-service absent) and remove the fan-out.
- **Acceptance:**
  - Unit test loader with 60 items: truncated true, only 50 fetches.
  - With 1 of 3 fetches failing: warning shown, other rows visible.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; users may assume substitute coverage is complete when choosing replacements in shortages.
- **Depends on:** GAP-INVENTORY-SUBSTITUTES-01

### GAP-INVENTORY-SUBSTITUTES-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** Item and Substitute are both 8-char UUID chips (SubstitutesTable.tsx:17-18) — a substitute link cannot be read without a lookup; conversionFactor is a raw string.
- **Verified evidence:** SubstitutesTable.tsx:80,81 render itemId and substituteId as <code>{id.slice(0,8)}</code>, no names or links. conversionFactor (l.83, typed string in _data.ts:91) is rendered raw with right alignment, no numeric formatting. Item names are obtainable via getInventoryItems (already called by the loader) and item detail exists at inventory/[id].
- **Files to change:** `apps/web/src/app/(app)/inventory/SubstitutesTable.tsx`, `apps/web/src/app/(app)/inventory/substitutes/page.tsx`, `apps/web/src/app/(app)/inventory/_data.ts`
- **Fix steps:**
  1. Have getInventorySubstitutes return (or page fetch) the items list, build id->name map and pass to SubstitutesTable.
  2. Render Item and Substitute as <Link href={`/inventory/${id}`}>name</Link> with short id fallback.
  3. Format conversionFactor with Number() and a fixed max-decimal formatter (e.g. `1 : ${n}`), falling back to raw string if NaN.
  4. Add title/aria-label with full id for support.
- **Acceptance:**
  - Row shows item names, links go to /inventory/<id>.
  - conversionFactor '1.500000' shows '1.5'; non-numeric shows raw.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-INVENTORY-RESERVATIONS-03


---
## Backend verification items (service code absent from snapshot)

### GAP-INVENTORY-HOME-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** inventory-service is absent from the snapshot; forecast model and ordering are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/items/{id}/forecast?horizon=30', 'GET /api/v1/inventory/low-stock']`
- **Question:** GET /v1/inventory/items/:id/forecast must document its model, return dailyForecast[] of length horizon with an 'available' flag and confidence, and low-stock must be ordered by proximity to reorder point so the page's first row is truly the nearest.
- **How to verify:** In inventory-service open the forecast handler; curl low-stock and forecast?horizon=30 as inventory role, assert dailyForecast.length==30, numbers >=0, confidence in [0,1]; assert low-stock ordering matches (onHand-reorderLevel) ascending.
- **Test to add:** Given item with 90 days history, when GET forecast?horizon=30 then 200 with 30 non-negative numbers; for item with <N days history then available=false rather than fabricated series.
- **Impact if wrong:** Misleading demand chart drives wrong reorder decisions.
- **Web change if wrong:** Sort low-stock client-side by onHand-reorderLevel and hide chart when confidence is low.

### GAP-INVENTORY-DETAIL-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** "+ Stock Entry" is a plain <a href="/stock/ledger/new?itemId=…"> (page.tsx:75). The file header (page.tsx:20-30) states /stock/:path* is permanently redirected to /inventory/:path*, and this route tree has no ledger/new page, so the primary action would land on inventory not-found (next.config is absent from the snapshot — redirect itself unverified).
- **Service:** `web gateway (next.config redirects)`  ·  **Endpoint(s):** `['GET /stock/ledger/new?itemId=', 'redirect /stock/:path* -> /inventory/:path*']`
- **Question:** next.config redirects must not swallow /stock/ledger/new (or an /inventory/ledger/new page must exist), so the + Stock Entry link reaches the entry form with itemId prefilled.
- **How to verify:** Open apps/web/next.config.mjs (absent from snapshot) and check the /stock/:path* redirect; in a browser or curl -I /stock/ledger/new?itemId=X expect 200 not 308 to /inventory/ledger/new. Note src/app/(app)/stock/ledger/new exists but inventory has no ledger/new route (ls inventory).
- **Test to add:** Given an authenticated session, when GET /stock/ledger/new?itemId=X then the New Stock Entry form renders with item X preselected (no 404).
- **Impact if wrong:** Primary stock action on the item page lands on not-found, users cannot record stock.
- **Web change if wrong:** Move stock/ledger/new to inventory/ledger/new (or carve it out of the redirect) and change the anchor at inventory/[id]/page.tsx:75 to next/link /inventory/ledger/new?itemId=.

### GAP-INVENTORY-DETAIL-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Not-found branch has no error boundary text or help link; page copy is hard-coded English; unit cost/total value paise-to-rupee handling in formatMoney(number) is undeterminable here.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/items/{id}']`
- **Question:** GET /v1/stock/items/:id must return unitCost and totalValue as integer minor units (paise) so formatMoney (which divides by 100) is correct, and must return 404 (not 200 empty) for unknown ids.
- **How to verify:** Open stock-service item detail handler and apiMappers.ts:1017-1018 (parseMinor(unitCost), parseMinor(totalValue)); curl GET /v1/stock/items/{id} for an item costing Rs 12.50 expecting unitCost 1250; curl unknown id expect 404.
- **Test to add:** Given an item with rate Rs 12.50 x 10 units, when GET item detail then unitCost=1250 and totalValue=12500 (minor units); unknown id gives 404 NOT_FOUND.
- **Impact if wrong:** Costs shown 100x too big/small in a financial valuation screen.
- **Web change if wrong:** If service returns rupees: use formatRupees or convert in mapStockItemDetail. Separately add help link/error text to not-found branch and move copy to i18n.

### GAP-INVENTORY-BINS-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/bins?limit=200']`
- **Question:** GET /v1/inventory/bins must require an inventory role, enforce tenant scoping, cap and honour limit (with cursor/hasMore) and return rows in a stable order.
- **How to verify:** In the inventory-service repo open the bins route handler; curl /api/v1/inventory/bins?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/bins?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1789 (merged)
- **First-pass claim:** Approve posts a stock adjustment with no role gate and no maker≠checker indicator in the UI (page.tsx:46-48, CycleCountActions.tsx:24-53); the comment claims maker-checker but only a ConfirmDialog exists client-side — server check undeterminable (inventory-service absent).
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/cycle-counts/{id}', 'POST /api/v1/inventory/cycle-counts/{id}/approve', 'POST /api/v1/inventory/cycle-counts/{id}/reject']`
- **Question:** POST approve/reject must be limited to an approver role (e.g. store_manager/inventory_admin), reject approval when actor equals the count's creator/counter (maker!=checker), enforce optimistic version (409 on mismatch), post the stock adjustment idempotently and emit an audit event.
- **How to verify:** In inventory-service open the cycle-counts approve handler and consumer; curl POST .../approve as the user who created the count (expect 403 MAKER_CHECKER), as a non-approver role (403), as a valid approver with stale version (409), then twice with valid version (second call no duplicate adjustment).
- **Test to add:** Given cycle count created by user U with variance, when U POSTs approve then 403; when approver POSTs with current version then 202 and exactly one stock adjustment and one audit event; repeat call is idempotent.
- **Impact if wrong:** Single person can self-approve inventory write-offs (fraud/control failure); duplicate adjustments corrupt stock.
- **Web change if wrong:** Show createdBy on the page and hide/disable Approve for the creator; hide Approve for non-approver roles (add role gate to CycleCountActions/page.tsx:46-48); map 403/409 to friendly messages.

### GAP-INVENTORY-GOODS-RETURNS-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/goods-returns?limit=200']`
- **Question:** GET /v1/inventory/goods-returns must require an inventory/store role, tenant-scope rows, honour limit with stable ordering and paginate beyond 200.
- **How to verify:** In the inventory-service repo open the goods-returns route handler; curl /api/v1/inventory/goods-returns?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/goods-returns?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-GOODS-RETURNS-DETAIL-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** Original issue, Item and Store print as full UUIDs (page.tsx:45-52); "Original issue (GRN reference)" is an issue id, not a document number. Inspector name is not captured or shown (only date and notes), so audit attribution is server-side, undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/goods-returns/{id}', 'POST /api/v1/inventory/goods-returns']`
- **Question:** The goods-return record must persist and return the inspector identity (createdBy/inspectedBy) plus resolvable item/store/issue display fields, and creation must emit an audit event.
- **How to verify:** Open inventory-service goods-returns create handler and schema; POST a return as store_keeper then GET it and confirm createdBy/inspectedBy is set from the JWT (not the body) and item name/code, store name, issue number are included; check audit topic for a goods_return.created event.
- **Test to add:** Given store_keeper U posts a goods return, when GET detail then inspectedBy=U and itemName, storeName, issueNo present, and one audit event exists.
- **Impact if wrong:** No accountability for who accepted returned stock; auditors cannot trace.
- **Web change if wrong:** If service only returns ids, resolve names in the loader (getGoodsReturnById) and show inspector and document number on goods-returns/[id]/page.tsx:36-52.

### GAP-INVENTORY-ISSUES-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/ledger?limit=200']`
- **Question:** GET /v1/inventory/ledger must require an inventory role, tenant-scope, honour limit with stable order (newest first) and expose a movement type filter so the Issues view is not silently truncated to 200 mixed rows.
- **How to verify:** In the inventory-service repo open the ledger route handler; curl /api/v1/inventory/ledger?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/ledger?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-ITEMS-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/items']`
- **Question:** GET /v1/inventory/items must require an inventory role, tenant-scope rows and paginate (the web sends no limit, so the default page size and hasMore behaviour matter).
- **How to verify:** In the inventory-service repo open the items route handler; curl /api/v1/inventory/items with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/items then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-LIST-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** Low-stock status is smuggled through isLowStock cast "as unknown as boolean" to get a text pill (client:31-35); Stock Value adds floats and relies on formatMoney(number) units, undeterminable without the loader mapper.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/items']`
- **Question:** GET /v1/stock/items must return isLowStock and totalValue as consistent minor-unit integers computed server-side (or onHand/reorderLevel so the client can), so summing totalValue across rows is safe.
- **How to verify:** Open stock-service items list handler and apiMappers.ts:356 (totalValue number or parseMinor); curl GET /v1/stock/items and assert totalValue is an integer paise value and isLowStock boolean for every row.
- **Test to add:** Given items with totalValue 12500 and 7500 paise, when list, then values are integers and page sum equals 20000 -> Rs 200.00; isLowStock true iff onHand<=reorderLevel.
- **Impact if wrong:** Wrong stock valuation total on the dashboard; float drift.
- **Web change if wrong:** Sum in BigInt/integer minor units and replace the 'as unknown as boolean' cast in InventoryStockListClient.tsx:43 with a proper status text column.

### GAP-INVENTORY-LIST-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1796 (merged)
- **First-pass claim:** inventory-service is absent from the snapshot; stock-service likewise.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/items', 'GET /api/v1/inventory/cycle-counts?status=pending_approval&limit=200']`
- **Question:** stock-service and inventory-service list endpoints must both require an authorised role, tenant-scope and paginate, and their ids/units must agree since the page merges them.
- **How to verify:** Open both services' list handlers; curl each with inventory role (200), no role (403); compare item ids between stock/items and inventory cycle-count rows.
- **Test to add:** Given same tenant, when both endpoints are called, then item ids referenced by cycle counts exist in stock/items and 403 is returned without the role.
- **Impact if wrong:** Inconsistent stock views; unauthorised read.
- **Web change if wrong:** none

### GAP-INVENTORY-LOW-STOCK-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/low-stock']`
- **Question:** GET /v1/inventory/low-stock must require an inventory role, tenant-scope, compute lowness from onHand vs reorderLevel server-side and order by nearest reorder point.
- **How to verify:** In the inventory-service repo open the low-stock route handler; curl /api/v1/inventory/low-stock with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/low-stock then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-RECEIPTS-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/ledger?limit=200']`
- **Question:** GET /v1/inventory/ledger must require an inventory role, tenant-scope, and return enough receipt movements (type filter or larger limit) so the Receipts view is not truncated by 200 mixed rows.
- **How to verify:** In the inventory-service repo open the ledger route handler; curl /api/v1/inventory/ledger?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/ledger?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-RECONCILE-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** /api/v1/stock/ledger takes no limit here (loaders.ts:3907) while the inventory ledger is capped at 200; stock-service and inventory-service are absent from the snapshot.
- **Service:** `stock-service`  ·  **Endpoint(s):** `['GET /api/v1/stock/ledger', 'GET /api/v1/inventory/ledger?limit=200']`
- **Question:** GET /v1/stock/ledger must apply a server-side default and maximum limit (with pagination) when the client sends none, and stock and inventory ledgers must agree on quantities for the same movements.
- **How to verify:** Open stock-service ledger handler (web loader loaders.ts:3907 sends no limit); seed >5000 movements and curl GET /v1/stock/ledger, expect at most default page size and hasMore; compare a movement's quantity with inventory ledger.
- **Test to add:** Given 10,000 ledger rows, when GET /v1/stock/ledger without limit, then <=200 rows and pagination.hasMore=true; same movement id has identical quantity in both services.
- **Impact if wrong:** Unbounded response can time out or exhaust memory; reconciliation compares different sets.
- **Web change if wrong:** Pass an explicit limit and add pager to reconcile page; align limit with inventory ledger.

### GAP-INVENTORY-RESERVATIONS-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1816 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/reservations?limit=200']`
- **Question:** GET /v1/inventory/reservations must require an inventory role, tenant-scope, honour limit and expose expiry/status consistently.
- **How to verify:** In the inventory-service repo open the reservations route handler; curl /api/v1/inventory/reservations?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/reservations?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.

### GAP-INVENTORY-SUBSTITUTES-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1837 (merged)
- **First-pass claim:** inventory-service is not in the code snapshot (only services/hrms-service), so endpoint auth, pagination and audit behaviour behind this route are undeterminable.
- **Service:** `inventory-service`  ·  **Endpoint(s):** `['GET /api/v1/inventory/items/{id}/substitutes (one call per item)', 'GET /api/v1/inventory/items']`
- **Question:** GET /v1/inventory/items/:id/substitutes must require an inventory role, 404 cross-tenant ids, and a bulk substitutes list should exist so the page need not fan out one call per item.
- **How to verify:** In the inventory-service repo open the substitutes route handler; curl /api/v1/inventory/items/{id}/substitutes (one call per item) with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
- **Test to add:** Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/items/{id}/substitutes (one call per item) then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
- **Impact if wrong:** Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- **Web change if wrong:** Add pagination/cursor UI or type filter param if service caps results; show LoadErrorState on 403.
