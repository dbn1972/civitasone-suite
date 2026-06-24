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
import { randomUUID } from "node:crypto";
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

export function assertStageOwner(ctx: RequestContext, a: AppraisalRow, expected: string): void {
  if (a.status !== expected) {
    throw new HttpError(409, "WRONG_STAGE", `appraisal is at stage '${a.status}', expected '${expected}'`);
  }
  const { ownerId } = stageOwner(a);
  const isAdmin = ctx.roles.includes("super_admin") || ctx.roles.includes("hr_admin");
  if (isAdmin) return; // administrative override
  if (ownerId === null || ctx.actorId !== ownerId) {
    throw new HttpError(403, "NOT_STAGE_OWNER",
      `actor is not the assigned owner of stage '${expected}'`);
  }
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
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert((await import("../appraisals/schema.js")).hrmsAppraisals).values({
        id, tenantId: ctx.tenantId, employeeId: body.employeeId,
        appraisalPeriod: body.appraisalPeriod, status: "self_pending",
        reportingOfficerId: body.reportingOfficerId,
        reviewingOfficerId: body.reviewingOfficerId,
        acceptingAuthorityId: body.acceptingAuthorityId,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: null, toStage: "self_pending",
        actorId: ctx.actorId, actorRole: "initiator",
        remarks: "APAR initiated", payload: { officers: body },
      });
    });
    return reply.code(201).send({ id, status: "self_pending" });
  });

  // --- stage 1: officer submits self-appraisal -> reporting_officer ---------
  app.post("/v1/hrms/apar/:id/self-appraisal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ selfAppraisal: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    assertStageOwner(ctx, a, "self_pending");
    await db.transaction(async (tx) => {
      await repo.updateAppraisal(tx, id, {
        selfAppraisal: body.selfAppraisal, status: "reporting_officer", updatedBy: ctx.actorId,
      });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: "self_pending", toStage: "reporting_officer",
        actorId: ctx.actorId, actorRole: "officer", remarks: "self-appraisal submitted",
        payload: { selfAppraisal: body.selfAppraisal },
      });
    });
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
    assertStageOwner(ctx, a, "reporting_officer");
    await db.transaction(async (tx) => {
      for (const s of body.scores) {
        await repo.upsertScore(tx, {
          tenantId: ctx.tenantId, appraisalId: id, attribute: s.attribute,
          weight: String(s.weight), score: s.score,
          ...(s.remarks !== undefined ? { remarks: s.remarks } : {}),
          scoredBy: ctx.actorId,
        });
      }
      await repo.updateAppraisal(tx, id, {
        reportingPenPicture: body.penPicture, status: "reviewing_officer", updatedBy: ctx.actorId,
      });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: "reporting_officer", toStage: "reviewing_officer",
        actorId: ctx.actorId, actorRole: "reporting_officer", remarks: "scores + pen-picture recorded",
        payload: { penPicture: body.penPicture, scores: body.scores },
      });
    });
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
    assertStageOwner(ctx, a, "reviewing_officer");
    await db.transaction(async (tx) => {
      if (body.decision === "vary" && body.variations) {
        const existing = await repo.listScores(ctx.tenantId, id);
        const byAttr = new Map(existing.map((e) => [e.attribute, e]));
        for (const v of body.variations) {
          const row = byAttr.get(v.attribute);
          if (!row) continue;
          await repo.upsertScore(tx, {
            tenantId: ctx.tenantId, appraisalId: id, attribute: v.attribute,
            weight: row.weight, score: v.score, scoredBy: ctx.actorId,
            remarks: `varied by reviewing officer (was ${row.score})`,
          });
        }
      }
      await repo.updateAppraisal(tx, id, {
        reviewingRemarks: body.remarks, status: "accepting_authority", updatedBy: ctx.actorId,
      });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: "reviewing_officer", toStage: "accepting_authority",
        actorId: ctx.actorId, actorRole: "reviewing_officer",
        remarks: body.remarks, payload: { decision: body.decision, variations: body.variations ?? [] },
      });
    });
    return reply.send({ id, status: "accepting_authority", decision: body.decision });
  });

  // --- stage 4: accepting authority finalises; grade computed server-side ---
  app.post("/v1/hrms/apar/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ remarks: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    assertStageOwner(ctx, a, "accepting_authority");
    const scoreRows = await repo.listScores(ctx.tenantId, id);
    if (scoreRows.length === 0) throw new HttpError(409, "NO_SCORES", "no attribute scores to grade");
    const scores: ScoreInput[] = scoreRows.map((s) => ({
      attribute: s.attribute, weight: Number(s.weight), score: s.score,
    }));
    const grade = computeOverallGrade(scores);
    await db.transaction(async (tx) => {
      await repo.updateAppraisal(tx, id, {
        acceptingRemarks: body.remarks,
        overallGrade: String(grade.overallGrade),
        overallBand: grade.band,
        status: "disclosed",
        disclosedAt: new Date(),
        updatedBy: ctx.actorId,
      });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: "accepting_authority", toStage: "disclosed",
        actorId: ctx.actorId, actorRole: "accepting_authority", remarks: body.remarks,
        payload: { computed: { overallGrade: grade.overallGrade, band: grade.band, totalWeight: grade.totalWeight, attributeCount: grade.attributeCount } },
      });
    });
    return reply.send({ id, status: "disclosed", overallGrade: grade.overallGrade, band: grade.band });
  });

  // --- stage 5: officer files representation (optional) ---------------------
  app.post("/v1/hrms/apar/:id/representation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ representation: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    assertStageOwner(ctx, a, "disclosed");
    await db.transaction(async (tx) => {
      await repo.updateAppraisal(tx, id, {
        representation: body.representation, status: "representation", updatedBy: ctx.actorId,
      });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: "disclosed", toStage: "representation",
        actorId: ctx.actorId, actorRole: "officer", remarks: "representation filed",
        payload: { representation: body.representation },
      });
    });
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
    await db.transaction(async (tx) => {
      await repo.updateAppraisal(tx, id, { status: "finalised", updatedBy: ctx.actorId });
      await repo.appendHistory(tx, {
        tenantId: ctx.tenantId, appraisalId: id, fromStage: a.status, toStage: "finalised",
        actorId: ctx.actorId, actorRole: "hr", remarks: "APAR finalised", payload: {},
      });
    });
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
