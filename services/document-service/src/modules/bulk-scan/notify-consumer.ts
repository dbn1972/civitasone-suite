/**
 * Batch-complete notification to the uploader through notification-service's standard template path
 * (`notification.send`, templateId resolved by the shared event->template map, default template when unmapped; the
 * same payload builder the municipal services use).
 *
 * Trigger: the batch reaches its terminal rollup (every file settled: no scanning / OCR work left). Idempotent per
 * completion cycle: claimBatchNotification() is a conditional UPDATE (notified_completed_at = completed_at only when
 * different), so a redelivered event - or a second completion event for the same cycle - sends nothing.
 */
import { buildNotificationPayload } from "@civitasone/events";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as rrepo from "./review-repo.js";

const IN_PROGRESS = ["pending_upload", "uploaded", "scanning", "scan_pending", "queued", "ocr_running", "extracted"] as const;

/**
 * Notification text + variables. `allSettled` is false while any file is awaiting review / filing or still in progress;
 * in that case the text never says the batch is done or complete - it says what is waiting.
 */
export function summarizeBatch(batchName: string, counts: Record<string, number>): { variables: Record<string, string>; body: string; allSettled: boolean } {
  const n = (s: string): number => counts[s] ?? 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const needsReview = n("needs_review"), readyToFile = n("ready_to_file");
  const inProgress = IN_PROGRESS.reduce((a, s) => a + n(s), 0);
  const allSettled = needsReview === 0 && readyToFile === 0 && inProgress === 0;
  const filed = n("filed"), failed = n("failed"), quarantined = n("quarantined"), skipped = n("skipped") + n("cancelled") + n("skipped_duplicate");
  const parts = [`${filed} filed`];
  if (needsReview > 0) parts.push(`${needsReview} waiting for your review`);
  if (readyToFile > 0) parts.push(`${readyToFile} ready to file`);
  if (inProgress > 0) parts.push(`${inProgress} still being processed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (quarantined > 0) parts.push(`${quarantined} quarantined`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  const body = allSettled
    ? `All ${total} files in batch "${batchName}" are settled: ${parts.join(", ")}.`
    : `Batch "${batchName}" still needs attention (${total} files): ${parts.join(", ")}. Open Bulk scan to continue.`;
  return {
    allSettled, body,
    variables: {
      batchName, total: String(total), filed: String(filed), needsReview: String(needsReview), readyToFile: String(readyToFile),
      failed: String(failed), quarantined: String(quarantined), skipped: String(skipped), duplicates: String(n("skipped_duplicate")), allSettled: String(allSettled),
    },
  };
}

export const BATCH_COMPLETE_NOTIFICATION_EVENT = "bulk_scan.batch.completed";

export function registerNotifyConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<{ batchId: string }>(EVENTS.bulkBatchCompleted, (msg) => handleBatchCompleted(msg as CommandEnvelope<{ batchId: string }>));
}

export async function handleBatchCompleted(msg: CommandEnvelope<{ batchId: string }>): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const claimed = await rrepo.claimBatchNotification(tx, msg.tenantId, msg.payload.batchId);
    if (!claimed) return;
    const counts = await rrepo.fileStateCounts(tx, msg.tenantId, msg.payload.batchId);
    const summary = summarizeBatch(claimed.name, counts);
    const payload = {
      ...buildNotificationPayload({
        eventType: BATCH_COMPLETE_NOTIFICATION_EVENT, recipient: claimed.createdBy, recipientId: claimed.createdBy, channel: "in_app",
        variables: summary.variables,
      }),
      body: summary.body,          // explicit text (takes precedence over the default template body)
    };
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: "notification.send", eventType: "notification.send", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload,
    });
  });
}
