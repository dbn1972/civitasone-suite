import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerConnectionConsumers } from "./modules/connections/consumer.js";
import { registerBillingConsumers } from "./modules/billing/consumer.js";
import { registerComplaintConsumers } from "./modules/complaints/consumer.js";
import { registerDesludgingConsumers } from "./modules/desludging/consumer.js";

const log = pino({ name: "sewerage-worker" });

registerConnectionConsumers(queue);
registerBillingConsumers(queue);
registerComplaintConsumers(queue);
registerDesludgingConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("sewerage-service worker: consumers + outbox relay running");

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
