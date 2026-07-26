import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerLocationConsumers } from "./modules/locations/consumer.js";
import { registerHierarchyConsumers } from "./modules/hierarchy/consumer.js";
import { registerJurisdictionConsumers } from "./modules/jurisdiction/consumer.js";
import { registerGeofenceConsumers } from "./modules/geofence/consumer.js";
import { registerPincodeConsumers } from "./modules/pincode/consumer.js";
import { registerLandRecordConsumers } from "./modules/land-records/consumer.js";
import { registerCadastralConsumers } from "./modules/cadastral/consumer.js";

const log = pino({ name: "location-worker" });

registerLocationConsumers(queue);
registerHierarchyConsumers(queue);
registerJurisdictionConsumers(queue);
registerGeofenceConsumers(queue);
registerPincodeConsumers(queue);
registerLandRecordConsumers(queue);
registerCadastralConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("location-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
