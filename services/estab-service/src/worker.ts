import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerFilesConsumers }     from "./modules/files/consumer.js";
import { registerCommitteeConsumers } from "./modules/committee/consumer.js";
import { registerAssetsConsumers }    from "./modules/assets/consumer.js";
import { registerFacilitiesConsumers } from "./modules/facilities/consumer.js";
import { registerLegalConsumers }     from "./modules/legal/consumer.js";
import { registerRtiIntakeConsumers } from "./modules/legal/intake-consumer.js";
import { registerLinkageConsumers }   from "./modules/linkage/consumer.js";

const log = pino({ name: "estab-worker" });

registerFilesConsumers(queue);
registerCommitteeConsumers(queue);
registerAssetsConsumers(queue);
registerFacilitiesConsumers(queue);
registerLegalConsumers(queue);
registerRtiIntakeConsumers(queue);
registerLinkageConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("estab-service worker: consumers + outbox relay running");

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
