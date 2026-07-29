/**
 * Interview CRUD (persisted in recruitment.hrms_interviews — migration 0008).
 * - POST  /v1/hrms/interviews                  schedule interview
 * - GET   /v1/hrms/interviews?jobOpeningId=X   list interviews
 * - PATCH /v1/hrms/interviews/:id/scorecard    submit scorecard
 *
 * P0-2: previously an in-memory array (lost on every restart). Now backed by
 * the real DB table.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];

// Route-level interview modes; mapped to the DB CHECK domain (in_person/video/telephonic).
const scheduleInterviewBody = z.object({
  jobOpeningId: z.string().uuid(),
  applicationId: z.string().uuid(),
  interviewerIds: z.array(z.string().uuid()).min(1),
  scheduledAt: z.string(), // ISO date-time
  durationMinutes: z.number().int().min(15).default(60),
  mode: z.enum(["in_person", "video", "phone"]).default("video"),
  roundType: z.enum(["screening", "technical", "hr", "panel", "final", "group_discussion", "domain", "behavioural", "presentation", "final_selection"]).default("technical"),
  roundNumber: z.number().int().min(1).default(1),
  notes: z.string().optional(),
});

const scorecardBody = z.object({
  rating: z.number().int().min(1).max(5),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  recommendation: z.enum(["strong_hire", "hire", "no_hire", "strong_no_hire"]),
  comments: z.string().optional(),
});

const querySchema = z.object({
  jobOpeningId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Map route mode -> DB CHECK domain.
const MODE_DB: Record<string, string> = { in_person: "in_person", video: "video", phone: "telephonic" };
// Map scorecard recommendation -> DB recommendation CHECK domain (subset).
const RECO_DB: Record<string, string | null> = {
  strong_hire: "strong_hire", hire: "hire", no_hire: "no_hire", strong_no_hire: "no_hire",
};

export async function interviewRoutes(app: FastifyInstance): Promise<void> {
  // Schedule interview
  app.post("/v1/hrms/interviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = scheduleInterviewBody.parse(req.body);

    const when = new Date(body.scheduledAt);
    if (Number.isNaN(when.getTime())) throw new HttpError(400, "VALIDATION_FAILED", "scheduledAt must be an ISO date-time");
    const scheduledDate = when.toISOString().slice(0, 10); // YYYY-MM-DD
    const scheduledTime = when.toISOString().slice(11, 16); // HH:MM

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertInterview(tx, {
        id,
        tenantId: ctx.tenantId,
        applicationId: body.applicationId,
        jobOpeningId: body.jobOpeningId,
        roundNumber: body.roundNumber,
        roundType: body.roundType,
        scheduledDate,
        scheduledTime,
        durationMinutes: body.durationMinutes,
        mode: MODE_DB[body.mode] ?? "video",
        panelMembers: body.interviewerIds,
        status: "scheduled",
        feedback: body.notes ?? null,
        createdBy: ctx.actorId,
      });
    });

    return reply.code(201).send({ id, status: "scheduled", message: "interview scheduled" });
  });

  // List interviews (optionally filtered by jobOpeningId / applicationId)
  app.get("/v1/hrms/interviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = querySchema.parse(req.query);

    const filters: { jobOpeningId?: string; applicationId?: string } = {};
    if (q.jobOpeningId) filters.jobOpeningId = q.jobOpeningId;
    if (q.applicationId) filters.applicationId = q.applicationId;

    const results = await repo.listInterviews(ctx.tenantId, filters, q.limit);
    return reply.send({ data: results });
  });

  // Submit scorecard
  app.patch("/v1/hrms/interviews/:id/scorecard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = req.params as { id: string };
    const body = scorecardBody.parse(req.body);

    const interview = await repo.findInterviewById(id, ctx.tenantId);
    if (!interview) throw new HttpError(404, "NOT_FOUND", "interview not found");

    const scorecard: Record<string, unknown> = {
      ...body,
      submittedBy: ctx.actorId,
      submittedAt: new Date().toISOString(),
    };
    await db.transaction(async (tx) => {
      await repo.updateInterviewScorecard(tx, id, ctx.tenantId, scorecard, RECO_DB[body.recommendation] ?? null);
    });

    return reply.send({ id, status: "completed", message: "scorecard submitted" });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
