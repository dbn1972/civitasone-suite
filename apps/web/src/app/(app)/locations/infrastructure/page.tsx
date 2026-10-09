import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLocationInfrastructureTyped } from "../_data";
import { InfrastructureTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getLocationInfrastructureTyped();
  const t = await getTranslations("locationsOps");
  return (
    <div className="page-main">
      <PageHeader
        title={t("infra.pageTitle")}
        subtitle={t("infra.pageSubtitle")}
        back="/locations"
        backLabel={t("backLabel")}
      />
      {/* A failed load must read as a failure, never as an empty data set. */}
      {result.source === "error" ? (
        <LoadErrorState result={result} area={t("infra.area")} backHref="/locations" backLabel={t("backLabel")} />
      ) : (
        <>
          <DataSourceBadge source="api" />
          <InfrastructureTable rows={result.data} />
        </>
      )}
    </div>
  );
}
