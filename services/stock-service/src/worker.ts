import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerItemConsumers }      from "./modules/item/consumer.js";
import { registerWarehouseConsumers } from "./modules/warehouse/consumer.js";
import { registerEntryConsumers }     from "./modules/entry/consumer.js";

const log = pino({ name: "stock-worker" });

registerItemConsumers(queue);
registerWarehouseConsumers(queue);
registerEntryConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("stock-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
