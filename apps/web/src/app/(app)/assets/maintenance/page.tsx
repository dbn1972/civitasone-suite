import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetMaintenance } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable } from "../../../_components/ds";

export default async function AssetMaintenancePage() {
  const { data: records, source } = await getAssetMaintenance();
  const openJobs = records.filter((r) => r.status === "scheduled" || r.status === "in_progress").length;
  const preventive = records.filter((r) => r.maintenanceType === "preventive").length;
  const breakdowns = records.filter((r) => r.maintenanceType === "breakdown").length;
  const completed = records.filter((r) => r.status === "completed").length;

  const rows = records.map((r) => ({
    assetId: r.assetId,
    assetCode: r.assetCode,
    assetName: r.assetName,
    maintenanceType: r.maintenanceType,
    vendor: r.vendor ?? "—",
    status: r.status.replace(/_/g, " "),
  }));

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
        <StatCard icon="🔧" iconBg="#eff6ff" label="Preventive" value={preventive.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Breakdowns" value={breakdowns.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Maintenance jobs</h3>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="🛠️" title="No maintenance jobs" message="Log maintenance jobs to track asset uptime." />
        ) : (
          <DataTable
            columns={[
              { key: "assetCode", label: "Job" },
              { key: "assetName", label: "Asset" },
              { key: "maintenanceType", label: "Type" },
              { key: "vendor", label: "Technician / Agency" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="assetId"
            rowLinkPrefix="/assets/"
            sortable
            filterable
            filterPlaceholder="Filter jobs…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
