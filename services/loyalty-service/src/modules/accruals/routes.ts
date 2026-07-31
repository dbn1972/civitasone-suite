import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const accrueBody = z.object({
  memberId: z.string().uuid(),
  points: z.number().int().positive(),
  source: z.string().min(1).max(100),
  sourceRef: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const INTERNAL_ROLES = ["loyalty_admin", "super_admin", "service_account"];
const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];

export async function accrualRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/loyalty/accrue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const body = accrueBody.parse(req.body);
    return reply.status(202).send({
      data: {
        id: crypto.randomUUID(),
        memberId: body.memberId,
        points: body.points,
        status: "queued",
      },
    });
  });

  app.get("/v1/loyalty/members/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });
}
