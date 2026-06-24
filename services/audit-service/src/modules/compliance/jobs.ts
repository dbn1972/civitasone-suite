import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

// M3: bound each transaction. Flips + their audit events are written together per batch.
const AGEING_BATCH_SIZE = Number(process.env.AGEING_BATCH_SIZE ?? 500);

/**
 * P2-4 / M3: ageing tick — flip past-due pending items to overdue, batched. Each batch's
 * status flips and their audit events are written in the SAME transaction (atomic), and the
 * loop is bounded by LIMIT so a large backlog never runs as one unbounded transaction.
 */
export async function runAgeingSweep(log?: Pick<Logger, "info" | "error">): Promise<number> {
  const now = new Date();
  const tenants = new Set<string>();
  let total = 0;

  // Loop batches until a batch transitions nothing.
  for (;;) {
    const transitioned = await db.transaction(async (tx) => {
      const batch = await repo.sweepOverdueBatch(tx, now, AGEING_BATCH_SIZE);
      // Audit each flip in the SAME tx as the flip itself (append-only event log via outbox).
      for (const t of batch) {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: t.tenantId, actorId: SYSTEM_ACTOR, correlationId: randomUUID(),
          payload: {
            service: "audit", action: "overdue", resourceType: "pending_register",
            resourceId: t.id, outcome: "success",
            oldValue: { status: "pending" }, newValue: { status: "overdue" },
          },
        });
      }
      return batch;
    });

    if (transitioned.length === 0) break;
    total += transitioned.length;
    for (const t of transitioned) tenants.add(t.tenantId);
    if (transitioned.length < AGEING_BATCH_SIZE) break;
  }

  if (total === 0) return 0;

  // Bust the pending/overdue list caches for each affected tenant.
  for (const tenantId of tenants) {
    await cache.invalidate(cache.makeKey(tenantId, "pending_register", "pending"));
    await cache.invalidate(cache.makeKey(tenantId, "pending_register", "overdue"));
  }

  log?.info({ count: total, tenants: tenants.size }, "ageing sweep: pending -> overdue");
  return total;
}

/** Schedule the ageing sweep on an interval. Returns the timer for clean shutdown. */
export function startAgeingJob(log?: Pick<Logger, "info" | "error">): NodeJS.Timeout {
  const intervalMs = Number(process.env.AGEING_INTERVAL_MS ?? 3_600_000); // hourly default
  const tick = (): void => {
    runAgeingSweep(log).catch((err) => log?.error({ err }, "ageing sweep failed"));
  };
  // Kick once shortly after boot, then on the interval.
  const kickoff = setTimeout(tick, Number(process.env.AGEING_KICKOFF_MS ?? 15_000));
  kickoff.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
