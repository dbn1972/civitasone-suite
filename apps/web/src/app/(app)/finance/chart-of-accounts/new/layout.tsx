import type { ReactNode } from "react";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ACCOUNT_HEAD_WRITE_ROLES } from "@/lib/auth/workRoles";
import { PermissionDenied } from "@/app/_components/PermissionDenied";

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-05: the add / map form is for the roles finance-service lets POST /v1/finance/accounts
 * and PATCH /v1/finance/accounts/:id/hoa (budget/routes.ts FINANCE_ROLES). Every other finance role can read the
 * chart, so on a typed-in or bookmarked URL they get the same "access restricted" card a 403 would give, instead of a
 * form that only refuses after it has been filled in. Advisory only: finance-service enforces the real boundary.
 */
export default function AddHeadLayout({ children }: { children: ReactNode }) {
  const canWrite = getSessionRoles().some((r) => (ACCOUNT_HEAD_WRITE_ROLES as readonly string[]).includes(r));
  if (!canWrite) {
    return <PermissionDenied module="finance" requiredRoles={[...ACCOUNT_HEAD_WRITE_ROLES]} backHref="/finance/chart-of-accounts" backLabel="Chart of Accounts" />;
  }
  return <>{children}</>;
}
