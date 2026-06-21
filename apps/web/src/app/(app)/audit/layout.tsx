import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

const ALLOWED = ["audit_officer", "audit_admin", "platform_admin", "super_admin", "finance_admin", "dept_head"];

export default function AuditLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <>{children}</>;
}
