import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDakBody, forwardDakBody, createNotingBody, approvalDecisionBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["document_user", "document_admin", "super_admin"];

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  // Dak/file
  app.post("/v1/documents/daks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createDakBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, commands.createDak(ctx, body));
  });

  app.get("/v1/documents/daks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data });
  });

  // Inbox — daks assigned to current user
  app.get("/v1/documents/inbox", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listInbox(ctx.tenantId, ctx.actorId, q.limit, q.offset);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.get("/v1/documents/daks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const dak = await repo.getById(ctx.tenantId, id);
    if (!dak) throw new HttpError(404, "NOT_FOUND", "dak not found");
    return reply.send(dak);
  });

  app.post("/v1/documents/daks/:id/forward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = forwardDakBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, commands.forwardDak(ctx, id, body.assignedTo));
  });

  app.post("/v1/documents/daks/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, commands.acknowledgeDak(ctx, id));
  });

  // Notings
  app.get("/v1/documents/daks/:id/notings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const data = await repo.listNotings(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.post("/v1/documents/daks/:id/notings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = createNotingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, commands.createNoting(ctx, id, body.body));
  });

  // Approvals
  app.post("/v1/documents/daks/:id/approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, commands.submitApproval(ctx, id));
  });

  app.post("/v1/documents/approvals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = approvalDecisionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, commands.decideApproval(ctx, id, body.decision, body.remarks ?? null));
  });

  // Dashboard stats
  app.get("/v1/documents/inbox/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const inbox = await repo.listInbox(ctx.tenantId, ctx.actorId, 500, 0);
    const all = await repo.listByTenant(ctx.tenantId, 500, 0);
    return reply.send({
      inboxCount: inbox.length,
      pendingCount: all.filter(d => d.status === "pending").length,
      urgentCount: all.filter(d => d.priority === "urgent").length,
    });
  });
}
