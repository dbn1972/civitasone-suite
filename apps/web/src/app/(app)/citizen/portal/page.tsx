import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenPortal } from "../../../_data/loaders";

export default async function CitizenPortalPage() {
  const t = await getTranslations("citizenPortal");
  const { data: metrics, source } = await getCitizenPortal();
  // UX-013: `source` was already fetched but only wired to the badge below
  // -- never to the stat values, so a failed load rendered raw zeroes. Gate
  // every stat on it, same convention as projects/dashboard and
  // estab/dashboard.
  const errored = source === "error";

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
          value={errored ? "—" : metrics.totalServices.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📋"
          iconBg="#ecfdf3"
          label={t("statActiveRequests")}
          value={errored ? "—" : metrics.activeRequests.toLocaleString("en-IN")}
        />
        <StatCard
          icon="✅"
          iconBg="#fffaeb"
          label={t("statResolvedThisMonth")}
          value={errored ? "—" : metrics.resolvedThisMonth.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⏱️"
          iconBg="#fce7ee"
          label={t("statAvgResolutionDays")}
          value={errored ? "—" : metrics.avgResolutionDays.toLocaleString("en-IN")}
        />
      </StatGrid>
    </>
  );
}
