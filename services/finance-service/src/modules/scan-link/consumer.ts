/**
 * Scan-link (Finance target) — consumer of `finance.scan-link.request` / `finance.scan-link.unlink.request`.
 *
 * Wire contract: @civitasone/scan-link. document-service (bulk-scan) never writes in the finance schemas; it
 * publishes a command and we, inside OUR tx, re-check the target and write our own row.
 *
 * Mandatory order (steering: Concurrency & Data Integrity), per message:
 *   1. runWithTenant(msg.tenantId) -> RLS GUC set (createQueue already wraps; kept explicit for direct callers/tests).
 *   2. db.transaction: markProcessed(tx, messageId) FIRST -- a redelivered messageId is a no-op.
 *   3. RE-CHECK the target exists in the tenant (never trust the publisher), then MATCH reference + amount.
 *   4. exact match -> insert finance_scanned_documents (unique(tenant_id, link_id) => idempotent on a replayed link)
 *      else NOTHING is stored (flagged_mismatch / rejected) -- only an audit event + the result event.
 *   5. audit.event.record (resourceType = the target kind, NO PII values) + scan-link result event, same tx.
 * Money is bigint paise end to end.
 */
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import {
  LINK_TOPICS, scrubReasonText, linkRequestSchema, unlinkRequestSchema,
  type LinkReasonCode, type LinkRequest, type LinkResult, type UnlinkRequest, type UnlinkResult,
} from "@civitasone/scan-link";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { evaluateMatch, type ScanTargetKind } from "./match.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "finance:scan-link-consumer" });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINANCE_KINDS: readonly string[] = ["finance_payment", "finance_voucher", "finance_bill"];

export interface ScanLinkMessage { messageId: string; tenantId: string; actorId: string; correlationId?: string; payload: unknown }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function emit(
  tx: Tx, msg: ScanLinkMessage,
  audit: { action: string; resourceType: string; resourceId: string; outcome: "success" | "failure"; metadata: Record<string, unknown> },
  resultTopic: string, result: LinkResult | UnlinkResult,
): Promise<void> {
  const correlationId = msg.correlationId ?? msg.messageId;
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId,
    payload: { service: "finance", ...audit },
  });
  await enqueue(tx, {
    topic: resultTopic, eventType: resultTopic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId,
    payload: result as unknown as Record<string, unknown>,
  });
}

/** Process one finance.scan-link.request. Exported for direct (real-DB) testing. */
export async function handleLinkRequest(msg: ScanLinkMessage): Promise<LinkResult | null> {
  const parsed = linkRequestSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn({ tenantId: msg.tenantId, messageId: msg.messageId }, "malformed scan-link request dropped");
    return null; // no linkId to answer -- nothing safe to publish back
  }
  const req: LinkRequest = parsed.data;
  const resultTopic = LINK_TOPICS.result("finance");

  return runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return null; // redelivery

    const result = (status: LinkResult["status"], reason: LinkReasonCode | null, detail?: Record<string, string>): LinkResult => ({
      linkId: req.linkId, target: req.target, targetId: req.targetId, documentId: req.document.documentId, status, reason, ...(detail ? { detail } : {}),
    });
    const auditMeta = { linkId: req.linkId, documentId: req.document.documentId, batchId: req.document.batchId };

    // Not a finance target / malformed id -> rejected (cannot even be a row here).
    if (!FINANCE_KINDS.includes(req.target) || !UUID_RE.test(req.targetId)) {
      const r = result("rejected", FINANCE_KINDS.includes(req.target) ? "TARGET_NOT_FOUND" : "UNSUPPORTED_TARGET");
      await emit(tx, msg, { action: "scan_link_rejected", resourceType: FINANCE_KINDS.includes(req.target) ? req.target : "finance_scan_link", resourceId: req.targetId.slice(0, 64), outcome: "failure", metadata: { ...auditMeta, status: r.status } }, resultTopic, r);
      return r;
    }
    const kind = req.target as ScanTargetKind;

    // Maker != checker, re-checked on the TARGET side (defence in depth; the document side enforces it too).
    // approvedBy is null only when filing maker-checker is off, in which case there is no checker to compare.
    if (req.approvedBy !== null && req.approvedBy === req.requestedBy) {
      const r = result("rejected", "MAKER_CHECKER_VIOLATION");
      await emit(tx, msg, { action: "scan_link_rejected", resourceType: kind, resourceId: req.targetId, outcome: "failure", metadata: { ...auditMeta, status: r.status, reason: r.reason } }, resultTopic, r);
      return r;
    }

    // Replay of the same link (different messageId): converge, do not write or audit twice.
    const existing = await repo.findByLink(tx, msg.tenantId, req.linkId);
    if (existing) {
      const r = existing.state === "linked" ? result("linked", null) : result("rejected", "LINK_ALREADY_UNLINKED");
      await enqueue(tx, { topic: resultTopic, eventType: resultTopic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId ?? msg.messageId, payload: r as unknown as Record<string, unknown> });
      return r;
    }

    // RE-CHECK inside the tx: target must exist in THIS tenant (RLS + explicit tenant predicate).
    const target = await repo.loadTarget(tx, msg.tenantId, kind, req.targetId);
    if (!target) {
      const r = result("rejected", "TARGET_NOT_FOUND");
      await emit(tx, msg, { action: "scan_link_rejected", resourceType: kind, resourceId: req.targetId, outcome: "failure", metadata: { ...auditMeta, status: r.status } }, resultTopic, r);
      return r;
    }

    const m = evaluateMatch(req.financeHint, target);
    if (m.outcome !== "match") {
      // NEVER attach. Store nothing but the audit event. Reason is a shared CODE; context is PII-free scalars (paise strings).
      const r = result("flagged_mismatch", m.reason, m.detail);
      await emit(tx, msg, { action: "scan_link_flagged_mismatch", resourceType: kind, resourceId: req.targetId, outcome: "failure", metadata: { ...auditMeta, status: r.status, matchOutcome: m.outcome, reason: r.reason, detail: m.detail } }, resultTopic, r);
      return r;
    }

    const d = req.document;
    await repo.insertLinked(tx, {
      tenantId: msg.tenantId, targetKind: kind, targetId: req.targetId,
      documentId: d.documentId, batchId: d.batchId, fileName: d.fileName, mimeType: d.mimeType, docType: d.docType,
      pageCount: d.pageCount, ocrConfidence: d.ocrConfidence === null ? null : d.ocrConfidence.toFixed(4),
      piiFlags: d.piiFlags, textPreviewMasked: d.textPreviewMasked,
      matchedReference: m.matchedReference.slice(0, 100), matchedAmountMinor: m.matchedAmountMinor,
      linkId: req.linkId, linkedBy: req.requestedBy, approvedBy: req.approvedBy, state: "linked", filedAt: new Date(d.filedAt),
    });
    const r = result("linked", null);
    await emit(tx, msg, { action: "scan_link_linked", resourceType: kind, resourceId: req.targetId, outcome: "success", metadata: { ...auditMeta, docType: d.docType, matchedAmountMinor: m.matchedAmountMinor.toString(), approvedBy: req.approvedBy } }, resultTopic, r);
    return r;
  }));
}

