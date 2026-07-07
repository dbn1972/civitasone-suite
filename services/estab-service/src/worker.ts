import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerFilesConsumers }     from "./modules/files/consumer.js";
import { registerCommitteeConsumers } from "./modules/committee/consumer.js";
import { registerAssetsConsumers }    from "./modules/assets/consumer.js";
import { registerFacilitiesConsumers } from "./modules/facilities/consumer.js";
import { registerLegalConsumers }     from "./modules/legal/consumer.js";
import { registerRtiIntakeConsumers } from "./modules/legal/intake-consumer.js";
import { registerLinkageConsumers }   from "./modules/linkage/consumer.js";
import { registerApprovalRuleConsumers } from "./modules/approval-rules/consumer.js";
import { registerDfaConsumers }       from "./modules/dfa/consumer.js";
import { registerHandoverConsumers }  from "./modules/handover/consumer.js";
import { registerMigrationConsumers } from "./modules/migration/consumer.js";
import { registerOperatorConsumers }  from "./modules/operators/consumer.js";
import { registerReferencingConsumers } from "./modules/referencing/consumer.js";
import { registerCorrespondenceConsumers } from "./modules/correspondence/consumer.js";
import { registerRecordsConsumers } from "./modules/records/consumer.js";
import { registerEsignConsumers } from "./modules/esign/consumer.js";

const log = pino({ name: "estab-worker" });

registerFilesConsumers(queue);
registerCommitteeConsumers(queue);
registerAssetsConsumers(queue);
registerFacilitiesConsumers(queue);
registerLegalConsumers(queue);
registerRtiIntakeConsumers(queue);
registerLinkageConsumers(queue);
registerApprovalRuleConsumers(queue);
registerDfaConsumers(queue);
registerHandoverConsumers(queue);
registerMigrationConsumers(queue);
registerOperatorConsumers(queue);
registerReferencingConsumers(queue);
registerCorrespondenceConsumers(queue);
registerRecordsConsumers(queue);
registerEsignConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("estab-service worker: consumers + outbox relay running");

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
