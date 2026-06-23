import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsLeaveTypes } from "./schema.js";

const ALL_ROLES = ["hr_admin", "super_admin", "admin", "hr_officer", "officer", "employee"];

export async function leaveTypesReadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/leave-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const rows = await db.select().from(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, ctx.tenantId));
    return reply.send({ data: rows.map(r => ({ id: r.id, name: r.name, code: r.code, maxDays: r.maxDays, carryForward: r.carryForward })) });
  });
}
