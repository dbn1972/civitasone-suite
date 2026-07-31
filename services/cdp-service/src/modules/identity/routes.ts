import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];

const resolveBody = z.object({
  identifierType: z.string().min(1).max(64),
  identifierValue: z.string().min(1).max(256),
});

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/cdp/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = resolveBody.parse(req.body);
    // Placeholder — identity resolution: lookup identity graph, return matched profile(s)
    return reply.send({ data: { profileId: null, confidence: 0, matched: false } });
  });
}
