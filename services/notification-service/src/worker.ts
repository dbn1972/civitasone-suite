import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerTemplateConsumers } from "./modules/templates/consumer.js";
import { registerDeliveryConsumers } from "./modules/deliveries/consumer.js";
import { registerChannelConsumers } from "./modules/channels/consumer.js";
import { registerAlertConsumers } from "./modules/alerts/consumer.js";
import { registerBulkConsumers } from "./modules/bulk/consumer.js";
import { registerDomainEventConsumers } from "./modules/domain-events/consumer.js";
import { registerMLPredictionConsumers } from "./modules/ml-predictions/consumer.js";
import { startRetrySweeper } from "./modules/deliveries/sweeper.js";
import { registerSchedulingConsumers } from "./modules/scheduling/consumer.js";
import { startScheduleSweeper } from "./modules/scheduling/sweeper.js";
import { registerDigestConsumers } from "./modules/digest/consumer.js";
import { startDigestFlushSweeper } from "./modules/digest/sweeper.js";
import { registerWebhookConsumers } from "./modules/webhook/consumer.js";
import { registerAnalyticsConsumers } from "./modules/analytics/consumer.js";
import { registerDndConsumers } from "./modules/dnd/consumer.js";
import { startDndReleaseSweeper } from "./modules/dnd/sweeper.js";
import { registerI18nConsumers } from "./modules/i18n/consumer.js";
import { registerSegmentConsumers } from "./modules/segments/consumer.js";
import { registerApprovalConsumers } from "./modules/approval/consumer.js";

const log = pino({ name: "notification-worker" });
registerTemplateConsumers(queue);
registerDeliveryConsumers(queue);
registerChannelConsumers(queue);
registerAlertConsumers(queue);
registerBulkConsumers(queue);
registerDomainEventConsumers(queue);
registerMLPredictionConsumers(queue);
registerSchedulingConsumers(queue);
registerDigestConsumers(queue);
registerWebhookConsumers(queue);
registerAnalyticsConsumers(queue);
registerDndConsumers(queue);
registerI18nConsumers(queue);
registerSegmentConsumers(queue);
registerApprovalConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// P1-2: DB-backed retry sweeper — durable across restarts (replaces setTimeout republish).
const retrySweeper = startRetrySweeper(queue);
// New sweepers for scheduling, digest, and DND
const scheduleSweeper = startScheduleSweeper(queue);
const digestFlushSweeper = startDigestFlushSweeper(queue);
const dndReleaseSweeper = startDndReleaseSweeper(queue);

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

log.info("notification-service worker: consumers + outbox relay + retry sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(retrySweeper);
  clearInterval(scheduleSweeper);
  clearInterval(digestFlushSweeper);
  clearInterval(dndReleaseSweeper);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
