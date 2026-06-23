import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getVehicles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function VehiclesPage() {
  const { data: vehicles, source } = await getVehicles();
  const total = vehicles.length;
  const available = vehicles.filter((v) => v.status === "available").length;
  const inUse = vehicles.filter((v) => v.status === "in_use").length;
  const maintenance = vehicles.filter((v) => v.status === "maintenance").length;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Vehicle Management"
        subtitle="Allocation, log books, fuel and maintenance for the fleet."
        actions={
          <>
            <button className="btn ghost">Allocate</button>
            <button className="btn primary">+ Add Vehicle</button>
          </>
        }
      />
      <div
        className="banner"
        style={{
          background: "#e6f7f5",
          border: "1px solid #99e6da",
          color: "#0f766e",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 18,
          fontSize: 13,
        }}
      >
        🔗 <b>Vehicles are Assets.</b> The vehicle record (value, depreciation) lives in the Asset register; this screen adds fleet operations — allocation, logbook &amp; fuel.
      </div>
      <StatGrid>
        <StatCard icon="🚗" iconBg="#e6f7f5" label="Fleet" value={total.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="On Duty / Avail" value={(inUse + available).toLocaleString("en-IN")} />
        <StatCard icon="⛽" iconBg="#fffaeb" label="Service Due" value={maintenance.toLocaleString("en-IN")} />
        <StatCard icon="🔧" iconBg="#fef3f2" label="Under Maintenance" value={maintenance.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Vehicle fleet</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Pool</span>
            <span>Assigned</span>
          </div>
        </div>
        {vehicles.length === 0 ? (
          <EmptyState icon="🚗" title="No vehicles found" message="Register vehicles to manage your fleet." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Reg no.</th>
                <th>Model</th>
                <th>Allocated to</th>
                <th>Odometer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td><span className="mono">{v.vehicleNo}</span></td>
                  <td>{v.make} {v.model}</td>
                  <td>{v.assignedTo ?? "Pool"}</td>
                  <td>{v.odometerKm.toLocaleString("en-IN")} km</td>
                  <td>
                    <StatusPill status={v.status.replace(/_/g, " ")} label={v.status.replace(/_/g, " ")} />
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
