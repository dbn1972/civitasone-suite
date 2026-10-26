/**
 * GAP-LEGAL-CASES-DETAIL-01 (owner decision #9): affidavit attachments through document-service.
 *
 *   POST /v1/legal/cases/:id/affidavits               start: presigned upload target (browser PUTs the file there)
 *   POST /v1/legal/cases/:id/affidavits/:aid/complete tell document-service the upload finished (scan -> OCR -> file)
 *   GET  /v1/legal/cases/:id/affidavits               list, with live document-service state
 *   GET  /v1/legal/cases/:id/affidavits/:aid/download short-lived download URL (audited, legal roles only)
 *
 * Only LEGAL_ROLES, on every route (auditors and other roles cannot open affidavits).
 */
import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { getDocumentClient, DocumentServiceError } from "../../shared/document-client.js";
import * as caseRepo from "../cases/repo.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { startAffidavitBody, caseParam, attachmentParam } from "./validators.js";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

/** document-service state -> the reference's status. */
export function mapRemoteState(state: string): string {
  switch (state) {
    case "pending_upload": return "awaiting_upload";
    case "filed": return "filed";
    case "quarantined": return "quarantined";
    case "skipped": case "skipped_duplicate": case "cancelled": return "rejected";
    case "failed": return "failed";
    default: return "processing";
  }
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/cases/:id/affidavits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id: caseId } = caseParam.parse(req.params);
    const body = startAffidavitBody.parse(req.body);
    const legalCase = await caseRepo.findCaseById(caseId, ctx.tenantId);
    if (!legalCase) throw new HttpError(404, "NOT_FOUND", "case not found");

    const doc = getDocumentClient();
    const dctx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
    const { batchId } = await doc.createBatch(dctx, `Affidavit ${legalCase.caseNo}`);
    const upload = await doc.requestUpload(dctx, batchId, { name: body.fileName, mimeType: body.mimeType, sizeBytes: body.sizeBytes });
    const id = randomUUID();
    const accepted = await commands.registerAttachment(ctx, {
      id, caseId, fileName: body.fileName, mimeType: body.mimeType, sizeBytes: body.sizeBytes,
      docBatchId: batchId, docFileId: upload.fileId,
    });
    return reply.code(202).send({
      ...accepted,
      upload: { method: upload.method, url: upload.url, headers: upload.headers, expiresInSeconds: upload.expiresInSeconds },
    });
  });

  app.post("/v1/legal/cases/:id/affidavits/:aid/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id: caseId, aid } = attachmentParam.parse(req.params);
    const row = await repo.findOne(ctx.tenantId, caseId, aid);
    if (!row) throw new HttpError(404, "NOT_FOUND", "affidavit not found");
    if (row.status === "awaiting_upload") {
      await getDocumentClient().completeUpload({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, row.docBatchId, row.docFileId);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.markUploaded(ctx, caseId, aid));
  });

  app.get("/v1/legal/cases/:id/affidavits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id: caseId } = caseParam.parse(req.params);
    const rows = await repo.listByCase(ctx.tenantId, caseId);
    const doc = getDocumentClient();
    const dctx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
    const items = await Promise.all(rows.map(async (r) => {
      let status = r.status;
      let documentId = r.documentId;
      if (r.status === "processing") {
        // Live state is best effort: a document-service blip must not break the list.
        try {
          const remote = await doc.getFileState(dctx, r.docBatchId, r.docFileId);
          const mapped = mapRemoteState(remote.state);
          if (mapped !== r.status) {
            status = mapped;
            documentId = remote.filedDocumentId ?? documentId;
            await commands.syncStatus(ctx, caseId, r.id, mapped, remote.filedDocumentId);
          }
        } catch { /* keep the stored status */ }
      }
      return {
        id: r.id, caseId: r.caseId, kind: r.kind, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes,
        status, openable: status === "filed" && Boolean(documentId), uploadedAt: r.createdAt, uploadedBy: r.createdBy,
      };
    }));
    return reply.send({ items, total: items.length });
  });

  app.get("/v1/legal/cases/:id/affidavits/:aid/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id: caseId, aid } = attachmentParam.parse(req.params);
    const row = await repo.findOne(ctx.tenantId, caseId, aid);
    if (!row) throw new HttpError(404, "NOT_FOUND", "affidavit not found");
    if (row.status !== "filed" || !row.documentId) {
      throw new HttpError(409, "NOT_AVAILABLE", "this affidavit is not available to open (still processing, rejected or quarantined)");
    }
    const { downloadUrl, expiresAt } = await getDocumentClient()
      .getDownloadUrl({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, row.documentId);
    await commands.recordOpen(ctx, caseId, aid, row.documentId);
    return reply.send({ downloadUrl, expiresAt, fileName: row.fileName });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof DocumentServiceError) {
      if (err.kind === "rejected") {
        return reply.code(422).send({ code: "DOCUMENT_REJECTED", message: "the document store did not accept this file", correlationId, retryable: false });
      }
      return reply.code(503).send({ code: "DOCUMENT_SERVICE_UNAVAILABLE", message: "attachment storage is temporarily unavailable; please retry", correlationId, retryable: true });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
