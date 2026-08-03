import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Assessment management — result finalisation (R-RA-0132/0133/0134).
 *
 *   GET  /v1/hrms/assessments/attempts/:id/manual-queue        anonymised manual responses to score
 *   POST /v1/hrms/assessments/attempts/:id/evaluations         submit an anonymised evaluator score
 *   POST /v1/hrms/assessments/attempts/:id/consolidate         merge objective + manual -> final score
 *   POST /v1/hrms/assessments/attempts/:id/moderate            propose moderation (maker)
 *   POST /v1/hrms/assessments/attempts/:id/moderate/approve    approve + apply moderation (checker, SoD)
 *   POST /v1/hrms/assessments/attempts/:id/freeze              authorised freeze (locks the result)
 *   POST /v1/hrms/assessments/attempts/:id/publish             publish (only after freeze)
 *   GET  /v1/hrms/assessments/attempts/:id/result              full result + audit (HR view)
 *
 * Descriptive/coding/manual responses are scored blind (evaluators never see the
 * candidate identity, R-RA-0132). Moderation is maker-checker (R-RA-0133). A result
 * is only publishable after an authorised freeze (R-RA-0134); once frozen, scores
 * are immutable.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { scoreObjective, computeAttemptResult, type PaperEntry, type ObjectiveScore } from "./attempt-domain.js";
import {
  aggregateEvaluations, consolidatedScores, validateModeration, applyModeration, resultAfterModeration,
  MODERATION_METHODS, type Moderation,
} from "./result-domain.js";
import * as attemptRepo from "./attempt-repo.js";
import * as bp from "./blueprint-repo.js";
import * as repo from "./result-repo.js";

// Evaluators (incl. hr_officer) may score blind and consolidate/propose, but the
// identity-bearing result view is restricted to senior roles so a blind evaluator
// cannot de-anonymise the candidate they are scoring (R-RA-0132 as a real
// access boundary, not just a response-shape convenience).
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const RESULT_ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const OBJECTIVE_TYPES = new Set(["mcq"]); // machine-scored; everything else is manual

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

