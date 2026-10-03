/**
 * GAP-PAYROLL-PAY-GROUPS-03: read-only guards shared by the pay-group routes
 * (synchronous 4xx before a command is published).
 */
import { sql } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { countActiveRuns, countCurrentMembers } from "./pay-group-repo.js";
import { todayIst } from "./pay-group-domain.js";

/** A pay group's DDO must exist for the tenant and be active (404 / 409). */
export async function assertActiveDdo(tenantId: string, ddoCode: string | null | undefined): Promise<void> {
  if (!ddoCode) return;
  const r = (await scopedRead((tx) => tx.execute(sql`
    SELECT is_active FROM payroll.payroll_ddos WHERE tenant_id = ${tenantId}::uuid AND ddo_code = ${ddoCode} LIMIT 1
  `))) as unknown as Array<{ is_active: boolean }>;
  if (!r[0]) throw new HttpError(404, "DDO_NOT_FOUND", `DDO ${ddoCode} is not registered for this tenant`);
  if (r[0].is_active === false) throw new HttpError(409, "DDO_INACTIVE", `DDO ${ddoCode} is deactivated; reactivate it first`);
}

/** What stops a pay group being deactivated right now. */
export async function payGroupDeactivationBlockers(
  tenantId: string, payGroupId: string,
): Promise<{ members: number; activeRuns: number }> {
  return scopedRead(async (tx) => ({
    members: await countCurrentMembers(tx, tenantId, payGroupId, todayIst()),
    activeRuns: await countActiveRuns(tx, tenantId, payGroupId),
  }));
}
