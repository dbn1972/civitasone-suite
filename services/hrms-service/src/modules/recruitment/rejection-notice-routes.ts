import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Candidate-facing rejection / outcome communication (checklist R-RA-0118).
 *
 *   GET   /v1/hrms/applications/:id/rejection-notice     candidate-safe notice (scores stripped)
 *   PATCH /v1/hrms/job-openings/:id/rejection-policy     set the disclose-reason policy flag
 *
 * The notice is an allow-list projection: internal scoring, remarks, the
 * screener's identity and the eligibility computation are never emitted. A
 * per-vacancy policy flag (admin-set) decides whether a high-level reason
 * CATEGORY is included for a rejection.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { buildRejectionNotice } from "./rejection-notice.js";
import * as screeningRepo from "./screening-repo.js";
import * as repo from "./rejection-notice-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function rejectionNoticeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/applications/:id/rejection-notice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await screeningRepo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    const discloseReason = (await repo.getDisclosurePolicy(ctx.tenantId, a.jobOpeningId)) ?? false;
    const notice = buildRejectionNotice({
      id: a.id, applicantName: a.applicantName, applicationNo: a.applicationNo,
      jobOpeningId: a.jobOpeningId, screeningDecision: a.screeningDecision,
      screeningReasonCode: a.screeningReasonCode,
    }, { discloseReason });
    return reply.send({ data: notice });
  });

  app.patch("/v1/hrms/job-openings/:id/rejection-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ discloseReason: z.boolean() }).parse(req.body);
    const ok = await publishF3Write(ctx, "recruitment_rejection_notice_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!ok) throw new HttpError(404, "NOT_FOUND", "job opening not found") as any;
    return reply.send({ id, discloseRejectionReason: body.discloseReason });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
