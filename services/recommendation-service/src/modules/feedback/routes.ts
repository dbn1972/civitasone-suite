import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

const feedbackBody = z.object({
  recommendationId: z.string().uuid(),
  action: z.enum(["accepted", "rejected"]),
  /** Rejection reason is mandatory when action is rejected. */
  reason: z.string().min(1).max(500).optional(),
}).refine(
  (data) => data.action !== "rejected" || (data.reason !== undefined && data.reason.length > 0),
  { message: "reason is required when rejecting a recommendation", path: ["reason"] },
);

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  /** Record feedback (accept/reject with mandatory rejection reason). */
  app.post("/v1/recommendations/feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const body = feedbackBody.parse(req.body);
    return reply.code(202).send({
      data: { recommendationId: body.recommendationId, action: body.action, recordedAt: new Date().toISOString() },
      accepted: true,
    });
  });
}
