import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getLocationsTyped } from "../_data";
import { LocationActions } from "./LocationActions";
import { LocationsListTable } from "./LocationsListTable";

export const dynamic = "force-dynamic";

// Mirrors location-service's write gate (LOCATION_ROLES in
// services/location-service/src/modules/locations/routes.ts): POST /v1/locations
// and PATCH /v1/locations/:id/archive. The service stays the authority; this only
// stops the form and the archive buttons showing to roles that would get a 403.
const LOCATION_MANAGE_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];

export default async function Page() {
  const t = await getTranslations("locationsList");
  const result = await getLocationsTyped();
  const canManage = getSessionRoles().some((r) => LOCATION_MANAGE_ROLES.includes(r));
  return (
    <div className="page-main">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t.rich("pageDescription", { link: (chunks) => <Link href="/setup">{chunks}</Link> })}
        back="/locations"
      />
      {/* A failed load must read as a failure, never as an empty register. */}
      {result.source === "error" ? (
        <LoadErrorState result={result} area={t("area")} backHref="/locations" />
      ) : (
        <>
          <DataSourceBadge source="api" />
          {canManage ? <LocationActions rows={result.data.map((r) => ({ id: r.id, label: r.name, status: r.status }))} /> : null}
          <LocationsListTable rows={result.data} canManage={canManage} />
        </>
      )}
    </div>
  );
}
