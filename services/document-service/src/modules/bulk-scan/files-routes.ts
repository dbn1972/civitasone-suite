/**
 * Filed-document reads: download + page image (audit-on-read, DPDP), search over filed documents, OCR provider catalogue.
 * Reads only. Every release of content writes exactly ONE audit event BEFORE the presigned URL is minted (fail closed).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { LinkTarget } from "@civitasone/scan-link";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { routeRateLimit, downloadRateLimit, pageImageRateLimit } from "../../shared/rate-limit.js";
import { BULK_SCAN_ROLES, installBulkScanErrorHandler } from "./http.js";
import { downloadQuery, documentParam, pageParams, searchQuery, type DownloadVariant } from "./review-validators.js";
import * as rrepo from "./review-repo.js";
import { hasAnyRole } from "@civitasone/auth";
import { hasDocumentRole, TARGET_READ_ROLES } from "./access.js";
import { checkEofficeClearance, ClearanceUnavailableError } from "./lookup-client.js";
import { auditRead } from "./audit-read.js";
import { getPorts } from "./ports.js";
import { isTenantKey, keys } from "./keys.js";
import { listOcrProviders } from "./providers.js";
import type { BatchFileRow } from "./schema.js";

const P = "/v1/documents/bulk-scan";
const DOWNLOAD_TTL_S = Number(process.env.BULK_SCAN_DOWNLOAD_TTL_S ?? 120);

function variantKey(f: BatchFileRow, v: DownloadVariant): string | null {
  switch (v) {
    case "original": return f.storageKey;
    case "searchable_pdf": return f.searchablePdfKey;
    case "text": return f.finalTextKey ?? f.textMaskedKey;
    case "json": return f.structuredJsonKey;
  }
}

/**
 * Load the filed file + enforce: exists, not purged, and the caller either holds a document role or a target-record role
 * matching an ACTIVE link. EVERY caller (document_admin and super_admin included) additionally passes estab's
 * classification-clearance check whenever the document has an active eOffice link: their own clearance applies and
 * estab decides (a file reclassified up after linking must not stay downloadable by a role estab itself would deny).
 * A document-role holder is not granted access BY the link, so every active eOffice link must clear them; a target-role
 * holder is granted through the links that match their role and one clearing link is enough. FAIL CLOSED: 403
 * CLEARANCE_DENIED, 503 CLEARANCE_UNAVAILABLE. The gate runs before any audit event, storage read or presign. Documents
 * without an active eOffice link are unaffected.
 * INTENDED SIDE EFFECT: estab answers FORBIDDEN_ROLE for a document_admin who holds no estab reader role, so such a user can no
 * longer download documents linked to an eFile (even ones they filed): eOffice access is estab's decision, not the document module's.
 */
async function authorizedFiledFile(ctx: ReturnType<typeof resolveContext>, documentId: string): Promise<BatchFileRow> {
  const f = await rrepo.getFileByDocumentId(ctx.tenantId, documentId);
  if (!f || f.state !== "filed" || f.retentionDeletedAt) throw new HttpError(404, "NOT_FOUND", "document not found");
  const active = await rrepo.activeLinksForDocument(ctx.tenantId, documentId);
  const documentRole = hasDocumentRole(ctx);
  const granting = documentRole ? active : active.filter((l) => hasAnyRole(ctx, [...TARGET_READ_ROLES[l.target as LinkTarget]]));
  if (!documentRole && granting.length === 0) throw new HttpError(403, "FORBIDDEN", "you may not access this document");
  if (!documentRole && granting.some((l) => l.target !== "eoffice_file")) return f;
  const eoffice = (documentRole ? active : granting).filter((l) => l.target === "eoffice_file");
  if (eoffice.length === 0) return f;
  let denied = false;
  for (const l of eoffice) {
    try {
      const r = await checkEofficeClearance(ctx, { fileId: l.targetId, userId: ctx.actorId, roles: ctx.roles });
      if (r.allowed) { if (documentRole) continue; return f; }
      denied = true;
      if (documentRole) break;
    } catch (e) {
      if (e instanceof ClearanceUnavailableError) throw new HttpError(503, "CLEARANCE_UNAVAILABLE", "the clearance check is unavailable; try again");
      throw e;
    }
  }
  if (denied) throw new HttpError(403, "CLEARANCE_DENIED", "insufficient security clearance for the linked file");
  if (documentRole) return f;
  throw new HttpError(403, "FORBIDDEN", "you may not access this document");
}

