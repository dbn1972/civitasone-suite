# Platform — Tenant Admin Home

**SPRINT:** 2
**ROUTE:** `/tenant-admin`
**EDITION:** All
**PRIMARY ROLE:** Tenant Administrator

---

## Figma Make prompt

```
Generate the Tenant Administration home page for CivitasOne Suite.

PURPOSE: Single landing page for a tenant admin to manage their workspace —
users, roles, theme, plugins, settings, billing, audit.

LAYOUT: AppShell with sidebar nav, main content as dashboard grid

DASHBOARD CARDS (4-column grid on desktop, 2-column on tablet, 1-column on mobile):

Row 1 — KPI cards (KPIWidget organism):
- Active users (count + 7d delta)
- Active sessions (count, live)
- Open approvals (count, with intent.warning if SLA at risk)
- Storage used (GB / quota, with progress bar)

Row 2 — Health and compliance (DashboardCard organism):
- Service health (list of services with status pill: ok | degraded | down)
- Enterprise Readiness Score (gauge 0–100, refreshed daily, click → drill-in)

Row 3 — Quick actions (large action cards):
- Manage users → /tenant-admin/users
- Manage roles → /tenant-admin/roles
- Customize theme → /tenant-admin/theme
- Manage plugins → /tenant-admin/plugins
- View audit trail → /audit
- Settings → /tenant-admin/settings

Row 4 — Recent audit activity (ActivityFeed organism, last 20 events):
- Timestamp, actor, action, resource, outcome
- Click row → DetailDrawer with full audit event
- "View all" link → /audit

STATES: all from master template

ACCESSIBILITY:
- Dashboard cards are <section> with aria-labelledby pointing to card heading
- KPI deltas have screen-reader text: "up 12 percent over last 7 days"
- Service health pills have text + icon + color (color-not-only rule)

LOCALISATION: all KPI labels and action titles translatable

OUT OF SCOPE:
- Billing (covered in 03-platform/06-billing.md)
- Cross-tenant analytics (only for platform admin, separate screen)
```
