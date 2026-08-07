# CRM — Deal Pipeline (Kanban)

**SPRINT:** 10
**ROUTE:** `/crm/pipeline`
**SERVICE OWNER:** crm-service

---

## Figma Make prompt

```
Generate the Deal Pipeline (Kanban) screen for CivitasOne Suite.

PURPOSE: Visual sales pipeline. Drag deals across stages. Bulk update from board.

LAYOUT: AppShell with full-bleed Kanban board (horizontal scroll on overflow)

HEADER:
- Title "Pipeline"
- Pipeline selector (Select — multiple pipelines per tenant)
- Toolbar: SearchBar, FilterBar (owner, value range, expected close date), view toggle (Kanban / List)
- Primary action "New Deal"

KANBAN COLUMNS (one per stage from crm_pipeline_stages):
- Column header: stage name, deal count, total value, win probability %
- Stage actions menu: edit stage, add deal in stage
- Cards stacked vertically within the column

DEAL CARD:
- Header: Deal name, value (large, intent.primary)
- Org / contact avatar + name
- Owner avatar
- Expected close date (with intent.warning if overdue)
- Tags (Chip components)
- Footer: last activity timestamp, activity count icon
- Drag handle (whole card)
- Click → DetailDrawer with full deal + timeline + activities

INTERACTIONS:
- Drag card to new column → optimistic move, API call → on error, revert + Toast
- Click stage header → filter to that stage
- Card hover → shadow.md, drag cursor

STATES:
- Empty pipeline: large EmptyState with "Add your first deal" CTA
- Empty stage: dashed-outline placeholder with "Drop deals here or +Add"
- Loading: skeleton cards (3 per column)
- Error on drag: revert with Toast intent.danger, correlation ID

PERMISSIONS:
- View all deals: Sales Manager
- View own deals: Sales Rep
- Edit stage of deal not owned: requires Sales Manager role

EVENTS EMITTED:
- crm.deal.stage_changed
- crm.deal.won (if moved to terminal-won stage)
- crm.deal.lost (if moved to terminal-lost stage with reason capture)

ACCESSIBILITY:
- Drag-and-drop fully keyboard alternative: Space to pick up, arrow keys to move, Space to drop
- Live region announces position changes during keyboard drag
- Each column has aria-label including stage name and deal count

MOBILE (375px):
- Kanban collapses to vertical stack of stages
- Each stage shows top 3 deals + "View all in stage" link

OUT OF SCOPE:
- Forecasting visualisation (Phase 2)
- AI deal scoring (Phase 2)
```
