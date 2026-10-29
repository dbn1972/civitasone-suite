import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam } from "../../shared/params.js";
import { uploadFileBody, updateFileTagsBody, moveFileBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = ["document_user", "document_admin", "super_admin"];

const folderQuery = z.object({
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const searchBody = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(200).default(50),
});

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  // Upload a file (metadata + optional base64 content)
  app.post("/v1/documents/files", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = uploadFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.uploadFile(ctx, body));
  });

  // List all files (or files within a folder)
  app.get("/v1/documents/files", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = folderQuery.parse(req.query);
    const result = q.folderId
      ? await queries.listFilesByFolder(ctx.tenantId, q.folderId, q.limit, q.offset)
      : await queries.listFiles(ctx.tenantId, q.limit, q.offset);
    return reply.send(result);
  });

  // Get single file
  app.get("/v1/documents/files/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const file = await queries.getFile(ctx.tenantId, id);
    if (!file) throw new HttpError(404, "NOT_FOUND", "file not found");
    return reply.send(file);
  });

  // Soft-delete file
  app.delete("/v1/documents/files/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteFile(ctx, id));
  });

  // Move file to another folder (or root)
  app.patch("/v1/documents/files/:id/move", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = moveFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveFile(ctx, id, body.folderId));
  });

  // Update tags
  app.patch("/v1/documents/files/:id/tags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateFileTagsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.tagFile(ctx, id, body.tags));
  });

  // Full-text search
  app.post("/v1/documents/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = searchBody.parse(req.body);
    const results = await queries.searchFiles(ctx.tenantId, body.query, body.limit);
    return reply.send({ data: results });
  });

  // Shared envelope: ZodError->400, HttpError, malformed JSON->400 MALFORMED_BODY, Fastify 4xx passthrough (a local
  // copy missed JSON parse errors and answered 500).
  registerSchemaErrorHandler(app, HttpError);
}
