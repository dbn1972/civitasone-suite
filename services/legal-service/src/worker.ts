import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { scannerSqlClient } from "./shared/scanner-db.js";
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
import { registerAttachmentConsumers } from "./modules/attachments/consumer.js";
import { registerDocumentConsumers } from "./modules/documents/consumer.js";
import { registerLimitationConsumers } from "./modules/limitations/consumer.js";
import { registerBoardIntakeConsumers } from "./modules/board-intake/consumer.js";
import { registerRtiConsumers } from "./modules/rti/consumer.js";
import { startCauseListSync } from "./modules/ecourts/sync-consumer.js";
import { startReminderDispatcher } from "./modules/reminders/dispatcher.js";
import { runWithTenant } from "@civitasone/db";

const log = pino({ name: "legal-worker" });

// CLOS3-S5-07: fail closed in production if the BYPASSRLS scanner DSN is missing
// or falls back to the NOBYPASSRLS service DSN -- the e-Courts sync discovery
// read would otherwise silently find nothing under FORCE RLS. Mirrors
// asset-service/worker.ts assertScannerConfigured().
function assertScannerConfigured(): void {
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.LEGAL_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "LEGAL_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS legal_scanner role required for the e-Courts sync discovery scan)",
    );
  }
}
assertScannerConfigured();

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
registerAttachmentConsumers(queue);
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
// Owner decision #8: 5-minute reminder dispatcher (notification-service via outbox).
const stopReminderDispatcher = startReminderDispatcher();

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  if (causeListSyncTimer) clearInterval(causeListSyncTimer);
  stopReminderDispatcher();
  await queue.stop();
  await scannerSqlClient.end();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
