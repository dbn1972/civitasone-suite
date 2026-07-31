import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];
const ADMIN_ROLES = ["cdp_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  profileType: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const mergeBody = z.object({
  sourceProfileIds: z.array(z.string().uuid()).min(2),
  targetProfileId: z.string().uuid(),
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/cdp/profiles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });

  app.get("/v1/cdp/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — will query golden profile by id + tenantId
    return reply.send({ data: null });
  });

  app.post("/v1/cdp/profiles/merge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = mergeBody.parse(req.body);
    // Placeholder — publishes merge command to queue
    return reply.code(202).send({ accepted: true, message: "merge queued" });
  });
}
