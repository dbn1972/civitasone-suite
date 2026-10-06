import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type DashboardStats = {
  totalVehicles: number;
  availableVehicles: number;
  scheduledMaintenance: number;
  overdueMaintenance: number;
};

function isStats(v: unknown): v is { data: DashboardStats } {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as { data?: unknown }).data;
  return typeof d === "object" && d !== null && typeof (d as DashboardStats).totalVehicles === "number";
}

async function getFleetDashboard(): Promise<LoaderResult<DashboardStats>> {
  return fetchJson<unknown, DashboardStats>("/api/v1/assets/fleet/dashboard", {
    totalVehicles: 0, availableVehicles: 0, scheduledMaintenance: 0, overdueMaintenance: 0,
  }, {
    telemetryKey: "fleet.dashboard",
    mapResponse: (payload) => {
      if (!isStats(payload)) return null;
      return payload.data;
    },
  });
}

export default async function FleetDashboardPage() {
  const { data: stats, source, status } = await getFleetDashboard();

  // GAP-FLEET-HOME-01: a failed fetch used to render a confident {0,0,0,0}
  // KPI strip -- "0 Overdue Maintenance" read as "nothing overdue" for a
  // safety-relevant number. Fail honestly instead: show a retryable error
  // state, never fabricated zeros. A real zero on a successful load still
  // renders 0 (handled by the success branch below).
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="Fleet Management"
          subtitle="Government vehicles, trips, fuel, maintenance, and telematics."
        />
        <RefreshErrorState
          error={{
            what: "Could not load fleet figures",
            next: "The fleet service may be temporarily unavailable. Try again in a moment.",
            actions: ["retry", "back"],
          }}
          backHref="/dashboard"
          source={{ status, area: "fleet" }}
        />
      </div>
    );
  }

  // GAP-FLEET-HOME-02: use the DS StatCard/StatGrid (token-based tones that
  // follow the dark theme) instead of a local KpiCard with hard-coded hex
  // fallbacks; format counts with en-IN grouping; link the maintenance KPIs
  // to the filtered-list screen so they are a drill-down, not dead numbers.
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Management"
        subtitle="Government vehicles, trips, fuel, maintenance, and telematics."
      />

      <StatGrid>
        <StatCard
          icon="🚍"
          tone="neutral"
          label="Total Vehicles"
          value={stats.totalVehicles.toLocaleString("en-IN")}
        />
        <StatCard
          icon="✅"
          tone="good"
          label="Available"
          value={stats.availableVehicles.toLocaleString("en-IN")}
        />
        <StatCard
          icon="🛠️"
          tone="warn"
          href="/assets/fleet/maintenance"
          hint="Vehicles with maintenance scheduled in the next 7 days."
          label="Due Maintenance (7d)"
          value={stats.scheduledMaintenance.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⚠️"
          tone="bad"
          href="/assets/fleet/maintenance"
          hint="Vehicles whose scheduled maintenance date has already passed."
          label="Overdue Maintenance"
          value={stats.overdueMaintenance.toLocaleString("en-IN")}
        />
      </StatGrid>

      {/* Navigation tiles */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", marginTop: 24 }}>
        <NavCard
          href="/fleet/vehicles"
          title="Vehicles"
          description="Register and manage government vehicles."
        />
        <NavCard
          href="/assets/fleet/maintenance"
          title="Maintenance"
          description="Schedule and mark vehicle maintenance jobs."
        />
        <NavCard
          href="/assets/fleet/devices"
          title="IoT Devices"
          description="Register telematics devices and log telemetry."
        />
        <NavCard
          href="/estab/vehicles"
          title="Trips & Fuel"
          description="Trip log-book, fuel fill entries, driver roster."
        />
      </div>
    </div>
  );
}

function NavCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Card title={title} padding>
      <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: 14 }}>
        {description}
      </p>
      <Link href={href} className="btn primary">
        Open {title}
      </Link>
    </Card>
  );
}
