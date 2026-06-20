import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerUserConsumers } from "./modules/users/consumer.js";
import { registerSessionConsumers } from "./modules/sessions/consumer.js";
import { registerMfaConsumers } from "./modules/mfa/consumer.js";
import { registerSyncFeederConsumers } from "./modules/sync/feeder.js";

const log = pino({ name: "identity-worker" });

registerUserConsumers(queue);
registerSessionConsumers(queue);
registerMfaConsumers(queue);
registerSyncFeederConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("identity-service worker: consumers + outbox relay running");

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
