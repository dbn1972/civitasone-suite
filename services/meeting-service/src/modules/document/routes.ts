/**
 * document module — HTTP routes (Fastify plugin `documentRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling voting /
 * decision route shape):
 *   - writes  → resolveContext → requireRole → require X-Idempotency-Key → zod parse →
 *               (upload only) size/MIME validate + stage bytes to object storage →
 *               command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - errors  → HttpError (400 validation / DOCUMENT_TOO_LARGE / DOCUMENT_INVALID_TYPE,
 *               401 unauthenticated, 403 forbidden, 404 not-found) mapped to the standard
 *               envelope by the app-level schema error handler.
 *
 * Classification-based access control (Req 4.6, 15.2, 19.3, 19.7): an unauthorized read of a
 * Secret / Top_Secret document is answered with a generic 404 (MEETING_UNAUTHORIZED_ACCESS →
 * 404) so existence is never leaked. Top_Secret is view-only — download is refused with 403
 * even for a cleared user (Req 19.4). The list read is additionally filtered down to the
 * caller's clearance in the repo so unauthorized rows are never returned.
 *
 * File uploads (steering: Security Posture → File uploads): the MIME type is validated
 * SERVER-SIDE (declared MIME whitelisted + extension consistent + magic-byte sniff), the max
 * size (50MB, Req 4.1/15.1) is enforced against the DECODED bytes, and the object is stored
 * outside the webroot in S3/MinIO. The queue message only ever carries the small storage
 * pointer + metadata — never the file bytes (steering: keep queue messages small).
 *
 * Idempotency (steering: API Design Standards): `X-Idempotency-Key` is REQUIRED on every write
 * (POST upload + DELETE remove). A missing key is rejected 400 before any command is published.
 *
 * Endpoints (6):
 *   POST   /v1/meetings/:meetingId/documents                       upload a document
 *   GET    /v1/meetings/:meetingId/documents                       list meeting documents
 *   GET    /v1/meetings/:meetingId/documents/:documentId           document metadata
 *   GET    /v1/meetings/:meetingId/documents/:documentId/download  presigned download URL
 *   DELETE /v1/meetings/:meetingId/documents/:documentId           remove (soft-delete)
 *   GET    /v1/meetings/:meetingId/documents/:documentId/versions  version history
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 15.1, 15.2_
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError, httpError } from "../../shared/context.js";
import { storage } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  uploadDocumentBody,
  removeDocumentBody,
  documentListQuery,
  meetingIdParam,
  documentIdParam,
  MAX_FILE_SIZE_BYTES,
  checkMimeConsistent,
  canAccessClassification,
  isDownloadAllowed,
  maxClearanceRank,
} from "./validators.js";

// ─── RBAC (design § Access Control Matrix) ───────────────────────────────────
// Secretaries curate the paper set (upload/remove); meeting_admin has full control.
// Everyone associated with the meeting may read metadata/list/download subject to the
// per-document classification clearance check (special_invitee is item-scoped, Req 4.7).
const WRITE_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin"];
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "special_invitee",
  "tenant_admin",
  "super_admin",
];

/**
 * Enforce the mandatory `X-Idempotency-Key` on writes (steering: idempotency REQUIRED on all
 * POST/DELETE that trigger a queued write). Rejected as 400 before any command is published.
 */
function requireIdempotencyKey(ctx: RequestContext): void {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this operation");
  }
}

