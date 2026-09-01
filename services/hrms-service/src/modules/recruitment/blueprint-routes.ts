import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Assessment management — blueprint & question bank (R-RA-0120/0121/0123/0125).
 *
 *   POST  /v1/hrms/assessments/blueprints                create a draft blueprint
 *   PATCH /v1/hrms/assessments/blueprints/:id            edit a draft/inactive blueprint
 *   POST  /v1/hrms/assessments/blueprints/:id/activate   validate scoring config + activate (SoD)
 *   POST  /v1/hrms/assessments/blueprints/:id/deactivate deactivate an active blueprint
 *   GET   /v1/hrms/assessments/blueprints[?status]       list
 *   GET   /v1/hrms/assessments/blueprints/:id            read (+ audit trail)
 *
 *   POST  /v1/hrms/assessments/questions                 create a draft question
 *   PATCH /v1/hrms/assessments/questions/:id             edit a draft question
 *   POST  /v1/hrms/assessments/questions/:id/validate    validate answer key (SoD)
 *   POST  /v1/hrms/assessments/questions/:id/retire      retire a question
 *   GET   /v1/hrms/assessments/questions[?topic|qtype|difficulty|status]  list bank
 *   GET   /v1/hrms/assessments/questions/:id             read
 *
 * Design-time master data: every activation / validation is segregation-of-duties
 * checked (approver != author) and written to an immutable audit trail. Invalid
 * scoring combinations are rejected at activation (R-RA-0125).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  QTYPES, DIFFICULTIES, TIE_BREAK_RULES,
  validateBlueprintDraft, questionReadyToValidate, totalMarks,
} from "./blueprint-domain.js";
import * as repo from "./blueprint-repo.js";

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

const competencySchema = z.object({
  key: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  weightBps: z.coerce.number().int().min(0).max(10000).optional(),
});
const sectionSchema = z.object({
  key: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  questionCount: z.coerce.number().int().positive(),
  marksPerQuestion: z.coerce.number().positive(),
  sectionCutoffPct: z.coerce.number().min(0).max(100).optional(),
  difficultyMix: z.object({
    easy: z.coerce.number().int().min(0).optional(),
    medium: z.coerce.number().int().min(0).optional(),
    hard: z.coerce.number().int().min(0).optional(),
  }).optional(),
});
const scoringConfigSchema = z.object({
  totalCutoffPct: z.coerce.number().min(0).max(100).optional(),
  negativeMarking: z.object({ enabled: z.boolean(), fraction: z.coerce.number().min(0).max(1).optional() }).optional(),
  sections: z.array(sectionSchema).max(20).optional(),
  tieBreak: z.array(z.enum(TIE_BREAK_RULES)).max(TIE_BREAK_RULES.length).optional(),
});

