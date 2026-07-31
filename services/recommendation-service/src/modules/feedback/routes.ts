import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as nbaRepo from "../nba/repo.js";
import { validateStatusTransition } from "../nba/domain.js";
import { normaliseReason, validateFeedback } from "./domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

/**
 * The mandatory-reason rule is enforced in the domain layer (422) rather than by
 * a zod refinement so callers get a business-rule error, not a schema error.
 */
const feedbackBody = z.object({
  recommendationId: z.string().uuid(),
  action: z.enum(["accepted", "rejected"]),
  reason: z.string().max(500).optional(),
});

const listQuery = z.object({
  recommendationId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/recommendations/feedback — record acceptance or rejection. */
  app.post("/v1/recommendations/feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const body = feedbackBody.parse(req.body);

    const validationError = validateFeedback({
      action: body.action,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });
    if (validationError) throw new HttpError(422, "FEEDBACK_INVALID", validationError);

    const recommendation = await nbaRepo.findById(body.recommendationId, ctx.tenantId);
    if (!recommendation) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    const transitionError = validateStatusTransition(recommendation.status, body.action);
    if (transitionError) throw new HttpError(422, "INVALID_TRANSITION", transitionError);

    const id = randomUUID();
    const recordedAt = new Date();
    const reason = normaliseReason(body.reason);

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        recommendationId: body.recommendationId,
        action: body.action,
        reason,
        recordedAt,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      const ok = await nbaRepo.updateStatus(
        tx,
        body.recommendationId,
        ctx.tenantId,
        { status: body.action, updatedBy: ctx.actorId },
        recommendation.version,
      );
      if (!ok) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "recommendation has been modified; retry with current version",
        );
      }

      await enqueue(tx, {
        topic: EVENTS.feedbackRecorded,
        eventType: EVENTS.feedbackRecorded,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          feedbackId: id,
          recommendationId: body.recommendationId,
          action: body.action,
          hasReason: reason !== null,
        },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "recommendation", body.recommendationId));

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        recommendationId: body.recommendationId,
        action: body.action,
        reason,
        recordedAt: recordedAt.toISOString(),
        version: 1,
      },
    });
  });

  /** GET /v1/recommendations/feedback?recommendationId= — feedback history. */
  app.get("/v1/recommendations/feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByRecommendation(
      ctx.tenantId,
      q.recommendationId,
      q.limit,
      q.offset,
    );
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });
}
