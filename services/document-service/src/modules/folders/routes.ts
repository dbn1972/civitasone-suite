import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createFolderBody, renameFolderBody, moveFolderBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["document_user", "document_admin", "super_admin"];

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/documents/folders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createFolderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFolder(ctx, body));
  });

  app.get("/v1/documents/folders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data });
  });

  app.get("/v1/documents/folders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const folder = await repo.getById(ctx.tenantId, id);
    if (!folder) throw new HttpError(404, "NOT_FOUND", "folder not found");
    return reply.send(folder);
  });

  app.get("/v1/documents/folders/:id/children", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const data = await repo.listByParent(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.patch("/v1/documents/folders/:id/rename", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = renameFolderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.renameFolder(ctx, id, body.name));
  });

  app.patch("/v1/documents/folders/:id/move", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = moveFolderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveFolder(ctx, id, body.parentId));
  });
}
