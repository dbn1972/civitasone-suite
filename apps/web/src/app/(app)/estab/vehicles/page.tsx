import Link from "next/link";
import { getVehicles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { VehiclesTable, type VehicleRow } from "./VehiclesTable";

// GAP-ESTAB-VEHICLES-02/NEW-01: show the resolved officer name (never the raw
// UUID), "Pool" when unallocated, and "—" when an id could not be resolved.
function allocatedLabel(v: { assignedTo?: string; assignedToName?: string }): string {
  if (!v.assignedTo) return "Pool";
  return v.assignedToName ?? "—";
}

export default async function VehiclesPage() {
  const { data: vehicles, source } = await getVehicles();
  const errored = source === "error";
  const total = vehicles.length;
  const available = vehicles.filter((v) => v.status === "available").length;
  const inUse = vehicles.filter((v) => v.status === "in_use").length;
  const maintenance = vehicles.filter((v) => v.status === "maintenance").length;
  // GAP-ESTAB-VEHICLES-04: statuses other than the three tiles (reserved,
  // disposed/retired, …) were counted in "Fleet" but no other tile, so tiles
  // did not reconcile. Surface the remainder explicitly so Fleet = sum of tiles.
  const other = Math.max(0, total - available - inUse - maintenance);

  const rows: VehicleRow[] = vehicles.map((v) => ({
    id: v.id,
    vehicleNo: v.vehicleNo,
    model: `${v.make} ${v.model}`.trim(),
    allocatedTo: allocatedLabel(v),
    fuel: v.fuelType ? v.fuelType.replace(/_/g, " ") : "—",
    // NEW-01: guard against a missing odometer so a null never throws on
    // .toLocaleString(); show "—" instead of a fabricated 0.
    odometer: typeof v.odometerKm === "number" ? `${v.odometerKm.toLocaleString("en-IN")} km` : "—",
    status: v.status.replace(/_/g, " "),
    pool: !v.assignedTo,
  }));

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Vehicle Management"
        // GAP-ESTAB-VEHICLES-01: honest subtitle — this screen is the fleet
        // register and allocation; logbook/fuel/maintenance live in the Asset
        // register and are linked from the banner below.
        subtitle="Fleet register and allocation. Logbook, fuel and maintenance live in the Asset register."
        actions={
          <Link href="/estab/vehicles/new" className="btn primary" style={{ minHeight: 44 }}>+ Add Vehicle</Link>
        }
      />
      {/* GAP-ESTAB-VEHICLES-01/05: token-based banner (dark-mode correct, no
          hex, no emoji) that actually links to the Asset-register screens it
          names, so every capability in the copy is reachable. */}
      <div
        className="alert"
        style={{
          background: "var(--infobg)",
          border: "1px solid var(--infobd)",
          color: "var(--info)",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 18,
          fontSize: 13,
        }}
      >
        <b>Vehicles are Assets.</b> The vehicle record (value, depreciation) lives in the{" "}
        <Link href="/assets/fleet/vehicles">Asset register</Link>; service and{" "}
        <Link href="/assets/fleet/maintenance">maintenance history</Link> are tracked there. This screen covers fleet registration and allocation.
      </div>
      {/* Distinct, honest metrics; "—" (not a fabricated 0) when the fleet
          failed to load; an "Other" tile so tiles reconcile to Fleet. */}
      <StatGrid>
        <StatCard icon="🚗" tone="info" label="Fleet" value={errored ? "—" : total.toLocaleString("en-IN")} hint="Total vehicles registered. Equals the sum of the status tiles." />
        <StatCard icon="✅" tone="good" label="Available" value={errored ? "—" : available.toLocaleString("en-IN")} />
        <StatCard icon="🧭" tone="warn" label="In Use" value={errored ? "—" : inUse.toLocaleString("en-IN")} />
        <StatCard icon="🔧" tone="bad" label="Under Maintenance" value={errored ? "—" : maintenance.toLocaleString("en-IN")} />
        {!errored && other > 0 ? (
          <StatCard icon="📦" tone="neutral" label="Other / Retired" value={other.toLocaleString("en-IN")} hint="Reserved, disposed or retired vehicles not in the three status tiles." />
        ) : null}
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <>
            <div className="card-h"><h3>Vehicle fleet</h3></div>
            <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "vehicle fleet" })} /></div>
          </>
        ) : vehicles.length === 0 ? (
          <>
            <div className="card-h"><h3>Vehicle fleet</h3></div>
            <EmptyState icon="🚗" title="No vehicles found" message="Register vehicles to manage your fleet." />
          </>
        ) : (
          // GAP-ESTAB-VEHICLES-03: the table owns the single "Vehicle fleet"
          // heading (plus the Segmented control); the page no longer renders a
          // duplicate h3.
          <VehiclesTable rows={rows} />
        )}
      </div>
    </div>
  );
}
