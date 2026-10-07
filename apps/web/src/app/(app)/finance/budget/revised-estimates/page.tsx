import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceBudgets } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { FyFilter } from "../../_components/FyFilter";
import { RevisedEstimatesTable, type RevisedEstimateRow, type RevisionStatus } from "./RevisedEstimatesTable";
import { isMaterialVariance, MATERIAL_VARIANCE_BPS, parseMinor, varianceBps } from "../_lib/budgetColumns";

// getFinanceRevisedEstimates() used to hit /api/v1/finance/budgets/revised-estimates,
// which has never existed as a backend route. Budget Estimate (beMinor) and Revised
// Estimate (reMinor) are real columns on the same budget row getFinanceBudgets()
// already reads — this derives the BE-vs-RE view from that real data instead.
function toRow(b: Awaited<ReturnType<typeof getFinanceBudgets>>["data"][number]): { row: RevisedEstimateRow; bps: bigint | null } {
  // UX-006: a missing/unparseable beMinor must stay "missing" (null), never a
  // fabricated 0. GAP-FINANCE-BUDGET-REVISED-ESTIMATES-02: BE/RE stay exact paise
  // BigInts end to end -- the variance is integer basis points, no float rupees.
  const be = parseMinor(b.beMinor);
  const re = parseMinor(b.reMinor);
  const bps = varianceBps(be, re);
  const status: RevisionStatus = be === null || re === null ? "unknown" : re > be ? "increased" : re < be ? "decreased" : "no_change";
  const row: RevisedEstimateRow = {
    id: b.id,
    headCode: b.majorHead,
    description: b.subHead ?? b.majorHead,
    financialYear: b.financialYear,
    budgetEstimateMinor: be === null ? null : be.toString(),
    revisedEstimateMinor: re === null ? null : re.toString(),
    varianceBps: bps === null ? null : Number(bps),
    status,
    material: isMaterialVariance(bps),
  };
  return { row, bps };
}

/**
 * Largest revisions first by |variance|, compared as BigInt (no float on the
 * sort key); equal magnitudes put the increase before the decrease; rows with
 * no variance last, then by head code for a stable order.
 */
function byAbsVarianceDesc(a: { row: RevisedEstimateRow; bps: bigint | null }, b: { row: RevisedEstimateRow; bps: bigint | null }): number {
  if (a.bps === null || b.bps === null) {
    if (a.bps === b.bps) return a.row.headCode.localeCompare(b.row.headCode);
    return a.bps === null ? 1 : -1;
  }
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const ma = abs(a.bps);
  const mb = abs(b.bps);
  if (ma !== mb) return ma > mb ? -1 : 1;
  if (a.bps !== b.bps) return a.bps > b.bps ? -1 : 1;
  return a.row.headCode.localeCompare(b.row.headCode);
}

export default async function RevisedEstimatesPage({
  searchParams,
}: {
  searchParams?: { fy?: string };
}) {
  // GAP-FINANCE-BUDGET-REVISED-ESTIMATES-01: one row per head for ONE fiscal
  // year. The FY comes from the FyFilter (?fy=), validated, default current FY;
  // before, every FY's row for a head was listed together with no FY column.
  const fy =
    typeof searchParams?.fy === "string" && isValidFinancialYearLabel(searchParams.fy)
      ? searchParams.fy
      : currentFinancialYear();
  const result = await getFinanceBudgets();
  const { source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const estimates = result.data.filter((b) => b.financialYear === fy).map(toRow).sort(byAbsVarianceDesc).map((x) => x.row);
  const increased = errored ? null : estimates.filter((e) => e.status === "increased").length;
  const decreased = errored ? null : estimates.filter((e) => e.status === "decreased").length;
  const material = errored ? null : estimates.filter((e) => e.material).length;
  const total = errored ? null : estimates.length;

  return (
    <div className="page-main wrap">
      {/* UX-002: the data-source badge now lives in RevisedEstimatesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here. */}
      <PageHeader
        title="Revised Estimates"
        subtitle={`Budget Estimate vs Revised Estimate with variance analysis by head — FY ${fy}.`}
        back="/finance"
        actions={<FyFilter />}
      />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Total Heads" value={total ?? "—"} />
        {/* Neutral tones: a raised RE is not inherently good (REVISED-ESTIMATES-04). */}
        <StatCard icon="📈" iconBg="var(--panel)" label="Increased" value={increased ?? "—"} />
        <StatCard icon="📉" iconBg="var(--panel)" label="Decreased" value={decreased ?? "—"} />
        <StatCard icon="➖" iconBg="#fffaeb" label="No Change" value={total === null || increased === null || decreased === null ? "—" : total - increased - decreased} />
        <StatCard icon="◆" iconBg="#fef3f2" label={`Material variance (≥${Number(MATERIAL_VARIANCE_BPS) / 100}%)`} value={material ?? "—"} />
      </StatGrid>
      <Card title="BE vs RE Variance">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "revised estimates" })} backHref="/finance" />
          </div>
        ) : (
          <RevisedEstimatesTable estimates={estimates} source={source} fy={fy} />
        )}
      </Card>
    </div>
  );
}
