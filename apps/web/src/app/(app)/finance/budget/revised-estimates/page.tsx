import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceBudgets } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
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
  const result = await getFinanceBudgets();
  const { data: budgets, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const estimates = budgets.map(toRow);
  const increased = errored ? null : estimates.filter((e) => e.status === "increased").length;
  const decreased = errored ? null : estimates.filter((e) => e.status === "decreased").length;
  const total = errored ? null : estimates.length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Revised Estimates"
        subtitle="Budget Estimate vs Revised Estimate with variance analysis by head."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Total Heads" value={total ?? "—"} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Increased" value={increased ?? "—"} />
        <StatCard icon="📉" iconBg="#fce7ee" label="Decreased" value={decreased ?? "—"} />
        <StatCard icon="➖" iconBg="#fffaeb" label="No Change" value={total === null || increased === null || decreased === null ? "—" : total - increased - decreased} />
      </StatGrid>
      <Card title="BE vs RE Variance">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "revised estimates" })} backHref="/finance" />
          </div>
        ) : (
          <RevisedEstimatesTable estimates={estimates} source={source} />
        )}
      </Card>
    </main>
  );
}
