import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ACCOUNT_COMPILE_ROLES } from "@/lib/auth/workRoles";

/**
 * GAP-WORKS-BILLING-ACCOUNT-COMPILE-02: account compile submits the monthly
 * expenditure statement to treasury — a DAO/DO-only action. The page is a
 * client component with no role check, so any user who opened the URL got a
 * fully-wired, live form and only learned of the 403 after submitting. This
 * server-component layout gates the whole route with requireAnyRole, mirroring
 * works-service billing/routes.ts (POST /account-compile requires
 * ["dao","do","works_admin","super_admin"]). The server remains the authority;
 * this is defence-in-depth + honest UX (redirect instead of a doomed form).
 */
export default function AccountCompileLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ACCOUNT_COMPILE_ROLES, "/works/billing");
  return <>{children}</>;
}
