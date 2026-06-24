import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerAuditConsumers } from "./modules/events/consumer.js";
import { registerPlanConsumers } from "./modules/plan/consumer.js";
import { registerObservationConsumers } from "./modules/observation/consumer.js";
import { registerParaConsumers } from "./modules/para/consumer.js";
import { registerComplianceConsumers } from "./modules/compliance/consumer.js";
import { registerExportConsumers } from "./modules/exports/consumer.js";
import { registerRiskConsumers } from "./modules/risk/consumer.js";
import { startAgeingJob } from "./modules/compliance/jobs.js";

const log = pino({ name: "audit-worker" });
registerAuditConsumers(queue);
registerPlanConsumers(queue);
registerObservationConsumers(queue);
registerParaConsumers(queue);
registerComplianceConsumers(queue);
registerExportConsumers(queue);
registerRiskConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// P2-4: scheduled ageing sweep (pending -> overdue past dueDate).
const ageing = startAgeingJob(log);
log.info("audit-service worker: consumers + outbox relay + ageing job running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(ageing);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
