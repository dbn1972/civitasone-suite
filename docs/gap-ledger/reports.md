# Detailed gap file — module `reports`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 33, BACKEND-VERIFY 5



---
## /reports  —  `reports/home.html`

- **Source:** `apps/web/src/app/(app)/reports/page.tsx`
- **Design reference:** `redesign/reports/home.html`

### GAP-REPORTS-HOME-01  ·  HIGH  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Executive Summary" tile links to /reports/executive-summary (page.tsx:14) but no such route exists under reports/ — every click lands on the bare not-found EmptyState.
- **Verified evidence:** apps/web/src/app/(app)/reports/page.tsx:14 links to /reports/executive-summary; no such folder exists (find under reports/ confirmed). But because /reports/[id] is dynamic, the URL matches it: getReportJobById('executive-summary') fails and the user sees the report-detail 'Report job not found... ID is incorrect' page, NOT reports/not-found.tsx (no notFound() call anywhere under reports/).
- **Files to change:** `apps/web/src/app/(app)/reports/page.tsx`
- **Fix steps:**
  1. Remove the Executive Summary tile, or build reports/executive-summary/page.tsx (static segment takes precedence over [id]).
  2. If kept as roadmap, mark it 'Coming soon' and non-link.
- **Acceptance:**
  - Click every hub tile -> each resolves to a real page (Playwright link check).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-HOME-02  ·  MEDIUM  ·  partly  ·  theme NAV (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** not-found.tsx offers no way back: EmptyState with title and message only (not-found.tsx:5-8).
- **Verified evidence:** apps/web/src/app/(app)/reports/not-found.tsx:4-8 is EmptyState with title/message and no action, confirmed. But nothing in reports/ calls notFound() (grep), so it only shows for unmatched nested paths (e.g. /reports/a/b), not for the executive-summary case.
- **Files to change:** `apps/web/src/app/(app)/reports/not-found.tsx`
- **Fix steps:**
  1. Add action={<Link href='/reports' className='btn primary'>Back to Reports</Link>} to EmptyState (prop exists, used in talent-pool page).
  2. Prefer a shared NotFoundState component if one exists in _components.
- **Acceptance:**
  - Visit /reports/x/y -> page shows back link to /reports.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-REPORTS-HOME-03  ·  LOW  ·  partly  ·  theme CONSISTENCY (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Mixed page conventions: hub uses "page-main"/ModuleHub while every child uses "wrap"/PageHeader; tile order (Dashboard, Report Jobs, KPI, MIS, Scheduled) has no grouping between viewing and creating (page.tsx:9-14).
- **Verified evidence:** apps/web/src/app/(app)/reports/page.tsx uses ModuleHub (components/ModuleHub.tsx: div.page-main + PageHeader) while children use div.wrap + PageHeader (e.g. dashboard/page.tsx:87); talent-pool uses 'page-main wrap'. Convention mismatch is real but harmless. Tile order (l.9-14) is dashboard, jobs, KPI, MIS, scheduled, exec summary; grouping critique is subjective.
- **Files to change:** `apps/web/src/app/(app)/reports/page.tsx`
- **Fix steps:**
  1. Optional: reorder tiles into 'View' (Dashboard, KPI, MIS) and 'Reports' (Report Jobs, Scheduled).
  2. Align wrapper class across reports pages if a standard is chosen.
- **Acceptance:**
  - Visual review only.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-REPORTS-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** loading.tsx draws stat and table blocks the static hub never shows (loading.tsx:7-13).
- **Verified evidence:** apps/web/src/app/(app)/reports/loading.tsx:7-13 draws breadcrumb, title, 4 stat blocks and two tall blocks; the hub page is static ModuleHub tiles with no data fetch. Also uses hard-coded bg-slate-50/min-h-screen (no dark mode).
- **Files to change:** `apps/web/src/app/(app)/reports/loading.tsx`
- **Fix steps:**
  1. Reduce skeleton to header + 3x2 tile grid matching LinkTiles columns='three', or delete loading.tsx (page has no async work).
  2. Replace slate colors with tokens.
- **Acceptance:**
  - Navigation to /reports shows no stat-shaped skeleton.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Note: loading.tsx here also wraps child segments lacking their own (list/new, scheduled has one).


---
## /reports/[id]  —  `reports/detail.html`

- **Source:** `apps/web/src/app/(app)/reports/[id]/page.tsx`
- **Design reference:** `redesign/reports/detail.html`

### GAP-REPORTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Fetch error and true not-found both render "Report job not found … the ID is incorrect" (page.tsx:10-17); a transient outage tells the user their link is wrong.
- **Verified evidence:** apps/web/src/app/(app)/reports/[id]/page.tsx:8-17: `!job || source==='error'` renders PageHeader 'Report not found' + EmptyState 'Report job not found... the ID is incorrect' (DataSourceBadge shown on error but message still wrong). LoaderResult exposes status (apiClient.ts:125-144) so 404 can be distinguished.
- **Files to change:** `apps/web/src/app/(app)/reports/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status from getReportJobById.
  2. If source==='error' && status!==404: render <RefreshErrorState error={toHumanError('load',{area:'report'})} backHref='/reports/list'/>.
  3. If 404 (or !job with source ok): call notFound() or keep current EmptyState.
- **Acceptance:**
  - Test: loader error 500 -> RefreshErrorState, no 'not found' text.
  - Test: 404 -> not-found copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-DETAIL-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Report rows are printed raw with no masking or role gate (page.tsx:30-36): a report over HR or citizen data exposes Aadhaar/PAN/bank fields to any ModuleGate user (DPDP), and money cells are not converted from paise.
- **Verified evidence:** apps/web/src/app/(app)/reports/[id]/page.tsx:24-32 maps rows generically (row[col] ?? '—') and DataTable prints values raw; no role gate beyond reports layout ModuleGate; no paise handling. But the page has no money-typed columns of its own and the payload shape/content (report service, @civitasone/types) is absent, so whether Aadhaar/PAN/bank fields or paise integers appear is cannot-verify; the risk is structural (generic dump of unknown columns).
- **Files to change:** `apps/web/src/app/(app)/reports/[id]/page.tsx`, `services/report-service (not in snapshot)`
- **Fix steps:**
  1. Backend: have report-service return column metadata {key,label,type: text|money_paise|sensitive} and redact sensitive columns by role.
  2. Web: in the tableRows mapper (l.26-32) render money_paise via formatINR/formatMoney and sensitive via the new shared <Masked>.
  3. Until metadata exists, mask columns whose name matches aadhaar|pan|account|ifsc|mobile|email.
- **Acceptance:**
  - Unit test: column typed money_paise with 123456 renders ₹1,234.56.
  - Test: aadhaar column shows masked value.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII and money display; heuristics may mask legitimate columns.
- **Depends on:** Masked component (RECRUITMENT-TALENT-POOL-02)

### GAP-REPORTS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Only 100 rows are shown and there is no in-page indication how to get the rest beyond "100 of N rows" (page.tsx:26,97); download is the only route and disappears for non-completed jobs.
- **Verified evidence:** apps/web/src/app/(app)/reports/[id]/page.tsx:26 slice(0,100); count shown at l.97 ('x of N rows'); Download only if status==='completed' && downloadUrl (l.42-46). DataTable then paginates the 100 rows client-side (pageSize 15) and is not exportable.
- **Files to change:** `apps/web/src/app/(app)/reports/[id]/page.tsx`
- **Fix steps:**
  1. When totalCount > visibleRows.length show a note: 'Showing first 100 rows. Download the full report to see all.' with the download link inline (if available).
  2. If not downloadable, say why (job not completed / no file).
  3. Keep the count text.
- **Acceptance:**
  - Test with totalCount 500 -> note + download link visible.
  - Test non-completed -> note explains unavailability.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Parameters print raw keys and values (fromDate, departmentId UUID) with no labels or formatting (page.tsx:81-86); dates in cards are formatted but parameters are not.
- **Verified evidence:** apps/web/src/app/(app)/reports/[id]/page.tsx:81-86 prints {k} and {v} verbatim from job.parameters (e.g. fromDate, departmentId). Dates in the summary cards use formatIndianDate (l.63,67) but parameter values do not.
- **Files to change:** `apps/web/src/app/(app)/reports/[id]/page.tsx`
- **Fix steps:**
  1. Add a PARAM_LABELS map (fromDate->'From date', toDate->'To date', departmentId->'Department', ...) with humanize fallback (camelCase split).
  2. Format ISO date values with formatIndianDate.
  3. Resolve id-like values to names via existing department loader when available, else show 'Department (ID …xxxx)'.
- **Acceptance:**
  - Test: fromDate '2026-04-01' renders 'From date: 01 Apr 2026'.
  - No raw camelCase keys on screen.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; label map must be maintained as report parameters grow.

### GAP-REPORTS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No failed-job branch: a failed job shows status "failed" but the body still says "Data will be available once the report completes." (page.tsx:104-105), and there is no error reason or retry.
- **Verified evidence:** apps/web/src/app/(app)/reports/[id]/page.tsx:100-103: when displayColumns is empty the empty state shows title 'Pending' and 'Data will be available once the report completes.' for any status != completed, including 'failed'. No failure reason/retry rendered; whether ReportJobDetail carries an error field is cannot-verify (types package absent).
- **Files to change:** `apps/web/src/app/(app)/reports/[id]/page.tsx`
- **Fix steps:**
  1. Add branch for job.status==='failed': title 'Report failed', message from job.errorMessage if present else generic.
  2. Add 'Queue again' link to /reports/list/new?reportType=... (existing form) as retry.
  3. Keep 'Pending' only for queued/running.
- **Acceptance:**
  - Test: status failed -> 'Report failed' text, no 'once the report completes'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /reports/dashboard  —  `reports/dashboard.html`

- **Source:** `apps/web/src/app/(app)/reports/dashboard/page.tsx`
- **Design reference:** `redesign/reports/dashboard.html`

### GAP-REPORTS-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Invented numbers: "Data Sources" falls back to 12 when there are no KPIs or the fetch failed (page.tsx:217), and "Refresh: Real-time" is a constant (page.tsx:220) — both render on the error branch.
- **Verified evidence:** apps/web/src/app/(app)/reports/dashboard/page.tsx:98 value={modules || 12} (12 shows when kpis empty or loader errored; line numbers in observation 217/220 are wrong) and apps/web/src/app/(app)/reports/dashboard/page.tsx:101 value="Real-time" constant. StatGrid (l.97-102) renders outside the errored ternary (l.104), so both appear above RefreshErrorState. Also l.100 delta='live' is static.
- **Files to change:** `apps/web/src/app/(app)/reports/dashboard/page.tsx`
- **Fix steps:**
  1. Replace `modules || 12` with errored ? '—' : modules.
  2. Remove the Refresh StatCard, or bind it to a real freshness value (loader result timestamp) if the loader exposes one; otherwise delete.
  3. Show '—' for KPIs Tracked/Trending Up when errored; drop static delta='live'.
  4. Or wrap StatGrid in `!errored &&`.
- **Acceptance:**
  - Page test with source='error': no '12' and no 'Real-time' text; RefreshErrorState shown.
  - Test with empty kpis: Data Sources shows 0 or '—', not 12.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-DASHBOARD-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Outcome index" is 50 + average changePct clamped to 0-100 (page.tsx:194-202) with the label "composite": a made-up score that reads as 50% on flat data and cannot be traced to any outcome definition.
- **Verified evidence:** apps/web/src/app/(app)/reports/dashboard/page.tsx:75-83 avgChangePct = mean of kpi.changePct; outcomePct = clamp(50+avg,0,100); OutcomeDonut (l.45-65) labels it 'composite' and aria-label 'Outcome index'. No outcome definition in code; flat data reads 50%; empty data (avg 0) also 50% but card is hidden only when kpis empty.
- **Files to change:** `apps/web/src/app/(app)/reports/dashboard/page.tsx`
- **Fix steps:**
  1. Remove the Outcome index card and OutcomeDonut, or replace with a real ratio available from data, e.g. share of KPIs with changeDirection 'up' (count/total) labelled exactly that.
  2. If kept pending a definition, label 'Illustrative' and hide when no changePct data.
  3. Delete unused avgChangePct/outcomePct code.
- **Acceptance:**
  - Test: with all changePct undefined, no donut rendered.
  - Test: label text matches the metric computed.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Executives may rely on the index; confirm with product before removal.

### GAP-REPORTS-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** FY / QTD Segmented holds local state only (SpendSegmented.tsx:9-14); it changes nothing, and the card title says "spend vs outcome" though the chart plots KPI values (page.tsx:134,232).
- **Verified evidence:** apps/web/src/app/(app)/reports/dashboard/SpendSegmented.tsx:9-14 holds useState only, no callback/param; page.tsx:113-116 card titled 'Cross-department spend vs outcome' but ModuleBarChart (l.14-43) plots kpi.value of top 8 positive KPIs. Segmented (ds/Segmented.tsx) uses span onClick with role=tab, not keyboard-operable (side note). Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/reports/dashboard/page.tsx`, `apps/web/src/app/(app)/reports/dashboard/SpendSegmented.tsx`
- **Fix steps:**
  1. Delete SpendSegmented and its import unless dashboard endpoint supports a period param (not visible in loaders.getReportsDashboard).
  2. Retitle card to 'KPI values by module'.
  3. If period is later supported, lift seg to a ?period= search param and pass to getReportsDashboard.
- **Acceptance:**
  - No FY/QTD control rendered; card title matches chart contents.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-DASHBOARD-04  ·  MEDIUM  ·  confirmed  ·  theme DARKMODE (was FAILMASK)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Chart and donut use hard-coded hex (#0369a1, #eef0f4, #667085) instead of tokens, fail dark mode, and labels truncate to 10 chars at 9px (page.tsx:150-154,174-181); no legend, no values on bars, no table alternative.
- **Verified evidence:** apps/web/src/app/(app)/reports/dashboard/page.tsx:34 fill '#0369a1', :55-56 '#eef0f4'/'#0369a1', :35,62 '#667085', :59 '#101828' hard-coded; label = (module||title).slice(0,10) at fontSize 9 (l.31,35); no legend, no value labels, no table alternative (only aria-label on svg). Observation's suggested RefreshErrorState fix is already implemented (l.104-105); the real remaining error-branch issue is stat cards (see -01).
- **Files to change:** `apps/web/src/app/(app)/reports/dashboard/page.tsx`
- **Fix steps:**
  1. Replace hex with CSS variables (var(--primary), var(--line2), var(--mut), var(--ink)) via fill/stroke props.
  2. Render value text above each bar and full module name (wrap/rotate or use HTML axis) at >=11px.
  3. Add a visually-hidden <table> or details with the same data for screen readers.
  4. Add legend/caption stating metric and unit.
- **Acceptance:**
  - Toggle dark theme: bars/labels remain visible (contrast >=3:1).
  - Screen reader test lists each module with value.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-REPORTS-DASHBOARD-05  ·  LOW  ·  partly  ·  theme CHART (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Bars are opacity-stepped by position (page.tsx:149) implying an ordering that does not exist; "trending down" alerts show only percentage with no period (page.tsx:272).
- **Verified evidence:** apps/web/src/app/(app)/reports/dashboard/page.tsx:30 opacity = 0.45 + i/(n-1)*0.5 by array index, implying rank though bars are unsorted (confirmed). Alerts (l.151-154) show `${changePct.toFixed(1)}%` else 'trending down'; period is not shown, and the KPI summary shape in the dashboard payload is not visible in this snapshot (@civitasone/types absent). Not a dead-route issue.
- **Files to change:** `apps/web/src/app/(app)/reports/dashboard/page.tsx`
- **Fix steps:**
  1. Use a constant opacity/fill for all bars (or sort by value desc if ranking is intended).
  2. Append period label to alert line if ReportDashboard KPI carries a period field (cannot verify); otherwise say 'vs previous period'.
- **Acceptance:**
  - All bars same fill; alert row includes period text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /reports/kpi  —  `reports/kpi.html`

- **Source:** `apps/web/src/app/(app)/reports/kpi/page.tsx`
- **Design reference:** `redesign/reports/kpi.html`

### GAP-REPORTS-KPI-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** A KPI monitor with no target and no actual: the table carries only name, module, unit, period and a Met/Near/Below label (KpiClient.tsx:178-188); the header promises "indicators with targets" (page.tsx:54).
- **Verified evidence:** apps/web/src/app/(app)/reports/kpi/KpiClient.tsx:20-31 columns: kpiName, module, unit, period, status only; subtitle at apps/web/src/app/(app)/reports/kpi/page.tsx:54 promises 'outcome indicators with targets'. Whether KPISummary carries target/actual is cannot-verify (@civitasone/types absent), though the analytics screen (analytics/kpi/KpiTable.tsx) shows current value and target from another loader.
- **Files to change:** `apps/web/src/app/(app)/reports/kpi/page.tsx`, `apps/web/src/app/(app)/reports/kpi/KpiClient.tsx`
- **Fix steps:**
  1. Inspect KPISummary in @civitasone/types; if target/actual/value exist add columns and thread through KpiRow.
  2. If not exposed, request them from report-service or reword subtitle to 'KPI status by module'.
  3. Format values with unit.
- **Acceptance:**
  - Table shows Actual and Target columns for a KPI with both.
  - Subtitle matches displayed data.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; contract change requires @civitasone/types update.

### GAP-REPORTS-KPI-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** On fetch error the stat cards print 0 KPIs and "0%" (page.tsx:10-13,61-64) above RefreshErrorState.
- **Verified evidence:** apps/web/src/app/(app)/reports/kpi/page.tsx:8-13,61-64: on error kpis=[] so stats print 0, 0, 0 and delta '0%' (l.62) while RefreshErrorState shows below (l.71-72).
- **Files to change:** `apps/web/src/app/(app)/reports/kpi/page.tsx`
- **Fix steps:**
  1. const errored = source==='error'; pass value={errored ? '—' : n} to each StatCard, omit delta when errored.
  2. Or skip StatGrid when errored.
- **Acceptance:**
  - Test: error source -> no numeric 0 in stat cards, dashes shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-KPI-03  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Outcome-linked" counts KPIs whose unit is "%" or "pct" and always shows the static delta "→ budget" (page.tsx:13,64) — a heuristic presented as a budget link.
- **Verified evidence:** apps/web/src/app/(app)/reports/kpi/page.tsx:13 outcomeLinked = kpis with unit '%' or 'pct'; l.64 hard-coded delta='→ budget'. No budget linkage in data seen.
- **Files to change:** `apps/web/src/app/(app)/reports/kpi/page.tsx`
- **Fix steps:**
  1. Remove the Outcome-linked card, or replace with 'Percentage KPIs' and drop the '→ budget' delta.
  2. Only restore when the KPI payload has an explicit outcome/budget link field.
- **Acceptance:**
  - No 'budget' text unless backed by field.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-KPI-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Below target" filter with zero matches reuses the "No KPI data available" empty copy (KpiClient.tsx:174-175).
- **Verified evidence:** apps/web/src/app/(app)/reports/kpi/KpiClient.tsx:35-37 (observation lines wrong): filtered.length===0 shows 'No KPI data available / KPIs will appear once the service has processed data' even when the 'Below target' filter merely matches nothing (good news). Strings are hard-coded English, not next-intl (page-wide).
- **Files to change:** `apps/web/src/app/(app)/reports/kpi/KpiClient.tsx`
- **Fix steps:**
  1. Branch on seg==='Below target': title 'No KPIs below target', message 'All tracked KPIs are on track.'.
  2. Optionally move strings to next-intl keys.
- **Acceptance:**
  - Test: rows all on_track + filter Below target -> 'No KPIs below target'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-REPORTS-KPI-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Status pill mapping folds any unknown status into "rejected"/red (page.tsx:22-26); "Set Targets" goes to a generic report-job form (list/new/page.tsx:12-14).
- **Verified evidence:** apps/web/src/app/(app)/reports/kpi/page.tsx:22-26 statusPill returns 'rejected' (red) for anything except on_track/at_risk; statusLabel (l.15-20) returns raw status for unknown. 'Set Targets' -> /reports/list/new?reportType=kpi-target (l.56), which only queues a generic report job (see LIST-NEW-01).
- **Files to change:** `apps/web/src/app/(app)/reports/kpi/page.tsx`
- **Fix steps:**
  1. Map off_track->'rejected', at_risk->'pending', on_track->'active', unknown->'draft' (neutral) with humanized label.
  2. Hide or relabel Set Targets until a KPI-targets command exists.
- **Acceptance:**
  - Test: status 'unknown' renders neutral pill, not red.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-REPORTS-LIST-NEW-01


---
## /reports/list  —  `reports/list.html`

- **Source:** `apps/web/src/app/(app)/reports/list/page.tsx`
- **Design reference:** `redesign/reports/list.html`

### GAP-REPORTS-LIST-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed fetch shows Total/Completed/Running/Failed as real 0 above the error card (page.tsx:10-13,36-46).
- **Verified evidence:** apps/web/src/app/(app)/reports/list/page.tsx:8-13 derives total/completed/running/failed from jobs, which is [] when getReportJobs() (loaders.ts:4374) fails; :37-40 pass those numbers to StatCard. The error card is rendered at :45-46, but the stats above it read 0. StatCard.tsx:19-23 already renders null/undefined/NaN as an em dash, so only the caller is wrong.
- **Files to change:** `apps/web/src/app/(app)/reports/list/page.tsx`
- **Fix steps:**
  1. In ReportsListPage add const errored = source === "error".
  2. Pass value={errored ? null : total|completed|running|failed} to the four StatCards.
  3. Drop the delta on Completed when errored.
  4. Keep the existing RefreshErrorState branch at :45.
- **Acceptance:**
  - Component test: mock getReportJobs -> {source:'error', data:[]}; all four stat values render '—' and the retry card shows.
  - With source 'api' and zero jobs the stats still render 0 and EmptyState shows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Display only.
- **Depends on:** GAP-REPORTS-MIS-01

### GAP-REPORTS-LIST-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No status filter, no retry for failed jobs and no cancel for running ones; a failed job shows only "—" with no reason (ReportJobsTable.tsx:113-131).
- **Verified evidence:** apps/web/src/app/(app)/reports/list/ReportJobsTable.tsx is 59 lines (observation's :113-131 is wrong; columns are :20-52). DataTable has only the free-text filter (filterable, :55) which matches the status text, so there is no dedicated status control. Rows have no error-reason field (JobRow :4-15) and the Download cell shows '—' for anything without downloadUrl (:48-50). No retry/cancel UI exists. The report-service and the ReportJobSummary type are not in the snapshot, so retry/cancel endpoints and an error-message field cannot be confirmed. The generic ConfirmDialog/maker-checker fix text does not fit: retry/cancel are not approvals.
- **Files to change:** `apps/web/src/app/(app)/reports/list/ReportJobsTable.tsx`, `apps/web/src/app/(app)/reports/list/page.tsx`, `(backend) report-service retry/cancel endpoints if absent`
- **Fix steps:**
  1. Add a Segmented/select status filter (All, Running, Completed, Failed) above the table in ReportJobsTable and filter rows before passing to DataTable.
  2. Confirm with report-service whether ReportJobSummary/ReportJobDetail carries an error message; if so add it to JobRow and show in the status cell as a tooltip or a second line for failed jobs.
  3. If the service exposes retry/cancel, add row actions via ActionButton; wrap Cancel in ConfirmDialog (no reason/maker-checker needed) and call through /api/proxy.
  4. If not exposed, raise a backend ticket and ship only filter + reason.
- **Acceptance:**
  - Selecting 'Failed' shows only failed rows and the count matches the Failed stat.
  - A failed job displays a reason (or 'Reason not recorded') instead of a bare em dash.
  - Cancel on a running job asks for confirmation, then status becomes cancelled after refresh.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low to medium. Cancel/retry may double-generate reports if the service is not idempotent.
- **Depends on:** GAP-REPORTS-LIST-01

### GAP-REPORTS-LIST-03  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Requester is rendered from requestedBy verbatim — may be a raw user id rather than a name; jobs of all users are listed to every gated user (page.tsx:19).
- **Verified evidence:** apps/web/src/app/(app)/reports/list/page.tsx:19 passes j.requestedBy straight to ReportJobsTable.tsx:31 ('Requested By' column, no render mapping), so a user id would show raw if the API returns one. The (app)/reports/layout.tsx only applies ModuleGate moduleKey='reports' (no role check) and the page does no per-user filtering. Whether the API returns all users' jobs or only the caller's, and whether requestedBy is a name or an id, lives in report-service, which is absent: cannot confirm the 'all users' claim.
- **Files to change:** `apps/web/src/app/(app)/reports/list/page.tsx`, `apps/web/src/app/(app)/reports/list/ReportJobsTable.tsx`
- **Fix steps:**
  1. Verify in report-service what GET /api/v1/reports/report-jobs returns for a non-admin (tenant-wide or own only) and the shape of requestedBy.
  2. If it is an id, resolve to a display name (server-side lookup or have API return requestedByName) and render that; fall back to 'Unknown user' not the id.
  3. If the API is not scoped, add server-side scoping (own jobs unless reports admin role) and a role-based 'All users' toggle.
- **Acceptance:**
  - A job requested by user X shows X's name, never a UUID.
  - A non-admin user sees only own jobs (API-level test).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium. Exposure of other staff's report names/requesters is an information-disclosure risk if unscoped.


---
## /reports/list/new  —  `reports/list-new.html`

- **Source:** `apps/web/src/app/(app)/reports/list/new/page.tsx`
- **Design reference:** `redesign/reports/list-new.html`

### GAP-REPORTS-LIST-NEW-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Set KPI Targets" does not set a target: it queues a report job named by the clerk with reportType "kpi-target" (page.tsx:12-14, CreateReportForm.tsx:29-32); no KPI, value or period is captured and the KPI page never reflects it.
- **Verified evidence:** apps/web/src/app/(app)/reports/list/new/page.tsx:6-11 kpi-target mode changes title/subtitle; CreateReportForm.tsx:29-32 posts only {name, reportType} to /api/proxy/v1/reports/jobs; no KPI id, value or period captured. Mitigation: page banner (l.17-24) and subtitle honestly say it is recorded as a report job. KPI page does not consume it (kpi/page.tsx uses getKPIs only).
- **Files to change:** `apps/web/src/app/(app)/reports/list/new/page.tsx`, `apps/web/src/app/(app)/reports/list/new/CreateReportForm.tsx`, `apps/web/src/app/(app)/reports/kpi/page.tsx`
- **Fix steps:**
  1. Backend: add KPI-targets command (kpiId, targetValue, period) to report-service.
  2. Web: dedicated form with KPI picker, value, period; post to new endpoint.
  3. Until then, remove the Set Targets button on kpi/page.tsx:56.
- **Acceptance:**
  - Set target for a KPI -> KPI table shows target.
  - Or: button absent until endpoint exists.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Business: users may believe targets are set; contract addition in @civitasone/types and audit event.
- **Depends on:** GAP-REPORTS-KPI-01

### GAP-REPORTS-LIST-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Report type / module" is a free-text input (CreateReportForm.tsx:61); typos ("Finanace") create an unusable job. No format (pdf/xlsx/csv), date range or parameters, although list and detail pages show format and parameters.
- **Verified evidence:** apps/web/src/app/(app)/reports/list/new/CreateReportForm.tsx:61 free-text input id=reportType (obs line 61 correct); body (l.29-32) only name, reportType; no format/date range/parameters UI though detail page renders format (detail:59) and parameters (l.78-90). Backend validation of reportType is cannot-verify (report-service absent).
- **Files to change:** `apps/web/src/app/(app)/reports/list/new/CreateReportForm.tsx`, `apps/web/src/app/(app)/reports/list/new/page.tsx`
- **Fix steps:**
  1. Replace input with <select> of known report types/modules (source list from report-service or constant).
  2. Add format select (pdf/xlsx/csv) and from/to date inputs if createJobBody accepts them (verify in report-service).
  3. Keep kpi-target default pre-selected.
- **Acceptance:**
  - Cannot submit an unknown type.
  - Created job shows chosen format in detail.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Contract for createJobBody must be confirmed first.

### GAP-REPORTS-LIST-NEW-04  ·  LOW  ·  confirmed  ·  theme DARKMODE (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Banner colours and radius are hard-coded hex (page.tsx:20) and the ℹ️ emoji is decorative; card fields use inline #fff backgrounds (CreateReportForm.tsx:55,59) that break in dark mode.
- **Verified evidence:** apps/web/src/app/(app)/reports/list/new/page.tsx:20 hex background #fffaeb/border #fde68a/color #92400e; CreateReportForm.tsx:55,59 background '#fff'; :67 error/success colours #b91c1c/#047857. The emoji is wrapped in aria-hidden so it is purely decorative (not an a11y defect).
- **Files to change:** `apps/web/src/app/(app)/reports/list/new/page.tsx`, `apps/web/src/app/(app)/reports/list/new/CreateReportForm.tsx`
- **Fix steps:**
  1. Replace with warn tokens (var(--warnbg), var(--warn)) or an existing DS Banner/Alert component.
  2. Remove inline #fff on .field; let card token handle it.
  3. Use token colours for messages.
- **Acceptance:**
  - Dark mode: banner and fields readable, no white blocks.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-LIST-NEW-05  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No loading.tsx for the segment and the ℹ️ banner is not a role="status" region (page.tsx:17-25).
- **Verified evidence:** No list/new/loading.tsx, but reports/list/loading.tsx exists at the parent segment and Next wraps nested routes in it; new/page.tsx is synchronous with no data fetch, so a dedicated loading file adds nothing. Banner (page.tsx:17-24) is static content present at render, so role=status (for dynamic updates) is not warranted; the true nuance is that the parent skeleton is table-shaped.
- **Files to change:** `apps/web/src/app/(app)/reports/list/new/loading.tsx (optional)`
- **Fix steps:**
  1. Optionally add list/new/loading.tsx with a form-shaped skeleton.
  2. Leave banner as is, or use role='note'.
- **Acceptance:**
  - Navigating to /reports/list/new shows a form-shaped fallback, if added.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /reports/mis  —  `reports/mis.html`

- **Source:** `apps/web/src/app/(app)/reports/mis/page.tsx`
- **Design reference:** `redesign/reports/mis.html`

### GAP-REPORTS-MIS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** On fetch error the four stat cards show 0 (page.tsx:10-12) — "0 Data Sources, 0 Metrics" reads as a real result above the error card.
- **Verified evidence:** apps/web/src/app/(app)/reports/mis/page.tsx:8-12 computes modules.length, totalMetrics, positive/negative from modules=[] on failure; :35-38 pass numbers to StatCard, so the four cards read 0 above the error card at :41-45.
- **Files to change:** `apps/web/src/app/(app)/reports/mis/page.tsx`
- **Fix steps:**
  1. Add const errored = source === "error".
  2. Pass null instead of the count for all four StatCards when errored (StatCard renders '—').
  3. Omit the 'modules' and 'live' delta text when errored.
- **Acceptance:**
  - Component test with source 'error': four '—' values and RefreshErrorState shown.
  - With empty api result, stats show 0 and the empty state appears.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-REPORTS-LIST-01

### GAP-REPORTS-MIS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Trends are derived by string-matching change.startsWith("+") / "-" (page.tsx:11-12, MISMetricsTable.tsx:224); a change like "12%" or "−4" (unicode minus) is counted neither way and shown uncoloured.
- **Verified evidence:** apps/web/src/app/(app)/reports/mis/page.tsx:11-12 counts only change?.startsWith('+') / startsWith('-'), and apps/web/src/app/(app)/reports/mis/MISMetricsTable.tsx:27 colours the same way. A '−4' (U+2212), '12%' or '0%' matches neither, so it is uncounted and uncoloured. The page passes String(value) and change as free strings, so the API's change type (string vs number) is not visible here.
- **Files to change:** `apps/web/src/app/(app)/reports/mis/page.tsx`, `apps/web/src/app/(app)/reports/mis/MISMetricsTable.tsx`, `apps/web/src/lib/trend.ts (new)`
- **Fix steps:**
  1. Create parseChange(change: string|number|null): 'up'|'down'|'flat'|'unknown' that normalises U+2212/en dash to '-', strips %/spaces, and parses the number.
  2. Use it in mis/page.tsx for positiveTrends/negativeTrends and in MISMetricsTable for colour.
  3. Add a non-colour cue (arrow or sign) alongside the colour.
  4. Ask the API owner whether change should be numeric.
- **Acceptance:**
  - Unit test parseChange: '+5%'->up, '-3'->down, '−4'->down, '12%'->up (or unknown per agreed rule), '0%'->flat, null->unknown.
  - Metric with '−4' is counted in Negative Trends and shown red.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Trend classification only; agree the rule for unsigned values.

### GAP-REPORTS-MIS-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Empty branch has no card wrapper (page.tsx:46-47) while other branches do; "Build Report" is offered even when there is no data.
- **Verified evidence:** apps/web/src/app/(app)/reports/mis/page.tsx:46-47 renders a bare EmptyState with no card wrapper, whereas :42 and :49 wrap in <div className='card'>. The 'Build Report' action (:30) is in PageHeader and always shown, including in the empty and error states.
- **Files to change:** `apps/web/src/app/(app)/reports/mis/page.tsx`
- **Fix steps:**
  1. Wrap the empty branch in the same card with the 'Cross-department datasets' header.
  2. Render the Build Report action only when modules.length > 0 (or make it a secondary link if building a report without data is valid).
  3. Reuse one small local wrapper to avoid the three duplicated card blocks.
- **Acceptance:**
  - Empty state renders inside a card matching the other branches.
  - No 'Build Report' button when there is no data or on error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Confirm with product that MIS report building without data is not a valid flow.


---
## /reports/scheduled  —  `reports/scheduled.html`

- **Source:** `apps/web/src/app/(app)/reports/scheduled/page.tsx`
- **Design reference:** `redesign/reports/scheduled.html`

### GAP-REPORTS-SCHEDULED-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Template is a free-typed UUID (NewScheduledForm.tsx:307-315) and the list shows only its first 8 characters (page.tsx:370): nobody can create or recognise a schedule by report name.
- **Verified evidence:** apps/web/src/app/(app)/reports/scheduled/NewScheduledForm.tsx:67-78 is a required text input 'Template ID' with a UUID regex pattern and a 'UUID of report template' placeholder; apps/web/src/app/(app)/reports/scheduled/page.tsx:83-85 prints templateId.slice(0,8)+'…' in monospace. The page has no template list. Whether a report-template list endpoint exists is not visible in the snapshot (report-service absent).
- **Files to change:** `apps/web/src/app/(app)/reports/scheduled/NewScheduledForm.tsx`, `apps/web/src/app/(app)/reports/scheduled/page.tsx`, `apps/web/src/app/_data/loaders.ts (getReportTemplates if endpoint exists)`
- **Fix steps:**
  1. Confirm the report-templates list endpoint with report-service (do not assume a path).
  2. Fetch templates in page.tsx (server) and pass options to NewScheduledForm; replace the text input with a select (or EntityPicker) showing template names, submitting the id.
  3. In the table build a Map id->name from the same list and show the name, falling back to 'Unknown template' if missing.
  4. Keep the id as the option value only.
- **Acceptance:**
  - Form offers a dropdown of template names and no free-typed UUID.
  - Existing schedule rows show the template name, not '3f2a9c1b…'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low. If the templates endpoint is missing this needs backend first.

### GAP-REPORTS-SCHEDULED-03  ·  MEDIUM  ·  confirmed  ·  theme REFRESH (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** After a successful create the list is not refreshed (no router.refresh, NewScheduledForm.tsx:292-294), so the new schedule does not appear until reload.
- **Verified evidence:** apps/web/src/app/(app)/reports/scheduled/NewScheduledForm.tsx:54-56 on res.ok only sets success state and clears templateId/recipients; there is no useRouter/router.refresh(), and the list is a server component (page.tsx:37-38, revalidate via fetchJson), so the new row does not appear until a reload.
- **Files to change:** `apps/web/src/app/(app)/reports/scheduled/NewScheduledForm.tsx`
- **Fix steps:**
  1. Import useRouter from next/navigation in NewScheduledForm.
  2. After a successful POST call router.refresh().
  3. Optionally reset cadence/format and focus the success message.
  4. Check fetchJson cache for this path does not pin stale data (use no-store or revalidate 0 for this list).
- **Acceptance:**
  - Component test: mock fetch ok; router.refresh called once.
  - Manual: create a schedule, the new row appears without reload and Total Schedules increments.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-REPORTS-SCHEDULED-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No enable/disable, edit, run-now or delete on any row although stats count Enabled / Disabled (page.tsx:326-339); recipients are shown as a count only, hiding who receives the report.
- **Verified evidence:** apps/web/src/app/(app)/reports/scheduled/page.tsx:72-77 has six columns and no actions column; no enable/disable, edit, run-now or delete exists anywhere in the folder. Stats (:40-41,52-53) count Enabled/Disabled that users cannot change. Recipients render as a count (:87-89) even though the ScheduledReport type (:10) holds the emails. Backend support for PATCH/DELETE/run-now is unverifiable (report-service absent).
- **Files to change:** `apps/web/src/app/(app)/reports/scheduled/page.tsx`, `apps/web/src/app/(app)/reports/scheduled/ScheduledRowActions.tsx (new)`
- **Fix steps:**
  1. Confirm with report-service which of PATCH (enabled), DELETE and run-now exist for /v1/reports/scheduled/{id}.
  2. Add a client ScheduledRowActions component with toggle, delete (ConfirmDialog) and run-now, calling /api/proxy and router.refresh().
  3. Show recipients: first email plus '+N' with the full list in a title/tooltip or expandable row.
  4. Add an actions column header.
- **Acceptance:**
  - Toggling Enabled flips the row and stat counts after refresh.
  - Delete asks for confirmation and removes the row.
  - Recipient emails are visible to the admin.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium. Delete/run-now send reports to external recipients; confirm before run-now and log an audit event server-side.
- **Depends on:** GAP-REPORTS-SCHEDULED-03

### GAP-REPORTS-SCHEDULED-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Table and form are hand-styled with inline styles rather than the DS DataTable (page.tsx:315-321,355-390) — no sorting, no mobile transform; "Next Run" uses browser locale rather than formatIndianDate.
- **Verified evidence:** Table is hand-built with inline styles (page.tsx:29-35,69-104), not DataTable: true, so no sorting/pagination/mobile handling (it does wrap in overflowX:auto :68). Next Run uses new Date(...).toLocaleString('en-IN') (:99) which uses the server's timezone, not IST, and is not the shared date helper. Line numbers in the observation are off (:355-390 does not exist; file is 117 lines). The form uses inline styles too. The stats also show 0 on fetch error (:51-53), same masking as LIST-01.
- **Files to change:** `apps/web/src/app/(app)/reports/scheduled/page.tsx`, `apps/web/src/lib/format (existing formatIndianDateTime helper, locate)`
- **Fix steps:**
  1. Replace the hand-built table with the DS DataTable (sortable, pageSize) via a small client ScheduledTable component.
  2. Render Next Run with the shared formatIndianDateTime (IST, dd Mon yyyy) instead of toLocaleString.
  3. Pass null to the StatCards when source==='error'.
  4. Move inline th/td styles away.
- **Acceptance:**
  - Next Run shows e.g. '05 Oct 2026, 09:00 IST' regardless of server TZ.
  - Table columns are sortable and it collapses on mobile.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-REPORTS-SCHEDULED-04


---
## Backend verification items (service code absent from snapshot)

### GAP-REPORTS-LIST-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by fbdda49e1 (owner decision #17, 2026-10-26)
- **First-pass claim:** downloadUrl is opened straight from the API payload (ReportJobsTable.tsx:124) — expiry, authorisation and DPDP handling of exported files are undeterminable without the report service.
- **Service:** `report-service`  ·  **Endpoint(s):** `['GET /api/v1/reports/report-jobs']`
- **Question:** Is downloadUrl a short-lived signed URL issued only to the job owner/authorised role, with download audited and PII exports DPDP-controlled?
- **How to verify:** In report-service open the report-jobs handler and the URL signer; check TTL, tenantId/owner check, audit emit. curl the list as user A, then GET the returned downloadUrl as user B and after TTL.
- **Test to add:** Given completed job owned by A with signed URL; when B (same tenant, no report role) or anyone after expiry requests it; then 403/410 and a download audit event exists for A's fetch.
- **Impact if wrong:** Data leak: exported personal data downloadable by unauthorised or via stale links.
- **Web change if wrong:** If URLs are long-lived/unsigned, route download through a proxy endpoint instead of window.open on ReportJobsTable.tsx:124; else none.

### GAP-REPORTS-LIST-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Status "running" is not in StatusPill's map shown here, so it falls to the default variant (StatusPill.tsx:53); job status vocabulary (queued/cancelled) undeterminable.
- **Service:** `report-service`  ·  **Endpoint(s):** `['GET /api/v1/reports/report-jobs']`
- **Question:** Which status values can a report job take (queued, running, completed, failed, cancelled) and does the API return exactly that set?
- **How to verify:** Open report-service job schema/enum (zod + drizzle enum); compare with StatusPill map (StatusPill.tsx:53) and ReportJobSummaryListSchema in web.
- **Test to add:** Given jobs in each lifecycle state; when listing; then status is one of the documented enum values and each maps to a non-default StatusPill variant (contract test).
- **Impact if wrong:** Cosmetic/misleading: running or cancelled jobs shown as neutral, users re-submit jobs.
- **Web change if wrong:** Add missing statuses (running, queued, cancelled) to StatusPill map and ReportJobSummaryListSchema enum.

### GAP-REPORTS-LIST-NEW-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Mutation goes through /api/proxy/v1/reports/jobs (CreateReportForm.tsx:34) while every read uses /api/v1/reports/report-jobs (loaders.ts:4375); the proxy/gateway contract and whether the POST is audited are undeterminable (report service absent).
- **Service:** `report-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/reports/jobs', 'GET /api/v1/reports/report-jobs']`
- **Question:** Does the gateway map /reports/jobs to the same resource as /reports/report-jobs, and is the POST role-checked and audited?
- **How to verify:** Open the report-service routes and gateway map; POST /reports/jobs with a valid token, then GET report-jobs and confirm the job appears; check audit emit.
- **Test to add:** Given POST /reports/jobs, when GET /reports/report-jobs, then the created job is listed and an audit event exists.
- **Impact if wrong:** Created reports never appear or run unaudited exports of sensitive data.
- **Web change if wrong:** Change CreateReportForm.tsx:34 to post to the report-jobs path.

### GAP-REPORTS-MIS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Value is String(m.value) with no locale grouping and Unit is a separate column (page.tsx:18-19): money metrics would print raw numbers — paise-vs-rupee handling undeterminable.
- **Service:** `report-service`  ·  **Endpoint(s):** `['GET /api/v1/reports/mis']`
- **Question:** Does each MIS metric declare its unit (INR paise vs rupees vs count vs percent) so the web can format it?
- **How to verify:** Open the MIS handler in report-service; check the metric DTO for value/unit fields and whether money metrics are minor units. curl /api/v1/reports/mis and inspect money rows.
- **Test to add:** Given a money metric of Rs 1,25,000; when GET mis; then unit==='INR_PAISE' (or documented) and value is integer 12500000.
- **Impact if wrong:** Financial misreporting: a 100x error on management dashboards.
- **Web change if wrong:** Format by unit in MISMetricsTable (formatMoney for paise, grouping for counts, % suffix) instead of String(m.value).

### GAP-REPORTS-SCHEDULED-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Read uses /v1/reports/scheduled via fetchJson (page.tsx:306) while the form POSTs to /api/v1/reports/scheduled (NewScheduledForm.tsx:283) — two prefixes for one resource; audit of the create (recipients are personal email addresses, DPDP) is undeterminable.
- **Service:** `report-service`  ·  **Endpoint(s):** `['GET /v1/reports/scheduled (fetchJson)', 'POST /api/v1/reports/scheduled (NewScheduledForm)']`
- **Question:** Are the read and create paths the same resource on the gateway, and does create validate recipients with zod, restrict to authorised roles and emit an audit event?
- **How to verify:** Check the gateway route table for both prefixes; open report-service scheduled route: role guard, zod recipients schema, audit emission (@civitasone/events). POST with role lacking reports.schedule and expect 403.
- **Test to add:** Given a user with reports.schedule; when POST scheduled with external email recipient; then 201, row visible in GET, and audit event scheduled_report.created is emitted with recipients masked.
- **Impact if wrong:** DPDP exposure: reports mailed to arbitrary addresses with no trail; or created rows never listed.
- **Web change if wrong:** Align both calls on one prefix (/api/proxy/v1/reports/scheduled) in page.tsx:306 and NewScheduledForm.tsx:283.
