import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getInvestigations } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { InvestigationTable } from "./InvestigationTable";

export default async function InvestigationPage() {
  const result = await getInvestigations();
  const { data: investigations, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const active = errored ? null : investigations.filter((i) => i.status === "in_progress").length;
  const findingsSubmitted = errored ? null : investigations.filter((i) => i.status === "findings_submitted").length;
  const closed = errored ? null : investigations.filter((i) => i.status === "closed").length;
  const total = errored ? null : investigations.length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Investigation Tracker"
        subtitle="Internal investigations with assignment, findings and resolution status."
        back="/audit"
      />

      <StatGrid>
        <StatCard icon="🕵️" iconBg="#eef2ff" label="Active Investigations" value={active ?? "—"} />
        <StatCard icon="📄" iconBg="var(--goodbg)" label="Findings Submitted" value={findingsSubmitted ?? "—"} />
        <StatCard icon="✅" iconBg="var(--warnbg)" label="Closed" value={closed ?? "—"} />
        <StatCard icon="📊" iconBg="#fce7ee" label="Total Cases" value={total ?? "—"} />
      </StatGrid>

      {errored ? (
        <Card title="Investigation Cases">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "investigation cases" })} backHref="/audit" />
          </div>
        </Card>
      ) : investigations.length === 0 ? (
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
