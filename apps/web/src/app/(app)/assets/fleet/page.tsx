import Link from "next/link";
import { PageHeader, Card } from "../../../_components/ds";

/**
 * Fleet & Telematics overview — navigation hub for the three fleet screens.
 * No data is fetched here (nothing to fabricate); each destination screen
 * fetches and source-checks its own list.
 */
export default function FleetOverviewPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet & Telematics"
        subtitle="Government vehicles, GPS position, and IoT telematics devices."
        back="/assets"
        backLabel="Assets"
      />

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        <Card title="Vehicles" padding>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            Register government vehicles and record their latest GPS position.
          </p>
          <Link href="/assets/fleet/vehicles" className="btn primary">
            Open Vehicles
          </Link>
        </Card>

        <Card title="IoT Devices" padding>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            Register telematics devices and log telemetry readings.
          </p>
          <Link href="/assets/fleet/devices" className="btn primary">
            Open Devices
          </Link>
        </Card>

        <Card title="Fleet Maintenance" padding>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            Schedule preventive maintenance for a vehicle.
          </p>
          <Link href="/assets/fleet/maintenance" className="btn primary">
            Open Maintenance
          </Link>
        </Card>
      </div>
    </main>
  );
}
