import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const log = pino({ name: "notification:schedule-sweeper" });

/**
 * Schedule sweeper: scans for scheduled notifications that are due (scheduled_at <= now),
 * claims them via optimistic locking, and enqueues them for delivery.
 * Returns the number of schedules dispatched this cycle.
 */
export async function sweepDueSchedules(queue: Queue, now = new Date()): Promise<number> {
  const due = await repo.findDueSchedules(now);
  let dispatched = 0;

  for (const row of due) {
    // Claim under the row's tenant context so RLS admits the UPDATE (#146).
    const claimed = await runWithTenant(row.tenantId, () =>
      db.transaction((tx) => repo.claimSchedule(tx, row.id, row.version)),
    );
    if (!claimed) continue; // another instance won the race

    try {
      await queue.publish(COMMANDS.sendNotification, {
        messageId: randomUUID(),
        type: COMMANDS.sendNotification,
        tenantId: row.tenantId,
        actorId: row.createdBy,
        correlationId: row.id,
        schemaVersion: "1.0",
        payload: {
          templateId: row.templateId,
          recipient: row.recipient,
          recipientId: row.recipientId ?? undefined,
          channel: row.channel,
          priority: row.priority,
          variables: row.variables,
        },
      });
      dispatched++;
      log.info({ scheduleId: row.id, scheduledAt: row.scheduledAt }, "dispatched scheduled notification");
    } catch (err) {
      log.warn({ err, scheduleId: row.id }, "failed to dispatch scheduled notification; will retry next sweep");
    }
  }

  if (dispatched > 0) log.info({ dispatched }, "schedule sweep cycle complete");
  return dispatched;
}

/** Run sweepDueSchedules on an interval (default: 30s). */
export function startScheduleSweeper(queue: Queue, intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepDueSchedules(queue).catch((err) => log.warn({ err }, "schedule sweep cycle failed"));
  }, intervalMs);
}
