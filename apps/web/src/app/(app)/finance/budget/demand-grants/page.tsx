import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDemandGrants } from "@/app/_data/loaders";
import { DemandGrantsTable } from "./DemandGrantsTable";

export default async function DemandGrantsPage() {
  const { data: grants, source } = await getFinanceDemandGrants();
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
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Demands" value={grants.length} />
        <StatCard icon="🗳️" iconBg="#ecfdf3" label="Voted" value={voted} />
        <StatCard icon="⚖️" iconBg="#fffaeb" label="Charged" value={charged} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Services" value={new Set(grants.map((g) => g.service)).size} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside DemandGrantsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="Demand for Grants">
        <DemandGrantsTable grants={grants} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
