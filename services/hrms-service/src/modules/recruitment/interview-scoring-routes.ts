/**
 * Interview panel scoring (checklist R-RA-0144/0146/0147/0148).
 *
 *   PATCH /v1/hrms/interviews/:id/scorecard-template   competency weights + cut-off (R-RA-0144)
 *   POST  /v1/hrms/interviews/:id/scores               an interviewer's independent score (R-RA-0146)
 *   GET   /v1/hrms/interviews/:id/scores               list scores, blind-filtered (R-RA-0147)
 *   POST  /v1/hrms/interviews/:id/consolidate          weighted panel score + cut-off (R-RA-0148)
 *   GET   /v1/hrms/interviews/:id/panel-result         current consolidated result
 *
 * Each interviewer submits once and independently; a panel member cannot see
 * other scores until they have submitted their own; consolidation computes a
 * competency-weighted panel score and a recommendation band.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  computePanelScore, visibleScores, type Competency, type InterviewerScore,
} from "./interview-scoring.js";
import * as repo from "./interview-scoring-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const SCORE_ROLES = [...HR_ROLES, "manager", "interviewer"];
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

/** Extract panel-member user ids from the (loosely-typed) panel_members jsonb. */
function panelMemberIds(panel: unknown): Set<string> {
  const ids = new Set<string>();
  if (Array.isArray(panel)) {
    for (const m of panel) {
      if (typeof m === "string") ids.add(m);
      else if (m && typeof m === "object") {
        const o = m as Record<string, unknown>;
        for (const k of ["id", "userId", "memberId", "employeeId", "actorId"]) if (typeof o[k] === "string") ids.add(o[k] as string);
      }
    }
  }
  return ids;
}

