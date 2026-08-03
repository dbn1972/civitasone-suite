import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Candidate interview self-service — confirm / request reschedule (R-RA-0143).
 *
 *   POST /v1/hrms/interviews/:id/candidate-response          confirm | reschedule_request
 *   POST /v1/hrms/interview-reschedule-requests/:reqId/approve   HR applies the new slot
 *   POST /v1/hrms/interview-reschedule-requests/:reqId/decline   HR declines
 *   GET  /v1/hrms/interviews/:id/candidate-responses         list responses
 *
 * AUTH DEFERRAL: candidate-facing authentication is not yet wired; these routes
 * are HR-gated as a stand-in (HR records the candidate response). The request
 * record + HR approve/decline is the durable mechanism and is unchanged when a
 * candidate-scoped token later authorises the candidate-response endpoint.
 *
 * Notifying the candidate of the OUTCOME (approved new slot / declined) is done
 * via the R-RA-0142 interview-comms endpoint (a reschedule comm), not duplicated
 * here — this route owns the request lifecycle + the schedule change only.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { canCommunicate, isValidCalendarDate, isValidTime } from "./interview-comms.js";
import { RESPONSE_TYPES, validateResponse, initialStatus, isDecidable, type ResponseType } from "./interview-response.js";
import * as repo from "./interview-response-repo.js";
import * as ivRepo from "./interview-comms-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const reqParam = z.object({ reqId: z.string().uuid() });

export async function interviewResponseRoutes(app: FastifyInstance): Promise<void> {
  // ── candidate response (confirm / request reschedule) ──
  app.post("/v1/hrms/interviews/:id/candidate-response", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES); // auth-deferral stand-in (see file header)
    const { id } = idParam.parse(req.params);
    const body = z.object({
      type: z.enum(RESPONSE_TYPES),
      preferredDate: z.string().refine(isValidCalendarDate, "must be a valid YYYY-MM-DD date").optional(),
      preferredTime: z.string().refine(isValidTime, "must be a valid HH:MM time").optional(),
      reason: z.string().max(2000).optional(),
    }).parse(req.body);

    const iv = await ivRepo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    if (!canCommunicate(iv.status)) throw new HttpError(409, "INTERVIEW_NOT_COMMABLE", `the interview is '${iv.status}'; responses are only allowed while scheduled`);

    const errors = validateResponse(body);
    if (errors.length > 0) throw new HttpError(422, "INVALID_RESPONSE", errors.join("; "));

    if (body.type === "reschedule_request") {
      const existing = await repo.findPendingForInterview(ctx.tenantId, id);
      if (existing) throw new HttpError(409, "RESCHEDULE_PENDING", "a reschedule request is already pending for this interview");
    }

    const rid = randomUUID();
    try {
      await publishF3Write(ctx, "recruitment_interview_response_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "RESCHEDULE_PENDING", "a reschedule request is already pending for this interview") as any;
      }
      throw err;
    }
    return reply.code(201).send({ id: rid, interviewId: id, type: body.type, status: initialStatus(body.type as ResponseType) });
  });

  // ── HR approves a reschedule request → applies the new slot ──
  app.post("/v1/hrms/interview-reschedule-requests/:reqId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { reqId } = reqParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});

    const r = await mustReq(ctx.tenantId, reqId);
    if (r.responseType !== "reschedule_request") throw new HttpError(409, "NOT_RESCHEDULE", "this response is not a reschedule request");
    if (!isDecidable(r.status)) throw new HttpError(409, "NOT_PENDING", `request is '${r.status}', not pending`);

    // Defensive: a reschedule request always stores a valid slot (validated at
    // intake), but guard before writing into the NOT NULL interview columns so a
    // corrupt row surfaces as 422, never a 500.
    const preferredDate = r.preferredDate as unknown as string | null;
    if (!preferredDate || !r.preferredTime) throw new HttpError(422, "INVALID_RESPONSE", "the reschedule request has no valid preferred slot");

    const iv = await ivRepo.findInterview(ctx.tenantId, r.interviewId);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    if (!canCommunicate(iv.status)) throw new HttpError(409, "INTERVIEW_NOT_COMMABLE", `the interview is '${iv.status}'; it cannot be rescheduled`);

    try {
      await publishF3Write(ctx, "recruitment_interview_response_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the interview or request changed; reload and retry");
      throw err;
    }
    return reply.send({ id: reqId, interviewId: r.interviewId, status: "approved", scheduledDate: r.preferredDate, scheduledTime: r.preferredTime });
  });

  // ── HR declines a reschedule request ──
  app.post("/v1/hrms/interview-reschedule-requests/:reqId/decline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { reqId } = reqParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});

    const r = await mustReq(ctx.tenantId, reqId);
    if (r.responseType !== "reschedule_request") throw new HttpError(409, "NOT_RESCHEDULE", "this response is not a reschedule request");
    if (!isDecidable(r.status)) throw new HttpError(409, "NOT_PENDING", `request is '${r.status}', not pending`);

    try {
      await publishF3Write(ctx, "recruitment_interview_response_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the request changed; reload and retry");
      throw err;
    }
    return reply.send({ id: reqId, status: "declined" });
  });

  app.get("/v1/hrms/interviews/:id/candidate-responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const iv = await ivRepo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    return reply.send({ id, data: await repo.listForInterview(ctx.tenantId, id) });
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

  async function mustReq(tenantId: string, id: string) {
    const r = await repo.findResponse(tenantId, id);
    if (!r) throw new HttpError(404, "NOT_FOUND", "reschedule request not found");
    return r;
  }
}
