import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";

const CRM_ROLES = ["crm_user", "crm_admin", "platform_admin", "super_admin"];

export default function CrmLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ROLES);
  return <ModuleGate moduleKey="crm">{children}</ModuleGate>;
}
