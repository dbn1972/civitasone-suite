import { pino } from "pino";
import { sql } from "drizzle-orm";
import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerConsumers } from "./consumers.js";
import { runSchedulerOnce } from "./modules/scheduler/tick.js";
import { applyDueEffectiveChangesOnce } from "./modules/lifecycle/effective-scheduler.js";
import { runWithTenant } from "@civitasone/db";
import { loadModuleProfile } from "./shared/module-profile.js";
import EventEmitter from "node:events";

// Bump global listener ceiling before queue subscriptions open sockets;
// 60+ consumers x timer listeners per connection otherwise triggers the warning.
EventEmitter.defaultMaxListeners = 64;

const log = pino({ name: "hrms-worker" });

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

// ── Module profile (ST-M01-04 / D-ST-23) ──────────────────────────────────
// Subscribe CORE (Workforce Core) consumers always; subscribe non-core
// consumers only when HRMS_MODULES enables them. Unset => all (no regression).
const profile = loadModuleProfile();
log.info(
  { hrmsModules: profile.raw ?? "(unset=all)", coreOnly: profile.coreOnly, enabledNonCore: [...profile.enabledNonCore].sort() },
  "hrms-worker module profile",
);
registerConsumers(queue, profile);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

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

// Scheduled-job layer: periodic tick producing tenant-aware due-lists
// (superannuation / probation). Interval is configurable; defaults to hourly.
// Idempotent per (tenant, list_kind, run_date) so frequent ticks are safe.
const SCHEDULER_INTERVAL_MS = Number(process.env.HRMS_SCHEDULER_INTERVAL_MS ?? 3_600_000);
let schedulerBusy = false;
async function schedulerTick(): Promise<void> {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const res = await runSchedulerOnce(db);
    log.info({ event: "scheduler.tick", ...res }, "scheduler tick produced due-lists");
  } catch (err) {
    log.error({ err }, "scheduler tick failed");
  }
  try {
    // Effective-dating fix (migration 0144): applies any promotion/transfer
    // still "pending_effective" whose own effectiveDate has now arrived. Own
    // try/catch so a failure here never blocks (or is blocked by) the
    // due-lists tick above — see lifecycle/effective-scheduler.ts.
    const effRes = await applyDueEffectiveChangesOnce(db);
    log.info(
      { event: "scheduler.tick", ...effRes },
      "scheduler tick applied due effective-dated promotions/transfers",
    );
  } catch (err) {
    log.error({ err }, "effective-changes scheduler tick failed");
  } finally {
    schedulerBusy = false;
  }
}
// Run once shortly after boot, then on the interval.
const schedulerKickoff = setTimeout(() => void schedulerTick(), 5_000);
const schedulerTimer = setInterval(() => void schedulerTick(), SCHEDULER_INTERVAL_MS);

log.info({ schedulerIntervalMs: SCHEDULER_INTERVAL_MS },
  "hrms-service worker: consumers + outbox relay + scheduler running");

// PERF-003: tell PM2 (wait_ready in ecosystem.config.js) this worker has
// finished subscribing every consumer and starting its scheduled maintenance
// loops — i.e. it can actually do the job, not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    clearInterval(partitionMaint);
    clearInterval(purge);
    clearInterval(relay);
    clearTimeout(schedulerKickoff);
    clearInterval(schedulerTimer);
    await queue.stop();
    await sqlClient.end();
  },
  logger: log,
});
