/**
 * Orphaned pending_upload rows: a file row is registered when the presigned URL is issued; if the client never
 * finishes (tab closed, abandoned) it would sit there forever and keep its batch "processing". Rows older than
 * BULK_SCAN_PENDING_UPLOAD_TTL_MS (default 24h) are moved to failed(UPLOAD_EXPIRED) by the sweeper cycle, under the
 * tenant GUC, with a file_events row + audit event. Conditional (state = pending_upload) so it is race-safe.
 */
import { runWithTenant } from "@civitasone/db";
import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import { db } from "../../shared/db.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { emitAudit, emitEvent } from "./emit.js";

export const pendingUploadTtlMs = (): number => Number(process.env.BULK_SCAN_PENDING_UPLOAD_TTL_MS ?? 24 * 3_600_000);

export async function sweepPendingUploads(
  discovery: { stalePendingUploads?: (before: Date, limit: number) => Promise<Array<{ tenantId: string; fileId: string }>> },
  now: Date,
  ttlMs: number = pendingUploadTtlMs(),
): Promise<{ expired: number }> {
  if (!discovery.stalePendingUploads) return { expired: 0 };
  const stale = await discovery.stalePendingUploads(new Date(now.getTime() - ttlMs), 200);
  let expired = 0;
  for (const s of stale) {
    await runWithTenant(s.tenantId, () => db.transaction(async (tx) => {
      const file = await repo.getFileTx(tx, s.tenantId, s.fileId);
      if (!file || file.state !== "pending_upload") return;
      const c = { tenantId: s.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: "bulk-scan-sweeper" };
      const ok = await repo.transition(tx, {
        tenantId: s.tenantId, fileId: s.fileId, from: ["pending_upload"], to: "failed", now,
        patch: { failureReason: "UPLOAD_EXPIRED", failureDetail: "upload not completed within " + Math.round(ttlMs / 60000) + " minutes" },
        reason: "UPLOAD_EXPIRED",
      });
      if (!ok) return;
      expired++;
      await emitAudit(tx, c, { action: "upload_expired", resourceType: "bulk_scan_file", resourceId: s.fileId, outcome: "failure", details: { batchId: file.batchId, ttlMs } });
      await emitEvent(tx, c, EVENTS.bulkFileFailed, { fileId: s.fileId, batchId: file.batchId, reason: "UPLOAD_EXPIRED" });
      if (await repo.refreshBatchCompletion(tx, s.tenantId, file.batchId, now)) await emitEvent(tx, c, EVENTS.bulkBatchCompleted, { batchId: file.batchId });
    }));
  }
  return { expired };
}
