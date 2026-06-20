# Foundation — Component Library Sheet

**SCREEN TYPE:** Component library spec (not a user-facing screen)
**SPRINT:** 1 (after design tokens are approved)

---

## Figma Make prompt

```
Generate a Component Library sheet for the CivitasOne Suite design system.

PRODUCT: CivitasOne Suite

Render every component on a single long Figma page, grouped under headings.
For EACH component, show ALL states stacked vertically: default, hover, focus,
active, disabled, loading, error, success. Annotate each variant with its name.

ATOMS:
- Button (variants: primary, secondary, tertiary, danger, ghost, link; sizes: sm, md, lg; with/without leading icon, trailing icon, icon-only)
- IconButton (sizes: sm, md, lg)
- Input (text, email, password, number, search)
- Textarea (autosize and fixed)
- Select (single, multi)
- Combobox (with async loading state)
- Checkbox (unchecked, checked, indeterminate)
- Radio (unselected, selected)
- Switch (off, on)
- Slider (single thumb, range)
- DatePicker (single date, date range)
- TimePicker
- NumberInput (with stepper)
- FileUpload (drag-drop zone + button)
- Badge (intent variants)
- Chip (with remove)
- Avatar (initials, image, sizes sm/md/lg)
- Tag (closable, non-closable)
- Tooltip (top, right, bottom, left)
- Skeleton (line, block, circle)

MOLECULES:
- FormField (label + input + help text + error text + required indicator)
- SearchBar (with clear, with loading)
- FilterBar (chips + clear all)
- Pagination (cursor-based, with page size selector)
- Breadcrumb (truncation behaviour shown)
- Tabs (horizontal, vertical, with badge counts)
- Stepper (horizontal, vertical, with step state: pending, active, complete, error)
- Toast (intent variants, with action button)
- Banner (intent variants, dismissible, with action)
- EmptyState (icon + heading + body + primary CTA + optional secondary)
- ErrorState (icon + heading + body + retry CTA + correlation ID display)
- LoadingState (full-page spinner + skeleton variants)

ORGANISMS:
- DataTable (with: column sort, column resize, row selection, density toggle,
  pagination, empty state, loading state, error state, expandable rows, sticky header,
  row-level actions menu, bulk actions bar)
- DetailDrawer (side panel — header, scrollable body, sticky footer with actions)
- Dialog (small, medium, large; with form, with confirmation)
- ConfirmDialog (destructive variant in danger intent)
- ListPage shell (header + toolbar + table + pagination footer)
- DetailPage shell (header + tabs + content + side panel)
- FormPage shell (header + scrollable form + sticky save bar)
- DashboardCard (with KPI, with chart, with list, with loading skeleton)
- KPIWidget (label + value + delta indicator + sparkline)
- ChartWrapper (bar, line, pie, area — with empty + error + loading)
- ApprovalCard (entity summary + actor + actions: approve, reject, reassign, comment)
- AuditTrailViewer (timeline of audit events with actor, action, resource, timestamp)
- ActivityFeed (chronological list with grouping by day)

TEMPLATES:
- AppShell (sidebar nav + topbar + main content + optional drawer)
- AuthShell (centered card, brand mark, theme-aware)
- InstallerShell (wizard with progress stepper, content, prev/next)
- ReportShell (filters + chart grid + export bar)
- PublicSiteShell (public header + content + footer with legal links)

CONSTRAINTS:
- All components use ONLY tokens from packages/ui-kit/tokens/
- Every interactive component shows its focus ring (shadow.focus token)
- Every component renders correctly in dark mode (show dark variant on the right)
- Every component renders correctly in RTL (show RTL variant below the dark variant)
- Component naming in Figma matches the React component name exactly
- Properties / variants in Figma map 1:1 to React component props

LAYOUT:
- One section per component, 80px space.16 spacing between sections
- States stacked vertically, 16px space.4 spacing within a component
- Component name as text.h3, variant name as text.caption in mono

OUT OF SCOPE:
- Application-specific composition (covered by module-level prompts)
- Marketing components (handled in 13-public-site/)
```
