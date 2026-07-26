/**
 * scheduled/cron.ts — Scheduled report generation cron sweeper.
 *
 * A periodic sweeper that finds scheduled reports due for execution
 * (nextRunAt <= now, enabled = true), generates the report via the render
 * pipeline, and delivers to recipients via notification-service.
 *
 * - 120s timeout for report generation
 * - 3 retries on delivery failure before marking failed
 * - Updates nextRunAt after generation
 *
 * Gated behind REPORT_SCHEDULER_ENABLED environment variable.
 */
import { pino } from "pino";
import { eq, and, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { queue } from "../../shared/infra.js";
import { scheduledReports } from "./schema.js";
import { computeNextRunAt, GENERATION_TIMEOUT_MS, MAX_DELIVERY_RETRIES } from "./domain.js";
import type { ScheduledReportCadence } from "./schema.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";

const log = pino({ name: "reports.scheduled-cron" });

const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";

/**
 * Start the ScheduledReportCron if REPORT_SCHEDULER_ENABLED=true.
 *
 * @param intervalMs - Poll interval in milliseconds (default 60_000 = 1 min)
 * @returns The interval handle if started, or null if env-gated off.
 */
export function startScheduledReportCron(intervalMs = 60_000): ReturnType<typeof setInterval> | null {
  const enabled = process.env.REPORT_SCHEDULER_ENABLED;
  if (enabled !== "true") {
    log.info("ScheduledReportCron: disabled (REPORT_SCHEDULER_ENABLED != 'true')");
    return null;
  }

  const timer = setInterval(() => void tick().catch((e) => {
    log.error({ err: e }, "ScheduledReportCron: sweep error");
  }), intervalMs);
  timer.unref();

  log.info({ intervalMs }, "ScheduledReportCron: started");
  return timer;
}

/**
 * Single tick of the cron — finds due scheduled reports and triggers
 * generation + delivery for each. Exported for testing.
 */
export async function tick(): Promise<number> {
  const now = new Date();
  let dispatched = 0;

  // Find all enabled scheduled reports where nextRunAt <= now.
  // Cross-tenant discovery via the BYPASSRLS scanner pool: under report_svc
  // (NOBYPASSRLS, #146) a bare select with no tenant GUC returns ZERO rows and
  // the cron silently no-ops. Read-only; the per-row update below re-runs
  // under the row's tenant so RLS re-checks the write.
  const dueReports = await scannerDb
    .select()
    .from(scheduledReports)
    .where(and(
      eq(scheduledReports.enabled, true),
      lte(scheduledReports.nextRunAt, now),
    ))
    .limit(100);

  for (const scheduled of dueReports) {
    const jobId = randomUUID();
    const correlationId = randomUUID();

    try {
      // Publish render job command with 120s timeout enforcement
      await queue.publish(COMMANDS.renderJob, {
        messageId: jobId,
        type: COMMANDS.renderJob,
        tenantId: scheduled.tenantId,
        actorId: SYSTEM_ACTOR,
        correlationId,
        schemaVersion: "1.0",
        payload: {
          jobId,
          tenantId: scheduled.tenantId,
          templateId: scheduled.templateId,
          format: scheduled.format as "pdf" | "xlsx" | "csv",
          scheduledReportId: scheduled.id,
          timeoutMs: GENERATION_TIMEOUT_MS,
        },
      });

      // Deliver to recipients with retry logic
      await deliverToRecipients(scheduled.tenantId, scheduled.recipients, {
        reportName: `Scheduled Report`,
        format: scheduled.format,
        jobId,
        correlationId,
      });

      // Compute next run time and update
      const nextRunAt = computeNextRunAt(now, scheduled.cadence as ScheduledReportCadence);

      // RLS (#146): per-tenant context per iteration — the UPDATE runs inside
      // the row's tenant GUC transaction as report_svc.
      await runWithTenant(scheduled.tenantId, () =>
        db.transaction((tx) =>
          tx.update(scheduledReports)
            .set({
              lastRunAt: now,
              nextRunAt,
              updatedAt: now,
              updatedBy: SYSTEM_ACTOR,
            })
            .where(and(
              eq(scheduledReports.id, scheduled.id),
              eq(scheduledReports.tenantId, scheduled.tenantId),
            )),
        ),
      );

      dispatched++;

      log.info(
        {
          scheduledReportId: scheduled.id,
          tenantId: scheduled.tenantId,
          jobId,
          cadence: scheduled.cadence,
          nextRunAt: nextRunAt.toISOString(),
          recipientCount: scheduled.recipients.length,
          correlationId,
        },
        "ScheduledReportCron: dispatched report generation + delivery",
      );
    } catch (err) {
      log.error(
        { err, scheduledReportId: scheduled.id, tenantId: scheduled.tenantId },
        "ScheduledReportCron: failed to dispatch report",
      );
    }
  }

  if (dispatched > 0) {
    log.info({ dispatched }, "ScheduledReportCron: tick complete");
  }

  return dispatched;
}

/**
 * Deliver report notification to all recipients.
 * Retries up to MAX_DELIVERY_RETRIES (3) on failure with exponential backoff.
 */
async function deliverToRecipients(
  tenantId: string,
  recipients: string[],
  meta: { reportName: string; format: string; jobId: string; correlationId: string },
): Promise<void> {
  for (const recipient of recipients) {
    let delivered = false;
    for (let attempt = 0; attempt < MAX_DELIVERY_RETRIES; attempt++) {
      try {
        const payload = buildNotificationPayload({
          eventType: "reports.scheduled.delivered",
          recipient,
          channel: "email",
          variables: {
            reportName: meta.reportName,
            format: meta.format,
            jobId: meta.jobId,
          },
        });

        await queue.publish(NOTIFICATION_SEND, {
          messageId: `notify-${meta.jobId}-${recipient}-${attempt}`,
          type: NOTIFICATION_SEND,
          tenantId,
          actorId: SYSTEM_ACTOR,
          correlationId: meta.correlationId,
          schemaVersion: "1.0",
          payload,
        });

        delivered = true;
        break;
      } catch (err) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        log.warn(
          { err, recipient, attempt: attempt + 1, delayMs: delay },
          "ScheduledReportCron: delivery attempt failed, retrying",
        );
        await sleep(delay);
      }
    }

    if (!delivered) {
      log.error(
        { recipient, jobId: meta.jobId, tenantId },
        "ScheduledReportCron: delivery failed after max retries",
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
