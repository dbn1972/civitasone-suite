import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { AUDIT_ROLES } from "@/lib/auth/navRoles";
import { ModuleGate } from "../ModuleGate";


export default function AuditLayout({ children }: { children: ReactNode }) {
  requireAnyRole(AUDIT_ROLES);
  return <ModuleGate moduleKey="audit">{children}</ModuleGate>;
}