/** 404 unless the parent meeting exists in the caller's tenant. */
async function assertMeetingExists(tenantId: string, meetingId: string): Promise<void> {
  const meeting = await repo.getMeetingStatus(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
}

/**
 * Load a live document that belongs to the path meeting AND is readable by the caller.
 * A missing / soft-deleted / other-tenant / other-meeting document, OR one the caller is not
 * cleared for, all collapse to the SAME 404 (Req 19.7 — never leak classified existence).
 */
async function loadReadableDocument(ctx: RequestContext, meetingId: string, documentId: string) {
  const doc = await repo.getDocument(ctx.tenantId, documentId);
  if (!doc || doc.meetingId !== meetingId || !canAccessClassification(ctx.roles, doc.classification)) {
    throw new HttpError(404, "MEETING_UNAUTHORIZED_ACCESS", "document not found");
  }
  return doc;
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // ── Upload a document (Req 4.1, 15.1, 15.2) ─────────────────────────────────
  app.post("/v1/meetings/:meetingId/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = uploadDocumentBody.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);

    // Decode the base64 payload and enforce the max size against the DECODED bytes (Req 15.1).
    const buffer = Buffer.from(body.contentBase64, "base64");
    if (buffer.length === 0) {
      throw httpError("DOCUMENT_INVALID_TYPE", "uploaded file is empty");
    }
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw httpError("DOCUMENT_TOO_LARGE", `file exceeds the ${MAX_FILE_SIZE_BYTES}-byte limit`);
    }

    // Server-side MIME validation: declared MIME whitelisted + extension consistent + the
    // actual bytes sniff to the expected family (never trust the extension alone).
    const rejection = checkMimeConsistent(body.fileName, body.mimeType, buffer);
    if (rejection) {
      throw httpError("DOCUMENT_INVALID_TYPE", `unsupported or inconsistent file type (${rejection})`);
    }

    // Mint the document id up front — it is the storage key discriminator, the command
    // messageId (end-to-end idempotency), and the value returned to the caller.
    const documentId = randomUUID();
    const storageKey = `meeting/${ctx.tenantId}/documents/${documentId}`;
    // Stage the bytes to object storage BEFORE publishing so the consumer only handles the
    // pointer; the consumer re-validates the MIME + computes the content hash on this object.
    await storage.putObject(storageKey, buffer, body.mimeType);

    const accepted = await commands.documentUpload(ctx, {
      documentId,
      meetingId,
      agendaItemId: body.agendaItemId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: buffer.length,
      storageKey,
      classification: body.classification,
      documentType: body.documentType,
      retentionYears: body.retentionYears,
      previousVersionId: body.previousVersionId,
    });
    reply.header("location", `/v1/meetings/${meetingId}/documents/${documentId}`);
    return reply.code(202).send({ data: accepted });
  });

  // ── List meeting documents (clearance-filtered) (Req 4.2, 15.2) ─────────────
  app.get("/v1/meetings/:meetingId/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const query = documentListQuery.parse(req.query ?? {});
    await assertMeetingExists(ctx.tenantId, meetingId);
    const rows = await repo.getDocuments(ctx.tenantId, meetingId, {
      agendaItemId: query.agendaItemId,
      documentType: query.documentType,
      maxRank: maxClearanceRank(ctx.roles),
    });
    return reply.send({ data: rows });
  });

  // ── Document metadata (Req 4.2) ─────────────────────────────────────────────
  app.get("/v1/meetings/:meetingId/documents/:documentId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId, documentId } = documentIdParam.parse(req.params);
    const doc = await loadReadableDocument(ctx, meetingId, documentId);
    return reply.send({ data: doc });
  });

  // ── Download — presigned URL, classification + view-only enforced (Req 4.6, 19.4) ──
  app.get("/v1/meetings/:meetingId/documents/:documentId/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId, documentId } = documentIdParam.parse(req.params);
    const doc = await loadReadableDocument(ctx, meetingId, documentId);
    // Top_Secret is view-only: refuse download even to a cleared caller (Req 19.4).
    if (!isDownloadAllowed(doc.classification)) {
      throw new HttpError(403, "FORBIDDEN", "document is view-only and cannot be downloaded");
    }
    const url = await repo.getDownloadUrl(doc.storageKey);
    return reply.send({ data: { url, fileName: doc.fileName, mimeType: doc.mimeType } });
  });

  // ── Remove (soft-delete) (Req 4.5) ──────────────────────────────────────────
  app.delete("/v1/meetings/:meetingId/documents/:documentId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, documentId } = documentIdParam.parse(req.params);
    const body = removeDocumentBody.parse(req.body ?? {});
    // 404 for a missing / other-tenant / unauthorized document (no existence leak).
    const doc = await loadReadableDocument(ctx, meetingId, documentId);
    const accepted = await commands.documentRemove(ctx, meetingId, documentId, body.version ?? doc.version, body.reason);
    return reply.code(202).send({ data: accepted });
  });

  // ── Version history (Req 4.7 / 15.4) ────────────────────────────────────────
  app.get("/v1/meetings/:meetingId/documents/:documentId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId, documentId } = documentIdParam.parse(req.params);
    // Anchor on a readable document first (404 for missing/unauthorized).
    await loadReadableDocument(ctx, meetingId, documentId);
    const versions = await repo.getVersionHistory(ctx.tenantId, documentId);
    // Filter the lineage to the caller's clearance (a superseding version could be reclassified).
    const maxRank = maxClearanceRank(ctx.roles);
    const visible = versions.filter((v) => canAccessClassification(ctx.roles, v.classification));
    return reply.send({ data: visible, meta: { maxClearanceRank: maxRank } });
  });
}