export async function assessmentBlueprintRoutes(app: FastifyInstance): Promise<void> {
  // ---- blueprints -------------------------------------------------------
  app.post("/v1/hrms/assessments/blueprints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      code: z.string().min(1).max(64),
      title: z.string().min(1).max(256),
      roleTitle: z.string().max(200).optional(),
      designationId: z.string().uuid().optional(),
      competencies: z.array(competencySchema).max(50).default([]),
      allowedTypes: z.array(z.enum(QTYPES)).min(1).max(QTYPES.length),
      durationMinutes: z.coerce.number().int().positive(),
      scoringConfig: scoringConfigSchema.default({}),
    }).parse(req.body);

    const id = randomUUID();
    try {
      await publishF3Write(ctx, "recruitment_blueprint_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "DUPLICATE_CODE", `a blueprint with code "${body.code}" already exists`) as any;
      throw e;
    }
    return reply.code(201).send({ id, status: "draft" });
  });

  app.patch("/v1/hrms/assessments/blueprints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      title: z.string().min(1).max(256).optional(),
      roleTitle: z.string().max(200).optional(),
      designationId: z.string().uuid().optional(),
      competencies: z.array(competencySchema).max(50).optional(),
      allowedTypes: z.array(z.enum(QTYPES)).min(1).max(QTYPES.length).optional(),
      durationMinutes: z.coerce.number().int().positive().optional(),
      scoringConfig: scoringConfigSchema.optional(),
    }).parse(req.body ?? {});
    const bp = await mustBlueprint(ctx.tenantId, id);
    // An ACTIVE blueprint is immutable so in-flight assessments stay reproducible
    // (R-RA-0125): deactivate first to amend, then re-activate.
    if (bp.status === "active") throw new HttpError(409, "BLUEPRINT_ACTIVE", "deactivate the blueprint before editing");

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    for (const k of ["title", "roleTitle", "designationId", "durationMinutes"] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) patch[k] = (body as Record<string, unknown>)[k];
    }
    if (body.competencies !== undefined) patch.competencies = body.competencies;
    if (body.allowedTypes !== undefined) patch.allowedTypes = body.allowedTypes;
    if (body.scoringConfig !== undefined) patch.scoringConfig = body.scoringConfig;

    const changedFields = Object.keys(patch).filter((k) => k !== "updatedBy");
    await publishF3Write(ctx, "recruitment_blueprint_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, updated: true }) as any;
  });

  app.post("/v1/hrms/assessments/blueprints/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ effectiveFrom: z.string().datetime().optional() }).parse(req.body ?? {});
    const bp = await mustBlueprint(ctx.tenantId, id);
    if (bp.status === "active") throw new HttpError(409, "ALREADY_ACTIVE", "blueprint is already active");
    // Segregation of duties (R-RA-0120): the activator must not be anyone who
    // authored the content being approved — neither the original creator NOR the
    // last editor. Checking createdBy alone would let a second user PATCH the
    // scoring config and then activate their own edit with no independent review.
    if (bp.createdBy === ctx.actorId || bp.updatedBy === ctx.actorId) {
      throw new HttpError(403, "SOD_VIOLATION", "a user who authored or last edited the blueprint cannot activate it; an independent authorised user must activate");
    }
    // Block invalid scoring combinations (R-RA-0125).
    const errors = validateBlueprintDraft({
      code: bp.code, title: bp.title,
      competencies: bp.competencies as unknown, allowedTypes: bp.allowedTypes as unknown,
      durationMinutes: bp.durationMinutes, scoringConfig: bp.scoringConfig as never,
    });
    if (errors.length > 0) throw new HttpError(422, "INVALID_BLUEPRINT", errors.join("; "));

    const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
    await publishF3Write(ctx, "recruitment_blueprint_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "active", effectiveFrom })) as any;
  });

  app.post("/v1/hrms/assessments/blueprints/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().max(2000).optional() }).parse(req.body ?? {});
    const bp = await mustBlueprint(ctx.tenantId, id);
    if (bp.status !== "active") throw new HttpError(409, "NOT_ACTIVE", "only an active blueprint can be deactivated");
    await publishF3Write(ctx, "recruitment_blueprint_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "inactive" }) as any;
  });

  app.get("/v1/hrms/assessments/blueprints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = z.object({ status: z.enum(["draft", "active", "inactive"]).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    const rows = await repo.listBlueprints(ctx.tenantId, { ...(q.status ? { status: q.status } : {}) }, q.limit ?? 100);
    return reply.send(jsonSafe({ data: rows }));
  });

  app.get("/v1/hrms/assessments/blueprints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const bp = await mustBlueprint(ctx.tenantId, id);
    const audit = await repo.listEvents(ctx.tenantId, "blueprint", id);
    return reply.send(jsonSafe({ ...bp, totalMarks: totalMarks(bp.scoringConfig as never), audit }));
  });

  // ---- questions --------------------------------------------------------
  const questionBody = z.object({
    topic: z.string().min(1).max(120),
    qtype: z.enum(QTYPES),
    stem: z.string().min(1).max(20000),
    options: z.array(z.object({ id: z.string().min(1).max(16), text: z.string().max(4000) })).max(20).optional(),
    answerKey: z.record(z.unknown()).optional(),
    difficulty: z.enum(DIFFICULTIES),
    marks: z.coerce.number().int().positive(),
  });

  app.post("/v1/hrms/assessments/questions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = questionBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "recruitment_blueprint_routes__4", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "draft" }) as any;
  });

  app.patch("/v1/hrms/assessments/questions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = questionBody.partial().parse(req.body ?? {});
    const q = await mustQuestion(ctx.tenantId, id);
    // A validated question is locked (its answer key drives scoring); retire to replace.
    if (q.status !== "draft") throw new HttpError(409, "QUESTION_LOCKED", `only a draft question can be edited (status "${q.status}")`);

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    for (const k of ["topic", "qtype", "stem", "difficulty", "marks"] as const) {
      if ((body as Record<string, unknown>)[k] !== undefined) patch[k] = (body as Record<string, unknown>)[k];
    }
    if (body.options !== undefined) patch.options = body.options;
    if (body.answerKey !== undefined) patch.answerKey = body.answerKey;

    const changedFields = Object.keys(patch).filter((k) => k !== "updatedBy");
    await publishF3Write(ctx, "recruitment_blueprint_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, updated: true }) as any;
  });

  app.post("/v1/hrms/assessments/questions/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const q = await mustQuestion(ctx.tenantId, id);
    if (q.status === "retired") throw new HttpError(409, "RETIRED", "a retired question cannot be validated");
    if (q.status === "validated") throw new HttpError(409, "ALREADY_VALIDATED", "question is already validated");
    // Segregation of duties (R-RA-0121): the validator must not be anyone who
    // authored the content being approved — neither the original creator NOR the
    // last editor (who may have rewritten the stem / answer key).
    if (q.createdBy === ctx.actorId || q.updatedBy === ctx.actorId) {
      throw new HttpError(403, "SOD_VIOLATION", "a user who authored or last edited the question cannot validate it; an independent authorised user must validate");
    }
    const errors = questionReadyToValidate({
      qtype: q.qtype, stem: q.stem, topic: q.topic, difficulty: q.difficulty, marks: q.marks,
      options: q.options as unknown, answerKey: q.answerKey as never,
    });
    if (errors.length > 0) throw new HttpError(422, "INCOMPLETE_QUESTION", errors.join("; "));

    await publishF3Write(ctx, "recruitment_blueprint_routes__6", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "validated" }) as any;
  });

  app.post("/v1/hrms/assessments/questions/:id/retire", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().max(2000).optional() }).parse(req.body ?? {});
    const q = await mustQuestion(ctx.tenantId, id);
    if (q.status === "retired") throw new HttpError(409, "ALREADY_RETIRED", "question is already retired");
    await publishF3Write(ctx, "recruitment_blueprint_routes__7", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "retired" }) as any;
  });

  app.get("/v1/hrms/assessments/questions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = z.object({
      topic: z.string().max(120).optional(),
      qtype: z.enum(QTYPES).optional(),
      difficulty: z.enum(DIFFICULTIES).optional(),
      status: z.enum(["draft", "validated", "retired"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).parse(req.query);
    const rows = await repo.listQuestions(ctx.tenantId, {
      ...(q.topic ? { topic: q.topic } : {}),
      ...(q.qtype ? { qtype: q.qtype } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.status ? { status: q.status } : {}),
    }, q.limit ?? 200);
    return reply.send(jsonSafe({ data: rows }));
  });

  app.get("/v1/hrms/assessments/questions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const q = await mustQuestion(ctx.tenantId, id);
    return reply.send(jsonSafe(q));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustBlueprint(tenantId: string, id: string) {
    const bp = await repo.findBlueprint(tenantId, id);
    if (!bp) throw new HttpError(404, "NOT_FOUND", "blueprint not found");
    return bp;
  }
  async function mustQuestion(tenantId: string, id: string) {
    const q = await repo.findQuestion(tenantId, id);
    if (!q) throw new HttpError(404, "NOT_FOUND", "question not found");
    return q;
  }
}
