import { ModuleListPage } from "../../../_components/ModuleListPage";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getSessionRoles, INSTALL_SILO_READ_ROLES } from "@/lib/auth/roleGuard";
import { getInstallSilos } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  // GAP-INSTALL-SILOS-04: forbidden state BEFORE any fetch, using the exact
  // role set install-service enforces on GET /v1/install/silo-provisions.
  const roles = getSessionRoles();
  if (!INSTALL_SILO_READ_ROLES.some((r) => roles.includes(r))) {
    return (
      <div className="page-main">
        <PermissionDenied backHref="/install/console" backLabel="Install console" />
      </div>
    );
  }
  const { data, source } = await getInstallSilos();
  return (
    <div className="page-main">
      {/* GAP-INSTALL-SILOS-05: removed the duplicate local Breadcrumb landmark;
          the global AutoBreadcrumb supplies Home / Install / Silo Provisions. */}
      <ModuleListPage
        title="Silo provisions"
        description="Silo provision records."
        rows={data}
        source={source}
        back="/install/console"
        backLabel="Install console"
        errorArea="silo provisions"
        showId={false}
      />
    </div>
  );
}
