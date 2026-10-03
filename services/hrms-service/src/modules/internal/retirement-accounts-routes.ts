import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsGpfAccounts } from "../gpf/schema.js";
import { hrmsNpsAccounts } from "../nps/schema.js";

const INTERNAL_ROLES = ["super_admin", "payroll_admin", "hr_admin"];
// Bounded, deterministic page: ORDER BY employee_id keeps the cut stable.
export const MAX_ACCOUNTS = 5000;

/**
 * GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02: payroll-service keeps its own
 * per-run GPF/NPS ledger while hrms-service keeps the per-employee account
 * (the subscription / contribution percentages HR configured). This internal,
 * read-only projection lets payroll flag where the two disagree WITHOUT
 * deciding which ledger is authoritative. Only the contribution parameters
 * cross the service boundary -- no PRAN, GPF number or balance (DPDP).
 * Same internal service-account gate as the sibling /internal routes.
 */
export async function retirementAccountsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/internal/retirement-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const [gpf, nps] = await Promise.all([
      scopedRead((tx) =>
        tx.select({
          employeeId: hrmsGpfAccounts.employeeId,
          monthlySubscriptionMinor: hrmsGpfAccounts.monthlySubscriptionMinor,
          status: hrmsGpfAccounts.status,
        })
          .from(hrmsGpfAccounts)
          .where(and(eq(hrmsGpfAccounts.tenantId, ctx.tenantId)))
          .orderBy(asc(hrmsGpfAccounts.employeeId))
          .limit(MAX_ACCOUNTS + 1)),
      scopedRead((tx) =>
        tx.select({
          employeeId: hrmsNpsAccounts.employeeId,
          empContribPct: hrmsNpsAccounts.empContribPct,
          erContribPct: hrmsNpsAccounts.erContribPct,
          status: hrmsNpsAccounts.status,
        })
          .from(hrmsNpsAccounts)
          .where(and(eq(hrmsNpsAccounts.tenantId, ctx.tenantId)))
          .orderBy(asc(hrmsNpsAccounts.employeeId))
          .limit(MAX_ACCOUNTS + 1)),
    ]);
    // One extra row is fetched to tell "exactly at the cap" from "cut off".
    // When cut off, payroll must report "not checked" for employees past the
    // cut, never "no HRMS account".
    const gpfTruncated = gpf.length > MAX_ACCOUNTS;
    const npsTruncated = nps.length > MAX_ACCOUNTS;
    return reply.send({
      gpfTruncated,
      npsTruncated,
      gpf: gpf.slice(0, MAX_ACCOUNTS).map((r) => ({ employeeId: r.employeeId, monthlySubscriptionMinor: r.monthlySubscriptionMinor.toString(), status: r.status })),
      nps: nps.slice(0, MAX_ACCOUNTS).map((r) => ({ employeeId: r.employeeId, empContribPct: Number(r.empContribPct), erContribPct: Number(r.erContribPct), status: r.status })),
    });
  });
}
