/**
 * Survey & Sampling module — HTTP routes.
 *
 * Endpoints:
 *   POST  /v1/inspection/surveys                   — create survey definition
 *   PATCH /v1/inspection/surveys/:id               — update draft survey
 *   POST  /v1/inspection/surveys/:id/activate      — activate (selects sample)
 *   POST  /v1/inspection/surveys/:id/close         — close survey
 *   POST  /v1/inspection/surveys/:id/responses     — submit response
 *   GET   /v1/inspection/surveys/:id               — get survey
 *   GET   /v1/inspection/surveys                   — list surveys
 *   GET   /v1/inspection/surveys/:id/aggregation   — get computed aggregation
 *   POST  /v1/inspection/surveys/:id/aggregate     — trigger aggregation computation
 *
 * _Requirements: SVC-104_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishSurveyCreate,
  publishSurveyUpdate,
  publishSurveyActivate,
  publishSurveyClose,
  publishSurveyResponseSubmit,
  publishSurveyAggregate,
} from "./commands.js";
import { findSurveyById, findSurveys, findLatestAggregation } from "./repo.js";

// ─── RBAC ────────────────────────────────────────────────────────────────────

const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const questionnaireItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  fieldType: z.string().min(1),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const createSurveySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  targetEntityType: z.string().min(1),
  questionnaire: z.array(questionnaireItemSchema).min(1),
  samplingMethod: z.enum(["random", "stratified", "systematic"]),
  sampleSizePercent: z.number().positive().max(100),
  stratificationField: z.string().optional(),
});

const updateSurveySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  questionnaire: z.array(questionnaireItemSchema).min(1).optional(),
  samplingMethod: z.enum(["random", "stratified", "systematic"]).optional(),
  sampleSizePercent: z.number().positive().max(100).optional(),
  stratificationField: z.string().optional(),
  version: z.number().int().positive(),
});

const activateSurveySchema = z.object({
  entityIds: z.array(z.string().uuid()).min(1),
  entities: z.array(z.record(z.string(), z.unknown())).optional(),
  seed: z.number().int(),
});

const submitResponseSchema = z.object({
  entityId: z.string().uuid(),
  inspectorId: z.string().uuid(),
  answers: z.record(z.unknown()),
  capturedAt: z.string().datetime(),
  deviceId: z.string().optional(),
  syncUploadId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  status: z.string().optional(),
  targetEntityType: z.string().optional(),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerSurveyRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/surveys ──
  app.post("/v1/inspection/surveys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createSurveySchema.parse(req.body);
    const result = await publishSurveyCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/inspection/surveys/:id ──
  app.patch("/v1/inspection/surveys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (survey.status !== "draft") {
      throw new HttpError(422, "INVALID_STATE", "can only update surveys in draft status");
    }

    const body = updateSurveySchema.parse(req.body);
    const result = await publishSurveyUpdate({ surveyId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/surveys/:id/activate ──
  app.post("/v1/inspection/surveys/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (survey.status !== "draft") {
      throw new HttpError(422, "INVALID_STATE", "can only activate surveys in draft status");
    }

    const body = activateSurveySchema.parse(req.body);
    const result = await publishSurveyActivate({ surveyId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/surveys/:id/close ──
  app.post("/v1/inspection/surveys/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (survey.status !== "active") {
      throw new HttpError(422, "INVALID_STATE", "can only close active surveys");
    }

    const result = await publishSurveyClose({ surveyId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/surveys/:id/responses ──
  app.post("/v1/inspection/surveys/:id/responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (survey.status !== "active") {
      throw new HttpError(422, "INVALID_STATE", "can only submit responses to active surveys");
    }

    const body = submitResponseSchema.parse(req.body);
    const result = await publishSurveyResponseSubmit({ surveyId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/surveys/:id/aggregation ── (must be before :id)
  app.get("/v1/inspection/surveys/:id/aggregation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");

    const aggregation = await findLatestAggregation(ctx.tenantId, id);
    if (!aggregation) throw new HttpError(404, "NOT_FOUND", "no aggregation computed yet");

    return reply.send({ data: aggregation });
  });

  // ── POST /v1/inspection/surveys/:id/aggregate ──
  app.post("/v1/inspection/surveys/:id/aggregate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");

    const result = await publishSurveyAggregate({ surveyId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/surveys/:id ──
  app.get("/v1/inspection/surveys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const survey = await findSurveyById(ctx.tenantId, id);
    if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");
    return reply.send({ data: survey });
  });

  // ── GET /v1/inspection/surveys ──
  app.get("/v1/inspection/surveys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findSurveys(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      { status: query.status, targetEntityType: query.targetEntityType },
    );
    return reply.send(result);
  });
}
