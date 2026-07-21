/**
 * Scheduled worker task: recurring-pass expiry notification.
 *
 * Runs daily and finds active recurring passes expiring within 7 days.
 * For each, publishes a NOTIFICATION_SEND to:
 *   - Pass holder (email + SMS) — Requirement 12.5
 *   - Issuing facility manager (push) — Requirement 12.5
 *
 * Design notification-events table row:
 *   recurring_pass.expiring | email, sms | Pass holder + Manager | 24h before
 *
 * We check 7 days ahead to give ample renewal time, matching the design's
 * "24h before" minimum — the first alert goes out 7 days before, with a
 * final alert on the last day handled by the same check (passes expiring
 * today are still caught as they're within the 7-day window).
 *
 * Follows the `startVisitRequestAutoReject` pattern: setInterval with an
 * async IIFE, swallows errors to avoid crashing the worker process, logs
 * warnings on failures, and returns the interval handle for graceful
 * shutdown cleanup.
 */
import { randomUUID } from "node:crypto";
import { and, eq, between } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { recurringPasses } from "./schema.js";
import type { Db } from "../../shared/db.js";

export interface RecurringPassExpiryWorkerOptions {
  /** Interval between checks in milliseconds. Default: 24 hours. */
  intervalMs?: number;
  /** Days before expiry to send notification. Default: 7 days. */
  daysBeforeExpiry?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic recurring-pass expiry notification worker.
 * Returns the interval handle so the caller can `clearInterval` on shutdown.
 */
export function startRecurringPassExpiryCheck(
  db: Db,
  queue: Queue,
  opts: RecurringPassExpiryWorkerOptions = {},
): NodeJS.Timeout {
  const {
    intervalMs = 24 * 60 * 60_000, // daily
    daysBeforeExpiry = 7,
    logger,
  } = opts;

  // Run once on startup (after a short delay to let consumers start first)
  const startupDelay = setTimeout(() => {
    void (async () => {
      try {
        await processRecurringPassExpiryCycle(db, queue, daysBeforeExpiry, logger);
      } catch (err) {
        logger?.warn(
          { err, event: "recurring_pass_expiry_startup_check_failed" },
          "recurring-pass expiry startup check failed",
        );
      }
    })();
  }, 5_000);
  startupDelay.unref();

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processRecurringPassExpiryCycle(db, queue, daysBeforeExpiry, logger);
      } catch (err) {
        logger?.warn(
          { err, event: "recurring_pass_expiry_cycle_failed" },
          "recurring-pass expiry notification cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single recurring-pass expiry notification cycle.
 * Exported for testing.
 */
export async function processRecurringPassExpiryCycle(
  db: Db,
  queue: Queue,
  daysBeforeExpiry: number,
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void },
): Promise<{ notified: number }> {
  const now = new Date();
  const expiryWindowStart = now;
  const expiryWindowEnd = new Date(now.getTime() + daysBeforeExpiry * 24 * 60 * 60_000);

  // Find active recurring passes expiring within the notification window.
  // Cross-tenant sweep by design (Requirement 12.5 scans ALL tenants for
  // passes expiring within the window) — intentionally has NO tenant filter.
  // The caller (worker.ts) passes the BYPASSRLS `scannerDb` pool here,
  // mirroring the documented cross-tenant scan pattern in no-show-worker.ts /
  // auto-reject-worker.ts / health-checker.ts. No per-tenant DB follow-up
  // happens in this cycle (only queue.publish), so no runWithTenant wrap
  // is needed here. INTENTIONAL RLS-GUC EXCEPTION: a platform-wide sweep has
  // no single tenant to inject via db.transaction()/wrapWithTenantGuc — same
  // precedent as `dueTimers()` in services/workflow-service/src/modules/
  // tasks/repo.ts. Do NOT wrap this call in db.transaction().
  const expiringPasses = await db
    .select({
      id: recurringPasses.id,
      tenantId: recurringPasses.tenantId,
      visitorName: recurringPasses.visitorName,
      visitorPhone: recurringPasses.visitorPhone,
      validUntil: recurringPasses.validUntil,
      issuedBy: recurringPasses.issuedBy,
      companyName: recurringPasses.companyName,
    })
    .from(recurringPasses)
    .where(
      and(
        eq(recurringPasses.status, "active"),
        between(recurringPasses.validUntil, expiryWindowStart, expiryWindowEnd),
      ),
    );

  let notified = 0;

  for (const pass of expiringPasses) {
    try {
      // Notify pass holder via email (Requirement 12.5)
      await queue.publish(NOTIFICATION_SEND, {
        type: NOTIFICATION_SEND,
        tenantId: pass.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.expiring",
          recipient: pass.visitorPhone,
          channel: "sms",
          variables: {
            visitorName: pass.visitorName,
            validUntil: pass.validUntil.toISOString(),
            companyName: pass.companyName ?? "",
            recurringPassId: pass.id,
            message: "Your recurring pass is expiring soon. Please contact the facility manager for renewal.",
          },
        }),
      });

      // Notify issuing facility manager via push (Requirement 12.5)
      await queue.publish(NOTIFICATION_SEND, {
        type: NOTIFICATION_SEND,
        tenantId: pass.tenantId,
        actorId: "system",
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.expiring",
          recipientId: pass.issuedBy,
          recipient: pass.issuedBy,
          channel: "push",
          variables: {
            visitorName: pass.visitorName,
            validUntil: pass.validUntil.toISOString(),
            companyName: pass.companyName ?? "",
            recurringPassId: pass.id,
            message: "A recurring pass you issued is expiring soon. Consider renewal if the visitor still requires access.",
          },
        }),
      });

      notified++;
    } catch (err) {
      logger?.warn(
        { err, recurringPassId: pass.id, tenantId: pass.tenantId, event: "recurring_pass_expiry_notify_failed" },
        "failed to publish expiry notification for recurring pass",
      );
    }
  }

  if (notified > 0) {
    logger?.info(
      { notified, event: "recurring_pass_expiry_cycle_complete" },
      `recurring-pass expiry cycle: ${notified} pass holders notified`,
    );
  }

  return { notified };
}
