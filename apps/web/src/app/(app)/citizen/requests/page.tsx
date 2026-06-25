import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCitizenRequests } from "../../../_data/loaders";
import { CitizenRequestsClient } from "./CitizenRequestsClient";
import { LogRequestButton } from "./LogRequestButton";

export default async function Page() {
  const { data: requests, source } = await getCitizenRequests();

  const open = requests.filter((r) => r.status === "submitted" || r.status === "under_review" || r.status === "in_progress").length;
  const resolved = requests.filter((r) => r.status === "resolved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;

  return (
    <>
      <PageHeader
        title="Citizen Service Requests"
        subtitle="Grievances and service requests with SLA &amp; routing."
        actions={<LogRequestButton />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📨" iconBg="#e0f5fa" label="Open" value={open.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Rejected" value={rejected.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved (MTD)" value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Total" value={requests.length.toLocaleString("en-IN")} />
      </StatGrid>
      <CitizenRequestsClient requests={requests} />
    </>
  );
}
