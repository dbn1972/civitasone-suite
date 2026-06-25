import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerCaseConsumers } from "./modules/cases/consumer.js";
import { registerHearingConsumers } from "./modules/hearings/consumer.js";
import { registerNoticeConsumers } from "./modules/notices/consumer.js";
import { registerContractConsumers } from "./modules/contracts/consumer.js";
import { registerSettlementConsumers } from "./modules/settlements/consumer.js";
import { registerOpinionConsumers } from "./modules/opinions/consumer.js";
import { registerCounselBriefConsumers } from "./modules/counsel/consumer.js";
import { registerFilingConsumers } from "./modules/filings/consumer.js";

const log = pino({ name: "legal-worker" });

registerCaseConsumers(queue);
registerHearingConsumers(queue);
registerNoticeConsumers(queue);
registerContractConsumers(queue);
registerSettlementConsumers(queue);
registerOpinionConsumers(queue);
registerCounselBriefConsumers(queue);
registerFilingConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("legal-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
