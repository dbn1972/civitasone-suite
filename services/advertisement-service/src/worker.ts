import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerApplicationConsumers } from "./modules/applications/consumer.js";
import { registerApprovalConsumers } from "./modules/approvals/consumer.js";
import { registerPermitConsumers } from "./modules/permits/consumer.js";
import { registerEnforcementConsumers } from "./modules/enforcement/consumer.js";

const log = pino({ name: "advertisement-worker" });

registerApplicationConsumers(queue);
registerApprovalConsumers(queue);
registerPermitConsumers(queue);
registerEnforcementConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("advertisement-service worker: command consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
