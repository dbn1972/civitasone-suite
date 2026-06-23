import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerRegisterConsumers }     from "./modules/register/consumer.js";
import { registerLifecycleConsumers }    from "./modules/lifecycle/consumer.js";
import { registerDepreciationConsumers } from "./modules/depreciation/consumer.js";
import { registerMaintenanceConsumers }  from "./modules/maintenance/consumer.js";
import { registerInsuranceConsumers }    from "./modules/insurance/consumer.js";
import { registerEnterpriseConsumers }   from "./modules/enterprise/consumer.js";

const log = pino({ name: "asset-worker" });

registerRegisterConsumers(queue);
registerLifecycleConsumers(queue);
registerDepreciationConsumers(queue);
registerMaintenanceConsumers(queue);
registerInsuranceConsumers(queue);
registerEnterpriseConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("asset-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
