import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerTenantConsumers } from "./modules/tenants/consumer.js";
import { registerConfigConsumers } from "./modules/config/consumer.js";
import { registerBackupConsumers } from "./modules/backup/consumer.js";
import { registerSupportConsumers } from "./modules/support/consumer.js";

const log = pino({ name: "admin-worker" });

registerTenantConsumers(queue);
registerConfigConsumers(queue);
registerBackupConsumers(queue);
registerSupportConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("admin-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
