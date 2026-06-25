import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { maskRecipient } from "../../adapters/mask.js";
import * as repo from "./repo.js";

const log = pino({ name: "notification:retry-sweeper" });

/**
 * P1-2: DURABLE retry sweeper. Scans Postgres for deliveries whose retry is due
 * (`status='queued' AND next_retry_at <= now()`), atomically claims each row, and
 * republishes a `notification.send` command so the delivery consumer reprocesses
 * it. Because the due set lives in the DB (not an in-process setTimeout), retries
 * survive a worker restart: a row scheduled before a crash is picked up by the
 * next sweep after the worker comes back.
 *
 * Returns the number of retries republished this cycle (useful for tests).
 */
export async function sweepDueRetries(queue: Queue, now = new Date()): Promise<number> {
  const due = await repo.findDueRetries(now);
  let republished = 0;
  for (const row of due) {
    const claimed = await repo.claimDueRetry(row.id, row.version, now);
    if (!claimed) continue; // another sweeper instance won the race
    try {
      await queue.publish(COMMANDS.sendNotification, {
        messageId: randomUUID(),
        type: COMMANDS.sendNotification,
        tenantId: row.tenantId,
        actorId: row.updatedBy,
        correlationId: row.id,
        schemaVersion: "1.0",
        payload: {
          templateId: row.templateId,
          recipient: row.recipient,
          recipientId: row.recipientId ?? undefined,
          channel: row.channel,
          deliveryId: row.id,
          retryCount: row.retryCount,
        },
      });
      republished++;
      log.info({ deliveryId: row.id, retryCount: row.retryCount, recipient: maskRecipient(row.recipient) }, "republished due retry");
    } catch (err) {
      log.warn({ err, deliveryId: row.id }, "failed to republish due retry; will retry next sweep");
    }
  }
  if (republished > 0) log.info({ republished }, "retry sweep cycle complete");
  return republished;
}

/** Run sweepDueRetries on an interval. Never rethrows — a failing cycle is logged. */
export function startRetrySweeper(queue: Queue, intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepDueRetries(queue).catch((err) => log.warn({ err }, "retry sweep cycle failed"));
  }, intervalMs);
}
