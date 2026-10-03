import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Audited PII reveal for applicant contact details (DPDP) -- the server half of
 * GAP-RECRUITMENT-DETAIL-08 and GAP-RECRUITMENT-TALENT-POOL-02.
 *
 *   POST /v1/hrms/applications/:id/reveal-contact   { reason, scope } -> { email, mobile }
 *   GET  /v1/hrms/applications/:id/resume-link      short-lived link to the uploaded resume
 *
 * The lists mask email/mobile by default (the full values never reach the browser). A reveal needs a stated reason
 * and is recorded on the audit trail (actor, application, scope, reason, fields). "Audited" here means the audit
 * COMMAND IS DURABLY QUEUED (publishF3Write awaits the queue publish) before the values are returned: if it cannot be
 * queued, nothing is revealed. The audit.event.record row itself is written afterwards by the consumer
 * (finish-consumer.ts) in its own transaction; if that write fails it is retried and, once dead-lettered, is surfaced
 * by the loud "PII reveal audit write failed" error log (alert tag pii_reveal_audit_failed) and the queue's dlq_total
 * metric. So in a worst case a reveal can be served while its audit row is delayed or dead-lettered -- operators must
 * alert on that log / metric. The payload never contains the revealed values themselves.
 *
 * Roles: the vacancy inbox ("inbox") is for the screening officers (hr_admin, hr_officer,
 * super_admin); the tenant-wide talent pool ("talent_pool") holds past applicants of every
 * vacancy, so it is limited to hr_admin / super_admin.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { presignedGetUrl, StorageNotConfiguredError } from "@civitasone/storage";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as screeningRepo from "./screening-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
export const REVEAL_SCOPES = ["inbox", "talent_pool"] as const;
export const revealBody = z.object({
  reason: z.string().trim().min(5, "state why you need the contact details (at least 5 characters)").max(500),
  scope: z.enum(REVEAL_SCOPES).default("inbox"),
});
const RESUME_LINK_SECONDS = 300;

export async function piiRevealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/applications/:id/reveal-contact", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = revealBody.parse(req.body ?? {});
    if (body.scope === "talent_pool") requireRole(ctx, ADMIN_ROLES);
    const a = await screeningRepo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    // Audit first, fail closed: no queued audit event, no reveal.
    await publishF3Write(ctx, "recruitment_pii_reveal__0", randomUUID(), {
      params: { id }, query: {},
      body: { action: "applicant_contact_revealed", scope: body.scope, reason: body.reason, fields: ["email", "mobile"] },
    });
    return reply.send({ data: { id, email: a.email ?? null, mobile: a.mobile ?? null } });
  });

  app.get("/v1/hrms/applications/:id/resume-link", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await screeningRepo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    if (!a.resumeFileKey) throw new HttpError(404, "NO_RESUME", "this applicant did not upload a resume");
    // A stored key must sit inside this tenant's careers-resume namespace (defence in depth against a forged key).
    if (!a.resumeFileKey.startsWith(`careers-resumes/${ctx.tenantId}/`)) throw new HttpError(404, "NO_RESUME", "this applicant did not upload a resume");
    await publishF3Write(ctx, "recruitment_pii_reveal__0", randomUUID(), {
      params: { id }, query: {},
      body: { action: "applicant_resume_viewed", scope: "inbox", reason: "resume opened", fields: ["resume"] },
    });
    try {
      const url = await presignedGetUrl({ key: a.resumeFileKey, expiresIn: RESUME_LINK_SECONDS });
      return reply.send({ data: { url, expiresInSeconds: RESUME_LINK_SECONDS } });
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) throw new HttpError(503, "STORAGE_UNAVAILABLE", "document storage is not configured");
      throw err;
    }
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
