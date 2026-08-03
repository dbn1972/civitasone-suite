import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./outcome-repo.js";
import {
  assertOutcomeLinkageValid, assertAchievementValid,
  achievementRatioBps,
} from "./outcome-domain.js";
import { DomainError } from "./domain.js";
import { createOutcomeBody, recordAchievementBody, evaluateOutcomeBody, outcomeQuery, idParam } from "./outcome-validators.js";
import type { BudgetOutcomeRow } from "./outcome-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

export async function budgetOutcomeRoutes(app: FastifyInstance): Promise<void> {
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
    await queue.publish(COMMANDS.budgetOutcomeCreate, {
      messageId: id, type: COMMANDS.budgetOutcomeCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, headId: body.headId, fy: body.fy,
        allocationId: body.allocationId ?? null, schemeId: body.schemeId ?? null,
        outputDesc: body.outputDesc, outcomeDesc: body.outcomeDesc,
        indicator: body.indicator, unit: body.unit,
        baselineValue: body.baselineValue, targetValue: body.targetValue,
        allocatedMinor: body.allocatedMinor, currency: body.currency,
        effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
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

  app.patch("/v1/finance/budget-outcomes/:id/achievement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordAchievementBody.parse(req.body);
    try {
      assertAchievementValid(BigInt(body.achievedValue));
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    const messageId = randomUUID();
    await queue.publish(COMMANDS.budgetOutcomeAchievement, {
      messageId, type: COMMANDS.budgetOutcomeAchievement,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, achievedValue: body.achievedValue },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/finance/budget-outcomes/:id/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["finance_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = evaluateOutcomeBody.parse(req.body);
    const messageId = randomUUID();
    await queue.publish(COMMANDS.budgetOutcomeEvaluate, {
      messageId, type: COMMANDS.budgetOutcomeEvaluate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, note: body.note },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
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
