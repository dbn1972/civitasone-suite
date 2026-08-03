import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Leave-type conversion (T08 / DEF-LM-001).
 *
 *   POST /v1/hrms/leave/conversions    convert days from one type to another
 *   GET  /v1/hrms/leave/conversions?employeeId=X   list conversions
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsLeaveConversions } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export async function leaveConversionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/leave/conversions", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      fromAllocId: z.string().uuid(),
      toAllocId: z.string().uuid(),
      days: z.coerce.number().int().min(1),
      reason: z.string().max(2000).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "leave_conversion_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "approved" });
  });

  app.get("/v1/hrms/leave/conversions", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveConversions)
      .where(and(eq(hrmsLeaveConversions.tenantId, ctx.tenantId), eq(hrmsLeaveConversions.employeeId, q.employeeId))));
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
