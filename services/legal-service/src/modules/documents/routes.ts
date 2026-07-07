import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam,
  createDocumentBody,
  updateDocumentBody,
  listDocumentsQuery,
  versionHistoryQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { assertCanDelete, assertCanModifyContent } from "./domain.js";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/legal/documents
   * Create a document or folder in the matter DMS.
   */
  app.post("/v1/legal/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = createDocumentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDocument(ctx, body));
  });

  /**
   * GET /v1/legal/documents
   * List documents/folders for a given matter and optional parent folder.
   */
  app.get("/v1/legal/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listDocumentsQuery.parse(req.query);
    const items = await queries.listDocuments(ctx.tenantId, q.matterId, q.parentFolderId);
    return reply.send({ data: items, meta: { total: items.length } });
  });

  /**
   * GET /v1/legal/documents/:id
   * Retrieve a single document/folder by ID. Metadata reads succeed even under legal hold.
   */
  app.get("/v1/legal/documents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const doc = await queries.getDocument(id, ctx.tenantId);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");
    return reply.send({ data: doc });
  });

  /**
   * PATCH /v1/legal/documents/:id
   * Update a document's name or content. Content modification rejected under legal hold.
   */
  app.patch("/v1/legal/documents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDocumentBody.parse(req.body);

    // Eagerly check legal hold to give immediate feedback
    const doc = await queries.getDocument(id, ctx.tenantId);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

    const isContentUpdate = body.body !== undefined || body.fileKey !== undefined;
    if (isContentUpdate) {
      try {
        assertCanModifyContent(doc.legalHold);
      } catch {
        throw new HttpError(422, "LEGAL_HOLD_ACTIVE", "Document is under legal hold and its content cannot be modified");
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDocument(ctx, id, body));
  });

  /**
   * DELETE /v1/legal/documents/:id
   * Delete a document/folder. Rejected if under legal hold.
   */
  app.delete("/v1/legal/documents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);

    const doc = await queries.getDocument(id, ctx.tenantId);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

    try {
      assertCanDelete(doc.legalHold);
    } catch {
      throw new HttpError(422, "LEGAL_HOLD_ACTIVE", "Document is under legal hold and cannot be deleted");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteDocument(ctx, id));
  });

  /**
   * GET /v1/legal/documents/:id/versions
   * Retrieve version history for a document.
   */
  app.get("/v1/legal/documents/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const q = versionHistoryQuery.parse(req.query);

    const doc = await queries.getDocument(id, ctx.tenantId);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

    const versions = await queries.getVersionHistory(id, ctx.tenantId, q.limit);
    return reply.send({ data: versions, meta: { total: versions.length } });
  });

  /**
   * POST /v1/legal/documents/:id/hold
   * Apply legal hold to a document — prevents delete and content modification.
   */
  app.post("/v1/legal/documents/:id/hold", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);

    const doc = await queries.getDocument(id, ctx.tenantId);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.applyLegalHold(ctx, id));
  });

  /**
   * DELETE /v1/legal/documents/:id/hold
   * Release legal hold from a document.
   */
  app.delete("/v1/legal/documents/:id/hold", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);

    const doc = await queries.getDocument(id, ctx.tenantId);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.releaseLegalHold(ctx, id));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
