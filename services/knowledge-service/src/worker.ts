/**
 * knowledge-service worker entrypoint.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerDocumentsConsumers } from "./modules/documents/consumer.js";
import { registerCategoriesConsumers } from "./modules/categories/consumer.js";
import { registerRetentionConsumers } from "./modules/retention/consumer.js";
import { registerSearchConsumers } from "./modules/search/consumer.js";
import { registerVersionsConsumers } from "./modules/versions/consumer.js";
import { registerSharingConsumers } from "./modules/sharing/consumer.js";

const log = pino({ name: "knowledge-worker" });

registerDocumentsConsumers(queue);
registerCategoriesConsumers(queue);
registerRetentionConsumers(queue);
registerSearchConsumers(queue);
registerVersionsConsumers(queue);
registerSharingConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("knowledge-service worker: consumers + outbox relay running");

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
