/**
 * Review queue + reviewer API. READ handlers query (and audit the view); WRITE handlers only validate (zod) and
 * publish a command (202 + id). No DB writes here (CQRS) - see review-consumer.ts.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import type { LinkTarget } from "@civitasone/scan-link";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { BULK_SCAN_ROLES, installBulkScanErrorHandler } from "./http.js";
import { batchFileParams } from "./validators.js";
import { reviewQueueQuery, editBody, approveBody, rejectBody } from "./review-validators.js";
import * as repo from "./repo.js";
import * as rrepo from "./review-repo.js";
import * as commands from "./review-commands.js";
import { toFileView } from "./queries.js";
import { auditRead } from "./audit-read.js";
import { documentIdFor } from "./ids.js";
import { getPorts } from "./ports.js";
import { isTenantKey, keys } from "./keys.js";
import { assemblePages, maskFields, maskPiiFindings } from "./review-view.js";
import { normalizeFieldValue } from "./review-edit.js";
import { isValidTargetId, ACTIVE_LINK_STATES } from "./links.js";
import { suggestLinks } from "./lookup-client.js";
import type { BatchFileRow } from "./schema.js";

const P = "/v1/documents/bulk-scan";
const IMAGE_TTL_S = Number(process.env.BULK_SCAN_PAGE_IMAGE_TTL_S ?? 300);

const degradedCount = (f: BatchFileRow): number => (f.degradedPages?.length ?? 0) + (f.reviewReasons ?? []).filter((r) => r.startsWith("DEGRADED:")).length;

/** Top-2 classifier candidates as stored by the OCR step ({docType, score[, label]}); labels resolved from the tenant's doc types. */
function topCandidates(raw: unknown, docTypes: readonly { id: string; label: string }[]): { docType: string; label: string; score: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const o = c as { docType?: unknown; score?: unknown; label?: unknown };
    if (typeof o.docType !== "string" || typeof o.score !== "number") return [];
    return [{ docType: o.docType, label: typeof o.label === "string" ? o.label : (docTypes.find((d) => d.id === o.docType)?.label ?? o.docType), score: o.score }];
  }).sort((x, y) => y.score - x.score).slice(0, 2);
}

