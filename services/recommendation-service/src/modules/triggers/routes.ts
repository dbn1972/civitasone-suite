/**
 * triggers/routes.ts — configuration CRUD + evaluation for generic trigger rules.
 *
 * Writes follow the pattern matrix/routes.ts already established for tenant
 * CONFIGURATION: write inside a transaction, enqueue the audit event on the same
 * transaction via the outbox, return the created/updated resource. Configuration
 * writes are single-row, must be readable immediately by the operator who just
 * made them, and have no expensive downstream work to defer — so no command hop.
 *
 * Evaluation is a read: it raises candidate recommendations and returns them
 * ranked. It deliberately does not record anything as served; that stays with
 * POST /v1/recommendations.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { rankActions } from "../nba/ranking-domain.js";
import { validateEffectiveWindow, validateWeightBps, MAX_WEIGHT_BPS } from "../matrix/domain.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  evaluateTriggers,
  triggersToCandidates,
  validateConditions,
  validateRuleShape,
  type EvaluableRule,
} from "./domain.js";
import { TRIGGER_RULE_TYPES, type TriggerConditions, type TriggerRuleType } from "./schema.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

/** Upper bound on rules pulled in for one evaluation. */
const MAX_EVALUABLE_RULES = 500;

const idParam = z.object({ id: z.string().uuid() });
const code = z.string().trim().min(1).max(64);
/** Integer minor-unit money as a STRING, never a number. */
const minorUnits = z.string().regex(/^\d+$/, "must be an integer minor-unit string");

const conditionsSchema = z
  .object({
    minHoldingCount: z.number().int().min(0).optional(),
    minHoldingValueMinor: minorUnits.optional(),
    withinDays: z.number().int().min(0).max(36_500).optional(),
    minAgeYears: z.number().int().min(0).max(150).optional(),
    maxAgeYears: z.number().int().min(0).max(150).optional(),
    minVolume: z.number().int().min(0).optional(),
    minDistinctLanes: z.number().int().min(0).optional(),
    minValueMinor: minorUnits.optional(),
    minWindowDays: z.number().int().min(0).max(36_500).optional(),
  })
  .strict();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  ruleType: z.enum(TRIGGER_RULE_TYPES).optional(),
  targetCategory: code.optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

const createBody = z.object({
  ruleType: z.enum(TRIGGER_RULE_TYPES),
  name: z.string().trim().min(1).max(128),
  sourceCategory: code.optional(),
  targetCategory: code,
  eventCode: code.optional(),
  conditions: conditionsSchema.default({}),
  priority: z.number().int().min(0).max(1000).default(0),
  weightBps: z.number().int().min(0).max(MAX_WEIGHT_BPS).default(0),
  active: z.boolean().default(true),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  effectiveTo: z.string().datetime({ offset: true }).optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  sourceCategory: code.nullable().optional(),
  targetCategory: code.optional(),
  eventCode: code.nullable().optional(),
  conditions: conditionsSchema.optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  weightBps: z.number().int().min(0).max(MAX_WEIGHT_BPS).optional(),
  active: z.boolean().optional(),
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
  effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
  version: z.number().int().positive(),
});

