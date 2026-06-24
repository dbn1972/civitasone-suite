import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerPortalConsumers }      from "./modules/portal/consumer.js";
import { registerApplicationConsumers } from "./modules/application/consumer.js";
import { registerGrievanceConsumers }   from "./modules/grievance/consumer.js";
import { registerRtiConsumers }         from "./modules/rti/consumer.js";
import { registerHelpdeskConsumers }    from "./modules/helpdesk/consumer.js";
import { startSlaSweep }                from "./modules/sla-sweep/scheduler.js";

const log = pino({ name: "citizen-worker" });

registerPortalConsumers(queue);
registerApplicationConsumers(queue);
registerGrievanceConsumers(queue);
registerRtiConsumers(queue);
registerHelpdeskConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// P0-2: periodic SLA-breach sweep (grievances/applications/tickets/RTIs).
const slaSweep = startSlaSweep(queue, log);
log.info("citizen-service worker: consumers + outbox relay + sla sweep running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  if (slaSweep) clearInterval(slaSweep);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
