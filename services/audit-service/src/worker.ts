import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerAuditConsumers } from "./modules/events/consumer.js";
import { registerPlanConsumers } from "./modules/plan/consumer.js";
import { registerObservationConsumers } from "./modules/observation/consumer.js";
import { registerParaConsumers } from "./modules/para/consumer.js";
import { registerComplianceConsumers } from "./modules/compliance/consumer.js";
import { registerExportConsumers } from "./modules/exports/consumer.js";
import { registerRiskConsumers } from "./modules/risk/consumer.js";
import { startAgeingJob } from "./modules/compliance/jobs.js";

const log = pino({ name: "audit-worker" });
registerAuditConsumers(queue);
registerPlanConsumers(queue);
registerObservationConsumers(queue);
registerParaConsumers(queue);
registerComplianceConsumers(queue);
registerExportConsumers(queue);
registerRiskConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// P2-4: scheduled ageing sweep (pending -> overdue past dueDate).
const ageing = startAgeingJob(log);

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent, IF NOT EXISTS guards).
async function ensurePartitions(): Promise<void> {
  try {
    await db.execute(sql`SELECT events.create_future_partitions()`);
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

log.info("audit-service worker: consumers + outbox relay + ageing job running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(ageing);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
