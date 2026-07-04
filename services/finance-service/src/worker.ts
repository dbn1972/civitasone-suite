import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
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

const log = pino({ name: "finance-worker" });

registerBudgetConsumers(queue);
registerEOfficeDecisionConsumers(queue);
registerReappropriationEOfficeDecisionConsumers(queue);
registerGlConsumers(queue);
registerTreasuryConsumers(queue);
registerPaymentsConsumers(queue);
registerPaymentEOfficeDecisionConsumers(queue);
registerIntegrationConsumers(queue);
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

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0]);
log.info("finance-service worker: consumers + outbox relay running");

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
