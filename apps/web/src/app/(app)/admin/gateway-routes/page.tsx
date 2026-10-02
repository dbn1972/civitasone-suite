import { PageHeader } from "@/app/_components/ds";
import { getGatewayCatalogue } from "./_data";
import { GatewayRoutesTable } from "./GatewayRoutesTable";
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
      {/* GAP-ADMIN-GATEWAY-ROUTES-04: PageHeader back (client-side nav) replaces the bespoke breadcrumb. */}
      <PageHeader
        title="Gateway — Route catalogue"
        subtitle="API gateway proxy catalogue entries from gateway-service."
        back="/admin"
        backLabel="Admin"
      />
      <GatewayRoutesTable routes={data} source={source === "error" ? "error" : "api"} />
    </div>
  );
}
