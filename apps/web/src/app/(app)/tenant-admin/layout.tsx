import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

const ALLOWED = ["tenant_admin", "platform_admin", "super_admin"];

export default function TenantAdminLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED);
  return <>{children}</>;
}
