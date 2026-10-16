# Detailed gap file — module `analytics`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 77, BACKEND-VERIFY 2



---
## /analytics  —  `analytics/home.html`

- **Source:** `apps/web/src/app/(app)/analytics/page.tsx`
- **Design reference:** `redesign/analytics/home.html`

### GAP-ANALYTICS-HOME-01  ·  MEDIUM  ·  partly  ·  theme DUPLICATE (was OTHER)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Hub lists 'Dashboards' and 'Dashboards (legacy list)' side by side (page.tsx:9,11) — two routes over the same GET /api/v1/analytics/dashboards, one via _data.ts and one via the generic moduleLoader in _data/loaders.ts:1829; reviewers cannot tell which is canonical.
- **Verified evidence:** analytics/page.tsx:9,11 list Dashboards and 'Dashboards (legacy list)' with note 'Simple read-only list view'; so labelled as legacy but still duplicate. Two loaders confirmed: analytics/_data.ts:38 getAnalyticsDashboards (dashboards page) and loaders.ts:1829 moduleLoader used by list/page.tsx:2. Both hit /api/v1/analytics/dashboards.
- **Files to change:** `apps/web/src/app/(app)/analytics/page.tsx`, `apps/web/src/app/(app)/analytics/list/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Remove the legacy tile from page.tsx.
  2. Make list/page.tsx redirect('/analytics/dashboards') (keeps old bookmarks).
  3. Delete getAnalyticsDashboards export from loaders.ts:1829 once list page no longer uses it.
- **Acceptance:**
  - Hub shows one Dashboards tile.
  - /analytics/list redirects to /analytics/dashboards.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-LIST-01

### GAP-ANALYTICS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** loading.tsx renders stat-card placeholders and a table (loading.tsx:23-36) for the hub, which has neither; a screen that fetches nothing still flashes a data skeleton.
- **Verified evidence:** page.tsx renders ModuleHub with static links and fetches nothing, but the segment analytics/loading.tsx:23-36 renders 3 stat-card placeholders and a 6-row table; no page-level loading.tsx exists for the hub. Segment layout awaits ModuleGate (getEnabledModules), so the skeleton can flash. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/analytics/loading.tsx`, `apps/web/src/app/(app)/analytics/page.tsx`
- **Fix steps:**
  1. Make segment loading.tsx a generic header-only skeleton, or add analytics/loading.tsx variants per list page and keep the hub without stat/table blocks.
  2. Verify sub-routes with their own loading.tsx are unaffected.
- **Acceptance:**
  - Navigating to /analytics shows header + tile placeholders (or nothing), not table rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ANALYTICS-HOME-03  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Tile order mixes user tasks (Query Results) with a deprecated view and two similarly named insight surfaces, 'AI Insights' vs 'ML Insights' (page.tsx:14-15); notes do not say how they differ.
- **Verified evidence:** page.tsx:14-15 tiles AI Insights ('ML-powered insights and recommendations') and ML Insights ('Model performance, accuracy trends, and prediction explainability per domain') are distinct routes and the notes do differ somewhat, but AI Insights wording is vague and the deprecated list tile sits between task tiles (line 11). Overstated.
- **Files to change:** `apps/web/src/app/(app)/analytics/page.tsx`
- **Fix steps:**
  1. Reword notes: AI Insights 'Recommended actions generated for your modules'; ML Insights 'How well each prediction model performs'.
  2. Reorder: Dashboards, Query Results, KPI Library, Data Warehouse, AI Insights, ML Insights (legacy removed per HOME-01).
- **Acceptance:**
  - Two insight tiles are distinguishable from note text alone.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ANALYTICS-HOME-01

### GAP-ANALYTICS-HOME-04  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Hard-coded English strings in page.tsx:6-15 rather than next-intl keys.
- **Verified evidence:** analytics/page.tsx:6-15 pass hard-coded English title, description, labels and notes to ModuleHub. Many other pages in (app) use getTranslations/useTranslations (~418 files reference next-intl), so this is a divergence, though 21 pages use ModuleHub and likely share the pattern.
- **Files to change:** `apps/web/src/app/(app)/analytics/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add analytics.hub.* keys to messages/en.json (and hi.json).
  2. Make Page async, use getTranslations('analytics.hub') and pass t() results into ModuleHub links.
- **Acceptance:**
  - Switching locale to Hindi changes hub text.
  - No literal English left in page.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /analytics/ai-insights  —  `analytics/ai-insights.html`

- **Source:** `apps/web/src/app/(app)/analytics/ai-insights/page.tsx`
- **Design reference:** `redesign/analytics/ai-insights.html`

### GAP-ANALYTICS-AI-INSIGHTS-01  ·  HIGH  ·  partly  ·  theme PII

- [ ] **Status** (W2 analytics INTERIM — NEEDS OWNER DECISION: web parts are in place (CSV export is audited via exportAudit="analytics/ai-insights" and carries a data-use notice, AiInsightsTable.tsx). Per-module role filtering is a product decision: GET /v1/analytics/ai-insights currently ALWAYS returns [] (services/analytics-service/src/modules/kpi/routes.ts, no producer exists), so there are no rows to scope or leak yet. Decide the module-entitlement rule before the insight producer ships)
- **First-pass claim:** Insights are tenant-wide and role-agnostic (layout.tsx:5, page.tsx:8): rows named for HR, procurement or helpdesk (module column) are readable by every role and exportable to CSV (AiInsightsTable.tsx:39-40) with no DPDP purpose note or per-module role filter; server-side scoping cannot be verified.
- **Verified evidence:** analytics/layout.tsx:5 wraps only ModuleGate (tenant module-enabled check, ModuleGate.tsx), no role check; page.tsx:8 calls getAnalyticsAiInsights (loaders.ts:5334) and AiInsightsTable.tsx:39-40 sets exportable, so DataTable.downloadCsv (DataTable.tsx:274) exports the client-side rows with no audit/purpose note. True that the module column exists and any user who can open /analytics sees all rows. Whether rows contain personal data, and whether /api/v1/analytics/ai-insights scopes by role, cannot be verified (analytics service absent; only hrms-service in snapshot). Theme PII is speculative; rows are titles/confidence/action strings.
- **Files to change:** `apps/web/src/app/(app)/analytics/layout.tsx`, `apps/web/src/app/(app)/analytics/ai-insights/page.tsx`, `apps/web/src/app/(app)/analytics/ai-insights/AiInsightsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Confirm with analytics-service owners whether ai-insights rows can contain personal data and whether the API filters by caller role/module entitlement.
  2. If yes, filter rows server-side by module entitlement; in page.tsx drop rows for modules the caller cannot access.
  3. Add optional onExport?(rows) callback prop to DataTable and use it from AiInsightsTable to POST an audit event (export action, row count) via the existing audit client.
  4. Add a one-line data-use note under the table header when exportable (DPDP purpose).
  5. Do not add <Masked> unless a field is confirmed PII (no shared Masked component found under _components).
- **Acceptance:**
  - Manual: user without HR entitlement does not see module=HR insights.
  - Component test: clicking CSV in AiInsightsTable calls onExport once with row count.
  - Data-use note visible above table.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Hiding rows by role could silently change dashboards; audit call must not block download.

### GAP-ANALYTICS-AI-INSIGHTS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Read-only page shows an 'Actioned' status and 'New (Unread)' count (page.tsx:27-28) but no control marks an insight read or actioned and no link opens the source record; the stats cannot change from this UI.
- **Verified evidence:** page.tsx:27-28 derive New (Unread) and Actioned from r.status === 'New'/'Actioned'; AnalyticsAiInsightRow (loaders.ts:5325-5332) has no id or source-record reference, and AiInsightsTable.tsx has no row action, rowHref or mutate control. No [id] route under ai-insights. Counts are therefore read-only and cannot change from the UI.
- **Files to change:** `apps/web/src/app/(app)/analytics/ai-insights/page.tsx`, `apps/web/src/app/(app)/analytics/ai-insights/AiInsightsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decide product scope with backend: PATCH endpoint for insight status (read/actioned/dismissed) and a source link (moduleRoute + recordId) in the ai-insights payload.
  2. Extend AnalyticsAiInsightRow with id and optional sourceHref; map in getAnalyticsAiInsights.
  3. Add rowHref/actions column in AiInsightsTable using DataTable rowHref (exists, DataTable.tsx:56) and an ActionButton to mark actioned, calling a server action that emits an audit event.
  4. Until backend exists, relabel stats 'New' / 'Actioned' as informational or remove them.
- **Acceptance:**
  - Clicking Mark actioned moves the row to Actioned and decrements New count after refresh.
  - Row link opens the source record route.
  - Interim: no stat implies interactivity.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Adds a write path to a read-only page; needs authorization and audit.

### GAP-ANALYTICS-AI-INSIGHTS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was PII)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Avg. Confidence = parseInt of a display string like '84%' averaged over all rows (page.tsx:16-20); rows with unparsable text count as 0 and drag the average down; no explanation of what confidence means (automated-inference transparency, DPDP).
- **Verified evidence:** page.tsx:16-20 average = round(sum(parseInt(r.confidence,10)||0)/rows.length): unparsable values count as 0 in numerator and stay in the denominator, dragging the average down. Value 0 renders as '—' (line 29). confidence is typed string (loaders.ts:5328). No explanation of the metric anywhere (no HelpTip/Term). ds/ConfidenceBar.tsx exists but is not used. Suggested fix text in the finding (Masked) does not fit; real theme is data correctness/transparency.
- **Files to change:** `apps/web/src/app/(app)/analytics/ai-insights/page.tsx`, `apps/web/src/app/(app)/analytics/ai-insights/AiInsightsTable.tsx`
- **Fix steps:**
  1. Add parseConfidence(s): number|null (strip %, Number.isFinite, clamp 0-100) in a small helper and average only non-null values; show '—' if none.
  2. Add HelpTip/Term next to the Avg. Confidence label: 'Model-estimated likelihood the insight is correct; not a guarantee. Review before acting.'
  3. Optionally render the Confidence column with ConfidenceBar.
- **Acceptance:**
  - Unit test: ['84%','n/a','60%'] -> 72, not 48.
  - All-unparsable -> '—'.
  - Help text visible on focus/hover.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; changes displayed average.

### GAP-ANALYTICS-AI-INSIGHTS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** EmptyState tells the user to 'Enable the AI assistant in platform settings' (page.tsx:37) with no link; a non-admin cannot act, and the message is shown even when the AI assistant is on but has produced nothing.
- **Verified evidence:** page.tsx:36-37 rows.length===0 (after the errored branch at 32) shows EmptyState with text 'Enable the AI assistant in platform settings' and no action/link. It cannot distinguish 'AI disabled' from 'enabled but nothing generated yet'; no settings flag is read on this page. A non-admin gets an instruction they cannot act on.
- **Files to change:** `apps/web/src/app/(app)/analytics/ai-insights/page.tsx`
- **Fix steps:**
  1. Rewrite message to neutral: 'No insights have been generated yet. Insights appear here once the AI assistant has analysed your data.'
  2. If a tenant feature-flag reader exists (lib/moduleVisibility), show the 'Enable in Tenant Admin' link only when flag is off and user is admin; otherwise 'Ask your administrator'.
  3. Pass link via EmptyState action prop.
- **Acceptance:**
  - Empty response with AI on: neutral message, no settings instruction.
  - Non-admin sees 'contact administrator'; admin sees link to /tenant-admin.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ANALYTICS-AI-INSIGHTS-05  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** loading.tsx is a single blank block (loading.tsx:2); emoji icons and hex colours inline in page.tsx:26-29.
- **Verified evidence:** ai-insights/loading.tsx:2 is a single .skeleton div (same in kpi and data-warehouse loading.tsx), overriding the richer segment analytics/loading.tsx. Emoji icons and hex iconBg are inline at page.tsx:26-29 (also emptyIcon at AiInsightsTable.tsx:41).
- **Files to change:** `apps/web/src/app/(app)/analytics/ai-insights/loading.tsx`, `apps/web/src/app/(app)/analytics/ai-insights/page.tsx`, `apps/web/src/app/(app)/analytics/data-warehouse/loading.tsx`, `apps/web/src/app/(app)/analytics/kpi/loading.tsx`
- **Fix steps:**
  1. Replace loading.tsx with header + 4 stat placeholders + table placeholder (reuse Skeleton from ds/Skeleton.tsx or delete the route loading files so the segment loading.tsx applies).
  2. Replace emoji StatCard icons with StatIcon/lucide and iconBg hex with design token classes.
- **Acceptance:**
  - Throttled load shows stat and table placeholders, no layout shift.
  - No hard-coded hex in page.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** Shared analytics loading skeleton


---
## /analytics/dashboards  —  `analytics/dashboards.html`

- **Source:** `apps/web/src/app/(app)/analytics/dashboards/page.tsx`
- **Design reference:** `redesign/analytics/dashboards.html`

### GAP-ANALYTICS-DASHBOARDS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Dashboards can be listed but not opened: no row link or action (DashboardsTable.tsx:16-22) and no /analytics/dashboards/[id] route exists under the segment; the subtitle's 'widgets, layout and owner/shared access control' (page.tsx:24) is not reachable.
- **Verified evidence:** DashboardsTable.tsx:16-22 columns have no link/action and the DataTable call (46-53) passes no rowHref although DataTable supports rowHref (DataTable.tsx:56). No dashboards/[id] route exists (dir has only page.tsx and DashboardsTable.tsx). Subtitle at page.tsx:24 promises widgets/layout/access control. No getAnalyticsDashboardById loader; whether a detail endpoint exists cannot be verified (analytics service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/dashboards/page.tsx`, `apps/web/src/app/(app)/analytics/dashboards/DashboardsTable.tsx`, `apps/web/src/app/(app)/analytics/_data.ts`, `apps/web/src/app/(app)/analytics/dashboards/[id]/page.tsx`
- **Fix steps:**
  1. Confirm detail endpoint GET /api/v1/analytics/dashboards/:id with backend; if absent, shorten subtitle to 'Saved analytics dashboards.'
  2. Add getAnalyticsDashboardById in _data.ts using fetchJson.
  3. Create dashboards/[id]/page.tsx (+loading/error using RouteError) showing metadata, owner, visibility and widgets list.
  4. Pass rowHref={(r)=>`/analytics/dashboards/${r.id}`} in DashboardsTable.
- **Acceptance:**
  - Clicking a row opens detail page for that id.
  - Unknown id shows not-found; load failure shows RefreshErrorState.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Detail view must respect private visibility server-side.

### GAP-ANALYTICS-DASHBOARDS-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Error state is a badge plus '—' stats over an empty table (page.tsx:14,31-33; DashboardsTable.tsx:45-53): the table reads as 'no dashboards' rather than offering retry (compare kpi/page.tsx RefreshErrorState).
- **Verified evidence:** UX-013 already gates the stats: page.tsx:14,31-33 show '—' when source==='error'. DashboardsTable.tsx:45 renders DataSourceBadge (provenance) and then an empty DataTable (rows default []), so the table shows its generic empty state with no retry or explanation beyond the badge. kpi/page.tsx uses RefreshErrorState via toResourceState; dashboards does not. Stats claim in finding is outdated; missing retry is real.
- **Files to change:** `apps/web/src/app/(app)/analytics/dashboards/page.tsx`
- **Fix steps:**
  1. Import toResourceState and RefreshErrorState/toHumanError as in kpi/page.tsx:1-11.
  2. When errored render <RefreshErrorState error={toHumanError('load',{area:'dashboards'})} backHref='/analytics'/> in the Card instead of DashboardsTable.
  3. Keep DashboardsTable for non-error results; retain offline-cache behaviour by only bypassing when no cached data (check with useSeededResource if needed).
- **Acceptance:**
  - Mock API failure: card shows error with Retry, stats show '—'.
  - Empty success shows empty state, not error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Bypassing table may hide offline-cached rows; keep cache fallback.

