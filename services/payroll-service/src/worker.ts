import { pino } from "pino";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb } from "./shared/scanner-db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerPayrollConsumers } from "./modules/payroll/consumer.js";
import { registerLoansConsumers }   from "./modules/loans/consumer.js";
import { registerTaxConsumers }     from "./modules/tax/consumer.js";
import { registerIntegrationConsumers } from "./modules/integration/consumer.js";
import { registerNachReturnConsumers } from "./modules/nach-return/consumer.js";
import { registerFnfConsumers } from "./modules/fnf/consumer.js";
import { registerForm16BulkConsumers } from "./modules/form16-pdf/bulk-consumer.js";
import { registerChallanConsumers } from "./modules/statutory-returns/challan-consumer.js";
import { registerDscConfigConsumers } from "./modules/dsc-config/consumer.js";
import { registerSponsorConfigConsumers } from "./modules/sponsor-config/consumer.js";
import { loadTaxConfig } from "./modules/tax/config.js";

const log = pino({ name: "payroll-worker" });

function assertScannerConfigured(): void {
  // Fail closed when FORCE RLS is on outbox and NODE_ENV=production: the
  // scanner DSN must be present and distinct from DATABASE_URL so relay/purge
  // cannot silently fall back to the NOBYPASSRLS service role.
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.PAYROLL_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "PAYROLL_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

assertScannerConfigured();

// Wrap queue.subscribe to set tenant context from message — consumers/handlers
// run db.transaction() without this and RLS policies would otherwise be inert
// (no app.tenant_id GUC set) for every async CQRS write.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

await loadTaxConfig();

registerPayrollConsumers(queue);
registerLoansConsumers(queue);
registerTaxConsumers(queue);
registerIntegrationConsumers(queue);
registerNachReturnConsumers(queue);
registerFnfConsumers(queue);
registerForm16BulkConsumers(queue);
registerChallanConsumers(queue);
registerDscConfigConsumers(queue);
registerSponsorConfigConsumers(queue);

await queue.start();
// Cross-tenant outbox scan must use BYPASSRLS scannerDb — FORCE RLS on
// _outbox.messages (migrations 0015/0026/0033) would otherwise hide all
// unpublished rows when app.tenant_id is unset.
const relay = startRelay(scannerDb as unknown as typeof db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("payroll-service worker: consumers + outbox relay running");

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent, IF NOT EXISTS guards).
async function ensurePartitions(): Promise<void> {
  try {
    await db.execute(sql`SELECT _outbox.create_future_partitions()`);
    log.info("partition maintenance: future partitions ensured");
  } catch (err) {
    log.warn({ err }, "partition maintenance: failed to create future partitions");
  }
}
// Run immediately on startup, then every 24 hours.
void ensurePartitions();
const partitionMaint = setInterval(() => void ensurePartitions(), 24 * 60 * 60_000);
partitionMaint.unref();

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
