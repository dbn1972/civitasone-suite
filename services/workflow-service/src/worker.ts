import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerInstancesConsumers } from "./modules/instances/consumer.js";
import { registerTasksConsumers } from "./modules/tasks/consumer.js";
import { registerProvisioningConsumers } from "./modules/provisioning/consumer.js";
import { registerMessagesConsumers } from "./modules/messages/consumer.js";
import { startSlaSweeper, startTimerSweeper, startReminderSweeper } from "./modules/tasks/sweeper.js";
import { startMessageSweeper } from "./modules/messages/sweeper.js";

const log = pino({ name: "workflow-worker" });
registerInstancesConsumers(queue);
registerTasksConsumers(queue);
registerProvisioningConsumers(queue);
registerMessagesConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
const slaSweeper = startSlaSweeper(Number(process.env.SLA_SWEEP_MS ?? 30_000));
// P1-2 — deemed-approval timer sweeper.
const timerSweeper = startTimerSweeper(Number(process.env.TIMER_SWEEP_MS ?? 15_000));
const reminderSweeper = startReminderSweeper(Number(process.env.REMINDER_SWEEP_MS ?? 30_000));
const msgTimeoutSweeper = startMessageSweeper(Number(process.env.MSG_TIMEOUT_SWEEP_MS ?? 30_000));

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent, IF NOT EXISTS guards).
async function ensurePartitions(): Promise<void> {
  try {
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

log.info("workflow-service worker: consumers + outbox relay + sla + timer + message sweepers running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(slaSweeper);
  clearInterval(timerSweeper);
  clearInterval(reminderSweeper);
  clearInterval(msgTimeoutSweeper);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
