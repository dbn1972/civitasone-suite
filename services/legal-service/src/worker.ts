import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerCaseConsumers } from "./modules/cases/consumer.js";
import { registerHearingConsumers } from "./modules/hearings/consumer.js";
import { registerNoticeConsumers } from "./modules/notices/consumer.js";
import { registerContractConsumers } from "./modules/contracts/consumer.js";
import { registerSettlementConsumers } from "./modules/settlements/consumer.js";
import { registerOpinionConsumers } from "./modules/opinions/consumer.js";
import { registerOpinionEOfficeDecisionConsumers } from "./modules/opinions/eoffice-consumer.js";
import { registerCounselBriefConsumers } from "./modules/counsel/consumer.js";
import { registerFilingConsumers } from "./modules/filings/consumer.js";
import { registerReminderConsumers } from "./modules/reminders/consumer.js";
import { registerDocumentConsumers } from "./modules/documents/consumer.js";
import { registerLimitationConsumers } from "./modules/limitations/consumer.js";
import { registerBoardIntakeConsumers } from "./modules/board-intake/consumer.js";
import { registerRtiConsumers } from "./modules/rti/consumer.js";
import { startCauseListSync } from "./modules/ecourts/sync-consumer.js";

const log = pino({ name: "legal-worker" });

registerCaseConsumers(queue);
registerHearingConsumers(queue);
registerNoticeConsumers(queue);
registerContractConsumers(queue);
registerSettlementConsumers(queue);
registerOpinionConsumers(queue);
registerOpinionEOfficeDecisionConsumers(queue);
registerCounselBriefConsumers(queue);
registerFilingConsumers(queue);
registerReminderConsumers(queue);
registerDocumentConsumers(queue);
registerLimitationConsumers(queue);
// Cross-service choreography: board decision → legal intake (for-review).
registerBoardIntakeConsumers(queue);
registerRtiConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("legal-service worker: consumers + outbox relay running");

// Start cause-list sync polling consumer (env-gated via ECOURTS_ENABLED).
const causeListSyncTimer = startCauseListSync();

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  if (causeListSyncTimer) clearInterval(causeListSyncTimer);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
