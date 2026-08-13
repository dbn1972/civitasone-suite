import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerPropertyConsumers } from "./modules/properties/consumer.js";
import { registerAllotmentConsumers } from "./modules/allotments/consumer.js";
import { registerBillingConsumers } from "./modules/billing/consumer.js";
import { registerLifecycleConsumers } from "./modules/lifecycle/consumer.js";

const log = pino({ name: "market-worker" });

registerPropertyConsumers(queue);
registerAllotmentConsumers(queue);
registerBillingConsumers(queue);
registerLifecycleConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("market-service worker: command consumers + outbox relay running");

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
