# Reports — Report Center + Builder

**SPRINT:** 11
**ROUTES:** `/reports` (center), `/reports/builder` (builder), `/reports/{id}` (view)
**SERVICE OWNER:** report-service

---

## Figma Make prompt

```
Generate the Report Center + Builder screens for CivitasOne Suite.

REPORT CENTER (/reports):
LAYOUT: AppShell with tile grid
- Header: "Reports", primary action "New report"
- Tabs: All reports, My reports, Scheduled, Favorites, Templates
- Toolbar: SearchBar, FilterBar (module, owner, last run)
- Tile grid: each tile shows report name, module pill, last run timestamp, scheduled badge, favorite star
- Click tile → /reports/{id} view

REPORT VIEW (/reports/{id}):
LAYOUT: ReportShell
- Header: report name, module breadcrumb, actions (Edit, Run, Schedule, Share, Export, Subscribe)
- Filter bar (dynamic — driven by report parameters): date range, dimensions, owners, etc.
- Visualisation area: ChartWrapper or DataTable (depending on report definition)
- Insights side panel: top-N callouts, anomalies, period-over-period changes
- Footer: row count, last refreshed timestamp, source services queried

REPORT BUILDER (/reports/builder):
LAYOUT: split view — left config pane, right live preview
LEFT PANE:
- Step 1: Report type (Tabular | Pivot | Chart | KPI | Composite dashboard)
- Step 2: Data source — select service (finance / procurement / hrms / crm / helpdesk / etc.)
  Subsource: which endpoint or saved query
- Step 3: Fields — drag from available fields panel into Rows / Columns / Values / Filters
- Step 4: Visualisation type (if Chart) — bar / line / pie / area / heatmap / map
- Step 5: Filters (parameter definitions for end users)
- Step 6: Schedule (None | Daily | Weekly | Monthly with time + recipients)
- Step 7: Permissions (who can view / edit / subscribe)
RIGHT PANE:
- Live preview with current config + sample data
- "Refresh preview" button
- Sample / Full toggle

STATES:
- Empty report center: "Start with a template" with template gallery
- Empty builder preview: "Drag fields to begin" placeholder
- Error: standard ErrorState
- Loading: skeleton chart / table
- Long-running query: Banner intent.info "This query may take a few minutes — you will be notified by email"

PERMISSIONS:
- View shared reports: any user with module access
- Create / edit reports: Report Author role
- Schedule + email subscriptions: Report Author role
- Cross-service composite reports: requires read access to each underlying service

ACCESSIBILITY:
- Charts must have data table alternative (toggle "View as table")
- All chart colors come from intent + brand tokens; do not rely on color alone — also use patterns / labels
- Drag-and-drop in builder has keyboard alternative (select field, then choose target zone via menu)

OUT OF SCOPE:
- Natural-language report queries (Phase 2)
- Cross-tenant aggregated reports (forbidden by isolation rule)
```
