import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDocumentBody } from "./validators.js";
import {
  KnowledgeDocSummaryListSchema,
  KnowledgeRecordListSchema,
  KnowledgeSearchResultListSchema,
} from "@civitasone/schemas/web";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

const searchBody = z.object({
  query: z.string().min(1).max(500),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/knowledge/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createDocumentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDocument(ctx, body));
  });

  app.get("/v1/knowledge/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listDocuments(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, KnowledgeDocSummaryListSchema, result.data.map((doc) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category ?? "general",
      author: doc.author ?? undefined,
      createdAt: new Date(doc.createdAt as unknown as string).toISOString(),
      updatedAt: new Date(doc.updatedAt as unknown as string).toISOString(),
      tags: doc.tags,
      status: (["draft", "under_review", "approved", "archived"].includes(doc.status)
        ? doc.status
        : "draft") as "draft" | "under_review" | "approved" | "archived",
      accessLevel: (["public", "internal", "restricted", "confidential"].includes(doc.accessLevel)
        ? doc.accessLevel
        : "internal") as "public" | "internal" | "restricted" | "confidential",
      fileType: doc.fileType ?? undefined,
      fileSize: doc.fileSize ?? undefined,
      version: String(doc.version),
    })));
  });

  app.get("/v1/knowledge/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listDocuments(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, KnowledgeRecordListSchema, result.data.map((doc) => ({
      id: doc.id,
      recordNo: doc.id.slice(0, 8).toUpperCase(),
      title: doc.title,
      type: "file" as const,
      createdDate: new Date(doc.createdAt as Date | string).toISOString().slice(0, 10),
      status: (doc.status === "archived" ? "inactive" : "active") as "active" | "inactive" | "disposed" | "transferred",
    })));
  });

  app.get("/v1/knowledge/articles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listDocuments(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: result.data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.data.length },
    });
  });

  app.post("/v1/knowledge/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = searchBody.parse(req.body);
    const result = await queries.searchDocuments(ctx.tenantId, body.query, body.category, body.limit);
    sendValidated(reply, KnowledgeSearchResultListSchema, result.map((doc) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category ?? "general",
      excerpt: undefined,
      relevanceScore: undefined,
      documentType: doc.fileType ?? undefined,
      createdAt: new Date(doc.createdAt as unknown as string).toISOString(),
      url: undefined,
    })));
  });


  // GET /v1/knowledge/articles/:id — fetch a single article/document by ID
  app.get("/v1/knowledge/articles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const doc = await queries.getDocumentById(ctx.tenantId, id);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "article not found");
    return reply.send(doc);
  });

  // PATCH /v1/knowledge/articles/:id/publish — publish or unpublish an article
  app.patch("/v1/knowledge/articles/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = z.object({ published: z.boolean() }).parse(req.body);
    const status = body.published ? "approved" : "draft";
    await queries.setDocumentStatus(ctx.tenantId, id, status);
    return reply.send({ id, status, correlationId: ctx.correlationId });
  });

  // GET /v1/knowledge/categories/:id/articles — list articles in a category
  app.get("/v1/knowledge/categories/:id/articles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const q = listQuerySchema.parse(req.query);
    const docs = await queries.listDocumentsByCategory(ctx.tenantId, id, q.limit, q.offset);
    return reply.send({ data: docs, meta: { pageSize: q.limit, total: docs.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
