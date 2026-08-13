import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerComplaintConsumers } from "./modules/complaints/consumer.js";
import { registerTreeRequestConsumers } from "./modules/tree_requests/consumer.js";
import { registerInspectionConsumers } from "./modules/inspections/consumer.js";
import { registerAssetConsumers } from "./modules/assets/consumer.js";

const log = pino({ name: "parks-worker" });

registerComplaintConsumers(queue);
registerTreeRequestConsumers(queue);
registerInspectionConsumers(queue);
registerAssetConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("parks-service worker: consumers + outbox relay running");

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
