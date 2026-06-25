import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerDashboardsConsumers } from "./modules/dashboards/consumer.js";
import { registerQueriesConsumers } from "./modules/queries/consumer.js";
import { registerMetricsConsumers } from "./modules/metrics/consumer.js";
import { registerFactsConsumers } from "./modules/facts/consumer.js";
const log = pino({ name: "analytics-worker" });
registerDashboardsConsumers(queue);
registerQueriesConsumers(queue);
registerMetricsConsumers(queue);
registerFactsConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("analytics-service worker: consumers + outbox relay running");
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
