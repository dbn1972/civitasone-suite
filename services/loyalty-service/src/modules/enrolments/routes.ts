import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const enrolBody = z.object({
  programId: z.string().uuid(),
  profileId: z.string().uuid(),
  tier: z.string().max(50).optional(),
});

const profileIdParam = z.object({ profileId: z.string().uuid() });

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];

export async function enrolmentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/loyalty/enrol", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = enrolBody.parse(req.body);
    return reply.status(202).send({
      data: {
        id: crypto.randomUUID(),
        programId: body.programId,
        profileId: body.profileId,
        status: "queued",
      },
    });
  });

  app.get("/v1/loyalty/members/:profileId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { profileId } = profileIdParam.parse(req.params);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });
}
