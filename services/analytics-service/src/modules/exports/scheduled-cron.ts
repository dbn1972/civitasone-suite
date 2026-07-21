/**
 * exports/scheduled-cron.ts — ScheduledExportCron
 *
 * A periodic sweeper that finds scheduled exports due for execution
 * (nextRunAt <= now, enabled = true) and publishes export commands
 * to the queue. After publishing, updates nextRunAt to the next cadence time.
 *
 * Gated behind ANALYTICS_SCHEDULER_ENABLED environment variable.
 * If the env var is not set to "true", the cron does NOT start.
 */
import { pino } from "pino";
import { eq, and, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { scheduledExports, type ScheduledExportCadence } from "./scheduled-schema.js";
import { computeNextRunAt } from "./scheduled-domain.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "analytics.scheduled-export-cron" });

const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";

/**
 * Start the ScheduledExportCron if ANALYTICS_SCHEDULER_ENABLED=true.
 *
 * @param intervalMs - Poll interval in milliseconds (default 60_000 = 1 min)
 * @returns The interval handle if started, or null if env-gated off.
 */
export function startScheduledExportCron(intervalMs = 60_000): ReturnType<typeof setInterval> | null {
  const enabled = process.env.ANALYTICS_SCHEDULER_ENABLED;
  if (enabled !== "true") {
    log.info("ScheduledExportCron: disabled (ANALYTICS_SCHEDULER_ENABLED != 'true')");
    return null;
  }

  const timer = setInterval(() => void tick().catch((e) => {
    log.error({ err: e }, "ScheduledExportCron: sweep error");
  }), intervalMs);
  timer.unref();

  log.info({ intervalMs }, "ScheduledExportCron: started");
  return timer;
}

/**
 * Single tick of the cron — finds due scheduled exports and publishes
 * export commands for each. Exported for testing.
 */
export async function tick(): Promise<number> {
  const now = new Date();
  let dispatched = 0;

  // Find all enabled scheduled exports where nextRunAt <= now
  const dueExports = await db.transaction(async (tx) =>
    tx
      .select()
      .from(scheduledExports)
      .where(and(
        eq(scheduledExports.enabled, true),
        lte(scheduledExports.nextRunAt, now),
      ))
      .limit(100),
  ); // cap per tick to avoid overwhelming the queue

  for (const scheduled of dueExports) {
    const exportId = randomUUID();
    const correlationId = randomUUID();

    // Publish export creation command
    await queue.publish(COMMANDS.createExport, {
      messageId: exportId,
      type: COMMANDS.createExport,
      tenantId: scheduled.tenantId,
      actorId: SYSTEM_ACTOR,
      correlationId,
      schemaVersion: "1.0",
      payload: {
        id: exportId,
        queryRunId: scheduled.queryRunId,
        format: scheduled.format,
      },
    });

    // Compute next run time based on cadence
    const nextRunAt = computeNextRunAt(now, scheduled.cadence as ScheduledExportCadence);

    // Update lastRunAt and nextRunAt
    await db.transaction(async (tx) => {
      await tx
        .update(scheduledExports)
        .set({
          lastRunAt: now,
          nextRunAt,
          updatedAt: now,
          updatedBy: SYSTEM_ACTOR,
        })
        .where(eq(scheduledExports.id, scheduled.id));
    });

    dispatched++;

    log.info(
      {
        scheduledExportId: scheduled.id,
        tenantId: scheduled.tenantId,
        exportId,
        cadence: scheduled.cadence,
        nextRunAt: nextRunAt.toISOString(),
        correlationId,
      },
      "ScheduledExportCron: dispatched export",
    );
  }

  if (dispatched > 0) {
    log.info({ dispatched }, "ScheduledExportCron: tick complete");
  }

  return dispatched;
}
