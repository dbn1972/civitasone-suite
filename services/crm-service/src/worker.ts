/**
 * crm-service worker entrypoint.
 * Runs the command consumers (the only DB writers) + the outbox relay.
 * Separate process from the API so writes scale independently (CLAUDE.md §6).
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerContactConsumers } from "./modules/contacts/consumer.js";
import { registerDealConsumers } from "./modules/deals/consumer.js";
import { registerActivityConsumers } from "./modules/activities/consumer.js";
import { registerLeadScoringConsumers } from "./modules/leads/consumer.js";
import { registerCustomFieldConsumers } from "./modules/custom-fields/consumer.js";
import { registerContactRoleConsumers } from "./modules/contacts/roles-consumer.js";
import { registerTeamConsumers } from "./modules/teams/consumer.js";
import { registerQuotationConsumers } from "./modules/deals/quotation-consumer.js";
import { registerResidualF3Consumers } from "./modules/residual-f3/consumer.js";

const log = pino({ name: "crm-worker" });

registerContactConsumers(queue);
registerDealConsumers(queue);
registerActivityConsumers(queue);
registerLeadScoringConsumers(queue);
registerCustomFieldConsumers(queue);
registerContactRoleConsumers(queue);
registerTeamConsumers(queue);
registerQuotationConsumers(queue);
registerResidualF3Consumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("crm-service worker: consumers + outbox relay running");

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
process.on("SIGINT", () => void shutdown("SIGINT"));
