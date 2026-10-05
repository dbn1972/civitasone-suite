/** Shared link orchestration steps (called from inside consumer transactions only). */
import { LINK_TOPICS, TARGET_SERVICE, linkRequestSchema, unlinkRequestSchema, type LinkTarget } from "@civitasone/scan-link";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { buildLinkedDocumentMeta, financeHintFromFields, isFinanceTarget } from "./links.js";
import { documentIdFor } from "./ids.js";
import * as repo from "./repo.js";
import type { BatchFileRow, BatchRow, LinkRow } from "./schema.js";

/** Enqueue `<svc>.scan-link.request` (outbox, same tx as the link-state change). Stable id = links.id. */
export async function publishLinkRequest(
  tx: repo.Writer, c: EventCtx,
  a: { link: Pick<LinkRow, "id" | "target" | "targetId" | "requestedBy">; approvedBy: string | null; file: BatchFileRow; batch: Pick<BatchRow, "id">; now: Date },
): Promise<void> {
  const target = a.link.target as LinkTarget;
  const topic = LINK_TOPICS.request(TARGET_SERVICE[target]);
  const payload = linkRequestSchema.parse({
    linkId: a.link.id, target, targetId: a.link.targetId,
    document: buildLinkedDocumentMeta(a.file, a.batch, documentIdFor(a.file.id), a.now),
    requestedBy: a.link.requestedBy, approvedBy: a.approvedBy,
    ...(isFinanceTarget(target) ? { financeHint: financeHintFromFields(a.file.extractedFields as { kind: string; value: string; confidence?: number }[] | null) } : {}),
  });
  await enqueue(tx as Parameters<typeof enqueue>[0], { topic, eventType: topic, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId, payload });
  await emitEvent(tx, c, EVENTS.bulkLinkRequested, { linkId: a.link.id, fileId: a.file.id, target });
}

export async function publishUnlinkRequest(
  tx: repo.Writer, c: EventCtx, a: { link: Pick<LinkRow, "id" | "target" | "targetId" | "documentId">; documentId: string; reason: string; requestedBy: string },
): Promise<void> {
  const target = a.link.target as LinkTarget;
  const topic = LINK_TOPICS.unlinkRequest(TARGET_SERVICE[target]);
  const payload = unlinkRequestSchema.parse({ linkId: a.link.id, target, targetId: a.link.targetId, documentId: a.documentId, reason: a.reason, requestedBy: a.requestedBy });
  await enqueue(tx as Parameters<typeof enqueue>[0], { topic, eventType: topic, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId, payload });
}

const sanitize = (s: string): string => s.replace(/[^\w:. -]/g, "").slice(0, 100);

/**
 * A link that did not go through (target rejected / flagged a mismatch / checker rejected it): the file goes back to
 * needs_review carrying the reason, so the reviewer sees WHY. Conditional ready_to_file -> needs_review.
 */
export async function returnFileToReview(
  tx: repo.Writer, c: EventCtx, file: BatchFileRow, a: { reasonCode: string; actorId: string | null; now: Date; detail?: Record<string, unknown> },
): Promise<boolean> {
  const reasons = [...(file.reviewReasons ?? []).filter((r) => !r.startsWith("LINK_")), "LINK_" + sanitize(a.reasonCode)];
  const moved = await repo.transition(tx, {
    tenantId: file.tenantId, fileId: file.id, from: ["ready_to_file"], to: "needs_review", actorId: a.actorId, reason: ("LINK_" + sanitize(a.reasonCode)).slice(0, 64),
    patch: { reviewReasons: reasons }, detail: { reasons, ...(a.detail ?? {}) }, now: a.now,
  });
  if (moved) {
    await emitEvent(tx, c, EVENTS.bulkFileReturnedToReview, { fileId: file.id, batchId: file.batchId, reason: a.reasonCode });
    await emitAudit(tx, c, { action: "file_returned_to_review", resourceType: "bulk_scan_file", resourceId: file.id, details: { reason: a.reasonCode, batchId: file.batchId } });
  }
  return moved;
}
