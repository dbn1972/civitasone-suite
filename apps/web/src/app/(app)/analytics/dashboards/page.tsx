import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getAnalyticsDashboards } from "../_data";
import { DashboardsTable } from "./DashboardsTable";

export default async function AnalyticsDashboardsPage() {
  const { data: dashboards, source } = await getAnalyticsDashboards();

  const shared = dashboards.filter((d) => d.visibility === "shared").length;
  const active = dashboards.filter((d) => d.status === "active").length;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/analytics">Analytics</a>
      </nav>
      <PageHeader title="Dashboards" subtitle="Saved analytics dashboards with widgets, layout and owner/shared access control." />
      {source === "error" && <DataSourceBadge source="error" />}
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
