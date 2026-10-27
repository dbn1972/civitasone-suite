import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { pathUuid } from "../../shared/params.js";
import { createDocumentBody } from "./validators.js";
import {
  KnowledgeDocSummaryListSchema,
  KnowledgeRecordListSchema,
  KnowledgeSearchResultListSchema,
} from "@civitasone/schemas/web";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { clearedAccessLevels, canSetAccessLevel } from "./clearance.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];
// Publishing makes a document authoritative: approver roles only, the same set
// the policies module uses for approve (a plain knowledge_user can author, not approve).
const APPROVER_ROLES = ["knowledge_admin", "super_admin"];

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
    // A user may not create a document above their own clearance (they could
    // not read it back, and it would bypass the least-privilege default).
    if (!canSetAccessLevel(ctx, body.accessLevel)) {
      throw new HttpError(403, "FORBIDDEN", `accessLevel "${body.accessLevel}" requires knowledge_admin`);
    }
    // UAT owner decision #15: one live document per title per tenant. A duplicate
    // is a 409 that points at the existing document; a new version is only ever
    // created through the explicit POST /documents/:id/versions action.
    const existing = await repo.findLiveByTitle(ctx.tenantId, body.title);
    if (existing) {
      const levels = clearedAccessLevels(ctx);
      const visible = levels === null || levels.includes(existing.accessLevel);
      return reply.code(409).send({
        code: "DUPLICATE_TITLE",
        message: "A document with this title already exists.",
        correlationId: ctx.correlationId,
        retryable: false,
        ...(visible
          ? { existingDocumentId: existing.id, existingDocumentHref: `/knowledge/documents/${existing.id}` }
          : {}),
      });
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDocument(ctx, body));
  });

  app.get("/v1/knowledge/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listDocuments(ctx.tenantId, q.limit, q.offset, clearedAccessLevels(ctx));
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

  // GAP2-KNOWLEDGE-DASHBOARD-CAP-01: repository-wide document aggregate so the
  // dashboard StatCards + category chart reflect true totals, not a count over
  // the first (page-capped) 50 documents.
  app.get("/v1/knowledge/documents/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const summary = await queries.summarizeDocuments(ctx.tenantId, clearedAccessLevels(ctx));
    return reply.send(summary);
  });

  app.get("/v1/knowledge/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    // GAP2-KNOWLEDGE-RECORDS-01: back records with the retention policy applied
    // to each document's category, so disposalDueDate / retentionPeriod /
    // department are real (the review/weeding KPIs were structurally always 0
    // before, since these fields were never emitted).
    const records = await queries.listRecords(ctx.tenantId, q.limit, q.offset, clearedAccessLevels(ctx));
    sendValidated(reply, KnowledgeRecordListSchema, records.map((rec) => ({
      id: rec.id,
      recordNo: rec.id.slice(0, 8).toUpperCase(),
      title: rec.title,
      type: "file" as const,
      ...(rec.department ? { department: rec.department } : {}),
      createdDate: new Date(rec.createdAt).toISOString().slice(0, 10),
      ...(rec.retentionPeriod ? { retentionPeriod: rec.retentionPeriod } : {}),
      ...(rec.disposalDueDate ? { disposalDueDate: rec.disposalDueDate } : {}),
      status: (rec.status === "archived" ? "inactive" : "active") as "active" | "inactive" | "disposed" | "transferred",
    })));
  });

  app.get("/v1/knowledge/articles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listDocuments(ctx.tenantId, q.limit, q.offset, clearedAccessLevels(ctx));
    return reply.send({
      data: result.data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.data.length },
    });
  });

  app.post("/v1/knowledge/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = searchBody.parse(req.body);
    const result = await queries.searchDocuments(ctx.tenantId, body.query, body.category, body.limit, clearedAccessLevels(ctx));
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
    const id = pathUuid(req.params);
    const doc = await queries.getDocumentById(ctx.tenantId, id, clearedAccessLevels(ctx));
    if (!doc) throw new HttpError(404, "NOT_FOUND", "article not found");
    return reply.send(doc);
  });

  // PATCH /v1/knowledge/articles/:id/publish — publish or unpublish an article.
  // Approver roles only; maker-checker (the author may not publish their own
  // document); every change writes an audit event in the same transaction.
  app.patch("/v1/knowledge/articles/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const id = pathUuid(req.params);
    const body = z.object({ published: z.boolean() }).parse(req.body);
    const status = body.published ? "approved" : "draft";
    // An uncleared caller must not be able to change (or probe) a document they cannot read.
    const levels = clearedAccessLevels(ctx);
    if (levels && !(await queries.getDocumentById(ctx.tenantId, id, levels))) {
      throw new HttpError(404, "NOT_FOUND", "article not found");
    }
    const outcome = await queries.publishDocument(ctx.tenantId, id, ctx, body.published);
    if (outcome === "not_found") throw new HttpError(404, "NOT_FOUND", "article not found");
    if (outcome === "self_publish") {
      throw new HttpError(403, "MAKER_CHECKER", "the author of a document cannot publish it (maker-checker)");
    }
    return reply.send({ id, status, correlationId: ctx.correlationId });
  });

  // GET /v1/knowledge/categories/:id/articles — list articles in a category
  app.get("/v1/knowledge/categories/:id/articles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const id = pathUuid(req.params);
    const q = listQuerySchema.parse(req.query);
    const docs = await queries.listDocumentsByCategory(ctx.tenantId, id, q.limit, q.offset, clearedAccessLevels(ctx));
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
