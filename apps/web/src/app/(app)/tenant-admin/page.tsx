import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard, DataTable, EmptyState } from "../../_components/ds";
import { getTenantAdminDashboard } from "../../_data/loaders";
import { Breadcrumb } from "./Breadcrumb";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const KPI_ICONS = ["👥", "🧩", "💚", "🎯"];
const KPI_BG = ["#eff6ff", "#ecfdf3", "#ecfdf3", "#f1f5f9"];

export default async function TenantAdminPage() {
  const roles = getSessionRoles();
  const canViewOperations = roles.includes("platform_admin") || roles.includes("super_admin");
  const { data: dashboard, source } = await getTenantAdminDashboard();
  const { kpis, health, modules } = dashboard;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin" }]} />
      <PageHeader
        title="Tenant Administration"
        subtitle="Manage users, modules, sessions, and security for this workspace."
        actions={
          <>
            <a href="/tenant-admin/audit?export=true" className="btn ghost" style={{ minHeight: 44 }}>Export report</a>
            {canViewOperations && <a className="btn ghost" href="/tenant-admin/operations" style={{ minHeight: 44 }}>Operations</a>}
            <button className="btn primary" style={{ minHeight: 44 }}>Invite user</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        {kpis.slice(0, 4).map((kpi, i) => (
          <StatCard key={kpi.label} icon={KPI_ICONS[i] ?? "📊"} iconBg={KPI_BG[i] ?? "#f1f5f9"} label={kpi.label} value={kpi.value} />
        ))}
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h">
            <h3>Service health</h3>
            <span className={`pill ${health.status === "ok" ? "good" : health.status === "degraded" ? "warn" : "bad"}`}>{health.status}</span>
          </div>
          <DataTable
            columns={[
              { key: "service", label: "Service" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={health.services.map((s) => ({ service: s.service, status: s.status }))}
          />
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Enabled modules</h3>
            <span className="pill info">{modules.length} configured</span>
          </div>
          {modules.length > 0 ? (
            <div className="pad">
              {modules.map((mod) => (
                <div key={mod.name} className="prefrow">
                  <span>{mod.name}</span>
                  <span className="pill good">Active</span>
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
        {[
          { href: "/tenant-admin/users", label: "👥 Users" },
          { href: "/tenant-admin/roles", label: "🔑 Roles" },
          { href: "/tenant-admin/sessions", label: "🖥️ Sessions" },
          { href: "/tenant-admin/security", label: "🛡️ Security Center" },
          { href: "/tenant-admin/mfa", label: "🔐 MFA" },
          { href: "/tenant-admin/sso", label: "🔗 SSO" },
          { href: "/tenant-admin/idp", label: "🌐 Identity Providers" },
          { href: "/tenant-admin/api-keys", label: "🗝️ API Keys" },
          { href: "/tenant-admin/audit", label: "📋 Audit Log" },
          { href: "/tenant-admin/breakglass", label: "🚨 Break-Glass" },
          { href: "/tenant-admin/compliance", label: "📜 Compliance" },
          { href: "/tenant-admin/siem", label: "🔍 SIEM" },
          { href: "/tenant-admin/org-hierarchy", label: "🏛️ Org Hierarchy" },
          { href: "/tenant-admin/readiness", label: "🎯 Readiness" },
          { href: "/tenant-admin/install", label: "🧩 Installer" },
          { href: "/tenant-admin/settings", label: "⚙️ Settings" },
          { href: "/tenant-admin/notifications", label: "🔔 Notifications" },
          { href: "/tenant-admin/subscription", label: "💳 Subscription" },
        ].map((item) => (
          <a key={item.href} href={item.href} className="card" style={{ padding: "14px 16px", textDecoration: "none", display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 500, minHeight: 44 }}>
            {item.label}
          </a>
        ))}
      </div>
    </main>
  );
}
