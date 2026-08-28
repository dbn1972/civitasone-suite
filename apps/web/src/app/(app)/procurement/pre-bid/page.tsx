import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementPreBid } from "../../../_data/loaders";
import { PreBidTable } from "./PreBidTable";

export default async function PreBidPage() {
  const { data: conferences, source } = await getProcurementPreBid();

  const completed = conferences.filter((c) => c.status === "Completed").length;
  const scheduled = conferences.filter((c) => c.status === "Scheduled").length;
  const totalQueries = conferences.reduce((sum, c) => sum + c.queriesRaised, 0);
  const totalResponses = conferences.reduce((sum, c) => sum + c.responses, 0);

  return (
    <>
      <PageHeader
        title="Pre-Bid Conferences"
        subtitle="Pre-bid meetings, queries and response tracking for open tenders."
        actions={source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
      />

      <StatGrid>
        <StatCard icon="🎤" iconBg="#eef2ff" label="Conferences Held" value={completed} />
        <StatCard icon="❓" iconBg="#ecfdf3" label="Total Queries" value={totalQueries} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Responded" value={totalResponses} />
        <StatCard icon="📅" iconBg="#fce7ee" label="Scheduled" value={scheduled} />
      </StatGrid>

      <PreBidTable conferences={conferences} source={source} />
    </>
  );
}
