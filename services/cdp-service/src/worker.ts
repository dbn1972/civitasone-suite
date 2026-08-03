/**
 * cdp-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerProfileConsumers } from "./modules/profiles/consumer.js";
import { registerIdentityConsumers } from "./modules/identity/consumer.js";
import { registerEventConsumers } from "./modules/events/consumer.js";
import { registerSegmentConsumers } from "./modules/segments/consumer.js";
import { registerStewardConsumers } from "./modules/steward/consumer.js";
import { registerActivationConsumers } from "./modules/activations/consumer.js";
import { registerDsarConsumers } from "./modules/dsar/consumer.js";
import { registerF3CdpConsumers } from "./modules/f3-consumer.js";
import { handleCrmContactCreated, handleCrmContactUpdated } from "./modules/identity/crm-consumer.js";
import { tenantScoped } from "./shared/tenant-queue.js";
import { CONSUMED_EVENTS } from "./topics.js";

const log = pino({ name: "cdp-worker" });

registerProfileConsumers(queue);
registerIdentityConsumers(queue);
registerEventConsumers(queue);
registerSegmentConsumers(queue);
registerStewardConsumers(queue);
registerActivationConsumers(queue);
registerDsarConsumers(queue);
registerF3CdpConsumers(queue);

// Cross-service CRM events
const scoped = tenantScoped(queue);
scoped.subscribe(CONSUMED_EVENTS.crmContactCreated, handleCrmContactCreated);
scoped.subscribe(CONSUMED_EVENTS.crmContactUpdated, handleCrmContactUpdated);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("cdp-service worker: consumers + outbox relay running");

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
