import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

const accountParam = z.object({ accountId: z.string().uuid() });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Get health score for an account. */
  app.get("/v1/recommendations/health/:accountId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { accountId } = accountParam.parse(req.params);
    // placeholder — will query computed health scores
    return reply.send({ data: { accountId, score: 0, factors: {}, computedAt: null } });
  });
}
