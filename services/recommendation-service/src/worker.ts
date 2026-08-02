/**
 * recommendation-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { COMMANDS, SERVICE } from "./topics.js";
import {
  handleAttachCollateral,
  type AttachCollateralPayload,
} from "./modules/collateral/consumer.js";
import {
  handleComputeIntelligence,
  type ComputeIntelligencePayload,
} from "./modules/intelligence/consumer.js";
import {
  handleRecordAttribution,
  type RecordAttributionPayload,
} from "./modules/measurement/consumer.js";

const log = pino({ name: "recommendation-worker" });

// Start outbox relay (positional: db, queue, intervalMs, service)
const relay = startRelay(db, queue, 1000, SERVICE);

// Command consumers. Each handler calls markProcessed() first, so a redelivery
// is a no-op rather than a duplicate write.
queue.subscribe<AttachCollateralPayload>(COMMANDS.collateralAttach, handleAttachCollateral);
queue.subscribe<ComputeIntelligencePayload>(COMMANDS.intelligenceCompute, handleComputeIntelligence);
queue.subscribe<RecordAttributionPayload>(COMMANDS.attributionRecord, handleRecordAttribution);

void queue.start().catch((err: unknown) => {
  log.error({ err }, "queue consumer failed to start");
  process.exit(1);
});

log.info("recommendation-service worker: outbox relay + command consumers running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
