import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceDemandGrants } from "@/app/_data/loaders";
import { DemandGrantsTable } from "./DemandGrantsTable";

export default async function DemandGrantsPage() {
  const { data: grants, source } = await getFinanceDemandGrants();
  const voted = grants.filter((g) => String(g.type).toLowerCase() === "voted").length;
  const charged = grants.filter((g) => String(g.type).toLowerCase() === "charged").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Demand for Grants"
        subtitle="Parliamentary demand for grants with voted/charged breakup."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Demands" value={grants.length} />
        <StatCard icon="🗳️" iconBg="#ecfdf3" label="Voted" value={voted} />
        <StatCard icon="⚖️" iconBg="#fffaeb" label="Charged" value={charged} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Ministries" value={new Set(grants.map((g) => String(g.ministry ?? ""))).size} />
      </StatGrid>
      <Card title="Demand for Grants">
        <DemandGrantsTable grants={grants} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
