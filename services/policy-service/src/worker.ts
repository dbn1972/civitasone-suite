import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerRoleConsumers } from "./modules/roles/consumer.js";
import { registerBindingConsumers } from "./modules/bindings/consumer.js";

const log = pino({ name: "policy-worker" });
registerRoleConsumers(queue);
registerBindingConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("policy-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
