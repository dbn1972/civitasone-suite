/**
 * UAT T-PERIOD D-14: dry run of the leave year-end / half-yearly credit.
 *
 *   GET /v1/hrms/leave/year-end/preview?runDate=YYYY-MM-DD
 *     What the job would do for the caller tenant on that credit date (1 Jan /
 *     1 Jul, or 1 Apr / 1 Oct for a financial leave year): per employee and
 *     leave type the carry-forward, the 300-day lapse, the credit and the CL
 *     lapse. Writes nothing. 422 NOT_A_CREDIT_DATE otherwise.
 *
 * Applying is the scheduled job (HRMS_LEAVE_YEAR_END_ENABLED) or
 * scripts/leave-year-end.ts --apply; there is deliberately no HTTP apply.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { planLeaveYearEnd, LeaveYearEndError } from "./year-end-job.js";

const YEAR_END_ROLES = ["hr_admin", "super_admin"];

export async function leaveYearEndRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/leave/year-end/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, YEAR_END_ROLES);
    const q = z.object({ runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "runDate must be YYYY-MM-DD") }).safeParse(req.query ?? {});
    if (!q.success) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "runDate (YYYY-MM-DD) is required", correlationId: ctx.correlationId });
    }
    try {
      return reply.send(await planLeaveYearEnd(db, { tenantId: ctx.tenantId, runDate: q.data.runDate, dryRun: true }));
    } catch (err) {
      if (err instanceof LeaveYearEndError) {
        return reply.code(422).send({ code: err.code, message: err.message, correlationId: ctx.correlationId, retryable: false, ...(err.details ? { details: err.details } : {}) });
      }
      throw err;
    }
  });
}
