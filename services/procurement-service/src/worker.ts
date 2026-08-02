import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb } from "./shared/scanner-db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
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
import { registerRfqConsumers } from "./modules/rfq/consumer.js";

const log = pino({ name: "procurement-worker" });

// Fail closed when FORCE RLS is on outbox and NODE_ENV=production: the
// scanner DSN must be present and distinct from DATABASE_URL so relay/purge
// cannot silently fall back to the NOBYPASSRLS service role.
function assertScannerConfigured(): void {
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.PROCUREMENT_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "PROCUREMENT_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

// Fail-fast: assert PII_ENC_KEY is configured before doing anything else, so
// the worker never runs fail-open on vendor PII (DPDP Act).
assertScannerConfigured();
assertPiiKeyConfigured();

// RLS write-path enforcement: vendor.*/tender.*/po.*/etc. tables are FORCE ROW
// LEVEL SECURITY, so under the NOBYPASSRLS procurement_svc role a consumer can
// only read/write its tenant's rows when app.tenant_id is set. Wrap every
// consumer handler so the message's tenant context is active for its duration
// — mirrors visitor-service/court-service's makeRouter runWithTenant wrap.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

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
registerRfqConsumers(queue);

await queue.start();
// Cross-tenant outbox scan must use BYPASSRLS scannerDb — FORCE RLS on
// _outbox.messages (migration 0028) would otherwise hide all unpublished rows
// when app.tenant_id is unset.
const relay = startRelay(scannerDb as unknown as typeof db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
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
