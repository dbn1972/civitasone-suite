/**
 * field-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerTaskConsumers } from "./modules/tasks/consumer.js";
import { registerVisitConsumers } from "./modules/visits/consumer.js";
import { registerRouteConsumers } from "./modules/routes/consumer.js";
import { registerSyncConsumers } from "./modules/sync/consumer.js";

const log = pino({ name: "field-worker" });

registerTaskConsumers(queue);
registerVisitConsumers(queue);
registerRouteConsumers(queue);
registerSyncConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("field-service worker: consumers + outbox relay running");

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
