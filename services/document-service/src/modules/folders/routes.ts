import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createFolderBody, renameFolderBody, moveFolderBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["document_user", "document_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

/**
 * CLOS-S4-01: folders.id is a uuid column, so a malformed :id used to reach
 * Postgres (22P02 -> retryable 500) or, on the CQRS PATCH routes, be accepted
 * and fail later in the consumer. This plugin has no local error handler (the
 * app-level one is registered after it, so it never applies here), hence the
 * 400 is sent directly, in the same envelope files/routes.ts uses.
 */
function parseFolderId(req: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = idParam.safeParse(req.params);
  if (parsed.success) return parsed.data.id;
  reply.code(400).send({
    code: "VALIDATION_FAILED", message: "invalid request",
    correlationId: (req.headers["x-correlation-id"] as string) ?? req.id, retryable: false,
    fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  });
  return null;
}

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/documents/folders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createFolderBody.parse(req.body);
    if (body.parentId && !(await repo.getById(ctx.tenantId, body.parentId))) {
      throw new HttpError(422, "PARENT_NOT_FOUND", "parent folder not found");
    }
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
    const id = parseFolderId(req, reply);
    if (id === null) return reply;
    const folder = await repo.getById(ctx.tenantId, id);
    if (!folder) throw new HttpError(404, "NOT_FOUND", "folder not found");
    return reply.send(folder);
  });

  app.get("/v1/documents/folders/:id/children", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const id = parseFolderId(req, reply);
    if (id === null) return reply;
    const data = await repo.listByParent(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.patch("/v1/documents/folders/:id/rename", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const id = parseFolderId(req, reply);
    if (id === null) return reply;
    const body = renameFolderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.renameFolder(ctx, id, body.name));
  });

  app.patch("/v1/documents/folders/:id/move", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const id = parseFolderId(req, reply);
    if (id === null) return reply;
    const body = moveFolderBody.parse(req.body);
    // #112: a folder may not be moved under itself or one of its descendants (re-checked in the consumer under a tree lock).
    if (!(await repo.getById(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "folder not found");
    if (body.parentId !== null) {
      if (body.parentId === id) throw new HttpError(422, "FOLDER_CYCLE", "a folder cannot be moved into itself or one of its subfolders");
      const parent = await repo.lineageRead(ctx.tenantId, body.parentId);
      if (!parent) throw new HttpError(422, "PARENT_NOT_FOUND", "parent folder not found");
      if (parent.includes(id)) throw new HttpError(422, "FOLDER_CYCLE", "a folder cannot be moved into itself or one of its subfolders");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveFolder(ctx, id, body.parentId));
  });
}
