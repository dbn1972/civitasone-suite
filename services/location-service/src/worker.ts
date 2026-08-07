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
import { registerInfrastructureConsumers } from "./modules/infrastructure/consumer.js";
import { registerGeoPointConsumers } from "./modules/map-markers/consumer.js";
import { registerMapLayerConsumers } from "./modules/map-layers/consumer.js";
import { registerRoadNetworkConsumers } from "./modules/road-network/consumer.js";
import { registerSpatialExchangeConsumers } from "./modules/spatial-exchange/consumer.js";
import { runWithTenant } from "@civitasone/db";

const log = pino({ name: "location-worker" });

// Wrap queue.subscribe to set tenant context from message — consumers run
// db.transaction() and RLS policies require app.tenant_id GUC to be set.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

registerLocationConsumers(queue);
registerHierarchyConsumers(queue);
registerJurisdictionConsumers(queue);
registerGeofenceConsumers(queue);
registerPincodeConsumers(queue);
registerLandRecordConsumers(queue);
registerCadastralConsumers(queue);
registerInfrastructureConsumers(queue);
registerGeoPointConsumers(queue);
registerMapLayerConsumers(queue);
registerRoadNetworkConsumers(queue);
registerSpatialExchangeConsumers(queue);
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
