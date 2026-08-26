import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getVehicles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { VehiclesTable, type VehicleRow } from "./VehiclesTable";

export default async function VehiclesPage() {
  const { data: vehicles, source } = await getVehicles();
  const errored = source === "error";
  const total = vehicles.length;
  const available = vehicles.filter((v) => v.status === "available").length;
  const inUse = vehicles.filter((v) => v.status === "in_use").length;
  const maintenance = vehicles.filter((v) => v.status === "maintenance").length;

  const rows: VehicleRow[] = vehicles.map((v) => ({
    id: v.id,
    vehicleNo: v.vehicleNo,
    model: `${v.make} ${v.model}`,
    allocatedTo: v.assignedTo ?? "Pool",
    odometer: `${v.odometerKm.toLocaleString("en-IN")} km`,
    status: v.status.replace(/_/g, " "),
    pool: !v.assignedTo,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Vehicle Management"
        subtitle="Allocation, log books, fuel and maintenance for the fleet."
        actions={
          <Link href="/estab/vehicles/new" className="btn primary" style={{ minHeight: 44 }}>+ Add Vehicle</Link>
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
        <span aria-hidden="true">🔗</span> <b>Vehicles are Assets.</b> The vehicle record (value, depreciation) lives in the Asset register; this screen adds fleet operations — allocation, logbook &amp; fuel.
      </div>
      {/* Distinct, honest metrics (no duplicated "Service Due"), and "—" rather
          than a fabricated 0 when the fleet failed to load. */}
      <StatGrid>
        <StatCard icon="🚗" iconBg="#e6f7f5" label="Fleet" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Available" value={errored ? "—" : available.toLocaleString("en-IN")} />
        <StatCard icon="🧭" iconBg="#fffaeb" label="In Use" value={errored ? "—" : inUse.toLocaleString("en-IN")} />
        <StatCard icon="🔧" iconBg="#fef3f2" label="Under Maintenance" value={errored ? "—" : maintenance.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Vehicle fleet</h3>
        </div>
        {errored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "vehicle fleet" })} /></div>
        ) : vehicles.length === 0 ? (
          <EmptyState icon="🚗" title="No vehicles found" message="Register vehicles to manage your fleet." />
        ) : (
          <VehiclesTable rows={rows} />
        )}
      </div>
    </>
  );
}
