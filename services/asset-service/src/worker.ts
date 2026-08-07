import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { runWithTenant } from "@civitasone/db";
import { registerRegisterConsumers }     from "./modules/register/consumer.js";
import { registerWorksHandoverConsumers } from "./modules/register/handover-consumer.js";
import { registerLifecycleConsumers }    from "./modules/lifecycle/consumer.js";
import { registerDisposalEOfficeDecisionConsumers } from "./modules/lifecycle/eoffice-consumer.js";
import { registerDepreciationConsumers } from "./modules/depreciation/consumer.js";
import { registerMaintenanceConsumers }  from "./modules/maintenance/consumer.js";
import { registerInsuranceConsumers }    from "./modules/insurance/consumer.js";
import { registerEnterpriseConsumers }   from "./modules/enterprise/consumer.js";
import { registerF3EnterpriseConsumers } from "./modules/enterprise/f3-consumer.js";
import { registerCondemnationConsumers } from "./modules/condemnation/consumer.js";
import { registerFleetConsumers }         from "./modules/fleet/consumer.js";
import { registerVerificationConsumers } from "./modules/verification/consumer.js";
import { startDepScheduler }            from "./modules/depreciation/scheduler.js";

const log = pino({ name: "asset-worker" });

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

registerRegisterConsumers(queue);
registerWorksHandoverConsumers(queue);
registerLifecycleConsumers(queue);
registerDisposalEOfficeDecisionConsumers(queue);
registerDepreciationConsumers(queue);
registerMaintenanceConsumers(queue);
registerInsuranceConsumers(queue);
registerEnterpriseConsumers(queue);
registerF3EnterpriseConsumers(queue);
registerCondemnationConsumers(queue);
registerFleetConsumers(queue);
registerVerificationConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
const depScheduler = startDepScheduler(queue);
log.info("asset-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(depScheduler);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
