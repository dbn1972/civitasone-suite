/**
 * loyalty-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerProgramConsumers } from "./modules/programs/consumer.js";
import { registerEnrolmentConsumers } from "./modules/enrolments/consumer.js";
import { registerAccrualConsumers } from "./modules/accruals/consumer.js";
import { registerRedemptionConsumers } from "./modules/redemptions/consumer.js";
import { registerTierConsumers } from "./modules/tiers/consumer.js";
import { runWithTenant } from "@civitasone/db";

const log = pino({ name: "loyalty-worker" });

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

registerProgramConsumers(queue);
registerEnrolmentConsumers(queue);
registerAccrualConsumers(queue);
registerRedemptionConsumers(queue);
registerTierConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("loyalty-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
