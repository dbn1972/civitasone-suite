import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenAlerts } from "../../../_data/loaders";
import { AlertsTable } from "./AlertsTable";

export default async function AlertsPage() {
  const { data: alerts, source } = await getCitizenAlerts();

  const active = alerts.filter((a) => a.status === "Active").length;
  const expired = alerts.filter((a) => a.status === "Expired").length;
  const drafts = alerts.filter((a) => a.status === "Draft").length;

  return (
    <>
      <PageHeader
        title="Public Alerts & Notifications"
        subtitle="Broadcast alerts and targeted notifications for citizens."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="🔔" iconBg="#eef2ff" label="Active Alerts" value={active} />
        <StatCard icon="📤" iconBg="#ecfdf3" label="Total Published" value={alerts.length} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expired" value={expired} />
        <StatCard icon="📝" iconBg="#fce7ee" label="Drafts" value={drafts} />
      </StatGrid>

      <AlertsTable alerts={alerts} source={source} />
    </>
  );
}
