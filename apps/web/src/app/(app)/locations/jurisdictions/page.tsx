import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLocationJurisdictionsTyped } from "../_data";
import { JurisdictionsTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getLocationJurisdictionsTyped();
  const t = await getTranslations("locationsOps");
  return (
    <div className="page-main">
      <PageHeader
        title={t("jurisdictions.pageTitle")}
        subtitle={t("jurisdictions.pageSubtitle")}
        back="/locations"
        backLabel={t("backLabel")}
      />
      {/* A failed load must read as a failure, never as an empty data set. */}
      {result.source === "error" ? (
        <LoadErrorState result={result} area={t("jurisdictions.area")} backHref="/locations" backLabel={t("backLabel")} />
      ) : (
        <>
          <DataSourceBadge source="api" />
          <JurisdictionsTable rows={result.data} />
        </>
      )}
    </div>
  );
}
