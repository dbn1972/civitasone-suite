import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerItemConsumers } from "./modules/items/consumer.js";
import { registerRegistryConsumers } from "./modules/registry/consumer.js";
import { registerHookConsumers } from "./modules/hooks/consumer.js";
import { registerStoreConsumers } from "./modules/store/consumer.js";
import { registerRuntimeConsumers } from "./modules/runtime/consumer.js";

const log = pino({ name: "plugins-worker" });

registerItemConsumers(queue);
registerRegistryConsumers(queue);
registerHookConsumers(queue);
registerStoreConsumers(queue);
registerRuntimeConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("plugin-service worker: consumers + outbox relay running");

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
process.on("SIGINT", () => void shutdown("SIGINT"));
