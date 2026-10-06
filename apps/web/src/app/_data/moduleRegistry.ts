/**
 * Shared module registry — the single source of truth for the set of
 * top-level (app) modules the suite ships. Introduced for
 * GAP-DASHBOARD-HOME-2-03: the dashboard previously hard-coded a stale
 * 17-item list that drifted from the Sidebar (Court/Designer/Visitor/…
 * users saw no tile), and GAP-DASHBOARD-HOME-01 needs a build-time module
 * count instead of a fabricated "33".
 *
 * This is a plain data module with NO client/server-only imports, so it is
 * safe to import from server components (dashboard/page.tsx,
 * (marketing)/page.tsx) AND client components (ds/Sidebar.tsx).
 *
 * `roles` is the OPTIONAL role-family allow-list used for dashboard tile
 * visibility (convenience only — ModuleGate / requireAnyRole / per-route 403
 * remain the real authorization boundary). An empty array means "no role
 * restriction" (always visible to a signed-in user). Matching uses
 * hasRoleFamily (see lib/auth/roleGuard) so a family like "hr" matches
 * "hr_officer" but NOT "chr_manager".
 */
export interface ModuleRegistryEntry {
  /** Tenant-level module key (mirrors Sidebar NavItem.moduleKey); null when the module is always-on and not entitlement-gated. */
  moduleKey: string | null;
  /** Display label. */
  label: string;
  /** Primary route for the module. */
  href: string;
  /** Short description for dashboard tiles. */
  desc: string;
  /** Emoji icon for dashboard tiles (the Sidebar maps its own lucide icons and ignores this). */
  icon: string;
  /** Tile background colour token (dashboard tiles). */
  bg: string;
  /** Role families permitted to see the dashboard tile; empty = everyone signed in. */
  roles: readonly string[];
}

/**
 * The canonical module list. Ordering is roughly the order used in the
 * Sidebar NAV groups. When a new top-level (app) module route is added, add
 * its entry here (the registry test asserts parity with the known route set).
 */
