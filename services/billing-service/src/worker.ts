import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { runWithTenant } from "@civitasone/db";
import { registerPlansConsumers } from "./modules/plans/consumer.js";
import { registerSubscriptionsConsumers } from "./modules/subscriptions/consumer.js";
import { registerUsageConsumers } from "./modules/usage/consumer.js";
import { registerInvoicesConsumers } from "./modules/invoices/consumer.js";
import { registerPaymentsConsumers } from "./modules/payments/consumer.js";
import { registerEInvoiceConsumers } from "./modules/einvoice/consumer.js";
import { registerRevenueConsumers } from "./modules/revenue/consumer.js";
import { registerChurnConsumers } from "./modules/churn/consumer.js";
import { registerInvoiceOpsConsumers } from "./modules/invoice-ops/consumer.js";
import { startReminderSweep } from "./modules/invoice-ops/sweep.js";

const log = pino({ name: "billing-worker" });

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

registerPlansConsumers(queue);
registerSubscriptionsConsumers(queue);
registerUsageConsumers(queue);
registerInvoicesConsumers(queue);
registerPaymentsConsumers(queue);
registerEInvoiceConsumers(queue);
registerRevenueConsumers(queue);
registerChurnConsumers(queue);
registerInvoiceOpsConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// Optional per-tenant scheduled invoice reminders (setting default OFF; nothing is sent for tenants that did not enable it).
const reminderSweep = startReminderSweep(log);
log.info("billing-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(reminderSweep);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