### GAP-ANALYTICS-DASHBOARDS-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W2 analytics: closed by #2045; owner by name via hrms client (SF-17b #2033), missing visibility now renders an em dash (DashboardsTable.tsx, dashboards/[id]/page.tsx; DashboardsTable.test.tsx), and the list is now filtered server-side to owned/shared-with-me for non-admins (analytics-service dashboards/repo.ts listVisibleToActor + queries.ts listVisibleDashboards; tests/dashboards-list-visibility-real-db.test.ts, real DB))
- **W1 SF-17b note (#2033):** owner now shown by name (analytics-service resolves ownerName through hrms actorIds; unresolved shows "Unknown employee"). Left open: a missing visibility still renders as an "unknown" pill rather than "—", and server-side filtering of private dashboards is still unconfirmed.
- **W0-10 note:** review found the W0 tick partly — Owner column shows truncated opaque ownerId (DashboardsTable.tsx:24, _data.ts ownerId) not a name; missing visibility shows "unknown" pill not "—"; no evidence backend filters private dashboards server-side (fix step 4)
- **First-pass claim:** Visibility 'private' rows appear in a tenant-wide list; the page does not show owner, so a viewer cannot tell why they see or do not see a dashboard (owner column missing from AnalyticsDashboardRow, _data.ts:9-16).
- **Verified evidence:** _data.ts:9-16 AnalyticsDashboardRow has id,name,description,status,visibility,version only; mapper (47-54) reads no owner field, so owner cannot be shown. visibility defaults to 'private' when missing (line 52). Whether the API returns owner fields or filters private dashboards by caller cannot be verified (analytics service absent). Rows are tenant-list as returned by the API; the page does not itself filter.
- **Files to change:** `apps/web/src/app/(app)/analytics/_data.ts`, `apps/web/src/app/(app)/analytics/dashboards/DashboardsTable.tsx`
- **Fix steps:**
  1. Check API contract for owner (ownerId/ownerName) and add to AnalyticsDashboardRow and mapper.
  2. Add Owner column (name, fall back to '—').
  3. Do not default missing visibility to 'private'; use 'unknown' so a mapping gap is visible.
  4. Ask backend to confirm private dashboards are filtered server-side.
- **Acceptance:**
  - With owner in payload, column shows the name.
  - Missing visibility shows '—' not PRIVATE.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Showing owner names is personal data within tenant; fine but confirm.

### GAP-ANALYTICS-DASHBOARDS-04  ·  LOW  ·  partly  ·  theme NAVUX (was VALIDATION)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Version is printed as a bare number and status/visibility upper-cased in pills (DashboardsTable.tsx:19-21); duplicate route /analytics/list lists the same endpoint.
- **Verified evidence:** DashboardsTable.tsx:19-21 pass label={value.toUpperCase()} to StatusPill; 'shared'/'private' are not in STATUS_MAP (StatusPill.tsx) so they render neutral 'info'. version is a right-aligned number without 'v' prefix (line 21). Duplicate /analytics/list on the same endpoint is true (list/page.tsx:5). Cosmetic; theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/analytics/dashboards/DashboardsTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Drop toUpperCase and use StatusPill default humanizeStatus label.
  2. Add 'shared' and 'private' to STATUS_MAP with tones.
  3. Render version as `v${r.version}`.
  4. Handle duplicate route under GAP-ANALYTICS-LIST-01.
- **Acceptance:**
  - Pill shows 'Shared' with a tone.
  - Version shows v3.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-LIST-01


---
## /analytics/data-warehouse  —  `analytics/data-warehouse.html`

- **Source:** `apps/web/src/app/(app)/analytics/data-warehouse/page.tsx`
- **Design reference:** `redesign/analytics/data-warehouse.html`

### GAP-ANALYTICS-DATA-WAREHOUSE-01  ·  HIGH  ·  confirmed  ·  theme DATA (was OTHER)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Total Records is computed by stripping every non-digit from the string records and parseInt-ing it (page.tsx:14-16): '1.2 M' becomes 12 and '12,48,320' only works because it is plain digits; any abbreviated or decimal record count silently corrupts the total.
- **Verified evidence:** page.tsx:14-16 sums parseInt(r.records.replace(/[^0-9]/g,''),10). '1.2 M' -> 12, '1.5' -> 15, '2 Cr' -> 2. Indian-grouped '12,48,320' happens to work because commas are stripped (not only plain digits). records is typed string (loaders.ts:5312) so the API format is unknown; a NaN/empty record counts as 0 silently.
- **Files to change:** `apps/web/src/app/(app)/analytics/data-warehouse/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Ask backend for records as integer (recordCount) and add to AnalyticsDataWarehouseRow.
  2. Until then write parseRecordCount(s) that accepts only /^[\d,]+$/ and returns null otherwise.
  3. In page.tsx sum only non-null; if any row is null show total as '—' with 'partial' hint.
  4. Format with toLocaleString('en-IN').
- **Acceptance:**
  - Unit test: ['12,48,320','1.2 M'] -> total unavailable/partial, not 1248332.
  - Numeric input sums correctly.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong totals mislead capacity decisions.

### GAP-ANALYTICS-DATA-WAREHOUSE-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Subtitle promises 'refresh schedules' (page.tsx:22) but the table shows only Last Refresh; no schedule, no next-run, and no stale threshold, so a dataset that stopped refreshing is only visible if the API labels it something other than 'Healthy'.
- **Verified evidence:** Subtitle at page.tsx:22 says 'refresh schedules'. DataWarehouseTable.tsx:7-14 columns: dataset,lastRefresh,records,size,qualityScore,status; AnalyticsDataWarehouseRow (loaders.ts:5308-5315) has no schedule/nextRun/staleness. Only status signals staleness.
- **Files to change:** `apps/web/src/app/(app)/analytics/data-warehouse/page.tsx`, `apps/web/src/app/(app)/analytics/data-warehouse/DataWarehouseTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Short term: change subtitle to 'Consolidated datasets and data quality metrics.'
  2. If backend adds refreshSchedule/nextRun, extend row type and columns, and derive a Stale flag client-side from lastRefresh vs schedule.
- **Acceptance:**
  - Subtitle matches visible columns.
  - With schedule fields, overdue dataset shows Stale pill.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ANALYTICS-DATA-WAREHOUSE-03  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Attention = every status that is not exactly 'Healthy' (page.tsx:18), so a case difference ('healthy') or a new status value counts as a problem; Quality Score is an unparsed string, not sortable numerically.
- **Verified evidence:** page.tsx:17-18 use exact r.status === 'Healthy' (case-sensitive); anything else counts as Attention. Confirmed. Quality Score is a string but DataTable.compareValues (DataTable.tsx:160-171) falls back to localeCompare with numeric:true, so '92%' vs '100%' sort correctly; 'not sortable numerically' is overstated. StatusPill STATUS_MAP has no 'healthy' entry so it renders neutral.
- **Files to change:** `apps/web/src/app/(app)/analytics/data-warehouse/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Compare with r.status.toLowerCase()==='healthy'.
  2. Add healthy/degraded/stale tones to STATUS_MAP.
  3. Define a status union in AnalyticsDataWarehouseRow and count unknown values separately.
- **Acceptance:**
  - 'healthy' counts as Healthy.
  - Healthy pill is green.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ANALYTICS-DATA-WAREHOUSE-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W2 analytics: closed by #2045 — ALREADY-FIXED on main 60ff08f47: data-warehouse/page.tsx has no Run Query action (empty state is message-only); data-warehouse/loading.tsx = SkeletonTable (4 stat cards + filter + rows, Skeleton.tsx default statCards=4); data-warehouse/page.test.tsx passes)
- **First-pass claim:** Empty-state CTA 'Run Query' (page.tsx:33) is unrelated to why datasets are missing (events not yet processed); loading.tsx is a single blank block (loading.tsx:2).
- **Verified evidence:** page.tsx:35 EmptyState action is <a href='/analytics/queries' className='btn primary'>Run Query</a>, unrelated to missing datasets (message says events not yet processed). loading.tsx:2 is one blank .skeleton. Also plain <a> instead of Link.
- **Files to change:** `apps/web/src/app/(app)/analytics/data-warehouse/page.tsx`, `apps/web/src/app/(app)/analytics/data-warehouse/loading.tsx`
- **Fix steps:**
  1. Remove the Run Query action or replace with Refresh (router.refresh) / link back to Analytics.
  2. Replace loading.tsx with stats+table skeleton (see AI-INSIGHTS-05).
- **Acceptance:**
  - Empty state has no Run Query CTA.
  - Loading shows skeleton matching page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-AI-INSIGHTS-05


---
## /analytics/kpi  —  `analytics/kpi.html`

- **Source:** `apps/web/src/app/(app)/analytics/kpi/page.tsx`
- **Design reference:** `redesign/analytics/kpi.html`

### GAP-ANALYTICS-KPI-01  ·  HIGH  ·  confirmed  ·  theme DATA (was OTHER)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** On Target / Below Target / Improving are computed by string-matching the preformatted trend ('↑', '+') and comparing currentValue===target strings (kpi/page.tsx:14-18): a KPI where up is bad (file disposal days ↑) counts as On Target and Improving, and a falling vacancy rate (↓) counts as Below Target.
- **Verified evidence:** kpi/page.tsx:14 onTarget = trend.includes('↑') || currentValue===target; :15-17 belowTarget = total - onTarget; :18 improving = trend has '↑' or '+'. AnalyticsKpiRow (loaders.ts:5291-5298) has no direction/polarity or numeric fields, so a KPI where lower is better with ↑ counts On Target and Improving, and a ↓ falling vacancy is Below Target. Also a trend '+' only is 'Improving' but not 'On Target'. Counts can be misleading.
- **Files to change:** `apps/web/src/app/(app)/analytics/kpi/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/analytics/kpi/KpiTable.tsx`
- **Fix steps:**
  1. Ask backend for numeric currentValue, target, direction ('higher_better'|'lower_better') and a computed status (on_target/below/at_risk).
  2. Extend AnalyticsKpiRow and map; compute stats from status field, not strings.
  3. Until available, replace the three derived stats with only Total KPIs, or label them 'indicative'.
  4. Show a Status pill column in KpiTable.
- **Acceptance:**
  - Unit test: lower_better KPI at 12 vs target 10 counts as Below Target.
  - Stat cards equal counts of the API status field.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Executive dashboards would misreport performance; do not ship the heuristic.

### GAP-ANALYTICS-KPI-02  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Empty-state CTA 'Create Metric' links to /analytics/queries (kpi/page.tsx:35), which only runs whitelisted queries; no route creates a KPI, so the CTA promises something the app cannot do.
- **Verified evidence:** kpi/page.tsx:35 empty-state action links to /analytics/queries; that route exists (queries/page.tsx + RunQueryForm.tsx) for running queries, and there is no KPI create/edit route or loader in analytics/. 'Create Metric' promises something not offered.
- **Files to change:** `apps/web/src/app/(app)/analytics/kpi/page.tsx`
- **Fix steps:**
  1. Remove the action, or change to text 'No KPIs are configured. Contact your analytics administrator.'
  2. If KPI authoring is planned, add route and wire the CTA then.
- **Acceptance:**
  - Empty KPI page shows no Create Metric button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ANALYTICS-KPI-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [ ] **Status** (W2 analytics INTERIM — NEEDS OWNER DECISION: GET /v1/analytics/kpis returns placeholder em dashes for currentValue/target/trend/owner (services/analytics-service/src/modules/kpi/routes.ts) — there are no numeric values or units to format, so nothing fabricated is shown, but the numeric+unit contract (paise/percent/count/days, direction, target) is a KPI-definition feature that needs a product decision first)
- **First-pass claim:** Numeric values arrive as display strings (loaders.ts:5291-5298) — '₹ 48,25,000' vs '48.25 lakh' cannot be sorted or compared, and Current/Target sorting in DataTable is lexical; money paise->rupee conversion cannot be verified (backend absent).
- **Verified evidence:** loaders.ts:5291-5298 all KPI fields are strings; getAnalyticsKpis passes through getArrayPayload unmapped (5304). Mixed display formats cannot be compared. But DataTable.compareValues (DataTable.tsx:160-171) uses Number() then localeCompare numeric:true, so sorting is numeric-aware within one format, not purely lexical. Paise-to-rupee handling cannot be verified (analytics service absent); no money math occurs in web here.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/analytics/kpi/KpiTable.tsx`
- **Fix steps:**
  1. Backend: return value/target as numbers with unit ('INR_PAISE'|'PERCENT'|'COUNT'|'DAYS') and formatted label.
  2. Extend AnalyticsKpiRow; render via formatINR for paise units and add sortValue support in DataTable columns.
  3. Do not derive status from string equality (see KPI-01).
- **Acceptance:**
  - INR paise KPI 4825000000 renders ₹ 4,82,50,000.
  - Column sorts by numeric value across rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display; must follow paise rule.
- **Depends on:** GAP-ANALYTICS-KPI-01

### GAP-ANALYTICS-KPI-04  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W2 analytics: closed by #2045 — ALREADY-FIXED on main 60ff08f47: kpi/loading.tsx = SkeletonTable (4 stat cards + table shape, Skeleton.tsx))
- **First-pass claim:** loading.tsx is one undifferentiated block (kpi/loading.tsx:2) unlike the analytics segment loader with stat and table placeholders; layout shift on load.
- **Verified evidence:** kpi/loading.tsx:2 is a single .skeleton div; the analytics/loading.tsx segment loader is overridden by it for this route. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/analytics/kpi/loading.tsx`
- **Fix steps:**
  1. Replace with 4 stat placeholders + table skeleton (shared with AI-INSIGHTS-05).
- **Acceptance:**
  - Loading shows stat and table shapes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-AI-INSIGHTS-05

### GAP-ANALYTICS-KPI-05  ·  LOW  ·  partly  ·  theme DESIGN-TOKENS (was PII)

- [x] **Status** (W2 analytics: closed by #2045 — ALREADY-FIXED on main 60ff08f47: kpi/page.tsx has no hex literals (tone props); KpiTable.tsx exportAudit="analytics/kpi" emits the export audit; kpi/page.test.tsx passes)
- **First-pass claim:** Emoji stat icons and inline hex badge colours in page.tsx:24-27 instead of design tokens; CSV export exposes owner names with no DPDP note (KpiTable.tsx exportable).
- **Verified evidence:** kpi/page.tsx:24-27 use emoji icons and hex iconBg inline: true. KpiTable.tsx:39-40 exportable exports owner column as CSV with no note or audit; owner is a colleague name (low sensitivity), so the PII framing is overstated.
- **Files to change:** `apps/web/src/app/(app)/analytics/kpi/page.tsx`, `apps/web/src/app/(app)/analytics/kpi/KpiTable.tsx`
- **Fix steps:**
  1. Replace emoji/hex with StatIcon and token classes.
  2. Optionally reuse the export onExport audit hook from AI-INSIGHTS-01.
- **Acceptance:**
  - No hex literals in page.tsx.
  - Export emits audit event if hook adopted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-AI-INSIGHTS-01


---
## /analytics/list  —  `analytics/list.html`

- **Source:** `apps/web/src/app/(app)/analytics/list/page.tsx`
- **Design reference:** `redesign/analytics/list.html`

### GAP-ANALYTICS-LIST-01  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE (was VALIDATION)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Duplicate of /analytics/dashboards over the same endpoint (list/page.tsx:5 vs dashboards/page.tsx:8) with a generic mapping; two different stat/badge behaviours for one dataset.
- **Verified evidence:** list/page.tsx:5 uses loaders.ts:1829 moduleLoader (ModuleRowSummary via mapModuleRows) while dashboards/page.tsx:7 uses _data.ts getAnalyticsDashboards; same /api/v1/analytics/dashboards. List has no stats, badge behaviour differs (ModuleListTable vs DashboardsTable). Only referenced by hub tile.
- **Files to change:** `apps/web/src/app/(app)/analytics/list/page.tsx`, `apps/web/src/app/(app)/analytics/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Replace list/page.tsx body with redirect('/analytics/dashboards') from next/navigation.
  2. Remove hub tile and the getAnalyticsDashboards moduleLoader export.
- **Acceptance:**
  - /analytics/list lands on /analytics/dashboards.
  - tsc passes with export removed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-HOME-01

### GAP-ANALYTICS-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme UX-COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1934, verified on main 101076c1a)
- **First-pass claim:** Raw record id shown to users: ModuleListTable prints row.id.slice(0, 8) in an ID column (ModuleListTable.tsx:46) — an internal identifier with no meaning to a clerk.
- **Verified evidence:** ModuleListTable.tsx:71,81 renders an ID column with row.id.slice(0,8) in mono (finding cited line 46; actual 81). It is a shared component, so every ModuleListPage in the app shows truncated internal ids.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Remove the ID <th>/<td> (or gate with showId prop default false).
  2. Check other ModuleListPage consumers for tests relying on the column.
- **Acceptance:**
  - No ID column in rendered table.
  - Row key still uses row.id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Affects all module list pages; support staff lose quick id reference.

### GAP-ANALYTICS-LIST-03  ·  LOW  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W2 analytics: closed by #2045 — ALREADY-FIXED on main 60ff08f47: list/page.tsx is a redirect to /analytics/dashboards, no API wording left; list/page.test.tsx passes)
- **First-pass claim:** Title 'Analytics — Dashboards', description 'Read-only list loaded from the Analytics service API.' (list/page.tsx:8-9) exposes implementation wording; 'Records' card and 'Detail'/'Meta' columns are generic. Table has no filter/sort/pager, unlike sibling pages.
- **Verified evidence:** list/page.tsx:8-9 title 'Analytics — Dashboards' and description 'Read-only list loaded from the Analytics service API.' (implementation wording); ModuleListTable.tsx:58 Card 'Records', headers 'Detail','Meta' (73,75); plain <table> with no filter, sort or pager. Not a dead route issue. Moot if list route is redirected.
- **Files to change:** `apps/web/src/app/(app)/analytics/list/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Preferred: redirect route (LIST-01) and close this.
  2. Otherwise pass real title/description and column labels via props to ModuleListTable.
- **Acceptance:**
  - No text mentioning 'API' on the page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-LIST-01

### GAP-ANALYTICS-LIST-04  ·  LOW  ·  partly  ·  theme NAVUX

- [x] **Status** (W2 analytics: closed by #2045 — ALREADY-FIXED on main 60ff08f47: route redirected (LIST-01), so no in-page back link is needed; list/page.test.tsx passes)
- **First-pass claim:** No back link or breadcrumb inside the page (list/page.tsx); ModuleListPage omits PageHeader.back.
- **Verified evidence:** ModuleListPage.tsx:22 renders PageHeader without back, so no in-page back link. However AppShell.tsx:30 shows a global AutoBreadcrumb in TopBar (with 'analytics' label), so navigation exists. Low impact; moot if list route is redirected.
- **Files to change:** `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add optional back/backLabel props to ModuleListPage and pass to PageHeader.
  2. Skip if route redirected per LIST-01.
- **Acceptance:**
  - Page shows Back to Analytics link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-LIST-01


---
## /analytics/ml-insights  —  `analytics/ml-insights.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights.html`

### GAP-ANALYTICS-ML-INSIGHTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — hub error branch RefreshErrorState; ml-insights/page.test.tsx 'shows a retry panel and no 0/6 on source=error' passes; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed fetch reads as 'ML is off': on source 'error' only a badge is added (page.tsx:37) while stats show 0 / '0/6' (page.tsx:39-42) and all six cards render 'No model active' (page.tsx:76).
- **Verified evidence:** ml-insights/page.tsx: getMLDomainOverview fallback is [] (_data.ts:67-71); on error the page renders only a DataSourceBadge (page.tsx:37), Total Predictions '0' (:39), Avg Accuracy/Fallback '—' (:40-41), Active Domains '0/6' (:42) and all six cards 'No model active' (:76). Lines are accurate.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`
- **Fix steps:**
  1. When source==='error' return <RefreshErrorState error={{what:'ML domain summary could not be loaded',next:'Retry',actions:['retry','back']}} backHref='/analytics'/> after PageHeader.
  2. Keep the stats/cards path for source==='api' only.
  3. For api + empty list show one EmptyState 'No ML models active yet'.
- **Acceptance:**
  - Component/page test: mock getMLDomainOverview -> {source:'error'} => retry panel, no '0/6'.
  - Manual: stop ms-service, reload -> retry panel; restore, Retry -> cards appear.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** shared: RefreshErrorState

### GAP-ANALYTICS-ML-INSIGHTS-02  ·  HIGH  ·  confirmed  ·  theme METRIC (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — hub has no cross-metric average; cards show own metric (AUC-ROC/Precision/MAPE); page.test.tsx 'does not render an Avg. Accuracy stat card' passes; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Avg. Accuracy averages `accuracy` across domains (page.tsx:22-24) whose metrics differ — AUC-ROC (leads, subscriptions), precision (tickets, transactions), MAPE (inventory, lower is better; inventory/page.tsx label) — so the headline number is meaningless, and a good MAPE of 12% drags it down.
- **Verified evidence:** page.tsx:22-24 averages d.accuracy across all domains; the per-domain pages label the same field differently (subscriptions 'AUC-ROC' subscriptions/page.tsx:17, tickets 'Precision' tickets/page.tsx:17). Inventory/leads/anomalies/projects pages not each opened, but the inventory label MAPE is asserted in the finding; the mixed-metric average is arithmetically meaningless regardless. Card shows 'accuracy' for all too. Theme I18N is wrong. Whether MAPE is lower-is-better vs the API returning normalised accuracy is unverifiable (ms-service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Remove the 'Avg. Accuracy' StatCard, or replace with 'Domains with model' / 'Total Predictions' only.
  2. If a headline is wanted, ask backend for a normalised quality score per domain and average that.
  3. Add metricLabel to DOMAIN_META (AUC-ROC / Precision / MAPE ↓) and show it on each card.
- **Acceptance:**
  - Hub page has no cross-metric average; each card shows its own metric name.
  - Test: domains with accuracy 0.9 (AUC) and 0.12 (MAPE) do not produce a combined percentage.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium for credibility: a misleading KPI is shown to management today.

### GAP-ANALYTICS-ML-INSIGHTS-03  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — per-card aria-label names the metric + direction; page.test.tsx leads + NEW inventory test ('MAPE 12% (lower is better)', no 'accuracy') pass; NEW axe-core run on the hub: found a heading-order violation (h3 under h1), fixed to h2, now 0 violations; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Card aria-label and dl label say 'accuracy' for every domain (page.tsx:52,62), including 'MAPE (lower is better)'; screen-reader users hear '12% accuracy' for Demand Forecasting.
- **Verified evidence:** page.tsx:52 card aria-label uses `${formatPct(accuracy)} accuracy` and :62 dt 'Accuracy' for every domain including the MAPE one; a formatPct of 0.12 would read '12% accuracy' for Demand Forecasting. Lines accurate. Depends on the actual inventory metric definition (finding -02).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`
- **Fix steps:**
  1. Add metricLabel per domain in DOMAIN_META and use it in the aria-label and dt (e.g. 'MAPE, lower is better').
  2. Externalise these strings to next-intl if the namespace exists.
  3. Add an aria-label suffix for direction (higher/lower is better).
- **Acceptance:**
  - Test: inventory card aria-label contains 'MAPE' not 'accuracy'.
  - axe pass on hub.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-02

### GAP-ANALYTICS-ML-INSIGHTS-04  ·  MEDIUM  ·  confirmed  ·  theme STALE (was WIRING)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — last-trained date + Stale pill + Active excludes stale; page.test.tsx 200-day test passes; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Domain key 'tasks' is labelled 'Project Delay Prediction' and 'transactions' 'Anomaly Detection' (page.tsx:10-11); Active Domains counts modelVersion !== null (page.tsx:28) so a stale model last trained months ago counts as active — lastTrainedAt is fetched (_data.ts:100) but never shown.
- **Verified evidence:** page.tsx:10-11 DOMAIN_META tasks -> 'Project Delay Prediction', transactions -> 'Anomaly Detection' (labels are consistent with hrefs projects/anomalies; the key/label mismatch is only naming, not a bug). Active Domains = domains.filter(modelVersion !== null) (:28); lastTrainedAt is mapped (_data.ts:84) but never rendered on the hub or domain pages. So stale models count active. The 'WIRING' claim about wrong labelling is not a defect; the stale-model point is real.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Show 'Last trained <date>' on each hub card using formatIndianDate(domainData.lastTrainedAt).
  2. Define staleness (e.g. >90 days, product decision) and mark such cards 'Stale' with a StatusPill, excluding them from Active Domains or counting separately.
  3. Optionally include lastTrainedAt in the per-domain evaluation payload.
- **Acceptance:**
  - Card for a domain trained 200 days ago shows the date and a Stale pill.
  - Active Domains count excludes stale models per agreed rule.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ANALYTICS-ML-INSIGHTS-05  ·  LOW  ·  confirmed  ·  theme DS (was OTHER)

- [x] **Status** (W2 analytics: closed by #2045; hub card grid uses DS classes (.grid/.stat, var(--ink2)) instead of Tailwind utilities, next/link already in use, card headings h2 (axe heading-order violation found and fixed); ml-insights/page.test.tsx incl. axe-core run passes)
- **First-pass claim:** Grid built with Tailwind-style utility classes (page.tsx:44,51) and emoji icons with hex backgrounds (page.tsx:6-11) rather than DS Card/StatCard tokens.
- **Verified evidence:** page.tsx:44 and :51 use Tailwind classes (grid, border, rounded-lg, focus:ring-blue-400) on a raw <a>, and :5-12 emoji icons with inline hex iconBg; the file imports Card (:2) but does not use it. Note StatCard itself takes icon/iconBg props, so emoji/hex is the repo-wide DS convention (also DomainInsightPage.tsx:51-69) - only the card grid deviates. The raw <a> also causes full page navigation instead of next/link.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`
- **Fix steps:**
  1. Wrap each domain in the DS Card component (or a new DomainCard in _components) using DS tokens.
  2. Use next/link for href.
  3. Remove unused Card import or use it; drop tailwind focus ring for the DS focus style.
- **Acceptance:**
  - Visual check: card matches other hubs in light/dark.
  - Keyboard focus ring visible using DS style.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /analytics/ml-insights/anomalies  —  `analytics/ml-insights-anomalies.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/anomalies/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights-anomalies.html`

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: DomainInsightPage.tsx source===error returns RefreshErrorState before any stat; DomainInsightPage.test.tsx 'renders a retry panel and NOT the model active copy' passes)
- **First-pass claim:** Failed fetch reads as 'model inactive': getMLDomainEvaluation falls back to emptyEvaluation (_data.ts:177-185,229-238), DomainInsightPage adds only a badge (DomainInsightPage.tsx:48) and renders zero stats plus 'No trend/factor data available yet' and 'once the ML model is active' copy (RecentPredictionsTable.tsx:161-163); no retry.
- **Verified evidence:** anomalies/page.tsx: getMLDomainEvaluation("transactions") returns {data: emptyEvaluation, source} on any failure (_data.ts:93-101,145-155; fetchJson returns empty+source 'error' for no base URL, 401, non-2xx, bad payload). DomainInsightPage.tsx:48 only adds <DataSourceBadge source='error'> and still renders totalPredictions '0' (:54), '—' for accuracy/fallback via formatPct (:26-28), topFactor '—', AccuracyTrendChart 'No trend data available yet' (AccuracyTrendChart.tsx:14-19), FactorBreakdown 'No factor data available yet' (FactorBreakdown.tsx:14-19) and the table empty state 'Predictions will appear here once the ML model is active' (RecentPredictionsTable.tsx:68-70, cited as 161-163 earlier - wrong lines). No retry (error.tsx only catches thrown errors, which never happen here). Overstated: accuracy/fallback already show '—', not 0; the badge does signal error. ms-service itself is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. In DomainInsightPage, when source==='error' return early: <PageHeader/> + <RefreshErrorState error={toHumanError('load',{area:'ML insights'})} backHref='/analytics/ml-insights'/> (as done in projects/[id]/page.tsx) instead of stats/cards.
  2. Keep DataSourceBadge out of the error branch; render the normal layout only when source==='api'.
  3. In _data.ts make the empty fallback distinguishable: add `hasData: boolean` (or return null) to MLDomainEvaluation so a healthy 'no predictions yet' response (source 'api', totalPredictions 0) keeps the 'model not active yet' copy while errors never reach it.
  4. In StatCard values, render '—' for totalPredictions when !hasData instead of '0'.
  5. Pass source into AccuracyTrendChart/FactorBreakdown empty branches only for the api+empty case (no changes needed if the early return is added).
  6. Add a component test for DomainInsightPage with source='error'.
- **Acceptance:**
  - Component test: DomainInsightPage source='error' renders the RefreshErrorState with a Retry button and does not contain 'once the ML model is active' or 'No trend data'.
  - Manual: stop the gateway; page shows error state, Retry calls router.refresh and recovers when the gateway returns.
  - source='api' with empty arrays still shows the empty-state copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only page. Fix once in the shared component covers all six ml-insights domain pages (tickets, subscriptions too).
- **Depends on:** RefreshErrorState, GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-05

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 W1 SF-18 (#2019) re-confirmed: closed by #1916; prefix removed, route-existence analyzer clean, drillRoutes.test.ts)
- **First-pass claim:** Dead drill-through: rowLinkPrefix '/finance/anomalies/' (anomalies/page.tsx:14) — apps/web/src/app/(app)/finance has no anomalies route, so a flagged transaction cannot be opened from the one page built to review it.
- **Verified evidence:** anomalies/page.tsx:14 rowLinkPrefix='/finance/anomalies/'; directory apps/web/src/app/(app)/finance has no 'anomalies' entry (listing checked), so every Entity link 404s (finance/not-found.tsx). Closest existing detail is finance/payments/[id] but it is unverified that transaction ids match payment ids (ms-service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/anomalies/page.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`
- **Fix steps:**
  1. Decide target with product: what entity does the 'transactions' domain score (payment, journal entry, expense)?
  2. If payments: set rowLinkPrefix='/finance/payments/'; otherwise create finance/anomalies/[id]/page.tsx (loader + detail).
  3. Until a target exists pass rowLinkPrefix={undefined} so DataTable renders plain text (DataTable.tsx:212 only links when both key and prefix set).
  4. Add a Playwright/route test that every rowLinkPrefix used by ml-insights pages resolves to an existing app route.
- **Acceptance:**
  - Clicking a row entity opens an existing detail page (no 404).
  - With prefix removed, rows are not links.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low technical risk; wrong entity type linked from an ML row could show another record. Needs product confirmation of what entityId denotes (ms-service not in snapshot).

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-03  ·  MEDIUM  ·  partly  ·  theme CHART (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trend bars are scaled to the series maximum, not 0-100% (AccuracyTrendChart.tsx:23,29), and coloured green/amber/red at fixed 0.7/0.4 cut-offs (AccuracyTrendChart.tsx:36); x labels are MM-DD only (slice(5), :55) with no year; per-bar aria-label sits on role='presentation' nodes (:44-45).
- **Verified evidence:** AccuracyTrendChart.tsx: bars scale to the series max (maxAccuracy :22, heightPct :28) so a flat 40% series looks full-height; colour thresholds hard-coded 0.7/0.4 (:42); x labels are point.date.slice(5) = MM-DD, no year (:53-54); per-bar aria-label is on a div with role='presentation' (:44-45) inside a role='img' parent (:25) whose label is only 'Accuracy trend over N data points', so per-point values are not exposed to screen readers (visible % labels at :36 are text but colour is the only good/bad cue). Earlier line numbers were off by 1-2. The suggested i18n fix does not match: the problem is chart semantics/a11y, not translation (the file has no hard-coded translated keys beyond a few English strings). For anomaly precision the 0.7/0.4 thresholds are arbitrary.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`
- **Fix steps:**
  1. Scale bar height against a fixed 0..1 axis (heightPct = accuracy*100) and drop maxAccuracy, or add gridlines at 0/50/100%.
  2. Accept optional props `higherIsBetter` and `thresholds` (default {good:0.7,warn:0.4}); compute colour from them.
  3. Add a non-colour cue: status text/icon per bar (e.g. hidden 'good/fair/poor' via sr-only text) or a legend.
  4. Replace role='img' wrapper with a <table class='sr-only'> or <ul> of `${date}: ${pct}` items, and remove aria-label from role='presentation' bars.
  5. Format x labels with a shared date formatter (dd MMM) via Intl, include year when the range spans years.
- **Acceptance:**
  - Component test: 3 points 0.2/0.5/0.9 render heights 20/50/90% and distinct status text.
  - axe: no aria-label on presentation nodes; screen reader lists each date with its value.
  - Series spanning Dec-Jan shows year.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational only.

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-04  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: RecentPredictionsTable.tsx entityDisplay (label first) + formatPrediction by PredictionKind; RecentPredictionsTable.test.tsx passes. BE ml-service evaluations does not yet emit entityLabel/recentPredictions (see PR body))
- **First-pass claim:** Entity column prints the raw entityId (RecentPredictionsTable.tsx:146,153), an opaque UUID; Prediction is formatted as a percentage for every domain (formatConfidence, RecentPredictionsTable.tsx:137) even where the model output is not a probability.
- **Verified evidence:** RecentPredictionsTable.tsx:53 column {key:'entityId',label:'Entity'} prints p.entityId (mapped from API entityId, _data.ts:126) verbatim, and rowLinkKey='entityId' (:60) makes it the link text; no name lookup exists. Prediction is formatted with formatConfidence as a percentage for every domain (:13-15,44), even for inventory (demand forecast quantity) or task dates. Whether entityId is a UUID cannot be verified: ms-service is not in the snapshot. Original line refs 146,153,137 were wrong (actual 44,53,60,13-15). EntityPicker is not applicable (display, not input).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Ask ms-service/BE for an `entityLabel` (name/code) on recentPredictions; add optional entityLabel to RecentPredictionRow and map it in mapEvaluation.
  2. Render the label (fallback to a short id, e.g. last 8 chars, with full id in title/aria) in the Entity column while keeping entityId as the link key; add a hidden column or custom cell so href still uses the id.
  3. Add a per-domain `predictionFormat` prop ('percent' | 'number' | 'date') on DomainInsightPage -> RecentPredictionsTable and format accordingly.
  4. Set prediction format per page: leads/tickets/subscriptions/transactions percent probability, inventory number, tasks days/date.
- **Acceptance:**
  - Component test: row with entityLabel 'Widget A' shows it and links to prefix+id.
  - Row without label shows shortened id with full id in title.
  - Inventory page shows numeric prediction, not '%'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs BE contract for label; wrong format could misstate forecasts.

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: _data.ts toNullableNumber + DomainInsightPage formatPct(0)=0%/null=em dash; _data.test.ts + DomainInsightPage.test.tsx pass)
- **First-pass claim:** formatPct returns '—' for value 0 (DomainInsightPage.tsx:27), so a genuine 0% precision/fallback rate is indistinguishable from missing data.
- **Verified evidence:** DomainInsightPage.tsx:26-28 formatPct returns '—' when value <= 0, so a real 0% (e.g. 0% false positive rate, 0% fallback) shows '—'; conversely the empty fallback (_data.ts:93-101 sets accuracy/fallbackRate 0, toNumber() coerces missing to 0 at :56-58) is indistinguishable from a real zero. Line ref 27 is correct. Hub page.tsx:22 has the same >0 pattern.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Make accuracy/fallbackRate nullable in MLDomainEvaluation (number | null); in mapEvaluation use null when the field is absent/non-numeric instead of toNumber()->0 (keep 0 for genuine 0).
  2. Change formatPct(value: number|null) to return '—' only for null/NaN, and `${Math.round(v*100)}%` for 0.
  3. Use totalPredictions===0 as the 'no data' signal for showing '—' on rate cards.
  4. Apply the same to ml-insights/page.tsx avgAccuracy logic.
- **Acceptance:**
  - Unit test: formatPct(0)==='0%', formatPct(null)==='—'.
  - mapEvaluation({}) yields null rates; mapEvaluation({accuracy:0}) yields 0.
  - Page with totalPredictions>0 and fallbackRate 0 shows 0%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Rate semantics: confirm with BE that missing fields are omitted, not 0.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-01

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-07  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Financial-transaction fraud scores are visible to every analytics role and exportable (RecentPredictionsTable.tsx:159-160); flagged-payment data is normally finance/audit-restricted.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions'; DataTable.tsx:276-291 downloadCsv builds the CSV client-side from the currently sorted rows (all filtered rows, not just the page) with no permission check, purpose note or audit event. Access control is only ModuleGate moduleKey='analytics' (analytics/layout.tsx). Original :159-160 refs wrong (actual 66-67). Data exported: entityId, prediction, confidence, outcome, date; no names or PII columns, so 'PII' is overstated unless entityId maps to a person (e.g. leads/contacts). No <Masked> component exists in apps/web/src/app/_components. Backend RBAC/audit is cannot-verify (ms-service absent). Finding 07 (fraud-score visibility) is really the same control as -08: only ModuleGate analytics gates the page; finance/audit-only restriction cannot be verified without policy-service/ms-service.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Decide with finance/audit which roles may see flagged-transaction scores; gate the page (layout or ModuleGate role prop) and have ms-service enforce it.
  2. Add optional `exportable` gating prop already on DataTable; in RecentPredictionsTable pass exportable only when the user holds an analytics-export permission (use the existing role/permission helper in lib/auth or moduleVisibility).
  3. Add an `onExport` callback prop to DataTable (called before download) and POST an audit event through the existing web audit route/BFF (action 'ml.predictions.export', domain, row count, filter).
  4. Add a short purpose/DPDP notice next to the Export button for domains referencing persons (leads).
  5. Have ms-service enforce the same role on the evaluations endpoint (backend).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - With permission, clicking Export fires onExport once and downloads CSV.
  - Audit event contains user, domain and row count.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: adds an audit call on a client download; must not block export if audit fails silently - decide policy.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-08

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-08  ·  LOW  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** CSV export 'ms-predictions' (RecentPredictionsTable.tsx:159-160) exports entity ids and scores for the whole table with no role gate or DPDP purpose note.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions'; DataTable.tsx:276-291 downloadCsv builds the CSV client-side from the currently sorted rows (all filtered rows, not just the page) with no permission check, purpose note or audit event. Access control is only ModuleGate moduleKey='analytics' (analytics/layout.tsx). Original :159-160 refs wrong (actual 66-67). Data exported: entityId, prediction, confidence, outcome, date; no names or PII columns, so 'PII' is overstated unless entityId maps to a person (e.g. leads/contacts). No <Masked> component exists in apps/web/src/app/_components. Backend RBAC/audit is cannot-verify (ms-service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add optional `exportable` gating prop already on DataTable; in RecentPredictionsTable pass exportable only when the user holds an analytics-export permission (use the existing role/permission helper in lib/auth or moduleVisibility).
  2. Add an `onExport` callback prop to DataTable (called before download) and POST an audit event through the existing web audit route/BFF (action 'ml.predictions.export', domain, row count, filter).
  3. Add a short purpose/DPDP notice next to the Export button for domains referencing persons (leads).
  4. Have ms-service enforce the same role on the evaluations endpoint (backend).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - With permission, clicking Export fires onExport once and downloads CSV.
  - Audit event contains user, domain and row count.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: adds an audit call on a client download; must not block export if audit fails silently - decide policy.


---
## /analytics/ml-insights/inventory  —  `analytics/ml-insights-inventory.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/inventory/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights-inventory.html`

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: DomainInsightPage.tsx source===error returns RefreshErrorState before any stat; DomainInsightPage.test.tsx 'renders a retry panel and NOT the model active copy' passes)
- **First-pass claim:** Failed fetch reads as 'model inactive': getMLDomainEvaluation falls back to emptyEvaluation (_data.ts:177-185,229-238), DomainInsightPage adds only a badge (DomainInsightPage.tsx:48) and renders zero stats plus 'No trend/factor data available yet' and 'once the ML model is active' copy (RecentPredictionsTable.tsx:161-163); no retry.
- **Verified evidence:** inventory/page.tsx: getMLDomainEvaluation("inventory") returns {data: emptyEvaluation, source} on any failure (_data.ts:93-101,145-155; fetchJson returns empty+source 'error' for no base URL, 401, non-2xx, bad payload). DomainInsightPage.tsx:48 only adds <DataSourceBadge source='error'> and still renders totalPredictions '0' (:54), '—' for accuracy/fallback via formatPct (:26-28), topFactor '—', AccuracyTrendChart 'No trend data available yet' (AccuracyTrendChart.tsx:14-19), FactorBreakdown 'No factor data available yet' (FactorBreakdown.tsx:14-19) and the table empty state 'Predictions will appear here once the ML model is active' (RecentPredictionsTable.tsx:68-70, cited as 161-163 earlier - wrong lines). No retry (error.tsx only catches thrown errors, which never happen here). Overstated: accuracy/fallback already show '—', not 0; the badge does signal error. ms-service itself is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. In DomainInsightPage, when source==='error' return early: <PageHeader/> + <RefreshErrorState error={toHumanError('load',{area:'ML insights'})} backHref='/analytics/ml-insights'/> (as done in projects/[id]/page.tsx) instead of stats/cards.
  2. Keep DataSourceBadge out of the error branch; render the normal layout only when source==='api'.
  3. In _data.ts make the empty fallback distinguishable: add `hasData: boolean` (or return null) to MLDomainEvaluation so a healthy 'no predictions yet' response (source 'api', totalPredictions 0) keeps the 'model not active yet' copy while errors never reach it.
  4. In StatCard values, render '—' for totalPredictions when !hasData instead of '0'.
  5. Pass source into AccuracyTrendChart/FactorBreakdown empty branches only for the api+empty case (no changes needed if the early return is added).
  6. Add a component test for DomainInsightPage with source='error'.
- **Acceptance:**
  - Component test: DomainInsightPage source='error' renders the RefreshErrorState with a Retry button and does not contain 'once the ML model is active' or 'No trend data'.
  - Manual: stop the gateway; page shows error state, Retry calls router.refresh and recovers when the gateway returns.
  - source='api' with empty arrays still shows the empty-state copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only page. Fix once in the shared component covers all six ml-insights domain pages (tickets, subscriptions too).
- **Depends on:** RefreshErrorState

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a - W1 SF-18 (#2019): /inventory/[id] verified; entityId confirmed. Closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Dead drill-through: rowLinkPrefix '/inventory/items/' (inventory/page.tsx:14) — apps/web/src/app/(app)/inventory/items contains only page.tsx, so every Entity link is a 404.
- **Verified evidence:** inventory/page.tsx:14 rowLinkPrefix='/inventory/items/'; apps/web/src/app/(app)/inventory/items contains only page.tsx (the items list, no [id]), so /inventory/items/<id> 404s (inventory/not-found.tsx). The stock item detail route is inventory/[id]/page.tsx (getStockItemById), so /inventory/<id> is the likely target, assuming entityId is a stock item id (ms-service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/inventory/page.tsx`
- **Fix steps:**
  1. Change rowLinkPrefix to '/inventory/' (route inventory/[id]) after confirming entityId is a stock item id.
  2. Add a route-existence test covering all ml-insights rowLinkPrefix values.
- **Acceptance:**
  - Click Entity opens the stock item detail page.
  - No 404 for any listed row.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low technical risk; wrong entity type linked from an ML row could show another record. Needs product confirmation of what entityId denotes (ms-service not in snapshot).

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-03  ·  HIGH  ·  confirmed  ·  theme CHART (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — AccuracyTrendChart.test.tsx 'colours a 12% MAPE as good when lower-is-better' passes; DomainInsightPage card title '<metric> Trend (30 days) — lower is better'. FINDING: ledger step 5 (is accuracy MAPE or 1-MAPE?) — ml-service evaluations returns avgConfidence only, no MAPE/AUC/precision, trend, factors or recent predictions; see PR body NEEDS OWNER DECISION; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** MAPE is lower-is-better (inventory/page.tsx:17 label) but AccuracyTrendChart colours by accuracy thresholds (>=0.7 green, >=0.4 amber, else red — AccuracyTrendChart.tsx:36), so a good 12% MAPE renders as red bars; the trend also reads upward when errors fall.
- **Verified evidence:** inventory/page.tsx:17 labels the card 'MAPE (lower is better)' and DomainInsightPage.tsx:60 shows it via formatPct(evaluation.accuracy); AccuracyTrendChart.tsx:42 colours every bar by higher-is-better thresholds (>=0.7 green, >=0.4 amber, else red) and has no higherIsBetter prop, so a 12% MAPE is drawn as small red bars. Bar height is proportional to the value, so falling error shows as shrinking bars while the title says 'Accuracy Trend' (DomainInsightPage.tsx:76). Caveat: if the API returns 1-MAPE in `accuracy` the colours would be right but the label wrong; ms-service is absent so the semantics cannot be verified. Theme is not I18N.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/inventory/page.tsx`
- **Fix steps:**
  1. Add `metric?: {label:string; higherIsBetter:boolean; thresholds?:{good:number;warn:number}}` prop to DomainInsightPage and forward to AccuracyTrendChart.
  2. In AccuracyTrendChart invert the colour logic when higherIsBetter=false (e.g. <=0.15 green, <=0.30 amber, else red) and add non-colour text cues.
  3. Rename card title to metric.label (e.g. 'MAPE Trend (lower is better)') and add an aria description.
  4. In inventory/page.tsx pass metric={{label:'MAPE',higherIsBetter:false,thresholds:{good:0.15,warn:0.3}}}.
  5. Confirm with ms-service owner whether `accuracy` for inventory is MAPE or 1-MAPE.
- **Acceptance:**
  - Component test: higherIsBetter=false with 0.12 renders the green class/status text.
  - Inventory page shows title 'MAPE Trend' and a lower-is-better hint.
  - Other domains unchanged.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: thresholds are a business call; wrong colours could mislead planners.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-03

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-04  ·  MEDIUM  ·  partly  ·  theme CHART (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trend bars are scaled to the series maximum, not 0-100% (AccuracyTrendChart.tsx:23,29), and coloured green/amber/red at fixed 0.7/0.4 cut-offs (AccuracyTrendChart.tsx:36); x labels are MM-DD only (slice(5), :55) with no year; per-bar aria-label sits on role='presentation' nodes (:44-45).
- **Verified evidence:** AccuracyTrendChart.tsx: bars scale to the series max (maxAccuracy :22, heightPct :28) so a flat 40% series looks full-height; colour thresholds hard-coded 0.7/0.4 (:42); x labels are point.date.slice(5) = MM-DD, no year (:53-54); per-bar aria-label is on a div with role='presentation' (:44-45) inside a role='img' parent (:25) whose label is only 'Accuracy trend over N data points', so per-point values are not exposed to screen readers (visible % labels at :36 are text but colour is the only good/bad cue). Earlier line numbers were off by 1-2. The suggested i18n fix does not match: the problem is chart semantics/a11y, not translation (the file has no hard-coded translated keys beyond a few English strings).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`
- **Fix steps:**
  1. Scale bar height against a fixed 0..1 axis (heightPct = accuracy*100) and drop maxAccuracy, or add gridlines at 0/50/100%.
  2. Accept optional props `higherIsBetter` and `thresholds` (default {good:0.7,warn:0.4}); compute colour from them.
  3. Add a non-colour cue: status text/icon per bar (e.g. hidden 'good/fair/poor' via sr-only text) or a legend.
  4. Replace role='img' wrapper with a <table class='sr-only'> or <ul> of `${date}: ${pct}` items, and remove aria-label from role='presentation' bars.
  5. Format x labels with a shared date formatter (dd MMM) via Intl, include year when the range spans years.
- **Acceptance:**
  - Component test: 3 points 0.2/0.5/0.9 render heights 20/50/90% and distinct status text.
  - axe: no aria-label on presentation nodes; screen reader lists each date with its value.
  - Series spanning Dec-Jan shows year.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational only.

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-05  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: RecentPredictionsTable.tsx entityDisplay (label first) + formatPrediction by PredictionKind; RecentPredictionsTable.test.tsx passes. BE ml-service evaluations does not yet emit entityLabel/recentPredictions (see PR body))
- **First-pass claim:** Entity column prints the raw entityId (RecentPredictionsTable.tsx:146,153), an opaque UUID; Prediction is formatted as a percentage for every domain (formatConfidence, RecentPredictionsTable.tsx:137) even where the model output is not a probability.
- **Verified evidence:** RecentPredictionsTable.tsx:53 column {key:'entityId',label:'Entity'} prints p.entityId (mapped from API entityId, _data.ts:126) verbatim, and rowLinkKey='entityId' (:60) makes it the link text; no name lookup exists. Prediction is formatted with formatConfidence as a percentage for every domain (:13-15,44), even for inventory (demand forecast quantity) or task dates. Whether entityId is a UUID cannot be verified: ms-service is not in the snapshot. Original line refs 146,153,137 were wrong (actual 44,53,60,13-15). EntityPicker is not applicable (display, not input).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Ask ms-service/BE for an `entityLabel` (name/code) on recentPredictions; add optional entityLabel to RecentPredictionRow and map it in mapEvaluation.
  2. Render the label (fallback to a short id, e.g. last 8 chars, with full id in title/aria) in the Entity column while keeping entityId as the link key; add a hidden column or custom cell so href still uses the id.
  3. Add a per-domain `predictionFormat` prop ('percent' | 'number' | 'date') on DomainInsightPage -> RecentPredictionsTable and format accordingly.
  4. Set prediction format per page: leads/tickets/subscriptions/transactions percent probability, inventory number, tasks days/date.
- **Acceptance:**
  - Component test: row with entityLabel 'Widget A' shows it and links to prefix+id.
  - Row without label shows shortened id with full id in title.
  - Inventory page shows numeric prediction, not '%'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs BE contract for label; wrong format could misstate forecasts.

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: _data.ts toNullableNumber + DomainInsightPage formatPct(0)=0%/null=em dash; _data.test.ts + DomainInsightPage.test.tsx pass)
- **First-pass claim:** formatPct returns '—' for value 0 (DomainInsightPage.tsx:27), so a genuine 0% precision/fallback rate is indistinguishable from missing data.
- **Verified evidence:** DomainInsightPage.tsx:26-28 formatPct returns '—' when value <= 0, so a real 0% (e.g. 0% false positive rate, 0% fallback) shows '—'; conversely the empty fallback (_data.ts:93-101 sets accuracy/fallbackRate 0, toNumber() coerces missing to 0 at :56-58) is indistinguishable from a real zero. Line ref 27 is correct. Hub page.tsx:22 has the same >0 pattern.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Make accuracy/fallbackRate nullable in MLDomainEvaluation (number | null); in mapEvaluation use null when the field is absent/non-numeric instead of toNumber()->0 (keep 0 for genuine 0).
  2. Change formatPct(value: number|null) to return '—' only for null/NaN, and `${Math.round(v*100)}%` for 0.
  3. Use totalPredictions===0 as the 'no data' signal for showing '—' on rate cards.
  4. Apply the same to ml-insights/page.tsx avgAccuracy logic.
- **Acceptance:**
  - Unit test: formatPct(0)==='0%', formatPct(null)==='—'.
  - mapEvaluation({}) yields null rates; mapEvaluation({accuracy:0}) yields 0.
  - Page with totalPredictions>0 and fallbackRate 0 shows 0%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Rate semantics: confirm with BE that missing fields are omitted, not 0.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-01

### GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-07  ·  LOW  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** CSV export 'ms-predictions' (RecentPredictionsTable.tsx:159-160) exports entity ids and scores for the whole table with no role gate or DPDP purpose note.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions'; DataTable.tsx:276-291 downloadCsv builds the CSV client-side from the currently sorted rows (all filtered rows, not just the page) with no permission check, purpose note or audit event. Access control is only ModuleGate moduleKey='analytics' (analytics/layout.tsx). Original :159-160 refs wrong (actual 66-67). Data exported: entityId, prediction, confidence, outcome, date; no names or PII columns, so 'PII' is overstated unless entityId maps to a person (e.g. leads/contacts). No <Masked> component exists in apps/web/src/app/_components. Backend RBAC/audit is cannot-verify (ms-service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add optional `exportable` gating prop already on DataTable; in RecentPredictionsTable pass exportable only when the user holds an analytics-export permission (use the existing role/permission helper in lib/auth or moduleVisibility).
  2. Add an `onExport` callback prop to DataTable (called before download) and POST an audit event through the existing web audit route/BFF (action 'ml.predictions.export', domain, row count, filter).
  3. Add a short purpose/DPDP notice next to the Export button for domains referencing persons (leads).
  4. Have ms-service enforce the same role on the evaluations endpoint (backend).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - With permission, clicking Export fires onExport once and downloads CSV.
  - Audit event contains user, domain and row count.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: adds an audit call on a client download; must not block export if audit fails silently - decide policy.


---
## /analytics/ml-insights/leads  —  `analytics/ml-insights-leads.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/leads/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights-leads.html`

### GAP-ANALYTICS-ML-INSIGHTS-LEADS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: DomainInsightPage.tsx source===error returns RefreshErrorState before any stat; DomainInsightPage.test.tsx 'renders a retry panel and NOT the model active copy' passes)
- **First-pass claim:** Failed fetch reads as 'model inactive': getMLDomainEvaluation falls back to emptyEvaluation (_data.ts:177-185,229-238), DomainInsightPage adds only a badge (DomainInsightPage.tsx:48) and renders zero stats plus 'No trend/factor data available yet' and 'once the ML model is active' copy (RecentPredictionsTable.tsx:161-163); no retry.
- **Verified evidence:** leads/page.tsx: getMLDomainEvaluation("leads") returns {data: emptyEvaluation, source} on any failure (_data.ts:93-101,145-155; fetchJson returns empty+source 'error' for no base URL, 401, non-2xx, bad payload). DomainInsightPage.tsx:48 only adds <DataSourceBadge source='error'> and still renders totalPredictions '0' (:54), '—' for accuracy/fallback via formatPct (:26-28), topFactor '—', AccuracyTrendChart 'No trend data available yet' (AccuracyTrendChart.tsx:14-19), FactorBreakdown 'No factor data available yet' (FactorBreakdown.tsx:14-19) and the table empty state 'Predictions will appear here once the ML model is active' (RecentPredictionsTable.tsx:68-70, cited as 161-163 earlier - wrong lines). No retry (error.tsx only catches thrown errors, which never happen here). Overstated: accuracy/fallback already show '—', not 0; the badge does signal error. ms-service itself is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. In DomainInsightPage, when source==='error' return early: <PageHeader/> + <RefreshErrorState error={toHumanError('load',{area:'ML insights'})} backHref='/analytics/ml-insights'/> (as done in projects/[id]/page.tsx) instead of stats/cards.
  2. Keep DataSourceBadge out of the error branch; render the normal layout only when source==='api'.
  3. In _data.ts make the empty fallback distinguishable: add `hasData: boolean` (or return null) to MLDomainEvaluation so a healthy 'no predictions yet' response (source 'api', totalPredictions 0) keeps the 'model not active yet' copy while errors never reach it.
  4. In StatCard values, render '—' for totalPredictions when !hasData instead of '0'.
  5. Pass source into AccuracyTrendChart/FactorBreakdown empty branches only for the api+empty case (no changes needed if the early return is added).
  6. Add a component test for DomainInsightPage with source='error'.
- **Acceptance:**
  - Component test: DomainInsightPage source='error' renders the RefreshErrorState with a Retry button and does not contain 'once the ML model is active' or 'No trend data'.
  - Manual: stop the gateway; page shows error state, Retry calls router.refresh and recovers when the gateway returns.
  - source='api' with empty arrays still shows the empty-state copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only page. Fix once in the shared component covers all six ml-insights domain pages (tickets, subscriptions too).
- **Depends on:** RefreshErrorState

### GAP-ANALYTICS-ML-INSIGHTS-LEADS-02  ·  MEDIUM  ·  partly  ·  theme CHART (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trend bars are scaled to the series maximum, not 0-100% (AccuracyTrendChart.tsx:23,29), and coloured green/amber/red at fixed 0.7/0.4 cut-offs (AccuracyTrendChart.tsx:36); x labels are MM-DD only (slice(5), :55) with no year; per-bar aria-label sits on role='presentation' nodes (:44-45).
- **Verified evidence:** AccuracyTrendChart.tsx: bars scale to the series max (maxAccuracy :22, heightPct :28) so a flat 40% series looks full-height; colour thresholds hard-coded 0.7/0.4 (:42); x labels are point.date.slice(5) = MM-DD, no year (:53-54); per-bar aria-label is on a div with role='presentation' (:44-45) inside a role='img' parent (:25) whose label is only 'Accuracy trend over N data points', so per-point values are not exposed to screen readers (visible % labels at :36 are text but colour is the only good/bad cue). Earlier line numbers were off by 1-2. The suggested i18n fix does not match: the problem is chart semantics/a11y, not translation (the file has no hard-coded translated keys beyond a few English strings).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`
- **Fix steps:**
  1. Scale bar height against a fixed 0..1 axis (heightPct = accuracy*100) and drop maxAccuracy, or add gridlines at 0/50/100%.
  2. Accept optional props `higherIsBetter` and `thresholds` (default {good:0.7,warn:0.4}); compute colour from them.
  3. Add a non-colour cue: status text/icon per bar (e.g. hidden 'good/fair/poor' via sr-only text) or a legend.
  4. Replace role='img' wrapper with a <table class='sr-only'> or <ul> of `${date}: ${pct}` items, and remove aria-label from role='presentation' bars.
  5. Format x labels with a shared date formatter (dd MMM) via Intl, include year when the range spans years.
- **Acceptance:**
  - Component test: 3 points 0.2/0.5/0.9 render heights 20/50/90% and distinct status text.
  - axe: no aria-label on presentation nodes; screen reader lists each date with its value.
  - Series spanning Dec-Jan shows year.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational only.

### GAP-ANALYTICS-ML-INSIGHTS-LEADS-03  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: RecentPredictionsTable.tsx entityDisplay (label first) + formatPrediction by PredictionKind; RecentPredictionsTable.test.tsx passes. BE ml-service evaluations does not yet emit entityLabel/recentPredictions (see PR body))
- **First-pass claim:** Entity column prints the raw entityId (RecentPredictionsTable.tsx:146,153), an opaque UUID; Prediction is formatted as a percentage for every domain (formatConfidence, RecentPredictionsTable.tsx:137) even where the model output is not a probability.
- **Verified evidence:** RecentPredictionsTable.tsx:53 column {key:'entityId',label:'Entity'} prints p.entityId (mapped from API entityId, _data.ts:126) verbatim, and rowLinkKey='entityId' (:60) makes it the link text; no name lookup exists. Prediction is formatted with formatConfidence as a percentage for every domain (:13-15,44), even for inventory (demand forecast quantity) or task dates. Whether entityId is a UUID cannot be verified: ms-service is not in the snapshot. Original line refs 146,153,137 were wrong (actual 44,53,60,13-15). EntityPicker is not applicable (display, not input).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Ask ms-service/BE for an `entityLabel` (name/code) on recentPredictions; add optional entityLabel to RecentPredictionRow and map it in mapEvaluation.
  2. Render the label (fallback to a short id, e.g. last 8 chars, with full id in title/aria) in the Entity column while keeping entityId as the link key; add a hidden column or custom cell so href still uses the id.
  3. Add a per-domain `predictionFormat` prop ('percent' | 'number' | 'date') on DomainInsightPage -> RecentPredictionsTable and format accordingly.
  4. Set prediction format per page: leads/tickets/subscriptions/transactions percent probability, inventory number, tasks days/date.
- **Acceptance:**
  - Component test: row with entityLabel 'Widget A' shows it and links to prefix+id.
  - Row without label shows shortened id with full id in title.
  - Inventory page shows numeric prediction, not '%'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs BE contract for label; wrong format could misstate forecasts.

### GAP-ANALYTICS-ML-INSIGHTS-LEADS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: _data.ts toNullableNumber + DomainInsightPage formatPct(0)=0%/null=em dash; _data.test.ts + DomainInsightPage.test.tsx pass)
- **First-pass claim:** formatPct returns '—' for value 0 (DomainInsightPage.tsx:27), so a genuine 0% precision/fallback rate is indistinguishable from missing data.
- **Verified evidence:** DomainInsightPage.tsx:26-28 formatPct returns '—' when value <= 0, so a real 0% (e.g. 0% false positive rate, 0% fallback) shows '—'; conversely the empty fallback (_data.ts:93-101 sets accuracy/fallbackRate 0, toNumber() coerces missing to 0 at :56-58) is indistinguishable from a real zero. Line ref 27 is correct. Hub page.tsx:22 has the same >0 pattern.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Make accuracy/fallbackRate nullable in MLDomainEvaluation (number | null); in mapEvaluation use null when the field is absent/non-numeric instead of toNumber()->0 (keep 0 for genuine 0).
  2. Change formatPct(value: number|null) to return '—' only for null/NaN, and `${Math.round(v*100)}%` for 0.
  3. Use totalPredictions===0 as the 'no data' signal for showing '—' on rate cards.
  4. Apply the same to ml-insights/page.tsx avgAccuracy logic.
- **Acceptance:**
  - Unit test: formatPct(0)==='0%', formatPct(null)==='—'.
  - mapEvaluation({}) yields null rates; mapEvaluation({accuracy:0}) yields 0.
  - Page with totalPredictions>0 and fallbackRate 0 shows 0%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Rate semantics: confirm with BE that missing fields are omitted, not 0.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-01

### GAP-ANALYTICS-ML-INSIGHTS-LEADS-06  ·  LOW  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** CSV export 'ms-predictions' (RecentPredictionsTable.tsx:159-160) exports entity ids and scores for the whole table with no role gate or DPDP purpose note.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions'; DataTable.tsx:276-291 downloadCsv builds the CSV client-side from the currently sorted rows (all filtered rows, not just the page) with no permission check, purpose note or audit event. Access control is only ModuleGate moduleKey='analytics' (analytics/layout.tsx). Original :159-160 refs wrong (actual 66-67). Data exported: entityId, prediction, confidence, outcome, date; no names or PII columns, so 'PII' is overstated unless entityId maps to a person (e.g. leads/contacts). No <Masked> component exists in apps/web/src/app/_components. Backend RBAC/audit is cannot-verify (ms-service absent). Leads link to crm/contacts/[id] (route exists), so exported ids may identify individuals - the DPDP concern is more real here.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add optional `exportable` gating prop already on DataTable; in RecentPredictionsTable pass exportable only when the user holds an analytics-export permission (use the existing role/permission helper in lib/auth or moduleVisibility).
  2. Add an `onExport` callback prop to DataTable (called before download) and POST an audit event through the existing web audit route/BFF (action 'ml.predictions.export', domain, row count, filter).
  3. Add a short purpose/DPDP notice next to the Export button for domains referencing persons (leads).
  4. Have ms-service enforce the same role on the evaluations endpoint (backend).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - With permission, clicking Export fires onExport once and downloads CSV.
  - Audit event contains user, domain and row count.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: adds an audit call on a client download; must not block export if audit fails silently - decide policy.


---
## /analytics/ml-insights/projects  —  `analytics/ml-insights-projects.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/projects/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights-projects.html`

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: DomainInsightPage.tsx source===error returns RefreshErrorState before any stat; DomainInsightPage.test.tsx 'renders a retry panel and NOT the model active copy' passes)
- **First-pass claim:** Failed fetch reads as 'model inactive': getMLDomainEvaluation falls back to emptyEvaluation (_data.ts:177-185,229-238), DomainInsightPage adds only a badge (DomainInsightPage.tsx:48) and renders zero stats plus 'No trend/factor data available yet' and 'once the ML model is active' copy (RecentPredictionsTable.tsx:161-163); no retry.
- **Verified evidence:** projects/page.tsx: getMLDomainEvaluation("tasks") returns {data: emptyEvaluation, source} on any failure (_data.ts:93-101,145-155; fetchJson returns empty+source 'error' for no base URL, 401, non-2xx, bad payload). DomainInsightPage.tsx:48 only adds <DataSourceBadge source='error'> and still renders totalPredictions '0' (:54), '—' for accuracy/fallback via formatPct (:26-28), topFactor '—', AccuracyTrendChart 'No trend data available yet' (AccuracyTrendChart.tsx:14-19), FactorBreakdown 'No factor data available yet' (FactorBreakdown.tsx:14-19) and the table empty state 'Predictions will appear here once the ML model is active' (RecentPredictionsTable.tsx:68-70, cited as 161-163 earlier - wrong lines). No retry (error.tsx only catches thrown errors, which never happen here). Overstated: accuracy/fallback already show '—', not 0; the badge does signal error. ms-service itself is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. In DomainInsightPage, when source==='error' return early: <PageHeader/> + <RefreshErrorState error={toHumanError('load',{area:'ML insights'})} backHref='/analytics/ml-insights'/> (as done in projects/[id]/page.tsx) instead of stats/cards.
  2. Keep DataSourceBadge out of the error branch; render the normal layout only when source==='api'.
  3. In _data.ts make the empty fallback distinguishable: add `hasData: boolean` (or return null) to MLDomainEvaluation so a healthy 'no predictions yet' response (source 'api', totalPredictions 0) keeps the 'model not active yet' copy while errors never reach it.
  4. In StatCard values, render '—' for totalPredictions when !hasData instead of '0'.
  5. Pass source into AccuracyTrendChart/FactorBreakdown empty branches only for the api+empty case (no changes needed if the early return is added).
  6. Add a component test for DomainInsightPage with source='error'.
- **Acceptance:**
  - Component test: DomainInsightPage source='error' renders the RefreshErrorState with a Retry button and does not contain 'once the ML model is active' or 'No trend data'.
  - Manual: stop the gateway; page shows error state, Retry calls router.refresh and recovers when the gateway returns.
  - source='api' with empty arrays still shows the empty-state copy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only page. Fix once in the shared component covers all six ml-insights domain pages (tickets, subscriptions too).
- **Depends on:** RefreshErrorState

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE (was LOADING)

- [x] **Status** (W2 analytics: closed by #2045; projects page links rows to the OWNING project's tasks via parentLinkTemplate=/projects/{parentId}/tasks (RecentPredictionsTable.tsx; RecentPredictionsTable.test.tsx: linked with parentId, plain text without). The wrong task-id->/projects/[id] link stays removed (drillRoutes.test.ts). NOTE: ml-service does not emit parentId yet, so rows are unlinked until it does — safe, not dead)
- **First-pass claim:** Wrong drill-through target: the domain key is 'tasks' and stat label 'Tasks Scored' (projects/page.tsx:5,16) but rowLinkPrefix is '/projects/' (projects/page.tsx:14), whose [id] route expects a project id; a task id resolves to not-found or the wrong record.
- **Verified evidence:** projects/page.tsx:5 loads domain 'tasks', label 'Tasks Scored' (:16) but rowLinkPrefix='/projects/' (:14). projects/[id]/page.tsx calls getProjectById(params.id) and shows 'Project not found' for unknown ids; projects/[id]/tasks contains only page.tsx (no task id route). So a task entityId links to a not-found page (or a wrong project if ids collide). Theme LOADING is wrong; this is a dead/wrong route.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/projects/page.tsx`, `apps/web/src/app/(app)/projects/[id]/tasks/page.tsx`
- **Fix steps:**
  1. Ask ms-service whether recentPredictions can carry a parent projectId (add optional `parentId` to RecentPredictionRow).
  2. If available, build hrefs as /projects/${projectId}/tasks (existing route) via a `rowHref` function prop on RecentPredictionsTable/DataTable instead of a string prefix.
  3. If not available, drop rowLinkPrefix so rows are plain text.
  4. Add the route-existence test for ml-insights prefixes.
- **Acceptance:**
  - Row link opens the owning project's tasks page.
  - Rows with no parent are not links.
  - No 'Project not found' from ML rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; risk of linking to wrong project if ids ambiguous.

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-03  ·  MEDIUM  ·  partly  ·  theme CHART (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trend bars are scaled to the series maximum, not 0-100% (AccuracyTrendChart.tsx:23,29), and coloured green/amber/red at fixed 0.7/0.4 cut-offs (AccuracyTrendChart.tsx:36); x labels are MM-DD only (slice(5), :55) with no year; per-bar aria-label sits on role='presentation' nodes (:44-45).
- **Verified evidence:** AccuracyTrendChart.tsx: bars scale to the series max (maxAccuracy :22, heightPct :28) so a flat 40% series looks full-height; colour thresholds hard-coded 0.7/0.4 (:42); x labels are point.date.slice(5) = MM-DD, no year (:53-54); per-bar aria-label is on a div with role='presentation' (:44-45) inside a role='img' parent (:25) whose label is only 'Accuracy trend over N data points', so per-point values are not exposed to screen readers (visible % labels at :36 are text but colour is the only good/bad cue). Earlier line numbers were off by 1-2. The suggested i18n fix does not match: the problem is chart semantics/a11y, not translation (the file has no hard-coded translated keys beyond a few English strings).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`
- **Fix steps:**
  1. Scale bar height against a fixed 0..1 axis (heightPct = accuracy*100) and drop maxAccuracy, or add gridlines at 0/50/100%.
  2. Accept optional props `higherIsBetter` and `thresholds` (default {good:0.7,warn:0.4}); compute colour from them.
  3. Add a non-colour cue: status text/icon per bar (e.g. hidden 'good/fair/poor' via sr-only text) or a legend.
  4. Replace role='img' wrapper with a <table class='sr-only'> or <ul> of `${date}: ${pct}` items, and remove aria-label from role='presentation' bars.
  5. Format x labels with a shared date formatter (dd MMM) via Intl, include year when the range spans years.
- **Acceptance:**
  - Component test: 3 points 0.2/0.5/0.9 render heights 20/50/90% and distinct status text.
  - axe: no aria-label on presentation nodes; screen reader lists each date with its value.
  - Series spanning Dec-Jan shows year.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational only.

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-04  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: RecentPredictionsTable.tsx entityDisplay (label first) + formatPrediction by PredictionKind; RecentPredictionsTable.test.tsx passes. BE ml-service evaluations does not yet emit entityLabel/recentPredictions (see PR body))
- **First-pass claim:** Entity column prints the raw entityId (RecentPredictionsTable.tsx:146,153), an opaque UUID; Prediction is formatted as a percentage for every domain (formatConfidence, RecentPredictionsTable.tsx:137) even where the model output is not a probability.
- **Verified evidence:** RecentPredictionsTable.tsx:53 column {key:'entityId',label:'Entity'} prints p.entityId (mapped from API entityId, _data.ts:126) verbatim, and rowLinkKey='entityId' (:60) makes it the link text; no name lookup exists. Prediction is formatted with formatConfidence as a percentage for every domain (:13-15,44), even for inventory (demand forecast quantity) or task dates. Whether entityId is a UUID cannot be verified: ms-service is not in the snapshot. Original line refs 146,153,137 were wrong (actual 44,53,60,13-15). EntityPicker is not applicable (display, not input).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Ask ms-service/BE for an `entityLabel` (name/code) on recentPredictions; add optional entityLabel to RecentPredictionRow and map it in mapEvaluation.
  2. Render the label (fallback to a short id, e.g. last 8 chars, with full id in title/aria) in the Entity column while keeping entityId as the link key; add a hidden column or custom cell so href still uses the id.
  3. Add a per-domain `predictionFormat` prop ('percent' | 'number' | 'date') on DomainInsightPage -> RecentPredictionsTable and format accordingly.
  4. Set prediction format per page: leads/tickets/subscriptions/transactions percent probability, inventory number, tasks days/date.
- **Acceptance:**
  - Component test: row with entityLabel 'Widget A' shows it and links to prefix+id.
  - Row without label shows shortened id with full id in title.
  - Inventory page shows numeric prediction, not '%'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; needs BE contract for label; wrong format could misstate forecasts.

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: _data.ts toNullableNumber + DomainInsightPage formatPct(0)=0%/null=em dash; _data.test.ts + DomainInsightPage.test.tsx pass)
- **First-pass claim:** formatPct returns '—' for value 0 (DomainInsightPage.tsx:27), so a genuine 0% precision/fallback rate is indistinguishable from missing data.
- **Verified evidence:** DomainInsightPage.tsx:26-28 formatPct returns '—' when value <= 0, so a real 0% (e.g. 0% false positive rate, 0% fallback) shows '—'; conversely the empty fallback (_data.ts:93-101 sets accuracy/fallbackRate 0, toNumber() coerces missing to 0 at :56-58) is indistinguishable from a real zero. Line ref 27 is correct. Hub page.tsx:22 has the same >0 pattern.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Make accuracy/fallbackRate nullable in MLDomainEvaluation (number | null); in mapEvaluation use null when the field is absent/non-numeric instead of toNumber()->0 (keep 0 for genuine 0).
  2. Change formatPct(value: number|null) to return '—' only for null/NaN, and `${Math.round(v*100)}%` for 0.
  3. Use totalPredictions===0 as the 'no data' signal for showing '—' on rate cards.
  4. Apply the same to ml-insights/page.tsx avgAccuracy logic.
- **Acceptance:**
  - Unit test: formatPct(0)==='0%', formatPct(null)==='—'.
  - mapEvaluation({}) yields null rates; mapEvaluation({accuracy:0}) yields 0.
  - Page with totalPredictions>0 and fallbackRate 0 shows 0%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Rate semantics: confirm with BE that missing fields are omitted, not 0.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-01

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-06  ·  LOW  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** CSV export 'ms-predictions' (RecentPredictionsTable.tsx:159-160) exports entity ids and scores for the whole table with no role gate or DPDP purpose note.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions'; DataTable.tsx:276-291 downloadCsv builds the CSV client-side from the currently sorted rows (all filtered rows, not just the page) with no permission check, purpose note or audit event. Access control is only ModuleGate moduleKey='analytics' (analytics/layout.tsx). Original :159-160 refs wrong (actual 66-67). Data exported: entityId, prediction, confidence, outcome, date; no names or PII columns, so 'PII' is overstated unless entityId maps to a person (e.g. leads/contacts). No <Masked> component exists in apps/web/src/app/_components. Backend RBAC/audit is cannot-verify (ms-service absent).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add optional `exportable` gating prop already on DataTable; in RecentPredictionsTable pass exportable only when the user holds an analytics-export permission (use the existing role/permission helper in lib/auth or moduleVisibility).
  2. Add an `onExport` callback prop to DataTable (called before download) and POST an audit event through the existing web audit route/BFF (action 'ml.predictions.export', domain, row count, filter).
  3. Add a short purpose/DPDP notice next to the Export button for domains referencing persons (leads).
  4. Have ms-service enforce the same role on the evaluations endpoint (backend).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - With permission, clicking Export fires onExport once and downloads CSV.
  - Audit event contains user, domain and row count.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: adds an audit call on a client download; must not block export if audit fails silently - decide policy.

### GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-07  ·  LOW  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — hub label, page title and stat labels all say 'Task Delay Prediction' / 'Tasks Scored'; route /analytics/ml-insights/projects unchanged (source: ml-insights/page.tsx DOMAIN_META, projects/page.tsx); closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Route segment 'projects' but data domain 'tasks' (ml-insights/page.tsx:10 vs projects/page.tsx:5) — hub label 'Project Delay Prediction' scores tasks.
- **Verified evidence:** Hub ml-insights/page.tsx:12 maps key tasks -> label 'Project Delay Prediction' -> href /analytics/ml-insights/projects; projects/page.tsx:5 fetches domain 'tasks', title 'Project Delay Prediction Insights', stat 'Tasks Scored'. Naming is inconsistent (project vs task) but consistent internally: it scores task completion dates (subtitle). Low-severity copy/naming issue, not i18n; also the hub line ref 10 in the finding is actually :12.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/projects/page.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/page.tsx`
- **Fix steps:**
  1. Decide wording: 'Task Delay Prediction' (matches data) or aggregate to project level.
  2. Update hub DOMAIN_META label, projects/page.tsx title/subtitle/stat labels consistently.
  3. Keep route /projects (or add redirect if renamed to /tasks).
- **Acceptance:**
  - Hub card label, page title and stat labels use the same noun.
  - Old URL still resolves.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.


---
## /analytics/ml-insights/subscriptions  —  `analytics/ml-insights-subscriptions.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/subscriptions/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights-subscriptions.html`

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: DomainInsightPage.tsx source===error returns RefreshErrorState before any stat; DomainInsightPage.test.tsx 'renders a retry panel and NOT the model active copy' passes)
- **First-pass claim:** Failed fetch reads as 'model inactive': getMLDomainEvaluation falls back to emptyEvaluation (_data.ts:177-185,229-238), DomainInsightPage adds only a badge (DomainInsightPage.tsx:48) and renders zero stats plus 'No trend/factor data available yet' and 'once the ML model is active' copy (RecentPredictionsTable.tsx:161-163); no retry.
- **Verified evidence:** _data.ts has no lines 177-185/229-238 (file is 155 lines); real code: getMLDomainEvaluation (_data.ts:145-155) passes emptyEvaluation (:93-101, all zeros/empty arrays) as the fetchJson fallback, which returns {data: empty, source:'error'} on any failure (apiClient.ts:119-172). DomainInsightPage.tsx:48 adds only <DataSourceBadge source='error'>; StatCards then render totalPredictions '0' (:54), '—' for accuracy/fallback (formatPct :26-28 maps 0 to em-dash), trend/factor empty text ('No trend data available yet.' AccuracyTrendChart.tsx:14-19, 'No factor data available yet.' FactorBreakdown.tsx:14-19), and the table empty state 'once the ML model is active' (RecentPredictionsTable.tsx:68-70, not :161-163). No retry control on the page. Note: an empty-but-successful response is also indistinguishable from an error apart from the badge.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. In DomainInsightPage, when source==='error' return early after PageHeader with <RefreshErrorState error={{what:'ML evaluation could not be loaded', next:'Retry in a moment', actions:['retry','back']}} backHref='/analytics/ml-insights'/> (pattern already used in metadata/records/page.tsx).
  2. Drop the DataSourceBadge-only branch for error; keep it for source==='api'.
  3. Additionally, in the api case, show an explicit 'No model active / no predictions in the last 30 days' empty state (with link to model activation if one exists) instead of zero stats.
  4. Optionally pass errored flag so StatCard totalPredictions shows '—' rather than '0' (mirror analytics/dashboards/page.tsx `errored ? '—' : n`).
  5. Do not change emptyEvaluation fallback contract in apiClient; branch on source only.
- **Acceptance:**
  - Component test: render DomainInsightPage with source='error' and emptyEvaluation -> RefreshErrorState with Retry button visible; no StatCard, no 'once the ML model is active' text.
  - Component test: source='api' with recentPredictions=[] -> empty-state copy shown, not the error state.
  - Manual: stop ms-service, open /analytics/ml-insights/<domain> -> retry panel; restart, click Retry -> data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentation only. Shared component change affects all 6 domain pages, so do it once.
- **Depends on:** shared: RefreshErrorState, GAP-ANALYTICS-ML-INSIGHTS-01

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 W1 SF-18 (#2019) re-confirmed: closed by #1916; prefix removed, route-existence analyzer clean, drillRoutes.test.ts)
- **First-pass claim:** Dead drill-through: rowLinkPrefix '/billing/subscriptions/' (subscriptions/page.tsx:14) — billing/subscriptions has page.tsx, SubscriptionsTable.tsx, loading and error only, no [id] route, so every Entity link is a 404.
- **Verified evidence:** subscriptions/page.tsx:14 sets rowLinkPrefix='/billing/subscriptions/'; DataTable resolveHref builds `${prefix}${row.entityId}` (DataTable.tsx:212) and renders it as a link/click-through (:362-389). apps/web/src/app/(app)/billing/subscriptions contains only SubscriptionsTable.tsx, error.tsx, loading.tsx, page.tsx - no [id] dir, so every row link 404s.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/subscriptions/page.tsx`, `apps/web/src/app/(app)/billing/subscriptions/[id]/page.tsx (new, if detail wanted)`
- **Fix steps:**
  1. Short-term: remove rowLinkPrefix from subscriptions/page.tsx so rows are not clickable (DataTable only links when both key and prefix set).
  2. Long-term: create billing/subscriptions/[id]/page.tsx (+loading/error) reading the subscription via the billing API, then restore the prefix.
  3. Confirm entityId in ML rows equals the billing subscription id (backend).
- **Acceptance:**
  - Manual: click a prediction row -> no 404 (either not clickable or opens detail).
  - Route test: /billing/subscriptions/<id> returns 200 when detail is built.
- **Needs:** web  ·  **Effort:** XS <1h (remove) / M ~1-2d (build detail)  ·  **Risk:** Low; removing link loses a drill path that never worked.

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-03  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trend bars are scaled to the series maximum, not 0-100% (AccuracyTrendChart.tsx:23,29), and coloured green/amber/red at fixed 0.7/0.4 cut-offs (AccuracyTrendChart.tsx:36); x labels are MM-DD only (slice(5), :55) with no year; per-bar aria-label sits on role='presentation' nodes (:44-45).
- **Verified evidence:** AccuracyTrendChart.tsx: bar height = accuracy/maxAccuracy (:22,28) so bars scale to series max, not 0-100% (a flat 30% series looks full height); colour thresholds 0.7/0.4 hard-coded (:42, not :36); x labels point.date.slice(5) = MM-DD (:54) with no year; per-bar aria-label on a role='presentation' div (:44-45) which is ignored by AT (outer role='img' carries only a generic 'over N data points' label, :25). Bars also hard-code hex colours and English strings; colour is the only status cue (value label is shown above, partly mitigating). Also applies to inventory MAPE domain, where the 0.7/0.4 green/red semantics are inverted (lower is better).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Scale height against a fixed 0..1 axis (heightPct = accuracy*100) or draw a labelled 0/50/100% gridline; keep maxAccuracy only if an explicit 'zoomed' axis is labelled.
  2. Accept props {metricLabel, higherIsBetter, thresholds} from DomainInsightPage so MAPE domains invert the colour logic; use DS status tokens (var(--ok/--warn/--err)) instead of hex.
  3. Format x labels with formatIndianDate / Intl (day+month, year on first/January point) and add a title attribute with the full date.
  4. Replace the role='img' wrapper + presentation bars with a visually hidden <table> or <ul> of 'date: 82% accuracy' and aria-hidden the bars; add non-colour cue (pattern or ▲/▼ vs threshold text).
  5. Move visible strings ('No trend data available yet.', 'accuracy') to next-intl keys if the ml-insights namespace uses them (check apps/web messages).
- **Acceptance:**
  - Unit test: data [{date:'2026-03-01',accuracy:0.3}] renders bar height 30% not 100%.
  - axe test: no aria-label on presentation nodes; screen-reader text lists each date and value.
  - Visual: inventory (MAPE) 12% renders as 'good' colour.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; visual only. Changing the scale will make existing trends look flatter - communicate to stakeholders.

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-04  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: RecentPredictionsTable.tsx entityDisplay (label first) + formatPrediction by PredictionKind; RecentPredictionsTable.test.tsx passes. BE ml-service evaluations does not yet emit entityLabel/recentPredictions (see PR body))
- **First-pass claim:** Entity column prints the raw entityId (RecentPredictionsTable.tsx:146,153), an opaque UUID; Prediction is formatted as a percentage for every domain (formatConfidence, RecentPredictionsTable.tsx:137) even where the model output is not a probability.
- **Verified evidence:** RecentPredictionsTable.tsx: Entity column is key 'entityId' with no label mapping (:53) and rowLinkKey='entityId' (:60), so the raw id string is displayed as the link text (:43) - lines cited (146,153,137) do not exist, file is 73 lines. Prediction is formatted via formatConfidence -> Math.round(v*100)+'%' (:13-15,44) for every domain. Whether entityId is a UUID and whether prediction is a probability is not visible here (ms-service absent); for subscriptions/tickets the page subtitles say 'churn/SLA breach probability', so % is plausible there; it is wrong for inventory (MAPE/units) and anomalies. The table has no name lookup and no batch-resolve endpoint is visible.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Extend RecentPredictionRow/mapEvaluation with an optional entityLabel (only if the ms evaluations response provides one - confirm with backend); fall back to a truncated id with copy button.
  2. Add prop entityLabel + predictionKind ('probability'|'value') to RecentPredictionsTable; format non-probability predictions with formatNumber and unit from page config.
  3. Have each domain page pass predictionKind (subscriptions/tickets: 'probability').
  4. If backend lacks names, add a batch resolve (e.g. ids -> names) on the API side or accept id display with a 'Copy id' affordance.
- **Acceptance:**
  - Component test: row with entityLabel 'Acme Subscription' shows the label and links via id.
  - Component test: predictionKind 'value' does not append %.
  - Manual: Entity column shows names when API provides them.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; risk of showing wrong label if lookup is stale.

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: _data.ts toNullableNumber + DomainInsightPage formatPct(0)=0%/null=em dash; _data.test.ts + DomainInsightPage.test.tsx pass)
- **First-pass claim:** formatPct returns '—' for value 0 (DomainInsightPage.tsx:27), so a genuine 0% precision/fallback rate is indistinguishable from missing data.
- **Verified evidence:** DomainInsightPage.tsx:26-28 formatPct returns '—' when value <= 0 (`value > 0 ? ... : '—'`), used for accuracy (:60) and fallback rate (:66). A real 0% fallback rate (the ideal) shows '—'. Note the observation says 'precision' but the same formatter covers all metrics. Also emptyEvaluation defaults to 0, so 0 cannot be told apart from missing at data layer (see -01).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Make MLDomainEvaluation accuracy/fallbackRate nullable: in mapEvaluation use a toNullableNumber (returns null when field absent/non-finite) instead of toNumber.
  2. Change formatPct to `value == null ? '—' : Math.round(value*100)+'%'`.
  3. Update emptyEvaluation to null for those fields; adjust hub page.tsx similarly if MLDomainSummary is changed.
- **Acceptance:**
  - Unit test: formatPct(0) === '0%', formatPct(null) === '—'.
  - Component test: API payload with fallbackRate:0 renders '0%'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-01

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-06  ·  MEDIUM  ·  partly  ·  theme EMPTYSTATE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — DomainInsightPage.test.tsx 'shows a single honest empty state, not zero stat cards' passes; detail wording 'No active model for Churn Prediction' matches hub; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** The hub shows this domain as 'No model active' whenever the evaluations list omits it (ml-insights/page.tsx:46,76) yet this page still renders zeros and 'once the ML model is active' copy with no link back to how to activate a model.
- **Verified evidence:** Hub ml-insights/page.tsx:46 uses domains.find(...) and shows 'No model active' (:76) when absent - correct as described (the observed lines :46,76 are right). The subscriptions page, by contrast, renders zero stats plus 'once the ML model is active' copy (RecentPredictionsTable.tsx:68-70). The mismatch is real but the framing as DEADROUTE is wrong: there is no dead link, and no model-activation screen is visible in the web app (grep found none), so 'link back to how to activate' has no target. Hub also cannot distinguish an errored list (see ML-INSIGHTS-01) from a missing domain.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Pass a flag from the page (e.g. modelActive derived from evaluation.totalPredictions>0 or a modelVersion field if the ms API returns it on the per-domain call - confirm with backend) into DomainInsightPage.
  2. When no model/predictions and source==='api', render one EmptyState 'No model active for Churn Prediction' with a link to /analytics/ml-insights instead of zero stats.
  3. Only add an activation link if a model-management route exists; otherwise decision needed.
- **Acceptance:**
  - Component test: empty api evaluation -> single EmptyState, no zero StatCards.
  - Hub and detail page show consistent wording for the same domain.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-01

### GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-07  ·  LOW  ·  partly  ·  theme EXPORT (was PII)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** CSV export 'ms-predictions' (RecentPredictionsTable.tsx:159-160) exports entity ids and scores for the whole table with no role gate or DPDP purpose note.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions' (not :159-160); DataTable.tsx:275-291 builds a client-side CSV Blob of the already-rendered (max recentPredictions) rows and downloads it - no role gate, no audit call, no purpose note. Overstated: it exports only the rows the page already showed (formatted % strings and entity ids), not 'the whole table' server-side, and the ids are business record ids, not direct personal data (whether they are PII depends on the domain; unverified). The page itself is reachable by anyone with route access; server-side authorization not verifiable here.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add an optional onExport / canExport prop to DataTable; when provided, call it before creating the Blob (used to POST an audit event via the existing proxy - confirm an audit endpoint exists).
  2. In RecentPredictionsTable set exportable only when the user has an analytics export permission (use the existing role guard / PermissionDenied pattern).
  3. Rename filename to include domain and date (e.g. ml-subscriptions-predictions-YYYY-MM-DD).
  4. Backend to confirm export audit event type (CLAUDE.md audit events rule).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - Export click emits one audit request with domain and row count.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; audit logging must not block export failure path.


---
## /analytics/ml-insights/tickets  —  `analytics/ml-insights-tickets.html`

- **Source:** `apps/web/src/app/(app)/analytics/ml-insights/tickets/page.tsx`
- **Design reference:** `redesign/analytics/ml-insights-tickets.html`

### GAP-ANALYTICS-ML-INSIGHTS-TICKETS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: DomainInsightPage.tsx source===error returns RefreshErrorState before any stat; DomainInsightPage.test.tsx 'renders a retry panel and NOT the model active copy' passes)
- **First-pass claim:** Failed fetch reads as 'model inactive': getMLDomainEvaluation falls back to emptyEvaluation (_data.ts:177-185,229-238), DomainInsightPage adds only a badge (DomainInsightPage.tsx:48) and renders zero stats plus 'No trend/factor data available yet' and 'once the ML model is active' copy (RecentPredictionsTable.tsx:161-163); no retry.
- **Verified evidence:** _data.ts has no lines 177-185/229-238 (file is 155 lines); real code: getMLDomainEvaluation (_data.ts:145-155) passes emptyEvaluation (:93-101, all zeros/empty arrays) as the fetchJson fallback, which returns {data: empty, source:'error'} on any failure (apiClient.ts:119-172). DomainInsightPage.tsx:48 adds only <DataSourceBadge source='error'>; StatCards then render totalPredictions '0' (:54), '—' for accuracy/fallback (formatPct :26-28 maps 0 to em-dash), trend/factor empty text ('No trend data available yet.' AccuracyTrendChart.tsx:14-19, 'No factor data available yet.' FactorBreakdown.tsx:14-19), and the table empty state 'once the ML model is active' (RecentPredictionsTable.tsx:68-70, not :161-163). No retry control on the page. Note: an empty-but-successful response is also indistinguishable from an error apart from the badge.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. In DomainInsightPage, when source==='error' return early after PageHeader with <RefreshErrorState error={{what:'ML evaluation could not be loaded', next:'Retry in a moment', actions:['retry','back']}} backHref='/analytics/ml-insights'/> (pattern already used in metadata/records/page.tsx).
  2. Drop the DataSourceBadge-only branch for error; keep it for source==='api'.
  3. Additionally, in the api case, show an explicit 'No model active / no predictions in the last 30 days' empty state (with link to model activation if one exists) instead of zero stats.
  4. Optionally pass errored flag so StatCard totalPredictions shows '—' rather than '0' (mirror analytics/dashboards/page.tsx `errored ? '—' : n`).
  5. Do not change emptyEvaluation fallback contract in apiClient; branch on source only.
- **Acceptance:**
  - Component test: render DomainInsightPage with source='error' and emptyEvaluation -> RefreshErrorState with Retry button visible; no StatCard, no 'once the ML model is active' text.
  - Component test: source='api' with recentPredictions=[] -> empty-state copy shown, not the error state.
  - Manual: stop ms-service, open /analytics/ml-insights/<domain> -> retry panel; restart, click Retry -> data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentation only. Shared component change affects all 6 domain pages, so do it once.
- **Depends on:** shared: RefreshErrorState, GAP-ANALYTICS-ML-INSIGHTS-01

### GAP-ANALYTICS-ML-INSIGHTS-TICKETS-02  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — AccuracyTrendChart.test.tsx: 30% -> 30% height, sr-only date/value list, no aria-label on presentation bars, MAPE good band all pass; chart colours use var(--ok/--warn/--err) tokens; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trend bars are scaled to the series maximum, not 0-100% (AccuracyTrendChart.tsx:23,29), and coloured green/amber/red at fixed 0.7/0.4 cut-offs (AccuracyTrendChart.tsx:36); x labels are MM-DD only (slice(5), :55) with no year; per-bar aria-label sits on role='presentation' nodes (:44-45).
- **Verified evidence:** AccuracyTrendChart.tsx: bar height = accuracy/maxAccuracy (:22,28) so bars scale to series max, not 0-100% (a flat 30% series looks full height); colour thresholds 0.7/0.4 hard-coded (:42, not :36); x labels point.date.slice(5) = MM-DD (:54) with no year; per-bar aria-label on a role='presentation' div (:44-45) which is ignored by AT (outer role='img' carries only a generic 'over N data points' label, :25). Bars also hard-code hex colours and English strings; colour is the only status cue (value label is shown above, partly mitigating). Also applies to inventory MAPE domain, where the 0.7/0.4 green/red semantics are inverted (lower is better).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`
- **Fix steps:**
  1. Scale height against a fixed 0..1 axis (heightPct = accuracy*100) or draw a labelled 0/50/100% gridline; keep maxAccuracy only if an explicit 'zoomed' axis is labelled.
  2. Accept props {metricLabel, higherIsBetter, thresholds} from DomainInsightPage so MAPE domains invert the colour logic; use DS status tokens (var(--ok/--warn/--err)) instead of hex.
  3. Format x labels with formatIndianDate / Intl (day+month, year on first/January point) and add a title attribute with the full date.
  4. Replace the role='img' wrapper + presentation bars with a visually hidden <table> or <ul> of 'date: 82% accuracy' and aria-hidden the bars; add non-colour cue (pattern or ▲/▼ vs threshold text).
  5. Move visible strings ('No trend data available yet.', 'accuracy') to next-intl keys if the ml-insights namespace uses them (check apps/web messages).
- **Acceptance:**
  - Unit test: data [{date:'2026-03-01',accuracy:0.3}] renders bar height 30% not 100%.
  - axe test: no aria-label on presentation nodes; screen-reader text lists each date and value.
  - Visual: inventory (MAPE) 12% renders as 'good' colour.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; visual only. Changing the scale will make existing trends look flatter - communicate to stakeholders.

### GAP-ANALYTICS-ML-INSIGHTS-TICKETS-03  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: RecentPredictionsTable.tsx entityDisplay (label first) + formatPrediction by PredictionKind; RecentPredictionsTable.test.tsx passes. BE ml-service evaluations does not yet emit entityLabel/recentPredictions (see PR body))
- **First-pass claim:** Entity column prints the raw entityId (RecentPredictionsTable.tsx:146,153), an opaque UUID; Prediction is formatted as a percentage for every domain (formatConfidence, RecentPredictionsTable.tsx:137) even where the model output is not a probability.
- **Verified evidence:** RecentPredictionsTable.tsx: Entity column is key 'entityId' with no label mapping (:53) and rowLinkKey='entityId' (:60), so the raw id string is displayed as the link text (:43) - lines cited (146,153,137) do not exist, file is 73 lines. Prediction is formatted via formatConfidence -> Math.round(v*100)+'%' (:13-15,44) for every domain. Whether entityId is a UUID and whether prediction is a probability is not visible here (ms-service absent); for subscriptions/tickets the page subtitles say 'churn/SLA breach probability', so % is plausible there; it is wrong for inventory (MAPE/units) and anomalies. The table has no name lookup and no batch-resolve endpoint is visible.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Extend RecentPredictionRow/mapEvaluation with an optional entityLabel (only if the ms evaluations response provides one - confirm with backend); fall back to a truncated id with copy button.
  2. Add prop entityLabel + predictionKind ('probability'|'value') to RecentPredictionsTable; format non-probability predictions with formatNumber and unit from page config.
  3. Have each domain page pass predictionKind (subscriptions/tickets: 'probability').
  4. If backend lacks names, add a batch resolve (e.g. ids -> names) on the API side or accept id display with a 'Copy id' affordance.
- **Acceptance:**
  - Component test: row with entityLabel 'Acme Subscription' shows the label and links via id.
  - Component test: predictionKind 'value' does not append %.
  - Manual: Entity column shows names when API provides them.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; risk of showing wrong label if lookup is stale.

### GAP-ANALYTICS-ML-INSIGHTS-TICKETS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 analytics: closed by #2045 — already fixed on main 60ff08f47: _data.ts toNullableNumber + DomainInsightPage formatPct(0)=0%/null=em dash; _data.test.ts + DomainInsightPage.test.tsx pass)
- **First-pass claim:** formatPct returns '—' for value 0 (DomainInsightPage.tsx:27), so a genuine 0% precision/fallback rate is indistinguishable from missing data.
- **Verified evidence:** DomainInsightPage.tsx:26-28 formatPct returns '—' when value <= 0, used for accuracy (:60) and fallback rate (:66); a real 0% is rendered as '—'. Shared by all six domain pages.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx`, `apps/web/src/app/(app)/analytics/ml-insights/_data.ts`
- **Fix steps:**
  1. Make accuracy/fallbackRate nullable in MLDomainEvaluation via a toNullableNumber in mapEvaluation.
  2. formatPct: null/undefined -> '—', otherwise Math.round(v*100)+'%'.
  3. Set null (not 0) in emptyEvaluation.
- **Acceptance:**
  - Unit test: formatPct(0) === '0%'; formatPct(null) === '—'.
  - Component test with fallbackRate 0 shows '0%'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-05

### GAP-ANALYTICS-ML-INSIGHTS-TICKETS-05  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Drill-through opens /helpdesk/internal/<entityId> (tickets/page.tsx:14); the domain scores helpdesk tickets in general, so citizen-facing tickets would link to an internal-only route that may 404 or be role-gated.
- **Verified evidence:** tickets/page.tsx:14 rowLinkPrefix='/helpdesk/internal/'. That route exists: helpdesk/internal/[id]/page.tsx fetches /api/v1/helpdesk/tickets/${id} (the general ticket endpoint), so it will not 404. However a separate general detail page helpdesk/tickets/[id] (with TicketActions/TicketConversation) exists and is the fuller view; the 'internal' page is a read-only summary. Whether citizen-facing tickets are role-restricted at /helpdesk/internal or by the API cannot be verified (helpdesk service and layout guards not inspected; no service in snapshot).
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/tickets/page.tsx`
- **Fix steps:**
  1. Decide which detail route is canonical for scored tickets; likely /helpdesk/tickets/ (has actions + conversation).
  2. Change rowLinkPrefix accordingly.
  3. Backend: confirm ticket ids in ml predictions map to helpdesk ticket ids and that the API enforces role/tenant checks on GET /helpdesk/tickets/:id.
- **Acceptance:**
  - Manual: click a scored ticket row as agent -> ticket opens with no 404/403 flash.
  - As a user without helpdesk access, the API returns 403 and the page shows the standard denied state.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong prefix only affects navigation. Server authorisation is the real control.

### GAP-ANALYTICS-ML-INSIGHTS-TICKETS-06  ·  LOW  ·  partly  ·  theme EXPORT (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** CSV export 'ms-predictions' (RecentPredictionsTable.tsx:159-160) exports entity ids and scores for the whole table with no role gate or DPDP purpose note.
- **Verified evidence:** RecentPredictionsTable.tsx:66-67 sets exportable + exportFilename='ms-predictions' (not :159-160); DataTable.tsx:275-291 builds a client-side CSV Blob of the already-rendered (max recentPredictions) rows and downloads it - no role gate, no audit call, no purpose note. Overstated: it exports only the rows the page already showed (formatted % strings and entity ids), not 'the whole table' server-side, and the ids are business record ids, not direct personal data (whether they are PII depends on the domain; unverified). The page itself is reachable by anyone with route access; server-side authorization not verifiable here.
- **Files to change:** `apps/web/src/app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add an optional onExport / canExport prop to DataTable; when provided, call it before creating the Blob (used to POST an audit event via the existing proxy - confirm an audit endpoint exists).
  2. In RecentPredictionsTable set exportable only when the user has an analytics export permission (use the existing role guard / PermissionDenied pattern).
  3. Rename filename to include domain and date (e.g. ml-subscriptions-predictions-YYYY-MM-DD).
  4. Backend to confirm export audit event type (CLAUDE.md audit events rule).
- **Acceptance:**
  - Component test: without permission the Export button is not rendered.
  - Export click emits one audit request with domain and row count.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; audit logging must not block export failure path.


---
## /analytics/queries  —  `analytics/queries.html`

- **Source:** `apps/web/src/app/(app)/analytics/queries/page.tsx`
- **Design reference:** `redesign/analytics/queries.html`

### GAP-ANALYTICS-QUERIES-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — queries/page.test.tsx 'renders — for every stat ... when the loader fails' + QueryResultsView.test.tsx error-no-data retry pass; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Silent zeros on failure: stats use runs.length / completed / failed with no source gate (queries/page.tsx:10-11,41-43), so a failed fetch shows Runs 0 / Completed 0 / Failed 0 beside a badge — dashboards/page.tsx (UX-013) already null-gates for the same reason.
- **Verified evidence:** queries/page.tsx:10-11,41-43: Runs/Completed/Failed StatCards use runs.length and filter counts with no source gate; on error runs=[] so the cards show 0. Correct. But the badge is not beside it any more: DataSourceBadge lives inside QueryResultsView (QueryResultsView.tsx:70), driven by useSeededResource, so a cached copy may exist and the stat cards (which use the server-side `runs`, not the hook's `rows`) can disagree with the table when offline/cached. dashboards/page.tsx:14,22-24 shows the `errored ? '—'` fix.
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/page.tsx`, `apps/web/src/app/(app)/analytics/queries/QueryResultsView.tsx`
- **Fix steps:**
  1. In page.tsx compute `const errored = source === 'error'` and render '—' for the three StatCards as in dashboards/page.tsx.
  2. Better: move the StatGrid into QueryResultsView (client) so counts derive from useSeededResource `rows` and match the table; show '—' when provenance is error-no-data.
  3. Add RefreshErrorState when provenance is error-no-data.
- **Acceptance:**
  - Test: source='error' -> cards show '—'.
  - Test: cached provenance -> counts equal table row counts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** shared: RefreshErrorState

### GAP-ANALYTICS-QUERIES-02  ·  HIGH  ·  confirmed  ·  theme MISSING-DETAIL (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — QueryResultsView.test.tsx 'shows the failure reason for a failed run' + 'no error text for completed run' pass; server-side sanitizeRunError covered by tests/registry-catalog-units.test.ts (real run); closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed runs show only a FAILED pill: AnalyticsQueryRunRow.error is mapped (_data.ts:83) but never rendered (QueryResultsView.tsx:17-23), so a user cannot see why a run failed.
- **Verified evidence:** _data.ts:83 maps error: string|null into AnalyticsQueryRunRow (field declared :29). QueryResultsView.tsx:17-23 runColumns has no error column and the StatusPill (:21) shows only 'FAILED'; the Result detail section lists only completed runs (:50). grep confirms `error` is never rendered. Theme DEADROUTE is wrong (missing feature).
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/QueryResultsView.tsx`
- **Fix steps:**
  1. Add an 'Error' column or an expandable row: render r.error under the StatusPill when r.status==='failed' (truncate + title).
  2. Make sure the message is sanitised server-side (no SQL/stack); if backend may return internal text, map to a user message.
  3. Optionally list failed runs in the selector with a failure panel.
- **Acceptance:**
  - Component test: failed run with error 'Timeout' displays 'Timeout'.
  - Completed runs show no error text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; check the backend does not leak internals in error.

### GAP-ANALYTICS-QUERIES-03  ·  MEDIUM  ·  confirmed  ·  theme REFRESH (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 analytics #2045 with evidence — QueryResultsView.test.tsx polling tests (schedules refresh while pending, stops when none) + RunQueryForm.test.tsx 'calls router.refresh after a 202' pass; closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Fire-and-forget with no refresh: after the 202 the form says results 'appear once processed' (RunQueryForm.tsx:200) but the page is a server component with no router.refresh or polling, so a queued run stays invisible until manual reload; a 'running' row never updates.
- **Verified evidence:** RunQueryForm.tsx:200 sets 'Query queued - results appear in Query Results once processed.' then resetForm(); the file has no useRouter/router.refresh/interval (grep shows none). page.tsx is a server component with the initial `runs`; useSeededResource (QueryResultsView.tsx:43) only reseeds from props. So new/running rows appear only after manual reload. Theme should be REFRESH not DEADROUTE.
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/RunQueryForm.tsx`, `apps/web/src/app/(app)/analytics/queries/QueryResultsView.tsx`
- **Fix steps:**
  1. In RunQueryForm import useRouter and call router.refresh() after the 202.
  2. In QueryResultsView, if any row status is 'queued'/'running', poll router.refresh() every ~5s (cleanup on unmount, stop after N tries) - use the existing status values from _data.ts.
  3. Announce via aria-live 'Run completed'.
- **Acceptance:**
  - Test: mock 202 -> router.refresh called once.
  - With a running row, refresh is scheduled and stops when none remain.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; polling load - keep interval >=5s.

### GAP-ANALYTICS-QUERIES-04  ·  MEDIUM  ·  partly  ·  theme UNITS (was MONEY)

- [x] **Status** (W2 analytics: closed by #2045; metric/dimension labels and the unit now come from the backend catalog GET /v1/analytics/catalog (_data.ts getAnalyticsCatalogLabels, queries/page.tsx, QueryResultsView.tsx); catalog unit wins over the amount_ key heuristic, which stays only as fallback; unlabeled dimension keys are humanised (department_id -> Department). QueryResultsView.test.tsx + catalog-labels.test.ts)
- **W0-10 note:** review found the W0 tick partly — Money units fixed (QueryResultsView.tsx:19-21 formatMoney for paise; metric label for value column :151) but unit is a client heuristic unitForMetric = key.startsWith("amount_") (analytics/_data.ts:37), not backend-declared; dimension headers still raw keys (QueryResultsView.tsx:146 label: d) so acceptance "Department not department_id" unmet
- **First-pass claim:** Result values have no unit or currency: AccessibleBarChart takes a unit prop (AccessibleBarChart.tsx:20) that QueryResultsView never passes (QueryResultsView.tsx:117), so money metrics render as bare numbers (paise vs rupees ambiguous); result-row column headers are the raw dimension keys (QueryResultsView.tsx:59).
- **Verified evidence:** AccessibleBarChart accepts unit (:18-26) and QueryResultsView.tsx:117 does not pass it; values are shown via toLocaleString('en-IN') (:38,67), so no currency/unit. Result table column headers are raw dimension keys (QueryResultsView.tsx:59: label: d). True. But whether any metric is money in paise cannot be verified: the catalog MetricDef only has key/label/agg (RunQueryForm.tsx:25) and the analytics service is absent, so the paise/rupee ambiguity is plausible but unconfirmed. Value column is fixed label 'Value' (:60).
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/QueryResultsView.tsx`, `apps/web/src/app/(app)/analytics/_data.ts`, `apps/web/src/app/(app)/analytics/queries/RunQueryForm.tsx`
- **Fix steps:**
  1. Backend: add unit ('paise'|'count'|'percent'|...) to catalog metrics and to AnalyticsQueryRunRow (confirm existence).
  2. Carry unit in _data.ts mapping; in QueryResultsView pass unit to AccessibleBarChart and render money using formatINR on paise (bigint-safe), not toLocaleString.
  3. Use catalog labels for dimension headers and the metric label for the Value column (fetch catalog or store labels with the run).
- **Acceptance:**
  - Test: paise metric 12345 renders ₹123.45 in chart and table.
  - Column headers show 'Department' not 'department_id'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: money display must convert paise correctly; aggregate metrics such as averages must stay integer paise.

### GAP-ANALYTICS-QUERIES-05  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Chart a11y: figure has role='img' with the sr-only <dl> text alternative nested inside (AccessibleBarChart.tsx:42,73-83); children of role=img are presentational, so the structured list is not exposed to screen readers—only the long aria-label.
- **Verified evidence:** AccessibleBarChart.tsx:42 <figure role='img' aria-label={summary}> contains an sr-only <dl> (:76-86). role='img' has presentational children so the dl is not exposed; the long aria-label is the only text. The header comment (:6-12) claims the dl is 'structured reading'. Also the sr-only dl uses `${value} ${unit}` while aria-label uses no space. aria-label is also unbounded for many bars.
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/AccessibleBarChart.tsx`
- **Fix steps:**
  1. Remove role='img' and aria-label from <figure>; keep figcaption visible to AT and aria-hidden only the decorative bar div.
  2. Keep the sr-only <dl> (or a <table>) as the AT alternative.
  3. Fix unit spacing consistency.
- **Acceptance:**
  - axe + screen-reader check: dl entries are announced.
  - Test: figure has no role='img'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ANALYTICS-QUERIES-06  ·  MEDIUM  ·  partly  ·  theme FORM-VALIDATION (was STATUS)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Filter values are free text (RunQueryForm.tsx:417-424) though the catalog types each filter field (FilterDef.type); a numeric/date/enum field can be filtered with arbitrary strings; empty-valued rows are silently dropped on submit (RunQueryForm.tsx:178).
- **Verified evidence:** RunQueryForm.tsx:417-424 filter value is a single <input type='text'> with placeholder 'e.g. Finance' regardless of FilterDef.type (type is loaded in the catalog, :27); confirmed. Empty values are dropped by `.filter(r => r.field && r.value.trim() !== '')` at :177-178 (line numbers off by a few) with no message - confirmed. What FilterDef.type values exist is not visible (analytics service absent), and the server presumably validates via zod, so invalid strings would be rejected with a 400 shown as submitError; 'arbitrary strings' is not silently accepted. Theme STATUS is wrong.
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/RunQueryForm.tsx`
- **Fix steps:**
  1. Switch the value input by FilterDef.type of the selected field (number -> type='number', date -> type='date', enum/boolean -> <select> if the catalog supplies options).
  2. On submit, validate filters with zod (shared schema) and show field-level errors for empty values instead of dropping them (or warn 'N filters ignored').
  3. Reset the value when the field changes.
- **Acceptance:**
  - Test: number field rejects 'abc'.
  - Test: submitting a filter row with empty value shows a message and does not silently drop it.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ANALYTICS-QUERIES-07  ·  LOW  ·  partly  ·  theme DS (was FABRICATED)

- [x] **Status** (W0 2026-10-13 re-confirmed W2 analytics-part-1 on main fa11fb66a: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Hard-coded inline hex styles and English strings across RunQueryForm.tsx (labelStyle etc., :532-584) instead of tokens/next-intl; 'Clear' removes a filter row but is labelled like a field reset.
- **Verified evidence:** RunQueryForm.tsx:530-584 defines inline style consts with hex colours (labelStyle, inputStyle, clearBtnStyle...) and English strings throughout - true. The 'Clear' button (:428-435) removes a filter row (onClick removeFilter) and has aria-label 'Remove filter N', so AT is fine; the visible label 'Clear' is a naming nit. Theme FABRICATED is wrong - no fabricated data.
- **Files to change:** `apps/web/src/app/(app)/analytics/queries/RunQueryForm.tsx`
- **Fix steps:**
  1. Replace inline style objects with DS classes/tokens (form field, btn) used elsewhere.
  2. Rename visible 'Clear' to 'Remove' (or use an icon button) to match the aria-label.
  3. Extract strings to next-intl if a namespace exists.
- **Acceptance:**
  - Visual: dark-mode form renders correctly.
  - Button text reads 'Remove'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Stat label 'False Positive Rate' is bound to the API field fallbackRate (anomalies/page.tsx:18; DomainInsightPage.tsx:65): 'fallback' (rule-based path used) and 'false positive' are different measures, so the number is mislabelled or the field is overloaded; undeterminable without the ms-service definition.
- **Service:** `ml-service`  ·  **Endpoint(s):** `GET /api/v1/ml/evaluations?domain=anomalies&window=30d`
- **Question:** Does the evaluation response define fallbackRate as rule-based fallback share and provide a separate falsePositiveRate, or is fallbackRate mislabelled?
- **How to verify:** Open ml-service evaluations schema/handler; curl domain=anomalies and inspect fields and their computation.
- **Test to add:** Given 100 predictions of which 10 used fallback and 5 were confirmed false positives, when GET evaluations, then fallbackRate=0.10 and falsePositiveRate=0.05 are separate fields.
- **Impact if wrong:** Model quality misreported to decision makers.
- **Web change if wrong:** Relabel the stat to 'Fallback Rate' or bind to falsePositiveRate in anomalies/page.tsx.

### GAP-ANALYTICS-ML-INSIGHTS-LEADS-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 analytics: closed by #2045; verified: ml-service GET /v1/ml/evaluations is role-gated (EVALUATION_ROLES) and returns aggregates only — no per-person rows or identifiers (services/ml-service/src/modules/evaluations/routes.ts); crm-service GET /v1/crm/contacts/:id requires CRM_ROLES (crm_user|crm_admin|super_admin) (contacts/routes.ts:23,33). Web: leads/page.tsx now offers the /crm/contacts/ drill-through only to viewers holding a CRM read role (roleGuard CRM_CONTACT_READ_ROLES); leads/page.test.tsx)
- **First-pass claim:** Per-person scores drill through to CRM contact records (leads/page.tsx:37-39 rowLinkPrefix /crm/contacts/) from a page open to every analytics role; personal data and an automated score are exposed without a CRM role check on this route (DPDP purpose limitation); server-side check undeterminable.
- **Service:** `ml-service`  ·  **Endpoint(s):** `GET /api/v1/ml/evaluations?domain=leads (row links to /api/v1/crm/contacts/{id})`
- **Question:** Does the ml evaluations/leads response expose per-person data only to callers holding a CRM read role, and does crm-service still enforce its own role on /crm/contacts/{id}?
- **How to verify:** Open ml-service leads handler for role guard and PII fields; curl as analytics-only user and confirm no contact identifiers; curl crm contact as same user expecting 403.
- **Test to add:** Given analytics-only role, when GET leads evaluation, then no personal identifiers; when GET crm contact, then 403.
- **Impact if wrong:** DPDP purpose-limitation breach: personal data and automated scores visible without CRM entitlement.
- **Web change if wrong:** Remove rowLinkPrefix drill-through unless the user has a CRM role; show aggregate scores only.
