import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getJurisdictionFormOptions, getLocationJurisdictionsTyped } from "../_data";
import { JURISDICTION_MANAGE_ROLES } from "../_roles";
import { JurisdictionAssignForm } from "./JurisdictionActions";
import { JurisdictionsTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const canManage = getSessionRoles().some((r) => JURISDICTION_MANAGE_ROLES.includes(r));
  const [result, options] = await Promise.all([
    getLocationJurisdictionsTyped(),
    canManage ? getJurisdictionFormOptions() : Promise.resolve(null),
  ]);
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
          {canManage && options ? (
            options.source === "error" ? (
              <p role="alert" style={{ margin: "0 0 12px" }}>{t("jurisdictions.optionsFailed")}</p>
            ) : (
              <JurisdictionAssignForm offices={options.data.offices} units={options.data.units} />
            )
          ) : null}
          <JurisdictionsTable rows={result.data} canManage={canManage} />
        </>
      )}
    </div>
  );
}
