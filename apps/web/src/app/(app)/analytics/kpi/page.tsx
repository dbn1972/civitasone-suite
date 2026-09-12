import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getAnalyticsKpis } from "@/app/_data/loaders";
import { KpiTable } from "./KpiTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function KpiPage() {
  const result = await getAnalyticsKpis();
  const { data: rows, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  const onTarget = errored ? null : rows.filter((r) => r.trend.includes("↑") || r.currentValue === r.target).length;
  const belowTarget = errored
    ? null
    : rows.length - rows.filter((r) => r.trend.includes("↑") || r.currentValue === r.target).length;
  const improving = errored ? null : rows.filter((r) => r.trend.includes("↑") || r.trend.includes("+")).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="KPI Library" subtitle="Organisation-wide Key Performance Indicators with targets and trends." back="/analytics" />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#eef2ff" label="Total KPIs" value={total ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Target" value={onTarget ?? "—"} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Below Target" value={belowTarget ?? "—"} />
        <StatCard icon="📈" iconBg="#fce7ee" label="Improving" value={improving ?? "—"} />
      </StatGrid>
      <Card title="KPI Register">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "KPIs" })} backHref="/analytics" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🎯" title="No KPIs defined" message="No Key Performance Indicators have been configured. Define metrics in the analytics module to see KPIs." action={<a href="/analytics/queries" className="btn primary">Create Metric</a>} />
        ) : (
          <KpiTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
