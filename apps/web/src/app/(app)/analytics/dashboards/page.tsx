import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getAnalyticsDashboards } from "../_data";
import { DashboardsTable } from "./DashboardsTable";
import { ArrowLeft } from "lucide-react";

export default async function AnalyticsDashboardsPage() {
  const { data: dashboards, source } = await getAnalyticsDashboards();

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
      <main aria-label="Analytics dashboards">
        <StatGrid>
          <StatCard icon="📊" iconBg="#f1f5f9" label="Total" value={dashboards.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
          <StatCard icon="🔗" iconBg="#dbeafe" label="Shared" value={shared} />
        </StatGrid>
        <Card title="Dashboards">
          <DashboardsTable dashboards={dashboards} source={source} />
        </Card>
      </main>
    </>
  );
}
