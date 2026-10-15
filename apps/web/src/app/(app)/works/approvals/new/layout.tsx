import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { AA_CREATE_ROLES } from "@/lib/auth/workRoles";

/**
 * GAP-WORKS-APPROVALS-05: only AA_CREATE_ROLES may create an AA (works-service WRITE_ROLES). Without this layout the
 * form opened by direct URL for any user, who only met the 403 after submitting.
 */
export default function NewAaLayout({ children }: { children: ReactNode }) {
  requireAnyRole(AA_CREATE_ROLES, "/works/approvals");
  return <>{children}</>;
}
