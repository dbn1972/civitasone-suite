/**
 * telephony-service worker entrypoint — command consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerCallConsumers } from "./modules/calls/consumer.js";
import { registerQueueConsumers } from "./modules/queues/consumer.js";
import { registerAgentConsumers } from "./modules/agents/consumer.js";
import { registerDidConsumers } from "./modules/did/consumer.js";
import { registerRecordingConsumers } from "./modules/recordings/consumer.js";
import { registerTranscriptionConsumers } from "./modules/transcription/consumer.js";
import { registerIvrConsumers } from "./modules/ivr/consumer.js";

const log = pino({ name: "telephony-worker" });

registerCallConsumers(queue);
registerQueueConsumers(queue);
registerAgentConsumers(queue);
registerDidConsumers(queue);
registerRecordingConsumers(queue);
registerTranscriptionConsumers(queue);
registerIvrConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("telephony-service worker: consumers + outbox relay running");

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
