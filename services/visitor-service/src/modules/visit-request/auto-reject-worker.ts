/**
 * Scheduled worker task: visit-request auto-reject + host reminder.
 *
 * Runs every 15 minutes (configurable) and performs two checks:
 *
 * 1. **4-hour reminder** (Requirement 3.4): finds pending_approval visit
 *    requests older than 4 hours and enqueues a NOTIFICATION_SEND reminder
 *    to the host employee (push + in-app).
 *
 * 2. **24-hour auto-reject** (Requirement 3.5): finds pending_approval visit
 *    requests older than 24 hours and enqueues a
 *    `COMMANDS.visitRequestAutoReject` command for each, which the consumer
 *    handles (transitions to auto_rejected, notifies visitor).
 *
 * Transactional outbox (Fix 5): both the auto-reject command and the reminder
 * notifications are written via `enqueue` inside a per-tenant `db.transaction`
 * (under `runWithTenant`), NOT a raw `queue.publish` outside any tx. The outbox
 * relay publishes them after commit — so a crash between "decided" and
 * "published" can neither lose the message (it is committed) nor double-publish
 * it (the relay forwards the stable outbox-row id and the consumer dedupes via
 * markProcessed). The cross-tenant SCAN uses the BYPASSRLS `scannerDb`; every
 * WRITE runs on the primary `db` under the row's tenant so RLS still applies.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { COMMANDS, EVENTS } from "../../topics.js";
import { visitRequests } from "./schema.js";
import type { Db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { loadNamespaceOverrides } from "../config-registry/repo.js";
import { POLICY_NS, toNumber, MS_PER_HOUR } from "../config-registry/policy.js";

/** Zero-UUID system actor for worker-originated outbox rows (actor_id is uuid NOT NULL). */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

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
 *
 * `scannerDb` (BYPASSRLS) is used for the cross-tenant scan; `db` (visitor_svc)
 * for the per-tenant transactional enqueues. Defaults `scannerDb = db` for dev.
 */
export function startVisitRequestAutoReject(
  db: Db,
  queue: Queue,
  opts: AutoRejectWorkerOptions = {},
  scannerDb: Db = db,
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
        await processAutoRejectCycle(db, queue, reminderThresholdMs, autoRejectThresholdMs, logger, scannerDb);
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
 *
 * `queue` is retained in the signature for source/call-site compatibility but is
 * no longer used to publish — all emissions now go through the transactional
 * outbox (`enqueue`) so they are durable + idempotent (Fix 5).
 */
export async function processAutoRejectCycle(
  db: Db,
  queue: Queue,
  reminderThresholdMs: number,
  autoRejectThresholdMs: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
  scannerDb: Db = db,
): Promise<{ reminders: number; autoRejected: number }> {
  void queue;
  const now = new Date();

  // Per-tenant thresholds are config-driven (visitor_policy keys
  // visit_request.reminder_hours / visit_request.auto_reject_hours). A tenant's
  // override WINS over the passed-in default; the cross-tenant scan is widened to
  // the smallest threshold so no tenant's eligible rows are missed, and each
  // candidate is then re-checked against its own tenant's threshold. With no
  // overrides the widened cutoff and re-check both collapse to the default, so
  // behavior is unchanged.
  const overrides = await loadNamespaceOverrides(scannerDb, POLICY_NS);
  const reminderMsFor = (t: string) => {
    const h = toNumber(overrides.get(t)?.get("visit_request.reminder_hours"));
    return h !== undefined ? h * MS_PER_HOUR : reminderThresholdMs;
  };
  const autoRejectMsFor = (t: string) => {
    const h = toNumber(overrides.get(t)?.get("visit_request.auto_reject_hours"));
    return h !== undefined ? h * MS_PER_HOUR : autoRejectThresholdMs;
  };
  const minReminderMs = Math.min(reminderThresholdMs, ...[...overrides.keys()].map(reminderMsFor));
  const minAutoRejectMs = Math.min(autoRejectThresholdMs, ...[...overrides.keys()].map(autoRejectMsFor));

  const reminderCutoff = new Date(now.getTime() - minReminderMs);
  const autoRejectCutoff = new Date(now.getTime() - minAutoRejectMs);

  // ── Step 1: Auto-reject requests older than the tenant's auto-reject window ──
  // Query first so we don't send reminders to requests that will be auto-rejected
  const staleCandidates = await scannerDb
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
      createdAt: visitRequests.createdAt,
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
  // Re-filter to each candidate's own tenant threshold.
  const staleRequests = staleCandidates.filter(
    (r) => now.getTime() - r.createdAt.getTime() > autoRejectMsFor(r.tenantId),
  );

  let autoRejected = 0;
  for (const req of staleRequests) {
    try {
      // Transactional outbox: enqueue the auto-reject command inside a per-tenant
      // tx (durable + idempotent), instead of a raw queue.publish outside any tx.
      await runWithTenant(req.tenantId, () =>
        db.transaction((tx) =>
          enqueue(tx, {
            topic: COMMANDS.visitRequestAutoReject,
            eventType: COMMANDS.visitRequestAutoReject,
            tenantId: req.tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: randomUUID(),
            payload: { id: req.id, tenantId: req.tenantId },
          }),
        ),
      );
      autoRejected++;
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "auto_reject_publish_failed" },
        "failed to enqueue auto-reject command for stale visit request",
      );
    }
  }

  // Collect IDs of auto-rejected requests to exclude from reminder check
  const autoRejectedIds = new Set(staleRequests.map((r) => r.id));

  // ── Step 2: Reminder for requests past the tenant's reminder window but not
  //    yet past its auto-reject window ──
  const reminderCandidates = await scannerDb
    .select({
      id: visitRequests.id,
      tenantId: visitRequests.tenantId,
      createdAt: visitRequests.createdAt,
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
  const reminderRequests = reminderCandidates.filter(
    (r) => now.getTime() - r.createdAt.getTime() > reminderMsFor(r.tenantId),
  );

  let reminders = 0;
  for (const req of reminderRequests) {
    // Skip requests that were already auto-rejected above
    if (autoRejectedIds.has(req.id)) continue;

    try {
      // Transactional outbox: both channels (push + in-app) enqueued atomically
      // in one per-tenant tx.
      await runWithTenant(req.tenantId, () =>
        db.transaction(async (tx) => {
          await enqueue(tx, {
            topic: NOTIFICATION_SEND,
            eventType: NOTIFICATION_SEND,
            tenantId: req.tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: randomUUID(),
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

          await enqueue(tx, {
            topic: NOTIFICATION_SEND,
            eventType: NOTIFICATION_SEND,
            tenantId: req.tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: randomUUID(),
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
        }),
      );

      reminders++;
    } catch (err) {
      logger?.warn(
        { err, visitRequestId: req.id, tenantId: req.tenantId, event: "reminder_publish_failed" },
        "failed to enqueue reminder notification for pending visit request",
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
