import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerLocationConsumers } from "./modules/locations/consumer.js";
import { registerHierarchyConsumers } from "./modules/hierarchy/consumer.js";
import { registerJurisdictionConsumers } from "./modules/jurisdiction/consumer.js";
import { registerGeofenceConsumers } from "./modules/geofence/consumer.js";
import { registerPincodeConsumers } from "./modules/pincode/consumer.js";

const log = pino({ name: "location-worker" });

registerLocationConsumers(queue);
registerHierarchyConsumers(queue);
registerJurisdictionConsumers(queue);
registerGeofenceConsumers(queue);
registerPincodeConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("location-service worker: consumers + outbox relay running");

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
