import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { CRM_ROLES } from "@/lib/auth/navRoles";
import { ModuleGate } from "../ModuleGate";

// GAP2-CRM-LAYOUT-01: the module gate must match the crm-service role
// vocabulary. tenant_admin IS a CRM role (accepted by 40+ crm-service routes:
// products, service-requests, quotations, control-tower, dashboards …) so it is
// admitted here to make those screens reachable. platform_admin is accepted by
// NO crm-service read/write route, so admitting it here produced a user who
// passed the module gate yet got 403 on every CRM read and write — the module
// read as broken. It is removed so the gate and the server agree (fail closed).

export default function CrmLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ROLES);
  return <ModuleGate moduleKey="crm">{children}</ModuleGate>;
}
