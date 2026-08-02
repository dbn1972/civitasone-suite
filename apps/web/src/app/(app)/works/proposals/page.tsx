import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getProposals } from "../_data/loaders";
import { ProposalsTable } from "./ProposalsTable";

export default async function ProposalsPage() {
  const { data: proposals, source } = await getProposals();

  const total = proposals.length;
  const draft = proposals.filter((p) => p.status === "draft").length;
  const daoFinalized = proposals.filter((p) => p.status === "dao_finalized").length;
  const tsEligible = proposals.filter((p) => p.status === "ts_eligible").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Work Proposals"
        subtitle="Work registration, categorization, and proposal lifecycle."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Works" value={total} />
        <StatCard icon="📝" iconBg="#fffaeb" label="Draft" value={draft} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="DAO Finalized" value={daoFinalized} />
        <StatCard icon="📑" iconBg="#f0fdf4" label="TS Eligible" value={tsEligible} />
      </StatGrid>
      <Card title="Work Proposals">
        <ProposalsTable proposals={proposals} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
