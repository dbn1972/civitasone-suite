import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { isWindowExpired } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "notification:digest-flush-sweeper" });

/**
 * Digest flush sweeper: scans for digest buckets whose accumulation window
 * has expired and triggers a flush for each.
 * Returns the number of flushes triggered.
 */
export async function sweepExpiredDigests(queue: Queue, now = new Date()): Promise<number> {
  const expired = await repo.findExpiredBuckets(now);
  let flushed = 0;

  for (const bucket of expired) {
    // Verify window is truly expired using domain logic
    if (!isWindowExpired(bucket.openedAt, 0, now)) continue; // safety check

    try {
      await queue.publish(COMMANDS.flushDigest, {
        messageId: randomUUID(),
        type: COMMANDS.flushDigest,
        tenantId: bucket.tenantId,
        actorId: bucket.createdBy,
        correlationId: bucket.id,
        schemaVersion: "1.0",
        payload: { bucketId: bucket.id, tenantId: bucket.tenantId },
      });
      flushed++;
      log.info({ bucketId: bucket.id, itemCount: bucket.itemCount }, "triggered digest flush");
    } catch (err) {
      log.warn({ err, bucketId: bucket.id }, "failed to trigger digest flush; will retry next sweep");
    }
  }

  if (flushed > 0) log.info({ flushed }, "digest flush sweep cycle complete");
  return flushed;
}

/** Run sweepExpiredDigests on an interval (default: 60s). */
export function startDigestFlushSweeper(queue: Queue, intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepExpiredDigests(queue).catch((err) => log.warn({ err }, "digest flush sweep cycle failed"));
  }, intervalMs);
}
