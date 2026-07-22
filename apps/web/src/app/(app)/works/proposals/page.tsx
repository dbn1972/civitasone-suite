import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { ProposalsTable } from "./ProposalsTable";

type ApiProposal = Record<string, unknown>;

async function getProposals() {
  return fetchJson<unknown, ApiProposal[]>("/api/v1/works/proposals", [], {
    telemetryKey: "works.proposals",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiProposal[] })?.data;
      return Array.isArray(arr) ? (arr as ApiProposal[]) : null;
    },
  });
}

export default async function ProposalsPage() {
  const { data: proposals, source } = await getProposals();

  const total = proposals.length;
  const draft = proposals.filter((p) => String(p.status ?? "").toLowerCase() === "draft").length;
  const daoFinalized = proposals.filter((p) => String(p.status ?? "").toLowerCase() === "dao_finalized").length;
  const tsEligible = proposals.filter((p) => String(p.status ?? "").toLowerCase() === "ts_eligible").length;

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
