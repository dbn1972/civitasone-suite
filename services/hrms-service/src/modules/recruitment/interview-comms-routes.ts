import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Interview communications lifecycle (checklist R-RA-0142).
 *
 *   POST /v1/hrms/interviews/:id/comms   invite | reminder | reschedule | cancel
 *   GET  /v1/hrms/interviews/:id/comms   list the comms log
 *
 * Delivery is behind the FEATURE_INTERVIEW_COMMS_ENABLED flag: when on, the comm
 * is queued to the transactional outbox (topic hrms.interview.comm.dispatch) for
 * the notification service; when off it is recorded as a STUB — no real send,
 * honestly marked. A reschedule updates the interview's date/time and a cancel
 * marks it cancelled, both under an optimistic-version guard.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import {
  INTERVIEW_COMM_TYPES, commsEnabled, resolveDispatch, buildCommMessage, requiresSchedule,
  canCommunicate, isValidCalendarDate, isValidTime, type InterviewCommType,
} from "./interview-comms.js";
import * as repo from "./interview-comms-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
// Only email/sms are client-selectable; "stub" is an internal marker only.
const REQUEST_CHANNELS = ["email", "sms"] as const;
const idParam = z.object({ id: z.string().uuid() });

export async function interviewCommsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/interviews/:id/comms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      type: z.enum(INTERVIEW_COMM_TYPES),
      channel: z.enum(REQUEST_CHANNELS).optional(),
      newDate: z.string().refine(isValidCalendarDate, "must be a valid YYYY-MM-DD date").optional(),
      newTime: z.string().refine(isValidTime, "must be a valid HH:MM time").optional(),
    }).parse(req.body);
    const idempotencyKey = (req.headers["x-idempotency-key"] as string | undefined)?.slice(0, 64);

    const enabled = commsEnabled(process.env);
    // Real dispatch (flag on) must be idempotent so a retry cannot double-send.
    if (enabled && !idempotencyKey) {
      throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "X-Idempotency-Key header is required when interview comms are dispatched");
    }
    // Replay: return the prior comm without creating/dispatching a duplicate.
    if (idempotencyKey) {
      const prior = await repo.findByIdempotencyKey(ctx.tenantId, idempotencyKey);
      if (prior) return reply.code(200).send({ id: prior.id, interviewId: prior.interviewId, type: prior.commType, channel: prior.channel, status: prior.status, replay: true });
    }

    const iv = await repo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    if (!canCommunicate(iv.status)) throw new HttpError(409, "INTERVIEW_NOT_COMMABLE", `the interview is '${iv.status}'; communications are only allowed while scheduled or rescheduled`);
    if (requiresSchedule(body.type) && (!body.newDate || !body.newTime)) {
      throw new HttpError(422, "SCHEDULE_REQUIRED", "a reschedule requires newDate and newTime");
    }

    const { channel, status } = resolveDispatch(enabled, body.channel);
    const scheduledDate = body.type === "reschedule" ? body.newDate! : (iv.scheduledDate as unknown as string);
    const message = buildCommMessage(body.type as InterviewCommType, {
      roundType: iv.roundType, scheduledDate,
      scheduledTime: body.type === "reschedule" ? body.newTime! : iv.scheduledTime,
    });
    const commId = randomUUID();

    try {
      await publishF3Write(ctx, "recruitment_interview_comms_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the interview changed; reload and retry");
      // Concurrent request with the same idempotency key won the race.
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "DUPLICATE_REQUEST", "a communication with this idempotency key is already being processed");
      }
      throw err;
    }

    return reply.code(201).send({ id: commId, interviewId: id, type: body.type, channel, status });
  });

  app.get("/v1/hrms/interviews/:id/comms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const iv = await repo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    return reply.send({ id, data: await repo.listComms(ctx.tenantId, id) });
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
