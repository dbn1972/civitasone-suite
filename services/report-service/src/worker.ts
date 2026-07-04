/**
 * report-service worker entrypoint — command consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerJobConsumers } from "./modules/jobs/consumer.js";
import { registerRenderConsumers } from "./modules/render/consumer.js";

const log = pino({ name: "reports-worker" });

registerJobConsumers(queue);
registerRenderConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("report-service worker: consumers + outbox relay running");

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
