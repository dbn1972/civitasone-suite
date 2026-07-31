import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const createAgentBody = z.object({
  name: z.string().min(1).max(200),
  skills: z.array(z.record(z.unknown())).optional(),
  tools: z.array(z.record(z.unknown())).optional(),
});

const updateAgentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  skills: z.array(z.record(z.unknown())).optional(),
  tools: z.array(z.record(z.unknown())).optional(),
  status: z.enum(["active", "inactive", "paused"]).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const READ_ROLES = ["ai_user", "ai_admin", "super_admin"];
const WRITE_ROLES = ["ai_admin", "super_admin"];

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/ai/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 50, total: 0 } });
  });

  app.get("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "agent not found" } });
  });

  app.post("/v1/ai/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createAgentBody.parse(req.body);
    return reply.status(202).send({
      data: { id: crypto.randomUUID(), status: "queued", name: body.name },
    });
  });

  app.patch("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateAgentBody.parse(req.body);
    return reply.status(202).send({ data: { id, status: "queued" } });
  });

  app.delete("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.status(202).send({ data: { id, status: "queued" } });
  });

  app.post("/v1/ai/agents/:id/invoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.status(202).send({
      data: { agentId: id, invocationId: crypto.randomUUID(), status: "queued" },
    });
  });

  app.post("/v1/ai/agents/:id/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.status(202).send({ data: { agentId: id, status: "paused" } });
  });
}
