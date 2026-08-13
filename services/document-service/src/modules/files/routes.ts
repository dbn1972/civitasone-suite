import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
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
    const { id } = req.params as { id: string };
    const file = await queries.getFile(ctx.tenantId, id);
    if (!file) throw new HttpError(404, "NOT_FOUND", "file not found");
    return reply.send(file);
  });

  // Soft-delete file
  app.delete("/v1/documents/files/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteFile(ctx, id));
  });

  // Move file to another folder (or root)
  app.patch("/v1/documents/files/:id/move", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = moveFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveFile(ctx, id, body.folderId));
  });

  // Update tags
  app.patch("/v1/documents/files/:id/tags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
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

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
