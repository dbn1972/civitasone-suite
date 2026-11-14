import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge, resolveAuditOutboxRetentionDays } from "@civitasone/outbox";
import { runWithTenant } from "@civitasone/db";
import { registerAuditConsumers } from "./modules/events/consumer.js";
import { registerPlanConsumers } from "./modules/plan/consumer.js";
import { registerObservationConsumers } from "./modules/observation/consumer.js";
import { registerParaConsumers } from "./modules/para/consumer.js";
import { registerComplianceConsumers } from "./modules/compliance/consumer.js";
import { registerExportConsumers } from "./modules/exports/consumer.js";
import { registerRiskConsumers } from "./modules/risk/consumer.js";
import { registerVigilanceConsumers } from "./modules/vigilance/consumer.js";
import { registerRiskRegisterConsumers } from "./modules/risk-register/consumer.js";
import { startAgeingJob } from "./modules/compliance/jobs.js";

const log = pino({ name: "audit-worker" });

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

registerAuditConsumers(queue);
registerPlanConsumers(queue);
registerObservationConsumers(queue);
registerParaConsumers(queue);
registerComplianceConsumers(queue);
registerExportConsumers(queue);
registerRiskConsumers(queue);
registerVigilanceConsumers(queue);
registerRiskRegisterConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
  // UAT B10-F83: keep the audit consumer's dedupe (message id) window longer than
  // the producers' 30-day audit outbox retention, so any replay is deduped by id.
  processedRetentionDays: resolveAuditOutboxRetentionDays() + 1,
});
// P2-4: scheduled ageing sweep (pending -> overdue past dueDate).
const ageing = startAgeingJob(log);

// G6.4: Partition maintenance — auto-create monthly partitions 3 months ahead.
// Runs daily. Safe to call repeatedly (idempotent). The functions are SECURITY DEFINER (migration 0038) so
// they work even though audit_svc does not own events.events on every environment. Each call is isolated
// so a failure in one does not skip the other, and the horizon is verified afterwards: a missing partition
// means inserts fall into the DEFAULT partition and later block creation of that month.
async function ensurePartitions(): Promise<void> {
  for (const fn of ["events.create_future_partitions", "_outbox.create_future_partitions"] as const) {
    try {
      await db.execute(sql.raw(`SELECT ${fn}()`));
    } catch (err) {
      log.error({ err, fn }, "partition maintenance: failed to create future partitions");
    }
  }
  try {
    const res = await db.execute(sql`SELECT events.missing_future_partitions() AS missing`);
    const missing = Number((res as unknown as Array<{ missing: number }>)[0]?.missing ?? 0);
    if (missing > 0) {
      log.error({ missing }, "partition maintenance: future partitions are still missing; apply scripts/ops/apply-audit-partition-fix.sh as the table owner");
    } else {
      log.info("partition maintenance: future partitions ensured");
    }
  } catch (err) {
    log.warn({ err }, "partition maintenance: could not verify the partition horizon (migration 0038 not applied?)");
  }
}
// Run immediately on startup, then every 24 hours.
void ensurePartitions();
const partitionMaint = setInterval(() => void ensurePartitions(), 24 * 60 * 60_000);
partitionMaint.unref();

log.info("audit-service worker: consumers + outbox relay + ageing job running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(partitionMaint);
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(ageing);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
