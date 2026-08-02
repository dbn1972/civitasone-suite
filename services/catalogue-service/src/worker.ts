/**
 * catalogue-service consumer / outbox relay entrypoint.
 *
 * Registers command consumers for every catalogue mutation topic, the inbound
 * billing.rate.change_requested handler, then starts the outbox relay.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { CONSUMED_EVENTS, SERVICE } from "./topics.js";
import {
  handleBillingRateChangeRequested,
  type BillingRateChangeRequestedPayload,
} from "./modules/rates/consumer.js";
import { registerProductConsumers } from "./modules/products/consumer.js";
import { registerRateConsumers } from "./modules/rates/commands-consumer.js";
import { registerEligibilityConsumers } from "./modules/eligibility/consumer.js";
import { registerBundleConsumers } from "./modules/bundles/consumer.js";
import { registerPriceBookConsumers } from "./modules/price-books/consumer.js";

const log = pino({ name: "catalogue-worker" });

registerProductConsumers(queue);
registerRateConsumers(queue);
registerEligibilityConsumers(queue);
registerBundleConsumers(queue);
registerPriceBookConsumers(queue);

queue.subscribe<BillingRateChangeRequestedPayload>(
  CONSUMED_EVENTS.billingRateChangeRequested,
  handleBillingRateChangeRequested,
);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("catalogue-service worker: command consumers + outbox relay running");

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
