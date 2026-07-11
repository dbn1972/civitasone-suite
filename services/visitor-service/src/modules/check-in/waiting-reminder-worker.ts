/**
 * Scheduled worker task: visitor waiting-reminder.
 *
 * Runs every 5 minutes and finds visitors who checked in more than 10
 * minutes ago and whose digital pass is still in `checked_in` state
 * (meaning the host has not yet confirmed pick-up / meeting start).
 *
 * For each, publishes a NOTIFICATION_SEND to the host (push) reminding
 * them that their visitor is waiting.
 *
 * Requirement 16.5: "WHEN a visitor is waiting in the lobby for more than
 * 10 minutes after check-in, THE Notification_Service SHALL send a waiting
 * reminder to the Host."
 *
 * Design notification-events table: N/A (design mentions `waiting-reminder`
 * in the task description; closest mapped event is a push to Host).
 *
 * To avoid spamming hosts with repeated reminders for the same check-in,
 * this worker only sends a reminder once per check-in by filtering out
 * check-ins where the timestamp is more than 15 minutes ago (assuming the
 * worker runs every 5 minutes, the window between 10-15 min is the
 * notification window). This gives us a single-fire behavior without
 * needing a separate "reminder_sent" flag.
 *
 * Follows the `startVisitRequestAutoReject` pattern.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt, gt } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { EVENTS } from "../../topics.js";
import { checkIns } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";
import type { Db } from "../../shared/db.js";
import { loadNamespaceOverrides } from "../config-registry/repo.js";
import { POLICY_NS, toNumber, MS_PER_MINUTE } from "../config-registry/policy.js";

export interface WaitingReminderWorkerOptions {
  /** Interval between checks in milliseconds. Default: 5 minutes. */
  intervalMs?: number;
  /** Minutes after check-in to send reminder. Default: 10 minutes. */
  waitingThresholdMs?: number;
  /** Upper bound for the reminder window to avoid re-sending. Default: 15 minutes. */
  waitingUpperBoundMs?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic waiting-reminder worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startWaitingReminderCheck(
  db: Db,
  queue: Queue,
  opts: WaitingReminderWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 5 * 60_000,
    waitingThresholdMs = 10 * 60_000,
    waitingUpperBoundMs = 15 * 60_000,
    logger,
  } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processWaitingReminderCycle(db, queue, waitingThresholdMs, waitingUpperBoundMs, logger);
      } catch (err) {
        logger?.warn(
          { err, event: "waiting_reminder_cycle_failed" },
          "waiting-reminder cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single waiting-reminder cycle. Exported for testing.
 */
export async function processWaitingReminderCycle(
  db: Db,
  queue: Queue,
  waitingThresholdMs: number,
  waitingUpperBoundMs: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<{ reminders: number }> {
  const now = new Date();

  // Config-driven per tenant (visitor_policy keys check_in.waiting_reminder_minutes
  // / check_in.waiting_reminder_upper_minutes). Tenant override wins over the
  // passed default; the scan is widened to the union band across tenants, then
  // each candidate is re-checked against its own tenant's [threshold, upper]
  // window. Unchanged when nothing is configured.
  const overrides = await loadNamespaceOverrides(db, POLICY_NS);
  const thresholdMsFor = (t: string) => {
    const m = toNumber(overrides.get(t)?.get("check_in.waiting_reminder_minutes"));
    return m !== undefined ? m * MS_PER_MINUTE : waitingThresholdMs;
  };
  const upperMsFor = (t: string) => {
    const m = toNumber(overrides.get(t)?.get("check_in.waiting_reminder_upper_minutes"));
    return m !== undefined ? m * MS_PER_MINUTE : waitingUpperBoundMs;
  };
  const maxUpperMs = Math.max(waitingUpperBoundMs, ...[...overrides.keys()].map(upperMsFor));
  const minThresholdMs = Math.min(waitingThresholdMs, ...[...overrides.keys()].map(thresholdMsFor));

  // Visitors who checked in between (now - upperBound) and (now - threshold)
  // are in the "reminder window" — they have waited long enough but not so
  // long that we've already sent a reminder in a prior cycle.
  const windowStart = new Date(now.getTime() - maxUpperMs);
  const windowEnd = new Date(now.getTime() - minThresholdMs);

  // Find check-in records in the reminder window where the pass is still
  // in `checked_in` state (host hasn't acknowledged / meeting hasn't started)
  const waitingCheckIns = await db
    .select({
      checkInId: checkIns.id,
      passId: checkIns.passId,
      tenantId: checkIns.tenantId,
      checkInTime: checkIns.timestamp,
      locationId: checkIns.locationId,
      gateId: checkIns.gateId,
    })
    .from(checkIns)
    .innerJoin(digitalPasses, and(
      eq(digitalPasses.id, checkIns.passId),
      eq(digitalPasses.tenantId, checkIns.tenantId),
    ))
    .where(
      and(
        eq(checkIns.direction, "in"),
        eq(digitalPasses.status, "checked_in"),
        gt(checkIns.timestamp, windowStart),
        lt(checkIns.timestamp, windowEnd),
      ),
    );

  let reminders = 0;

  for (const ci of waitingCheckIns) {
    // Re-check against this tenant's own [threshold, upper] band (scan widened).
    const ageMs = now.getTime() - ci.checkInTime.getTime();
    if (ageMs <= thresholdMsFor(ci.tenantId) || ageMs >= upperMsFor(ci.tenantId)) continue;

    try {
      // Look up the visit request for host info
      const visitRows = await db
        .select({
          hostEmployeeId: visitRequests.hostEmployeeId,
          visitorName: visitRequests.visitorName,
        })
        .from(visitRequests)
        .innerJoin(digitalPasses, and(
          eq(digitalPasses.visitRequestId, visitRequests.id),
          eq(digitalPasses.tenantId, visitRequests.tenantId),
        ))
        .where(
          and(
            eq(digitalPasses.id, ci.passId),
            eq(digitalPasses.tenantId, ci.tenantId),
          ),
        )
        .limit(1);
      const visit = visitRows[0];

      if (!visit?.hostEmployeeId) continue;

      // Send waiting reminder to host (push)
      await queue.publish(NOTIFICATION_SEND, {
        type: NOTIFICATION_SEND,
        tenantId: ci.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: buildNotificationPayload({
          eventType: EVENTS.visitorCheckedIn,
          recipientId: visit.hostEmployeeId,
          recipient: visit.hostEmployeeId,
          channel: "push",
          variables: {
            visitorName: visit.visitorName ?? "",
            gateId: ci.gateId,
            checkInTime: ci.checkInTime.toISOString(),
            reminderType: "waiting_in_lobby",
            message: "Your visitor has been waiting for over 10 minutes. Please proceed to reception.",
          },
        }),
      });

      reminders++;
    } catch (err) {
      logger?.warn(
        { err, checkInId: ci.checkInId, tenantId: ci.tenantId, event: "waiting_reminder_publish_failed" },
        "failed to publish waiting reminder notification",
      );
    }
  }

  if (reminders > 0) {
    logger?.info(
      { reminders, event: "waiting_reminder_cycle_complete" },
      `waiting-reminder cycle: ${reminders} reminders sent`,
    );
  }

  return { reminders };
}
