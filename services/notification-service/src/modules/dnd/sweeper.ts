import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const log = pino({ name: "notification:dnd-release-sweeper" });

/**
 * DND release sweeper: scans for held notifications whose hold_until
 * has passed and re-enqueues them for delivery.
 * Returns the number of notifications released.
 */
export async function sweepHeldNotifications(queue: Queue, now = new Date()): Promise<number> {
  const held = await repo.findHeldNotifications(now);
  let released = 0;

  const writer = { update: db.update.bind(db), insert: db.insert.bind(db), select: db.select.bind(db) };

  for (const notification of held) {
    try {
      // Transition from held to released
      await repo.releaseHeld(writer, notification.id);

      // Re-enqueue the original delivery payload
      const payload = notification.deliveryPayload as Record<string, unknown>;
      await queue.publish(COMMANDS.sendNotification, {
        messageId: randomUUID(),
        type: COMMANDS.sendNotification,
        tenantId: notification.tenantId,
        actorId: notification.userId,
        correlationId: notification.id,
        schemaVersion: "1.0",
        payload,
      });

      released++;
      log.info({ heldId: notification.id, userId: notification.userId }, "released held notification");
    } catch (err) {
      log.warn({ err, heldId: notification.id }, "failed to release held notification; will retry next sweep");
    }
  }

  if (released > 0) log.info({ released }, "DND release sweep cycle complete");
  return released;
}

/** Run sweepHeldNotifications on an interval (default: 30s). */
export function startDndReleaseSweeper(queue: Queue, intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepHeldNotifications(queue).catch((err) => log.warn({ err }, "DND release sweep cycle failed"));
  }, intervalMs);
}
