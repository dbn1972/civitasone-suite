/**
 * Consumers for the target services' results:
 *   <svc>.scan-link.result         linked | rejected | flagged_mismatch
 *   <svc>.scan-link.unlink.result  unlinked | rejected
 *
 * Document-service owns the file/link state; the target side audits its own rows. Every handler is idempotent
 * (markProcessed + conditional link transitions), tenant scoped (tenantScoped queue + explicit tenant_id) and writes
 * a document-side audit event for every transition.
 *
 * `linked` is where the document is actually CREATED (ready_to_file -> filed): a rejected / mismatched link therefore
 * never leaves a document behind, and the file simply returns to needs_review with the reason. If the file can no
 * longer be filed when the confirmation arrives (e.g. the batch was cancelled meanwhile), the link is immediately
 * unlinked again so the target never keeps a reference to a document that does not exist.
 */
import { LINK_TOPICS, linkResultSchema, unlinkResultSchema, type LinkService } from "@civitasone/scan-link";
import { NonRetryableError, type Queue, type CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as rrepo from "./review-repo.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { fileDocument } from "./filing.js";
import { publishUnlinkRequest, returnFileToReview } from "./link-flow.js";
import { documentIdFor } from "./ids.js";

const log = pino({ name: "bulk-scan-link", level: process.env.LOG_LEVEL ?? "info" });
const ctxOf = (m: CommandEnvelope): EventCtx => ({ tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId });
const SERVICES: readonly LinkService[] = ["hrms", "finance", "estab"];

export function registerLinkResultConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  for (const svc of SERVICES) {
    queue.subscribe<unknown>(LINK_TOPICS.result(svc), (msg) => handleLinkResult(msg as CommandEnvelope));
    queue.subscribe<unknown>(LINK_TOPICS.unlinkResult(svc), (msg) => handleUnlinkResult(msg as CommandEnvelope));
  }
}

export async function handleLinkResult(msg: CommandEnvelope): Promise<void> {
  const parsed = linkResultSchema.safeParse(msg.payload);
  if (!parsed.success) throw new NonRetryableError("INVALID_LINK_RESULT");
  const r = parsed.data;
  const c = ctxOf(msg);
  const now = new Date();
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.advisoryXactLock(tx, "bulk_scan_link:" + r.linkId);
    const link = await rrepo.getLinkTx(tx, msg.tenantId, r.linkId, true);
    if (!link) throw new NonRetryableError("LINK_NOT_FOUND");
    if (link.state !== "requested") {
      log.info({ linkId: r.linkId, state: link.state, status: r.status }, "bulk-scan: link result ignored (link not awaiting a result)");
      return;                                                           // duplicate / late result
    }
    const file = await repo.getFileTx(tx, msg.tenantId, link.fileId);
    const batch = file ? await repo.getBatchTx(tx, msg.tenantId, file.batchId) : null;
    const actor = link.approvedBy ?? link.requestedBy;

    if (r.status === "linked") {
      const done = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: r.linkId, from: ["requested"], to: "linked", resultReason: null, resultDetail: r.detail ?? null });
      if (!done) return;
      const filed = !!file && !!batch && file.state === "ready_to_file"
        && await fileDocument(tx, c, { file, batch, actorId: actor, now, reason: "LINK_CONFIRMED" });
      await emitAudit(tx, c, { action: "link_linked", resourceType: "bulk_scan_link", resourceId: r.linkId, details: { fileId: link.fileId, target: link.target, targetId: link.targetId, filed } });
      await emitEvent(tx, c, EVENTS.bulkLinkLinked, { linkId: r.linkId, fileId: link.fileId, target: link.target });
      if (!filed) {
        // The file cannot be filed any more: take the link back so the target holds no dangling reference.
        const back = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: r.linkId, from: ["linked"], to: "unlink_requested", reason: "FILE_NO_LONGER_FILEABLE" });
        if (back) {
          await publishUnlinkRequest(tx, c, { link: back, documentId: documentIdFor(link.fileId), reason: "FILE_NO_LONGER_FILEABLE", requestedBy: link.requestedBy });
          await emitAudit(tx, c, { action: "unlink_requested", resourceType: "bulk_scan_link", resourceId: r.linkId, severity: "warning", details: { fileId: link.fileId, reason: "FILE_NO_LONGER_FILEABLE" } });
        }
      }
      return;
    }

    const to = r.status === "rejected" ? "rejected" : "flagged_mismatch";
    const moved = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: r.linkId, from: ["requested"], to, resultReason: r.reason ?? null, resultDetail: r.detail ?? null });
    if (!moved) return;
    if (file && file.state === "ready_to_file") {
      await returnFileToReview(tx, c, file, { reasonCode: r.reason ?? (r.status === "rejected" ? "TARGET_REJECTED" : "FLAGGED_MISMATCH"), actorId: null, now, detail: { target: link.target } });
    }
    await emitAudit(tx, c, {
      action: r.status === "rejected" ? "link_target_rejected" : "link_flagged_mismatch", resourceType: "bulk_scan_link", resourceId: r.linkId,
      outcome: "denied", details: { fileId: link.fileId, target: link.target, targetId: link.targetId, reason: r.reason ?? null },
    });
  });
}

export async function handleUnlinkResult(msg: CommandEnvelope): Promise<void> {
  const parsed = unlinkResultSchema.safeParse(msg.payload);
  if (!parsed.success) throw new NonRetryableError("INVALID_UNLINK_RESULT");
  const r = parsed.data;
  const c = ctxOf(msg);
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.advisoryXactLock(tx, "bulk_scan_link:" + r.linkId);
    const link = await rrepo.getLinkTx(tx, msg.tenantId, r.linkId, true);
    if (!link) throw new NonRetryableError("LINK_NOT_FOUND");
    if (link.state !== "unlink_requested") return;                        // duplicate / late
    // A refused unlink normally leaves the link in force. After a retention PURGE the document no longer exists, so the
    // link must not go back to "linked": it stays unlink_requested (flagged) and the retention sweep re-sends the request.
    const file = await repo.getFileTx(tx, msg.tenantId, link.fileId);
    const purged = !!file?.retentionDeletedAt;
    const to = r.status === "unlinked" ? "unlinked" : purged ? "unlink_requested" : "linked";
    const moved = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: r.linkId, from: ["unlink_requested"], to, resultReason: r.reason ?? null, resultDetail: r.detail ?? null });
    if (!moved) return;
    await emitAudit(tx, c, {
      action: r.status === "unlinked" ? "link_unlinked" : "unlink_refused", resourceType: "bulk_scan_link", resourceId: r.linkId,
      outcome: r.status === "unlinked" ? "success" : "denied", severity: r.status !== "unlinked" && purged ? "warning" : "info",
      details: { fileId: link.fileId, target: link.target, targetId: link.targetId, reason: r.reason ?? null, ...(purged ? { afterPurge: true } : {}) },
    });
    if (r.status === "unlinked") {
      await emitEvent(tx, c, EVENTS.bulkLinkUnlinked, { linkId: r.linkId, phase: "done" });
      if (purged) await rrepo.clearUnlinkPendingIfDone(tx, msg.tenantId, link.fileId);
    } else if (purged) {
      await rrepo.flagUnlinkPending(tx, msg.tenantId, link.fileId);
    }
  });
}
