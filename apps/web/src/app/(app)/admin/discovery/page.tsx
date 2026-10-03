import { getAdminDiscovery } from "@/app/_data/loaders";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { DiscoveryRegistry } from "./DiscoveryRegistry";

// GAP-ADMIN-DISCOVERY-02: this used to be an honest "coming soon" placeholder because no
// registry existed. admin-service now serves the registered services with their last-known
// health (GET /v1/admin/discovery/services, platform staff only), and "Scan now" re-probes.
export default async function AdminDiscoveryPage() {
  // GAP-ADMIN-DISCOVERY-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Service Discovery" area="service discovery" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const res = await getAdminDiscovery();
  return <DiscoveryRegistry initial={res.data} source={res.source === "error" ? "error" : "api"} errorStatus={res.status} />;
}
