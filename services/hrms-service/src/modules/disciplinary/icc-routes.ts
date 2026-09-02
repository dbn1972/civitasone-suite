import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * ICC / POSH complaint CRUD (Sprint 4: T25–T29).
 *
 *   POST /v1/hrms/icc/complaints          file a complaint (confidential)
 *   GET  /v1/hrms/icc/complaints          list complaints (ICC-role gated)
 *   POST /v1/hrms/icc/complaints/:id/hearings   record a hearing
 *   GET  /v1/hrms/icc/complaints/:id/hearings   list hearings
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsIccComplaints, hrmsIccHearings } from "./schema.js";

const ICC_ROLES = ["hr_admin", "super_admin", "icc_member"];
const idParam = z.object({ id: z.string().uuid() });

export async function iccRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/icc/complaints", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const body = z.object({
      complainantId: z.string().uuid(),
      respondentId: z.string().uuid().optional(),
      summary: z.string().min(10).max(5000),
    }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "disciplinary_icc_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "filed", confidential: true }) as any;
  });

  app.get("/v1/hrms/icc/complaints", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsIccComplaints)
      .where(eq(hrmsIccComplaints.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsIccComplaints.filedAt)).limit(100));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/icc/complaints/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      hearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(5000).optional(),
      finding: z.string().max(24).optional(),
    }).parse(req.body);
    const hid = randomUUID();
    await publishF3Write(ctx, "disciplinary_icc_routes__1", hid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: hid, complaintId: id }) as any;
  });

  app.get("/v1/hrms/icc/complaints/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsIccHearings)
      .where(and(eq(hrmsIccHearings.tenantId, ctx.tenantId), eq(hrmsIccHearings.complaintId, id))));
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
