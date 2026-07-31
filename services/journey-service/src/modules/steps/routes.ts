import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const JOURNEY_ROLES = ["journey_admin", "marketing_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function stepRoutes(app: FastifyInstance): Promise<void> {
  /** List participants/executions for a journey. */
  app.get("/v1/journeys/:id/executions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    const _q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: _q.limit, total: 0 }, journeyId: id });
  });
}
