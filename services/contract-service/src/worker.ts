import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerContractConsumers } from "./modules/contracts/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/contracts/eoffice-consumer.js";
import { registerRateConsumers }     from "./modules/rate/consumer.js";
import { registerClauseConsumers }   from "./modules/clauses/consumer.js";
import { registerTemplateConsumers } from "./modules/templates/consumer.js";
import { registerApprovalConsumers } from "./modules/approvals/consumer.js";
import { registerObligationConsumers } from "./modules/obligations/consumer.js";
import { registerRenewalConsumers } from "./modules/renewals/consumer.js";
import { registerEsignConsumers } from "./modules/esign/consumer.js";

const log = pino({ name: "contract-worker" });

registerContractConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerRateConsumers(queue);
registerClauseConsumers(queue);
registerTemplateConsumers(queue);
registerApprovalConsumers(queue);
registerObligationConsumers(queue);
registerRenewalConsumers(queue);
registerEsignConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("contract-service worker: consumers + outbox relay running");

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