export async function assessmentResultRoutes(app: FastifyInstance): Promise<void> {
  // ---- anonymised manual evaluation queue (R-RA-0132) -------------------
  app.get("/v1/hrms/assessments/attempts/:id/manual-queue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    const s = await attemptRepo.findSchedule(ctx.tenantId, a.scheduleId);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    const responses = await attemptRepo.listResponses(ctx.tenantId, id);
    const respByQ = new Map(responses.map((r) => [r.questionId, r.response]));
    // Blind: no candidateId / applicationId — evaluators score responses only.
    const queue = (s.paper as Array<PaperEntry & { stem?: unknown; options?: unknown }>)
      .filter((p) => !OBJECTIVE_TYPES.has(p.qtype))
      .map((p) => ({ questionId: p.questionId, section: p.section, marks: p.marks, qtype: p.qtype, stem: p.stem, options: p.options, response: respByQ.get(p.questionId) ?? null }));
    return reply.send(jsonSafe({ attemptId: id, count: queue.length, questions: queue }));
  });

  // ---- submit an evaluator score (R-RA-0132) ---------------------------
  app.post("/v1/hrms/assessments/attempts/:id/evaluations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ questionId: z.string().uuid(), score: z.coerce.number().min(0), remarks: z.string().max(4000).optional() }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.frozen) throw new HttpError(409, "FROZEN", "the result is frozen; evaluations are locked");
    const s = await attemptRepo.findSchedule(ctx.tenantId, a.scheduleId);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    const entry = (s.paper as PaperEntry[]).find((p) => p.questionId === body.questionId);
    if (!entry) throw new HttpError(422, "UNKNOWN_QUESTION", "question is not part of this attempt");
    if (OBJECTIVE_TYPES.has(entry.qtype)) throw new HttpError(422, "NOT_MANUAL", "objective questions are auto-scored, not manually evaluated");
    if (body.score > entry.marks) throw new HttpError(422, "SCORE_TOO_HIGH", `score cannot exceed the question's ${entry.marks} marks`);

    await publishF3Write(ctx, "recruitment_result_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ attemptId: id, questionId: body.questionId, scored: true }) as any;
  });

  // ---- consolidate objective + manual -> final score -------------------
  app.post("/v1/hrms/assessments/attempts/:id/consolidate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.frozen) throw new HttpError(409, "FROZEN", "the result is frozen; cannot re-consolidate");
    if (a.status !== "evaluated") throw new HttpError(409, "NOT_SUBMITTED", "the attempt has not been submitted");
    const s = await attemptRepo.findSchedule(ctx.tenantId, a.scheduleId);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    const blueprint = await bp.findBlueprint(ctx.tenantId, a.blueprintId);
    const scoring = (blueprint?.scoringConfig ?? {}) as { negativeMarking?: { enabled: boolean; fraction?: number }; totalCutoffPct?: number; sections?: Array<{ key: string; sectionCutoffPct?: number }> };
    const paper = s.paper as PaperEntry[];
    const responses = await attemptRepo.listResponses(ctx.tenantId, id);
    const respByQ = new Map(responses.map((r) => [r.questionId, r.response as Record<string, unknown>]));
    const evals = await repo.listEvaluations(ctx.tenantId, id);

    // objective: re-derive deterministically (handles blanks -> 0). manual: mean of evaluations.
    const objectiveByQ = new Map<string, ObjectiveScore>();
    const manualByQ = new Map<string, number>();
    for (const e of paper) {
      const sc = scoreObjective(e, respByQ.get(e.questionId), scoring.negativeMarking);
      if (sc.auto) objectiveByQ.set(e.questionId, sc);
      else {
        const qEvals = evals.filter((v) => v.questionId === e.questionId).map((v) => Number(v.score));
        if (qEvals.length > 0) manualByQ.set(e.questionId, aggregateEvaluations(qEvals));
      }
    }
    const { scored, missing } = consolidatedScores(paper, objectiveByQ, manualByQ);
    if (missing.length > 0) throw new HttpError(422, "PENDING_EVALUATION", `${missing.length} manual question(s) still need evaluation`);

    const result = computeAttemptResult(paper, scored, { ...(scoring.totalCutoffPct != null ? { totalCutoffPct: scoring.totalCutoffPct } : {}), sections: scoring.sections ?? [] });
    // Re-consolidation supersedes the underlying scores, so ANY prior moderation
    // (proposed or already applied) is invalidated — clearing it keeps the freeze
    // gate and audit trail honest (a frozen record can never carry an approval
    // that no longer matches the score). Recorded explicitly for the auditor.
    const priorMod = (a.moderation ?? {}) as { proposedBy?: string };
    const hadModeration = Boolean(priorMod.proposedBy || a.moderatedBy);
    await publishF3Write(ctx, "recruitment_result_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ attemptId: id, totalScore: result.totalScore, maxScore: result.maxScore, result: result.result })) as any;
  });

  // ---- moderation propose (maker) --------------------------------------
  app.post("/v1/hrms/assessments/attempts/:id/moderate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ method: z.enum(MODERATION_METHODS), factor: z.coerce.number().optional(), notes: z.string().max(2000).optional() }).parse(req.body);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.frozen) throw new HttpError(409, "FROZEN", "the result is frozen; cannot moderate");
    if (a.needsManualEval) throw new HttpError(409, "NOT_CONSOLIDATED", "consolidate the attempt before moderating");
    if (a.rawTotalScore == null) throw new HttpError(409, "NOT_CONSOLIDATED", "consolidate the attempt before moderating");
    const errors = validateModeration(body as Moderation);
    if (errors.length > 0) throw new HttpError(422, "INVALID_MODERATION", errors.join("; "));

    await publishF3Write(ctx, "recruitment_result_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ attemptId: id, moderation: { method: body.method, factor: body.factor ?? null }, status: "proposed" }) as any;
  });

  // ---- moderation approve + apply (checker, SoD) -----------------------
  app.post("/v1/hrms/assessments/attempts/:id/moderate/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.frozen) throw new HttpError(409, "FROZEN", "the result is frozen");
    const mod = (a.moderation ?? {}) as { method?: string; factor?: number; proposedBy?: string; rawSnapshot?: string };
    if (!mod.proposedBy) throw new HttpError(409, "NO_PROPOSAL", "there is no moderation proposal to approve");
    if (a.moderatedBy) throw new HttpError(409, "ALREADY_APPROVED", "this moderation has already been approved");
    // Segregation of duties: the approver must not be the proposer.
    if (mod.proposedBy === ctx.actorId) throw new HttpError(403, "SOD_VIOLATION", "the moderation proposer cannot approve it; an independent authorised user must approve");
    // Bind the approval to the raw score the proposer reviewed (defence-in-depth;
    // re-consolidation already clears the proposal).
    if (mod.rawSnapshot != null && mod.rawSnapshot !== String(a.rawTotalScore)) {
      throw new HttpError(409, "RAW_CHANGED", "the raw score changed since the proposal; re-propose the moderation");
    }

    const blueprint = await bp.findBlueprint(ctx.tenantId, a.blueprintId);
    const scoring = (blueprint?.scoringConfig ?? {}) as { totalCutoffPct?: number; sections?: Array<{ key: string; sectionCutoffPct?: number }> };
    const raw = Number(a.rawTotalScore);
    const max = Number(a.maxScore);
    const moderatedTotal = applyModeration(raw, max, mod as Moderation);
    const result = resultAfterModeration(a.sectionScores as never, { ...(scoring.totalCutoffPct != null ? { totalCutoffPct: scoring.totalCutoffPct } : {}), sections: scoring.sections ?? [] }, moderatedTotal, max);

    await publishF3Write(ctx, "recruitment_result_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ attemptId: id, rawTotalScore: raw, totalScore: moderatedTotal, result })) as any;
  });

  // ---- authorised freeze (R-RA-0134) -----------------------------------
  app.post("/v1/hrms/assessments/attempts/:id/freeze", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    if (a.frozen) throw new HttpError(409, "ALREADY_FROZEN", "the result is already frozen");
    if (a.status !== "evaluated" || a.needsManualEval) throw new HttpError(409, "NOT_READY", "the attempt must be evaluated and consolidated before freezing");
    const mod = (a.moderation ?? {}) as { proposedBy?: string; approvedBy?: string };
    if (mod.proposedBy && !mod.approvedBy) throw new HttpError(409, "MODERATION_PENDING", "an unapproved moderation proposal must be resolved before freezing");
    // SoD: when a moderation was applied, the person who approved it cannot also
    // perform the irreversible freeze — preserve an independent final sign-off.
    if (a.moderatedBy && a.moderatedBy === ctx.actorId) throw new HttpError(403, "SOD_VIOLATION", "the moderation approver cannot also freeze the result; an independent authorised user must freeze");
    await publishF3Write(ctx, "recruitment_result_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ attemptId: id, frozen: true }) as any;
  });

  // ---- publish (only after freeze, R-RA-0134) --------------------------
  app.post("/v1/hrms/assessments/attempts/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    if (!a.frozen) throw new HttpError(409, "NOT_FROZEN", "a result can only be published after it is frozen");
    if (a.published) throw new HttpError(409, "ALREADY_PUBLISHED", "the result is already published");
    await publishF3Write(ctx, "recruitment_result_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ attemptId: id, published: true, result: a.result }) as any;
  });

  // ---- HR result view + audit ------------------------------------------
  app.get("/v1/hrms/assessments/attempts/:id/result", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RESULT_ADMIN_ROLES); // identity-bearing — not the blind-evaluator surface
    const { id } = idParam.parse(req.params);
    const a = await mustAttempt(ctx.tenantId, id);
    const audit = await repo.listResultEvents(ctx.tenantId, id);
    return reply.send(jsonSafe({
      attemptId: a.id, candidateId: a.candidateId, status: a.status, needsManualEval: a.needsManualEval,
      rawTotalScore: a.rawTotalScore, totalScore: a.totalScore, maxScore: a.maxScore, sectionScores: a.sectionScores,
      result: a.result, moderation: a.moderation, frozen: a.frozen, published: a.published, audit,
    }));
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
