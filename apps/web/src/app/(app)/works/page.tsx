import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";

type DashboardData = {
  totalWorks: number;
  activeWorks: number;
  closedWorks: number;
  byStatus: Record<string, number>;
};

function isDashboard(v: unknown): v is { data: DashboardData } {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as { data?: unknown }).data;
  return typeof d === "object" && d !== null && typeof (d as DashboardData).totalWorks === "number";
}

async function getWorksDashboard(): Promise<LoaderResult<DashboardData>> {
  return fetchJson<unknown, DashboardData>(
    "/api/v1/works/dashboard",
    { totalWorks: 0, activeWorks: 0, closedWorks: 0, byStatus: {} },
    {
      telemetryKey: "works.dashboard",
      mapResponse: (payload) => (isDashboard(payload) ? payload.data : null),
    },
  );
}

export default async function WorksHub() {
  const { data: dash, source } = await getWorksDashboard();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Works & Billing"
        subtitle="Engineering works lifecycle management"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          marginBottom: 24,
        }}
      >
        <KpiCard label="Total Works"   value={dash.totalWorks}  variant="neutral" />
        <KpiCard label="Active"        value={dash.activeWorks}  variant="good"   />
        <KpiCard label="Closed"        value={dash.closedWorks}  variant="neutral" />
        <KpiCard
          label="Draft"
          value={dash.byStatus["draft"] ?? 0}
          variant="warn"
        />
      </div>

      {/* Navigation tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
        <HubTile href="/works/proposals"  label="Work Proposals"    icon="📋" />
        <HubTile href="/works/orders"     label="Work Orders"       icon="📑" />
        <HubTile href="/works/approvals"  label="AA / TS"           icon="✅" />
        <HubTile href="/works/boq"        label="Bill of Quantities" icon="📐" />
        <HubTile href="/works/tenders"    label="Tender Pipeline"   icon="📢" />
        <HubTile href="/works/execution"  label="Execution"         icon="🏗️" />
        <HubTile href="/works/billing"    label="Bills & MB"        icon="💰" />
        <HubTile href="/works/closure"    label="Closure"           icon="🔒" />
        <HubTile href="/works/contractors" label="Contractors"      icon="🏢" />
        <HubTile href="/works/masters"     label="Masters Registry" icon="📚" />
        <HubTile href="/works/reports"     label="Reports"          icon="📊" />
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
        <div style={{ fontSize: 32, fontWeight: 700, color: colorMap[variant], lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{label}</div>
      </div>
    </Card>
  );
}

function HubTile({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 p-6 rounded-xl border hover:bg-muted/50 transition-colors"
    >
      <span className="text-3xl">{icon}</span>
      <span className="font-medium text-sm">{label}</span>
    </Link>
  );
}
