import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerStageConsumers } from "./modules/stages/consumer.js";
import { registerProvisioningConsumers } from "./modules/provisioning/consumer.js";

const log = pino({ name: "install-worker" });

registerStageConsumers(queue);
registerProvisioningConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("install-service worker: consumers + outbox relay running");

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
