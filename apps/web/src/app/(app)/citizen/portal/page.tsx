import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { getCitizenPortal } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";

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
          href="/citizen/catalogue"
          value={errored ? "—" : metrics.totalServices.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📋"
          iconBg="#ecfdf3"
          label={t("statActiveRequests")}
          href="/citizen/requests"
          value={errored ? "—" : metrics.activeRequests.toLocaleString("en-IN")}
        />
        <StatCard
          icon="✅"
          iconBg="#fffaeb"
          label={t("statResolvedThisMonth")}
          href="/citizen/requests"
          value={errored ? "—" : metrics.resolvedThisMonth.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⏱️"
          iconBg="#fce7ee"
          label={t("statAvgResolutionDays")}
          value={errored ? "—" : metrics.avgResolutionDays.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
        />
      </StatGrid>

      {/* GAP-CITIZEN-PORTAL-02: on a failed load, offer a real retry (not just
          the amber badge), mirroring the other citizen pages. */}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "citizen portal metrics" })} backHref="/citizen" />
      ) : null}
    </>
  );
}
