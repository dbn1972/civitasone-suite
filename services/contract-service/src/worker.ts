import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb } from "./shared/scanner-db.js";
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
import { registerVersionConsumers } from "./modules/versions/consumer.js";
import { registerMouMilestoneConsumers } from "./modules/milestones/consumer.js";

const log = pino({ name: "contract-worker" });

function assertScannerConfigured(): void {
  // Fail closed when FORCE RLS is on outbox and NODE_ENV=production: the
  // scanner DSN must be present and distinct from DATABASE_URL so relay/purge
  // cannot silently fall back to the NOBYPASSRLS service role.
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.CONTRACT_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "CONTRACT_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

assertScannerConfigured();

registerContractConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerRateConsumers(queue);
registerClauseConsumers(queue);
registerTemplateConsumers(queue);
registerApprovalConsumers(queue);
registerObligationConsumers(queue);
registerRenewalConsumers(queue);
registerEsignConsumers(queue);
registerVersionConsumers(queue);
registerMouMilestoneConsumers(queue);

await queue.start();
// Cross-tenant outbox scan must use BYPASSRLS scannerDb — FORCE RLS on
// _outbox.messages (migration 0016) would otherwise hide all unpublished rows
// when app.tenant_id is unset.
const relay = startRelay(scannerDb as unknown as typeof db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
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
