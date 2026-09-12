import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceBudgets } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { minorToRupeesOrNull } from "@/lib/formatters";
import { RevisedEstimatesTable, type RevisedEstimateRow } from "./RevisedEstimatesTable";

// getFinanceRevisedEstimates() used to hit /api/v1/finance/budgets/revised-estimates,
// which has never existed as a backend route. Budget Estimate (beMinor) and Revised
// Estimate (reMinor) are real columns on the same budget row getFinanceBudgets()
// already reads — this derives the BE-vs-RE view from that real data instead.
function toRow(b: Awaited<ReturnType<typeof getFinanceBudgets>>["data"][number]): RevisedEstimateRow {
  // UX-006: `Number(b.beMinor) / 100` silently turned a missing/null beMinor
  // into a real-looking 0 (Number(null) === 0) and an unparseable one into NaN
  // that formatRupees() used to paper over as "₹0.00" too — both indistinguishable
  // from a genuine zero budget. minorToRupeesOrNull() propagates "missing" as
  // `null` instead so the table can render an honest "—" for BE/RE/Variance.
  const be = minorToRupeesOrNull(b.beMinor);
  const re = minorToRupeesOrNull(b.reMinor);
  const bothKnown = be !== null && re !== null;
  const variancePct = bothKnown ? (be > 0 ? ((re - be) / be) * 100 : 0) : null;
  return {
    id: b.id,
    headCode: b.majorHead,
    description: b.subHead ?? b.majorHead,
    budgetEstimate: be,
    revisedEstimate: re,
    variancePct,
    status: !bothKnown ? "unknown" : re > be ? "increased" : re < be ? "decreased" : "no_change",
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
      {/* UX-002: the data-source badge now lives in RevisedEstimatesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here. */}
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
