import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerStageConsumers } from "./modules/stages/consumer.js";
import { registerProvisioningConsumers } from "./modules/provisioning/consumer.js";
import { startProvisioningPollLoop } from "./modules/provisioning/scheduler.js";
import { registerOrchestratorConsumers } from "./modules/orchestrator/consumer.js";
import { runWithTenant } from "@civitasone/db";

const log = pino({ name: "install-worker" });

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

registerStageConsumers(queue);
registerProvisioningConsumers(queue);
registerOrchestratorConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
// Task 7.7: Provisioning_Actuator poll loop — picks up requested/failed/stale-
// provisioning Silo_Provisioning_Records and drives them through actual
// database creation + migration (never a queue consumer; see scheduler.ts).
const provisioningPoll = startProvisioningPollLoop({ logger: log });
log.info("install-service worker: consumers + outbox relay + provisioning poll loop running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(provisioningPoll);
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