export async function interviewScoringRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/hrms/interviews/:id/scorecard-template", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      competencies: z.array(z.object({
        competency: z.string().min(1).max(64),
        weight: z.coerce.number().positive().max(100),
        maxScore: z.coerce.number().int().positive().max(100),
      })).min(1).max(20),
      cutoffScore: z.coerce.number().int().min(0).max(100).optional(),
    }).parse(req.body);
    const iv = await mustInterview(ctx.tenantId, id);
    if (iv.consolidatedAt) throw new HttpError(409, "ALREADY_CONSOLIDATED", "the panel result is already consolidated; the scorecard is locked");
    await db.transaction((tx) => repo.updateInterview(tx, ctx.tenantId, id, {
      scorecardTemplate: body.competencies as never,
      ...(body.cutoffScore != null ? { cutoffScore: body.cutoffScore } : {}),
    }, iv.version));
    return reply.send({ id, competencies: body.competencies, cutoffScore: body.cutoffScore ?? iv.cutoffScore ?? null });
  });

  app.post("/v1/hrms/interviews/:id/scores", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCORE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      scores: z.record(z.coerce.number().min(0)),
      comments: z.string().max(4000).optional(),
    }).parse(req.body);
    const iv = await mustInterview(ctx.tenantId, id);
    if (iv.consolidatedAt) throw new HttpError(409, "ALREADY_CONSOLIDATED", "scores are locked after consolidation");
    const template = (iv.scorecardTemplate ?? []) as Competency[];
    if (template.length === 0) throw new HttpError(409, "NO_TEMPLATE", "a scorecard template must be configured before scoring");

    // Only a configured panel member (or an HR admin) may score; if no panel is
    // configured, any HR/interviewer role may.
    const panel = panelMemberIds(iv.panelMembers);
    const isAdmin = ctx.roles.some((r: string) => ADMIN_ROLES.includes(r));
    if (panel.size > 0 && !panel.has(ctx.actorId) && !isAdmin) {
      throw new HttpError(403, "NOT_A_PANELIST", "only a configured panel member may submit a score for this interview");
    }
    // Validate awarded scores against the template (known competency, within max).
    const byComp = new Map(template.map((t) => [t.competency, t]));
    for (const [c, v] of Object.entries(body.scores)) {
      const t = byComp.get(c);
      if (!t) throw new HttpError(400, "UNKNOWN_COMPETENCY", `'${c}' is not on the scorecard`);
      if (v > t.maxScore) throw new HttpError(400, "SCORE_OUT_OF_RANGE", `'${c}' score ${v} exceeds the maximum ${t.maxScore}`);
    }
    // Every competency must be scored — otherwise the weighted consolidation
    // renormalises over only the scored competencies and a candidate never
    // assessed on a heavily-weighted competency could score/pass on a subset.
    for (const t of template) {
      if (typeof body.scores[t.competency] !== "number") {
        throw new HttpError(400, "INCOMPLETE_SCORECARD", `every competency must be scored — missing '${t.competency}'`);
      }
    }
    // One submission per interviewer, independent and locked.
    if (await repo.findScore(ctx.tenantId, id, ctx.actorId)) {
      throw new HttpError(409, "ALREADY_SUBMITTED", "you have already submitted your score for this interview");
    }
    // Per-interviewer normalised overall (0-100) for quick display.
    const overall = computePanelScore(template, [{ interviewerId: ctx.actorId, scores: body.scores }]).weightedScore;
    try {
      await db.transaction((tx) => repo.insertScore(tx, {
        tenantId: ctx.tenantId, interviewId: id, interviewerId: ctx.actorId,
        scores: body.scores, overallScore: Math.round(overall), comments: body.comments ?? null,
      }));
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") throw new HttpError(409, "ALREADY_SUBMITTED", "you have already submitted your score for this interview");
      throw err;
    }
    return reply.code(201).send({ interviewId: id, interviewerId: ctx.actorId, overallScore: Math.round(overall), submitted: true });
  });

  app.get("/v1/hrms/interviews/:id/scores", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCORE_ROLES);
    const { id } = idParam.parse(req.params);
    const iv = await mustInterview(ctx.tenantId, id);
    const all = await repo.listScores(ctx.tenantId, id);
    const panel = panelMemberIds(iv.panelMembers);
    const isPanel = panel.has(ctx.actorId);
    const isHr = ctx.roles.some((r: string) => HR_ROLES.includes(r));
    // Only THIS interview's panel members or HR staff may view scores at all —
    // a generic interviewer/manager role does not grant access to an interview
    // they are not on (closes the leak of raw scores to non-panelists).
    if (!isPanel && !isHr) throw new HttpError(403, "NOT_ON_PANEL", "you are not a panel member or HR reviewer for this interview");
    // R-RA-0147: a panel member (even one who also holds an HR role) sees others
    // only after submitting their own score; a pure HR reviewer sees all.
    const { scores, blinded } = visibleScores(all.map((s) => ({ ...s })), ctx.actorId, isPanel);
    return reply.send(jsonSafe({ data: scores, blinded, submittedCount: all.filter((s) => s.submitted).length, panelSize: panel.size }));
  });

  app.post("/v1/hrms/interviews/:id/consolidate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const iv = await mustInterview(ctx.tenantId, id);
    const template = (iv.scorecardTemplate ?? []) as Competency[];
    if (template.length === 0) throw new HttpError(409, "NO_TEMPLATE", "no scorecard template configured");
    const rows = await repo.listScores(ctx.tenantId, id);
    const submitted: InterviewerScore[] = rows.filter((s) => s.submitted).map((s) => ({ interviewerId: s.interviewerId, scores: s.scores, submitted: true }));
    if (submitted.length === 0) throw new HttpError(409, "NO_SCORES", "no submitted interviewer scores to consolidate");
    const result = computePanelScore(template, submitted, iv.cutoffScore ?? null);
    await db.transaction((tx) => repo.updateInterview(tx, ctx.tenantId, id, {
      panelScore: Math.round(result.weightedScore), recommendation: result.recommendation,
      status: "completed", consolidatedAt: new Date(),
    }, iv.version));
    return reply.send(jsonSafe({ id, ...result }));
  });

  app.get("/v1/hrms/interviews/:id/panel-result", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCORE_ROLES); // panelists + HR; the blind gate below narrows access
    const { id } = idParam.parse(req.params);
    const iv = await mustInterview(ctx.tenantId, id);
    const rows = await repo.listScores(ctx.tenantId, id);
    // Same blind rule as GET /scores: the aggregate result also reveals scores,
    // so a panel member who has not yet submitted their own score cannot view it.
    const panel = panelMemberIds(iv.panelMembers);
    const isPanel = panel.has(ctx.actorId);
    const isHr = ctx.roles.some((r: string) => HR_ROLES.includes(r));
    if (!isPanel && !isHr) throw new HttpError(403, "NOT_ON_PANEL", "you are not a panel member or HR reviewer for this interview");
    if (isPanel && !rows.some((s) => s.interviewerId === ctx.actorId && s.submitted)) {
      throw new HttpError(403, "SCORE_FIRST", "submit your own score before viewing the panel result");
    }
    const template = (iv.scorecardTemplate ?? []) as Competency[];
    const submitted: InterviewerScore[] = rows.filter((s) => s.submitted).map((s) => ({ interviewerId: s.interviewerId, scores: s.scores, submitted: true }));
    const live = computePanelScore(template, submitted, iv.cutoffScore ?? null);
    return reply.send(jsonSafe({
      id, consolidated: !!iv.consolidatedAt, storedPanelScore: iv.panelScore ?? null,
      ...live,
      recommendation: iv.recommendation ?? live.recommendation, // stored wins once consolidated
    }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustInterview(tenantId: string, id: string) {
    const iv = await repo.findInterview(tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    return iv;
  }
}
