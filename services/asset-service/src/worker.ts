import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerRegisterConsumers }     from "./modules/register/consumer.js";
import { registerLifecycleConsumers }    from "./modules/lifecycle/consumer.js";
import { registerDisposalEOfficeDecisionConsumers } from "./modules/lifecycle/eoffice-consumer.js";
import { registerDepreciationConsumers } from "./modules/depreciation/consumer.js";
import { registerMaintenanceConsumers }  from "./modules/maintenance/consumer.js";
import { registerInsuranceConsumers }    from "./modules/insurance/consumer.js";
import { registerEnterpriseConsumers }   from "./modules/enterprise/consumer.js";
import { startDepScheduler }            from "./modules/depreciation/scheduler.js";

const log = pino({ name: "asset-worker" });

registerRegisterConsumers(queue);
registerLifecycleConsumers(queue);
registerDisposalEOfficeDecisionConsumers(queue);
registerDepreciationConsumers(queue);
registerMaintenanceConsumers(queue);
registerInsuranceConsumers(queue);
registerEnterpriseConsumers(queue);

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
