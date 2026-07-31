import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const JOURNEY_ROLES = ["journey_admin", "marketing_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  journeyId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  /** List journey executions with optional filters. */
  app.get("/v1/journeys/executions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const _q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: _q.limit, total: 0 } });
  });
}
