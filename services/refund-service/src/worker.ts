import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerRequestConsumers } from "./modules/requests/consumer.js";
import { registerProcessingConsumers } from "./modules/processing/consumer.js";
import { registerReconciliationConsumers } from "./modules/reconciliation/consumer.js";

const log = pino({ name: "refund-worker" });

registerRequestConsumers(queue);
registerProcessingConsumers(queue);
registerReconciliationConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("refund-service worker: command consumers + outbox relay running");

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
