/**
 * Scheduled query sweeper — runs on a cadence and re-executes scheduled queries
 * that are due. Each iteration scans enabled scheduled queries whose lastRunAt
 * is older than their cadence interval (or null = never run), and publishes a
 * runQuery command for each.
 *
 * Cadence intervals: hourly=60min, daily=1440min, weekly=10080min, monthly=43200min.
 */
import { pino } from "pino";
import { eq, and, sql, isNull, or, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { scheduledQueries } from "./schema.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "analytics.query-sweeper" });

const CADENCE_MINUTES: Record<string, number> = {
  hourly: 60,
  daily: 1440,
  weekly: 10080,
  monthly: 43200,
};

const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";

/**
 * Start the periodic sweeper. Returns the interval handle for cleanup.
 * @param intervalMs Poll interval in milliseconds (default: 60_000 = 1 min).
 */
export function startScheduledQuerySweeper(intervalMs = 60_000): ReturnType<typeof setInterval> {
  const timer = setInterval(() => void sweep().catch((e) => {
    log.error({ err: e }, "scheduled query sweep error");
  }), intervalMs);
  // Don't keep the process alive just for the sweeper
  timer.unref();
  log.info({ intervalMs }, "scheduled query sweeper started");
  return timer;
}

async function sweep(): Promise<void> {
  // For each cadence, compute the cutoff time and find due queries.
  const now = new Date();
  let dispatched = 0;

  for (const [cadence, minutes] of Object.entries(CADENCE_MINUTES)) {
    const cutoff = new Date(now.getTime() - minutes * 60_000);
    const due = await db
      .select()
      .from(scheduledQueries)
      .where(and(
        eq(scheduledQueries.enabled, true),
        eq(scheduledQueries.cadence, cadence),
        or(
          isNull(scheduledQueries.lastRunAt),
          lte(scheduledQueries.lastRunAt, cutoff),
        ),
      ))
      .limit(100); // cap to avoid overwhelming a single sweep tick

    for (const sq of due) {
      const runId = randomUUID();
      await queue.publish(COMMANDS.runQuery, {
        messageId: runId,
        type: COMMANDS.runQuery,
        tenantId: sq.tenantId,
        actorId: SYSTEM_ACTOR,
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          id: runId,
          dashboardId: null,
          queryName: sq.name,
          spec: sq.spec,
          status: "queued",
          kind: "scheduled",
          result: null,
          resultRows: 0,
          error: null,
          version: 1,
        },
      });

      // Update lastRunAt so it won't be picked up again until next cadence
      await db
        .update(scheduledQueries)
        .set({ lastRunAt: now, updatedAt: now })
        .where(eq(scheduledQueries.id, sq.id));

      dispatched++;
    }
  }

  if (dispatched > 0) {
    log.info({ dispatched }, "scheduled queries dispatched");
  }
}
