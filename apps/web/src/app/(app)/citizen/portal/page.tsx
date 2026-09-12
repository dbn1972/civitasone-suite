import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenPortal } from "../../../_data/loaders";

export default async function CitizenPortalPage() {
  const t = await getTranslations("citizenPortal");
  const { data: metrics, source } = await getCitizenPortal();

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard
          icon="🗂️"
          iconBg="#eef2ff"
          label={t("statPublishedServices")}
          value={metrics.totalServices.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📋"
          iconBg="#ecfdf3"
          label={t("statActiveRequests")}
          value={metrics.activeRequests.toLocaleString("en-IN")}
        />
        <StatCard
          icon="✅"
          iconBg="#fffaeb"
          label={t("statResolvedThisMonth")}
          value={metrics.resolvedThisMonth.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⏱️"
          iconBg="#fce7ee"
          label={t("statAvgResolutionDays")}
          value={metrics.avgResolutionDays.toLocaleString("en-IN")}
        />
      </StatGrid>
    </>
  );
}
