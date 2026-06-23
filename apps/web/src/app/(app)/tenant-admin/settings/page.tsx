import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getTenantModules } from "../../../_data/loaders";

export default async function TenantSettingsPage() {
  const { data: modules, source } = await getTenantModules();

  const total = modules.length;
  const enabled = modules.filter((m) => m.enabled).length;
  const disabled = modules.filter((m) => !m.enabled).length;

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Settings & Modules"
        subtitle="Module configuration and toggle state for this tenant."
        actions={
          <>
            <button className="btn ghost">Audit changes</button>
            <button className="btn primary">Save changes</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🧩" iconBg="#f1f5f9" label="Total Modules" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={enabled} />
        <StatCard icon="⏸️" iconBg="#fffaeb" label="Disabled" value={disabled} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="Configured" value={total} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-h">
            <h3>Module toggles</h3>
            <div className="seg"><span className="on">All</span><span>Active</span></div>
          </div>
          <div className="pad">
            {modules.length > 0 ? (
              modules.map((mod) => (
                <div key={mod.moduleKey} className="prefrow">
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{mod.moduleName}</div>
                    <div style={{ fontSize: 12, color: "#98a2b3" }}><span className="mono">{mod.moduleKey}</span></div>
                  </div>
                  <span className={`pill ${mod.enabled ? "good" : "mut"}`}>{mod.enabled ? "Active" : "Disabled"}</span>
                </div>
              ))
            ) : (
              <div className="empty-state"><div>🧩</div><h4>No modules</h4><p>Modules will appear here once configured.</p></div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Module details</h3></div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Module</th>
                <th>Key</th>
                <th>Enabled since</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((mod) => (
                <tr key={mod.moduleKey}>
                  <td>{mod.moduleName}</td>
                  <td><span className="mono">{mod.moduleKey}</span></td>
                  <td>{mod.enabledAt ? mod.enabledAt.slice(0, 10) : "—"}</td>
                  <td>{mod.enabled ? <span className="pill good">Active</span> : <span className="pill mut">Disabled</span>}</td>
                </tr>
              ))}
              {modules.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state"><div>🧩</div><h4>No modules configured</h4></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
