import { pino } from "pino";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { startOutboxPurge } from "@civitasone/outbox";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb } from "./shared/scanner-db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerInstancesConsumers } from "./modules/instances/consumer.js";
import { registerTasksConsumers } from "./modules/tasks/consumer.js";
import { registerProvisioningConsumers } from "./modules/provisioning/consumer.js";
import { registerMessagesConsumers } from "./modules/messages/consumer.js";
import { registerDesignerConsumers } from "./modules/designer/consumer.js";
import { startSlaSweeper, startTimerSweeper, startReminderSweeper } from "./modules/tasks/sweeper.js";
import { startMessageSweeper } from "./modules/messages/sweeper.js";
import { registerCaseRegistryConsumers } from "./modules/case-registry/consumer.js";

const log = pino({ name: "workflow-worker" });

/**
 * RLS (#146): workflow_svc is NOBYPASSRLS, so every consumer write must run
 * inside the message's tenant context for db.transaction() to set the
 * app.tenant_id GUC. Individual modules already wrap their own subscribe call
 * via tenantScoped() (belt); this global wrap on the shared queue (suspenders)
 * guarantees ANY topic subscribed here — present or future — gets the tenant
 * context even if a module forgets to apply tenantScoped() itself. Nesting
 * runWithTenant() with the same tenantId is a harmless no-op. Mirrors
 * works-service / court-service worker.ts.
 */
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

/**
 * Fail closed when FORCE RLS is on outbox and NODE_ENV=production: the scanner
 * DSN must be present and distinct from DATABASE_URL so relay/purge cannot
 * silently fall back to the NOBYPASSRLS service role. Mirrors works-service /
 * court-service worker.ts.
 */
function assertScannerConfigured(): void {
  if ((process.env.NODE_ENV ?? "") !== "production") return;
  const scanner = process.env.WORKFLOW_SCANNER_DATABASE_URL ?? "";
  const primary = process.env.DATABASE_URL ?? "";
  if (!scanner || scanner === primary) {
    throw new Error(
      "WORKFLOW_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

assertScannerConfigured();

registerInstancesConsumers(queue);
registerTasksConsumers(queue);
registerProvisioningConsumers(queue);
registerMessagesConsumers(queue);
registerDesignerConsumers(queue);
// CAP-031: cross-domain registration handlers write to FORCE-RLS workflow.cases
// under a NOBYPASSRLS role, so they MUST run inside the message tenant's GUC
// (also covered by the global wrap above; tenantScoped() kept for clarity/tests).
registerCaseRegistryConsumers(queue);
await queue.start();

// Cross-tenant outbox scan must use the BYPASSRLS scannerDb — FORCE RLS on
// _outbox.messages would otherwise hide all unpublished rows under
// workflow_svc when app.tenant_id is unset (see shared/scanner-db.ts). This
// replaces the previous custom per-tenant relay/purge loop (which enumerated
// tenants via dedicated SECURITY DEFINER lookup functions and looped
// runWithTenant() per tenant) with the shared @civitasone/outbox helpers every
// other service uses.
const relay = startRelay(scannerDb as unknown as typeof db, queue);
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

const slaSweeper = startSlaSweeper(Number(process.env.SLA_SWEEP_MS ?? 30_000));
// P1-2 — deemed-approval timer sweeper.
const timerSweeper = startTimerSweeper(Number(process.env.TIMER_SWEEP_MS ?? 15_000));
const reminderSweeper = startReminderSweeper(Number(process.env.REMINDER_SWEEP_MS ?? 30_000));
const msgTimeoutSweeper = startMessageSweeper(Number(process.env.MSG_TIMEOUT_SWEEP_MS ?? 30_000));

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent, IF NOT EXISTS guards). This
// is schema DDL (not a tenant-scoped read/write), so it still runs on the
// primary `db` pool.
async function ensurePartitions(): Promise<void> {
  try {
    await db.execute(sql`SELECT _outbox.create_future_partitions()`);
    log.info("partition maintenance: future partitions ensured");
  } catch (err) {
    log.warn({ err }, "partition maintenance: failed to create future partitions");
  }
}
// Run immediately on startup, then every 24 hours.
void ensurePartitions();
const partitionMaint = setInterval(() => void ensurePartitions(), 24 * 60 * 60_000);
partitionMaint.unref();

log.info("workflow-service worker: consumers + outbox relay + sla + timer + message sweepers running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
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
