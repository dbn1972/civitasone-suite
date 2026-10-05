import type { FastifyInstance } from "fastify";
import { lookupResponseSchema } from "@civitasone/scan-link";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { isAccessAllowed } from "../operators/eligibility.js";
import { idParam, lookupQuery, listScannedQuery, clearanceQuery } from "./validators.js";
import { rankCandidates } from "./domain.js";
import * as repo from "./repo.js";

const ESTAB_ROLES = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin"];
/** Same readers that can already view an eFile (files/routes.ts READER_ROLES). */
const READER_ROLES = [...ESTAB_ROLES, "audit_officer"];
/**
 * Internal routes (lookup + clearance): ONLY the service principal the auth plugin builds from x-internal +
 * INTERNAL_SERVICE_SECRET (actorType "service_account"). A user token gets 403 whatever roles it carries,
 * super_admin included (same gate as finance's internal lookup).
 */
function requireInternalServiceCall(ctx: { actorType: string }, req: { headers: Record<string, unknown> }): void {
  if (ctx.actorType !== "service_account" || req.headers["x-internal"] !== "1") {
    throw new HttpError(403, "FORBIDDEN", "internal service call required");
  }
}

export async function scanLinkRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /internal/v1/scan-link/clearance?fileId=&userId=&roles=a,b
   * Would this caller (user id + roles) be allowed to VIEW the eFile? Same rule as GET /v1/estab/files/:id:
   * a READER role AND isAccessAllowed(classification). document-service calls it before serving a document
   * that has an active eoffice_file link. service_account only; read-only; unknown/other-tenant file => allowed:false.
   */
  app.get("/internal/v1/scan-link/clearance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireInternalServiceCall(ctx, req);
    const q = clearanceQuery.parse(req.query);
    if (!q.roles.some((r) => READER_ROLES.includes(r))) {
      return reply.send({ data: { allowed: false, reason: "FORBIDDEN_ROLE" } });
    }
    const file = await repo.findFileHeader(q.fileId, ctx.tenantId);
    if (!file) return reply.send({ data: { allowed: false, reason: "TARGET_NOT_FOUND" } });
    if (!(await isAccessAllowed(ctx.tenantId, q.userId, file.classification))) {
      await queue.publish("audit.event.record", {
        messageId: randomUUID(), type: "audit.event.record",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { service: "estab", action: "access_denied_clearance", resourceType: "file", resourceId: q.fileId, outcome: "denied", classification: file.classification, subjectUserId: q.userId },
      });
      return reply.send({ data: { allowed: false, reason: "CLASSIFIED" } });
    }
    return reply.send({ data: { allowed: true, reason: null } });
  });

  /**
   * GET /internal/v1/scan-link/lookup?fileNo=&subject=
   * Candidate eOffice files for a scanned letter/order. Exact file number = 1.0, partial file
   * number 0.7, subject token overlap <= 0.85. Tenant scoped, max 10; secret/top-secret files
   * are never offered. Read-only (no DB write, no mutation).
   */
  app.get("/internal/v1/scan-link/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireInternalServiceCall(ctx, req);
    const q = lookupQuery.parse(req.query);
    const rows = await repo.lookupCandidates(ctx.tenantId, q);
    const data = rankCandidates(rows, q);
    return reply.send(lookupResponseSchema.parse({ data }));
  });

  /**
   * GET /v1/estab/files/:id/scanned-documents
   * Scanned documents filed onto an eFile (masked metadata only; bytes are fetched via
   * document-service). Same roles + classification-clearance rule as GET /v1/estab/files/:id.
   */
  app.get("/v1/estab/files/:id/scanned-documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const { state, limit } = listScannedQuery.parse(req.query);
    const file = await repo.findFileHeader(id, ctx.tenantId);
    if (!file) throw new HttpError(404, "NOT_FOUND", "file not found");
    if (!(await isAccessAllowed(ctx.tenantId, ctx.actorId, file.classification))) {
      await queue.publish("audit.event.record", {
        messageId: randomUUID(), type: "audit.event.record",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { service: "estab", action: "access_denied_clearance", resourceType: "file", resourceId: id, outcome: "denied", classification: file.classification },
      });
      throw new HttpError(403, "FORBIDDEN", "insufficient security clearance for this file's classification");
    }
    const rows = await repo.listByFile(id, ctx.tenantId, state, limit);
    // DPDP audit-on-read: who viewed which scanned documents. Ids only - never file names, text previews or PII.
    await queue.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        service: "estab", action: "view_scanned_documents", purpose: "view_scanned_documents",
        resourceType: "file", resourceId: id, outcome: "success",
        route: "GET /v1/estab/files/:id/scanned-documents", documentIds: rows.map((r) => r.documentId),
      },
    });
    return reply.send({
      data: rows.map((r) => ({
        id: r.id, linkId: r.linkId, documentId: r.documentId, batchId: r.batchId,
        fileName: r.fileName, mimeType: r.mimeType, docType: r.docType, pageCount: r.pageCount,
        ocrConfidence: r.ocrConfidence === null ? null : Number(r.ocrConfidence),
        piiFlags: r.piiFlags, textPreviewMasked: r.textPreviewMasked,
        state: r.state, unlinkReason: r.unlinkReason,
        linkedBy: r.linkedBy, approvedBy: r.approvedBy, filedAt: r.filedAt.toISOString(),
      })),
      meta: { fileId: id, state, pageSize: limit },
    });
  });
}
