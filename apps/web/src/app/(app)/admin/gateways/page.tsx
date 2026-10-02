import Link from "next/link";
import { PageHeader } from "@/app/_components/ds";
import { getSAGateways } from "@/app/_data/loaders";
import { GatewaysTable } from "./GatewaysTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function GatewaysPage() {
  // GAP-ADMIN-GATEWAYS-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Communication Gateways" area="communication gateways" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: gateways, source, status } = await getSAGateways();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-ADMIN-GATEWAYS-02/03: stats, provenance badge, error state and table all live in
          GatewaysTable, fed by ONE useSeededResource call. */}
      {/* GAP-ADMIN-GATEWAYS-06: the two API-gateway links are page actions (client-side nav), and
          the subtitle says which "gateway" this page is about. */}
      <PageHeader
        title="Communication Gateways"
        subtitle="SMS, email, WhatsApp and push notification gateway status. This is not the API gateway: its edge config and route catalogue are linked in the page header."
        back="/admin"
        actions={
          <>
            <Link href="/admin/gateway-config" className="btn ghost">API gateway: edge config</Link>
            <Link href="/admin/gateway-routes" className="btn ghost">API gateway: route catalogue</Link>
          </>
        }
      />
      <GatewaysTable gateways={gateways} source={source === "error" ? "error" : "api"} unavailable={status === 404 || status === 501} />
    </div>
  );
}
