import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole } from "@/lib/auth/roleGuard";

const HR_ROLES = ["super_admin", "hr_admin", "hr_officer", "manager"];

export default function HrLayout({ children }: { children: ReactNode }) {
  requireAnyRole(HR_ROLES);
  return <ModuleGate moduleKey="hrms">{children}</ModuleGate>;
}
