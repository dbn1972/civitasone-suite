import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getAssetLinkOptions, getLocationInfrastructureTyped } from "../_data";
import { INFRASTRUCTURE_MANAGE_ROLES } from "../_roles";
import { InfrastructureCreateForm } from "./InfrastructureActions";
import { InfrastructureTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const canManage = getSessionRoles().some((r) => INFRASTRUCTURE_MANAGE_ROLES.includes(r));
  const [result, assets] = await Promise.all([
    getLocationInfrastructureTyped(),
    // Only managers get the form; if the asset register cannot be read the link picker is simply left out.
    canManage ? getAssetLinkOptions() : Promise.resolve(null),
  ]);
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
          {canManage ? <InfrastructureCreateForm assetOptions={assets && assets.source !== "error" ? assets.data : []} /> : null}
          <InfrastructureTable rows={result.data} />
        </>
      )}
    </div>
  );
}
