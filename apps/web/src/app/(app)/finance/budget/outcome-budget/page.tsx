import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceOutcomeBudget } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { OutcomeBudgetTable } from "./OutcomeBudgetTable";
import { classifyOutcomes } from "../_lib/outcomeStats";

export default async function OutcomeBudgetPage() {
  const result = await getFinanceOutcomeBudget();
  const { data: outcomes } = result;
  // GAP-FINANCE-BUDGET-OUTCOME-BUDGET-01: errored -> "—" cards + Retry state.
  const errored = toResourceState(result).status === "error";
  // achievementBps is basis points (10000 = 100%). Each outcome lands in exactly one
  // bucket; a missing measurement is "not measured", not "not started" (OUTCOME-BUDGET-03).
  const { achieved, inProgress, notStarted, notMeasured } = classifyOutcomes(outcomes);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Outcome Budget"
        subtitle="Scheme output indicators and achievement tracking."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label="Total Indicators" value={errored ? "—" : outcomes.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Achieved" value={errored ? "—" : achieved} />
        <StatCard icon="📈" iconBg="#fffaeb" label="In Progress" value={errored ? "—" : inProgress} />
        <StatCard icon="⏳" iconBg="#eff6ff" label="Not Started" value={errored ? "—" : notStarted} />
        {!errored && notMeasured > 0 ? <StatCard icon="❔" iconBg="var(--panel)" label="Not Measured" value={notMeasured} /> : null}
      </StatGrid>
      {/* UX-012: the data-source badge lives inside OutcomeBudgetTable. */}
      <Card title="Outcome Indicators">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "outcome budget" })} backHref="/finance" />
          </div>
        ) : (
          <OutcomeBudgetTable outcomes={outcomes} source="api" />
        )}
      </Card>
    </div>
  );
}