/** Process one finance.scan-link.unlink.request. Reason (>=5 chars) is enforced by the wire schema AND the table CHECK. */
export async function handleUnlinkRequest(msg: ScanLinkMessage): Promise<UnlinkResult | null> {
  const parsed = unlinkRequestSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn({ tenantId: msg.tenantId, messageId: msg.messageId }, "malformed scan-link unlink request dropped");
    return null;
  }
  const req: UnlinkRequest = parsed.data;
  const resultTopic = LINK_TOPICS.unlinkResult("finance");

  return runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return null;
    const result = (status: UnlinkResult["status"], reason: LinkReasonCode | null): UnlinkResult =>
      ({ linkId: req.linkId, documentId: req.documentId, status, reason });

    const existing = await repo.findByLink(tx, msg.tenantId, req.linkId);
    const kind = existing?.targetKind ?? (FINANCE_KINDS.includes(req.target) ? req.target : "finance_scan_link");
    if (!existing || existing.documentId !== req.documentId) {
      const r = result("rejected", "LINK_NOT_FOUND");
      await emit(tx, msg, { action: "scan_unlink_rejected", resourceType: kind, resourceId: req.targetId.slice(0, 64), outcome: "failure", metadata: { linkId: req.linkId, documentId: req.documentId } }, resultTopic, r);
      return r;
    }
    // The free-text reason may carry PII (Aadhaar, phone ...): only the SCRUBBED text is stored or audited.
    // (The table CHECK needs >= 5 chars, so a reason that scrubs down to nothing useful becomes a fixed marker.)
    const safeReason = scrubReasonText(req.reason).trim().length >= 5 ? scrubReasonText(req.reason) : "[redacted]";
    const transitioned = await repo.markUnlinked(tx, { tenantId: msg.tenantId, linkId: req.linkId, reason: safeReason, actorId: req.requestedBy });
    if (!transitioned) {
      // Already unlinked (earlier delivery/other request): converge on `unlinked`, no second audit.
      const r = result("unlinked", null);
      await enqueue(tx, { topic: resultTopic, eventType: resultTopic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId ?? msg.messageId, payload: r as unknown as Record<string, unknown> });
      return r;
    }
    const r = result("unlinked", null);
    await emit(tx, msg, { action: "scan_unlinked", resourceType: kind, resourceId: existing.targetId, outcome: "success", metadata: { linkId: req.linkId, documentId: req.documentId, reason: safeReason } }, resultTopic, r);
    return r;
  }));
}

export function registerScanLinkConsumers(queue: Queue): void {
  queue.subscribe(LINK_TOPICS.request("finance"), async (msg) => { await handleLinkRequest(msg as unknown as ScanLinkMessage); });
  queue.subscribe(LINK_TOPICS.unlinkRequest("finance"), async (msg) => { await handleUnlinkRequest(msg as unknown as ScanLinkMessage); });
}
