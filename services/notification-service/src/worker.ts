import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerTemplateConsumers } from "./modules/templates/consumer.js";
import { registerDeliveryConsumers } from "./modules/deliveries/consumer.js";
import { registerChannelConsumers } from "./modules/channels/consumer.js";
import { registerAlertConsumers } from "./modules/alerts/consumer.js";
import { registerBulkConsumers } from "./modules/bulk/consumer.js";

const log = pino({ name: "notification-worker" });
registerTemplateConsumers(queue);
registerDeliveryConsumers(queue);
registerChannelConsumers(queue);
registerAlertConsumers(queue);
registerBulkConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("notification-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
