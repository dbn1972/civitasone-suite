/**
 * ST-M01-11 — posting/DDO history as-of API (SmartTransfer OS).
 *
 *   GET /v1/payroll/posting-history/:employeeId?asOf=YYYY-MM-DD
 *
 * Staff-only (requireRole; the privileged payroll/HR/finance roles — never
 * `citizen`). Tenant-scoped from the SERVER context (ctx.tenantId), never a
 * client id (house rule 9). FORCE RLS on payroll.posting_history is the second
 * line of defence under the explicit tenant filter.
 *
 * - With `asOf`: returns the single posting FACT effective for the employee on
 *   that date (the greatest effective_from on/before it), or 404 when the
 *   employee had no posting on/before it.
 * - Without `asOf`: returns the full posting history, most recent first.
 *
 * Read-only; returns the stored posting FACT only (office move, station,
 * state, HRA city class, optional DDO, effective date, order number). It does
 * NO pay computation / TA-DA / split / HRA-class derivation (PROPOSED
 * D-ST-13/14). No PII (no name/PAN/bank). Error codes are returned structured
 * (resolved to human text client-side via the shared error envelope), matching
 * every other payroll read route — no new user-facing backend string.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { PostingHistoryRow } from "./schema.js";

/** Staff roles that may read posting history. Excludes `citizen` (staff-only). */
export const POSTING_HISTORY_ROLES = [
  "payroll_admin",
  "payroll_officer",
  "finance_officer",
  "finance_admin",
  "hr_admin",
  "hr_officer",
  "super_admin",
];

const params = z.object({ employeeId: z.string().uuid() });
// Strict ISO date; NO z.coerce (house rule 8). regex guards the shape, the
// refine rejects impossible calendar dates (e.g. 2026-02-30).
const query = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "asOf must be YYYY-MM-DD")
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "asOf is not a valid date")
    .optional(),
});

/** API view of a history row — the posting FACT, no internal/audit columns. */
function toView(r: PostingHistoryRow): Record<string, unknown> {
  return {
    employeeId: r.employeeId,
    fromOfficeId: r.fromOfficeId,
    toOfficeId: r.toOfficeId,
    station: r.station,
    state: r.state,
    cityClass: r.cityClass,
    ddo: r.ddo,
    effectiveFrom: r.effectiveFrom,
    orderNumber: r.orderNumber,
  };
}

export async function postingHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/posting-history/:employeeId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, POSTING_HISTORY_ROLES);
    const { employeeId } = params.parse(req.params ?? {});
    const { asOf } = query.parse(req.query ?? {});

    if (asOf) {
      const row = await repo.findAsOf(ctx.tenantId, employeeId, asOf);
      if (!row) {
        throw new HttpError(
          404,
          "POSTING_NOT_FOUND",
          `no posting on or before ${asOf} for employee ${employeeId}`,
        );
      }
      return reply.send({ data: toView(row), meta: { asOf } });
    }

    const rows = await repo.findHistory(ctx.tenantId, employeeId);
    return reply.send({ data: rows.map(toView), meta: { count: rows.length } });
  });
}
