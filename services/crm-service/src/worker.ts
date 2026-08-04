/**
 * crm-service worker entrypoint.
 * Runs the command consumers (the only DB writers) + the outbox relay.
 * Separate process from the API so writes scale independently (CLAUDE.md §6).
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerAllConsumers } from "./consumers.js";
import { startEscalationScheduler } from "./modules/assignment/scheduler.js";
import { startTaskEscalationScheduler } from "./modules/activities/task-escalation-scheduler.js";

const log = pino({ name: "crm-worker" });

registerAllConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// AS-004: escalate unaccepted/unattended leads on a fixed interval (overlap-guarded).
const escalation = startEscalationScheduler(Number(process.env.CRM_ESCALATION_INTERVAL_MS ?? 60000));
// AC-005: escalate overdue open tasks/next-actions to their manager on a fixed interval.
const taskEscalation = startTaskEscalationScheduler(Number(process.env.CRM_TASK_ESCALATION_INTERVAL_MS ?? 60000));
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
log.info("crm-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(escalation);
  clearInterval(taskEscalation);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
