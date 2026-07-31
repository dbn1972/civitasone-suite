import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];

const checkBody = z.object({
  customerAttributes: z.record(z.unknown()),
  productIds: z.array(z.string().uuid()).optional(),
});

export async function eligibilityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/catalogue/eligibility/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const body = checkBody.parse(req.body);
    // Placeholder — evaluates eligibility rules against customer attributes,
    // returns list of eligible products
    return reply.send({ data: { eligibleProductIds: [], evaluatedRules: 0 } });
  });
}
