import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRetentionPolicyBody, updateRetentionPolicyBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["knowledge_admin", "super_admin"];

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/retention-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send(data);
  });

  app.get("/v1/knowledge/retention-policies/expiring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listExpiring(ctx.tenantId, q.limit, q.offset);
    return reply.send(data);
  });

  app.get("/v1/knowledge/retention-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const policy = await repo.getById(ctx.tenantId, id);
    if (!policy) throw new HttpError(404, "NOT_FOUND", "retention policy not found");
    return reply.send(policy);
  });

  app.post("/v1/knowledge/retention-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createRetentionPolicyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.retentionPolicyCreate(ctx, body));
  });

  app.put("/v1/knowledge/retention-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = updateRetentionPolicyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.retentionPolicyUpdate(ctx, id, body));
  });

  app.post("/v1/knowledge/retention-policies/:id/apply", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.retentionPolicyApply(ctx, id));
  });

  app.get("/v1/knowledge/retention/due", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listExpiring(ctx.tenantId, q.limit, q.offset);
    return reply.send(data);
  });
}
