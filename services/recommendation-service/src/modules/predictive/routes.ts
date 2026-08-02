import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  CONFIDENCE_SCALE,
  MODEL_TYPES,
  SCORE_SCALE,
  SUBJECT_TYPES,
  normaliseDecimal,
  validatePredictiveScore,
} from "./domain.js";

const READ_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
/** ml-service authenticates as a service principal to publish scores. */
const WRITE_ROLES = ["recommendation_admin", "ml_service", "super_admin"];

const MAX_LIMIT = 200;

/**
 * A score arrives either as a decimal STRING (preferred — lossless) or as a JSON
 * number for older callers. Both are normalised to a fixed-scale string before
 * they reach the database, so numeric(12,4) precision is never rounded through
 * a binary float.
 */
const decimalInput = z.union([
  z.string().trim().min(1).max(32),
  z.number().finite(),
]);

const subjectParams = z.object({
  subjectType: z.enum(["profile", "account", "deal"]),
  subjectId: z.string().uuid(),
});

const upsertParams = subjectParams.extend({
  modelType: z.enum(["ltv", "renewal", "fraud", "churn"]),
});

const upsertBody = z.object({
  score: decimalInput,
  confidence: decimalInput.optional(),
  modelVersion: z.string().trim().min(1).max(64).optional(),
  features: z.record(z.unknown()).optional(),
  computedAt: z.string().datetime().optional(),
});

const rankedQuery = z.object({
  modelType: z.enum(["ltv", "renewal", "fraud", "churn"]).optional(),
  subjectType: z.enum(["profile", "account", "deal"]).optional(),
  minScore: decimalInput.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function predictiveRoutes(app: FastifyInstance): Promise<void> {
  /**
   * PUT /v1/recommendations/predictive/:subjectType/:subjectId/:modelType
   * Upsert a model score. ml-service is the primary caller.
   */
  app.put("/v1/recommendations/predictive/:subjectType/:subjectId/:modelType", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const params = upsertParams.parse(req.params);
    const body = upsertBody.parse(req.body);

    const validationError = validatePredictiveScore({
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      modelType: params.modelType,
      score: body.score,
      ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
    });
    if (validationError) throw new HttpError(422, "PREDICTIVE_SCORE_INVALID", validationError);

    // Normalisation happened inside validate too; re-run it to get the canonical
    // string that is actually written (validate only reports problems).
    const score = normaliseDecimal(body.score, SCORE_SCALE);
    if (score === null) throw new HttpError(422, "PREDICTIVE_SCORE_INVALID", "score must be a decimal value");
    const confidence =
      body.confidence === undefined ? null : normaliseDecimal(body.confidence, CONFIDENCE_SCALE);

    const computedAt = (body.computedAt === undefined ? new Date() : new Date(body.computedAt)).toISOString();
    return reply.code(202).send(
      await commands.upsertPredictiveScore(ctx, {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        modelType: params.modelType,
        score,
        confidence,
        modelVersion: body.modelVersion ?? null,
        features: body.features ?? {},
        computedAt,
      }),
    );
  });

  /** GET /v1/recommendations/predictive/:subjectType/:subjectId — every model score for a subject. */
  app.get("/v1/recommendations/predictive/:subjectType/:subjectId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const params = subjectParams.parse(req.params);

    const cacheKey = cache.makeKey(
      ctx.tenantId,
      "predictive",
      `${params.subjectType}:${params.subjectId}`,
    );
    const rows =
      (await cache.getOrLoad(cacheKey, () =>
        repo.listBySubject(ctx.tenantId, params.subjectType, params.subjectId),
      )) ?? [];

    const data = rows.map(repo.toView);
    return reply.send({ data, meta: { page: 1, pageSize: data.length, total: data.length } });
  });

  /** GET /v1/recommendations/predictive — ranked scores across subjects. */
  app.get("/v1/recommendations/predictive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = rankedQuery.parse(req.query);

    let minScore: string | undefined;
    if (q.minScore !== undefined) {
      const normalised = normaliseDecimal(q.minScore, SCORE_SCALE);
      if (normalised === null) throw new HttpError(400, "VALIDATION_FAILED", "minScore must be a decimal value");
      minScore = normalised;
    }

    const { rows, total } = await repo.listRanked(ctx.tenantId, q.limit, q.offset, {
      ...(q.modelType !== undefined ? { modelType: q.modelType } : {}),
      ...(q.subjectType !== undefined ? { subjectType: q.subjectType } : {}),
      ...(minScore !== undefined ? { minScore } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  /** GET /v1/recommendations/predictive/model-types — the supported enumerations. */
  app.get("/v1/recommendations/predictive/model-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: { subjectTypes: SUBJECT_TYPES, modelTypes: MODEL_TYPES } });
  });
}
