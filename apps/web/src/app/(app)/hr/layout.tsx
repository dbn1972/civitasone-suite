import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";

/** Roles permitted to access any HR/Payroll page. Regular employees use self-service routes only. */
const HR_ROLES = ["hr_admin", "hr_officer", "payroll_officer", "payroll_admin", "tenant_admin", "platform_admin", "super_admin"];

export default function HrLayout({ children }: { children: ReactNode }) {
  requireAnyRole(HR_ROLES);
  return <ModuleGate moduleKey="hrms">{children}</ModuleGate>;
}
