import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerSchemeConsumers }        from "./modules/scheme/consumer.js";
import { registerApplicationConsumers }   from "./modules/application/consumer.js";
import { registerDisbursementConsumers } from "./modules/disbursement/consumer.js";
import { registerUtilisationConsumers } from "./modules/utilisation/consumer.js";
import { registerBeneficiaryConsumers } from "./modules/beneficiary/consumer.js";

const log = pino({ name: "grant-worker" });

registerSchemeConsumers(queue);
registerApplicationConsumers(queue);
registerDisbursementConsumers(queue);
registerUtilisationConsumers(queue);
registerBeneficiaryConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("grant-service worker: consumers + outbox relay running");

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
