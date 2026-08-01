import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const ALLOWED_ROLES = ["adapter_admin", "logistics_officer", "super_admin", "tenant_admin"];

const serviceabilityQuery = z.object({
  originPin: z.string().length(6).optional(),
  destinationPin: z.string().length(6).optional(),
  articleType: z.string().max(30).optional(),
});

export async function serviceabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/adapters/apt/serviceability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);

    const parsed = serviceabilityQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const query = parsed.data;
    return reply.send({
      data: {
        serviceable: true,
        originPin: query.originPin ?? null,
        destinationPin: query.destinationPin ?? null,
        estimatedDays: 3,
        availableServices: ["speed-post", "registered-post", "parcel"],
      },
    });
  });
}
