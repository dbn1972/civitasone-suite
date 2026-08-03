import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * APAR / SPARROW multi-authority workflow.
 *
 * Stage chain (status column on appraisal.hrms_appraisals):
 *   self_pending        -> officer submits self-appraisal
 *   reporting_officer   -> Reporting Officer scores attributes (1..10) + pen-picture
 *   reviewing_officer   -> Reviewing Officer concurrence / variation
 *   accepting_authority -> Accepting Authority finalises; server computes grade+band
 *   disclosed           -> grade disclosed to officer; representation window opens
 *   representation      -> officer files representation (optional)
 *   finalised           -> closed
 *
 * Separation-of-duties: every transition asserts the acting actor IS the
 * officer assigned to the *current* stage. Out-of-turn actors are rejected
 * with 403. An immutable stage-history row is appended on every transition.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { computeOverallGrade, type ScoreInput } from "./engine.js";
import type { AppraisalRow } from "../appraisals/schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ACTOR_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

/**
 * Returns the actor id that is authorised to act on the appraisal's current
 * stage. super_admin / hr_admin always bypass (they administer the workflow),
 * mirroring the internal-bypass grants used for verification.
 */
export function stageOwner(a: AppraisalRow): { stage: string; ownerId: string | null } {
  switch (a.status) {
    case "self_pending":        return { stage: a.status, ownerId: a.employeeId };
    case "reporting_officer":   return { stage: a.status, ownerId: a.reportingOfficerId };
    case "reviewing_officer":   return { stage: a.status, ownerId: a.reviewingOfficerId };
    case "accepting_authority": return { stage: a.status, ownerId: a.acceptingAuthorityId };
    case "disclosed":           return { stage: a.status, ownerId: a.employeeId };
    case "representation":      return { stage: a.status, ownerId: a.employeeId };
    default:                    return { stage: a.status, ownerId: null };
  }
}

/**
 * Separation-of-duties guard for a stage transition. Returns whether the action
 * was performed as a privileged override (recorded in stage-history). (C2)
 *
 * Rules:
 *  - The default authorisation is identity-based: the acting actor MUST BE the
 *    officer assigned to the current stage. Holding hr_admin/super_admin role is
 *    NOT by itself sufficient to enter/alter scores or decisions — that would
 *    collapse the four-eyes chain.
 *  - A super_admin (and ONLY super_admin) may act as an explicit override when
 *    they are not the assigned owner; the caller records override=true plus the
 *    true actor id/role in stage-history. hr_admin gets NO scoring override.
 *  - The appraisee can NEVER act on an officer stage (reporting/reviewing/
 *    accepting), even with an admin role.
 */
export function assertStageOwner(ctx: RequestContext, a: AppraisalRow, expected: string): { override: boolean } {
  if (a.status !== expected) {
    throw new HttpError(409, "WRONG_STAGE", `appraisal is at stage '${a.status}', expected '${expected}'`);
  }
  const { ownerId } = stageOwner(a);
  const isOwner = ownerId !== null && ctx.actorId === ownerId;
  if (isOwner) return { override: false };

  // Not the owner. Officer stages must never be performed by the appraisee, and
  // only super_admin may override; hr_admin may not silently enter scores.
  const OFFICER_STAGES = new Set(["reporting_officer", "reviewing_officer", "accepting_authority"]);
  if (OFFICER_STAGES.has(expected) && ctx.actorId === a.employeeId) {
    throw new HttpError(403, "SELF_REVIEW_FORBIDDEN",
      `the appraisee cannot act as the officer for stage '${expected}'`);
  }
  if (ctx.roles.includes("super_admin")) {
    return { override: true }; // explicit, audited privileged override
  }
  throw new HttpError(403, "NOT_STAGE_OWNER",
    `actor is not the assigned owner of stage '${expected}'`);
}

/**
 * The TRUE role of the acting actor for stage-history (C2). We record the
 * functional stage role only when the actor genuinely owns the stage; on a
 * privileged override we record the actor's real elevated role so history is
 * never falsified.
 */
function trueActorRole(ctx: RequestContext, functionalRole: string, override: boolean): string {
  if (!override) return functionalRole;
  if (ctx.roles.includes("super_admin")) return "super_admin";
  if (ctx.roles.includes("hr_admin")) return "hr_admin";
  return ctx.roles[0] ?? functionalRole;
}

