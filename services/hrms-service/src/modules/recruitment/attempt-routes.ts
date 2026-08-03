import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Assessment management — runtime: scheduling, attempts, delivery, auto-save and
 * auto-evaluation (R-RA-0124/0126/0127/0129/0130/0131).
 *
 *   POST  /v1/hrms/assessments/schedules                 assemble+schedule a sitting from an active blueprint
 *   POST  /v1/hrms/assessments/schedules/:id/open|close|cancel
 *   GET   /v1/hrms/assessments/schedules[?status|blueprintId]
 *   GET   /v1/hrms/assessments/schedules/:id             (+ attempt roster)
 *   POST  /v1/hrms/assessments/schedules/:id/attempts    assign a candidate (randomises order)
 *   POST  /v1/hrms/assessments/attempts/:id/accommodation set extra time (before start)
 *   POST  /v1/hrms/assessments/attempts/:id/verify-identity
 *   POST  /v1/hrms/assessments/attempts/:id/start        begin (sets personal deadline)
 *   GET   /v1/hrms/assessments/attempts/:id/paper        delivery — questions in candidate order, ANSWER KEYS STRIPPED
 *   PATCH /v1/hrms/assessments/attempts/:id/responses    auto-save responses (crash-recoverable)
 *   GET   /v1/hrms/assessments/attempts/:id              recover — state + saved responses (no answer keys)
 *   POST  /v1/hrms/assessments/attempts/:id/submit       finalise + auto-evaluate objective/coding
 *
 * NOTE: attempt operations are gated to HR / invigilator roles (proctor-operated
 * sittings). Candidate self-service delivery via a scoped attempt token is a
 * follow-up (candidate portal, R-RA-0160). Answer keys are NEVER returned by any
 * delivery/recovery endpoint. Result is computed but only becomes publishable
 * after the authorised freeze (R-RA-0134, part C).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  randomizeQuestionOrder, attemptDeadline, scoreObjective, computeAttemptResult,
  type PaperEntry, type ObjectiveScore,
} from "./attempt-domain.js";
import * as bp from "./blueprint-repo.js";
import * as repo from "./attempt-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

/** Strip the answer key from a stored paper before it can reach a candidate. */
function deliveryView(paper: PaperEntry[], order: string[]): unknown[] {
  const byId = new Map(paper.map((p) => [p.questionId, p]));
  return order.map((qid) => {
    const p = byId.get(qid);
    if (!p) return null;
    const { answerKey, ...safe } = p as PaperEntry & { stem?: unknown; options?: unknown };
    void answerKey;
    return safe;
  }).filter(Boolean);
}

