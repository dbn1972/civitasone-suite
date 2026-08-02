import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { startTrainingCron } from "./modules/training/orchestrator.js";
import { registerPurgeConsumer } from "./modules/purge/consumer.js";
import { registerFeatureStoreConsumers } from "./modules/feature-store/consumer.js";

const log = pino({ name: "ml-worker" });

// Register consumers
registerPurgeConsumer(queue);
registerFeatureStoreConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);

// Outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

// Training pipeline cron — weekly model training orchestration.
// Gated behind FEATURE_ML_TRAINING_ENABLED env var.
const trainingCron = startTrainingCron();

log.info("ml-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  if (trainingCron) clearInterval(trainingCron);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
