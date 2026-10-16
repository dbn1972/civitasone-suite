# Detailed gap file — module `catalogue`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 30, BACKEND-VERIFY 1



---
## /catalogue  —  `catalogue/home.html`

- **Source:** `apps/web/src/app/(app)/catalogue/page.tsx`
- **Design reference:** `redesign/catalogue/home.html`

### GAP-CATALOGUE-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles promise more than the pages deliver: 'Manage product catalogue with variants and pricing' and 'rate cards and pricing rules' (page.tsx:6,8) lead to read-only generic lists with no variants, prices or rules (products/page.tsx, rates/page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/catalogue/page.tsx:6 'variants and pricing' and :8 'rate cards and pricing rules'; both targets are ModuleListPage generic tables (id/name/detail/status/meta) with no variants, price or rule columns and no create/edit.
- **Files to change:** `apps/web/src/app/(app)/catalogue/page.tsx`
- **Fix steps:**
  1. Reword tile descriptions in catalogue/page.tsx to what exists (e.g. 'Browse the product and service list', 'Browse effective-dated rate cards').
  2. Or build the promised screens (see PRODUCTS-01, RATES-01) and keep the copy.
  3. Decide copy-first vs feature-first with product owner.
- **Acceptance:**
  - Tile text matches what the destination page shows.
  - No tile mentions variants/pricing rules until they are shown.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CATALOGUE-PRODUCTS-01, GAP-CATALOGUE-RATES-01

### GAP-CATALOGUE-HOME-03  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx renders four stat-card placeholders and a 384px block (loading.tsx:11-24) for a page with only tiles; content shifts on load.
- **Verified evidence:** apps/web/src/app/(app)/catalogue/loading.tsx:11-24 renders four stat cards and an h-96 block, with hard-coded bg-slate-50/bg-gray-200/bg-white (light-only). The hub page has only LinkTiles. The same loading.tsx also serves the four child list routes (they have no loading.tsx), where a table block is a closer fit.
- **Files to change:** `apps/web/src/app/(app)/catalogue/loading.tsx`
- **Fix steps:**
  1. Create catalogue/loading.tsx that renders a header skeleton plus 4 tile skeletons (class 'mtile') using theme tokens, not slate/gray.
  2. Add loading.tsx under products/, categories/, rates/, bundles/ with a header + table skeleton, following cdp/events/loading.tsx structure.
  3. Use CSS variables so dark mode does not flash.
