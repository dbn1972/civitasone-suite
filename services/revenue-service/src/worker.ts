import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerRateEngineConsumers } from "./modules/rate-engine/consumer.js";
import { registerAssesseeConsumers } from "./modules/assessee/consumer.js";
import { registerAssessmentConsumers } from "./modules/assessment/consumer.js";
import { registerBillingConsumers } from "./modules/billing/consumer.js";
import { registerCollectionConsumers } from "./modules/collection/consumer.js";
import { registerArrearsConsumers } from "./modules/arrears/consumer.js";
import { registerBbpsConsumers } from "./modules/bbps/consumer.js";
import { registerReconConsumers } from "./modules/collection/recon-consumer.js";
import { registerTradeLicenseConsumers } from "./modules/trade-license/consumer.js";

const log = pino({ name: "revenue-worker" });

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

// Register all module consumers
registerRateEngineConsumers(queue);
registerAssesseeConsumers(queue);
registerAssessmentConsumers(queue);
registerBillingConsumers(queue);
registerCollectionConsumers(queue);
registerArrearsConsumers(queue);
registerBbpsConsumers(queue);
registerReconConsumers(queue);
registerTradeLicenseConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("revenue-service worker: consumers + outbox relay running");

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
