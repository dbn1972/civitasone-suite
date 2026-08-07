import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { runWithTenant } from "@civitasone/db";
import { registerSchemeConsumers }        from "./modules/scheme/consumer.js";
import { registerApplicationConsumers }   from "./modules/application/consumer.js";
import { registerDisbursementConsumers } from "./modules/disbursement/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/disbursement/eoffice-consumer.js";
import { registerSchemeEOfficeConsumers } from "./modules/scheme/eoffice-consumer.js";
import { registerUtilisationConsumers } from "./modules/utilisation/consumer.js";
import { registerBeneficiaryConsumers } from "./modules/beneficiary/consumer.js";
import { registerIntegrationConsumers } from "./modules/integration/consumer.js";

const log = pino({ name: "grant-worker" });

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

registerSchemeConsumers(queue);
registerApplicationConsumers(queue);
registerDisbursementConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerSchemeEOfficeConsumers(queue);
registerUtilisationConsumers(queue);
registerBeneficiaryConsumers(queue);
registerIntegrationConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("grant-service worker: consumers + outbox relay running");

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
process.on("SIGINT",  () => void shutdown("SIGINT"));