function snippetAround(text: string | null, q: string, width = 240): string {
  const t = text ?? "";
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, i < 0 ? 0 : i - Math.floor(width / 3));
  return t.slice(start, start + width);
}

export async function filedDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get(`${P}/files/:documentId/download`, routeRateLimit(downloadRateLimit()), async (req, reply) => {
    const ctx = resolveContext(req);
    const { documentId } = documentParam.parse(req.params);
    const { variant } = downloadQuery.parse(req.query);
    const f = await authorizedFiledFile(ctx, documentId);
    const key = variantKey(f, variant);
    if (!key || !isTenantKey(ctx.tenantId, key)) throw new HttpError(404, "VARIANT_UNAVAILABLE", `no ${variant} rendition for this document`);
    await auditRead(ctx, { purpose: "download", documentId, route: "GET /v1/documents/bulk-scan/files/:documentId/download" });
    const downloadUrl = await getPorts().store.presignGet({ key, expiresIn: DOWNLOAD_TTL_S });
    return reply.send({ data: { downloadUrl, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_S * 1000).toISOString(), variant } });
  });

  app.get(`${P}/files/:documentId/pages/:n/image`, routeRateLimit(pageImageRateLimit()), async (req, reply) => {
    const ctx = resolveContext(req);
    const { documentId, n } = pageParams.parse(req.params);
    const f = await authorizedFiledFile(ctx, documentId);
    if (n > f.pageImageCount) throw new HttpError(404, "NOT_FOUND", "page image not found");
    await auditRead(ctx, { purpose: "page_view", documentId, route: "GET /v1/documents/bulk-scan/files/:documentId/pages/:n/image" });
    const url = await getPorts().store.presignGet({ key: keys.pageImage(f.tenantId, f.batchId, f.id, n), expiresIn: DOWNLOAD_TTL_S });
    return reply.send({ data: { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_S * 1000).toISOString() } });
  });

  // Filed documents only; masked text only; tenant scoped (DB search over the masked snippet; the central indexer feeds the engine).
  app.get(`${P}/search`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const q = searchQuery.parse(req.query);
    const { rows, total } = await rrepo.searchFiled(ctx.tenantId, q);
    // One audit event per search request (DPDP): actor + purpose + route + result count. NEVER the query text or snippets.
    await auditRead(ctx, { purpose: "search", documentId: randomUUID(), route: "GET /v1/documents/bulk-scan/search", resultCount: total });
    const links = await rrepo.linksByDocumentIds(ctx.tenantId, rows.flatMap((r) => (r.filedDocumentId ? [r.filedDocumentId] : [])));
    return reply.send({
      data: rows.map((r) => ({
        documentId: r.filedDocumentId, fileName: r.originalName, docType: r.docType, snippetMasked: snippetAround(r.searchText, q.q),
        confidence: r.ocrMeanConfidence === null ? null : Number(r.ocrMeanConfidence), filedAt: r.filedAt,
        links: links.filter((l) => l.documentId === r.filedDocumentId).map((l) => ({ target: l.target, targetId: l.targetId })),
      })),
      pagination: { total, limit: q.limit, offset: q.offset },
    });
  });

  app.get(`${P}/providers`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const r = await listOcrProviders(ctx);
    return reply.send({ data: r.data, ...(r.degraded ? { degraded: true } : {}) });
  });

  installBulkScanErrorHandler(app);
}
