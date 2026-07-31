import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const redeemBody = z.object({
  memberId: z.string().uuid(),
  points: z.number().int().positive(),
  rewardType: z.string().min(1).max(50),
});

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];

export async function redemptionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/loyalty/redeem", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = redeemBody.parse(req.body);
    return reply.status(202).send({
      data: {
        id: crypto.randomUUID(),
        memberId: body.memberId,
        points: body.points,
        status: "queued",
      },
    });
  });

  app.get("/v1/loyalty/redemptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });
}
