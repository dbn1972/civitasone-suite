import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerPayrollConsumers } from "./modules/payroll/consumer.js";
import { registerLoansConsumers }   from "./modules/loans/consumer.js";
import { registerIntegrationConsumers } from "./modules/integration/consumer.js";

const log = pino({ name: "payroll-worker" });

registerPayrollConsumers(queue);
registerLoansConsumers(queue);
registerIntegrationConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("payroll-service worker: consumers + outbox relay running");

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