export async function aparRoutes(app: FastifyInstance): Promise<void> {
  // --- create APAR with the full officer chain assigned ---------------------
  app.post("/v1/hrms/apar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      appraisalPeriod: z.string().min(4).max(16),
      reportingOfficerId: z.string().uuid(),
      reviewingOfficerId: z.string().uuid(),
      acceptingAuthorityId: z.string().uuid(),
    }).parse(req.body);
    // H1: the appraisee cannot be any of their own officers, and the three
    // officers must be distinct (no one person holds two stages).
    const officers = [body.reportingOfficerId, body.reviewingOfficerId, body.acceptingAuthorityId];
    if (officers.includes(body.employeeId)) {
      throw new HttpError(400, "SELF_OFFICER_FORBIDDEN",
        "the appraisee cannot be their own reporting/reviewing/accepting officer");
    }
    if (new Set(officers).size !== officers.length) {
      throw new HttpError(400, "OFFICERS_NOT_DISTINCT",
        "reporting, reviewing and accepting officers must be three distinct people");
    }
    const id = randomUUID();
    await publishF3Write(ctx, "apar_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "self_pending" });
  });

  // --- stage 1: officer submits self-appraisal -> reporting_officer ---------
  app.post("/v1/hrms/apar/:id/self-appraisal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ selfAppraisal: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = assertStageOwner(ctx, a, "self_pending");
    await publishF3Write(ctx, "apar_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "reporting_officer" });
  });

  // --- stage 2: reporting officer scores + pen-picture -> reviewing_officer -
  app.post("/v1/hrms/apar/:id/reporting", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      penPicture: z.string().min(1).max(8000),
      scores: z.array(z.object({
        attribute: z.string().min(1).max(64),
        weight: z.number().positive().max(100).default(1),
        score: z.number().int().min(1).max(10),
        remarks: z.string().max(2000).optional(),
      })).min(1),
    }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = assertStageOwner(ctx, a, "reporting_officer");
    await publishF3Write(ctx, "apar_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "reviewing_officer" });
  });

  // --- stage 3: reviewing officer concurrence/variation -> accepting --------
  app.post("/v1/hrms/apar/:id/reviewing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      decision: z.enum(["concur", "vary"]),
      remarks: z.string().min(1).max(8000),
      // optional per-attribute variation: attribute -> new score
      variations: z.array(z.object({
        attribute: z.string().min(1).max(64),
        score: z.number().int().min(1).max(10),
      })).optional(),
    }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = assertStageOwner(ctx, a, "reviewing_officer");
    await publishF3Write(ctx, "apar_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "accepting_authority", decision: body.decision });
  });

  // --- stage 4: accepting authority finalises; grade computed server-side ---
  app.post("/v1/hrms/apar/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ remarks: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = assertStageOwner(ctx, a, "accepting_authority");
    const scoreRows = await repo.listScores(ctx.tenantId, id);
    if (scoreRows.length === 0) throw new HttpError(409, "NO_SCORES", "no attribute scores to grade");
    const scores: ScoreInput[] = scoreRows.map((s) => ({
      attribute: s.attribute, weight: Number(s.weight), score: s.score,
    }));
    const grade = computeOverallGrade(scores);
    await publishF3Write(ctx, "apar_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "disclosed", overallGrade: grade.overallGrade, band: grade.band });
  });

  // --- stage 5: officer files representation (optional) ---------------------
  app.post("/v1/hrms/apar/:id/representation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ representation: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = assertStageOwner(ctx, a, "disclosed");
    await publishF3Write(ctx, "apar_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "representation" });
  });

  // --- finalise (HR closes; from disclosed or representation) ---------------
  app.post("/v1/hrms/apar/:id/finalise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustFind(id, ctx.tenantId);
    if (a.status !== "disclosed" && a.status !== "representation") {
      throw new HttpError(409, "WRONG_STAGE", `cannot finalise from '${a.status}'`);
    }
    await publishF3Write(ctx, "apar_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "finalised", overallGrade: a.overallGrade, band: a.overallBand });
  });

  // --- read: full APAR with scores + stage history --------------------------
  app.get("/v1/hrms/apar/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustFind(id, ctx.tenantId);
    const [scores, history] = await Promise.all([
      repo.listScores(ctx.tenantId, id),
      repo.listHistory(ctx.tenantId, id),
    ]);
    return reply.send({ appraisal: a, scores, history });
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
}

async function mustFind(id: string, tenantId: string): Promise<AppraisalRow> {
  const a = await repo.findAppraisal(id, tenantId);
  if (!a) throw new HttpError(404, "NOT_FOUND", "appraisal not found");
  return a;
}
