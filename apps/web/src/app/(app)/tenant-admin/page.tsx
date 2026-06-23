import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../_components/ds";
import { getTenantAdminDashboard } from "../../_data/loaders";

const KPI_ICONS = ["👥", "🧩", "💚", "🎯"];
const KPI_BG = ["#eff6ff", "#ecfdf3", "#ecfdf3", "#f1f5f9"];

export default async function TenantAdminPage() {
  const { data: dashboard, source } = await getTenantAdminDashboard();
  const { kpis, health, modules } = dashboard;

  return (
    <div className="wrap">
      <PageHeader
        title="Tenant Administration"
        subtitle="Manage users, modules, sessions, and security for this workspace."
        actions={
          <>
            <button className="btn ghost">Export report</button>
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
          {health.services.length > 0 ? (
            <table className="tbl">
              <thead><tr><th>Service</th><th>Status</th></tr></thead>
              <tbody>
                {health.services.map((s) => (
                  <tr key={s.service}>
                    <td><span className="mono">{s.service}</span></td>
                    <td><span className={`pill ${s.status === "ok" ? "good" : s.status === "degraded" ? "warn" : "bad"}`}>{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state"><div>💚</div><h4>No service data</h4><p>Service health will appear once services are monitored.</p></div>
          )}
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
            <div className="empty-state"><div>🧩</div><h4>No modules</h4><p>Enabled modules will appear here.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
