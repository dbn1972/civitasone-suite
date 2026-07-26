/**
 * tenant-service worker entrypoint.
 * Runs the command consumers (the only DB writers) + the outbox relay.
 * Separate process from the API so writes scale independently (CLAUDE.md §6).
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerTenantConsumers } from "./modules/tenant/consumer.js";
import { registerPlanConsumers } from "./modules/plans/consumer.js";
import { registerSubscriptionConsumers } from "./modules/subscriptions/consumer.js";
import { registerQuotaConsumers } from "./modules/quotas/consumer.js";
import { registerSettingConsumers } from "./modules/settings/consumer.js";
import { registerOrgHierarchyConsumers } from "./modules/org-hierarchy/consumer.js";
import { registerDataMigrationConsumers } from "./modules/data-migration/consumer.js";
import { registerStewardshipConsumers } from "./modules/stewardship/consumer.js";
import { registerCodeListConsumers } from "./modules/code-lists/consumer.js";
import { registerPositionConsumers } from "./modules/positions/consumer.js";

const log = pino({ name: "tenant-worker" });

registerTenantConsumers(queue);
registerPlanConsumers(queue);
registerSubscriptionConsumers(queue);
registerQuotaConsumers(queue);
registerSettingConsumers(queue);
registerOrgHierarchyConsumers(queue);
registerDataMigrationConsumers(queue);
registerStewardshipConsumers(queue);
registerCodeListConsumers(queue);
registerPositionConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("tenant-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
