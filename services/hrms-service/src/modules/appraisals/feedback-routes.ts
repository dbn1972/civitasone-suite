import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * 360-degree feedback + APAR disclosure + rating appeals (Sprint 5: T30/T33/T34).
 *
 *   POST /v1/hrms/appraisals/:id/360-feedback      submit 360 feedback
 *   GET  /v1/hrms/appraisals/:id/360-feedback      list feedback for an appraisal
 *   POST /v1/hrms/appraisals/:id/disclosure        disclose APAR to employee
 *   POST /v1/hrms/appraisals/:id/appeal            file a rating appeal
 *   GET  /v1/hrms/appraisals/:id/appeals           list appeals
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrms360Feedback, hrmsAparDisclosures, hrmsRatingAppeals } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/appraisals/:id/360-feedback", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      reviewerId: z.string().uuid(),
      relationship: z.enum(["self", "peer", "subordinate", "supervisor", "external"]),
      ratings: z.string().max(2000).optional(),
      comments: z.string().max(5000).optional(),
    }).parse(req.body);
    const fid = randomUUID();
    await publishF3Write(ctx, "appraisals_feedback_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: fid, appraisalId: id }) as any;
  });

  app.get("/v1/hrms/appraisals/:id/360-feedback", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrms360Feedback)
      .where(and(eq(hrms360Feedback.tenantId, ctx.tenantId), eq(hrms360Feedback.appraisalId, id))));
    // 360-deg anonymity: mask reviewerId unless requester holds hr_admin (PASS_WITH_NOTES S9 fix)
    const isPrivileged = ctx.roles.some((r: string) => ["hr_admin", "super_admin"].includes(r));
    const data = isPrivileged
      ? rows
      : rows.map((row) => ({ ...row, reviewerId: null }));
    return reply.send({ data });
  });

  app.post("/v1/hrms/appraisals/:id/disclosure", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ employeeId: z.string().uuid() }).parse(req.body);
    const did = randomUUID();
    await publishF3Write(ctx, "appraisals_feedback_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: did, appraisalId: id, disclosed: true }) as any;
  });

  app.post("/v1/hrms/appraisals/:id/appeal", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      employeeId: z.string().uuid(),
      appealReason: z.string().min(10).max(5000),
      pipLinked: z.boolean().default(false),
    }).parse(req.body);
    const aid = randomUUID();
    await publishF3Write(ctx, "appraisals_feedback_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: aid, appraisalId: id, status: "filed" }) as any;
  });

  app.get("/v1/hrms/appraisals/:id/appeals", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsRatingAppeals)
      .where(and(eq(hrmsRatingAppeals.tenantId, ctx.tenantId), eq(hrmsRatingAppeals.appraisalId, id))));
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
