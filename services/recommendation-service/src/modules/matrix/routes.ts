import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

const createMatrixBody = z.object({
  triggerProductId: z.string().uuid(),
  recommendedProductId: z.string().uuid(),
  segment: z.string().max(64).optional(),
  channel: z.string().max(64).optional(),
  priority: z.number().int().min(0).default(0),
});

const updateMatrixBody = z.object({
  segment: z.string().max(64).optional(),
  channel: z.string().max(64).optional(),
  priority: z.number().int().min(0).optional(),
  version: z.number().int().positive(),
});

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  triggerProductId: z.string().uuid().optional(),
  segment: z.string().optional(),
});

export async function matrixRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/recommendations/matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createMatrixBody.parse(req.body);
    return reply.code(202).send({ data: { id: crypto.randomUUID(), ...body }, accepted: true });
  });

  app.get("/v1/recommendations/matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const _q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: _q.limit, total: 0 } });
  });

  app.get("/v1/recommendations/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: { id, priority: 0 } });
  });

  app.patch("/v1/recommendations/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateMatrixBody.parse(req.body);
    return reply.code(202).send({ data: { id, ...body }, accepted: true });
  });

  app.delete("/v1/recommendations/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id }, accepted: true });
  });
}
