import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerPlansConsumers } from "./modules/plans/consumer.js";
import { registerSubscriptionsConsumers } from "./modules/subscriptions/consumer.js";
import { registerUsageConsumers } from "./modules/usage/consumer.js";
import { registerInvoicesConsumers } from "./modules/invoices/consumer.js";
import { registerPaymentsConsumers } from "./modules/payments/consumer.js";
import { registerEInvoiceConsumers } from "./modules/einvoice/consumer.js";

const log = pino({ name: "billing-worker" });

registerPlansConsumers(queue);
registerSubscriptionsConsumers(queue);
registerUsageConsumers(queue);
registerInvoicesConsumers(queue);
registerPaymentsConsumers(queue);
registerEInvoiceConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("billing-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
