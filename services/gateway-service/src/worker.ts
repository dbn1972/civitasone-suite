/**
 * gateway-service worker — catalogue CQRS consumers + transactional outbox relay.
 * Deployed as PM2 process `gateway-worker` (see ecosystem.config.js).
 */
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerCatalogueConsumers } from "./modules/catalogue/consumer.js";

const log = pino({ name: "gateway-worker" });

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

registerCatalogueConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("gateway-service worker: catalogue consumers + outbox relay running");

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
