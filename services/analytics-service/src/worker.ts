import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerDashboardsConsumers } from "./modules/dashboards/consumer.js";
import { registerQueriesConsumers } from "./modules/queries/consumer.js";
import { registerMetricsConsumers } from "./modules/metrics/consumer.js";
import { registerFactsConsumers } from "./modules/facts/consumer.js";
import { registerExportConsumer } from "./modules/exports/consumer.js";
import { startScheduledExportCron } from "./modules/exports/scheduled-cron.js";
import { startScheduledQuerySweeper } from "./modules/queries/sweeper.js";
const log = pino({ name: "analytics-worker" });
registerDashboardsConsumers(queue);
registerQueriesConsumers(queue);
registerMetricsConsumers(queue);
registerFactsConsumers(queue);
registerExportConsumer(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// G6: start the scheduler that re-runs scheduled queries on cadence.
const sweeper = startScheduledQuerySweeper();
// G5.3: scheduled export cron — env-gated behind ANALYTICS_SCHEDULER_ENABLED.
const exportCron = startScheduledExportCron();

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent, IF NOT EXISTS guards).
async function ensurePartitions(): Promise<void> {
  try {
    await db.execute(sql`SELECT analytics.create_future_partitions()`);
    await db.execute(sql`SELECT _outbox.create_future_partitions()`);
    log.info("partition maintenance: future partitions ensured");
  } catch (err) {
    log.warn({ err }, "partition maintenance: failed to create future partitions");
  }
}
// Run immediately on startup, then every 24 hours.
void ensurePartitions();
const partitionMaint = setInterval(() => void ensurePartitions(), 24 * 60 * 60_000);
partitionMaint.unref();

log.info("analytics-service worker: consumers + outbox relay + query sweeper running");
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(sweeper);
  if (exportCron) clearInterval(exportCron);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
