import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const createProgramBody = z.object({
  name: z.string().min(1).max(200),
  tierConfig: z.record(z.unknown()).optional(),
});

const updateProgramBody = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  tierConfig: z.record(z.unknown()).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];

export async function programRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/loyalty/programs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });

  app.get("/v1/loyalty/programs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "program not found" } });
  });

  app.post("/v1/loyalty/programs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createProgramBody.parse(req.body);
    return reply.status(202).send({
      data: { id: crypto.randomUUID(), status: "queued", name: body.name },
    });
  });

  app.patch("/v1/loyalty/programs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProgramBody.parse(req.body);
    return reply.status(202).send({ data: { id, status: "queued" } });
  });

  app.delete("/v1/loyalty/programs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.status(202).send({ data: { id, status: "queued" } });
  });
}