async function loadReviewable(tenantId: string, batchId: string, fileId: string, states: readonly string[]): Promise<BatchFileRow> {
  const f = await repo.getFile(tenantId, fileId);
  if (!f || f.batchId !== batchId) throw new HttpError(404, "NOT_FOUND", "file not found");
  if (!states.includes(f.state)) throw new HttpError(409, "NOT_REVIEWABLE", `a file in state ${f.state} is not in review`);
  return f;
}

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get(`${P}/review-queue`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const q = reviewQueueQuery.parse(req.query);
    const { rows, total } = await rrepo.listReviewQueue(ctx.tenantId, q);
    return reply.send({
      data: rows.map((f) => ({
        batchId: f.batchId, fileId: f.id, originalName: f.originalName, docType: f.docType,
        confidence: f.ocrMeanConfidence === null ? null : Number(f.ocrMeanConfidence),
        reasons: f.reviewReasons ?? [], piiFlags: f.piiFlags ?? [], pageCount: f.pageCount ?? 0, degradedPages: degradedCount(f),
        updatedAt: f.updatedAt, version: f.version, batchName: f.batchName,
      })),
      pagination: { total, limit: q.limit, offset: q.offset },
    });
  });

  app.get(`${P}/batches/:batchId/files/:fileId/review`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const f = await loadReviewable(ctx.tenantId, batchId, fileId, ["needs_review", "ready_to_file"]);
    if (!f.structuredJsonKey || !isTenantKey(ctx.tenantId, f.structuredJsonKey)) throw new HttpError(409, "NOT_EXTRACTED", "OCR output is not available for this file");

    // DPDP audit-on-read: ONE event, published BEFORE any content is read; a failed publish fails the view (500).
    await auditRead(ctx, { purpose: "review_view", documentId: documentIdFor(f.id), route: "GET /v1/documents/bulk-scan/batches/:batchId/files/:fileId/review" });

    const store = getPorts().store;
    const structured = JSON.parse((await store.get(f.structuredJsonKey)).toString("utf8")) as unknown;
    const imageUrls = new Map<number, string>();
    for (let n = 1; n <= f.pageImageCount; n++) imageUrls.set(n, await store.presignGet({ key: keys.pageImage(f.tenantId, f.batchId, f.id, n), expiresIn: IMAGE_TTL_S }));

    const eff = await repo.resolveEffectiveSettings(ctx.tenantId, (await repo.getBatch(ctx.tenantId, f.batchId))?.profileId ?? null);
    const fields = maskFields(f.extractedFields as never);
    const linkSuggestions = await suggestLinks(ctx, (f.extractedFields ?? []) as never, eff.settings.allowedLinkTargets as LinkTarget[]);
    const links = await rrepo.linksForFile(ctx.tenantId, f.id);
    const cls = (f.classification ?? {}) as Record<string, unknown>;
    return reply.send({
      file: toFileView(f),
      pages: assemblePages(structured, f.reviewOverrides?.pages, imageUrls),
      fields,
      classification: {
        docType: f.docType, confidence: Number(cls.confidence ?? 0), evidence: Array.isArray(cls.evidence) ? cls.evidence : [], uncertain: cls.uncertain === true,
        presetDocType: typeof cls.presetDocType === "string" ? cls.presetDocType : null,
        candidates: topCandidates(cls.candidates, eff.settings.classification.docTypes),
      },
      piiFindings: maskPiiFindings(f.piiFindings as never),
      degradedPages: f.degradedPages ?? [],
      linkSuggestions,
      docTypes: eff.settings.classification.docTypes.map((d) => ({ id: d.id, label: d.label })),
      reasons: f.reviewReasons ?? [],
      links: links.map((l) => ({ linkId: l.id, target: l.target, targetId: l.targetId, state: l.state, reason: l.resultReason ?? l.reason, note: l.reason, resultReason: l.resultReason, detail: l.resultDetail ?? null })),
      allowedLinkTargets: eff.settings.allowedLinkTargets, filingMakerChecker: eff.settings.filingMakerChecker,
    });
  });

  app.post(`${P}/batches/:batchId/files/:fileId/review/edit`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const body = editBody.parse(req.body);
    const f = await loadReviewable(ctx.tenantId, batchId, fileId, ["needs_review"]);
    if (f.version !== body.expectedVersion) throw new HttpError(409, "STALE", "the file changed since you opened it; reload and retry");
    if (body.docType) {
      const eff = await repo.resolveEffectiveSettings(ctx.tenantId, (await repo.getBatch(ctx.tenantId, f.batchId))?.profileId ?? null);
      if (!eff.settings.classification.docTypes.some((d) => d.id === body.docType)) throw new HttpError(422, "UNKNOWN_DOC_TYPE", "document type is not configured for this tenant");
    }
    for (const fld of body.fields ?? []) if (normalizeFieldValue(fld.kind, fld.value) === null) throw new HttpError(422, "INVALID_FIELD_VALUE", `invalid value for field ${fld.kind}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.editReview(ctx, fileId, body));
  });

  app.post(`${P}/batches/:batchId/files/:fileId/review/approve`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const body = approveBody.parse(req.body);
    const f = await loadReviewable(ctx.tenantId, batchId, fileId, ["needs_review", "ready_to_file"]);
    if (f.version !== body.expectedVersion) throw new HttpError(409, "STALE", "the file changed since you opened it; reload and retry");
    if (body.link) {
      const eff = await repo.resolveEffectiveSettings(ctx.tenantId, (await repo.getBatch(ctx.tenantId, f.batchId))?.profileId ?? null);
      if (!eff.settings.allowedLinkTargets.includes(body.link.target)) throw new HttpError(422, "LINK_TARGET_NOT_ALLOWED", "link target is not enabled for this tenant");
      if (!isValidTargetId(body.link.target, body.link.targetId)) throw new HttpError(422, "INVALID_LINK_TARGET", "target id is not a valid record id");
      const existing = await rrepo.linksForFile(ctx.tenantId, f.id);
      if (existing.some((l) => (ACTIVE_LINK_STATES as readonly string[]).includes(l.state) && l.state !== "flagged_mismatch")) throw new HttpError(409, "LINK_ALREADY_ACTIVE", "this file already has an active link");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveReview(ctx, fileId, body));
  });

  app.post(`${P}/batches/:batchId/files/:fileId/review/reject`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const body = rejectBody.parse(req.body);
    const f = await loadReviewable(ctx.tenantId, batchId, fileId, ["needs_review"]);
    if (f.version !== body.expectedVersion) throw new HttpError(409, "STALE", "the file changed since you opened it; reload and retry");
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectReview(ctx, fileId, body));
  });

  installBulkScanErrorHandler(app);
}
