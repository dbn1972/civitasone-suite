/**
 * catalogue-service consumer / outbox relay entrypoint.
 *
 * Runs two things:
 *  - the transactional outbox relay, which publishes the events the routes enqueued
 *    inside their write transactions;
 *  - the inbound cross-service consumer for `billing.rate.change_requested`.
 *
 * This service's ROUTES deliberately do not publish commands: they write
 * transactionally and enqueue their events to the outbox, so there is no
 * command topic of our own to subscribe to here. See the note at the top of
 * modules/products/versions-routes.ts.
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

const log = pino({ name: "catalogue-worker" });

// Start outbox relay (positional: db, queue, intervalMs, service)
const relay = startRelay(db, queue, 1000, SERVICE);

// Inbound event owned by billing-service. The handler calls markProcessed() as the
// first statement in its transaction, so a redelivery is a no-op rather than a
// duplicate record.
queue.subscribe<BillingRateChangeRequestedPayload>(
  CONSUMED_EVENTS.billingRateChangeRequested,
  handleBillingRateChangeRequested,
);

void queue.start().catch((err: unknown) => {
  log.error({ err }, "queue consumer failed to start");
  process.exit(1);
});

log.info("catalogue-service worker: outbox relay + rate-change consumer running");

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
