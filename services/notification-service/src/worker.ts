import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerTemplateConsumers } from "./modules/templates/consumer.js";
import { registerDeliveryConsumers } from "./modules/deliveries/consumer.js";
import { registerChannelConsumers } from "./modules/channels/consumer.js";
import { registerAlertConsumers } from "./modules/alerts/consumer.js";
import { registerBulkConsumers } from "./modules/bulk/consumer.js";
import { registerDomainEventConsumers } from "./modules/domain-events/consumer.js";
import { startRetrySweeper } from "./modules/deliveries/sweeper.js";

const log = pino({ name: "notification-worker" });
registerTemplateConsumers(queue);
registerDeliveryConsumers(queue);
registerChannelConsumers(queue);
registerAlertConsumers(queue);
registerBulkConsumers(queue);
registerDomainEventConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// P1-2: DB-backed retry sweeper — durable across restarts (replaces setTimeout republish).
const retrySweeper = startRetrySweeper(queue);
log.info("notification-service worker: consumers + outbox relay + retry sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(retrySweeper);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
