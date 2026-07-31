import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];
const ADMIN_ROLES = ["cdp_admin", "super_admin"];

const createSegmentBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  segmentType: z.enum(["dynamic", "static"]).default("dynamic"),
  criteria: z.record(z.unknown()).default({}),
});

const updateSegmentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  criteria: z.record(z.unknown()).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

export async function segmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/cdp/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });

  app.get("/v1/cdp/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — fetch segment by id + tenantId
    return reply.send({ data: null });
  });

  app.get("/v1/cdp/segments/:id/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);
    // Placeholder — evaluate segment criteria, return matching profiles
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });

  app.post("/v1/cdp/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createSegmentBody.parse(req.body);
    // Placeholder — publishes segment creation command
    return reply.code(202).send({ accepted: true, message: "segment creation queued" });
  });

  app.patch("/v1/cdp/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateSegmentBody.parse(req.body);
    // Placeholder — publishes segment update command
    return reply.code(202).send({ accepted: true, message: "segment update queued" });
  });

  app.delete("/v1/cdp/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — publishes segment deletion command (soft-delete)
    return reply.code(202).send({ accepted: true, message: "segment deletion queued" });
  });
}
