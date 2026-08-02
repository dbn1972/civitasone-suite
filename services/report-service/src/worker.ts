/**
 * report-service worker entrypoint — command consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerJobConsumers } from "./modules/jobs/consumer.js";
import { registerRenderConsumers } from "./modules/render/consumer.js";
import { registerScheduledConsumers } from "./modules/scheduled/consumer.js";
import { startScheduledReportCron } from "./modules/scheduled/cron.js";

const log = pino({ name: "reports-worker" });

registerJobConsumers(queue);
registerRenderConsumers(queue);
registerScheduledConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// Start scheduled report generation cron (env-gated)
const scheduledCron = startScheduledReportCron();
log.info("report-service worker: consumers + outbox relay + scheduled-cron running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  if (scheduledCron) clearInterval(scheduledCron);
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
