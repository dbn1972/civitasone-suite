import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  DEFAULT_TTL_HOURS,
  isExpired,
  rankRecommendations,
  scoreRecommendation,
  ttlCutoff,
  validateStatusTransition,
} from "./domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

const profileParam = z.object({ profileId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  channel: z.string().min(1).max(64).optional(),
});

const createBody = z.object({
  profileId: z.string().uuid(),
  recommendationType: z.string().min(1).max(64),
  productId: z.string().uuid().optional(),
  channel: z.string().min(1).max(64).optional(),
  /** Explicit score wins; otherwise it is computed from the signals below. */
  score: z.number().min(0).max(1).optional(),
  signals: z
    .object({
      matrixPriority: z.number().min(0).default(0),
      healthScore: z.number().min(0).max(100).default(0),
      affinity: z.number().min(0).max(1).default(0),
    })
    .optional(),
});

const decisionBody = z.object({
  version: z.number().int().positive().optional(),
});

const rejectBody = z.object({
  reason: z.string().min(1).max(500),
  version: z.number().int().positive().optional(),
});

export async function nbaRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/recommendations/:profileId — top-N actionable recommendations.
   * Terminal (accepted/rejected/expired) and TTL-expired rows are excluded.
   */
  app.get("/v1/recommendations/:profileId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { profileId } = profileParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listForProfile(ctx.tenantId, profileId, q.limit, q.offset, {
      statuses: ["served"],
      servedAfter: ttlCutoff(DEFAULT_TTL_HOURS),
      ...(q.channel !== undefined ? { channel: q.channel } : {}),
    });

    const ranked = rankRecommendations(rows.map(repo.toView), q.limit);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: ranked,
      meta: { page, pageSize: q.limit, total },
    });
  });

  /** GET /v1/recommendations/detail/:id — single served recommendation. */
  app.get("/v1/recommendations/detail/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "recommendation", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    return reply.send({ data: repo.toView(row) });
  });

  /** POST /v1/recommendations — record a recommendation as served. */
  app.post("/v1/recommendations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const score =
      body.score ??
      scoreRecommendation(body.signals ?? { matrixPriority: 0, healthScore: 0, affinity: 0 });

    const id = randomUUID();
    const servedAt = new Date();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        profileId: body.profileId,
        recommendationType: body.recommendationType,
        productId: body.productId ?? null,
        channel: body.channel ?? null,
        score: score.toFixed(4),
        status: "served",
        servedAt,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.recommendationServed,
        eventType: EVENTS.recommendationServed,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          recommendationId: id,
          profileId: body.profileId,
          recommendationType: body.recommendationType,
          score,
        },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "recommendation", id));

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        profileId: body.profileId,
        recommendationType: body.recommendationType,
        productId: body.productId ?? null,
        channel: body.channel ?? null,
        score,
        status: "served",
        servedAt: servedAt.toISOString(),
        version: 1,
      },
    });
  });

  /** POST /v1/recommendations/:id/accept — user acted on the recommendation. */
  app.post("/v1/recommendations/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decisionBody.parse(req.body ?? {});

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    const transitionError = validateStatusTransition(existing.status, "accepted");
    if (transitionError) throw new HttpError(422, "INVALID_TRANSITION", transitionError);

    if (isExpired(existing.servedAt, DEFAULT_TTL_HOURS)) {
      throw new HttpError(422, "RECOMMENDATION_EXPIRED", "recommendation has expired");
    }

    const version = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.updateStatus(
        tx,
        id,
        ctx.tenantId,
        { status: "accepted", updatedBy: ctx.actorId },
        version,
      );
      if (!ok) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "recommendation has been modified; retry with current version",
        );
      }

      await enqueue(tx, {
        topic: EVENTS.recommendationAccepted,
        eventType: EVENTS.recommendationAccepted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { recommendationId: id, profileId: existing.profileId },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "recommendation", id));

    return reply.send({ data: { id, status: "accepted", version: version + 1 } });
  });

  /** POST /v1/recommendations/:id/reject — rejection always needs a reason. */
  app.post("/v1/recommendations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body ?? {});

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    const transitionError = validateStatusTransition(existing.status, "rejected");
    if (transitionError) throw new HttpError(422, "INVALID_TRANSITION", transitionError);

    const version = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.updateStatus(
        tx,
        id,
        ctx.tenantId,
        { status: "rejected", updatedBy: ctx.actorId },
        version,
      );
      if (!ok) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "recommendation has been modified; retry with current version",
        );
      }

      await enqueue(tx, {
        topic: EVENTS.recommendationRejected,
        eventType: EVENTS.recommendationRejected,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { recommendationId: id, profileId: existing.profileId, reason: body.reason },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "recommendation", id));

    return reply.send({ data: { id, status: "rejected", version: version + 1 } });
  });
}
