/**
 * P2-001: Interview CRUD
 * - POST /v1/hrms/interviews (schedule interview)
 * - GET /v1/hrms/interviews?jobOpeningId=X (list interviews for a job)
 * - PATCH /v1/hrms/interviews/:id/scorecard (submit scorecard)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { randomUUID } from "node:crypto";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];

const scheduleInterviewBody = z.object({
  jobOpeningId: z.string().uuid(),
  applicationId: z.string().uuid(),
  interviewerIds: z.array(z.string().uuid()).min(1),
  scheduledAt: z.string(), // ISO date-time
  durationMinutes: z.number().int().min(15).default(60),
  mode: z.enum(["in_person", "video", "phone"]).default("video"),
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

// In-memory store (in production, backed by DB table recruitment.hrms_interviews)
const interviewStore: Array<{
  id: string;
  tenantId: string;
  jobOpeningId: string;
  applicationId: string;
  interviewerIds: string[];
  scheduledAt: string;
  durationMinutes: number;
  mode: string;
  notes?: string;
  status: string;
  scorecard?: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}> = [];

export async function interviewRoutes(app: FastifyInstance): Promise<void> {
  // Schedule interview
  app.post("/v1/hrms/interviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = scheduleInterviewBody.parse(req.body);

    const interview = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      jobOpeningId: body.jobOpeningId,
      applicationId: body.applicationId,
      interviewerIds: body.interviewerIds,
      scheduledAt: body.scheduledAt,
      durationMinutes: body.durationMinutes,
      mode: body.mode,
      notes: body.notes ?? "",
      status: "scheduled" as const,
      createdAt: new Date().toISOString(),
      createdBy: ctx.actorId,
    };

    interviewStore.push(interview);

    return reply.code(201).send({
      id: interview.id,
      status: interview.status,
      message: "interview scheduled",
    });
  });

  // List interviews (optionally filtered by jobOpeningId)
  app.get("/v1/hrms/interviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = querySchema.parse(req.query);

    let results = interviewStore.filter((i) => i.tenantId === ctx.tenantId);
    if (q.jobOpeningId) {
      results = results.filter((i) => i.jobOpeningId === q.jobOpeningId);
    }
    if (q.applicationId) {
      results = results.filter((i) => i.applicationId === q.applicationId);
    }

    return reply.send({ data: results.slice(0, q.limit) });
  });

  // Submit scorecard
  app.patch("/v1/hrms/interviews/:id/scorecard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = req.params as { id: string };
    const body = scorecardBody.parse(req.body);

    const interview = interviewStore.find((i) => i.id === id && i.tenantId === ctx.tenantId);
    if (!interview) throw new HttpError(404, "NOT_FOUND", "interview not found");

    interview.scorecard = { ...body, submittedBy: ctx.actorId, submittedAt: new Date().toISOString() };
    interview.status = "completed";

    return reply.send({
      id: interview.id,
      status: interview.status,
      message: "scorecard submitted",
    });
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
