import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerTicketConsumers, registerCitizenRequestConsumer } from "./modules/tickets/consumer.js";
import { registerViewConsumers } from "./modules/tickets/views-consumer.js";
import { registerBreachRiskConsumers } from "./modules/ml-breach/consumer.js";
import { startSlaSweeper } from "./modules/tickets/sweeper.js";
import { startRequestBreachSweeper } from "./modules/catalogue/sweeper.js";
import { registerAutomationConsumers } from "./modules/automation/consumer.js";
import { registerSlaConsumers } from "./modules/sla/consumer.js";
import { registerCsatConsumer } from "./modules/sla/csat-consumer.js";
import { registerRoutingConsumers } from "./modules/routing/consumer.js";
import { registerCatalogueConsumers } from "./modules/catalogue/consumer.js";
import { runWithTenant } from "@civitasone/db";

const log = pino({ name: "helpdesk-worker" });

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

registerTicketConsumers(queue);
registerCitizenRequestConsumer(queue);
registerViewConsumers(queue);
registerBreachRiskConsumers(queue);
registerAutomationConsumers(queue);
registerSlaConsumers(queue);
registerCsatConsumer(queue);
registerRoutingConsumers(queue);
registerCatalogueConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// HD1 — SLA-breach sweeper: notifies + escalates + audits once per breach/at-risk stage.
const slaSweeper = startSlaSweeper(Number(process.env.HELPDESK_SLA_SWEEP_MS ?? 30_000));
// SVC-129 — service-request SLA-breach escalation sweeper.
const requestBreachSweeper = startRequestBreachSweeper(Number(process.env.HELPDESK_REQUEST_SWEEP_MS ?? 30_000));
log.info("helpdesk-service worker: consumers + outbox relay + sla sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(slaSweeper);
  clearInterval(requestBreachSweeper);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
