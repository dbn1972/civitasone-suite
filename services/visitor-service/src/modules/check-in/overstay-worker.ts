/**
 * Scheduled worker task: overstay detection.
 *
 * Runs every 10 minutes and performs two checks:
 *
 * 1. **Standard overstay** (Requirement 6.3): finds checked-in digital passes
 *    whose `valid_until` is in the past and publishes a
 *    `COMMANDS.overstayDetect` command for each batch. The consumer's
 *    `overstayDetect` handler (in `modules/check-in/consumer.ts`) handles
 *    outbox events and notifications to host + security control room.
 *
 * 2. **End-of-business-day escalation** (Requirement 6.4): if a pass has
 *    been overstayed for more than 2 hours past `valid_until`, publishes a
 *    higher-severity NOTIFICATION_SEND directly to the security supervisor,
 *    escalating the incident beyond standard host/security notifications.
 *
 * Follows the `startVisitRequestAutoReject` pattern: setInterval with an async
 * IIFE, swallows errors to avoid crashing the worker process, logs warnings on
 * failures, and returns the interval handle for graceful shutdown cleanup.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { COMMANDS, EVENTS } from "../../topics.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";
import type { Db } from "../../shared/db.js";

export interface OvrstayWorkerOptions {
  /** Interval between checks in milliseconds. Default: 10 minutes. */
  intervalMs?: number;
  /** Threshold past `valid_until` to escalate to supervisor. Default: 2 hours. */
  escalationThresholdMs?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic overstay detection worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startOvrstayDetection(
  db: Db,
  queue: Queue,
  opts: OvrstayWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 10 * 60_000,
    escalationThresholdMs = 2 * 60 * 60_000,
    logger,
  } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processOvstayDetectionCycle(db, queue, escalationThresholdMs, logger);
      } catch (err) {
        // Non-critical maintenance — swallow to avoid crashing the worker
        logger?.warn(
          { err, event: "overstay_detection_cycle_failed" },
          "overstay detection cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single overstay detection cycle. Exported for testing.
 */
export async function processOvstayDetectionCycle(
  db: Db,
  queue: Queue,
  escalationThresholdMs: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<{ detected: number; escalated: number }> {
  const now = new Date();
  const escalationCutoff = new Date(now.getTime() - escalationThresholdMs);

  // ── Step 1: Find all checked-in passes past valid_until ──────────────
  const overstayedPasses = await db
    .select({
      id: digitalPasses.id,
      tenantId: digitalPasses.tenantId,
      locationId: digitalPasses.locationId,
      validUntil: digitalPasses.validUntil,
      visitRequestId: digitalPasses.visitRequestId,
    })
    .from(digitalPasses)
    .where(
      and(
        eq(digitalPasses.status, "checked_in"),
        lt(digitalPasses.validUntil, now),
      ),
    );

  let detected = 0;
  let escalated = 0;

  for (const pass of overstayedPasses) {
    // ── Step 1a: Publish overstayDetect command for standard handling ───
    try {
      await queue.publish(COMMANDS.overstayDetect, {
        type: COMMANDS.overstayDetect,
        tenantId: pass.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          asOf: now.toISOString(),
          locationId: pass.locationId,
        },
      });
      detected++;
    } catch (err) {
      logger?.warn(
        { err, passId: pass.id, tenantId: pass.tenantId, event: "overstay_detect_publish_failed" },
        "failed to publish overstayDetect command for overstayed pass",
      );
    }

    // ── Step 2: Escalate to supervisor if > 2h past valid_until ────────
    // Requirement 6.4: end-of-business-day escalation
    if (pass.validUntil < escalationCutoff) {
      try {
        // Look up visitor info for the notification payload
        const visitRows = await db
          .select({
            visitorName: visitRequests.visitorName,
            hostEmployeeId: visitRequests.hostEmployeeId,
          })
          .from(visitRequests)
          .where(
            and(
              eq(visitRequests.id, pass.visitRequestId),
              eq(visitRequests.tenantId, pass.tenantId),
            ),
          )
          .limit(1);
        const visit = visitRows[0];

        // Higher-severity notification to security supervisor
        await queue.publish(NOTIFICATION_SEND, {
          type: NOTIFICATION_SEND,
          tenantId: pass.tenantId,
          actorId: "system",
          correlationId: randomUUID(),
          schemaVersion: "1.0",
          payload: buildNotificationPayload({
            eventType: EVENTS.overstayAlerted,
            recipient: "security_supervisor",
            channel: "push",
            variables: {
              visitorName: visit?.visitorName ?? "",
              passId: pass.id,
              locationId: pass.locationId,
              validUntil: pass.validUntil.toISOString(),
              detectedAt: now.toISOString(),
              hostEmployeeId: visit?.hostEmployeeId ?? "",
              escalationReason: "visitor_overstay_exceeds_2h",
              severity: "high",
              message: `Visitor has overstayed more than 2 hours past approved time. Immediate action required.`,
            },
          }),
        });

        escalated++;
      } catch (err) {
        logger?.warn(
          { err, passId: pass.id, tenantId: pass.tenantId, event: "overstay_escalation_failed" },
          "failed to publish supervisor escalation for severely overstayed pass",
        );
      }
    }
  }

  if (detected > 0 || escalated > 0) {
    logger?.info(
      { detected, escalated, event: "overstay_detection_cycle_complete" },
      `overstay detection cycle: ${detected} detected, ${escalated} escalated to supervisor`,
    );
  }

  return { detected, escalated };
}
