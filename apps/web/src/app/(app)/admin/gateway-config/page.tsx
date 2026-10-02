import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { GatewayConfigClient } from "./GatewayConfigClient";

// GAP-ADMIN-GATEWAY-CONFIG-03: edge auth / rate limits for the whole
// platform -- platform operators only (admin-service
// GET/PATCH /v1/admin/platform-config/gateway is platform_admin/super_admin).
// The interactive screen is a client component, so the role check lives in
// this server wrapper.
export default function GatewayConfigPage() {
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="API Gateway Configuration" area="gateway configuration" roles={PLATFORM_ADMIN_ROLES} />;
  }
  return <GatewayConfigClient />;
}
