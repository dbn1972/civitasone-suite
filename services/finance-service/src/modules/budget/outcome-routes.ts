import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./outcome-repo.js";
import {
  assertOutcomeLinkageValid, assertAchievementValid, assertEvaluatorDistinct,
  classifyAchievement, achievementRatioBps,
} from "./outcome-domain.js";
import { DomainError } from "./domain.js";
import { createOutcomeBody, recordAchievementBody, evaluateOutcomeBody, outcomeQuery, idParam } from "./outcome-validators.js";
import type { BudgetOutcomeRow } from "./outcome-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
const AUDIT_TOPIC = "audit.event.record";

export async function budgetOutcomeRoutes(app: FastifyInstance): Promise<void> {
  // Create an output/outcome framework row linked to a head + allocation.
  app.post("/v1/finance/budget-outcomes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createOutcomeBody.parse(req.body);
    const linkage = {
      indicator: body.indicator, unit: body.unit,
      targetValue: BigInt(body.targetValue), baselineValue: BigInt(body.baselineValue),
      allocatedMinor: BigInt(body.allocatedMinor),
    };
    try {
      assertOutcomeLinkageValid(linkage);
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertOutcome(tx, {
        id, tenantId: ctx.tenantId, headId: body.headId, fy: body.fy,
        allocationId: body.allocationId ?? null, schemeId: body.schemeId ?? null,
        outputDesc: body.outputDesc, outcomeDesc: body.outcomeDesc,
        indicator: body.indicator, unit: body.unit,
        baselineValue: linkage.baselineValue, targetValue: linkage.targetValue,
        achievedValue: 0n, allocatedMinor: linkage.allocatedMinor,
        currency: body.currency, status: "active",
        effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "create", id);
    });
    const row = await repo.findOutcomeById(id, ctx.tenantId);
    return reply.code(201).send({ data: serialize(row!) });
  });

  app.get("/v1/finance/budget-outcomes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = outcomeQuery.parse(req.query);
    const rows = await repo.listOutcomes(ctx.tenantId, { fy: q.fy, headId: q.headId }, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  app.get("/v1/finance/budget-outcomes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findOutcomeById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "outcome not found");
    return reply.send({ data: serialize(row) });
  });

  // Record a fresh achievement reading against the indicator.
  app.patch("/v1/finance/budget-outcomes/:id/achievement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordAchievementBody.parse(req.body);
    const achieved = BigInt(body.achievedValue);
    try {
      assertAchievementValid(achieved);
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    await db.transaction(async (tx) => {
      const row = await repo.findOutcomeByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "outcome not found");
      await repo.updateOutcome(tx, id, { achievedValue: achieved, updatedBy: ctx.actorId });
      await audit(tx, ctx, "record_achievement", id);
    });
    const updated = await repo.findOutcomeById(id, ctx.tenantId);
    return reply.send({ data: serialize(updated!) });
  });

  // Maker-checker evaluation: a checker (≠ creator) certifies the outcome. The
  // rating is COMPUTED from the achievement vs the target (never hand-set), and
  // finance.budget.outcome_evaluated is emitted via the outbox.
  app.patch("/v1/finance/budget-outcomes/:id/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["finance_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = evaluateOutcomeBody.parse(req.body);
    let rating: string;
    await db.transaction(async (tx) => {
      const row = await repo.findOutcomeByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "outcome not found");
      try {
        assertEvaluatorDistinct(row.createdBy, ctx.actorId);
      } catch (err) {
        if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
        throw err;
      }
      rating = classifyAchievement(
        { targetValue: row.targetValue, baselineValue: row.baselineValue },
        row.achievedValue,
      );
      await repo.updateOutcome(tx, id, {
        status: "evaluated", evaluationRating: rating, evaluationNote: body.note,
        evaluatedBy: ctx.actorId, evaluatedAt: new Date(), updatedBy: ctx.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.outcomeEvaluated, eventType: EVENTS.outcomeEvaluated,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          outcomeId: id, headId: row.headId, fy: row.fy, rating,
          achievedValue: row.achievedValue.toString(), targetValue: row.targetValue.toString(),
        },
      });
      await audit(tx, ctx, "evaluate", id);
    });
    const updated = await repo.findOutcomeById(id, ctx.tenantId);
    return reply.send({ data: serialize(updated!), rating: rating! });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

async function audit(tx: unknown, ctx: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "finance", action, resourceType: "budget_outcome", resourceId, outcome: "success" },
  });
}

function serialize(r: BudgetOutcomeRow) {
  return {
    id: r.id, headId: r.headId, fy: r.fy,
    allocationId: r.allocationId, schemeId: r.schemeId,
    outputDesc: r.outputDesc, outcomeDesc: r.outcomeDesc,
    indicator: r.indicator, unit: r.unit,
    baselineValue: r.baselineValue.toString(),
    targetValue: r.targetValue.toString(),
    achievedValue: r.achievedValue.toString(),
    achievementBps: achievementRatioBps({ targetValue: r.targetValue, baselineValue: r.baselineValue }, r.achievedValue).toString(),
    allocatedMinor: r.allocatedMinor.toString(),
    currency: r.currency,
    status: r.status,
    evaluationRating: r.evaluationRating,
    evaluationNote: r.evaluationNote,
    evaluatedBy: r.evaluatedBy,
    evaluatedAt: r.evaluatedAt,
    effectiveFrom: r.effectiveFrom,
  };
}
