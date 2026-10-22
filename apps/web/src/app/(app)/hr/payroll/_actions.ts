"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Routes that render the payroll-run list (all three read GET /v1/payroll/runs
 * through getPayrollRunDetails): the Payroll home, Runs and Period screens.
 */
const PAYROLL_RUN_LIST_PATHS = ["/hr/payroll", "/hr/payroll/runs", "/hr/payroll/period"] as const;

/**
 * GAP-PAYROLL-HOME-06: drop the cached payroll-run list pages after a run is
 * created. The runs list itself is fetched uncached, but Next's CLIENT Router
 * Cache still holds the /hr/payroll tree the user left when the form pushed to
 * the new run, and restores it on Back with no staleness check (Next 14.2.35
 * restore-reducer), so the run just created would be missing from the list. A
 * Server Action that calls revalidatePath makes the client reset that cache
 * (server-action-reducer: `mutable.cache` replaced, `mutable.prefetchCache`
 * emptied), so Back refetches. The form awaits this BEFORE router.push.
 *
 * Only a payroll administrator (the roles that can see the create form, and the
 * ones POST /v1/payroll/runs accepts) triggers a revalidation; any other caller
 * is a silent no-op, so this cannot be used to churn caches. It carries no data,
 * moves no money and changes no record: it only invalidates cached pages.
 */
export async function revalidatePayrollRunLists(): Promise<void> {
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r))) return;
  for (const path of PAYROLL_RUN_LIST_PATHS) revalidatePath(path);
}
