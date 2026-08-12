import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerComplaintConsumers } from "./modules/complaints/consumer.js";
import { registerBulkGeneratorConsumers } from "./modules/bulk_generators/consumer.js";
import { registerCollectionConsumers } from "./modules/collection/consumer.js";
import { registerAnalyticsConsumers } from "./modules/analytics/consumer.js";

const log = pino({ name: "swm-worker" });

registerComplaintConsumers(queue);
registerBulkGeneratorConsumers(queue);
registerCollectionConsumers(queue);
registerAnalyticsConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("swm-service worker: consumers + outbox relay running");

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
