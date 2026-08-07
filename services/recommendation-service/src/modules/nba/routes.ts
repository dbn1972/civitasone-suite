import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import {
  MAX_REASON_TEXT_LENGTH,
  normaliseReasonText,
  summariseRejection,
  validateRejection,
} from "../feedback/reason-domain.js";
import {
  DEFAULT_TTL_HOURS,
  isExpired,
  rankRecommendations,
  scoreRecommendation,
  ttlCutoff,
  validateStatusTransition,
} from "./domain.js";
import * as commands from "./commands.js";

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
  reasonCode: z.string().trim().min(1).max(32).optional(),
  reasonText: z.string().trim().max(MAX_REASON_TEXT_LENGTH).optional(),
  reason: z.string().trim().max(500).optional(),
  version: z.number().int().positive().optional(),
});

export async function nbaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/recommendations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listAll(ctx.tenantId, q.limit, q.offset, {
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

  app.get("/v1/recommendations/detail/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "recommendation", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    return reply.send({ data: repo.toView(row) });
  });

  app.post("/v1/recommendations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const score =
      body.score ??
      scoreRecommendation(body.signals ?? { matrixPriority: 0, healthScore: 0, affinity: 0 });

    const servedAt = new Date().toISOString();
    return reply.code(202).send(
      await commands.createRecommendation(ctx, {
        profileId: body.profileId,
        recommendationType: body.recommendationType,
        productId: body.productId ?? null,
        channel: body.channel ?? null,
        score,
        servedAt,
      }),
    );
  });

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
    if (version !== existing.version) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        "recommendation has been modified; retry with current version",
      );
    }

    return reply.code(202).send(
      await commands.acceptRecommendation(ctx, id, { version, feedbackId: randomUUID() }),
    );
  });

  app.post("/v1/recommendations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body ?? {});

    const reasonText = normaliseReasonText(body.reasonText ?? body.reason);
    const reasonCode = body.reasonCode;
    if (reasonCode === undefined) {
      throw new HttpError(400, "REASON_REQUIRED", "reasonCode is required to reject a recommendation");
    }

    const reasonError = validateRejection({ reasonCode, reasonText });
    if (reasonError) throw new HttpError(400, reasonError.code, reasonError.message);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    const transitionError = validateStatusTransition(existing.status, "rejected");
    if (transitionError) throw new HttpError(422, "INVALID_TRANSITION", transitionError);

    const version = body.version ?? existing.version;
    if (version !== existing.version) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        "recommendation has been modified; retry with current version",
      );
    }

    return reply.code(202).send(
      await commands.rejectRecommendation(ctx, id, {
        version,
        feedbackId: randomUUID(),
        reasonCode,
        reasonText,
        reason: summariseRejection(reasonCode, reasonText),
      }),
    );
  });
}
