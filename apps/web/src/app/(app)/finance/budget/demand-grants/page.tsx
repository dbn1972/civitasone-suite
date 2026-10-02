import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { getFinanceDemandGrants } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { DemandGrantsTable } from "./DemandGrantsTable";

export default async function DemandGrantsPage() {
  const result = await getFinanceDemandGrants();
  const { data: grants } = result;
  // GAP-FINANCE-BUDGET-DEMAND-GRANTS-01: a failed fetch must not read as
  // "0 demands" -- cards show "—" and the table becomes a Retry state.
  const errored = toResourceState(result).status === "error";
  // budget.finance_demands calls this column "class" (voted|charged), not "type".
  const voted = grants.filter((g) => String(g.class).toLowerCase() === "voted").length;
  const charged = grants.filter((g) => String(g.class).toLowerCase() === "charged").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Demand for Grants"
        subtitle="Parliamentary demand for grants with voted/charged breakup."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Demands" value={errored ? "—" : grants.length} />
        <StatCard icon="🗳️" iconBg="#ecfdf3" label="Voted" value={errored ? "—" : voted} />
        <StatCard icon="⚖️" iconBg="#fffaeb" label="Charged" value={errored ? "—" : charged} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Services" value={errored ? "—" : new Set(grants.map((g) => g.service)).size} />
      </StatGrid>
      {/* UX-012: the data-source badge lives inside DemandGrantsTable. */}
      <Card title="Demand for Grants">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "demand for grants" })} backHref="/finance" />
          </div>
        ) : (
          <DemandGrantsTable grants={grants} source="api" />
        )}
      </Card>
    </div>
  );
}
