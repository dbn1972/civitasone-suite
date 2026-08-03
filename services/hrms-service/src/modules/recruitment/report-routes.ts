import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Assessment management — disposition + reporting (R-RA-0135/0136).
 *
 *   POST /v1/hrms/assessments/attempts/:id/malpractice   void an attempt for malpractice
 *   POST /v1/hrms/assessments/attempts/:id/reschedule    void + create a fresh attempt (disruption / retest)
 *   GET  /v1/hrms/assessments/schedules/:id/report        attendance + cut-off + score distribution
 *   GET  /v1/hrms/assessments/schedules/:id/item-analysis per-question difficulty / p-value
 *
 * Malpractice and reschedule are irreversible, authorised (senior-role) actions,
 * fully audited. Reports are aggregate only (no candidate identity).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { randomizeQuestionOrder, type PaperEntry } from "./attempt-domain.js";
import {
  attendanceStats, cutoffStats, scoreDistribution, itemAnalysis,
  type AttemptStat, type QuestionResponse,
} from "./report-domain.js";
import * as attemptRepo from "./attempt-repo.js";
import * as resultRepo from "./result-repo.js";
import * as reportRepo from "./report-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const RESULT_ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
// Aggregate reports are open to the broader HR set, but a tiny cohort (e.g. a
// one-candidate retest schedule) makes those "aggregates" individually
// identifying. Below this many non-void respondents, reports need a senior role.
const MIN_REPORT_COHORT = 5;

function isSenior(ctx: ReturnType<typeof resolveContext>): boolean {
  try { requireRole(ctx, RESULT_ADMIN_ROLES); return true; } catch { return false; }
}
function guardSmallCohort(ctx: ReturnType<typeof resolveContext>, nonVoidCount: number): void {
  if (nonVoidCount > 0 && nonVoidCount < MIN_REPORT_COHORT && !isSenior(ctx)) {
    throw new HttpError(403, "SMALL_COHORT", `reports for fewer than ${MIN_REPORT_COHORT} respondents are restricted to senior roles to protect candidate anonymity`);
  }
}

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

export async function assessmentReportRoutes(app: FastifyInstance): Promise<void> {
  // ---- malpractice: void the attempt (R-RA-0135) -----------------------
  app.post("/v1/hrms/assessments/attempts/:id/malpractice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RESULT_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().trim().min(5).max(4000), evidence: z.record(z.unknown()).optional() }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status === "void") throw new HttpError(409, "ALREADY_VOID", "the attempt is already voided");
    await publishF3Write(ctx, "recruitment_report_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ attemptId: id, status: "void", disposition: "malpractice" });
  });

  // ---- reschedule / retest: void + fresh attempt (R-RA-0135) -----------
  app.post("/v1/hrms/assessments/attempts/:id/reschedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RESULT_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      type: z.enum(["technical_disruption", "retest"]),
      reason: z.string().trim().min(5).max(4000),
      targetScheduleId: z.string().uuid().optional(),
    }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.status === "void") throw new HttpError(409, "ALREADY_VOID", "the attempt is already voided");
    if (a.frozen) throw new HttpError(409, "FROZEN", "a frozen result cannot be rescheduled; void via malpractice or unfreeze first");

    const targetScheduleId = body.targetScheduleId ?? a.scheduleId;
    const target = await attemptRepo.findSchedule(ctx.tenantId, targetScheduleId);
    if (!target) throw new HttpError(404, "NOT_FOUND", "target schedule not found");
    if (target.status === "cancelled") throw new HttpError(409, "SCHEDULE_CANCELLED", "the target schedule is cancelled");
    const paperIds = (target.paper as PaperEntry[]).map((p) => p.questionId);
    if (paperIds.length === 0) throw new HttpError(409, "EMPTY_PAPER", "the target schedule has no assembled paper");

    const newId = randomUUID();
    const order = randomizeQuestionOrder(paperIds, newId);
    try {
      await publishF3Write(ctx, "recruitment_report_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (e) {
      // Candidate already holds an active attempt on the target schedule.
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "ALREADY_SCHEDULED", "the candidate already has an active attempt on the target schedule");
      throw e;
    }
    return reply.code(201).send({ attemptId: id, status: "void", disposition: body.type, newAttemptId: newId, targetScheduleId });
  });

  // ---- schedule report (R-RA-0136) -------------------------------------
  app.get("/v1/hrms/assessments/schedules/:id/report", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const q = z.object({ bucketPct: z.coerce.number().int().min(5).max(100).optional() }).parse(req.query);
    const s = await attemptRepo.findSchedule(ctx.tenantId, id);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    const attempts = await attemptRepo.listAttemptsBySchedule(ctx.tenantId, id, 5000);
    guardSmallCohort(ctx, attempts.filter((a) => a.status !== "void").length);
    const stats: AttemptStat[] = attempts.map((a) => ({ status: a.status, result: a.result, disposition: a.disposition, totalScore: a.totalScore == null ? null : Number(a.totalScore), maxScore: a.maxScore == null ? null : Number(a.maxScore) }));
    return reply.send(jsonSafe({
      scheduleId: id, title: s.title, totalMarks: s.totalMarks,
      attendance: attendanceStats(stats),
      cutoff: cutoffStats(stats),
      scoreDistribution: scoreDistribution(stats, q.bucketPct ?? 20),
    }));
  });

  // ---- item analysis (R-RA-0136) ---------------------------------------
  app.get("/v1/hrms/assessments/schedules/:id/item-analysis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const s = await attemptRepo.findSchedule(ctx.tenantId, id);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    const paper = (s.paper as PaperEntry[]).map((p) => ({ questionId: p.questionId, section: p.section, marks: p.marks, qtype: p.qtype }));
    // Only count non-void attempts in the analysis.
    const attempts = (await attemptRepo.listAttemptsBySchedule(ctx.tenantId, id, 5000)).filter((a) => a.status !== "void");
    guardSmallCohort(ctx, attempts.length);
    const responses = await reportRepo.listResponsesForAttempts(ctx.tenantId, attempts.map((a) => a.id));
    const byQ = new Map<string, QuestionResponse[]>();
    for (const r of responses) {
      const arr = byQ.get(r.questionId) ?? [];
      arr.push({ questionId: r.questionId, isCorrect: r.isCorrect, score: r.autoScore == null ? null : Number(r.autoScore) });
      byQ.set(r.questionId, arr);
    }
    return reply.send(jsonSafe({ scheduleId: id, respondents: attempts.length, items: itemAnalysis(paper, byQ) }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustAttempt(tenantId: string, id: string) {
    const a = await attemptRepo.findAttempt(tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    return a;
  }
}
