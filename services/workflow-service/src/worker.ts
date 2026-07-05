import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerInstancesConsumers } from "./modules/instances/consumer.js";
import { registerTasksConsumers } from "./modules/tasks/consumer.js";
import { registerProvisioningConsumers } from "./modules/provisioning/consumer.js";
import { registerMessagesConsumers } from "./modules/messages/consumer.js";
import { startSlaSweeper, startTimerSweeper, startReminderSweeper } from "./modules/tasks/sweeper.js";
import { startMessageSweeper } from "./modules/messages/sweeper.js";

const log = pino({ name: "workflow-worker" });
registerInstancesConsumers(queue);
registerTasksConsumers(queue);
registerProvisioningConsumers(queue);
registerMessagesConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
const slaSweeper = startSlaSweeper(Number(process.env.SLA_SWEEP_MS ?? 30_000));
// P1-2 — deemed-approval timer sweeper.
const timerSweeper = startTimerSweeper(Number(process.env.TIMER_SWEEP_MS ?? 15_000));
const reminderSweeper = startReminderSweeper(Number(process.env.REMINDER_SWEEP_MS ?? 30_000));
const msgTimeoutSweeper = startMessageSweeper(Number(process.env.MSG_TIMEOUT_SWEEP_MS ?? 30_000));
log.info("workflow-service worker: consumers + outbox relay + sla + timer + message sweepers running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(slaSweeper);
  clearInterval(timerSweeper);
  clearInterval(reminderSweeper);
  clearInterval(msgTimeoutSweeper);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
