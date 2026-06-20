import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerPortalConsumers }      from "./modules/portal/consumer.js";
import { registerApplicationConsumers } from "./modules/application/consumer.js";
import { registerGrievanceConsumers }   from "./modules/grievance/consumer.js";
import { registerRtiConsumers }         from "./modules/rti/consumer.js";
import { registerHelpdeskConsumers }    from "./modules/helpdesk/consumer.js";

const log = pino({ name: "citizen-worker" });

registerPortalConsumers(queue);
registerApplicationConsumers(queue);
registerGrievanceConsumers(queue);
registerRtiConsumers(queue);
registerHelpdeskConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("citizen-service worker: consumers + outbox relay running");

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
