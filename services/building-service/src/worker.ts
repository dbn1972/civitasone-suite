import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerApplicationConsumers } from "./modules/applications/consumer.js";
import { registerScrutinyConsumers } from "./modules/scrutiny/consumer.js";
import { registerPermitConsumers } from "./modules/permits/consumer.js";
import { registerLifecycleConsumers } from "./modules/lifecycle/consumer.js";

const log = pino({ name: "building-worker" });

registerApplicationConsumers(queue);
registerScrutinyConsumers(queue);
registerPermitConsumers(queue);
registerLifecycleConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("building-service worker: command consumers + outbox relay running");

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
