import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import { createShareBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["document_user", "document_admin", "super_admin"];

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/documents/files/:fileId/shares", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { fileId } = req.params as { fileId: string };
    const data = await repo.listByFile(ctx.tenantId, fileId);
    return reply.send({ data });
  });

  app.get("/v1/documents/shared-with-me", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const data = await repo.listSharedWithUser(ctx.tenantId, ctx.actorId);
    return reply.send({ data });
  });

  app.post("/v1/documents/shares", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createShareBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.shareFile(ctx, body));
  });

  app.delete("/v1/documents/shares/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeShare(ctx, id));
  });
}
