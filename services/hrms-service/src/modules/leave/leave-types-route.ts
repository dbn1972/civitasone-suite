import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsLeaveTypes } from "./schema.js";

const ALL_ROLES = ["hr_admin", "super_admin", "admin", "hr_officer", "officer", "employee"];

export async function leaveTypesReadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/leave-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, ctx.tenantId)));
    // lopFractionBps included so self-service applicants can see up front how
    // much of a given leave type counts toward Loss-of-Pay (0 = fully paid,
    // 10000 = fully unpaid, e.g. 5000 for Half Pay Leave) -- not sensitive,
    // and the same data payroll now relies on (see leave/consumer.ts's
    // leaveApproved payload and internal/routes.ts's payroll-input feed).
    return reply.send({ data: rows.map(r => ({ id: r.id, name: r.name, code: r.code, maxDays: r.maxDays, carryForward: r.carryForward, lopFractionBps: r.lopFractionBps })) });
  });
}
