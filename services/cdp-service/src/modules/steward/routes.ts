import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const STEWARD_ROLES = ["cdp_steward", "cdp_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

const decideBody = z.object({
  mergeRequestId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(1000).optional(),
});

export async function stewardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/cdp/steward/queue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const q = listQuery.parse(req.query);
    // Placeholder — returns pending merge review items
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });

  app.post("/v1/cdp/steward/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STEWARD_ROLES);
    const body = decideBody.parse(req.body);
    // Placeholder — publishes steward decision command
    return reply.code(202).send({ accepted: true, message: "decision queued" });
  });
}
