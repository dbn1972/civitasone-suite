import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerFilesConsumers }    from "./modules/files/consumer.js";
import { registerFoldersConsumers }  from "./modules/folders/consumer.js";
import { registerWorkflowConsumers } from "./modules/workflow/consumer.js";
import { registerSharingConsumers }  from "./modules/sharing/consumer.js";

const log = pino({ name: "document-worker" });

registerFilesConsumers(queue);
registerFoldersConsumers(queue);
registerWorkflowConsumers(queue);
registerSharingConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

log.info("document-service worker: consumers + outbox relay running");

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
