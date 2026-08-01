/**
 * cdp-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { COMMANDS, CONSUMED_EVENTS, SERVICE } from "./topics.js";
import { handleIngestEventBatch } from "./modules/events/consumer.js";
import { handleComputeSegment } from "./modules/segments/consumer.js";
import { handleActivateSegment } from "./modules/activations/consumer.js";
import { handleRaiseDsar } from "./modules/dsar/consumer.js";
import { handleCrmContactCreated, handleCrmContactUpdated } from "./modules/identity/crm-consumer.js";

const log = pino({ name: "cdp-worker" });

// Start outbox relay (positional: db, queue, intervalMs, service)
const relay = startRelay(db, queue, 1000, SERVICE);

// Own commands. Every handler calls markProcessed() as the first statement in its
// transaction, so a redelivery is a no-op rather than a duplicate write.
queue.subscribe<unknown>(COMMANDS.ingestEventBatch, handleIngestEventBatch);
queue.subscribe<unknown>(COMMANDS.computeSegment, handleComputeSegment);
queue.subscribe<unknown>(COMMANDS.activateSegment, handleActivateSegment);
queue.subscribe<unknown>(COMMANDS.raiseDsar, handleRaiseDsar);

// Cross-service events owned by crm-service. Typed as `unknown` deliberately: the payload
// is validated at runtime inside the handler because this service does not own the shape.
queue.subscribe<unknown>(CONSUMED_EVENTS.crmContactCreated, handleCrmContactCreated);
queue.subscribe<unknown>(CONSUMED_EVENTS.crmContactUpdated, handleCrmContactUpdated);

void queue.start().catch((err: unknown) => {
  log.error({ err }, "queue consumer failed to start");
  process.exit(1);
});

log.info("cdp-service worker: outbox relay + command consumers running");

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
