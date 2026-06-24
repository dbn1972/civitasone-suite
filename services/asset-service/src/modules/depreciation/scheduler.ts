import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";

const log = pino({ name: "asset-dep-scheduler" });

// System actor for unattended posting (no human in the loop on a scheduled tick).
// Must be a valid UUID — the queue envelope validates id fields as UUIDs.
const SYSTEM_ACTOR = "000000de-0000-4000-8000-0000000000de";
const TICK_MS = Number(process.env.DEP_SCHEDULER_INTERVAL_MS ?? 6 * 60 * 60 * 1000); // default 6h

/** Current accounting period in YYYY-MM (UTC). */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * P1-1: one scheduler tick. Finds every (tenant, period) that still has unposted
 * depreciation entries up to the current period and emits a depRun command for
 * each — tenant-aware (P0-3 scopes the run) and idempotent: the messageId is a
 * deterministic UUIDv5 of (tenant, period) and the depRun consumer dedupes posting
 * per entry via markProcessed("<messageId>:<entryId>"). Re-ticking is therefore a
 * no-op once a period is fully posted.
 */
export async function runDepScheduleTick(queue: Queue, now: Date = new Date()): Promise<number> {
  const upto = currentPeriod(now);
  const due = await repo.findDueTenantPeriods(upto);
  for (const { tenantId, period } of due) {
    const messageId = uuidV5(`scheduled:dep:${tenantId}:${period}`);
    await queue.publish(COMMANDS.depRun, {
      messageId,
      type: COMMANDS.depRun,
      tenantId,
      actorId: SYSTEM_ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id: messageId, tenantId, period }, // depBook undefined => all books
    });
  }
  if (due.length > 0) log.info({ upto, runs: due.length }, "dep scheduler emitted depRun(s)");
  return due.length;
}

/** Start the recurring scheduler. Returns the interval handle for clean shutdown. */
export function startDepScheduler(queue: Queue): NodeJS.Timeout {
  // fire once shortly after boot, then on the interval
  setTimeout(() => { void tick(queue); }, 15_000);
  const handle = setInterval(() => { void tick(queue); }, TICK_MS);
  log.info({ tickMs: TICK_MS }, "dep scheduler started");
  return handle;
}

async function tick(queue: Queue): Promise<void> {
  try {
    await runDepScheduleTick(queue);
  } catch (err) {
    log.error({ err }, "dep scheduler tick failed");
  }
}
