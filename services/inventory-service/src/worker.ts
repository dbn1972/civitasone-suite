/**
 * inventory-service worker entrypoint — command/event consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerItemConsumers } from "./modules/items/consumer.js";
import { registerStoreConsumers } from "./modules/stores/consumer.js";
import { registerMovementConsumers } from "./modules/movements/consumer.js";
import { registerWarehouseConsumers } from "./modules/warehouses/consumer.js";
import { registerForecastConsumers } from "./modules/forecast/consumer.js";
import { startForecastRefresh } from "./modules/forecast/scheduler.js";

const log = pino({ name: "inventory-worker" });

registerItemConsumers(queue);
registerStoreConsumers(queue);
registerMovementConsumers(queue);
registerWarehouseConsumers(queue);
registerForecastConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 500, "inventory-service");
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// ML: daily forecast refresh (gated behind FEATURE_ML_ENABLED)
const forecastRefreshInterval = startForecastRefresh();
log.info("inventory-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  if (forecastRefreshInterval) clearInterval(forecastRefreshInterval);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
