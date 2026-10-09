import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLocationGeofencesTyped } from "../_data";
import { GeofencesTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getLocationGeofencesTyped();
  const t = await getTranslations("locationsOps");
  return (
    <div className="page-main">
      <PageHeader
        title={t("geofences.pageTitle")}
        subtitle={t("geofences.pageSubtitle")}
        back="/locations"
        backLabel={t("backLabel")}
      />
      {/* A failed load must read as a failure, never as an empty data set. */}
      {result.source === "error" ? (
        <LoadErrorState result={result} area={t("geofences.area")} backHref="/locations" backLabel={t("backLabel")} />
      ) : (
        <>
          <DataSourceBadge source="api" />
          <GeofencesTable rows={result.data} />
        </>
      )}
    </div>
  );
}
