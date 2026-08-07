import { pino } from "pino";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb, scannerSqlClient } from "./shared/scanner-db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerBudgetConsumers }        from "./modules/budget/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/budget/eoffice-consumer.js";
import { registerReappropriationEOfficeDecisionConsumers } from "./modules/budget/reappropriation-eoffice-consumer.js";
import { registerGlConsumers }            from "./modules/gl/consumer.js";
import { registerTreasuryConsumers }      from "./modules/treasury/consumer.js";
import { registerPaymentsConsumers }      from "./modules/payments/consumer.js";
import { registerPaymentEOfficeDecisionConsumers } from "./modules/payments/eoffice-consumer.js";
import { registerIntegrationConsumers }   from "./modules/integrations/consumer.js";
import { registerRevenueBillingConsumers } from "./modules/revenue-billing/consumer.js";
import { registerTenantOnboardConsumers } from "./modules/tenant-onboard/consumer.js";
import { registerBankReconConsumers }     from "./modules/bank-recon/consumer.js";
import { registerCashbookConsumers }      from "./modules/cashbook/consumer.js";
import { registerDashboardConsumers }     from "./modules/dashboard/consumer.js";
import { registerFinancialStatementsConsumers } from "./modules/financial-statements/consumer.js";
import { registerFixedAssetConsumers }    from "./modules/fixed-asset/consumer.js";
import { registerGstConsumers }           from "./modules/gst/consumer.js";
import { registerHoaConsumers }           from "./modules/hoa/consumer.js";
import { registerInstrumentsConsumers }   from "./modules/instruments/consumer.js";
import { registerMastersConsumers }       from "./modules/masters/consumer.js";
import { registerOrgStructureConsumers }  from "./modules/org-structure/consumer.js";
import { registerPeriodCloseConsumers }   from "./modules/period-close/consumer.js";
import { registerPfmsConsumers }          from "./modules/pfms/consumer.js";
import { registerRecurringConsumers }     from "./modules/recurring/consumer.js";
import { registerReportsConsumers }       from "./modules/reports/consumer.js";
import { registerSubledgerConsumers }     from "./modules/subledger/consumer.js";
import { registerTdsConsumers }           from "./modules/tds/consumer.js";
import { registerVoucherPrintConsumers }  from "./modules/voucher-print/consumer.js";
import { registerAnomalyConsumers }       from "./modules/anomaly/consumer.js";
import { registerResolutionIntakeConsumers } from "./modules/resolution-intake/consumer.js";
import { registerReconConsumers } from "./modules/recon/consumer.js";
import { registerRevenueGlConsumers } from "./modules/revenue-gl/consumer.js";

const log = pino({ name: "finance-worker" });

function assertScannerConfigured(): void {
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.FINANCE_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "FINANCE_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

assertScannerConfigured();



// Ensure every consumer handler runs under the message tenant GUC (RLS).
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

registerBudgetConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerReappropriationEOfficeDecisionConsumers(queue);
registerGlConsumers(queue);
registerTreasuryConsumers(queue);
registerPaymentsConsumers(queue);
registerPaymentEOfficeDecisionConsumers(queue);
registerIntegrationConsumers(queue);
registerRevenueBillingConsumers(queue);
registerTenantOnboardConsumers(queue);
registerBankReconConsumers(queue);
registerCashbookConsumers(queue);
registerDashboardConsumers(queue);
registerFinancialStatementsConsumers(queue);
registerFixedAssetConsumers(queue);
registerGstConsumers(queue);
registerHoaConsumers(queue);
registerInstrumentsConsumers(queue);
registerMastersConsumers(queue);
registerOrgStructureConsumers(queue);
registerPeriodCloseConsumers(queue);
registerPfmsConsumers(queue);
registerRecurringConsumers(queue);
registerReportsConsumers(queue);
registerSubledgerConsumers(queue);
registerTdsConsumers(queue);
registerVoucherPrintConsumers(queue);
registerAnomalyConsumers(queue);
registerResolutionIntakeConsumers(queue);
registerReconConsumers(queue);
registerRevenueGlConsumers(queue);

await queue.start();
const relay = startRelay(scannerDb as unknown as typeof db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("finance-service worker: consumers + outbox relay running");

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
  await scannerSqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
