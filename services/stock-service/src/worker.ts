import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerItemConsumers }      from "./modules/item/consumer.js";
import { registerWarehouseConsumers } from "./modules/warehouse/consumer.js";
import { registerEntryConsumers }     from "./modules/entry/consumer.js";
import { registerEwayBillConsumers }  from "./modules/eway-bill/consumer.js";

const log = pino({ name: "stock-worker" });

registerItemConsumers(queue);
registerWarehouseConsumers(queue);
registerEntryConsumers(queue);
registerEwayBillConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("stock-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
