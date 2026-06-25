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
    <div className="wrap">
      <Breadcrumb items={[{ label: "Tenant Admin" }]} />
      <PageHeader
        title="Tenant Administration"
        subtitle="Manage users, modules, sessions, and security for this workspace."
        actions={
          <>
            <button className="btn ghost">Export report</button>
            {canViewOperations && <a className="btn ghost" href="/tenant-admin/operations">Operations</a>}
            <button className="btn primary">Invite user</button>
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
    </div>
  );
}
