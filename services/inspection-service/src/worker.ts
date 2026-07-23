/**
 * SQS/RabbitMQ consumer entrypoint for inspection-service.
 * Subscribes to all COMMANDS + CONSUMED_EVENTS, starts the outbox relay,
 * and handles DLQ routing for messages that fail after max retries.
 *
 * Graceful shutdown: SIGTERM → stop queue consumers → clear outbox relay → close DB pool.
 *
 * _Requirements: 1.1, 1.2, 1.6, 1.9_
 */
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { COMMANDS, CONSUMED_EVENTS } from "./topics.js";
import { incrementDlqMessage, captureError } from "@civitasone/observability";

const log = pino({ name: "inspection-worker" });

// ── Consumer registration ────────────────────────────────────────────────────
import { registerUniverseConsumers } from "./modules/universe/consumer.js";
import { registerRiskConsumers } from "./modules/risk/consumer.js";
import { registerPlanningConsumers } from "./modules/planning/consumer.js";
import { registerAssignmentConsumers } from "./modules/assignment/consumer.js";
import { registerChecklistConsumers } from "./modules/checklist/consumer.js";
import { registerSyncConsumers } from "./modules/sync/consumer.js";
import { registerEvidenceConsumers } from "./modules/evidence/consumer.js";
import { registerExecutionConsumers } from "./modules/execution/consumer.js";
import { registerFindingsConsumers } from "./modules/findings/consumer.js";

registerUniverseConsumers(queue);
registerRiskConsumers(queue);
registerPlanningConsumers(queue);
registerAssignmentConsumers(queue);
registerChecklistConsumers(queue);
registerSyncConsumers(queue);
registerEvidenceConsumers(queue);
registerExecutionConsumers(queue);
registerFindingsConsumers(queue);

// ── DLQ handling ─────────────────────────────────────────────────────────────
// Subscribe to DLQ topics for observability. Messages that exceed max retries
// are logged with full context so operators can investigate and replay.
const allTopics = [...Object.values(COMMANDS), ...Object.values(CONSUMED_EVENTS)];

for (const topic of allTopics) {
  const dlqTopic = `${topic}.dlq`;
  queue.subscribe(dlqTopic, async (msg) => {
    incrementDlqMessage(topic);
    captureError(new Error(`DLQ message received: ${topic}`), {
      service: "inspection-service",
      topic,
      correlationId: msg.correlationId,
      messageId: msg.messageId,
      tenantId: msg.tenantId,
    });
    log.error(
      {
        event: "dlq_received",
        topic,
        messageId: msg.messageId,
        tenantId: msg.tenantId,
        correlationId: msg.correlationId,
      },
      "message dead-lettered after max retries",
    );
  });
}

// ── Start queue, outbox relay, and purge ─────────────────────────────────────
await queue.start();
const relay = startRelay(db, queue);
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("inspection-service worker: consumers + outbox relay running");

// ── Partition maintenance ────────────────────────────────────────────────────
// Auto-create monthly partitions 3 months ahead. Runs daily, idempotent.
async function ensurePartitions(): Promise<void> {
  try {
    await db.execute(sql`SELECT _outbox.create_future_partitions()`);
    log.info("partition maintenance: future partitions ensured");
  } catch (err) {
    log.warn({ err }, "partition maintenance: failed to create future partitions");
  }
}
void ensurePartitions();
const partitionMaint = setInterval(() => void ensurePartitions(), 24 * 60 * 60_000);
partitionMaint.unref();

// ── Graceful shutdown ────────────────────────────────────────────────────────
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
process.on("SIGINT", () => void shutdown("SIGINT"));
