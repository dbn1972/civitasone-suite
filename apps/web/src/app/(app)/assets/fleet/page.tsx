import Link from "next/link";
import { PageHeader, Card } from "../../../_components/ds";
import { getFleetSummary } from "./_data/summary";

const stat = { margin: "0 0 12px", fontSize: 13, color: "var(--ink2)" } as const;

/**
 * Fleet & Telematics overview — navigation hub for the three fleet screens.
 * Card titles match the destination page titles (GAP-ASSETS-FLEET-02).
 */
export default async function FleetOverviewPage() {
  const { data, source } = await getFleetSummary();
  const ok = source !== "error";
  const fmt = (n: number) => (ok ? n.toLocaleString("en-IN") : "—");

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Fleet & Telematics"
        subtitle="Government vehicles, GPS position, and IoT telematics devices."
        back="/assets"
        backLabel="Assets"
      />

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        <Card title="Fleet Vehicles" padding>
          <p style={{ marginTop: 0, marginBottom: 8 }}>
            Register government vehicles and record their latest GPS position.
          </p>
          <p style={stat}>
            <strong>{fmt(data.totalVehicles)}</strong> registered · <strong>{fmt(data.availableVehicles)}</strong> active
          </p>
          <Link href="/assets/fleet/vehicles" className="btn primary">
            Open Fleet Vehicles
          </Link>
        </Card>

        <Card title="Fleet IoT Devices" padding>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            Register telematics devices and log telemetry readings.
          </p>
          <Link href="/assets/fleet/devices" className="btn primary">
            Open Fleet IoT Devices
          </Link>
        </Card>

        <Card title="Fleet Maintenance" padding>
          <p style={{ marginTop: 0, marginBottom: 8 }}>
            Schedule preventive maintenance for a vehicle.
          </p>
          <p style={stat}>
            <strong style={{ color: ok && data.overdueMaintenance > 0 ? "var(--bad, #c0392b)" : undefined }}>{fmt(data.overdueMaintenance)}</strong> overdue ·{" "}
            <strong>{fmt(data.scheduledMaintenance)}</strong> due in 7 days
          </p>
          <Link href="/assets/fleet/maintenance" className="btn primary">
            Open Fleet Maintenance
          </Link>
        </Card>
      </div>
    </div>
  );
}