- **Acceptance:**
  - Hub load shows 4 tile skeletons and no layout jump.
  - Dark mode shows no white flash.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CATALOGUE-HOME-04  ·  LOW  ·  confirmed  ·  theme ICONS (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** LinkTiles has no icons for Products, Categories, Rates or Bundles, so all four use the generic folder glyph (LinkTiles.tsx:5-58).
- **Verified evidence:** LinkTiles.tsx:10-49 TILE_ICONS has no Products/Categories/Rates/Bundles; tileIcon (LinkTiles.tsx:53-61) href checks don't match, so all fall to the '📁' default at :60.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add Products, Categories, Rates, Bundles entries to TILE_ICONS (LinkTiles.tsx:10).
  2. Keys are global by title; check no other module uses those titles with a different intent.
- **Acceptance:**
  - Catalogue hub shows four distinct icons.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CATALOGUE-HOME-05  ·  LOW  ·  defect  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by #2036)
- **First-pass claim:** help='catalogue' links to /help/catalogue (PageHeader.tsx:46-50); whether that article exists is undeterminable from the snapshot.
- **Service:** `web (no backend)`  ·  **Endpoint(s):** `['GET /help/catalogue']`
- **Question:** Does a help article with slug 'catalogue' exist?
- **How to verify:** Checked apps/web/src/lib/helpContent.ts: HELP_MODULES has 11 entries, none with slug catalogue; app/(app)/help/[module]/page.tsx calls notFound() for unknown slugs.
- **Test to add:** Given PageHeader help='catalogue'; when link followed; then /help/catalogue returns 200 (test iterates all help props against HELP_MODULES).
- **Impact if wrong:** Dead help link (404) on the catalogue hub.
- **Web change if wrong:** Add a catalogue entry to HELP_MODULES or remove help prop.
- **Finding:** apps/web/src/lib/helpContent.ts (no catalogue slug); apps/web/src/app/(app)/help/[module]/page.tsx:17


---
## /catalogue/bundles  —  `catalogue/bundles.html`

- **Source:** `apps/web/src/app/(app)/catalogue/bundles/page.tsx`
- **Design reference:** `redesign/catalogue/bundles.html`

### GAP-CATALOGUE-BUNDLES-01  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — mapBundleRows shows member count; price and validity not shown (catalogue-service bundle model has no such columns, needs backend)
- **First-pass claim:** A bundle list without contents or price: members, bundle price and validity are not mapped (_data.ts:36-72), so 'combo offerings' cannot be inspected; Detail is a free-text description.
- **Verified evidence:** ModuleRowSummary output (id,label,sublabel,status,meta) is generic (_data.ts:68-74); loader does not map members/price/validity. Whether /api/v1/catalogue/bundles returns those fields is cannot-verify (catalogue-service absent). Table columns are fixed ID/Name/Detail/Status/Meta (ModuleListTable.tsx:40-44).
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`, `apps/web/src/app/(app)/catalogue/bundles/page.tsx`, `packages/types (bundle type)`
- **Fix steps:**
  1. Confirm bundle API shape with catalogue-service.
  2. Add a dedicated CatalogueBundleSummary mapper with zod schema and members count, price (paise via formatMoney), validity dates.
  3. Render a bespoke table in bundles/page.tsx instead of ModuleListPage.
- **Acceptance:**
  - Test: mapper maps members and price_paise; table shows Rs amount.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Price display must use paise/formatMoney per CLAUDE.md.

### GAP-CATALOGUE-BUNDLES-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** extractRows falls back to [payload] for any non-list JSON object (_data.ts:22-30), so an unexpected response is rendered as one junk row (label from id/type) instead of an error; rows are never dropped or flagged.
- **Verified evidence:** extractRows (_data.ts:18-26) returns [payload] for any object without a known array key (line 25) after `isRecord(payload.data)` returns [payload.data]; mapRows then produces a row labelled from id/type. No responseSchema passed to fetchJson (line 81). So an error-shaped 200 body becomes a junk row.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. Add a zod responseSchema to fetchJson for bundles (array or {data:[]}); return null from mapResponse when invalid so source becomes 'error'.
  2. Remove the [payload] fallback.
- **Acceptance:**
  - Test: payload {message:'x'} -> source 'error', zero rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CATALOGUE-BUNDLES-03  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE (was VALIDATION)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Detail duplicates Status when a row has no description: sublabel chains description → status → state → category (_data.ts:53-61) and status is shown in its own column (ModuleListTable.tsx:46-47).
- **Verified evidence:** _data.ts:51-59 sublabel chain falls to status/state; ModuleListTable.tsx:52-53 shows sublabel in Detail and status in Status, so identical text appears twice. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. Remove status/state from the sublabel chain for module loaders (leave description, category, tier).
- **Acceptance:**
  - Test: row with only status shows '—' in Detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared by all module loaders.

### GAP-CATALOGUE-BUNDLES-04  ·  LOW  ·  confirmed  ·  theme TRUNCATION (was FAILMASK)

- [x] **Status** (W0 2026-10-13: closed by #1801, verified on main 9c5e9e9e9)
- **First-pass claim:** ID column is id.slice(0,8) (ModuleListTable.tsx:44) and the loader falls back to code or name when there is no id (_data.ts:38-46), so a code like 'SVC-BPA-01' is cut to 'SVC-BPA-' — ambiguous between siblings.
- **Verified evidence:** ModuleListTable.tsx:50 renders row.id.slice(0,8); id falls back to key/code/name (_data.ts:32-41). 'SVC-BPA-01' shows 'SVC-BPA-'. UUIDs first 8 chars are fine but codes are ambiguous. Theme FAILMASK is wrong.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Show full id if not UUID-shaped (only slice UUIDs), or add title attribute and full code.
- **Acceptance:**
  - Test: 'SVC-BPA-01' renders in full.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared by all ModuleListPage screens.

### GAP-CATALOGUE-BUNDLES-05  ·  LOW  ·  partly  ·  theme CACHING (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** export const dynamic = 'force-dynamic' (page.tsx:5) makes revalidateSeconds: 30 in the loader (_data.ts:73-76) moot; the intended 30-second cache is never used.
- **Verified evidence:** page.tsx:5 force-dynamic and _data.ts:82 revalidateSeconds 30 (line 73-76 in observation is off). In Next 14 force-dynamic makes fetches uncached, so the revalidate hint is moot. The dynamic render is arguably right for per-user authorised data; issue is only misleading config. No PII involved.
- **Files to change:** `apps/web/src/app/(app)/catalogue/bundles/page.tsx`, `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. Either drop force-dynamic and use tenant-scoped caching deliberately, or remove revalidateSeconds to avoid misleading config.
- **Acceptance:**
  - Manual: network shows fresh fetch per request as intended.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Caching auth-bearing responses could leak across tenants if misconfigured; prefer no-store.

### GAP-CATALOGUE-BUNDLES-06  ·  LOW  ·  confirmed  ·  theme LISTUX (was DEADROUTE)

- [x] **Status** (W2 PQ: closed by #TBD)
- **W0 note:** partly fixed by #1923 — ModuleListTable now uses ds DataTable (sort/filter/paging, pageSize 15); still no module-specific empty-state CTA (emptyAction) or row links
- **First-pass claim:** Read-only generic table: no filter, sort, paging or row link, and the empty state 'No records' has no call to action (ModuleListTable.tsx:34-36).
- **Verified evidence:** ModuleListTable.tsx renders a plain table, no filter/sort/paging/row link (lines 37-58); empty state at line 35 has no action. Theme DEADROUTE is wrong (no dead link).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/catalogue/bundles/page.tsx`
- **Fix steps:**
  1. Reuse ds/DataTable with filterable, sortable, pageSize in ModuleListTable.
  2. Add optional emptyAction prop.
  3. Add row link when a bundle detail route exists (none currently under catalogue/).
- **Acceptance:**
  - Manual: filter box narrows rows; empty state shows CTA.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component used by many pages; regression-test visually.


---
## /catalogue/categories  —  `catalogue/categories.html`

- **Source:** `apps/web/src/app/(app)/catalogue/categories/page.tsx`
- **Design reference:** `redesign/catalogue/categories.html`

### GAP-CATALOGUE-CATEGORIES-01  ·  HIGH  ·  partly  ·  theme TREE (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Description says 'Hierarchical product category tree' but it renders a flat table of top-level rows: the loader reads /products/tree through extractRows (data/items/nodes keys) and never descends into children (_data.ts:22-30,86), and the table has no parent or indent column (ModuleListTable.tsx:38-58). Sub-categories are silently missing.
- **Verified evidence:** Loader is apps/web/src/app/(app)/catalogue/_data.ts:89 (/api/v1/catalogue/products/tree) via extractRows/mapRows (apps/web/src/app/(app)/catalogue/_data.ts:18-77) which maps only top-level array items; it never reads children and there is no parent/depth field (ModuleListTable apps/web/src/app/_components/ModuleListTable.tsx:40-44). So a tree is flattened to roots. Whether the response even nests children cannot be seen: catalogue-service is not in the snapshot. Line refs in the observation were off (real: _data.ts 18-26 and 89; table columns 40-44).
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`, `apps/web/src/app/(app)/catalogue/categories/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm tree response shape (children key, depth) with catalogue-service owner.
  2. Add flattenTree(nodes,depth,parentName) in catalogue/_data.ts that recurses into children and emits rows with depth and parentLabel.
  3. Extend ModuleRowSummary (@civitasone/types) with optional depth/parent.
  4. Render indent (padding-left = depth*16px) on the Name cell in ModuleListTable, or a Parent column.
  5. Add unit test with a 3-level tree.
- **Acceptance:**
  - Tree root->child->grandchild renders 3 rows in order with increasing indent.
  - Root with no children renders 1 row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; read-only display, but shared ModuleListTable is used by 60+ pages so keep new fields optional.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-06

### GAP-CATALOGUE-CATEGORIES-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** extractRows falls back to [payload] for any non-list JSON object (_data.ts:22-30), so an unexpected response is rendered as one junk row (label from id/type) instead of an error; rows are never dropped or flagged.
- **Verified evidence:** apps/web/src/app/(app)/catalogue/_data.ts:18-26 extractRows returns [payload] for any non-array JSON object after the known keys fail, and mapRows then builds one row (label falls back to id/'row-1'). fetchJson only flags source=error on HTTP failure or when a responseSchema is supplied; these moduleLoaders pass none (apiClient.ts:150-158), so a 200 with an unexpected shape renders a junk row.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`, `apps/web/src/app/(app)/cdp/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts replace the loose extractRows fallback: return null (not [payload]) when payload is not an array and has none of the known list keys.
  2. Make mapRows/mapResponse return null on null input so fetchJson yields source:'error' (apiClient.ts:150-153).
  3. Better: pass a zod responseSchema (list of {id,name,...} per catalogue-service/cdp-service contract in @civitasone/schemas/web) to fetchJson, as getCdpProfileList does.
  4. Render RefreshErrorState from ModuleListPage when source==='error' (see ModuleListTable source prop).
- **Acceptance:**
  - Unit test: mapRows({message:'ok'}) and mapRows('x') produce error/null, not a row.
  - Mock gateway returning {status:'ok'}: page shows the error state, not a table with row 'row-1'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong-shape responses will now show an error instead of a junk row. Same helper is copy-pasted in 15 _data.ts files.

### GAP-CATALOGUE-CATEGORIES-03  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE-COLUMN (was VALIDATION)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Detail duplicates Status when a row has no description: sublabel chains description → status → state → category (_data.ts:53-61) and status is shown in its own column (ModuleListTable.tsx:46-47).
- **Verified evidence:** apps/web/src/app/(app)/catalogue/_data.ts:51-59 sublabel chain is description ?? status ?? state ?? category...; apps/web/src/app/(app)/catalogue/_data.ts:60 status = status ?? state ?? lifecycle; ModuleListTable apps/web/src/app/_components/ModuleListTable.tsx:52-53 shows both Detail and Status columns, so Detail repeats Status when description is absent.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts sublabel chain, drop status/state (and agentId/profileId where redundant) so sublabel only uses description/category/tier.
  2. Leave status only in the Status column of ModuleListTable.
  3. Add a mapRows unit test with a row {name,status} asserting sublabel is undefined.
- **Acceptance:**
  - Row {name:'A',status:'ACTIVE'} renders Detail '—' and Status 'ACTIVE' (not ACTIVE twice).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.

### GAP-CATALOGUE-CATEGORIES-04  ·  LOW  ·  confirmed  ·  theme ID-TRUNCATION (was FAILMASK)

- [x] **Status** (W0 2026-10-13: closed by #1801, verified on main 9c5e9e9e9)
- **First-pass claim:** ID column is id.slice(0,8) (ModuleListTable.tsx:44) and the loader falls back to code or name when there is no id (_data.ts:38-46), so a code like 'SVC-BPA-01' is cut to 'SVC-BPA-' — ambiguous between siblings.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:50 renders row.id.slice(0,8). apps/web/src/app/(app)/catalogue/_data.ts:32-41 id falls back key -> code -> name -> ..., so when the API row has no id a code such as 'SVC-BPA-01' is cut to 'SVC-BPA-'. With real UUID ids the truncation is harmless, so the harm is conditional on the API omitting id.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In apps/web/src/app/_components/ModuleListTable.tsx (row render, line 50) stop truncating: render full row.id with CSS ellipsis + title attribute, or hide the ID column when id is a UUID and show row.meta/code instead.
  2. In mapRows keep code as a separate field (extend ModuleRowSummary in @civitasone/types) rather than reusing it as id.
  3. Add unit test for a row with code 'SVC-BPA-01' and no id.
- **Acceptance:**
  - Row {code:'SVC-BPA-01',name:'X'} shows the full code.
  - Two sibling codes sharing the first 8 chars are distinguishable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CATALOGUE-CATEGORIES-05  ·  LOW  ·  confirmed  ·  theme CACHE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** export const dynamic = 'force-dynamic' (page.tsx:5) makes revalidateSeconds: 30 in the loader (_data.ts:73-76) moot; the intended 30-second cache is never used.
- **Verified evidence:** apps/web/src/app/(app)/catalogue/categories/page.tsx:5 sets dynamic='force-dynamic', which in Next 14 makes every fetch no-store; apps/web/src/app/(app)/catalogue/_data.ts:81-84 (moduleLoader) still passes revalidateSeconds:30 -> next.revalidate (apiClient.ts:137). The 30s cache is never used. Not a defect in itself: per-user authorised data should not be in the shared cache.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts moduleLoader remove revalidateSeconds:30 (fetchJson then uses cache:'no-store', apiClient.ts:137-138) so the code states what actually happens.
  2. Keep export const dynamic='force-dynamic' on the pages: auth headers are per-user and must not enter a shared data cache.
  3. If caching is wanted later, use a per-user client cache (useSeededResource) not the Next data cache.
- **Acceptance:**
  - Search shows no revalidateSeconds in catalogue/_data.ts.
  - Two page loads after a backend change show fresh data.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; do NOT remove force-dynamic, it would risk cross-user cache reuse.

### GAP-CATALOGUE-CATEGORIES-06  ·  LOW  ·  confirmed  ·  theme TABLE-FEATURES (was DEADROUTE)

- [x] **Status** (W2 PQ: closed by #TBD)
- **W0 note:** partly fixed by #1923 — ModuleListTable now uses ds DataTable (sort/filter/paging, pageSize 15); still no module-specific empty-state CTA (emptyAction) or row links
- **First-pass claim:** Read-only generic table: no filter, sort, paging or row link, and the empty state 'No records' has no call to action (ModuleListTable.tsx:34-36).
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:40-53 plain <table> with no sort/filter/paging/row link; empty state apps/web/src/app/_components/ModuleListTable.tsx:35 'No records / Nothing to show yet for this module.' has no action. ds DataTable already supports sortable/filterable/pageSize/rowLinkKey (cdp/profiles/page.tsx:39-60 pattern). Shared component, so it affects 60+ pages.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Replace the body of ModuleListTable with the shared ds DataTable (props sortable, filterable, pageSize, exportable) already used in cdp/profiles/page.tsx.
  2. Add optional rowHref (pattern) to ModuleListPage and pass it from pages that have a detail route.
  3. Give ModuleListPage an optional emptyAction prop and set it where a create route exists; otherwise reword the empty message.
- **Acceptance:**
  - List of 60 rows: page size 25, filter box narrows rows, header click sorts.
  - Empty list shows the module-specific empty message.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium regression surface: ModuleListTable is shared by 64 files; roll out behind optional props.


---
## /catalogue/products  —  `catalogue/products.html`

- **Source:** `apps/web/src/app/(app)/catalogue/products/page.tsx`
- **Design reference:** `redesign/catalogue/products.html`

### GAP-CATALOGUE-PRODUCTS-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — hub copy no longer promises variants/pricing, but products page still uses the generic columns (no variants count or price)
- **First-pass claim:** Hub says products have 'variants and pricing' (catalogue/page.tsx:6) but the list shows neither price, variants nor category — only id/name/detail/status/code (products/page.tsx:14-19; _data.ts:36-72).
- **Verified evidence:** catalogue/page.tsx:6 promises variants and pricing; products list uses generic ModuleListTable columns ID/Name/Detail/Status/Meta (apps/web/src/app/_components/ModuleListTable.tsx:40-44) fed by mapRows (apps/web/src/app/(app)/catalogue/_data.ts:28-77) which has no price, variant or category column (category only leaks into Detail when description/status missing). Which fields the API returns cannot be verified: catalogue-service absent.
- **Files to change:** `apps/web/src/app/(app)/catalogue/products/page.tsx`, `apps/web/src/app/(app)/catalogue/_data.ts`, `apps/web/src/app/(app)/catalogue/page.tsx`
- **Fix steps:**
  1. Get the product response contract from catalogue-service.
  2. Create a typed getCatalogueProductList in _data.ts with a zod schema (@civitasone/schemas/web) like getCdpProfileList.
  3. Render with ds DataTable columns Name, Category, Variants count, Price via formatMoney (paise) from lib/formatters.
  4. Or reword the hub tile (HOME-01) if the API has no such fields.
- **Acceptance:**
  - Product with 3 variants shows '3' and price formatted with formatMoney.
  - Missing price shows '—' not ₹0.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display: amounts must stay paise/bigint per CLAUDE.md; never float.
- **Depends on:** GAP-CATALOGUE-HOME-01

### GAP-CATALOGUE-PRODUCTS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** extractRows falls back to [payload] for any non-list JSON object (_data.ts:22-30), so an unexpected response is rendered as one junk row (label from id/type) instead of an error; rows are never dropped or flagged.
- **Verified evidence:** apps/web/src/app/(app)/catalogue/_data.ts:18-26 extractRows returns [payload] for any non-array JSON object after the known keys fail, and mapRows then builds one row (label falls back to id/'row-1'). fetchJson only flags source=error on HTTP failure or when a responseSchema is supplied; these moduleLoaders pass none (apiClient.ts:150-158), so a 200 with an unexpected shape renders a junk row.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts replace the loose extractRows fallback: return null (not [payload]) when payload is not an array and has none of the known list keys.
  2. Make mapRows/mapResponse return null on null input so fetchJson yields source:'error' (apiClient.ts:150-153).
  3. Better: pass a zod responseSchema (list of {id,name,...} per catalogue-service/cdp-service contract in @civitasone/schemas/web) to fetchJson, as getCdpProfileList does.
  4. Render RefreshErrorState from ModuleListPage when source==='error' (see ModuleListTable source prop).
- **Acceptance:**
  - Unit test: mapRows({message:'ok'}) and mapRows('x') produce error/null, not a row.
  - Mock gateway returning {status:'ok'}: page shows the error state, not a table with row 'row-1'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Shared with CATEGORIES-02: fix once.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-02

### GAP-CATALOGUE-PRODUCTS-03  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE-COLUMN (was VALIDATION)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Detail duplicates Status when a row has no description: sublabel chains description → status → state → category (_data.ts:53-61) and status is shown in its own column (ModuleListTable.tsx:46-47).
- **Verified evidence:** apps/web/src/app/(app)/catalogue/_data.ts:51-59 sublabel chain and apps/web/src/app/_components/ModuleListTable.tsx:52-53 both columns; Detail duplicates Status when no description.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts sublabel chain, drop status/state (and agentId/profileId where redundant) so sublabel only uses description/category/tier.
  2. Leave status only in the Status column of ModuleListTable.
  3. Add a mapRows unit test with a row {name,status} asserting sublabel is undefined.
- **Acceptance:**
  - Row {name:'A',status:'ACTIVE'} renders Detail '—' and Status 'ACTIVE' (not ACTIVE twice).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-03

### GAP-CATALOGUE-PRODUCTS-04  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Description leaks an internal service name to end users: 'Products and services from catalogue-service.' (products/page.tsx:17).
- **Verified evidence:** apps/web/src/app/(app)/catalogue/products/page.tsx:16 (not 17) description='Products and services from catalogue-service.' shows the internal service name to end users.
- **Files to change:** `apps/web/src/app/(app)/catalogue/products/page.tsx`
- **Fix steps:**
  1. Change description to 'Products and services offered.' (or i18n key).
- **Acceptance:**
  - Page subtitle contains no 'catalogue-service'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CATALOGUE-PRODUCTS-05  ·  LOW  ·  confirmed  ·  theme ID-TRUNCATION (was FAILMASK)

- [x] **Status** (W0 2026-10-13: closed by #1801, verified on main 9c5e9e9e9)
- **First-pass claim:** ID column is id.slice(0,8) (ModuleListTable.tsx:44) and the loader falls back to code or name when there is no id (_data.ts:38-46), so a code like 'SVC-BPA-01' is cut to 'SVC-BPA-' — ambiguous between siblings.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:50 id.slice(0,8) with id fallbacks at apps/web/src/app/(app)/catalogue/_data.ts:32-41; truncates code-derived ids. Harmless for full UUID ids.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In apps/web/src/app/_components/ModuleListTable.tsx (row render, line 50) stop truncating: render full row.id with CSS ellipsis + title attribute, or hide the ID column when id is a UUID and show row.meta/code instead.
  2. In mapRows keep code as a separate field (extend ModuleRowSummary in @civitasone/types) rather than reusing it as id.
  3. Add unit test for a row with code 'SVC-BPA-01' and no id.
- **Acceptance:**
  - Full code visible for id-less rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-04

### GAP-CATALOGUE-PRODUCTS-06  ·  LOW  ·  confirmed  ·  theme CACHE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** export const dynamic = 'force-dynamic' (page.tsx:5) makes revalidateSeconds: 30 in the loader (_data.ts:73-76) moot; the intended 30-second cache is never used.
- **Verified evidence:** products/page.tsx:5 force-dynamic vs apps/web/src/app/(app)/catalogue/_data.ts:81-84 revalidateSeconds:30; cache never used (Next 14 force-dynamic => no-store).
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts moduleLoader remove revalidateSeconds:30 (fetchJson then uses cache:'no-store', apiClient.ts:137-138) so the code states what actually happens.
  2. Keep export const dynamic='force-dynamic' on the pages: auth headers are per-user and must not enter a shared data cache.
  3. If caching is wanted later, use a per-user client cache (useSeededResource) not the Next data cache.
- **Acceptance:**
  - No revalidateSeconds remains.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-05

### GAP-CATALOGUE-PRODUCTS-07  ·  LOW  ·  confirmed  ·  theme TABLE-FEATURES (was DEADROUTE)

- [x] **Status** (W2 PQ: closed by #TBD)
- **W0 note:** partly fixed by #1923 — ModuleListTable now uses ds DataTable (sort/filter/paging, pageSize 15); still no module-specific empty-state CTA (emptyAction) or row links
- **First-pass claim:** Read-only generic table: no filter, sort, paging or row link, and the empty state 'No records' has no call to action (ModuleListTable.tsx:34-36).
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:40-53 no sort/filter/paging/row link; empty state at :35 has no action.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Replace the body of ModuleListTable with the shared ds DataTable (props sortable, filterable, pageSize, exportable) already used in cdp/profiles/page.tsx.
  2. Add optional rowHref (pattern) to ModuleListPage and pass it from pages that have a detail route.
  3. Give ModuleListPage an optional emptyAction prop and set it where a create route exists; otherwise reword the empty message.
- **Acceptance:**
  - List of 60 rows: page size 25, filter box narrows rows, header click sorts.
  - Empty list shows the module-specific empty message.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared component; see CATEGORIES-06.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-06


---
## /catalogue/rates  —  `catalogue/rates.html`

- **Source:** `apps/web/src/app/(app)/catalogue/rates/page.tsx`
- **Design reference:** `redesign/catalogue/rates.html`

### GAP-CATALOGUE-RATES-01  ·  HIGH  ·  confirmed  ·  theme MISSING-FIELDS (was MONEY)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Page is titled 'Effective-dated rate cards' but shows no rate, unit, effective-from or effective-to — the only fields are id/name/detail/status and meta = code|currency|updatedAt (_data.ts:62-68; ModuleListTable.tsx:38-58). Users cannot tell which card is in force.
- **Verified evidence:** Rates page description 'Effective-dated rate cards' (rates/page.tsx:16) but columns are the generic five; meta is code ?? currency ?? updatedAt (apps/web/src/app/(app)/catalogue/_data.ts:61-67) so only one of them shows, and no rate, unit, effective-from/to are mapped. The fields available from /api/v1/catalogue/rates cannot be verified (service absent). Theme MONEY is only partly right: no amount is displayed at all.
- **Files to change:** `apps/web/src/app/(app)/catalogue/rates/page.tsx`, `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. Get rate-card contract (amount in paise, unit, effectiveFrom, effectiveTo) from catalogue-service.
  2. Add getCatalogueRateList with zod schema in catalogue/_data.ts.
  3. Render DataTable with columns Card, Unit, Rate (formatMoney(paise)), Effective from/to (formatIndianDate), plus an 'In force' badge computed from IST today.
  4. Sort by effectiveFrom desc.
- **Acceptance:**
  - Two cards for same item with different periods show the one containing today as 'In force'.
  - Rate 12550 paise displays ₹125.50.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money: use paise/formatMoney only; in-force logic must compare dates in IST.

### GAP-CATALOGUE-RATES-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub tile says 'rate cards and pricing rules' (catalogue/page.tsx:8) while this page's description says only 'Effective-dated rate cards' (rates/page.tsx:17); pricing rules are not surfaced at all.
- **Verified evidence:** catalogue/page.tsx:8 says 'rate cards and pricing rules'; rates/page.tsx:16 says only 'Effective-dated rate cards'; no pricing-rules loader or route exists in catalogue/ (only bundles, categories, products, rates).
- **Files to change:** `apps/web/src/app/(app)/catalogue/page.tsx`
- **Fix steps:**
  1. Drop 'and pricing rules' from the tile, or add a pricing-rules route once the API exists.
- **Acceptance:**
  - Hub and page copy agree.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CATALOGUE-HOME-01

### GAP-CATALOGUE-RATES-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** extractRows falls back to [payload] for any non-list JSON object (_data.ts:22-30), so an unexpected response is rendered as one junk row (label from id/type) instead of an error; rows are never dropped or flagged.
- **Verified evidence:** apps/web/src/app/(app)/catalogue/_data.ts:18-26 extractRows returns [payload] for any non-array JSON object after the known keys fail, and mapRows then builds one row (label falls back to id/'row-1'). fetchJson only flags source=error on HTTP failure or when a responseSchema is supplied; these moduleLoaders pass none (apiClient.ts:150-158), so a 200 with an unexpected shape renders a junk row.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts replace the loose extractRows fallback: return null (not [payload]) when payload is not an array and has none of the known list keys.
  2. Make mapRows/mapResponse return null on null input so fetchJson yields source:'error' (apiClient.ts:150-153).
  3. Better: pass a zod responseSchema (list of {id,name,...} per catalogue-service/cdp-service contract in @civitasone/schemas/web) to fetchJson, as getCdpProfileList does.
  4. Render RefreshErrorState from ModuleListPage when source==='error' (see ModuleListTable source prop).
- **Acceptance:**
  - Unit test: mapRows({message:'ok'}) and mapRows('x') produce error/null, not a row.
  - Mock gateway returning {status:'ok'}: page shows the error state, not a table with row 'row-1'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared fix.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-02

### GAP-CATALOGUE-RATES-04  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE-COLUMN (was VALIDATION)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Detail duplicates Status when a row has no description: sublabel chains description → status → state → category (_data.ts:53-61) and status is shown in its own column (ModuleListTable.tsx:46-47).
- **Verified evidence:** apps/web/src/app/(app)/catalogue/_data.ts:51-59 and apps/web/src/app/_components/ModuleListTable.tsx:52-53 duplication.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts sublabel chain, drop status/state (and agentId/profileId where redundant) so sublabel only uses description/category/tier.
  2. Leave status only in the Status column of ModuleListTable.
  3. Add a mapRows unit test with a row {name,status} asserting sublabel is undefined.
- **Acceptance:**
  - Row {name:'A',status:'ACTIVE'} renders Detail '—' and Status 'ACTIVE' (not ACTIVE twice).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-03

### GAP-CATALOGUE-RATES-05  ·  LOW  ·  confirmed  ·  theme ID-TRUNCATION (was FAILMASK)

- [x] **Status** (W0 2026-10-13: closed by #1801, verified on main 9c5e9e9e9)
- **First-pass claim:** ID column is id.slice(0,8) (ModuleListTable.tsx:44) and the loader falls back to code or name when there is no id (_data.ts:38-46), so a code like 'SVC-BPA-01' is cut to 'SVC-BPA-' — ambiguous between siblings.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:50 id.slice(0,8); id fallbacks apps/web/src/app/(app)/catalogue/_data.ts:32-41.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In apps/web/src/app/_components/ModuleListTable.tsx (row render, line 50) stop truncating: render full row.id with CSS ellipsis + title attribute, or hide the ID column when id is a UUID and show row.meta/code instead.
  2. In mapRows keep code as a separate field (extend ModuleRowSummary in @civitasone/types) rather than reusing it as id.
  3. Add unit test for a row with code 'SVC-BPA-01' and no id.
- **Acceptance:**
  - Full code visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-04

### GAP-CATALOGUE-RATES-06  ·  LOW  ·  confirmed  ·  theme CACHE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** export const dynamic = 'force-dynamic' (page.tsx:5) makes revalidateSeconds: 30 in the loader (_data.ts:73-76) moot; the intended 30-second cache is never used.
- **Verified evidence:** rates/page.tsx:5 force-dynamic; apps/web/src/app/(app)/catalogue/_data.ts:81-84 revalidate moot.
- **Files to change:** `apps/web/src/app/(app)/catalogue/_data.ts`
- **Fix steps:**
  1. In catalogue/_data.ts moduleLoader remove revalidateSeconds:30 (fetchJson then uses cache:'no-store', apiClient.ts:137-138) so the code states what actually happens.
  2. Keep export const dynamic='force-dynamic' on the pages: auth headers are per-user and must not enter a shared data cache.
  3. If caching is wanted later, use a per-user client cache (useSeededResource) not the Next data cache.
- **Acceptance:**
  - No revalidateSeconds.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-05

### GAP-CATALOGUE-RATES-07  ·  LOW  ·  confirmed  ·  theme TABLE-FEATURES (was DEADROUTE)

- [x] **Status** (W2 PQ: closed by #TBD)
- **W0 note:** partly fixed by #1923 — ModuleListTable now uses ds DataTable (sort/filter/paging, pageSize 15); still no module-specific empty-state CTA (emptyAction) or row links
- **First-pass claim:** Read-only generic table: no filter, sort, paging or row link, and the empty state 'No records' has no call to action (ModuleListTable.tsx:34-36).
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:40-53, empty state :35.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Replace the body of ModuleListTable with the shared ds DataTable (props sortable, filterable, pageSize, exportable) already used in cdp/profiles/page.tsx.
  2. Add optional rowHref (pattern) to ModuleListPage and pass it from pages that have a detail route.
  3. Give ModuleListPage an optional emptyAction prop and set it where a create route exists; otherwise reword the empty message.
- **Acceptance:**
  - List of 60 rows: page size 25, filter box narrows rows, header click sorts.
  - Empty list shows the module-specific empty message.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-06


---
## Backend verification items (service code absent from snapshot)

### GAP-CATALOGUE-HOME-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No create/edit routes exist under catalogue/ (only four list pages) and no role gate is declared (layout.tsx:4-5), so 'Manage' has no owner or UI; who maintains the catalogue cannot be determined from web code and catalogue-service is absent from the snapshot.
- **Service:** `catalogue-service`  ·  **Endpoint(s):** `['GET /api/v1/catalogue/products', '/products/tree', '/rates', '/bundles']`
- **Question:** Which roles may create/edit products, rates and bundles, and is there any write API the web should expose?
- **How to verify:** Open catalogue-service routes; list POST/PUT/DELETE handlers and role guards; confirm reads open to all tenant users.
- **Test to add:** Given role viewer; when POST /catalogue/products; then 403; catalogue_admin gets 201 and audit row.
- **Impact if wrong:** Unowned catalogue maintenance or unrestricted edits to prices.
- **Web change if wrong:** Add create/edit routes gated by catalogue_admin, or state owner on hub; add requireAnyRole to layout for write actions.
