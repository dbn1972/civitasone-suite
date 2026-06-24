import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerInstancesConsumers } from "./modules/instances/consumer.js";
import { registerTasksConsumers } from "./modules/tasks/consumer.js";
import { startSlaSweeper } from "./modules/tasks/sweeper.js";

const log = pino({ name: "workflow-worker" });
registerInstancesConsumers(queue);
registerTasksConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
const slaSweeper = startSlaSweeper(Number(process.env.SLA_SWEEP_MS ?? 30_000));
log.info("workflow-service worker: consumers + outbox relay + sla sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(slaSweeper);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
