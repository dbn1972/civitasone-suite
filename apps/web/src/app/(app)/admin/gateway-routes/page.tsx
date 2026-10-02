import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getGatewayCatalogue } from "./_data";
import { ArrowLeft } from "lucide-react";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { API_CATALOGUE_ROLES } from "@/lib/auth/adminRoles";

export const dynamic = "force-dynamic";

export default async function Page() {
  // GAP-ADMIN-GATEWAY-ROUTES-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(API_CATALOGUE_ROLES)) {
    return <AdminAccessDenied title="Gateway — Route catalogue" area="the gateway route catalogue" roles={API_CATALOGUE_ROLES} />;
  }
  const { data, source } = await getGatewayCatalogue();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/admin">Admin</a>
      </nav>
      <ModuleListPage
        title="Gateway — Route catalogue"
        description="API gateway proxy catalogue entries from gateway-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
