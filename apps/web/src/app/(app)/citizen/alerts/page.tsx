import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenAlerts } from "../../../_data/loaders";
import { AlertsTable } from "./AlertsTable";

export default async function AlertsPage() {
  const t = await getTranslations("citizenAlerts");
  const { data: alerts, source } = await getCitizenAlerts();

  const active = alerts.filter((a) => a.status === "Active").length;
  const expired = alerts.filter((a) => a.status === "Expired").length;
  const drafts = alerts.filter((a) => a.status === "Draft").length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="🔔" iconBg="#eef2ff" label={t("statActive")} value={active} />
        <StatCard icon="📤" iconBg="#ecfdf3" label={t("statTotal")} value={alerts.length} />
        <StatCard icon="⏰" iconBg="#fffaeb" label={t("statExpired")} value={expired} />
        <StatCard icon="📝" iconBg="#fce7ee" label={t("statDrafts")} value={drafts} />
      </StatGrid>

      <AlertsTable alerts={alerts} source={source} />
    </>
  );
}
