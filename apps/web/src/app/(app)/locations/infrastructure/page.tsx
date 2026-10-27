import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getLocationInfrastructureTyped } from "../_data";
import { INFRASTRUCTURE_MANAGE_ROLES } from "../_roles";
import { InfrastructureCreateForm } from "./InfrastructureActions";
import { InfrastructureTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getLocationInfrastructureTyped();
  const t = await getTranslations("locationsOps");
  const canManage = getSessionRoles().some((r) => INFRASTRUCTURE_MANAGE_ROLES.includes(r));
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
          {canManage ? <InfrastructureCreateForm /> : null}
          <InfrastructureTable rows={result.data} />
        </>
      )}
    </div>
  );
}
