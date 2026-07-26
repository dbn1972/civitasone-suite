import { pino } from "pino";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { relayOnce } from "./shared/outbox.js";
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
import { registerCaseRegistryConsumers } from "./modules/case-registry/consumer.js";
registerCaseRegistryConsumers(queue);
await queue.start();

// RLS (#146): workflow_svc is NOBYPASSRLS and _outbox.messages is fail-closed
// (tenant_id = workflow.current_tenant_id()), so the shared startRelay/
// startOutboxPurge — whose bare cross-tenant reads/deletes carry no GUC — see
// zero rows. Enumerate the tenants with pending/purgeable rows via the
// SECURITY DEFINER helpers (migration 0029 — tenant ids only) and run each
// tenant's relay/purge inside runWithTenant + db.transaction so the GUC is set.
type RelayTx = Parameters<typeof relayOnce>[0];
async function relayAllTenantsOnce(): Promise<void> {
  const rows = (await db.execute(
    sql`SELECT workflow.outbox_pending_tenants() AS tenant_id`,
  )) as unknown as Array<{ tenant_id: string }>;
  for (const { tenant_id } of rows) {
    await runWithTenant(tenant_id, () =>
      db.transaction((tx) => relayOnce(tx as unknown as RelayTx, queue, 100, "workflow")),
    );
  }
}
const relay = setInterval(() => {
  relayAllTenantsOnce().catch((err) => log.error({ err }, "outbox relay cycle failed"));
}, 500);

// G7: scheduled outbox purge — remove published messages older than 7 days
// (per tenant, for the same RLS reason), plus GUC-free _inbox.processed rows.
const PURGE_RETENTION_DAYS = 7;
const PURGE_BATCH = 1000;
async function purgeAllTenantsOnce(): Promise<void> {
  const cutoff = sql`now() - interval '${sql.raw(String(PURGE_RETENTION_DAYS))} days'`;
  const rows = (await db.execute(
    sql`SELECT workflow.outbox_purgeable_tenants(interval '${sql.raw(String(PURGE_RETENTION_DAYS))} days') AS tenant_id`,
  )) as unknown as Array<{ tenant_id: string }>;
  for (const { tenant_id } of rows) {
    await runWithTenant(tenant_id, async () => {
      let deleted: number;
      do {
        const res = await db.transaction((tx) => tx.execute(sql`
          DELETE FROM _outbox.messages
          WHERE id IN (
            SELECT id FROM _outbox.messages
            WHERE published_at IS NOT NULL AND published_at < ${cutoff}
            LIMIT ${sql.raw(String(PURGE_BATCH))}
          )
        `));
        deleted = (res as unknown as { count?: number }).count ?? (res as unknown as unknown[]).length ?? 0;
      } while (deleted >= PURGE_BATCH);
    });
  }
  // _inbox.processed carries no tenant column and no RLS policy — bare delete is fine.
  await db.execute(sql`
    DELETE FROM _inbox.processed
    WHERE message_id IN (
      SELECT message_id FROM _inbox.processed
      WHERE processed_at < ${cutoff}
      LIMIT ${sql.raw(String(PURGE_BATCH))}
    )
  `);
}
const purge = setInterval(() => {
  purgeAllTenantsOnce().catch((err) => log.warn({ err }, "outbox purge cycle failed"));
}, 60 * 60_000);
purge.unref();
const slaSweeper = startSlaSweeper(Number(process.env.SLA_SWEEP_MS ?? 30_000));
// P1-2 — deemed-approval timer sweeper.
const timerSweeper = startTimerSweeper(Number(process.env.TIMER_SWEEP_MS ?? 15_000));
const reminderSweeper = startReminderSweeper(Number(process.env.REMINDER_SWEEP_MS ?? 30_000));
const msgTimeoutSweeper = startMessageSweeper(Number(process.env.MSG_TIMEOUT_SWEEP_MS ?? 30_000));

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent, IF NOT EXISTS guards).
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
