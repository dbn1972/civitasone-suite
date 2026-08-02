/**
 * gateway-service worker — catalogue CQRS consumers + transactional outbox relay.
 * Deployed as PM2 process `gateway-worker` (see ecosystem.config.js).
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerCatalogueConsumers } from "./modules/catalogue/consumer.js";

const log = pino({ name: "gateway-worker" });

registerCatalogueConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("gateway-service worker: catalogue consumers + outbox relay running");

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
