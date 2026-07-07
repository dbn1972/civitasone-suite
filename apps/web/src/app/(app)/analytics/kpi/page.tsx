import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getAnalyticsKpis } from "@/app/_data/loaders";
import { KpiTable } from "./KpiTable";

export default async function KpiPage() {
  const { data: rows, source } = await getAnalyticsKpis();

  const total = rows.length;
  const onTarget = rows.filter((r) => r.trend.includes("↑") || r.currentValue === r.target).length;
  const belowTarget = total - onTarget;
  const improving = rows.filter((r) => r.trend.includes("↑") || r.trend.includes("+")).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="KPI Library" subtitle="Organisation-wide Key Performance Indicators with targets and trends." back="/analytics" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🎯" iconBg="#eef2ff" label="Total KPIs" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Target" value={onTarget} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Below Target" value={belowTarget} />
        <StatCard icon="📈" iconBg="#fce7ee" label="Improving" value={improving} />
      </StatGrid>
      <Card title="KPI Register">
        {rows.length === 0 ? (
          <EmptyState icon="🎯" title="No KPIs defined" message="No Key Performance Indicators have been configured. Define metrics in the analytics module to see KPIs." action={<a href="/analytics/queries" className="btn primary">Create Metric</a>} />
        ) : (
          <KpiTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
