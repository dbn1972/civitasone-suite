/**
 * Scheduled worker task: visit-request auto-reject + host reminder.
 *
 * Runs every 15 minutes (configurable) and performs two checks:
 *
 * 1. **4-hour reminder** (Requirement 3.4): finds pending_approval visit
 *    requests older than 4 hours and publishes a NOTIFICATION_SEND reminder
 *    to the host employee (push + in-app).
 *
 * 2. **24-hour auto-reject** (Requirement 3.5): finds pending_approval visit
 *    requests older than 24 hours and publishes a
 *    `COMMANDS.visitRequestAutoReject` command for each, which the consumer
 *    handles (transitions to auto_rejected, notifies visitor).
 *
 * Follows the `startOutboxPurge` pattern: setInterval with an async IIFE,
 * swallows errors to avoid crashing the worker process, logs warnings on
 * failures, and returns the interval handle for graceful shutdown cleanup.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { COMMANDS, EVENTS } from "../../topics.js";
import { visitRequests } from "./schema.js";
import type { Db } from "../../shared/db.js";

export interface AutoRejectWorkerOptions {
  /** Interval between checks in milliseconds. Default: 15 minutes. */
  intervalMs?: number;
  /** Threshold for sending a reminder to host. Default: 4 hours. */
  reminderThresholdMs?: number;
  /** Threshold for auto-rejecting the request. Default: 24 hours. */
  autoRejectThresholdMs?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic auto-reject + reminder worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startVisitRequestAutoReject(
  db: Db,
  queue: Queue,
  opts: AutoRejectWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 15 * 60_000,
    reminderThresholdMs = 4 * 60 * 60_000,
    autoRejectThresholdMs = 24 * 60 * 60_000,
    logger,
  } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processAutoRejectCycle(db, queue, reminderThresholdMs, autoRejectThresholdMs, logger);
      } catch (err) {
        // Non-critical maintenance — swallow to avoid crashing the worker
        logger?.warn(
          { err, event: "auto_reject_cycle_failed" },
          "visit-request auto-reject/reminder cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single auto-reject/reminder cycle. Exported for testing.
 */
export async function processAutoRejectCycle(
  db: Db,
  queue: Queue,
  reminderThresholdMs: number,
  autoRejectThresholdMs: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<{ reminders: number; autoRejected: number }> {
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() - reminderThresholdMs);
  const autoRejectCutoff = new Date(now.getTime() - autoRejectThresholdMs);

  // ── Step 1: Auto-reject requests older than 24h ──────────────────────
  // Query first so we don't send reminders to requests that will be auto-rejected
  const staleRequests = await db
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
      hostEmployeeId: visitRequests.hostEmployeeId,
      visitorName: visitRequests.visitorName,
      visitorPhone: visitRequests.visitorPhone,
      visitorEmail: visitRequests.visitorEmail,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.status, "pending_approval"),
        lt(visitRequests.createdAt, autoRejectCutoff),
      ),
    );

  let autoRejected = 0;
  for (const req of staleRequests) {
    try {
      await queue.publish(COMMANDS.visitRequestAutoReject, {
        type: COMMANDS.visitRequestAutoReject,
        tenantId: req.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          id: req.id,
          tenantId: req.tenantId,
        },
      });
      autoRejected++;
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "auto_reject_publish_failed" },
        "failed to publish auto-reject command for stale visit request",
      );
    }
  }

  // Collect IDs of auto-rejected requests to exclude from reminder check
  const autoRejectedIds = new Set(staleRequests.map((r) => r.id));

  // ── Step 2: Reminder for requests older than 4h but not yet 24h ──────
  const reminderRequests = await db
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
      hostEmployeeId: visitRequests.hostEmployeeId,
      visitorName: visitRequests.visitorName,
      purpose: visitRequests.purpose,
      scheduledAt: visitRequests.scheduledAt,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.status, "pending_approval"),
        lt(visitRequests.createdAt, reminderCutoff),
      ),
    );

  let reminders = 0;
  for (const req of reminderRequests) {
    // Skip requests that were already auto-rejected above
    if (autoRejectedIds.has(req.id)) continue;

    try {
      // Publish reminder notification to host (push channel)
      await queue.publish(NOTIFICATION_SEND, {
        type: NOTIFICATION_SEND,
        tenantId: req.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: buildNotificationPayload({
          eventType: EVENTS.visitRequestCreated,
          recipientId: req.hostEmployeeId,
          recipient: req.hostEmployeeId,
          channel: "push",
          variables: {
            visitorName: req.visitorName,
            purpose: req.purpose ?? "",
            scheduledAt: req.scheduledAt?.toISOString() ?? "",
            reminderType: "pending_approval_4h",
            message: "A visit request is awaiting your approval for over 4 hours",
          },
        }),
      });

      // Also send in-app reminder
      await queue.publish(NOTIFICATION_SEND, {
        type: NOTIFICATION_SEND,
        tenantId: req.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: buildNotificationPayload({
          eventType: EVENTS.visitRequestCreated,
          recipientId: req.hostEmployeeId,
          recipient: req.hostEmployeeId,
          channel: "in_app",
          variables: {
            visitorName: req.visitorName,
            purpose: req.purpose ?? "",
            scheduledAt: req.scheduledAt?.toISOString() ?? "",
            reminderType: "pending_approval_4h",
            message: "A visit request is awaiting your approval for over 4 hours",
          },
        }),
      });

      reminders++;
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "reminder_publish_failed" },
        "failed to publish reminder notification for pending visit request",
      );
    }
  }

  if (autoRejected > 0 || reminders > 0) {
    logger?.info(
      { autoRejected, reminders, event: "auto_reject_cycle_complete" },
      `auto-reject cycle: ${autoRejected} auto-rejected, ${reminders} reminders sent`,
    );
  }

  return { reminders, autoRejected };
}
