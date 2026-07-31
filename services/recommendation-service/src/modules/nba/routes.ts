import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];

const profileParam = z.object({ profileId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  channel: z.string().optional(),
});

export async function nbaRoutes(app: FastifyInstance): Promise<void> {
  /** Get top N recommendations for a profile. */
  app.get("/v1/recommendations/:profileId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { profileId } = profileParam.parse(req.params);
    const q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { profileId, limit: q.limit } });
  });

  /** Accept a recommendation. */
  app.post("/v1/recommendations/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id, status: "accepted" }, accepted: true });
  });

  /** Reject a recommendation. */
  app.post("/v1/recommendations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id, status: "rejected" }, accepted: true });
  });
}
