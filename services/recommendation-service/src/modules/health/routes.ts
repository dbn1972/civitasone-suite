import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { classifyHealth, computeHealthScore, validateFactors, type HealthFactors } from "./domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

const accountParam = z.object({ accountId: z.string().uuid() });

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const factorsSchema = z
  .object({
    recency: z.number().min(0).max(100).optional(),
    frequency: z.number().min(0).max(100).optional(),
    monetary: z.number().min(0).max(100).optional(),
    supportTickets: z.number().min(0).max(100).optional(),
    engagement: z.number().min(0).max(100).optional(),
  })
  .strict();

const recomputeBody = z.object({ factors: factorsSchema });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/recommendations/health/:accountId — latest computed score. */
  app.get("/v1/recommendations/health/:accountId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { accountId } = accountParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "health", accountId);
    const row = await cache.getOrLoad(cacheKey, () => repo.findLatestByAccount(accountId, ctx.tenantId));
    if (!row) throw new HttpError(404, "NOT_FOUND", "no health score computed for this account");

    const view = repo.toView(row);
    return reply.send({ data: { ...view, classification: classifyHealth(view.score) } });
  });

  /** GET /v1/recommendations/health/:accountId/history — score history. */
  app.get("/v1/recommendations/health/:accountId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { accountId } = accountParam.parse(req.params);
    const q = historyQuery.parse(req.query);

    const { rows, total } = await repo.listHistory(ctx.tenantId, accountId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map((r) => {
        const view = repo.toView(r);
        return { ...view, classification: classifyHealth(view.score) };
      }),
      meta: { page, pageSize: q.limit, total },
    });
  });

  /** POST /v1/recommendations/health/:accountId/recompute — score and persist. */
  app.post("/v1/recommendations/health/:accountId/recompute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { accountId } = accountParam.parse(req.params);
    const body = recomputeBody.parse(req.body);

    const factors: HealthFactors = body.factors;
    const validationError = validateFactors(factors);
    if (validationError) throw new HttpError(422, "FACTORS_INVALID", validationError);

    const score = computeHealthScore(factors);
    const classification = classifyHealth(score);
    const id = randomUUID();
    const computedAt = new Date();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        accountId,
        score,
        factors,
        computedAt,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.healthScoreUpdated,
        eventType: EVENTS.healthScoreUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { healthScoreId: id, accountId, score, classification },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "health", accountId));

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        accountId,
        score,
        classification,
        factors,
        computedAt: computedAt.toISOString(),
        version: 1,
      },
    });
  });
}
