import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenPortal } from "../../../_data/loaders";
import { PortalTable } from "./PortalTable";

export default async function CitizenPortalPage() {
  const { data: metrics, source } = await getCitizenPortal();

  const onTrack = metrics.filter((m) => m.status === "On Track").length;
  const improved = metrics.filter((m) => m.status === "Improved").length;

  return (
    <>
      <PageHeader
        title="Citizen Portal Overview"
        subtitle="Key metrics and performance indicators for citizen engagement."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="#eef2ff" label="Registered Citizens" value="1,24,580" />
        <StatCard icon="📋" iconBg="#ecfdf3" label="Active Requests" value="2,341" />
        <StatCard icon="📈" iconBg="#fffaeb" label="On Track" value={onTrack} />
        <StatCard icon="🔼" iconBg="#fce7ee" label="Improved" value={improved} />
      </StatGrid>

      <PortalTable metrics={metrics} source={source} />
    </>
  );
}
