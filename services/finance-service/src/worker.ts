import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerBudgetConsumers }        from "./modules/budget/consumer.js";
import { registerEOfficeDecisionConsumers } from "./modules/budget/eoffice-consumer.js";
import { registerReappropriationEOfficeDecisionConsumers } from "./modules/budget/reappropriation-eoffice-consumer.js";
import { registerGlConsumers }            from "./modules/gl/consumer.js";
import { registerTreasuryConsumers }      from "./modules/treasury/consumer.js";
import { registerPaymentsConsumers }      from "./modules/payments/consumer.js";
import { registerPaymentEOfficeDecisionConsumers } from "./modules/payments/eoffice-consumer.js";
import { registerIntegrationConsumers }   from "./modules/integrations/consumer.js";
import { registerTenantOnboardConsumers } from "./modules/tenant-onboard/consumer.js";

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

await queue.start();
const relay = startRelay(db, queue);
log.info("finance-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
