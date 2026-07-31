import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];

const rateQuery = z.object({
  productId: z.string().uuid(),
  date: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function rateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = rateQuery.parse(req.query);
    // Placeholder — returns rates for a product, optionally filtered by effective date
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });
}
