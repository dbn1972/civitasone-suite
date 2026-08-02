import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import { registerPortalConsumers }      from "./modules/portal/consumer.js";
import { registerApplicationConsumers } from "./modules/application/consumer.js";
import { registerGrievanceConsumers }   from "./modules/grievance/consumer.js";
import { registerRtiConsumers }         from "./modules/rti/consumer.js";
import { registerHelpdeskConsumers }    from "./modules/helpdesk/consumer.js";
import { startSlaSweep }                from "./modules/sla-sweep/scheduler.js";
import { registerFeePaymentConsumers }  from "./modules/fee-payment/consumer.js";
import { registerIssuanceConsumers }    from "./modules/issuance/consumer.js";

const log = pino({ name: "citizen-worker" });

// P0-6: fail-fast if CITIZEN_PII_KEY is absent/too short so the worker never runs fail-open.
assertPiiKeyConfigured();

registerPortalConsumers(queue);
registerApplicationConsumers(queue);
registerGrievanceConsumers(queue);
registerRtiConsumers(queue);
registerHelpdeskConsumers(queue);
registerFeePaymentConsumers(queue);
registerIssuanceConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// P0-2: periodic SLA-breach sweep (grievances/applications/tickets/RTIs).
const slaSweep = startSlaSweep(queue, log);
log.info("citizen-service worker: consumers + outbox relay + sla sweep running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  if (slaSweep) clearInterval(slaSweep);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
