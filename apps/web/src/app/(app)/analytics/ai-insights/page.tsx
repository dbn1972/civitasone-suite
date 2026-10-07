import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState, HelpTip } from "@/app/_components/ds";
import { getAnalyticsAiInsights } from "@/app/_data/loaders";
import { AiInsightsTable } from "./AiInsightsTable";
import { averageConfidence } from "./confidence";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function AiInsightsPage() {
  const result = await getAnalyticsAiInsights();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  // GAP-ANALYTICS-AI-INSIGHTS-02: these counts are informational only — the
  // analytics API exposes no insight id and no status-mutation endpoint, so
  // nothing on this read-only page can move a row between "New" and
  // "Actioned". Labels are plain ("New"/"Actioned"), not "New (Unread)" with
  // its implied read/unread toggle, so they don't promise interactivity the
  // backend doesn't offer yet.
  const newInsights = errored ? null : rows.filter((r) => r.status === "New").length;
  const actioned = errored ? null : rows.filter((r) => r.status === "Actioned").length;
  // GAP-ANALYTICS-AI-INSIGHTS-03: average only the readable confidence values.
  const avgConf = errored ? null : averageConfidence(rows.map((r) => r.confidence));

  return (
    <div className="page-main wrap">
      <PageHeader title="AI Insights" subtitle="Machine learning generated insights and recommended actions across modules." back="/analytics" />
      <StatGrid>
        <StatCard icon="🤖" tone="info" label="Total Insights" value={total ?? "—"} />
        <StatCard icon="🆕" tone="good" label="New" value={newInsights ?? "—"} />
        <StatCard icon="✅" tone="warn" label="Actioned" value={actioned ?? "—"} />
        <StatCard
          icon="🎯"
          tone="info"
          label="Avg. Confidence"
          hint="Model-estimated likelihood the insight is correct; not a guarantee. Review before acting."
          value={avgConf === null ? "—" : `${avgConf}%`}
        />
      </StatGrid>
      <Card
        title="AI-Generated Insights"
        link={
          <HelpTip term="Confidence">
            Model-estimated likelihood each insight is correct, shown per row. It is an estimate,
            not a guarantee — review before acting. The average above covers only insights whose
            confidence could be read.
          </HelpTip>
        }
      >
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "AI insights" })} backHref="/analytics" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🤖"
            title="No insights yet"
            message="No insights have been generated yet. Insights appear here once the AI assistant has analysed your data. If you believe this is unexpected, ask your administrator whether the AI assistant is enabled for your organisation."
          />
        ) : (
          <AiInsightsTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </div>
  );
}
