/**
 * journey-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerJourneyConsumers } from "./modules/journeys/consumer.js";
import { registerStepConsumers } from "./modules/steps/consumer.js";
import { registerTriggerConsumers } from "./modules/triggers/consumer.js";
import { registerExecutionConsumers } from "./modules/executions/consumer.js";

const log = pino({ name: "journey-worker" });

registerJourneyConsumers(queue);
registerStepConsumers(queue);
registerTriggerConsumers(queue);
registerExecutionConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("journey-service worker: consumers + outbox relay running");

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
