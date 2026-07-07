import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getInvestigations } from "@/app/_data/loaders";
import { InvestigationTable } from "./InvestigationTable";

export default async function InvestigationPage() {
  const { data: investigations, source } = await getInvestigations();

  const active = investigations.filter((i) => i.status === "in_progress").length;
  const findingsSubmitted = investigations.filter((i) => i.status === "findings_submitted").length;
  const closed = investigations.filter((i) => i.status === "closed").length;
  const total = investigations.length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Investigation Tracker"
        subtitle="Internal investigations with assignment, findings and resolution status."
        back="/audit"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🕵️" iconBg="#eef2ff" label="Active Investigations" value={active} />
        <StatCard icon="📄" iconBg="#ecfdf3" label="Findings Submitted" value={findingsSubmitted} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Closed" value={closed} />
        <StatCard icon="📊" iconBg="#fce7ee" label="Total Cases" value={total} />
      </StatGrid>

      {investigations.length === 0 ? (
        <Card title="Investigation Cases">
          <EmptyState
            icon="🕵️"
            title="No investigations found"
            message="Internal investigation cases will appear here once initiated by the audit team."
          />
        </Card>
      ) : (
        <Card title="Investigation Cases">
          <InvestigationTable rows={investigations} source={source} />
        </Card>
      )}
    </main>
  );
}