const evaluateBody = z.object({
  subjectId: z.string().uuid(),
  asOf: z.string().datetime({ offset: true }).optional(),
  ruleTypes: z.array(z.enum(TRIGGER_RULE_TYPES)).max(TRIGGER_RULE_TYPES.length).optional(),
  suppressWhenTargetHeld: z.boolean().default(true),
  holdings: z
    .array(
      z
        .object({
          productId: z.string().uuid(),
          category: code,
          valueMinor: minorUnits.optional(),
        })
        .strict(),
    )
    .max(200)
    .default([]),
  lifeEvents: z
    .array(
      z
        .object({
          eventCode: code,
          occurredAt: z.string().datetime({ offset: true }),
          ageYears: z.number().int().min(0).max(150).optional(),
        })
        .strict(),
    )
    .max(200)
    .default([]),
  lanePatterns: z
    .array(
      z
        .object({
          laneCode: code,
          consignmentCount: z.number().int().min(0).max(10_000_000),
          valueMinor: minorUnits.optional(),
          windowDays: z.number().int().min(1).max(3650),
        })
        .strict(),
    )
    .max(200)
    .default([]),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

/** Row → evaluable rule. Narrows the free-text rule_type back to the union. */
function toEvaluable(row: repo.TriggerRuleView | Awaited<ReturnType<typeof repo.findById>>): EvaluableRule | null {
  if (row === null) return null;
  const ruleType = row.ruleType;
  if (!(TRIGGER_RULE_TYPES as readonly string[]).includes(ruleType)) return null;
  return {
    id: row.id,
    ruleType: ruleType as TriggerRuleType,
    name: row.name,
    sourceCategory: row.sourceCategory,
    targetCategory: row.targetCategory,
    eventCode: row.eventCode,
    conditions: row.conditions,
    priority: row.priority,
    weightBps: row.weightBps,
    active: row.active,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/recommendations/trigger-rules — paginated rule configuration. */
  app.get("/v1/recommendations/trigger-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.ruleType !== undefined ? { ruleType: q.ruleType } : {}),
      ...(q.targetCategory !== undefined ? { targetCategory: q.targetCategory } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  /**
   * POST /v1/recommendations/trigger-rules/evaluate — raise recommendations for
   * one subject from the tenant's configured rules.
   *
   * Registered before the parametric `/:id` siblings so the static path is
   * obvious here (find-my-way prefers static routes regardless of order).
   */
  app.post("/v1/recommendations/trigger-rules/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const body = evaluateBody.parse(req.body);

    const asOf = body.asOf === undefined ? new Date() : new Date(body.asOf);

    const rows = await repo.listEvaluable(ctx.tenantId, asOf, MAX_EVALUABLE_RULES, body.ruleTypes);

    const rules: EvaluableRule[] = [];
    for (const row of rows) {
      const evaluable = toEvaluable(row);
      if (evaluable !== null) rules.push(evaluable);
    }

    const raised = evaluateTriggers({
      rules,
      observation: {
        holdings: body.holdings,
        lifeEvents: body.lifeEvents,
        lanePatterns: body.lanePatterns,
      },
      asOf,
      ...(body.ruleTypes !== undefined ? { ruleTypes: body.ruleTypes } : {}),
      suppressWhenTargetHeld: body.suppressWhenTargetHeld,
    });

    // Rank through the EXISTING nba engine so a trigger-raised action is
    // comparable with a matrix-raised one on the same 0..1 scale.
    const rankedById = new Map(
      rankActions(triggersToCandidates(raised)).map((action) => [action.id, action.score]),
    );

    const data = raised.slice(0, body.limit).map((trigger) => ({
      ...trigger,
      score: rankedById.get(trigger.ruleId) ?? 0,
    }));

    return reply.send({
      data,
      meta: {
        page: 1,
        pageSize: body.limit,
        total: raised.length,
        subjectId: body.subjectId,
        asOf: asOf.toISOString(),
        ruleCount: rules.length,
      },
    });
  });

  /** GET /v1/recommendations/trigger-rules/:id — single rule. */
  app.get("/v1/recommendations/trigger-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "trigger-rule", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "NOT_FOUND", "trigger rule not found");

    return reply.send({ data: repo.toView(row) });
  });

  /** POST /v1/recommendations/trigger-rules — create a rule. */
  app.post("/v1/recommendations/trigger-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const shapeError = validateRuleShape({
      ruleType: body.ruleType,
      targetCategory: body.targetCategory,
      ...(body.sourceCategory !== undefined ? { sourceCategory: body.sourceCategory } : {}),
      ...(body.eventCode !== undefined ? { eventCode: body.eventCode } : {}),
    });
    if (shapeError) throw new HttpError(422, "TRIGGER_RULE_INVALID", shapeError);

    const conditionsError = validateConditions(body.ruleType, body.conditions);
    if (conditionsError) throw new HttpError(422, "TRIGGER_RULE_INVALID", conditionsError);

    const weightError = validateWeightBps(body.weightBps);
    if (weightError) throw new HttpError(422, "TRIGGER_RULE_INVALID", weightError);

    const windowError = validateEffectiveWindow({
      effectiveFrom: body.effectiveFrom ?? null,
      effectiveTo: body.effectiveTo ?? null,
    });
    if (windowError) throw new HttpError(422, "TRIGGER_RULE_INVALID", windowError);

    const clash = await repo.findByName(ctx.tenantId, body.name);
    if (clash) throw new HttpError(409, "TRIGGER_RULE_DUPLICATE", "a rule with that name already exists");

    return reply.code(202).send(
      await commands.createTriggerRule(ctx, {
        ruleType: body.ruleType,
        name: body.name,
        sourceCategory: body.sourceCategory ?? null,
        targetCategory: body.targetCategory,
        eventCode: body.eventCode ?? null,
        conditions: body.conditions,
        priority: body.priority,
        weightBps: body.weightBps,
        active: body.active,
        effectiveFrom: body.effectiveFrom ?? null,
        effectiveTo: body.effectiveTo ?? null,
      }),
    );
  });

  /** PATCH /v1/recommendations/trigger-rules/:id — update a rule. */
  app.patch("/v1/recommendations/trigger-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "trigger rule not found");

    const ruleType = existing.ruleType;
    if (!(TRIGGER_RULE_TYPES as readonly string[]).includes(ruleType)) {
      throw new HttpError(422, "TRIGGER_RULE_INVALID", "stored rule has an unknown ruleType");
    }

    // Validate the MERGED rule, not the patch: a partial update must not be able
    // to leave the row in a state the create path would have rejected.
    const mergedSource =
      body.sourceCategory === undefined ? existing.sourceCategory : body.sourceCategory;
    const mergedEvent = body.eventCode === undefined ? existing.eventCode : body.eventCode;
    const mergedTarget = body.targetCategory ?? existing.targetCategory;
    const mergedConditions: TriggerConditions = body.conditions ?? existing.conditions;

    const shapeError = validateRuleShape({
      ruleType: ruleType as TriggerRuleType,
      sourceCategory: mergedSource,
      targetCategory: mergedTarget,
      eventCode: mergedEvent,
    });
    if (shapeError) throw new HttpError(422, "TRIGGER_RULE_INVALID", shapeError);

    const conditionsError = validateConditions(ruleType as TriggerRuleType, mergedConditions);
    if (conditionsError) throw new HttpError(422, "TRIGGER_RULE_INVALID", conditionsError);

    if (body.weightBps !== undefined) {
      const weightError = validateWeightBps(body.weightBps);
      if (weightError) throw new HttpError(422, "TRIGGER_RULE_INVALID", weightError);
    }

    const windowError = validateEffectiveWindow({
      effectiveFrom: body.effectiveFrom === undefined ? existing.effectiveFrom : body.effectiveFrom,
      effectiveTo: body.effectiveTo === undefined ? existing.effectiveTo : body.effectiveTo,
    });
    if (windowError) throw new HttpError(422, "TRIGGER_RULE_INVALID", windowError);

    if (body.version !== existing.version) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        "trigger rule has been modified; retry with current version",
      );
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.sourceCategory !== undefined) patch.sourceCategory = body.sourceCategory;
    if (body.targetCategory !== undefined) patch.targetCategory = body.targetCategory;
    if (body.eventCode !== undefined) patch.eventCode = body.eventCode;
    if (body.conditions !== undefined) patch.conditions = body.conditions;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.weightBps !== undefined) patch.weightBps = body.weightBps;
    if (body.active !== undefined) patch.active = body.active;
    if (body.effectiveFrom !== undefined) patch.effectiveFrom = body.effectiveFrom;
    if (body.effectiveTo !== undefined) patch.effectiveTo = body.effectiveTo;

    return reply.code(202).send(await commands.updateTriggerRule(ctx, id, { version: body.version, patch }));
  });

  /**
   * DELETE /v1/recommendations/trigger-rules/:id — deactivate.
   *
   * Soft: the rule stays readable so attribution rows that name it keep their
   * meaning. Returns 204-equivalent `{ data }` for consistency with the sibling
   * config endpoints.
   */
  app.delete("/v1/recommendations/trigger-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "trigger rule not found");

    return reply.code(202).send(await commands.deactivateTriggerRule(ctx, id));
  });
}
