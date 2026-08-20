import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceBudgets } from "@/app/_data/loaders";
import { RevisedEstimatesTable, type RevisedEstimateRow } from "./RevisedEstimatesTable";

// getFinanceRevisedEstimates() used to hit /api/v1/finance/budgets/revised-estimates,
// which has never existed as a backend route. Budget Estimate (beMinor) and Revised
// Estimate (reMinor) are real columns on the same budget row getFinanceBudgets()
// already reads — this derives the BE-vs-RE view from that real data instead.
function toRow(b: Awaited<ReturnType<typeof getFinanceBudgets>>["data"][number]): RevisedEstimateRow {
  const be = Number(b.beMinor) / 100;
  const re = Number(b.reMinor) / 100;
  const variancePct = be > 0 ? ((re - be) / be) * 100 : 0;
  return {
    id: b.id,
    headCode: b.majorHead,
    description: b.subHead ?? b.majorHead,
    budgetEstimate: be,
    revisedEstimate: re,
    variancePct,
    status: re > be ? "increased" : re < be ? "decreased" : "no_change",
  };
}

export default async function RevisedEstimatesPage() {
  const { data: budgets, source } = await getFinanceBudgets();
  const estimates = budgets.map(toRow);
  const increased = estimates.filter((e) => e.status === "increased").length;
  const decreased = estimates.filter((e) => e.status === "decreased").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Revised Estimates"
        subtitle="Budget Estimate vs Revised Estimate with variance analysis by head."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Total Heads" value={estimates.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Increased" value={increased} />
        <StatCard icon="📉" iconBg="#fce7ee" label="Decreased" value={decreased} />
        <StatCard icon="➖" iconBg="#fffaeb" label="No Change" value={estimates.length - increased - decreased} />
      </StatGrid>
      <Card title="BE vs RE Variance">
        <RevisedEstimatesTable estimates={estimates} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
