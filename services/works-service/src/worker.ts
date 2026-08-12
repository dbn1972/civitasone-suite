import { pino } from "pino";
import { startOutboxPurge } from "@civitasone/outbox";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb } from "./shared/scanner-db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";

import { registerMasterConsumers } from "./modules/masters/consumer.js";
import { registerProposalConsumers } from "./modules/proposal/consumer.js";
import { registerApprovalConsumers } from "./modules/approval/consumer.js";
import { registerBoqConsumers } from "./modules/boq/consumer.js";
import { registerTenderConsumers } from "./modules/tender/consumer.js";
import { registerExecutionConsumers } from "./modules/execution/consumer.js";
import { registerBillingConsumers } from "./modules/billing/consumer.js";
import { registerContractorConsumers } from "./modules/contractor/consumer.js";

const log = pino({ name: "works-worker" });

function assertScannerConfigured(): void {
  // Fail closed when FORCE RLS is on outbox and NODE_ENV=production: the
  // scanner DSN must be present and distinct from DATABASE_URL so relay/purge
  // cannot silently fall back to the NOBYPASSRLS service role.
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.WORKS_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "WORKS_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

assertScannerConfigured();

// Wrap queue.subscribe to set tenant context from message
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

registerMasterConsumers(queue);
registerProposalConsumers(queue);
registerApprovalConsumers(queue);
registerBoqConsumers(queue);
registerTenderConsumers(queue);
registerExecutionConsumers(queue);
registerBillingConsumers(queue);
registerContractorConsumers(queue);

await queue.start();
// Cross-tenant outbox scan must use BYPASSRLS scannerDb — FORCE RLS on
// _outbox.messages (migration 0013) would otherwise hide all unpublished rows
// when app.tenant_id is unset.
const relay = startRelay(scannerDb as unknown as typeof db, queue);
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("works-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(purge);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
