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
import { runWithTenant } from "@civitasone/db";
import { registerAllConsumers } from "./consumers.js";
import { startEscalationScheduler } from "./modules/assignment/scheduler.js";
import { startTaskEscalationScheduler } from "./modules/activities/task-escalation-scheduler.js";
import { startDocumentAlertScheduler } from "./modules/documents/alert-scheduler.js";

const log = pino({ name: "crm-worker" });

// Wrap queue.subscribe to set tenant context from message — consumers run
// db.transaction() and RLS policies require app.tenant_id GUC to be set.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

registerAllConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// AS-004: escalate unaccepted/unattended leads on a fixed interval (overlap-guarded).
const escalation = startEscalationScheduler(Number(process.env.CRM_ESCALATION_INTERVAL_MS ?? 60000));
// AC-005: escalate overdue open tasks/next-actions to their manager on a fixed interval.
const taskEscalation = startTaskEscalationScheduler(Number(process.env.CRM_TASK_ESCALATION_INTERVAL_MS ?? 60000));
// DM-002: mandatory-missing + expiring document alerts on a fixed interval (overlap-guarded).
const documentAlerts = startDocumentAlertScheduler(Number(process.env.CRM_DOCUMENT_ALERT_INTERVAL_MS ?? 3600000));
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
  clearInterval(documentAlerts);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
