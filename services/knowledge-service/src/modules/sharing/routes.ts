import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createShareBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/shares", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send(data);
  });

  app.get("/v1/knowledge/shares/document/:documentId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId } = req.params as { documentId: string };
    const data = await repo.listByDocument(ctx.tenantId, documentId);
    return reply.send(data);
  });

  app.get("/v1/knowledge/shares/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const share = await repo.getById(ctx.tenantId, id);
    if (!share) throw new HttpError(404, "NOT_FOUND", "share not found");
    return reply.send(share);
  });

  app.post("/v1/knowledge/shares", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createShareBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.shareCreate(ctx, body));
  });

  app.delete("/v1/knowledge/shares/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.shareRevoke(ctx, id));
  });
}
