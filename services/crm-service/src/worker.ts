/**
 * crm-service worker entrypoint.
 * Runs the command consumers (the only DB writers) + the outbox relay.
 * Separate process from the API so writes scale independently (CLAUDE.md §6).
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerContactConsumers } from "./modules/contacts/consumer.js";
import { registerDealConsumers } from "./modules/deals/consumer.js";
import { registerActivityConsumers } from "./modules/activities/consumer.js";

const log = pino({ name: "crm-worker" });

registerContactConsumers(queue);
registerDealConsumers(queue);
registerActivityConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("crm-service worker: consumers + outbox relay running");

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
