import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const evaluateBody = z.object({
  memberId: z.string().uuid(),
  programId: z.string().uuid(),
});

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];

export async function tierRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/loyalty/tiers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });

  app.post("/v1/loyalty/tiers/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = evaluateBody.parse(req.body);
    return reply.status(202).send({
      data: {
        memberId: body.memberId,
        programId: body.programId,
        status: "queued",
      },
    });
  });
}
