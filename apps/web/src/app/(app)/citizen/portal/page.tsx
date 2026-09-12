import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenPortal } from "../../../_data/loaders";

export default async function CitizenPortalPage() {
  const { data: metrics, source } = await getCitizenPortal();

  return (
    <>
      <PageHeader
        title="Citizen Portal Overview"
        subtitle="Key metrics and performance indicators for citizen engagement."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard
          icon="🗂️"
          iconBg="#eef2ff"
          label="Published Services"
          value={metrics.totalServices.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📋"
          iconBg="#ecfdf3"
          label="Active Requests"
          value={metrics.activeRequests.toLocaleString("en-IN")}
        />
        <StatCard
          icon="✅"
          iconBg="#fffaeb"
          label="Resolved This Month"
          value={metrics.resolvedThisMonth.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⏱️"
          iconBg="#fce7ee"
          label="Avg. Resolution Days"
          value={metrics.avgResolutionDays.toLocaleString("en-IN")}
        />
      </StatGrid>
    </>
  );
}
