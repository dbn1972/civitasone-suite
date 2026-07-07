import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getAnalyticsAiInsights } from "@/app/_data/loaders";
import { AiInsightsTable } from "./AiInsightsTable";

export default async function AiInsightsPage() {
  const { data: rows, source } = await getAnalyticsAiInsights();

  const total = rows.length;
  const newInsights = rows.filter((r) => r.status === "New").length;
  const actioned = rows.filter((r) => r.status === "Actioned").length;
  const avgConf = total > 0 ? Math.round(rows.reduce((s, r) => s + (parseInt(r.confidence, 10) || 0), 0) / total) : 0;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="AI Insights" subtitle="Machine learning generated insights and recommended actions across modules." back="/analytics" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🤖" iconBg="#eef2ff" label="Total Insights" value={total} />
        <StatCard icon="🆕" iconBg="#ecfdf3" label="New (Unread)" value={newInsights} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Actioned" value={actioned} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Avg. Confidence" value={avgConf > 0 ? `${avgConf}%` : "—"} />
      </StatGrid>
      <Card title="AI-Generated Insights">
        {rows.length === 0 ? (
          <EmptyState icon="🤖" title="No AI insights" message="AI insights are generated when the AI assistant is enabled. Enable the AI assistant in platform settings to see recommendations." />
        ) : (
          <AiInsightsTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
