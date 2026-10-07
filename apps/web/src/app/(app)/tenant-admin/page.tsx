import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard, DataTable, EmptyState, RefreshErrorState } from "../../_components/ds";
import { getTenantAdminDashboard } from "../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { Breadcrumb } from "./Breadcrumb";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const KPI_ICONS = ["👥", "🧩", "💚", "🎯"];
const KPI_BG = ["#eff6ff", "#ecfdf3", "#ecfdf3", "#f1f5f9"];

// GAP-TENANT-ADMIN-HOME-05: quick-nav tiles now carry an optional `roles`
// filter. A tile with `roles` is only shown when the current session has one
// of them; a tile without is visible to everyone the layout already admits
// (tenant_admin/platform_admin/super_admin). This is a cosmetic convenience
// (don't send a tenant_admin to a page that will redirect them) — the real
// authorization stays server-side on each target page (platform-config,
// org-type, operations already call requireAnyRole). The emoji is kept in a
// separate aria-hidden span so screen readers announce the label only, not
// the emoji's CLDR name.
const PLATFORM_ROLES = ["platform_admin", "super_admin"];
type QuickNavItem = { href: string; label: string; icon: string; roles?: string[] };
const QUICK_NAV: QuickNavItem[] = [
  { href: "/tenant-admin/users", label: "Users", icon: "👥" },
  { href: "/tenant-admin/roles", label: "Roles", icon: "🔑" },
  { href: "/tenant-admin/sessions", label: "Sessions", icon: "🖥️" },
  { href: "/tenant-admin/security", label: "Security Center", icon: "🛡️" },
  { href: "/tenant-admin/mfa", label: "MFA", icon: "🔐" },
  { href: "/tenant-admin/sso", label: "SSO", icon: "🔗" },
  { href: "/tenant-admin/idp", label: "Identity Providers", icon: "🌐" },
  { href: "/tenant-admin/api-keys", label: "API Keys", icon: "🗝️" },
  { href: "/tenant-admin/audit", label: "Audit Log", icon: "📋" },
  { href: "/tenant-admin/breakglass", label: "Break-Glass", icon: "🚨" },
  { href: "/tenant-admin/compliance", label: "Compliance", icon: "📜" },
  { href: "/tenant-admin/siem", label: "SIEM", icon: "🔍" },
  { href: "/tenant-admin/org-hierarchy", label: "Org Hierarchy", icon: "🏛️" },
  { href: "/tenant-admin/readiness", label: "Readiness", icon: "🎯" },
  { href: "/tenant-admin/activation", label: "Activation", icon: "📈" },
  { href: "/tenant-admin/platform-config", label: "Platform Config", icon: "⚙️", roles: PLATFORM_ROLES },
  { href: "/tenant-admin/org-type", label: "Org Type", icon: "🏢", roles: PLATFORM_ROLES },
  { href: "/tenant-admin/install", label: "Installer", icon: "🧩" },
  { href: "/tenant-admin/settings", label: "Settings", icon: "⚙️" },
  { href: "/tenant-admin/notifications", label: "Notifications", icon: "🔔" },
  { href: "/tenant-admin/subscription", label: "Subscription", icon: "💳" },
];

export default async function TenantAdminPage({ searchParams }: { searchParams?: { denied?: string } }) {
  const roles = getSessionRoles();
  const canViewOperations = roles.includes("platform_admin") || roles.includes("super_admin");
  const { data: dashboard, source } = await getTenantAdminDashboard();
  const { kpis, health, modules } = dashboard;
  // UX-013: `source` was already fetched but only wired to the badge below
  // -- never to the KPI values, so a failed load rendered raw zeroes. Gate
  // on it, same convention as projects/dashboard and estab/dashboard.
  const errored = source === "error";

  // GAP-TENANT-ADMIN-OPERATIONS-01: the Operations route redirects a
  // non-platform admin here with ?denied=operations instead of bouncing them
  // silently. Surface a visible, plain-language notice so they know why.
  const deniedArea = searchParams?.denied === "operations" ? "the Operations dashboard" : null;

  const visibleNav = QUICK_NAV.filter((item) => !item.roles || item.roles.some((r) => roles.includes(r)));

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin" }]} />
      {deniedArea && (
        <div className="alert warn" role="status" aria-live="polite" style={{ marginBottom: 12 }}>
          <strong>Access restricted</strong>
          <p>You do not have access to {deniedArea}. It is restricted to platform administrators.</p>
        </div>
      )}
      <PageHeader
        title="Tenant Administration"
        subtitle="Manage users, modules, sessions, and security for this workspace."
        help="tenant-admin"
        actions={
          <>
            {/* GAP-TENANT-ADMIN-HOME-01: this used to link to
                /tenant-admin/audit?export=true labelled "Export report", but
                the audit page never read searchParams so the query did
                nothing — the user just landed on the log. Honest label +
                plain link until a real audited server-side CSV export exists
                (tracked by GAP-TENANT-ADMIN-AUDIT-02). */}
            <a href="/tenant-admin/audit" className="btn ghost" style={{ minHeight: 44 }}>View audit log</a>
            {canViewOperations && <a className="btn ghost" href="/tenant-admin/operations" style={{ minHeight: 44 }}>Operations</a>}
            {/* GAP-TENANT-ADMIN-HOME-03: was a dead PlaceholderButton; now
                opens the existing invite flow on the users page via ?invite=1. */}
            <a href="/tenant-admin/users?invite=1" className="btn primary" style={{ minHeight: 44 }}>Invite user</a>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        {kpis.slice(0, 4).map((kpi, i) => (
          <StatCard key={kpi.label} icon={KPI_ICONS[i] ?? "📊"} iconBg={KPI_BG[i] ?? "#f1f5f9"} label={kpi.label} value={errored ? "—" : kpi.value} />
        ))}
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h">
            <h3>Service health</h3>
            {/* GAP-TENANT-ADMIN-HOME-02: on a transient load failure the loader
                falls health back to {status:'down'}, which read as a real
                platform outage. When errored, show a neutral '—' pill and a
                retry error state instead of a false "down". */}
            {errored ? (
              <span className="pill mut" aria-label="Service health unavailable">—</span>
            ) : (
              <span className={`pill ${health.status === "ok" ? "good" : health.status === "degraded" ? "warn" : "bad"}`}>{health.status}</span>
            )}
          </div>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "service health" })} backHref="/tenant-admin" />
            </div>
          ) : (
            <DataTable
              columns={[
                { key: "service", label: "Service" },
                { key: "status", label: "Status", cellType: "status" },
              ]}
              rows={health.services.map((s) => ({ service: s.service, status: s.status }))}
            />
          )}
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Enabled modules</h3>
            {/* GAP-TENANT-ADMIN-HOME-04: "configured" -> "enabled" (the API
                exposes no per-module status); hide the count on error. */}
            {!errored && <span className="pill info">{modules.length} enabled</span>}
          </div>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "enabled modules" })} backHref="/tenant-admin" />
            </div>
          ) : modules.length > 0 ? (
            <div className="pad">
              {modules.map((mod) => (
                <div key={mod.name} className="prefrow">
                  <span>{mod.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="🧩" title="No modules" message="Enabled modules will appear here." />
          )}
        </div>
      </div>
      <div className="sec-h" style={{ marginTop: 32 }}>Quick Navigation</div>
      <div className="mods" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {visibleNav.map((item) => (
          <a key={item.href} href={item.href} className="card" style={{ padding: "14px 16px", textDecoration: "none", display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 500, minHeight: 44 }}>
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
