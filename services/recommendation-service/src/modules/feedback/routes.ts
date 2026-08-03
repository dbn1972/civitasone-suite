import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
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

    const reason = normaliseReason(body.reason);
    const recordedAt = new Date().toISOString();
    return reply.code(202).send(
      await commands.recordFeedback(ctx, {
        recommendationId: body.recommendationId,
        action: body.action,
        reason,
        version: recommendation.version,
        recordedAt,
      }),
    );
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
