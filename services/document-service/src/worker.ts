import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerFilesConsumers }    from "./modules/files/consumer.js";
import { registerFoldersConsumers }  from "./modules/folders/consumer.js";
import { registerWorkflowConsumers } from "./modules/workflow/consumer.js";
import { registerSharingConsumers }  from "./modules/sharing/consumer.js";
import { registerBulkScanConsumers } from "./modules/bulk-scan/consumer.js";
import { registerReviewConsumers } from "./modules/bulk-scan/review-consumer.js";
import { registerLinkResultConsumers } from "./modules/bulk-scan/link-consumer.js";
import { registerNotifyConsumers } from "./modules/bulk-scan/notify-consumer.js";
import { startRetentionScheduler, scannerRetentionDiscovery } from "./modules/bulk-scan/retention.js";
import { setPorts } from "./modules/bulk-scan/ports.js";
import { createFilingAdapter } from "./modules/files/filing-adapter.js";
import { startBulkScanScheduler, scannerDiscovery } from "./modules/bulk-scan/dispatcher.js";
import { scannerDb, scannerSqlClient } from "./shared/scanner-db.js";
import { disposeOcrAdapter } from "./modules/bulk-scan/ocr-adapter.js";

const log = pino({ name: "document-worker" });

registerFilesConsumers(queue);
registerFoldersConsumers(queue);
registerWorkflowConsumers(queue);
registerSharingConsumers(queue);
registerBulkScanConsumers(queue);
// bulk-scan reaches the document module only through this injected port (module isolation).
setPorts({ filing: createFilingAdapter() });
registerReviewConsumers(queue);
registerLinkResultConsumers(queue);
registerNotifyConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

// Bulk-scan dispatcher + lease sweeper (fair, bounded-concurrency scheduling; discovery via the read-only scanner role).
const bulkScan = startBulkScanScheduler({ discovery: scannerDiscovery(scannerDb) });
// Retention sweeper: purges filed documents past their per-doc-type retention (cross-tenant discovery via the scanner pool).
const retention = startRetentionScheduler({ discovery: scannerRetentionDiscovery(scannerDb) });

log.info("document-service worker: consumers + outbox relay + bulk-scan scheduler running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(bulkScan);
  clearInterval(retention);
  await queue.stop();
  await disposeOcrAdapter();
  await sqlClient.end();
  await scannerSqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