export const MODULE_REGISTRY: readonly ModuleRegistryEntry[] = [
  { moduleKey: "finance", label: "Finance", href: "/finance", desc: "Budgets, bills, payments, GL", icon: "🏦", bg: "#eef2ff", roles: ["finance"] },
  { moduleKey: "revenue", label: "Revenue", href: "/revenue", desc: "Demands, collections, assessments", icon: "🧾", bg: "#eef2ff", roles: ["revenue"] },
  { moduleKey: "billing", label: "Billing", href: "/billing", desc: "Invoices, e-invoicing, GSTN", icon: "📄", bg: "#eef2ff", roles: ["billing", "finance"] },
  { moduleKey: "hrms", label: "HR & Payroll", href: "/hr", desc: "Employees, attendance, leave, payroll", icon: "👥", bg: "#f0fdf4", roles: ["hr", "payroll"] },
  { moduleKey: "procurement", label: "Procurement", href: "/procurement", desc: "Indents, vendors, POs, GRN", icon: "🛒", bg: "#fff7ed", roles: ["procurement"] },
  { moduleKey: "projects", label: "Projects", href: "/projects", desc: "Projects, milestones, fund releases", icon: "📊", bg: "#eff6ff", roles: ["project"] },
  { moduleKey: "grants", label: "Grants", href: "/grants", desc: "Grants, grantees, releases, UCs", icon: "🎁", bg: "#fef3f2", roles: ["grant"] },
  { moduleKey: "establishment", label: "Establishment", href: "/estab", desc: "Files, meetings, vehicles, compliance", icon: "🏢", bg: "#f5f3ff", roles: ["estab"] },
  { moduleKey: "assets", label: "Assets", href: "/assets", desc: "Fixed assets, maintenance, depreciation", icon: "🏗️", bg: "#fff7ed", roles: ["asset"] },
  { moduleKey: "stock", label: "Stock", href: "/stock", desc: "SKUs, stock ledger, low stock alerts", icon: "📦", bg: "#ecfdf5", roles: ["stock", "inventory"] },
  { moduleKey: "crm", label: "CRM", href: "/crm", desc: "Contacts, deals, pipeline", icon: "🤝", bg: "#fdf4ff", roles: ["crm", "sales"] },
  { moduleKey: "helpdesk", label: "Helpdesk", href: "/helpdesk", desc: "Tickets, SLA, escalations", icon: "🎧", bg: "#f0f9ff", roles: ["helpdesk"] },
  { moduleKey: "citizen", label: "Citizen Portal", href: "/citizen", desc: "Requests, RTI, feedback", icon: "🪪", bg: "#ecfdf5", roles: ["citizen"] },
  { moduleKey: "citizen", label: "Service Designer", href: "/designer", desc: "Design citizen service journeys", icon: "🧩", bg: "#fdf4ff", roles: ["citizen"] },
  { moduleKey: "visitor", label: "Visitor Mgmt", href: "/visitor", desc: "Passes, check-in, host approvals", icon: "🛂", bg: "#f0f9ff", roles: ["visitor"] },
  { moduleKey: "meeting", label: "Meeting Mgmt", href: "/meeting", desc: "Agendas, minutes, action items", icon: "📅", bg: "#f5f3ff", roles: ["meeting"] },
  { moduleKey: "court", label: "Court Mgmt", href: "/court", desc: "Cases, cause-list, orders", icon: "⚖️", bg: "#faf5ff", roles: ["court"] },
  { moduleKey: "inspection", label: "Inspection", href: "/inspection", desc: "Schedules, checklists, findings", icon: "🔎", bg: "#fff7ed", roles: ["inspection"] },
  { moduleKey: "audit", label: "Audit", href: "/audit", desc: "Observations, risk register, compliance", icon: "🔍", bg: "#fff1f2", roles: ["audit"] },
  { moduleKey: "legal", label: "Legal", href: "/legal", desc: "Cases, hearings, court orders", icon: "⚖️", bg: "#faf5ff", roles: ["legal"] },
  { moduleKey: "ai-agent", label: "AI & Copilot", href: "/ai", desc: "Assistants, automations, copilot", icon: "🤖", bg: "#fdf4ff", roles: ["ai"] },
  { moduleKey: "field", label: "Field Ops", href: "/field", desc: "Field tasks, routes, visits", icon: "🚚", bg: "#ecfdf5", roles: ["field"] },
  { moduleKey: "loyalty", label: "Loyalty", href: "/loyalty", desc: "Points, tiers, rewards", icon: "⭐", bg: "#fff7ed", roles: ["loyalty"] },
  { moduleKey: "catalogue", label: "Catalogue", href: "/catalogue", desc: "Products, services, pricing", icon: "🗂️", bg: "#f0f9ff", roles: ["catalogue"] },
  { moduleKey: "cdp", label: "CDP", href: "/cdp", desc: "Customer data platform, segments", icon: "🧬", bg: "#fdf4ff", roles: ["cdp"] },
  { moduleKey: "journey", label: "Journeys", href: "/journeys", desc: "Lifecycle journeys, triggers", icon: "🧭", bg: "#eff6ff", roles: ["journey"] },
  { moduleKey: "recommendation", label: "Recommendations", href: "/recommendations", desc: "Suggested next-best actions", icon: "✨", bg: "#fdf4ff", roles: ["recommendation"] },
  { moduleKey: "reports", label: "Reports", href: "/reports", desc: "Analytics, KPIs, MIS", icon: "📈", bg: "#eff6ff", roles: [] },
  { moduleKey: "knowledge", label: "Knowledge", href: "/knowledge", desc: "Documents, records, search", icon: "📚", bg: "#fff7ed", roles: [] },
  { moduleKey: "identity", label: "Identity", href: "/identity", desc: "Users, credentials, device trust", icon: "🪪", bg: "#f5f3ff", roles: ["identity", "admin", "tenant"] },
  { moduleKey: "tenant", label: "Tenant", href: "/tenant", desc: "Tenant profile, offices, settings", icon: "🏛️", bg: "#f5f3ff", roles: ["admin", "tenant"] },
  { moduleKey: null, label: "Notifications", href: "/notifications", desc: "Alerts, deliveries, preferences", icon: "🔔", bg: "#f0f9ff", roles: [] },
  { moduleKey: null, label: "Tenant Admin", href: "/tenant-admin", desc: "Users, roles, settings, billing", icon: "🛡️", bg: "#f5f3ff", roles: ["admin", "tenant"] },
];

/** The number of modules the suite ships — used for honest build-time counts on the marketing page (GAP-DASHBOARD-HOME-01). */
export const MODULE_COUNT = MODULE_REGISTRY.length;
