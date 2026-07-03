import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";

const ALLOWED = ["audit_officer", "audit_admin", "platform_admin", "super_admin", "finance_admin", "dept_head"];

export default function AuditLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <ModuleGate moduleKey="audit">{children}</ModuleGate>;
}
