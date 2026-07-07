import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerPayrollConsumers } from "./modules/payroll/consumer.js";
import { registerLoansConsumers }   from "./modules/loans/consumer.js";
import { registerTaxConsumers }     from "./modules/tax/consumer.js";
import { registerIntegrationConsumers } from "./modules/integration/consumer.js";
import { registerNachReturnConsumers } from "./modules/nach-return/consumer.js";
import { registerFnfConsumers } from "./modules/fnf/consumer.js";
import { registerForm16BulkConsumers } from "./modules/form16-pdf/bulk-consumer.js";
import { loadTaxConfig } from "./modules/tax/config.js";

const log = pino({ name: "payroll-worker" });

await loadTaxConfig();

registerPayrollConsumers(queue);
registerLoansConsumers(queue);
registerTaxConsumers(queue);
registerIntegrationConsumers(queue);
registerNachReturnConsumers(queue);
registerFnfConsumers(queue);
registerForm16BulkConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("payroll-service worker: consumers + outbox relay running");

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

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
