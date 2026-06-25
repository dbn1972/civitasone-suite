/**
 * telephony-service worker entrypoint — command consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerCallConsumers } from "./modules/calls/consumer.js";
import { registerQueueConsumers } from "./modules/queues/consumer.js";
import { registerAgentConsumers } from "./modules/agents/consumer.js";

const log = pino({ name: "telephony-worker" });

registerCallConsumers(queue);
registerQueueConsumers(queue);
registerAgentConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("telephony-service worker: consumers + outbox relay running");

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
