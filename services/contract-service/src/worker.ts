import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerContractConsumers } from "./modules/contracts/consumer.js";
import { registerRateConsumers }     from "./modules/rate/consumer.js";

const log = pino({ name: "contract-worker" });

registerContractConsumers(queue);
registerRateConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("contract-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
