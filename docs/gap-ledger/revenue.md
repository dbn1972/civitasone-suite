# Detailed gap file — module `revenue`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 69, BACKEND-VERIFY 10



---
## /revenue  —  `revenue/home.html`

- **Source:** `apps/web/src/app/(app)/revenue/page.tsx`
- **Design reference:** `redesign/revenue/home.html`

### GAP-REVENUE-HOME-02  ·  LOW  ·  confirmed  ·  theme NAVUX (was VALIDATION)

- [x] **Status** (W2 revenue: already fixed on main — page.tsx no duplicate tile; comment at l.6-14 cites fix; Analytics tile folds in description; closed by #2065)
- **First-pass claim:** "Analytics" and "Collection Report" tiles both link to /revenue/analytics (page.tsx:17,21); the second is a duplicate entry point with no separate report.
- **Verified evidence:** revenue/page.tsx:18 (Analytics) and :21 (Collection Report) both point to /revenue/analytics; no separate report route exists in the revenue directory listing.
- **Files to change:** `apps/web/src/app/(app)/revenue/revenue/page.tsx`
- **Fix steps:**
  1. Remove the 'Collection Report' tile (line 21) or point it to a real report anchor/tab (e.g. /revenue/analytics?tab=collection) once one exists.
  2. Fold its description into the Analytics tile.
- **Acceptance:**
  - Hub shows one tile per distinct destination; no two tiles share an href.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-REVENUE-HOME-03

### GAP-REVENUE-HOME-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Every tile falls through LinkTiles.tileIcon to the same "📁" glyph (_components/LinkTiles.tsx:53-61) — 15 indistinguishable tiles, and the tile order is flat (no grouping into Register / Billing / Approvals / Insight).
- **Verified evidence:** LinkTiles.tsx:53-61 tileIcon looks up TILE_ICONS by title (none of the 15 revenue titles are keys) then href substrings (dashboard, employees, leave, payroll, procurement/orders) - none match /revenue/* - so all fall to '📁'. Tiles are ungrouped although LinkTiles supports a `section` field (65-76) and revenue/page.tsx sets none.
- **Files to change:** `apps/web/src/app/(app)/revenue/revenue/page.tsx`, `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add revenue titles to TILE_ICONS (or better, an optional `icon` field on NavTile in @civitasone/types and use it first in tileIcon).
  2. Set `section` on each tile: Register (Assessees, Assessments, Trade Licenses), Billing & Collection (Bills, Receipts, Instalments, BBPS), Adjustments (Refunds, Write-offs, Adjustments, Waivers), Recovery & Config (Recovery, Rate Configuration), Insight (Analytics); reorder tiles so sections are contiguous.
  3. Remove duplicate tile (see HOME-02).
- **Acceptance:**
  - Each tile has a distinct icon; hub renders 4-5 labelled sections.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; LinkTiles is shared by other modules, keep the fallback.
- **Depends on:** GAP-REVENUE-HOME-02

### GAP-REVENUE-HOME-04  ·  LOW  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Root error boundary passes area="page" so the message reads "We couldn't open page." ((app)/error.tsx:13; RouteError.tsx sentence template).
- **Verified evidence:** (app)/error.tsx:13 passes area="page"; RouteError.tsx sentence template (~line 63) renders `We couldn't open {area?.trim() || "this page"}` -> 'We couldn't open page.'. revenue/ has no error.tsx at its root (only sub-routes), so /revenue home hits this boundary; it affects every (app) route without its own boundary.
- **Files to change:** `apps/web/src/app/(app)/error.tsx`
- **Fix steps:**
  1. Change area="page" to area="this page" (or drop the prop; RouteError defaults to 'this page').
  2. Add a comment/test that area is a bare noun phrase with determiner supplied by the caller when generic.
  3. Optionally add revenue/error.tsx with backHref '/revenue' area='Revenue'.
- **Acceptance:**
  - Render AppError: text reads 'We couldn't open this page.'
  - RouteError test for undefined area passes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /revenue/adjustments  —  `revenue/adjustments.html`

- **Source:** `apps/web/src/app/(app)/revenue/adjustments/page.tsx`
- **Design reference:** `redesign/revenue/adjustments.html`

### GAP-REVENUE-ADJUSTMENTS-02  ·  MEDIUM  ·  partly  ·  theme MISSING-FEATURE (was UUID)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** No adjustment register: there is no list endpoint, so the officer cannot see what was moved or reverse it; success only prints a raw id "Adjustment applied (id …)" (AdjustmentCreateForm.tsx:112, page.tsx:158-164).
- **Verified evidence:** apps/web/src/app/(app)/revenue/adjustments/page.tsx:158-164 states there is no list endpoint (only POST /v1/revenue/adjustments) and no maker-checker. Success message prints the raw id at AdjustmentCreateForm.tsx:283 (not :112). No reverse action. revenue-service is not in the snapshot, so a list/reverse endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/revenue/adjustments/AdjustmentCreateForm.tsx`, `apps/web/src/app/(app)/revenue/adjustments/page.tsx`, `revenue-service (GET /v1/revenue/adjustments, reversal)`
- **Fix steps:**
  1. Backend: add GET /v1/revenue/adjustments?assesseeId= (and reversal endpoint with maker-checker if policy requires).
  2. Capture fromDemand/toDemand/amount before the form resets (l.281-288) and set message to 'Moved ₹X from FY a to FY b' via formatMoney; drop the raw id.
  3. Replace the placeholder Card (page.tsx:158-164) with a DataTable register: date, from FY, to FY, amount, reason, by; loader with fetchJson and RefreshErrorState on error.
  4. Add Reverse action behind ConfirmDialog once backend supports it.
- **Acceptance:**
  - After submit the message names FYs and amount, no UUID.
  - Register lists the new adjustment after router.refresh().
  - Failed list fetch shows a retry state.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money movement between demands with no visibility is an audit gap; reversal needs approval rules (decision).
- **Depends on:** RefreshErrorState

### GAP-REVENUE-ADJUSTMENTS-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (Closed by f487f4c68 (owner decision #5, 2026-10-26))
  - principal only is movable; penalty/interest stay with their demand; cap = live DCB outstanding less retained charges, enforced server-side at request (422 + consumer) and again at approval; form shows the server-issued cap (adjustment-movable-cap/-route tests). Follow-up 4ecf0f3fa derives retained charges as net - principal + rebate (no double count).
- **W0 note:** partly fixed by #1868 — source-demand breakdown (principal/rebate/penalty/interest/net) and net-demand cap wording shipped; remaining: decision on whether penalty/interest may be moved, and confirming the cap matches the backend rule (UI still caps at netMinor, not DCB outstanding).
- **First-pass claim:** Amount cap is checked against the source demand netMinor, which includes penalty/interest, while the option label shows only "FY … — ₹… (status)" — the clerk cannot see which component is being moved (AdjustmentCreateForm.tsx:70-72,181).
- **Verified evidence:** Option labels show 'FY {fy} — {formatMoney(netMinor)} ({status})' at AdjustmentCreateForm.tsx:322 and 353 (cited :70-72,181 are wrong); cap check compares BigInt(amount) to fromDemand.netMinor at l.238 and the error text calls it 'outstanding balance'. mapDemands (adjustments/page.tsx:51-67) drops principal/penalty/interest/rebate although the same endpoint returns them (DemandRow in assessees/[id]/AssesseeDetailTabs.tsx:9-19 has them). Whether netMinor includes penalty/interest, and whether it is net of payments (DCB balance = demand - collected), is cannot-verify without revenue-service; UI columns suggest Net Demand is principal-rebate+penalty+interest, i.e. NOT outstanding after receipts, so the 'outstanding balance' wording may be wrong.
- **Files to change:** `apps/web/src/app/(app)/revenue/adjustments/page.tsx`, `apps/web/src/app/(app)/revenue/adjustments/AdjustmentCreateForm.tsx`, `revenue-service (movable-amount rule)`
- **Fix steps:**
  1. Extend DemandOption and mapDemands to keep principalMinor, penaltyMinor, interestMinor, rebateMinor, and an outstanding/balance field if the API supplies it.
  2. Show a breakdown panel under the From select (Principal/Penalty/Interest/Net) using formatMoney; keep amounts as minor strings/BigInt.
  3. Correct the cap message to name the real basis; if backend defines a movable amount, use it instead of netMinor.
  4. Decision: may penalty/interest be moved between demands? If not, cap at principal.
- **Acceptance:**
  - Selecting a source demand displays each component.
  - Cap error text matches backend rule; backend rejects over-cap with same limit.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money: a wrong cap lets a clerk move more than is owed; confirm rule with revenue finance and enforce server-side.

### GAP-REVENUE-ADJUSTMENTS-04  ·  LOW  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Picker is a full-page GET form; demand list fetch failure swaps the whole form for a bare badge with no retry (page.tsx:139-146).
- **Verified evidence:** apps/web/src/app/(app)/revenue/adjustments/page.tsx:111 the assessee picker is a GET form (true). On demands fetch failure (l.150-153) only the 'Raise Adjustment' area is replaced with a Card containing a bare DataSourceBadge; the picker card stays, so 'swaps the whole form' is overstated. No retry control. If the assessee list fails, header badge only (l.107) and an empty select. error.tsx exists but only for thrown errors.
- **Files to change:** `apps/web/src/app/(app)/revenue/adjustments/page.tsx`, `apps/web/src/app/_components/ds/RefreshErrorState.tsx`
- **Fix steps:**
  1. Replace the Card body at l.150-153 with <RefreshErrorState error={toHumanError('load',{area:'demands'})} backHref='/revenue'/>.
  2. If assesseesSource==='error', render RefreshErrorState instead of an empty select.
  3. Long term replace select with SmartCombobox (see ASSESSEES-04).
- **Acceptance:**
  - Simulate 500 on /assessees/:id/demands: retry button re-fetches and form appears.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState


---
## /revenue/analytics  —  `revenue/analytics.html`

- **Source:** `apps/web/src/app/(app)/revenue/analytics/page.tsx`
- **Design reference:** `redesign/revenue/analytics.html`

### GAP-REVENUE-ANALYTICS-01  ·  HIGH  ·  partly  ·  theme UUID (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Top Defaulters lists raw assessee UUIDs (column "Assessee ID") with no name, no link to the ledger and no DPDP role gate; a collections officer cannot act on a row without a lookup (AnalyticsConsole.tsx:96-105; types.ts DefaulterRow).
- **Verified evidence:** apps/web/src/app/(app)/revenue/analytics/AnalyticsConsole.tsx:304-309 columns are Rank, 'Assessee ID' (raw UUID), Outstanding; DefaulterRow (types.ts:350-354) carries only rank, assesseeId, outstandingMinor. No rowLinkKey so no link to /revenue/assessees/<id>; filter placeholder 'Filter by assessee ID…' (l.313). The real defect is usability (raw UUID, no drill-down); a UUID alone is not PII. There is no role gate (no revenue/layout.tsx exists) but that is a broader point. Names would need backend enrichment or a join with /assessees (capped at 200).
- **Files to change:** `apps/web/src/app/(app)/revenue/analytics/AnalyticsConsole.tsx`, `apps/web/src/app/(app)/revenue/analytics/types.ts`, `apps/web/src/app/(app)/revenue/analytics/page.tsx`, `revenue-service defaulters endpoint (add ownerName, identifierNo)`
- **Fix steps:**
  1. Backend: include ownerName and identifierNo in /revenue/analytics/defaulters rows.
  2. Extend DefaulterRow and mapDefaulters (page.tsx:71-86) with ownerName/identifierNo.
  3. Change columns to Owner, Identifier No, Outstanding; set rowLinkKey='assesseeId' rowLinkPrefix='/revenue/assessees/' on the DataTable.
  4. Update filter placeholder; if names are treated as sensitive, gate via role (decision).
- **Acceptance:**
  - Row shows owner and identifier, clicking opens the ledger.
  - No raw UUID visible in the table.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; names in a collections list are needed to act, confirm role visibility.

### GAP-REVENUE-ANALYTICS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed fetch each tab shows a badge and then its reassuring EmptyState ("No defaulters", "No arrears aging data") as if the data were empty (AnalyticsConsole.tsx:59-70,78-87,96-105) — a silent all-clear.
- **Verified evidence:** apps/web/src/app/(app)/revenue/analytics/AnalyticsConsole.tsx: Trends l.258-269, Aging l.283-286, Defaulters l.300-302 each render the amber badge (when source==='error') and then, because data defaulted to []/null, the EmptyState ('No trend data', 'No arrears aging data', 'No defaulters ... No assessees have an outstanding balance') as if genuinely empty. The Defaulters message is a false all-clear.
- **Files to change:** `apps/web/src/app/(app)/revenue/analytics/AnalyticsConsole.tsx`, `apps/web/src/app/_components/ds/RefreshErrorState.tsx`
- **Fix steps:**
  1. In each tab, branch first on source==='error' (and empty data) and render <RefreshErrorState error={toHumanError('load',{area:'trend data'})} backHref='/revenue'/> instead of the EmptyState.
  2. Keep the EmptyState only for source==='api' with genuinely empty data.
  3. Do the same in ForecastPanel if it has the same pattern (not checked).
- **Acceptance:**
  - Mock defaulters fetch failure: tab shows error+Retry, not 'No defaulters'.
  - Genuine empty list still shows the EmptyState.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes a misleading zero state on a money screen.
- **Depends on:** RefreshErrorState

### GAP-REVENUE-ANALYTICS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Top Defaulter Outstanding uses defaulters[0] with no sort guarantee and shows "—" both when the list is empty and when the defaulters fetch failed (page.tsx:145,167-169).
- **Verified evidence:** apps/web/src/app/(app)/revenue/analytics/page.tsx:145 topDefaulterOutstanding = defaulters[0]?.outstandingMinor; l.169 shows '—' when falsy, without consulting defaultersSource, so failed and empty look the same. mapDefaulters (l.71-86) preserves API order; the rank field exists but is not used to pick the top.
- **Files to change:** `apps/web/src/app/(app)/revenue/analytics/page.tsx`
- **Fix steps:**
  1. Compute top = defaulters.reduce by max BigInt(outstandingMinor) (or min rank) rather than index 0.
  2. If defaultersSource==='error' show '—' with the shared error badge; if empty and ok show ₹0.00 via formatMoney('0').
  3. Note: the StatCard label 'Top Defaulter Outstanding' should match the chosen rule.
- **Acceptance:**
  - Unsorted defaulters array still shows the max outstanding.
  - Failed defaulters fetch differs visually from empty.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REVENUE-ANALYTICS-05  ·  LOW  ·  partly  ·  theme DATEFMT (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Efficiency uses formatBps ("81.93%") while trend rows print the same via a different path; Period is the raw "2026-04" string (page.tsx:59-63; AnalyticsConsole.tsx:41).
- **Verified evidence:** The efficiency claim is wrong: the stat tile (page.tsx:163) and trend rows (AnalyticsConsole.tsx:249) both call the same formatBps, giving '81.93%'. True: Period is the raw string ('2026-04') in AnalyticsConsole.tsx:268 (cited page.tsx:59-63 is mapAging).
- **Files to change:** `apps/web/src/app/(app)/revenue/analytics/AnalyticsConsole.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatPeriod(period, granularity) in formatters.ts ('Apr 2026' for month, 'FY 2026-27' for fy).
  2. Use it via render on the Period column at l.268.
- **Acceptance:**
  - Monthly series shows 'Apr 2026'; FY series 'FY 2026-27'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; sort by raw period must stay correct (keep raw key for sort).


---
## /revenue/assessees  —  `revenue/assessees.html`

- **Source:** `apps/web/src/app/(app)/revenue/assessees/page.tsx`
- **Design reference:** `redesign/revenue/assessees.html`

### GAP-REVENUE-ASSESSEES-01  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Stats silently show 0 on a failed fetch (assessees defaults to [] and only the badge signals failure) — a false "0 registered assessees" (page.tsx:21-24,41-44).
- **Verified evidence:** apps/web/src/app/(app)/revenue/assessees/page.tsx:8-15 falls back to []; tiles at l.34-37 read assessees.length/filters so failure shows 0 (the source is only used for a header badge l.30 and the table card l.43-45).
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/page.tsx`, `apps/web/src/app/_components/ds/RefreshErrorState.tsx`
- **Fix steps:**
  1. Compute isError = source==='error'; render '—' for all four tiles when isError.
  2. Replace the card body badge (l.43-45) with <RefreshErrorState error={toHumanError('load',{area:'assessees'})} backHref='/revenue'/>.
- **Acceptance:**
  - Force API failure: tiles show '—' and a Retry state; success unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-REVENUE-ASSESSEES-02  ·  MEDIUM  ·  partly  ·  theme LABEL (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Type column prints the raw enum (property / water_connection) and status is derived client-side ("active"/"inactive") (AssesseesTable.tsx:19,26); the create form offers Trade and Other types that no StatCard or filter counts (AssesseeCreateForm.tsx:10-15).
- **Verified evidence:** Confirmed: Type column shows the raw enum (AssesseesTable.tsx:78, no render), so 'water_connection'. Status is derived client-side from isActive (l.71) which is fine. Create form offers Trade and Other (AssesseeCreateForm.tsx:10-15) while tiles count only property and water_connection (page.tsx:21-22,36-37), so tiles do not sum to Registered. Not a pagination/cap matter.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/AssesseesTable.tsx`, `apps/web/src/app/(app)/revenue/assessees/AssesseeCreateForm.tsx`, `apps/web/src/app/(app)/revenue/assessees/page.tsx`, `apps/web/src/app/(app)/revenue/assessees/assesseeTypes.ts (new)`
- **Fix steps:**
  1. Create assesseeTypes.ts exporting ASSESSEE_TYPES (value+label) and labelForType(); use in the create form and table render.
  2. Table Type column: render labelForType(row.assesseeType).
  3. Add tiles for Trade/Other or a single 'Other' tile so counts reconcile.
  4. Same label helper for /revenue/adjustments picker text.
- **Acceptance:**
  - 'water_connection' displays as 'Water Connection'.
  - Tile counts sum to Registered Assessees.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REVENUE-ASSESSEES-04  ·  LOW  ·  partly  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
  - [partial: backend ?q= search + exact total + tenant-wide summary and the server-paginated/searchable register page are done (0d58e77f5, 221abed7b); remaining: replace the ~10 limit=200 assessee pickers (bills/receipts/refunds/instalments/adjustments/recovery/write-offs) with a server-searching combobox (SmartCombobox is string-only, needs an id/label server-search variant) and add the truncation notice.]
- **First-pass claim:** Only 15 rows per page client-side after loading the full unpaged list from /assessees (page.tsx:8-13); other pages request ?limit=200 — pagination is inconsistent and large registers will truncate silently there (adjustments/page.tsx:83).
- **Verified evidence:** apps/web/src/app/(app)/revenue/assessees/page.tsx:8 requests /api/v1/revenue/assessees with no limit; AssesseesTable.tsx:89 pages 15 rows client-side (true). Pickers on bills/receipts/refunds/instalments/adjustments/recovery/write-offs use ?limit=200 (e.g. adjustments/page.tsx:70, cited :83 wrong), so registers >200 are silently truncated there. Whether the unpaged list call is truncated by a backend default is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/page.tsx`, `apps/web/src/app/(app)/revenue/assessees/AssesseesTable.tsx`, `apps/web/src/app/_components/SmartCombobox.tsx`, `apps/web/src/app/(app)/revenue/bills/page.tsx`, `apps/web/src/app/(app)/revenue/adjustments/page.tsx`, `revenue-service (search + total)`
- **Fix steps:**
  1. Backend: /assessees supports ?q=&page=&pageSize= and returns total.
  2. List page: server pagination and search.
  3. Replace the 7 lane pickers (limit=200 selects) with SmartCombobox doing server-side q search.
  4. Interim: show a notice when returned rows == limit.
- **Acceptance:**
  - Seed >200 assessees: the last one is findable and selectable in Adjustments.
  - List total is correct.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; picking the wrong assessee for a receipt/refund is the risk, so show identifier next to name.
- **Depends on:** GAP-REVENUE-ADJUSTMENTS-04


---
## /revenue/assessees/[id]  —  `revenue/assessees-detail.html`

- **Source:** `apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx`
- **Design reference:** `redesign/revenue/assessees-detail.html`

### GAP-REVENUE-ASSESSEES-DETAIL-01  ·  HIGH  ·  partly  ·  theme NAVIGATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** The ledger is read-only with no actions: generating a bill, recording a receipt, raising a refund or a plan each need a trip back to another lane and a re-pick of the same assessee from a 200-row select (page.tsx:99-147; other lanes' picker at bills/page.tsx:209-235).
- **Verified evidence:** apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx renders only stats, DCB card and read-only tabs (l.99-147): no action links. Not a dead route: sibling lanes accept ?assesseeId= (bills/page.tsx:257, receipts/page.tsx:232, refunds/page.tsx:175, instalments/page.tsx:176, adjustments/page.tsx:155, recovery, write-offs) so deep links are already supported. The picker at bills/page.tsx:~205-235 uses /assessees?limit=200 (l.116), so re-picking is required from a capped list.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx`
- **Fix steps:**
  1. Add an actions bar in PageHeader.actions with Link buttons: Generate bill (/revenue/bills?assesseeId=<id>), Record receipt (/revenue/receipts?assesseeId=), Raise refund (/revenue/refunds?assesseeId=), Instalment plan (/revenue/instalments?assesseeId=), Adjustment, Write-off, Recovery.
  2. Hide/disable actions the role cannot perform (reuse whatever permission helper the target pages use).
  3. Verify each target page preselects the assessee from the query (they take searchParams.assesseeId).
- **Acceptance:**
  - From an assessee ledger, click Record receipt lands on receipts page with that assessee already selected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REVENUE-ASSESSEES-DETAIL-02  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W2 revenue: already fixed on main — layout.tsx exists with ModuleGate moduleKey='revenue' + REVENUE_ROLES guard; closed by #2065)
- **W0 note:** partly fixed by #1868 — revenue/layout.tsx now gates /revenue/* behind REVENUE_ROLES (PermissionDenied for no revenue role; fails open on unknown roles); remaining: backend ledger-view audit event and role/masking policy decision.
- **First-pass claim:** DPDP: address, ward, contact are never shown here, but ownerName + identifier + full payment history render for any signed-in user with no role gate or masking (page.tsx:99-100,134-143).
- **Verified evidence:** apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx:99-100 shows ownerName, identifierNo, assesseeType and Ward in the header (ward IS shown, contrary to the note); address/contact are not rendered. Tabs show demands, bills and receipts (AssesseeDetailTabs.tsx:95-152). No role gate: there is no revenue/layout.tsx and no permission check on the page. Whether owner name and payment history are restricted data is a policy decision; municipal tax registers are often semi-public.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx`, `apps/web/src/app/(app)/revenue/layout.tsx (new)`, `revenue-service / policy-service (RBAC + view audit)`
- **Fix steps:**
  1. Decision: define which roles may see assessee ledger and receipt channels.
  2. Add revenue/layout.tsx with ModuleGate moduleKey='revenue' (same pattern as procurement/layout.tsx).
  3. Backend enforces role on /assessees/:id/* endpoints and emits a view audit event.
  4. Mask receipt channel/reference values only if they contain payer PII.
- **Acceptance:**
  - User without revenue permission gets PermissionDenied on /revenue/assessees/<id>.
  - Audit event exists for ledger view.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Over-restricting slows counter staff; under-restricting is a DPDP finding.

### GAP-REVENUE-ASSESSEES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Six independent fetches fold into one anyError badge that does not say which section failed; lists silently read 0 and the ledger tabs show "No … recorded" EmptyStates for failed sections (page.tsx:94,108-116; AssesseeDetailTabs.tsx:110,130,149,166).
- **Verified evidence:** apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx:87-94 folds six sources into anyError -> one generic badge (l.103). StatCards at l.115-117 use demandsResult.data.length etc., so failure shows 0. dcb null renders 'No demand-collection-balance entries yet.' (AssesseeDetailTabs.tsx:75) and Demands/Bills/Receipts/Instalment tabs show their EmptyStates (l.109-111,129-131,148-150,165-167) for failed sections. When the assessee itself fails, only the badge card shows (l.144-148).
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx`, `apps/web/src/app/(app)/revenue/assessees/[id]/AssesseeDetailTabs.tsx`, `apps/web/src/app/_components/ds/RefreshErrorState.tsx`
- **Fix steps:**
  1. Pass per-section source flags (dcbError, demandsError, billsError, receiptsError, instalmentsError) to AssesseeDetailTabs.
  2. In each tab, if its flag is set render <RefreshErrorState error={toHumanError('load',{area:'demands'})}/> instead of the empty state.
  3. StatCards: value '—' when the section errored.
  4. Replace the header-only badge with a message naming failed sections; replace the l.144-148 card with RefreshErrorState.
- **Acceptance:**
  - Fail only /receipts: Receipts tab shows error+Retry, other tabs unaffected, Receipts stat shows '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; prevents clerk concluding 'no receipts' when the read failed (money risk).
- **Depends on:** RefreshErrorState

### GAP-REVENUE-ASSESSEES-DETAIL-04  ·  LOW  ·  partly  ·  theme LABEL (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Receipts tab shows Reconciled as "Yes"/"No" plus a status pill with overlapping meaning (AssesseeDetailTabs.tsx:141-142).
- **Verified evidence:** AssesseeDetailTabs.tsx:141-142 shows Reconciled Yes/No and a Status pill side by side. The meanings likely differ (bank reconciliation vs receipt lifecycle), so overlap is not proven; column label is ambiguous. Nothing is fabricated; the theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/[id]/AssesseeDetailTabs.tsx`
- **Fix steps:**
  1. Rename column to 'Bank reconciled' and render as a pill (Reconciled/Pending), or drop it when status already implies it (confirm with revenue-service status enum).
  2. Add title text explaining each.
- **Acceptance:**
  - Column header clearly distinguishes reconciliation from receipt status.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REVENUE-ASSESSEES-DETAIL-05  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Fallback title is the literal "Assessee" when the record could not load (page.tsx:99).
- **Verified evidence:** apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx:99 title falls back to literal 'Assessee'. It only occurs when the assessee fetch errored (notFound() handles absent, l.83-85), and the body then shows just a badge. Cosmetic; not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessees/[id]/page.tsx`
- **Fix steps:**
  1. Use title 'Assessee unavailable' (or 'Assessee record') and render RefreshErrorState in the l.144-148 branch.
- **Acceptance:**
  - Failed assessee fetch shows an explicit error state with Retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-REVENUE-ASSESSEES-DETAIL-03


---
## /revenue/assessments  —  `revenue/assessments.html`

- **Source:** `apps/web/src/app/(app)/revenue/assessments/page.tsx`
- **Design reference:** `redesign/revenue/assessments.html`

### GAP-REVENUE-ASSESSMENTS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** Approve/Reject remission buttons are always enabled on every row, including assessments with no pending remission or that the same officer requested; the code comment admits the UI never pre-disables them and relies on the server to reject (AssessmentsTable.tsx:337-340,363-380).
- **Verified evidence:** AssessmentsTable.tsx:364-381 renders Approve/Reject Buttons with no `disabled` prop (Revise/Remit at 349,359 are disabled unless status==='active'); comment at 337-340 admits it. AssessmentRow (10-19) has no remission-status or requestedBy field, and no current-user id is passed in, so the UI has nothing to gate on today. Server-side maker!=checker is only asserted in dialog copy (~501); revenue-service is not in the snapshot so the server check is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessments/AssessmentsTable.tsx`, `apps/web/src/app/(app)/revenue/assessments/page.tsx`
- **Fix steps:**
  1. Backend: expose remissionStatus ('none'|'pending'|'approved'|'rejected') and remissionRequestedBy on GET /api/v1/revenue/assessments rows (confirm with revenue-service owners).
  2. Extend AssessmentRow type and page.tsx mapResponse to carry these fields; pass the signed-in user id (from session helper used elsewhere in (app)) to AssessmentsTable.
  3. In the actions column set disabled={row.remissionStatus!=='pending' || row.remissionRequestedBy===currentUserId} on Approve and Reject; add title/aria-describedby explaining why (e.g. 'You requested this remission; a different officer must decide').
  4. Disable Remit when remissionStatus==='pending' to prevent duplicate requests.
  5. Delete the NOTE comment at 337-340 and keep the server check as the authority.
- **Acceptance:**
  - Component test: row with remissionStatus 'none' renders Approve/Reject disabled.
  - Component test: pending row requested by current user has both disabled with explanatory text; pending row by another user enables them.
  - Manual: request remission as officer A, log in as A, buttons disabled; as B, enabled and decision succeeds.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals/maker-checker: UI gating must never replace server enforcement; wrong gating could block legitimate approvers if requestedBy is missing (default to enabled + server check when field absent).

### GAP-REVENUE-ASSESSMENTS-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw UUID entry: Assessee ID and Rate Head ID are free-text UUID fields with no picker or lookup, so a clerk must copy 36-character ids between screens (AssessmentCreateForm.tsx:54-55,118,136); the table then prints only "3fa85f64…" so the officer cannot tell which taxpayer a row belongs to (AssessmentsTable.tsx:328).
- **Verified evidence:** AssessmentCreateForm.tsx:54-55 validate only a UUID regex; inputs at 113-123 and 131-141 are plain text with UUID placeholders. AssessmentsTable.tsx:328 prints `assesseeId.slice(0,8)…` and the row has no owner name. No EntityPicker exists in the repo (Grep found none); SmartCombobox only takes string[]. Sibling pages already load `/api/v1/revenue/assessees?limit=200` (bills/page.tsx:116) and config/page.tsx:6 loads `/api/v1/revenue/rate-heads`, so the data for pickers exists.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessments/AssessmentCreateForm.tsx`, `apps/web/src/app/(app)/revenue/assessments/AssessmentsTable.tsx`, `apps/web/src/app/(app)/revenue/assessments/page.tsx`, `apps/web/src/app/(app)/revenue/_components/AssesseeSelect.tsx`
- **Fix steps:**
  1. Create shared revenue/_components/AssesseeSelect (native select or combobox, label `ownerName — identifierNo`) and RateHeadSelect, taking options as props.
  2. In assessments/page.tsx fetch assessees (?limit=200) and rate-heads server-side with fetchJson and pass to AssessmentCreateForm; replace the two UUID inputs, keep UUID_PATTERN as a guard on the selected value.
  3. Build id->name maps in page.tsx and pass to AssessmentsTable; render column 328 as ownerName plus identifierNo (fallback to short id) and add a rate head column.
  4. Add owner name to the create/revise/remit ConfirmDialog descriptions.
  5. Reuse AssesseeSelect in bills/instalments/receipts/recovery/bbps pages (they duplicate the inline select).
- **Acceptance:**
  - Component test: form submits the selected assessee's id; free-typed UUID no longer possible.
  - Table shows owner name and identifier for a row whose assesseeId is in the map; falls back to short id otherwise.
  - Manual: create an assessment without typing any UUID.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; risk of >200 assessees truncating the list (limit=200), so use search-as-you-type or server filter if register is larger.
- **Depends on:** GAP-REVENUE-BBPS-03

### GAP-REVENUE-ASSESSMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Money conversion uses parseFloat/Math.round (AssessmentsTable.tsx:21-25, AssessmentCreateForm.tsx:18-22) instead of the string-based rupeesToMinorString (lib/money.ts:28) used elsewhere — accepts "1e5" and >2 decimals and can drift on large values; paise is meant to be exact bigint.
- **Verified evidence:** Two local copies: AssessmentsTable.tsx:21-25 and AssessmentCreateForm.tsx:18-22 use parseFloat then Math.round(n*100); invalid/negative silently becomes "0". Validation (Form:57, Table:231) also uses parseFloat, so '1e5' and '12abc' pass, and '1.005' rounds to 100. Beyond 2^53 paise the float loses digits. Shared string-based rupeesToMinorString exists at apps/web/src/lib/money.ts:28 (rejects exponent, >2 decimals, zero, negatives) and is used in bbps/receipts. Same float pattern also in config/CreateRateSlabForm.tsx:23-38.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessments/AssessmentsTable.tsx`, `apps/web/src/app/(app)/revenue/assessments/AssessmentCreateForm.tsx`, `apps/web/src/app/(app)/revenue/config/CreateRateSlabForm.tsx`
- **Fix steps:**
  1. Delete both local rupeesToPaiseString functions; import rupeesToMinorString from '@/lib/money'.
  2. Replace parseFloat validation in AssessmentCreateForm.validate (line 57) and AssessmentsTable continueRevise (231) with `rupeesToMinorString(v)===null` -> field error 'Enter an amount in rupees with up to 2 decimals'.
  3. Send the returned string as baseValue / newBaseValue (lines 86, 248); never fall back to '0'.
  4. Note: rupeesToMinorString rejects zero; if a zero base value is legitimate, add an allowZero option to the helper (decision).
  5. Add an ESLint no-restricted-syntax rule for Math.round(*100) in apps/web.
- **Acceptance:**
  - Unit/component test: '1e5', '1.005', '-1', 'abc' show a field error and no request is sent.
  - '1234.5' posts baseValue '123450'.
  - grep shows no remaining parseFloat money conversion in revenue/.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money: currently a mistyped value can post an unexpected base value; the change tightens input, so a clerk who types '1,00,000' now gets an error (add a hint).

### GAP-REVENUE-ASSESSMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Stats show 0 and an empty-looking table region on a failed fetch; only a badge marks the failure (page.tsx:21-24,41-44).
- **Verified evidence:** page.tsx:18-22 derive counts from `data` which fetchJson defaults to [] on error, so StatCards (34-37) show 0/0/0/0; the only cues are the PageHeader badge (30) and DataSourceBadge inside the Card (8-9, only when list also empty). StatCard already renders '—' for null/undefined/NaN (ds/StatCard.tsx displayValue), so passing null on error is enough. RefreshErrorState exists at ds/RefreshErrorState.tsx (client wrapper with router.refresh()).
- **Files to change:** `apps/web/src/app/(app)/revenue/assessments/page.tsx`
- **Fix steps:**
  1. In page.tsx compute `const failed = source==='error'` and pass `value={failed ? null : n}` to the four StatCards.
  2. Replace the Card body branch at 8-12 with `<RefreshErrorState error={toHumanError('load',{area:'assessments'})} backHref='/revenue' />` when failed (import from @/lib/messages).
  3. Keep the PageHeader badge or drop it in favour of the error state; do not render AssessmentCreateForm-adjacent empty table.
  4. Apply the same pattern via a small shared helper used by bills, receipts, instalments, config.
- **Acceptance:**
  - Test/manual: force fetch failure (stop API) -> stats read '—' and a Retry button appears; Retry re-fetches.
  - Success path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure stale partial data is not shown as authoritative.
- **Depends on:** RefreshErrorState, GAP-REVENUE-BILLS-02, GAP-REVENUE-RECEIPTS-03, GAP-REVENUE-CONFIG-03

### GAP-REVENUE-ASSESSMENTS-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 revenue: renamed column label from 'Version' to 'Rev.' at AssessmentsTable.tsx:285; closed by #2065)
- **First-pass claim:** Version column is shown to clerks without any history/compare link (AssessmentsTable.tsx:331).
- **Verified evidence:** AssessmentsTable.tsx:331 shows a plain 'Version' column (right-aligned number) with no link. It is informational (revise bumps version), not a defect on its own. No history/compare route or endpoint for assessments exists in the web app (no revenue/assessments/[id]) and revenue-service is absent, so a compare link is a new feature.
- **Files to change:** `apps/web/src/app/(app)/revenue/assessments/AssessmentsTable.tsx`
- **Fix steps:**
  1. Decide whether version history is in scope; if not, drop the column or label it 'Rev.' with a help tip.
  2. If in scope: backend to expose GET assessments/{id}/versions; add revenue/assessments/[id]/page.tsx with a version table.
  3. Render version as a Link to that page from column 331.
- **Acceptance:**
  - Column either removed or links to a page listing prior versions with base value and revised-by/date.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; audit-trail visibility of revisions is the real value.


---
## /revenue/bbps  —  `revenue/bbps.html`

- **Source:** `apps/web/src/app/(app)/revenue/bbps/page.tsx`
- **Design reference:** `redesign/revenue/bbps.html`

### GAP-REVENUE-BBPS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** Fire-and-forget: there is no status endpoint (page.tsx:19-22), so a fetch or payment can fail in the biller adapter with no signal to the officer; the only trail is "check Bills or Receipts later" (FetchBillForm.tsx:43-46, PayBillForm.tsx:85-89).
- **Verified evidence:** bbps/page.tsx:14-21 explicitly states there is no status endpoint; FetchBillForm.tsx:43-47 and PayBillForm.tsx:85-89 only show a messageId acknowledgement. The page is a static server component with no data fetch. Backend (revenue-service adapter, message status) is not in the snapshot -> cannot verify whether a status/outbox read exists.
- **Files to change:** `apps/web/src/app/(app)/revenue/bbps/page.tsx`, `apps/web/src/app/(app)/revenue/bbps/FetchBillForm.tsx`, `apps/web/src/app/(app)/revenue/bbps/PayBillForm.tsx`
- **Fix steps:**
  1. Backend: add GET /v1/revenue/bbps/requests/{messageId} (status pending|succeeded|failed, fetched bill or receipt id, failure reason) and a list endpoint.
  2. Web: add a client hook polling that endpoint (with backoff, stop on terminal state) after submit; show status pill in the message area.
  3. On succeeded fetch, display bill amount/due date; on paid, link to the receipt in /revenue/receipts?assesseeId=.
  4. On failed/timeout show human error and a retry; add a 'Recent BBPS requests' Card on page.tsx.
  5. Update the 'About this screen' copy.
- **Acceptance:**
  - Component test with mocked poller: pending -> succeeded updates UI; failed shows retry.
  - Manual: submit pay-bill against a failing adapter and see failure surfaced within one poll interval.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Money: unknown payment outcome invites duplicate payments; until built, keep the idempotency on bbpsTxnId server-side.

### GAP-REVENUE-BBPS-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W2 revenue: added assessees prop to FetchBillForm and PayBillForm; server passes list; select replaces free-text; ownerName shown in ConfirmDialog; closed by #2065)
- **First-pass claim:** Assessee is a free-text identifier with no lookup or name echo; confirmation dialog repeats the same string, so a wrong-assessee payment is not caught (PayBillForm.tsx:227-241).
- **Verified evidence:** A ConfirmDialog already exists (PayBillForm.tsx:225-245, danger) and echoes amount, channel and the typed identifier (235-236), but the identifier is a free-text input (113-123) with no lookup or name echo, so the dialog cannot catch a wrong assessee. Fetch form has the same input (FetchBillForm.tsx:67-77). Mandatory reason / maker-checker do not apply: this is a single-step dispatch with no checker. Whether the BBPS identifier equals assessee.identifierNo is not visible (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/revenue/bbps/PayBillForm.tsx`, `apps/web/src/app/(app)/revenue/bbps/FetchBillForm.tsx`, `apps/web/src/app/(app)/revenue/bbps/page.tsx`
- **Fix steps:**
  1. Load assessees in bbps/page.tsx (same fetch as bills/page.tsx:116) and pass to both forms.
  2. Replace the free-text identifier with the shared AssesseeSelect (or add lookup-on-blur resolving typed identifier to ownerName via identifierNo).
  3. Show `ownerName — identifierNo` in the ConfirmDialog description and require the user to see it before 'Pay bill'.
  4. Confirm with backend which field the adapter expects (identifierNo vs id) and emit the audit event server-side.
- **Acceptance:**
  - Component test: entering an identifier not in the list shows 'No matching assessee' and blocks submit.
  - Dialog text contains owner name.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: wrong-assessee payment cannot be recalled from UI; lookup must not block legitimate identifiers absent from the first 200 records.
- **Depends on:** GAP-REVENUE-ASSESSMENTS-02

### GAP-REVENUE-BBPS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Channel list differs from Receipts (upi/netbanking/card here vs cheque/dd/pos there) and options show raw codes (PayBillForm.tsx:11,198-200).
- **Verified evidence:** PayBillForm.tsx:11 CHANNELS = online, counter, upi, netbanking, card; receipts/RecordReceiptForm.tsx:12 = online, counter, cheque, dd, pos. Options render the raw code (PayBillForm.tsx:198-200; Receipts:203). Whether the server enums differ is not verifiable without revenue-service.
- **Files to change:** `apps/web/src/app/(app)/revenue/bbps/PayBillForm.tsx`, `apps/web/src/app/(app)/revenue/receipts/RecordReceiptForm.tsx`, `apps/web/src/lib/revenue/channels.ts`
- **Fix steps:**
  1. Create lib/revenue/channels.ts exporting per-context channel lists with labels (Online, Counter, UPI, Net banking, Card, Cheque, Demand draft, POS).
  2. Use it in PayBillForm and RecordReceiptForm options: `{label}` displayed, code submitted.
  3. Confirm with backend whether BBPS payments should be limited to online/upi/netbanking/card and receipts' channel enum accepts them; align to one zod enum.
  4. Show the label in the confirm dialogs (PayBillForm:235, Receipts:301) and in the receipts table channel column.
- **Acceptance:**
  - Select shows human labels; POST payload still carries the code.
  - Unit test that every code in both lists has a label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong enum would 422 at the server, so verify with the API schema.
- **Depends on:** GAP-REVENUE-RECEIPTS-04

### GAP-REVENUE-BBPS-05  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** "Pay Bill" / "Pay bill" wording implies money movement; the copy says "record a BBPS payment" in the subtitle and "dispatches money movement" in the dialog — inconsistent (page.tsx:14, PayBillForm.tsx:236-238).
- **Verified evidence:** Subtitle bbps/page.tsx:10 says 'record a BBPS payment'; button/title 'Pay Bill' (PayBillForm.tsx:208,227-228) and dialog line 236-237 says 'dispatches money movement ... cannot be recalled'. The fields (bbpsTxnId 'from the biller') suggest a payment already made at the biller is being recorded, so wording is inconsistent about direction.
- **Files to change:** `apps/web/src/app/(app)/revenue/bbps/page.tsx`, `apps/web/src/app/(app)/revenue/bbps/PayBillForm.tsx`
- **Fix steps:**
  1. Decide with product whether the action initiates or records a payment.
  2. Use one verb everywhere (e.g. 'Record BBPS payment' or 'Submit payment') in subtitle, card title, button, dialog title and confirmLabel.
  3. Adjust dialog body accordingly (drop 'dispatches money movement' if it only records).
- **Acceptance:**
  - Grep shows a single consistent verb across subtitle, title, button and dialog.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wording only, but must match true behaviour for a money screen.


---
## /revenue/bills  —  `revenue/bills.html`

- **Source:** `apps/web/src/app/(app)/revenue/bills/page.tsx`
- **Design reference:** `redesign/revenue/bills.html`

### GAP-REVENUE-BILLS-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Generate Bill lists every non-paid demand, including ones that already have an issued bill; nothing prevents a second POST for the same assessmentId, and the async result is only an acknowledgement (GenerateBillForm.tsx:28,55-66).
- **Verified evidence:** GenerateBillForm.tsx:28 eligibleDemands = demands.filter(status!=='paid'); POST body is only assessmentId (57). BillRow (bills/page.tsx:27-34) has no demandId/assessmentId, so the client cannot tell which demands already have a bill; success text says 'submitted (id ...)' async (61-65). Server idempotency is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/bills/GenerateBillForm.tsx`, `apps/web/src/app/(app)/revenue/bills/page.tsx`
- **Fix steps:**
  1. Backend: add billed flag/billId to the demands payload (or demandId/assessmentId on bills) and enforce idempotency per assessment+period.
  2. Map the field in mapDemands/mapBills (page.tsx:69-112) and exclude/mark billed demands in eligibleDemands (GenerateBillForm:28), showing 'Bill issued' badge in the demands table.
  3. Disable submit while busy (already) and after success remove the selection until router.refresh returns.
  4. Add duplicate-bill warning text in the ConfirmDialog.
- **Acceptance:**
  - Test: demand with billed=true is not selectable.
  - Double-click submit sends one request.
  - Server returns 409 for a duplicate, shown as a human message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate bills cause wrong dues; server-side uniqueness is the real safeguard.

### GAP-REVENUE-BILLS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** KPIs show 0 for Demands/Outstanding/Bills Issued on a fetch failure; only the badge differs (page.tsx:158-160,251-255).
- **Verified evidence:** bills/page.tsx:157-160 computes overallSource; StatCards at 252-254 use demands.length / outstandingDemands / bills.length, which are 0 when fetchJson falls back to []. Only PageHeader badge (206) and DataSourceBadge inside cards (260-261, 278-279) mark failure. StatCard renders '—' for null.
- **Files to change:** `apps/web/src/app/(app)/revenue/bills/page.tsx`
- **Fix steps:**
  1. Pass `value={demandsResult.source==='error' ? null : ...}` (bills stat likewise from billsResult.source).
  2. When overallSource==='error' render RefreshErrorState above the stats/tables with backHref '/revenue'.
  3. Do not render GenerateBillForm when demands failed (it would show 'no eligible demands').
- **Acceptance:**
  - Force demands API failure: stats show '—', retry button visible, Generate Bill hidden.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-REVENUE-ASSESSMENTS-04

### GAP-REVENUE-BILLS-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pills print raw server strings (status ?? "unknown") — including "unknown" — for demands and bills (page.tsx:88,109).
- **Verified evidence:** bills/page.tsx:88 and :109 default a missing status to the string 'unknown'; the table renders it via cellType 'status' -> ds/StatusPill.tsx, whose map has no 'unknown' and falls back to a neutral pill, so users see raw lowercase server strings including 'unknown'.
- **Files to change:** `apps/web/src/app/(app)/revenue/bills/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Map missing status to null and let the column render '—' instead of 'unknown'.
  2. Add demand/bill statuses returned by the API (e.g. issued, partially_paid, generated) to StatusPill STATUS_MAP with tones; confirm enum values with API types.
  3. Use humanizeStatus for the label.
- **Acceptance:**
  - Row with missing status shows '—'; 'issued' shows a labelled pill with a defined tone.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REVENUE-BILLS-04  ·  LOW  ·  partly  ·  theme NAVUX (was STATUS)

- [x] **Status** (W2 revenue: already fixed on main — bills/page.tsx:238 option label uses humanizeStatus(a.assesseeType); closed by #2065)
- **W0 note:** partly fixed by #1868 — assessee option label now humanizes the enum on bills/page.tsx; remaining: shared AssesseeSelect not adopted (bills/receipts/refunds/recovery/write-offs/waivers/adjustments pickers are still inline GET-form selects, the latter six still print the raw assesseeType), no auto-submit.
- **First-pass claim:** Picker is a GET form that reloads the full page; the assessee option label exposes the identifier and the raw enum (page.tsx:228-233).
- **Verified evidence:** Picker is a GET <form> (bills/page.tsx:210-238) so View triggers a full server render; true. The option label `ownerName — identifierNo (assesseeType)` (230) intentionally includes the identifier to disambiguate namesakes; the raw enum assesseeType is the real blemish. Same pattern is copy-pasted in instalments, receipts, recovery pages.
- **Files to change:** `apps/web/src/app/(app)/revenue/bills/page.tsx`, `apps/web/src/app/(app)/revenue/_components/AssesseeSelect.tsx`
- **Fix steps:**
  1. Extract shared AssesseeSelect (see ASSESSMENTS-02) used by all five pages.
  2. Format assesseeType with humanizeStatus/prettifyEnum.
  3. Optionally auto-submit on change (client onChange -> router.push) and drop the View button, or keep GET form for no-JS.
- **Acceptance:**
  - Options read 'Sharma — PT-1023 (Residential)' instead of raw enum.
  - Selecting an assessee updates ?assesseeId= without a manual View click (if auto-submit chosen).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-REVENUE-ASSESSMENTS-02


---
## /revenue/config  —  `revenue/config.html`

- **Source:** `apps/web/src/app/(app)/revenue/config/page.tsx`
- **Design reference:** `redesign/revenue/config.html`

### GAP-REVENUE-CONFIG-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Category on Create Rate Head is free text (input ref, not a select), so "property", "Property" and "property tax" can fork the taxonomy (CreateRateHeadForm.tsx:15,51-54,147).
- **Verified evidence:** CreateRateHeadForm.tsx:15,34 category is a free-text input (146-156) validated only as non-empty (51); value trimmed and posted (72). RateConfigConsole.tsx:80 shows it as a plain column. Server-side category enum is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/config/CreateRateHeadForm.tsx`, `apps/web/src/app/(app)/revenue/config/types.ts`, `apps/web/src/app/(app)/revenue/config/RateConfigConsole.tsx`
- **Fix steps:**
  1. Confirm category taxonomy with backend (fixed enum vs open list).
  2. If fixed: replace the input with a <select> of the enum and add a CATEGORIES const in types.ts; if open: use <input list> fed by distinct existing rateHeads categories and normalise case (trim, lower/Title) before POST.
  3. Show the category label via prettifyEnum in the table (RateConfigConsole:80).
- **Acceptance:**
  - Cannot create 'Property' and 'property' as two categories.
  - Select shows all allowed categories.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; mixed categories would break grouping/reporting.

### GAP-REVENUE-CONFIG-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Zero KPIs on failure: Rate Heads 0 / Active 0 with the only cue a badge inside the first tab; no PageHeader badge unlike sibling pages (page.tsx:84-98; RateConfigConsole.tsx:66-67).
- **Verified evidence:** config/page.tsx:85-89 PageHeader has no `actions` badge (siblings pass DataSourceBadge). StatCards 92-95 use rateHeads.length etc., 0 on error. rateHeadsSource is only used to show DataSourceBadge inside the first tab when the list is empty (RateConfigConsole.tsx:66-67); slab/penalty/rebate errors only inside their tabs (107,173,215), and the Rebate result has no KPI.
- **Files to change:** `apps/web/src/app/(app)/revenue/config/page.tsx`, `apps/web/src/app/(app)/revenue/config/RateConfigConsole.tsx`
- **Fix steps:**
  1. In page.tsx set value null for StatCards when the corresponding source==='error' (rateHeadsSource for the first two, slabsResult.source, penaltyResult.source).
  2. Add PageHeader actions badge when any source is 'error'.
  3. When rateHeadsSource==='error' render RefreshErrorState instead of RateConfigConsole (otherwise the create forms appear against an unknown list).
- **Acceptance:**
  - Force rate-heads failure: KPIs '—', retry state shown, no empty 'Create the first rate head' prompt.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; misleading 'Create the first rate head' on failure could induce duplicate codes.
- **Depends on:** RefreshErrorState, GAP-REVENUE-ASSESSMENTS-04

### GAP-REVENUE-CONFIG-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W2 revenue: added existingSlabs prop to CreateRateSlabForm with band overlap check; RateConfigConsole passes slabs; test covers overlap error; closed by #2065)
- **W0 note:** partly fixed by #1868 — CreateRateSlabForm now uses rupeesToMinorString/percentToBps (allowZero), validates bandTo>bandFrom, rejects unparsable bandTo, and the table header reads "Rate Value (₹ / %)"; remaining: no overlap/gap check against existing same-effective-date bands (no existing slabs are passed to the form).
- **First-pass claim:** Slab rate unit changes with type (₹ for flat/band, % for ad_valorem) and is stored as paise or bps; the table prints "Rate Value" as ₹ or % in one column, and band gaps/overlaps are not validated client-side (CreateRateSlabForm.tsx:70-72; RateConfigConsole.tsx:133-137).
- **Verified evidence:** Unit switching is handled: form labels 'Rate (%)' vs 'Rate (₹)' (CreateRateSlabForm.tsx:70-72) and the table picks formatBps vs formatMoney (RateConfigConsole.tsx:133-137), so the cell shows ₹ or % explicitly; types.ts documents paise/bps. Real defects: local converters use Number()*100 + Math.round (Slab form 23-38, float, not rupeesToMinorString/percentToBps from lib/money.ts); no validation that bandTo>bandFrom or that bands don't overlap/gap (only bandFrom required, 80-85; an unparsable bandTo is silently dropped at 128-129).
- **Files to change:** `apps/web/src/app/(app)/revenue/config/CreateRateSlabForm.tsx`, `apps/web/src/app/(app)/revenue/config/RateConfigConsole.tsx`
- **Fix steps:**
  1. Replace rupeesToPaiseString/percentToBpsString with rupeesToMinorString and percentToBps from '@/lib/money' (note rupeesToMinorString rejects 0; add allowZero if bandFrom 0 is valid).
  2. Validate bandTo present => BigInt(bandTo) > BigInt(bandFrom); show field error.
  3. Pass existing slabs for the head into the form and reject overlap with same-effective-date bands; warn about gaps (client hint, server authoritative).
  4. Add unit suffix to the 'Rate Value' column header, e.g. 'Rate (₹ / %)' or split into two columns.
- **Acceptance:**
  - Unit test: bandFrom 0 / bandTo 100 with existing 50-200 band shows overlap error.
  - '12.345' rate rejected.
  - Table shows '₹1,200.00' for flat and '2.50%' for ad_valorem.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money: a wrong rate slab changes every computed demand; server must remain the authority on overlaps.
- **Depends on:** GAP-REVENUE-ASSESSMENTS-03

### GAP-REVENUE-CONFIG-05  ·  LOW  ·  partly  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Selecting a rate head navigates with router.push, reloading server data and resetting the scroll position; three tabs each repeat the selector (RateHeadSelector.tsx:35; RateConfigConsole.tsx:96,162,204).
- **Verified evidence:** RateHeadSelector.tsx:35 uses router.push to /revenue/config?rateHeadId=..., re-running the server page fetches (page.tsx:69-74); the selector is repeated in three tabs (RateConfigConsole.tsx:96,162,204). The `active` tab lives in client useState (55) so it survives the navigation, contradicting an implied reset; scroll reset is default router.push behaviour but was not verified in a browser. The three selectors read the same selectedId so they are in sync.
- **Files to change:** `apps/web/src/app/(app)/revenue/config/RateHeadSelector.tsx`, `apps/web/src/app/(app)/revenue/config/RateConfigConsole.tsx`
- **Fix steps:**
  1. Hoist a single RateHeadSelector above the tabs (shown for non-'Rate Heads' tabs).
  2. Use router.replace(url, { scroll:false }) inside startTransition to avoid history spam and scroll reset.
  3. Optionally store the active tab in the query string (?tab=) so reload keeps it.
- **Acceptance:**
  - Switching head keeps scroll and active tab; back button does not step through each head selection.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /revenue/instalments  —  `revenue/instalments.html`

- **Source:** `apps/web/src/app/(app)/revenue/instalments/page.tsx`
- **Design reference:** `redesign/revenue/instalments.html`

### GAP-REVENUE-INSTALMENTS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** The create request carries only instalmentCount and startDate — no demand selection and no amount — and the confirmation never states what total is being split, so the officer commits an assessee to a schedule without seeing the arrears figure (CreateInstalmentPlanForm.tsx:69-76,185-186).
- **Verified evidence:** CreateInstalmentPlanForm.tsx:69-76 posts {assesseeId, instalmentCount, startDate} only; ConfirmDialog (177-191, description 183-188) states count and raw ISO start date but no total, arrears, per-instalment amount, or assessee name. The page (instalments/page.tsx) does not fetch demands, so the form has no arrears figure. Demands endpoint /assessees/{id}/demands is used by bills/receipts pages. How the server chooses demands/total is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/instalments/page.tsx`, `apps/web/src/app/(app)/revenue/instalments/CreateInstalmentPlanForm.tsx`
- **Fix steps:**
  1. In page.tsx fetch /api/v1/revenue/assessees/{id}/demands (as bills/page.tsx getDemands) and compute outstanding total in BigInt from non-paid netMinor; pass `outstandingMinor` and assessee label to the form.
  2. In the ConfirmDialog show formatMoney(outstanding), count, approximate per-instalment amount (BigInt division, note remainder), formatIndianDate(startDate) and assessee name.
  3. Block/warn when outstanding is 0 or demands fetch failed.
  4. Ask backend whether the request should carry demandIds or expectedTotalMinor to avoid a race with new payments; add if supported.
- **Acceptance:**
  - Dialog for count=4 on ₹1,00,000 arrears shows ₹25,000.00 per instalment.
  - Zero-arrears assessee cannot submit.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money/approval: committing a schedule against an unseen amount; BigInt only, no floats.
- **Depends on:** GAP-REVENUE-INSTALMENTS-02

### GAP-REVENUE-INSTALMENTS-02  ·  MEDIUM  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Plan table has no schedule or per-instalment amount and no link to a plan detail; only totals (page.tsx:114-117).
- **Verified evidence:** instalments/page.tsx:108-118 columns are totalMinor, instalmentCount, startDate, status only; InstalmentPlanRow (14-20) has no schedule or per-instalment fields and no row link or detail route exists (no instalments/[id]). Whether the API can return schedule lines is cannot-verify. Theme DEADROUTE is inaccurate: nothing links to a dead route, the detail view is missing.
- **Files to change:** `apps/web/src/app/(app)/revenue/instalments/page.tsx`, `apps/web/src/app/(app)/revenue/instalments/[id]/page.tsx`
- **Fix steps:**
  1. Ask backend for GET /v1/revenue/instalments/{id} returning schedule lines (due date, amount, status).
  2. Add instalments/[id]/page.tsx with a schedule DataTable and plan header.
  3. Add a link column from page.tsx planColumns (e.g. render with next/link to /revenue/instalments/{id}); add derived 'Per instalment' column meanwhile.
- **Acceptance:**
  - Clicking a plan opens its schedule with N rows summing to total.
  - Table shows per-instalment amount.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-REVENUE-INSTALMENTS-01

### GAP-REVENUE-INSTALMENTS-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Instalments column is right-unaligned plain number while Total Due is right-aligned (page.tsx:114-115).
- **Verified evidence:** instalments/page.tsx:115 Instalments column has no `align`, while Total Due (114) is align:'right'; DataTable applies text-align from col.align (ds/DataTable.tsx:333) and 'num' class for right cells (380).
- **Files to change:** `apps/web/src/app/(app)/revenue/instalments/page.tsx`
- **Fix steps:**
  1. Add align: 'right' to the instalmentCount column.
- **Acceptance:**
  - Instalments header and cells right-aligned like Total Due.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /revenue/receipts  —  `revenue/receipts.html`

- **Source:** `apps/web/src/app/(app)/revenue/receipts/page.tsx`
- **Design reference:** `redesign/revenue/receipts.html`

### GAP-REVENUE-RECEIPTS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Total Collected sums amountMinor over every receipt regardless of status (page.tsx:150-157), so cancelled/reversed/refunded receipts inflate the figure shown next to "Reconciled".
- **Verified evidence:** receipts/page.tsx:150-156 reduces amountMinor over all receipts with no status filter (157 only counts 'reconciled'); shown as 'Total Collected' (228). Which statuses exist (cancelled/reversed) cannot be verified without revenue-service; ReceiptRow.status is an open string.
- **Files to change:** `apps/web/src/app/(app)/revenue/receipts/page.tsx`
- **Fix steps:**
  1. Confirm receipt status enum with backend (recorded, reconciled, cancelled, reversed...).
  2. Exclude non-collected statuses (define COLLECTED_STATUSES const) from the BigInt sum; keep BigInt.
  3. Optionally show 'Cancelled/Reversed' count or amount as a separate stat.
- **Acceptance:**
  - Test: receipts [100 recorded, 50 cancelled] -> Total Collected ₹1.00.
  - Reconciled count unchanged.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Money reporting: figure shown to officers overstates collections until fixed.

### GAP-REVENUE-RECEIPTS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed fetch the KPI reads "₹0.00" (BigInt 0n formatted) instead of "—" (page.tsx:150-157,228); the badge is the only cue.
- **Verified evidence:** receipts/page.tsx:150-156 reduce over [] returns 0n; line 228 passes formatMoney(0n) -> '₹0.00'. Failure cues: PageHeader badge (181) and DataSourceBadge in the table card (235-236) only. Note overallSource includes assessees/demands failures, so use receiptsResult.source for this KPI.
- **Files to change:** `apps/web/src/app/(app)/revenue/receipts/page.tsx`
- **Fix steps:**
  1. Set `value={receiptsResult.source==='error' ? null : formatMoney(totalCollectedMinor)}` on 'Total Collected'; same for Receipts and Reconciled counts.
  2. Render RefreshErrorState in the Receipts card when receiptsResult.source==='error'.
  3. Hide RecordReceiptForm demand selector with an error note if demandsResult.source==='error'.
- **Acceptance:**
  - Force receipts failure: Total Collected reads '—', retry visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-REVENUE-ASSESSMENTS-04

### GAP-REVENUE-RECEIPTS-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Channel select shows raw codes "dd" and "pos" (RecordReceiptForm.tsx:12,203); instrument/bank fields are shown for every channel, including online.
- **Verified evidence:** RecordReceiptForm.tsx:12 CHANNELS includes 'dd' and 'pos'; options render raw codes (202-206). Instrument No. (236-246) and Bank Name (248-258) are rendered unconditionally for all channels including online/counter; body sends them if non-empty (99-100).
- **Files to change:** `apps/web/src/app/(app)/revenue/receipts/RecordReceiptForm.tsx`, `apps/web/src/lib/revenue/channels.ts`
- **Fix steps:**
  1. Use shared channel labels (Cheque, Demand draft, POS terminal) from lib/revenue/channels.ts.
  2. Show Instrument No. and Bank Name only when channel is cheque or dd (required for these); clear both when channel changes to others.
  3. Optionally require instrument number for cheque/dd in validation.
- **Acceptance:**
  - Online channel hides instrument/bank fields and does not post them.
  - Cheque requires instrument number.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; confirm whether pos also needs a bank/terminal reference.
- **Depends on:** GAP-REVENUE-BBPS-04


---
## /revenue/recovery  —  `revenue/recovery.html`

- **Source:** `apps/web/src/app/(app)/revenue/recovery/page.tsx`
- **Design reference:** `redesign/revenue/recovery.html`

### GAP-REVENUE-RECOVERY-02  ·  MEDIUM  ·  confirmed  ·  theme NAVUX (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** No recovery register: no list endpoint, so referred assessees, status and outcome are invisible after the success line (page.tsx:111-120).
- **Verified evidence:** recovery/page.tsx:113-119 renders only a paragraph saying no list endpoint exists (POST /v1/revenue/recovery-referrals only); the form (RecoveryReferralCreateForm.tsx:47-53) posts {assesseeId, reason} and shows a one-line success. No register exists in the UI. Theme DATEFMT is wrong. Backend absent -> endpoint cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/recovery/page.tsx`, `apps/web/src/app/(app)/revenue/recovery/RecoveryReferralCreateForm.tsx`
- **Fix steps:**
  1. Backend: add GET /v1/revenue/recovery-referrals (optionally ?assesseeId=) returning id, assesseeId, reason, status, referredBy, referredAt.
  2. In page.tsx fetch it with fetchJson and render a DataTable (assessee name, status pill, formatIndianDate referredAt, reason) replacing the notice Card.
  3. Handle source==='error' with RefreshErrorState.
- **Acceptance:**
  - After referring, the new row appears in the register on refresh.
  - Empty and error states distinct.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Referrals are coercive and take effect immediately with no checker; visibility of who referred whom is an audit need.
- **Depends on:** GAP-REVENUE-RECOVERY-04

### GAP-REVENUE-RECOVERY-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 revenue: already fixed on main — page.tsx:12 tile description 'Refer an assessee\'s outstanding arrears for coercive recovery.'; closed by #2065)
- **First-pass claim:** Hub tile says "Refer defaulting demands for recovery action" (revenue/page.tsx:15) while the screen refers an assessee's whole arrears; scope of the referral is ambiguous.
- **Verified evidence:** Hub tile at revenue/page.tsx:17 (not 15) says 'Refer defaulting demands for recovery action', while recovery/page.tsx:64 and the form POST {assesseeId, reason} (Form:49-52) and dialog copy refer the assessee's whole outstanding arrears; no demand selection exists.
- **Files to change:** `apps/web/src/app/(app)/revenue/revenue/page.tsx`, `apps/web/src/app/(app)/revenue/recovery/page.tsx`
- **Fix steps:**
  1. Change tile description to 'Refer an assessee's outstanding arrears for coercive recovery.'
  2. Decide with product if referrals should be per-demand; if so it is a backend + form change (demand multi-select).
- **Acceptance:**
  - Tile text matches the screen subtitle and dialog scope.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; scope ambiguity on a coercive action.

### GAP-REVENUE-RECOVERY-04  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Page copy references "## BACKEND FOLLOW-UPS in this PR" — developer text shown to end users (page.tsx:116-118).
- **Verified evidence:** recovery/page.tsx:113-119 shows '<strong>## BACKEND FOLLOW-UPS</strong> in this PR' and API path text to end users. Same developer text in refunds/page.tsx:184, adjustments/page.tsx:161, write-offs/page.tsx:118; assessments table has a code comment only. Theme I18N is not accurate (it is developer leakage).
- **Files to change:** `apps/web/src/app/(app)/revenue/recovery/page.tsx`, `apps/web/src/app/(app)/revenue/refunds/page.tsx`, `apps/web/src/app/(app)/revenue/adjustments/page.tsx`, `apps/web/src/app/(app)/revenue/write-offs/page.tsx`
- **Fix steps:**
  1. Replace the paragraph in all four pages with user-facing copy (e.g. 'A register of referrals is not available yet.') or remove it once list endpoints exist.
  2. Move implementation notes to code comments/issue tracker.
  3. Add a CI grep/lint for 'in this PR' and '## ' in tsx strings.
- **Acceptance:**
  - grep -r 'in this PR' apps/web/src returns nothing.
  - Screen shows no endpoint paths or PR references.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-REVENUE-RECOVERY-02


---
## /revenue/refunds  —  `revenue/refunds.html`

- **Source:** `apps/web/src/app/(app)/revenue/refunds/page.tsx`
- **Design reference:** `redesign/revenue/refunds.html`

### GAP-REVENUE-REFUNDS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Checker has no way to find a pending refund: there is no list endpoint, so decisions depend on the maker relaying a UUID which the checker pastes into a lookup form (page.tsx:178-188, RefundLookupForm.tsx:7-24). Approvals can silently stall.
- **Verified evidence:** refunds/page.tsx:178-188 states revenue-service has no refund list endpoint (only POST /v1/revenue/refunds and PATCH .../decide plus GET by id) and offers RefundLookupForm (l.7-24), a UUID text input validated by regex that pushes to /revenue/refunds/<uuid>/decide. A checker has no discovery path. Backend list endpoint absence is stated by the page itself; revenue-service source not in snapshot so cannot verify independently.
- **Files to change:** `services/revenue-service (list endpoint, not in snapshot)`, `apps/web/src/app/(app)/revenue/refunds/page.tsx`, `apps/web/src/app/(app)/revenue/refunds/RefundLookupForm.tsx`, `apps/web/src/app/(app)/revenue/refunds/PendingRefundsTable.tsx`
- **Fix steps:**
  1. Backend: add GET /v1/revenue/refunds?status=pending (paged, tenant-scoped) returning id, receiptNo, assesseeName, amountMinor, reason, makerUserId, createdAt.
  2. In refunds/page.tsx add getPendingRefunds via fetchJson and render a 'Pending approval' DataTable (ds/DataTable) with a Decide link per row to /revenue/refunds/[id]/decide.
  3. Render a RefreshErrorState (not empty) when that loader errors; show StatCard 'Pending' as '—' on error.
  4. Keep RefundLookupForm only as a secondary fallback or remove it.
- **Acceptance:**
  - Manual: log in as checker; pending refunds listed without knowing any id.
  - Test: loader error renders retry state rather than 'No pending refunds'.
  - Contract test on the new list endpoint returns only status pending for the tenant.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** New list endpoint must be tenant-scoped and permission-guarded (checker role); refund amounts are sensitive financial data.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-02

### GAP-REVENUE-REFUNDS-02  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
  - Closed by 5f33bb455 (UAT B2): refunds list supports status=live&assesseeId=, page disables receipts with a pending/approved/processed refund (RefundCreateForm/page tests); POST /v1/revenue/refunds now answers 409 REFUND_ALREADY_EXISTS synchronously when the receipt already has a non-rejected refund (collection-routes.test.ts; consumer keeps its in-txn no-op as defence in depth). Partial refunds: closed by 7b239d61f (owner decision #1, 2026-10-26) — POST /v1/revenue/refunds takes an optional amountMinor, positive and never above the receipt (422 REFUND_EXCEEDS_RECEIPT), re-checked in the consumer; omitting it keeps the full-refund default; the raise-refund form has an optional amount field (refund-partial-amount/-consumer tests).
- **W0 note:** partly fixed by #1868 — receipts that already have a pending refund are disabled with "(refund pending)" in RefundCreateForm; remaining: already-approved/processed refunds are not flagged (only the pending list is loaded), partial-refund decision (POST still sends only receiptId+reason), server 409 on duplicates unverified.
- **First-pass claim:** Refund is raised on a receipt with no amount field — full receipt amount only — and the select does not mark receipts already refunded or pending refund, so duplicate refunds can be raised (RefundCreateForm.tsx:74-80,122-125).
- **Verified evidence:** RefundCreateForm.tsx posts only { receiptId, reason } (l.74-80), so full-receipt refund is the API contract as sent; there is no amount field. The receipt select (l.122-126) shows receiptNo, amount, channel and receipt status but nothing about existing/pending refunds, and refunds/page.tsx loads no refund list, so the UI cannot prevent duplicates. The submit button already has disabled/loading while busy (l.163). Whether the server rejects duplicate refunds is cannot-verify (revenue-service absent). Partial-amount refunds would need a backend contract change.
- **Files to change:** `apps/web/src/app/(app)/revenue/refunds/RefundCreateForm.tsx`, `apps/web/src/app/(app)/revenue/refunds/page.tsx`, `services/revenue-service (refund uniqueness check)`
- **Fix steps:**
  1. Decision: confirm with revenue owners whether partial refunds are in scope; if yes add amountMinor to POST body (backend).
  2. Backend/verify: reject a second non-rejected refund for the same receiptId (409) and expose refundedMinor/refundStatus on the receipts GET.
  3. In page.tsx mapReceipts add the refund flag once the API returns it; in RefundCreateForm mark such options disabled with '(refund pending)' suffix.
  4. Keep the existing confirm dialog and show the exact amount that will be refunded (already shown at l.191).
- **Acceptance:**
  - Manual: a receipt with a pending refund is not selectable.
  - Component test: disabled option for flagged receipt.
  - API test: second refund on same receipt returns 409.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate money-out. Server-side uniqueness is the real guard; UI marking is advisory.
- **Depends on:** GAP-REVENUE-REFUNDS-01

### GAP-REVENUE-REFUNDS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Page shows developer text "see ## BACKEND FOLLOW-UPS in this PR" to end users (page.tsx:182-185).
- **Verified evidence:** refunds/page.tsx:178-188 renders 'see ## BACKEND FOLLOW-UPS in this PR' and endpoint names (POST /v1/revenue/refunds, PATCH ...) inside the Refund register card to end users.
- **Files to change:** `apps/web/src/app/(app)/revenue/refunds/page.tsx`
- **Fix steps:**
  1. Replace the paragraph with user-facing copy: 'To decide a refund, open it from the Pending approval list or paste its reference below.'
  2. Remove <code> endpoint names and the PR reference; move follow-up notes to a code comment or ticket.
  3. When GAP-REVENUE-REFUNDS-01 lands, drop the lookup explanation entirely.
- **Acceptance:**
  - Grep for 'BACKEND FOLLOW-UPS' in apps/web/src returns no matches in rendered JSX.
  - Manual: the register card shows no developer wording.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-REVENUE-REFUNDS-01

### GAP-REVENUE-REFUNDS-04  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Success message asks the maker to "Use the refund register lookup below" and prints a raw id (RefundCreateForm.tsx:83-87).
- **Verified evidence:** RefundCreateForm.tsx:83-87 message reads 'Refund raised (id <uuid>), pending checker approval. Use the refund register lookup below to decide on it.' printing the raw id and pointing to the UUID lookup; also tells the maker to decide it, which maker-checker forbids.
- **Files to change:** `apps/web/src/app/(app)/revenue/refunds/RefundCreateForm.tsx`
- **Fix steps:**
  1. Change the success text to 'Refund raised for receipt <receiptNo> and sent for checker approval.' using selectedReceipt.receiptNo (capture before resetting state).
  2. Drop the raw id or show it as a short reference in a muted mono span with a copy control.
  3. Remove the 'decide on it below' instruction; say a different officer must approve.
- **Acceptance:**
  - Component test: success message includes receiptNo and no 36-char uuid.
  - Manual: raise refund; message has no lookup instruction.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-REVENUE-REFUNDS-01


---
## /revenue/refunds/[id]/decide  —  `revenue/refunds-detail-decide.html`

- **Source:** `apps/web/src/app/(app)/revenue/refunds/[id]/decide/page.tsx`
- **Design reference:** `redesign/revenue/refunds-detail-decide.html`

### GAP-REVENUE-REFUNDS-DETAIL-DECIDE-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** makerUserId is fetched and typed but never used: Approve stays enabled for the officer who raised the refund and the UI only warns in prose; the same-user rejection is left to a server response after an async submit (page.tsx:14,37; RefundDecideForm.tsx:24,47-51).
- **Verified evidence:** RefundRecord.makerUserId is typed (decide/page.tsx:14) and mapped (page.tsx:37) but never read again. RefundDecideForm.tsx:24 sets canDecide = refund !== null only, so Approve/Reject (l.70-91) are enabled for the maker; the maker-checker rule appears only as prose in the dialog (l.111-113) and the post-submit message (l.49-51). No session user id is available client-side: roleGuard.ts has getSessionRoles/TenantId/Name but no user id, though the JWT sub is decoded. Theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/revenue/refunds/[id]/decide/page.tsx`, `apps/web/src/app/(app)/revenue/refunds/[id]/decide/RefundDecideForm.tsx`
- **Fix steps:**
  1. In apps/web/src/lib/auth/roleGuard.ts add getSessionUserId() next to getSessionName(), returning decodeJwtPayload(token).sub (JwtPayload already declares sub) or null.
  2. In apps/web/src/app/(app)/revenue/refunds/[id]/decide/page.tsx call getSessionUserId() and pass currentUserId to <RefundDecideForm>.
  3. In apps/web/src/app/(app)/revenue/refunds/[id]/decide/RefundDecideForm.tsx compute isMaker = !!currentUserId && !!record.makerUserId && currentUserId === record.makerUserId; add it to canDecide so Approve and Reject are disabled.
  4. When isMaker, render a role=status line 'You raised this, so a different officer must decide it.' instead of the current prose-only warning in the dialog description.
  5. Keep the server-side maker!=checker rejection as the authority (UI check is a convenience; the server rejection message still surfaces in dialogError).
- **Acceptance:**
  - Component test: render RefundDecideForm with currentUserId === refund.makerUserId; both buttons are disabled and the explanatory status text is shown.
  - Component test: differing ids leave both buttons enabled and startDecide opens ConfirmDialog.
  - Manual: log in as the maker, open /revenue/refunds/<id>/decide; no request can be sent.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money-out approval. A wrong sub comparison could lock out legitimate checkers, so keep the server as authority and fail open only when the user id is unknown.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-01

### GAP-REVENUE-REFUNDS-DETAIL-DECIDE-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Decision buttons ignore status: a refund already approved/rejected still shows live Approve/Reject (RefundDecideForm.tsx:24).
- **Verified evidence:** RefundDecideForm.tsx:24 gates only on record presence. page.tsx:98 prints refund.status as raw text but the form never reads refund.status, so an approved/rejected refund still offers live Approve/Reject. After a successful decision (l.50-57) router.refresh() also leaves the buttons live. The actual status enum values live in revenue-service, absent from this snapshot.
- **Files to change:** `apps/web/src/app/(app)/revenue/refunds/[id]/decide/RefundDecideForm.tsx`, `apps/web/src/app/(app)/revenue/refunds/[id]/decide/page.tsx`
- **Fix steps:**
  1. Confirm the pending status literal with revenue-service (cannot-verify here); export it as a constant in a small revenue/statuses.ts.
  2. In RefundDecideForm derive isPending from refund.status and include it in canDecide.
  3. When not pending, replace the buttons with a StatusPill (ds/StatusPill) showing the outcome and a note 'Already decided'.
  4. After a successful submit, set a local decided state so buttons stay hidden until refresh returns the new status.
  5. Render status via StatusPill in page.tsx dl instead of the raw string.
- **Acceptance:**
  - Component test: status 'approved' hides Approve/Reject and shows the decided note.
  - Component test: status pending shows both buttons.
  - Manual: decide a refund, reload; buttons are gone.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** If the status literal is guessed wrong all refunds become undecidable; verify the enum first.
- **Depends on:** GAP-REVENUE-REFUNDS-DETAIL-DECIDE-01

### GAP-REVENUE-REFUNDS-DETAIL-DECIDE-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Assessee and Receipt are shown as raw 36-character UUIDs, and the dialog shortens the receipt to 8 characters, so the checker cannot verify the payer without another screen (page.tsx:79-87, RefundDecideForm.tsx:111-113).
- **Verified evidence:** decide/page.tsx:88-94 renders receiptId and assesseeId in <dd className=mono> as raw UUIDs; RefundDecideForm.tsx:110 shows receiptId.slice(0,8) in the dialog. The existing GET /api/v1/revenue/assessees/{id} and /assessees/{id}/receipts endpoints (used by refunds/page.tsx:60 and assessees/[id]/page.tsx) could supply the owner name and receiptNo, but this page fetches neither. The ConfirmDialog with mandatory rejection reason already exists (form l.98-107), so the theme fix text partly already done.
- **Files to change:** `apps/web/src/app/(app)/revenue/refunds/[id]/decide/page.tsx`, `apps/web/src/app/(app)/revenue/refunds/[id]/decide/RefundDecideForm.tsx`, `apps/web/src/app/(app)/revenue/refunds/types.ts`
- **Fix steps:**
  1. In decide/page.tsx after getRefund, Promise.all a getAssessee(refund.assesseeId) and getReceipts(refund.assesseeId) using fetchJson (copy loaders from assessees/[id]/page.tsx and refunds/page.tsx).
  2. Find the receipt by refund.receiptId; show receiptNo, receipt amount (formatMoney), channel, plus assessee ownerName and identifierNo; keep the UUIDs in a small muted 'Ref' line.
  3. Pass assesseeName and receiptNo into RefundDecideForm and use them in the dialog description instead of slice(0,8).
  4. If the lookups fail, show '—' and a muted note, not a block on deciding (refund core fields still load).
- **Acceptance:**
  - Manual: decide page shows owner name and receipt number, not UUID as primary text.
  - Component test: dialog description contains receiptNo and assessee name.
  - With assessee fetch failing, page still renders '—' without crashing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Extra fetches slow the checker page; parallelise. Mis-joined receipt would mislead a money decision, so match strictly on id.

### GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Not-found and server-error both produce the identical "Could not load refund" state with a generic badge (page.tsx:46-66); the route never calls notFound() (compare assessees/[id]/page.tsx:83).
- **Verified evidence:** decide/page.tsx:53 sets loadFailed = source === 'error' || !refund and shows one paragraph plus DataSourceBadge for both a 404 and 5xx/network failure (l.55-70); notFound() is never called, unlike assessees/[id]/page.tsx:83 which does notFound() when source !== 'error'. LoaderResult from fetchJson already carries status (apiClient.ts:125,144), so a real 404 is distinguishable.
- **Files to change:** `apps/web/src/app/(app)/revenue/refunds/[id]/decide/page.tsx`
- **Fix steps:**
  1. Import notFound from next/navigation in decide/page.tsx.
  2. Call notFound() when result.status === 404 (or !refund && source !== 'error').
  3. For other failures render <RefreshErrorState error={...} backHref='/revenue/refunds'/> (ds/RefreshErrorState, client wrapper with router.refresh retry) in place of the paragraph and DataSourceBadge.
  4. Keep RefundDecideForm receiving refund={null} so the buttons stay disabled.
- **Acceptance:**
  - Manual: nonexistent uuid renders the not-found page.
  - Manual: stop revenue-service; page shows retry state and Retry re-fetches.
  - Test: mock fetchJson status 404 vs 503 and assert notFound vs RefreshErrorState.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Ensure 401 (status 401) still maps to the error state, not not-found.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-04


---
## /revenue/trade-licenses  —  `revenue/trade-licenses.html`

- **Source:** `apps/web/src/app/(app)/revenue/trade-licenses/page.tsx`
- **Design reference:** `redesign/revenue/trade-licenses.html`

### GAP-REVENUE-TRADE-LICENSES-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Fee is typed in paise ("Fee (paise)", digits only) and defaults to "0" — a clerk can issue a licence for ₹0 by accident, and a missing zero changes the fee 10× (page.tsx:161,220-222).
- **Verified evidence:** trade-licenses/page.tsx:96 initialises feeMinor to '0'; l.220-222 renders label 'Fee (paise)' with a digits-only input; l.137 sends feeMinor.trim() || '0'. Validation (l.109-118) does not check fee, so a licence can be issued at 0 and the unit is minor units typed by hand. Other revenue forms (write-offs) already use rupeesToMinorString from @/lib/money with a rupee label.
- **Files to change:** `apps/web/src/app/(app)/revenue/trade-licenses/page.tsx`
- **Fix steps:**
  1. Replace feeMinor state with feeRupees string, label 'Fee (₹)', input type=text inputMode=decimal (same as WriteOffCreateForm amount).
  2. Validate with rupeesToMinorString(feeRupees) from @/lib/money; show error 'Enter a fee greater than zero' when null (or allow zero only via an explicit 'Exempt' checkbox after decision).
  3. Send feeMinor: rupeesToMinorString result; echo formatMoney(feeMinor) under the field and in a confirm step.
  4. Add a ConfirmDialog before POST showing licence no, business and formatted fee.
- **Acceptance:**
  - Unit: '2500.50' posts feeMinor '250050'; '' or '0' blocks submit.
  - Manual: typing 2500 shows ₹2,500.00 echo.
  - No paise-typed input remains on the page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Fee determines revenue; confirm with product whether ₹0 licences (exempt categories) are valid before hard-blocking.
- **Depends on:** GAP-REVENUE-WAIVERS-01

### GAP-REVENUE-TRADE-LICENSES-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises "renew, and cancel" but the page has no renew or cancel control; renewalCount is fetched and never shown (page.tsx:279,20).
- **Verified evidence:** page.tsx:279 subtitle says 'Issue, renew, and cancel'; file header (l.4) says the same and revenue/page.tsx:20 hub tile repeats it. The page only has the create form and read-only table (l.35-74, 244-305); no renew or cancel control exists. renewalCount is typed (l.29) but never rendered. Whether the revenue-service exposes renew/cancel commands is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/trade-licenses/page.tsx`, `apps/web/src/app/(app)/revenue/page.tsx`
- **Fix steps:**
  1. Short term: change PageHeader subtitle, file header comment and revenue/page.tsx tile description to 'Issue and track municipal trade licenses.'
  2. Add a 'Renewals' column showing renewalCount.
  3. If renew/cancel endpoints exist in revenue-service, add row actions with ConfirmDialog (cancel requires reason) as a follow-up; otherwise track as backend work.
- **Acceptance:**
  - Manual: subtitle and hub tile no longer promise renew/cancel.
  - Table shows renewal count per row.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None for copy change; implementing renew/cancel affects revenue, needs maker-checker decision.

### GAP-REVENUE-TRADE-LICENSES-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** feeRupees truncates to whole rupees (Math.trunc), so a ₹2,500.50 fee shows "2500" under "Fee (₹)" — paise silently dropped (trade-licenses/feeRupees.ts:16).
- **Verified evidence:** feeRupees.ts:14-16 returns Math.trunc(rupees).toString() where rupees = minorToRupeesOrNull(minor) = Number(minor)/100 (formatters.ts:150-155). 250050 displays '2500' under 'Fee (₹)' (page.tsx:44,66-67); paise are dropped, and Number() loses precision for very large values. formatMoney (formatters.ts:90) exists and keeps paise.
- **Files to change:** `apps/web/src/app/(app)/revenue/trade-licenses/feeRupees.ts`, `apps/web/src/app/(app)/revenue/trade-licenses/page.tsx`
- **Fix steps:**
  1. In page.tsx table cells replace feeRupees(l.feeMinor) and feeRupees(l.feePaidMinor) with formatMoney(...) from @/lib/formatters (returns '—' for null).
  2. Rename headers to 'Fee' and 'Paid' since the currency symbol is now in the value.
  3. Delete feeRupees.ts (and its tests, updating them to formatMoney) once unused.
  4. Right-align via tabular-nums class.
- **Acceptance:**
  - Unit: feeMinor '250050' renders ₹2,500.50.
  - null/undefined renders '—' without throwing (regression from UX-018).
  - grep finds no Math.trunc on money in trade-licenses.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; keep the null-guard behaviour UX-018 introduced.
- **Depends on:** GAP-REVENUE-TRADE-LICENSES-01

### GAP-REVENUE-TRADE-LICENSES-05  ·  MEDIUM  ·  confirmed  ·  theme TABLE (was DATEFMT)

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1868 — status pills now have distinct tones and expiry renders via formatIndianDate; remaining: still a hand-rolled <table> with no sort, filter/search or paging (no ds/DataTable).
- **First-pass claim:** Table is a plain <table> in a bare div: no sort, filter or paging, expiry printed as raw ISO (or "—") and status pills only distinguish good/warn/bad (page.tsx:40-70).
- **Verified evidence:** page.tsx:35-74 is a hand-styled <table> inside overflow div with 9 fixed columns; no sort, filter, search or paging. Expiry is printed as l.expiryDate ?? '—' (raw ISO string, l.65). Status pill maps only active->good, pending->warn, everything else bad (l.59), so expired, cancelled, suspended look identical. ds/DataTable exists (used in tenant-admin/page.tsx). Note formatIndianDate (formatters.ts:2) outputs dd/mm/yyyy, not 'dd Mon yyyy'.
- **Files to change:** `apps/web/src/app/(app)/revenue/trade-licenses/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace TradeLicensesTable with ds/DataTable (columns with sortable, status cellType) or ModuleListTable.
  2. Add a status filter and licence/business search above the table; page results client-side.
  3. Render expiry via formatIndianDate (or a new formatDate 'dd Mon yyyy' helper if that is the standard) and flag expired/soon-to-expire rows.
  4. Map each known status to a distinct pill (StatusPill) with neutral fallback.
- **Acceptance:**
  - Manual: click column header sorts; filter by status works.
  - Expiry 2026-03-31 renders in Indian format not ISO.
  - Expired and cancelled show different pills.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; purely presentational.

### GAP-REVENUE-TRADE-LICENSES-06  ·  LOW  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Failure shows 0 in every KPI and a sentence with no retry action (page.tsx:245-262,297-303).
- **Verified evidence:** page.tsx:271-273 and 284-287: on fetch failure loading=false and licenses=[], so the four StatCards show 0 (only the loading state shows '…'); the error is a single <p role=alert> at l.296-298 with no retry, though loadLicenses is available. Because this is a client component, ds/RefreshErrorState (router.refresh) would not re-run the useEffect fetch; use ds/ErrorState with onRetry={() => loadLicenses()}.
- **Files to change:** `apps/web/src/app/(app)/revenue/trade-licenses/page.tsx`
- **Fix steps:**
  1. Set StatCard values to '—' when fetchError is true.
  2. Replace the error paragraph with <ErrorState error={...} onRetry={() => void loadLicenses()} backHref='/revenue'/> from ds.
  3. Do not render the create form's 'No trade licenses found' branch on error (already so).
- **Acceptance:**
  - Manual: block the API; KPIs show '—' and Retry refetches.
  - Test: fetch rejects, StatCard values equal '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04


---
## /revenue/waivers  —  `revenue/waivers.html`

- **Source:** `apps/web/src/app/(app)/revenue/waivers/page.tsx`
- **Design reference:** `redesign/revenue/waivers.html`

### GAP-REVENUE-WAIVERS-01  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Money is typed in paise: "Amount (paise)" digits-only, placeholder "e.g. 50000 = ₹500" — the only revenue form that asks a clerk to enter minor units; a missed zero waives 10× the intended amount, and there is no cap against the demand's penalty/interest (page.tsx:39,124-127).
- **Verified evidence:** waivers/page.tsx:124-127 label 'Amount (paise)' digits-only with placeholder 'e.g. 50000 = ₹500' (l.44 validation only checks digits); no upper bound or zero check (regex allows '0'). The claim that it is the only revenue form asking for minor units is wrong: trade-licenses/page.tsx:220 also does (write-offs and refunds use rupees). A cap against the demand penalty/interest cannot be built from this page since it loads no demand data; the assessees/{id}/demands endpoint exists but its penalty/interest fields were not verified.
- **Files to change:** `apps/web/src/app/(app)/revenue/waivers/page.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Change field to 'Amount (₹)' text/decimal input using rupeesToMinorString from @/lib/money; reject zero.
  2. Show formatMoney of the entered value beneath the field and in the confirmation (see WAIVERS-02).
  3. After selecting a demand via a picker, fetch its penalty/interest outstanding (check GET /assessees/{id}/demands fields) and validate amount <= that; if the field is absent, ask backend to return it.
  4. Send amountMinor string as now.
- **Acceptance:**
  - Unit: '500' posts '50000'; '0' or '1.005' rejected.
  - Manual: amount above demand penalty shows inline error.
  - No 'paise' wording in the UI.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Remission of revenue; server must also enforce the cap (UI cannot be the only check).
- **Depends on:** GAP-REVENUE-WAIVERS-02, GAP-REVENUE-TRADE-LICENSES-01

### GAP-REVENUE-WAIVERS-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Submits a financial remission with no confirmation step and no context: assessee and demand are raw UUID text inputs (no lookup, no name/FY echo), and the single click posts immediately (page.tsx:43-57,95-107).
- **Verified evidence:** waivers/page.tsx:37-45 validate() only regex-checks two UUID text inputs (l.95-108); handleSubmit (l.50-75) posts straight to v1/revenue/waivers with no ConfirmDialog, no assessee name or FY echo, and no reason length rule. Compare write-offs/refunds, which use ds/ConfirmDialog. The page is a client component with no server loader, so no assessee/demand data is available.
- **Files to change:** `apps/web/src/app/(app)/revenue/waivers/page.tsx`, `apps/web/src/app/(app)/revenue/waivers/WaiverForm.tsx`, `apps/web/src/app/(app)/revenue/waivers/page.server.tsx`
- **Fix steps:**
  1. Split into server page.tsx (loads assessees via fetchJson like refunds/page.tsx:60, plus demands for chosen assessee like adjustments/page.tsx:78) and client WaiverForm.tsx.
  2. Replace both UUID inputs with an assessee select (GET form ?assesseeId=) and a demand select showing FY, due date and balance.
  3. Add ds/ConfirmDialog on submit showing assessee name, demand FY, waiver type and formatMoney(amount), noting checker approval is required.
  4. Keep zod/field validation at the boundary; disable submit while busy (already).
- **Acceptance:**
  - Manual: no UUID typed anywhere; submit opens dialog with names and amount.
  - Cancel in dialog sends no request.
  - Component test for validation of empty demand.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Financial remission; the confirm step is the main safeguard against mis-entry.
- **Depends on:** GAP-REVENUE-WAIVERS-01, GAP-REVENUE-WRITE-OFFS-01

### GAP-REVENUE-WAIVERS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 revenue: added pending waivers list to waivers/page.tsx, decide route already existed at waivers/[id]/decide; closed by #2065)
- **W0 note:** partly fixed by #1868 — waivers/[id]/decide route + WaiverDecideForm exist with maker!=checker and pending-status gating, and the hub tile text is now accurate; remaining: nothing in the UI links to or lists pending waivers (no pending list, lookup form or post-submit link), so a checker still needs the URL/id from the maker.
- **First-pass claim:** Hub tile promises "Raise and decide penalty/interest waivers" but the tree has no waivers/[id]/decide route and no list endpoint — checker step is not reachable from the UI (revenue/page.tsx:22 vs revenue/waivers/ contents).
- **Verified evidence:** revenue/page.tsx:22 tile: 'Raise and decide penalty/interest waivers (maker-checker)'. The revenue/waivers directory contains only page.tsx, loading.tsx and error.tsx; there is no waivers/[id]/decide route and the page has no lookup form (unlike refunds/write-offs). The comment at waivers/page.tsx:5 says no list endpoint yet. Whether revenue-service has a waiver decide endpoint is cannot-verify (service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/revenue/page.tsx`, `apps/web/src/app/(app)/revenue/waivers/[id]/decide/page.tsx`, `apps/web/src/app/(app)/revenue/waivers/[id]/decide/WaiverDecideForm.tsx`
- **Fix steps:**
  1. Confirm with revenue-service that PATCH /v1/revenue/waivers/:id/decide and GET /v1/revenue/waivers/:id exist (mirror refunds); if not, add them (backend).
  2. Create waivers/[id]/decide/page.tsx and WaiverDecideForm.tsx by copying the refunds decide pair, including maker!=checker guard and status gating.
  3. Add pending-waivers list once a list endpoint exists (see REFUNDS-01) and link from waivers/page.tsx.
  4. Until built, change the hub tile text to 'Raise penalty/interest waivers.'
- **Acceptance:**
  - Manual: a raised waiver can be opened and decided by a second officer.
  - Hub tile text matches what the page can do.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Approvals workflow; without decide path waivers may sit forever or be decided by another channel.
- **Depends on:** GAP-REVENUE-REFUNDS-01, GAP-REVENUE-REFUNDS-DETAIL-DECIDE-01

### GAP-REVENUE-WAIVERS-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Waiver Type "Both (Penalty + Interest)" has no way to split the amount between components (page.tsx:112-115).
- **Verified evidence:** waivers/page.tsx:112-115 offers penalty, interest and 'both' with a single amountMinor field (l.57-65 body); there is no per-component split and no way to record how the amount is apportioned. How the backend apportions a 'both' waiver is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/revenue/waivers/page.tsx`, `services/revenue-service (waiver command schema)`
- **Fix steps:**
  1. Decision: agree with revenue owners whether 'both' means one lump sum applied by rule or separate amounts.
  2. If separate, show two amount inputs (penalty, interest) when type is 'both' and send penaltyMinor/interestMinor (needs backend schema change).
  3. Otherwise remove 'both' or add helper text explaining the apportionment rule.
- **Acceptance:**
  - Manual: choosing 'both' shows either two amount fields or explanatory text.
  - Payload validated against the agreed schema.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong apportionment misstates penalty vs interest ledgers.
- **Depends on:** GAP-REVENUE-WAIVERS-01


---
## /revenue/write-offs  —  `revenue/write-offs.html`

- **Source:** `apps/web/src/app/(app)/revenue/write-offs/page.tsx`
- **Design reference:** `redesign/revenue/write-offs.html`

### GAP-REVENUE-WRITE-OFFS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Write-off amount is typed with no view of the assessee's outstanding arrears and no upper bound check (compare adjustments, which caps at the demand balance): the form posts { assesseeId, amountMinor, reason } for an irreversible balance reduction (WriteOffCreateForm.tsx:39-45,62-70).
- **Verified evidence:** WriteOffCreateForm.tsx:158-170 validates amount only via rupeesToMinorString (>0, 2dp); no outstanding balance is fetched (write-offs/page.tsx loads only assessees, l.45-50) and no cap is applied, unlike adjustments/AdjustmentCreateForm.tsx:72 which caps at fromDemand.netMinor. POST body (l.116-120) is { assesseeId, amountMinor, reason }. A ConfirmDialog exists (l.292-310) but shows only the amount, with no assessee name or balance, and reason is entered in-form, not via the dialog.
- **Files to change:** `apps/web/src/app/(app)/revenue/write-offs/page.tsx`, `apps/web/src/app/(app)/revenue/write-offs/WriteOffCreateForm.tsx`
- **Fix steps:**
  1. In write-offs/page.tsx when assesseeId is set fetch getDcb(assesseeId) (GET /assessees/{id}/dcb) and the assessee name; pass outstandingMinor and assesseeName to WriteOffCreateForm.
  2. Display 'Outstanding arrears ₹X' above the amount field; show 'after write-off' balance live.
  3. Add validation amount <= outstandingMinor using BigInt compare, error message like AdjustmentCreateForm l.72.
  4. Include assessee name, outstanding and new balance in the ConfirmDialog description; server must still enforce the cap.
- **Acceptance:**
  - Unit: amount > balance blocks submit with message.
  - Manual: balance shown before typing; dialog names the assessee.
  - If dcb fails, form shows an error and stays disabled rather than uncapped.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Irreversible reduction; failing closed when balance is unknown is safer.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-02

### GAP-REVENUE-WRITE-OFFS-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Checkers cannot discover pending write-offs: no list endpoint; they must paste a UUID from the maker into the lookup form (page.tsx:110-124, WriteOffLookupForm.tsx:7-24).
- **Verified evidence:** write-offs/page.tsx:114-122 says revenue-service exposes no write-off list endpoint and provides WriteOffLookupForm (UUID regex, push to /revenue/write-offs/<uuid>/decide). Checkers must get the UUID from the maker. Backend absence per the page's own text; revenue-service not in snapshot.
- **Files to change:** `services/revenue-service (list endpoint)`, `apps/web/src/app/(app)/revenue/write-offs/page.tsx`, `apps/web/src/app/(app)/revenue/write-offs/WriteOffLookupForm.tsx`
- **Fix steps:**
  1. Backend: add GET /v1/revenue/write-offs?status=pending (paged, tenant-scoped).
  2. Add getPendingWriteOffs loader in page.tsx and a 'Pending approval' DataTable with Decide links.
  3. Show RefreshErrorState on loader error rather than an empty table.
  4. Demote or remove WriteOffLookupForm.
- **Acceptance:**
  - Manual: checker sees pending write-offs and opens one with one click.
  - Test: loader error shows retry, not 'none pending'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** New endpoint must be role-guarded and tenant-scoped.
- **Depends on:** GAP-REVENUE-REFUNDS-01

### GAP-REVENUE-WRITE-OFFS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (Closed by 14204570f (owner decision #6, 2026-10-26))
  - demandId mandatory on new write-offs, FY taken from the demand, capped at that demand's live balance at create and approval; legacy rows untouched and flagged 'legacy, not linked' (writeoff-demand-mandatory test).
- **W0 note:** partly fixed by #1868 — WriteOffCreateForm has an optional demand selector that posts demandId+financialYear and the decide page shows the FY; remaining: demand is optional (decision to require it + backend contract pending) and the amount cap is against the assessee DCB balance, not the chosen demand.
- **First-pass claim:** Write-off is against the assessee, not a specific demand/FY, so the audit trail cannot say which year's demand was reduced (WriteOffCreateForm.tsx:62-70).
- **Verified evidence:** WriteOffCreateForm.tsx:116-120 posts { assesseeId, amountMinor, reason } with no demandId or financialYear, and the page has no demand selector; the decide page's WriteOffRecord (decide/page.tsx:7-14) carries none either. Whether the backend can accept/record a demandId is cannot-verify.
- **Files to change:** `services/revenue-service (write-off command schema)`, `apps/web/src/app/(app)/revenue/write-offs/WriteOffCreateForm.tsx`, `apps/web/src/app/(app)/revenue/write-offs/page.tsx`, `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx`
- **Fix steps:**
  1. Decision with revenue/audit owners: write-offs must reference a demand (or FY).
  2. Backend: accept demandId on POST, store it, return it on GET, include in audit event.
  3. UI: add demand select (GET /assessees/{id}/demands as adjustments/page.tsx:78) showing FY and balance; cap against that demand's balance.
  4. Show demand FY on the decide page.
- **Acceptance:**
  - API test: POST without demandId rejected (once required).
  - Manual: audit/decide screens show the FY reduced.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes the API contract for an irreversible action; needs migration for existing records.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-01

### GAP-REVENUE-WRITE-OFFS-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Developer text "see ## BACKEND FOLLOW-UPS in this PR" is shown to end users (page.tsx:115-120).
- **Verified evidence:** write-offs/page.tsx:114-120 renders 'see ## BACKEND FOLLOW-UPS in this PR' plus raw endpoint names to end users.
- **Files to change:** `apps/web/src/app/(app)/revenue/write-offs/page.tsx`
- **Fix steps:**
  1. Replace with user-facing copy about deciding from the pending list / pasting a reference.
  2. Remove <code> endpoint text and the PR reference.
  3. Delete the lookup explanation once WRITE-OFFS-02 lands.
- **Acceptance:**
  - grep 'BACKEND FOLLOW-UPS' in JSX returns nothing.
  - Manual: register card has no developer text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-02, GAP-REVENUE-REFUNDS-03


---
## /revenue/write-offs/[id]/decide  —  `revenue/write-offs-detail-decide.html`

- **Source:** `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx`
- **Design reference:** `redesign/revenue/write-offs-detail-decide.html`

### GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** makerUserId is fetched but never compared to the signed-in user: Approve is enabled for the maker of an irreversible balance reduction; enforcement is a post-submit server rejection (WriteOffDecideForm.tsx:24; page.tsx:10-12).
- **Verified evidence:** WriteOffRecord.makerUserId is fetched (decide/page.tsx:13,35) and never compared; WriteOffDecideForm.tsx:24 canDecide = writeOff !== null only, so the maker can Approve/Reject; the rule is prose at form l.113-114 and the post-submit text (l.49-50). No session user id helper exists in roleGuard.ts (sub is decoded in JwtPayload but not exposed).
- **Files to change:** `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx`, `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/WriteOffDecideForm.tsx`
- **Fix steps:**
  1. In apps/web/src/lib/auth/roleGuard.ts add getSessionUserId() next to getSessionName(), returning decodeJwtPayload(token).sub (JwtPayload already declares sub) or null.
  2. In apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx call getSessionUserId() and pass currentUserId to <WriteOffDecideForm>.
  3. In apps/web/src/app/(app)/revenue/write-offs/[id]/decide/WriteOffDecideForm.tsx compute isMaker = !!currentUserId && !!record.makerUserId && currentUserId === record.makerUserId; add it to canDecide so Approve and Reject are disabled.
  4. When isMaker, render a role=status line 'You raised this, so a different officer must decide it.' instead of the current prose-only warning in the dialog description.
  5. Keep the server-side maker!=checker rejection as the authority (UI check is a convenience; the server rejection message still surfaces in dialogError).
- **Acceptance:**
  - Component test: currentUserId === writeOff.makerUserId disables both buttons with explanation.
  - Differing ids: buttons enabled.
  - Manual: maker cannot open the confirm dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Irreversible balance reduction; share getSessionUserId with the refunds fix to avoid drift.
- **Depends on:** GAP-REVENUE-REFUNDS-DETAIL-DECIDE-01

### GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-02  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** The checker sees the write-off amount but not the assessee's outstanding arrears or which demand/FY it reduces, only a raw UUID (page.tsx:77-83).
- **Verified evidence:** decide/page.tsx:83-88 shows amount and assessee UUID only. The write-off record mapped at l.29-36 has no demandId or FY, so which demand is reduced cannot be shown from this record; the assessee-level DCB summary (GET /assessees/{id}/dcb: totalDemand, totalCollected, balance, used in assessees/[id]/page.tsx:24) and assessee name (GET /assessees/{id}) are available but not fetched here.
- **Files to change:** `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx`, `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/WriteOffDecideForm.tsx`
- **Fix steps:**
  1. In decide/page.tsx fetch getAssessee(writeOff.assesseeId) and getDcb(writeOff.assesseeId) with fetchJson (copy from assessees/[id]/page.tsx:16-27).
  2. Render owner name, identifierNo, and outstanding balance (formatMoney(dcb.balance)) with 'after write-off' figure = balance - amount.
  3. Replace assessee UUID with the name; pass the name into WriteOffDecideForm dialog (currently slice(0,8) at l.104).
  4. Warn when amount exceeds balance.
- **Acceptance:**
  - Manual: checker sees name and outstanding arrears next to write-off amount.
  - Dialog uses name not 8-char id.
  - dcb fetch failure shows '—' but does not enable blind decisions on missing core fields.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Wrong balance shown would mislead the checker; label it as at-time-of-view.
- **Depends on:** GAP-REVENUE-WRITE-OFFS-03

### GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Already-decided records still show live Approve/Reject (WriteOffDecideForm.tsx:24).
- **Verified evidence:** WriteOffDecideForm.tsx:24 canDecide ignores writeOff.status although decide/page.tsx:92 displays it; approved/rejected write-offs keep live buttons, and after a successful submit router.refresh() (l.47) does not hide them. Status enum values are in revenue-service (absent), so the pending literal is unverified.
- **Files to change:** `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/WriteOffDecideForm.tsx`, `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx`
- **Fix steps:**
  1. Confirm the pending status literal (cannot-verify); share a constant with refunds.
  2. Add isPending to canDecide in WriteOffDecideForm; when false hide buttons and show StatusPill plus 'Already decided'.
  3. Set a local decided flag after successful submit.
  4. Render status with StatusPill in page.tsx.
- **Acceptance:**
  - Component test: status 'approved' hides buttons.
  - Manual: decide then reload, no actions offered.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Wrong literal would block all decisions; verify first.
- **Depends on:** GAP-REVENUE-REFUNDS-DETAIL-DECIDE-02

### GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-04  ·  LOW  ·  confirmed  ·  theme FAILMASK (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1868, verified on main 9c5e9e9e9)
- **First-pass claim:** Not-found and server-error share one fail-closed message and never call notFound() (page.tsx:51-64).
- **Verified evidence:** decide/page.tsx:51 loadFailed = source==='error' || !writeOff; the one paragraph (l.63-68) plus DataSourceBadge covers 404 and server error alike; notFound() is never called. LoaderResult exposes status (apiClient.ts:144). Theme LOADING is wrong: loading.tsx exists; this is failure-masking.
- **Files to change:** `apps/web/src/app/(app)/revenue/write-offs/[id]/decide/page.tsx`
- **Fix steps:**
  1. Import notFound; call it when status===404.
  2. Otherwise render <RefreshErrorState error=... backHref='/revenue/write-offs'/>.
  3. Keep WriteOffDecideForm writeOff={null} so buttons stay disabled.
- **Acceptance:**
  - Manual: bad uuid gives not-found page.
  - Manual: backend down gives retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04


---
## Backend verification items (service code absent from snapshot)

### GAP-REVENUE-HOME-01  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hub has no module/role gate — No role or module gate in the revenue segment: there is no revenue/layout.tsx (finance/layout.tsx:36 and hr/layout.tsx wrap children in ModuleGate) and the page calls no requireAnyRole. Sidebar hides the entry via moduleKey "revenue" (ds/Sidebar.tsx:57) but the route opens by URL for any signed-in user. Revenue-service is absent from the snapshot (only services/hrms-service exists), so server-side role checks are undeterminable. (revenue/ has no layout.tsx; compare finance/layout.tsx:36).
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['GET /api/v1/revenue/* (hub loaders)']`
- **Question:** Do revenue-service endpoints enforce revenue roles/module entitlement themselves so a URL-typed hub cannot read data for users without them?
- **How to verify:** Open revenue-service auth hooks/policy registration; call each list endpoint with a token lacking revenue roles expecting 403.
- **Test to add:** Given signed-in HR-only user; when GET /api/v1/revenue/assessees; then 403.
- **Impact if wrong:** Unauthorised staff read assessee financial and personal data.
- **Web change if wrong:** Add revenue/layout.tsx with ModuleGate and requireAnyRole in revenue/page.tsx (web change is needed regardless).

### GAP-REVENUE-ADJUSTMENTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Closed by d3eca1f45 (owner decision #41, 2026-10-26))
  - the decide-step audit payload now carries fromDemandId, toDemandId and amountMinor (adjustment-decide-audit test).
- **First-pass claim:** Balance transfer between demands applies immediately with no maker-checker, unlike refunds/write-offs/waivers (AdjustmentCreateForm.tsx:283-300 says so explicitly); it can move arrears off a defaulter's oldest demand. Server-side controls undeterminable: revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/adjustments']`
- **Question:** Does a balance-transfer adjustment require a different approver (maker-checker) or a specific role, and is it audited with both demand ids?
- **How to verify:** Open revenue-service adjustments route/service; look for status pending/approved and checker!=maker rule. POST type=transfer as a single officer and check whether balances change immediately.
- **Test to add:** Given officer A creates a transfer between demands; when no second approval; then balances unchanged and status=pending; when B approves then applied and audit event has from/to demand.
- **Impact if wrong:** Fraud: arrears silently moved off a defaulter's demand.
- **Web change if wrong:** Add pending/approval state UI to AdjustmentCreateForm.tsx:283-300 and route transfer through approvals like refunds.

### GAP-REVENUE-ANALYTICS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Forecast writes a persisted run when "Save this run" is ticked (POST v1/revenue/analytics/forecast, persist:true) from a page that any signed-in user can open; no role or audit indication in the UI (ForecastPanel.tsx:53-59). revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/analytics/forecast (persist:true)']`
- **Question:** Is persisting a forecast run restricted to an analytics/finance role and audited?
- **How to verify:** Open the forecast handler in revenue-service; check role guard for persist=true and audit emit. POST persist:true with a read-only role expecting 403.
- **Test to add:** Given a read-only user; when POST forecast persist:true; then 403 and nothing stored; given authorised user then 201 plus audit event.
- **Impact if wrong:** Any user can write persisted records, polluting forecasts.
- **Web change if wrong:** Hide/disable 'Save this run' in ForecastPanel.tsx:53-59 unless user has the analytics-write role.

### GAP-REVENUE-ASSESSEES-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
  - Closed by 0d58e77f5 (UAT B2): POST pre-checks (tenant, identifierNo) and returns 409 DUPLICATE_IDENTIFIER before publishing (assessee-routes.test.ts), create form shows it inline (AssesseeCreateForm.test.tsx); unique index + DPDP note were already in.
- **First-pass claim:** Register form collects contact phone/email (DPDP personal data) with no consent or purpose note, and no duplicate-identifier check before submit (AssesseeCreateForm.tsx:79-95). revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/assessees']`
- **Question:** Does create reject a duplicate identifier (PAN/property id) with 409 and record purpose/consent for phone and email?
- **How to verify:** Open assessee create handler and DB unique index (tenantId, identifier); POST the same identifier twice and check status; check consent/purpose fields in the schema.
- **Test to add:** Given an existing assessee id; when POST same identifier; then 409 with a problem+json code; and a created assessee carries consent purpose in audit event.
- **Impact if wrong:** Duplicate assessee records split demands; DPDP non-compliance for contact data.
- **Web change if wrong:** Add consent/purpose note and 409 handling (inline field error) in AssesseeCreateForm.tsx:79-95.

### GAP-REVENUE-BBPS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Closed by 1a7d53c1f (owner decision #7, 2026-10-26))
  - no live BBPS in UAT; manual pay-bill stays disabled by default; fetch-bill issues a single-use 15-minute server token and pay-bill takes only that token (assessee + amount derived server-side); UI pays only a fetched bill (bbps-bill-token test).
- **First-pass claim:** "Pay Bill" is a manual entry of a BBPS transaction ID and amount typed by the officer; the page posts it to record a payment without any bill lookup, amount match or verification on screen, so a mistyped or invented BBPS Txn ID credits an assessee (PayBillForm.tsx:47-49,74-83). Server verification undeterminable: revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/bbps/fetch-bill', 'POST /api/v1/revenue/bbps/pay-bill']`
- **Question:** Does pay-bill verify the BBPS txn id against the BBPS/BBPCU gateway (bill match, amount match, uniqueness) before crediting?
- **How to verify:** Open pay-bill handler in revenue-service; check for BBPS adapter call/reconciliation, unique constraint on txnId, and amount equals fetched bill. POST an invented txnId.
- **Test to add:** Given unknown txnId; when POST pay-bill; then 422 and no receipt; given duplicate txnId then 409; given amount mismatch then 422.
- **Impact if wrong:** Fake payments credited to assessees: direct revenue loss.
- **Web change if wrong:** Make PayBillForm.tsx:47-49,74-83 use the bill returned by fetch-bill (readonly amount, server-issued token) rather than free typing.

### GAP-REVENUE-CONFIG-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Closed by bb2e7c5ca (owner decision #2, 2026-10-26))
  - rate configuration is maker-checker: revenue_admin proposes (POST /v1/revenue/rate-config/proposals), a different officer approves; edits end-date the old row and insert a new effective-dated version, deactivation is an end-date, the approver previews the effect on a computed demand first; legacy direct-write routes closed by default (rate-config-domain/-proposals tests).
- **First-pass claim:** Rate configuration is create-only: no edit, deactivate or end-date action exists for heads, slabs or rules, and creation posts immediately with no maker-checker or preview although these rows drive every demand, penalty and rebate computed by the rate engine (config/Create*Form.tsx POSTs; RateConfigConsole.tsx tables have no actions). Server audit/versioning undeterminable: revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/rate-heads', 'POST /api/v1/revenue/rate-slabs', 'POST /api/v1/revenue/penalty-rules', 'POST /api/v1/revenue/rebate-rules']`
- **Question:** Are rate rows versioned with effective dates, restricted to a config-admin role, audited, and is maker-checker enforced?
- **How to verify:** Open the rate config routes and schema: effectiveFrom/To, version column, overlap validation, role guard, audit. POST overlapping slab as non-admin.
- **Test to add:** Given an existing slab for a period; when POST an overlapping slab; then 409; given non-admin then 403; approved rows carry version and audit event.
- **Impact if wrong:** Wrong tax/penalty computed for every demand with no way to correct rows.
- **Web change if wrong:** Add edit/end-date/deactivate actions and preview in RateConfigConsole.tsx plus approval status column.

### GAP-REVENUE-INSTALMENTS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Closed by 0bd6191fa (owner decision #3, 2026-10-26))
  - instalment plans are created pending and need a different officer's approval (PATCH /v1/revenue/instalments/:id/decide, maker!=checker enforced in the consumer, audited); queue + decide UI (instalment-plan-approval test).
- **First-pass claim:** No maker-checker or approval on an instalment plan although it defers a demand; the flow is a single-officer create. Server checks undeterminable: revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/instalments']`
- **Question:** Does creating an instalment plan require approval by a second officer/role and audit the deferment?
- **How to verify:** Open instalments service: plan status lifecycle, approver rule, audit. Create plan as officer and check the demand's due date/state.
- **Test to add:** Given officer creates a plan; when no approval; then plan=pending and demand due date unchanged; after approver then active with audit event.
- **Impact if wrong:** Unauthorised deferment of dues.
- **Web change if wrong:** Show pending/approval state in CreateInstalmentPlanForm/page and add approve action.

### GAP-REVENUE-RECEIPTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Money-in mutation has no idempotency key: POST v1/revenue/receipts body carries no request id and the dialog re-enables after an error, so a retry after a network timeout can record the same UTR twice (RecordReceiptForm.tsx:91-102). Server de-duplication undeterminable: revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/receipts']`
- **Question:** Is POST receipts idempotent (Idempotency-Key header or unique tenant+UTR constraint) so a retry cannot record the same UTR twice?
- **How to verify:** Open receipts handler and DB migration for unique (tenantId, utr) or idempotency table; send the same POST twice with identical UTR.
- **Test to add:** Given receipt with UTR X exists; when POST the same body again; then 200 with same receipt id (or 409), and only one ledger entry exists.
- **Impact if wrong:** Double-credited payments; ledger and bank reconciliation break.
- **Web change if wrong:** Generate and send an Idempotency-Key per dialog open in RecordReceiptForm.tsx:91-102 and keep submit disabled until resolved.

### GAP-REVENUE-RECOVERY-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Closed by a487cd166 (owner decision #4, 2026-10-26))
  - recovery referral is maker-checker and allowed only after a demand notice is served and its notice period has lapsed (new demand-notices record + serve endpoint; period entered per notice, no statutory default assumed); legal-service is notified only on approval (recovery-referral-approval test).
- **First-pass claim:** Coercive recovery referral is a single-officer action that takes effect immediately with no maker-checker and no view of amount, age or notices before confirming (RecoveryReferralCreateForm.tsx:116-125); the request carries only assesseeId + reason. Server audit undeterminable: revenue-service is not in the /home/claude/civitas snapshot (services/ contains only hrms-service); every /api/v1/revenue/* contract is inferred from the client mappers and is undeterminable server-side.
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['POST /api/v1/revenue/recovery-referrals']`
- **Question:** Does a recovery referral need maker-checker, validate the assessee has overdue arrears and notices served, and emit an audit event?
- **How to verify:** Open recovery-referrals route: preconditions on arrears/notice, approval state, audit. POST for an assessee with no arrears.
- **Test to add:** Given assessee without overdue demand; when POST referral; then 422; given valid referral by officer A then status=pending until approver B; audit event emitted.
- **Impact if wrong:** Wrongful coercive action against a citizen; legal liability.
- **Web change if wrong:** Show amount, age, notices in RecoveryReferralCreateForm.tsx:116-125 and add pending/approve flow.

### GAP-REVENUE-TRADE-LICENSES-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Client fetches "/api/v1/revenue/trade-licenses" directly, not through /api/proxy like every other client call; the branding page documents that no Next route or rewrite serves /api/v1 to the browser (settings/branding/page.tsx:360-368), and next.config is absent from the snapshot, so the list may 404 and show only the failure sentence (page.tsx:252).
- **Service:** `revenue-service`  ·  **Endpoint(s):** `['GET /api/v1/revenue/trade-licenses (direct browser fetch)']`
- **Question:** Is /api/v1/* reachable from the browser via a gateway/Next rewrite, or must the page use /api/proxy/v1/*?
- **How to verify:** Check apps/web next.config rewrites and the gateway ingress for /api/v1 in the deployed environment; run the page and curl https://<host>/api/v1/revenue/trade-licenses with a session cookie.
- **Test to add:** Given the deployed web origin; when browser GET /api/v1/revenue/trade-licenses; then 200 JSON (not 404 HTML); e2e test on /revenue/trade-licenses lists rows.
- **Impact if wrong:** Page permanently shows the failure sentence; licences unmanageable.
- **Web change if wrong:** Switch page.tsx client fetch to /api/proxy/v1/revenue/trade-licenses (or fetchJson server-side) consistent with other pages.
