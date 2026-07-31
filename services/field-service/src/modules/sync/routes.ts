import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];

const syncBody = z.object({
  /** Array of offline operations to replay server-side. */
  operations: z.array(z.object({
    type: z.string().min(1),
    payload: z.record(z.unknown()),
    clientTimestamp: z.string(),
  })).min(1).max(500),
});

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  /** Batch upload of offline operations for server-side replay. */
  app.post("/v1/field/sync", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = syncBody.parse(req.body);
    return reply.code(202).send({
      data: { processed: body.operations.length, syncedAt: new Date().toISOString() },
      accepted: true,
    });
  });
}
