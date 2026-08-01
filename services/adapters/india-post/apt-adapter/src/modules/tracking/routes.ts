import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const ALLOWED_ROLES = ["adapter_admin", "logistics_officer", "super_admin", "tenant_admin"];

const articleIdParam = z.object({ articleId: z.string().min(1).max(30) });

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/adapters/apt/tracking/:articleId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);

    const parsed = articleIdParam.safeParse(req.params);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { articleId } = parsed.data;
    return reply.send({
      data: {
        articleId,
        status: "in-transit",
        events: [],
        lastUpdated: null,
      },
    });
  });
}
