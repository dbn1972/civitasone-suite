import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getAnalyticsDashboards } from "../_data";
import { DashboardsTable } from "./DashboardsTable";
import { ArrowLeft } from "lucide-react";

export default async function AnalyticsDashboardsPage() {
  const { data: dashboards, source } = await getAnalyticsDashboards();
  // UX-013: `source` was already fetched (and handed to DashboardsTable's
  // own badge per UX-012) but never gated the stat values themselves, so a
  // failed load -- `dashboards` defaults to `[]` -- rendered "Total 0 /
  // Active 0 / Shared 0", indistinguishable from a tenant that genuinely
  // has none yet. Gate every stat on it, same convention as
  // projects/dashboard and estab/dashboard.
  const errored = source === "error";

  const shared = dashboards.filter((d) => d.visibility === "shared").length;
  const active = dashboards.filter((d) => d.status === "active").length;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/analytics">Analytics</a>
      </nav>
      <PageHeader title="Dashboards" subtitle="Saved analytics dashboards with widgets, layout and owner/shared access control." />
      {/* UX-012: the data-source badge now lives inside DashboardsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <div aria-label="Analytics dashboards">
        <StatGrid>
          <StatCard icon="📊" iconBg="#f1f5f9" label="Total" value={errored ? "—" : dashboards.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={errored ? "—" : active} />
          <StatCard icon="🔗" iconBg="#dbeafe" label="Shared" value={errored ? "—" : shared} />
        </StatGrid>
        <Card title="Dashboards">
          <DashboardsTable dashboards={dashboards} source={source} />
        </Card>
      </div>
    </>
  );
}
