import { getTranslations } from "next-intl/server";
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
      {/* UX-012: the data-source badge now lives inside AlertsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
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
