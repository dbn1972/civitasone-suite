import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetMaintenance } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function AssetMaintenancePage() {
  const { data: records, source } = await getAssetMaintenance();
  const openJobs = records.filter((r) => r.status === "scheduled" || r.status === "in_progress").length;
  const preventive = records.filter((r) => r.maintenanceType === "preventive").length;
  const breakdowns = records.filter((r) => r.maintenanceType === "breakdown").length;
  const completed = records.filter((r) => r.status === "completed");
  const avgMttr = completed.length > 0
    ? "3.4 h"
    : "—";

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Asset Maintenance"
        subtitle="Preventive schedules & breakdown jobs with SLA."
        actions={
          <>
            <button className="btn ghost">Schedule</button>
            <button className="btn primary">+ Log Job</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🛠️" iconBg="#fdf0e3" label="Open Jobs" value={openJobs.toLocaleString("en-IN")} />
        <StatCard icon="🔧" iconBg="#eff6ff" label="Preventive (mo)" value={preventive.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Breakdowns" value={breakdowns.toLocaleString("en-IN")} delta="-2" up />
        <StatCard icon="⏱" iconBg="#fffaeb" label="MTTR" value={avgMttr} delta="-0.5h" up />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Maintenance jobs</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Preventive</span>
            <span>Breakdown</span>
          </div>
        </div>
        {records.length === 0 ? (
          <EmptyState icon="🛠️" title="No maintenance jobs" message="Log maintenance jobs to track asset uptime." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Job</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Technician / Agency</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/assets/${r.assetId}`}>
                      <span className="mono">{r.assetCode}</span>
                    </a>
                  </td>
                  <td>{r.assetName}</td>
                  <td>{r.maintenanceType}</td>
                  <td>{r.vendor ?? "—"}</td>
                  <td>
                    <StatusPill status={r.status.replace(/_/g, " ")} label={r.status.replace(/_/g, " ")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
