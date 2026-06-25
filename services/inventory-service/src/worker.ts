/**
 * inventory-service worker entrypoint — command/event consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerItemConsumers } from "./modules/items/consumer.js";
import { registerStoreConsumers } from "./modules/stores/consumer.js";
import { registerMovementConsumers } from "./modules/movements/consumer.js";

const log = pino({ name: "inventory-worker" });

registerItemConsumers(queue);
registerStoreConsumers(queue);
registerMovementConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 500, "inventory-service");
log.info("inventory-service worker: consumers + outbox relay running");

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
