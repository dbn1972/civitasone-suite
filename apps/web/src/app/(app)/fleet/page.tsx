import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";

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
  const { data: stats, source } = await getFleetDashboard();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fleet Management"
        subtitle="Government vehicles, trips, fuel, maintenance, and telematics."
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          marginBottom: 24,
        }}
      >
        <KpiCard label="Total Vehicles"        value={stats.totalVehicles}        variant="neutral" />
        <KpiCard label="Available"             value={stats.availableVehicles}    variant="good"    />
        <KpiCard label="Due Maintenance (7d)"  value={stats.scheduledMaintenance} variant="warn"    />
        <KpiCard label="Overdue Maintenance"   value={stats.overdueMaintenance}   variant="bad"     />
      </div>

      {/* Navigation tiles */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
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
    </main>
  );
}

function KpiCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "neutral" | "good" | "warn" | "bad";
}) {
  const colorMap = {
    neutral: "var(--text)",
    good:    "var(--good, #27ae60)",
    warn:    "var(--warn, #e67e22)",
    bad:     "var(--bad, #c0392b)",
  };
  return (
    <Card padding>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: colorMap[variant],
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{label}</div>
      </div>
    </Card>
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