export async function assessmentAttemptRoutes(app: FastifyInstance): Promise<void> {
  // ---- scheduling (R-RA-0126) ------------------------------------------
  app.post("/v1/hrms/assessments/schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      blueprintId: z.string().uuid(),
      title: z.string().min(1).max(256),
      mode: z.enum(["online", "centre", "hybrid"]).default("online"),
      windowStart: z.string().datetime(),
      windowEnd: z.string().datetime(),
      slots: z.array(z.object({
        label: z.string().max(64), start: z.string().datetime().optional(), end: z.string().datetime().optional(),
        centre: z.string().max(200).optional(), capacity: z.coerce.number().int().positive().optional(),
      })).max(50).default([]),
      questions: z.array(z.object({ questionId: z.string().uuid(), section: z.string().min(1).max(64) })).min(1).max(500),
    }).parse(req.body);

    if (new Date(body.windowEnd) <= new Date(body.windowStart)) throw new HttpError(400, "BAD_WINDOW", "windowEnd must be after windowStart");

    const blueprint = await bp.findBlueprint(ctx.tenantId, body.blueprintId);
    if (!blueprint) throw new HttpError(404, "NOT_FOUND", "blueprint not found");
    if (blueprint.status !== "active") throw new HttpError(409, "BLUEPRINT_NOT_ACTIVE", "the blueprint must be active to schedule an assessment");

    const scoring = (blueprint.scoringConfig ?? {}) as { sections?: Array<{ key: string; questionCount: number }> };
    const bpSections = new Map((scoring.sections ?? []).map((s) => [s.key, s.questionCount]));

    // A question may appear at most once in a paper — a duplicate would be
    // double-counted in section/total scoring and skew the cut-off (R-RA-0125).
    const seenQ = new Set<string>();
    for (const q of body.questions) {
      if (seenQ.has(q.questionId)) throw new HttpError(422, "DUPLICATE_QUESTION", `question ${q.questionId} appears more than once in the paper`);
      seenQ.add(q.questionId);
    }

    // Assemble the IMMUTABLE paper: snapshot each validated question (R-RA-0121).
    const paper: Array<PaperEntry & { stem: string; options: unknown }> = [];
    let totalMarks = 0;
    const perSection = new Map<string, number>();
    for (const q of body.questions) {
      if (!bpSections.has(q.section)) throw new HttpError(422, "UNKNOWN_SECTION", `section "${q.section}" is not defined in the blueprint`);
      const question = await bp.findQuestion(ctx.tenantId, q.questionId);
      if (!question) throw new HttpError(404, "QUESTION_NOT_FOUND", `question ${q.questionId} not found`);
      if (question.status !== "validated") throw new HttpError(422, "QUESTION_NOT_VALIDATED", `question ${q.questionId} is not validated`);
      paper.push({
        questionId: question.id, section: q.section, marks: question.marks, qtype: question.qtype,
        stem: question.stem, options: question.options, answerKey: question.answerKey as never,
      });
      totalMarks += question.marks;
      perSection.set(q.section, (perSection.get(q.section) ?? 0) + 1);
    }
    // The assembled paper must match the blueprint's section counts exactly.
    for (const [key, want] of bpSections) {
      const got = perSection.get(key) ?? 0;
      if (got !== want) throw new HttpError(422, "SECTION_COUNT_MISMATCH", `section "${key}" requires ${want} questions but ${got} were provided`);
    }

    const id = randomUUID();
    await publishF3Write(ctx, "recruitment_attempt_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "scheduled", totalMarks, questions: paper.length });
  });

  for (const [action, from, to] of [["open", ["scheduled"], "open"], ["close", ["open", "scheduled"], "closed"], ["cancel", ["scheduled", "open"], "cancelled"]] as const) {
    app.post(`/v1/hrms/assessments/schedules/:id/${action}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, HR_ROLES);
      const { id } = idParam.parse(req.params);
      const s = await mustSchedule(ctx.tenantId, id);
      if (!(from as readonly string[]).includes(s.status)) throw new HttpError(409, "INVALID_STATE", `cannot ${action} a schedule in status "${s.status}"`);
      await publishF3Write(ctx, "recruitment_attempt_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
      return reply.send({ id, status: to });
    });
  }

  app.get("/v1/hrms/assessments/schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = z.object({ status: z.enum(["scheduled", "open", "closed", "cancelled"]).optional(), blueprintId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    const rows = await repo.listSchedules(ctx.tenantId, { ...(q.status ? { status: q.status } : {}), ...(q.blueprintId ? { blueprintId: q.blueprintId } : {}) }, q.limit ?? 100);
    // Never expose the answer-key-bearing paper in a list projection.
    return reply.send(jsonSafe({ data: rows.map(({ paper, ...s }) => { void paper; return s; }) }));
  });

  app.get("/v1/hrms/assessments/schedules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const s = await mustSchedule(ctx.tenantId, id);
    const attempts = await repo.listAttemptsBySchedule(ctx.tenantId, id, 500);
    const { paper, ...safe } = s;
    return reply.send(jsonSafe({ ...safe, questionCount: (paper as unknown[]).length, attempts: attempts.map((a) => ({ id: a.id, candidateId: a.candidateId, status: a.status, result: a.result })) }));
  });

  // ---- attempt assignment (R-RA-0124 randomisation) --------------------
  app.post("/v1/hrms/assessments/schedules/:id/attempts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      candidateId: z.string().uuid(),
      applicationId: z.string().uuid().optional(),
      slotLabel: z.string().max(64).optional(),
      accommodation: z.object({ extraTimePct: z.coerce.number().min(0).max(200).optional(), notes: z.string().max(2000).optional() }).optional(),
    }).parse(req.body);
    const s = await mustSchedule(ctx.tenantId, id);
    if (s.status === "cancelled" || s.status === "closed") throw new HttpError(409, "SCHEDULE_CLOSED", "cannot assign to a closed/cancelled schedule");

    const attemptId = randomUUID();
    const paperIds = (s.paper as PaperEntry[]).map((p) => p.questionId);
    const order = randomizeQuestionOrder(paperIds, attemptId); // per-candidate deterministic order
    try {
      await publishF3Write(ctx, "recruitment_attempt_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "DUPLICATE_ATTEMPT", "this candidate already has an attempt for this schedule");
      throw e;
    }
    return reply.code(201).send({ id: attemptId, status: "assigned" });
  });

  // ---- accommodation (R-RA-0127) ---------------------------------------
  app.post("/v1/hrms/assessments/attempts/:id/accommodation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ extraTimePct: z.coerce.number().min(0).max(200), notes: z.string().max(2000).optional() }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status !== "assigned") throw new HttpError(409, "ALREADY_STARTED", "accommodation must be set before the attempt starts");
    await publishF3Write(ctx, "recruitment_attempt_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, accommodation: { extraTimePct: body.extraTimePct } });
  });

  // ---- identity verification (R-RA-0129) -------------------------------
  app.post("/v1/hrms/assessments/attempts/:id/verify-identity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ method: z.string().min(1).max(32), meta: z.record(z.unknown()).optional() }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status !== "assigned" && a.status !== "in_progress") throw new HttpError(409, "INVALID_STATE", `cannot verify identity in status "${a.status}"`);
    await publishF3Write(ctx, "recruitment_attempt_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, identityVerified: true });
  });

  // ---- start (R-RA-0127 personal deadline) -----------------------------
  app.post("/v1/hrms/assessments/attempts/:id/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status !== "assigned") throw new HttpError(409, "INVALID_STATE", `attempt cannot start from status "${a.status}"`);
    if (!a.identityVerified) throw new HttpError(409, "IDENTITY_REQUIRED", "verify the candidate's identity before starting (R-RA-0129)");
    const s = await mustSchedule(ctx.tenantId, a.scheduleId);
    if (s.status !== "open") throw new HttpError(409, "SCHEDULE_NOT_OPEN", "the assessment window is not open");
    const now = Date.now();
    if (now < s.windowStart.getTime() || now > s.windowEnd.getTime()) throw new HttpError(409, "OUTSIDE_WINDOW", "outside the scheduled assessment window");

    const blueprint = await bp.findBlueprint(ctx.tenantId, a.blueprintId);
    const durationMinutes = blueprint?.durationMinutes ?? 60;
    const extraPct = Number((a.accommodation as { extraTimePct?: number })?.extraTimePct ?? 0);
    const deadline = new Date(attemptDeadline(now, durationMinutes, extraPct, s.windowEnd.getTime()));
    await publishF3Write(ctx, "recruitment_attempt_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "in_progress", deadlineAt: deadline }));
  });

  // ---- delivery: questions in candidate order, NO answer keys ----------
  app.get("/v1/hrms/assessments/attempts/:id/paper", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    const s = await mustSchedule(ctx.tenantId, a.scheduleId);
    return reply.send(jsonSafe({ id, status: a.status, deadlineAt: a.deadlineAt, questions: deliveryView(s.paper as PaperEntry[], a.questionOrder as string[]) }));
  });

  // ---- auto-save (R-RA-0130) -------------------------------------------
  app.patch("/v1/hrms/assessments/attempts/:id/responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ responses: z.array(z.object({ questionId: z.string().uuid(), response: z.record(z.unknown()) })).min(1).max(500) }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status !== "in_progress") throw new HttpError(409, "NOT_IN_PROGRESS", "responses can only be saved while the attempt is in progress");
    // An administrator closing / cancelling the sitting (e.g. a leaked paper or a
    // proctoring incident) must immediately stop all in-flight answering — the
    // primary incident-response control (R-RA-0135 precursor).
    const sSave = await mustSchedule(ctx.tenantId, a.scheduleId);
    if (sSave.status === "cancelled") throw new HttpError(409, "SCHEDULE_CANCELLED", "the assessment has been cancelled");
    if (sSave.status === "closed") throw new HttpError(409, "SCHEDULE_CLOSED", "the assessment window has been closed");
    if (a.deadlineAt && Date.now() > a.deadlineAt.getTime()) throw new HttpError(409, "DEADLINE_PASSED", "the attempt deadline has passed");
    const allowed = new Set((a.questionOrder as string[]));
    for (const r of body.responses) if (!allowed.has(r.questionId)) throw new HttpError(422, "UNKNOWN_QUESTION", `question ${r.questionId} is not part of this attempt`);

    await publishF3Write(ctx, "recruitment_attempt_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, saved: body.responses.length, lastSavedAt: new Date().toISOString() });
  });

  // ---- recover (R-RA-0130) ---------------------------------------------
  app.get("/v1/hrms/assessments/attempts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    const responses = await repo.listResponses(ctx.tenantId, id);
    return reply.send(jsonSafe({
      id: a.id, scheduleId: a.scheduleId, candidateId: a.candidateId, status: a.status,
      identityVerified: a.identityVerified, accommodation: a.accommodation, questionOrder: a.questionOrder,
      startedAt: a.startedAt, deadlineAt: a.deadlineAt, lastSavedAt: a.lastSavedAt,
      totalScore: a.totalScore, maxScore: a.maxScore, sectionScores: a.sectionScores, result: a.result, needsManualEval: a.needsManualEval,
      // recovery returns the candidate's own saved responses, never scores of others / answer keys
      responses: responses.map((r) => ({ questionId: r.questionId, response: r.response, savedAt: r.savedAt })),
    }));
  });

  // ---- submit + auto-evaluate (R-RA-0131) ------------------------------
  app.post("/v1/hrms/assessments/attempts/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status !== "in_progress") throw new HttpError(409, "NOT_IN_PROGRESS", `cannot submit an attempt in status "${a.status}"`);
    const s = await mustSchedule(ctx.tenantId, a.scheduleId);
    // A cancelled sitting is void — its attempts cannot be finalised to a result.
    if (s.status === "cancelled") throw new HttpError(409, "SCHEDULE_CANCELLED", "the assessment has been cancelled; this attempt cannot be submitted");
    const blueprint = await bp.findBlueprint(ctx.tenantId, a.blueprintId);
    const scoring = (blueprint?.scoringConfig ?? {}) as { negativeMarking?: { enabled: boolean; fraction?: number }; totalCutoffPct?: number; sections?: Array<{ key: string; sectionCutoffPct?: number }> };
    const paper = s.paper as PaperEntry[];
    const responses = await repo.listResponses(ctx.tenantId, id);
    const respByQ = new Map(responses.map((r) => [r.questionId, r.response as Record<string, unknown>]));

    const scored = new Map<string, ObjectiveScore>();
    for (const entry of paper) {
      scored.set(entry.questionId, scoreObjective(entry, respByQ.get(entry.questionId), scoring.negativeMarking));
    }
    const result = computeAttemptResult(paper, scored, { ...(scoring.totalCutoffPct != null ? { totalCutoffPct: scoring.totalCutoffPct } : {}), sections: scoring.sections ?? [] });

    await publishF3Write(ctx, "recruitment_attempt_routes__7", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({
      id, status: "evaluated", totalScore: result.totalScore, maxScore: result.maxScore,
      result: result.result, needsManualEval: result.needsManualEval,
    }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustSchedule(tenantId: string, id: string) {
    const s = await repo.findSchedule(tenantId, id);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    return s;
  }
  async function mustAttempt(tenantId: string, id: string) {
    const a = await repo.findAttempt(tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    return a;
  }
}
