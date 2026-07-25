import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerIndentConsumers }   from "./modules/indent/consumer.js";
import { registerVendorConsumers }   from "./modules/vendor/consumer.js";
import { registerPoConsumers }       from "./modules/po/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/po/eoffice-consumer.js";
import { registerAwardEOfficeConsumers } from "./modules/tender/eoffice-consumer.js";
import { registerGrnConsumers }      from "./modules/grn/consumer.js";
import { registerAuctionConsumers }  from "./modules/auction/consumer.js";
import { registerPaymentsConsumers } from "./modules/payments/consumer.js";
import { registerClearanceConsumers } from "./modules/clearance/consumer.js";
import { registerTenderConsumers }   from "./modules/tender/consumer.js";
import { registerSecurityConsumers } from "./modules/security/consumer.js";
import { registerResolutionIntakeConsumers } from "./modules/resolution-intake/consumer.js";
import { registerPlanningConsumers } from "./modules/planning/consumer.js";
import { registerPoAmendmentConsumers } from "./modules/po/amendment-consumer.js";
import { registerVendorScorecardConsumers } from "./modules/vendor/scorecard-consumer.js";
import { registerTenderDocsConsumers } from "./modules/tender/docs-consumer.js";
import { registerGemReconcileConsumers } from "./modules/gem/reconcile-consumer.js";

const log = pino({ name: "procurement-worker" });

registerIndentConsumers(queue);
registerVendorConsumers(queue);
registerPoConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerAwardEOfficeConsumers(queue);
registerGrnConsumers(queue);
registerAuctionConsumers(queue);
registerPaymentsConsumers(queue);
registerClearanceConsumers(queue);
registerTenderConsumers(queue);
registerSecurityConsumers(queue);
registerResolutionIntakeConsumers(queue);
registerPlanningConsumers(queue);
registerPoAmendmentConsumers(queue);
registerVendorScorecardConsumers(queue);
registerTenderDocsConsumers(queue);
registerGemReconcileConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("procurement-service worker: consumers + outbox relay running");

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
