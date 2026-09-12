import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getAnalyticsAiInsights } from "@/app/_data/loaders";
import { AiInsightsTable } from "./AiInsightsTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function AiInsightsPage() {
  const result = await getAnalyticsAiInsights();
  const { data: rows, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  const newInsights = errored ? null : rows.filter((r) => r.status === "New").length;
  const actioned = errored ? null : rows.filter((r) => r.status === "Actioned").length;
  const avgConf = errored
    ? null
    : rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + (parseInt(r.confidence, 10) || 0), 0) / rows.length)
      : 0;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="AI Insights" subtitle="Machine learning generated insights and recommended actions across modules." back="/analytics" />
      <StatGrid>
        <StatCard icon="🤖" iconBg="#eef2ff" label="Total Insights" value={total ?? "—"} />
        <StatCard icon="🆕" iconBg="#ecfdf3" label="New (Unread)" value={newInsights ?? "—"} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Actioned" value={actioned ?? "—"} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Avg. Confidence" value={avgConf === null ? "—" : avgConf > 0 ? `${avgConf}%` : "—"} />
      </StatGrid>
      <Card title="AI-Generated Insights">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "AI insights" })} backHref="/analytics" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🤖" title="No AI insights" message="AI insights are generated when the AI assistant is enabled. Enable the AI assistant in platform settings to see recommendations." />
        ) : (
          <AiInsightsTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
