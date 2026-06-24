import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/** P2-4: one ageing tick — flip past-due pending items to overdue, audit each, bust caches. */
export async function runAgeingSweep(log?: Pick<Logger, "info" | "error">): Promise<number> {
  const transitioned = await repo.sweepOverdue(new Date());
  if (transitioned.length === 0) return 0;

  // Audit each transition (append-only event log) inside a single tx via the outbox.
  await db.transaction(async (tx) => {
    for (const t of transitioned) {
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
  });

  // Bust the pending/overdue list caches for each affected tenant.
  const tenants = new Set(transitioned.map((t) => t.tenantId));
  for (const tenantId of tenants) {
    await cache.invalidate(cache.makeKey(tenantId, "pending_register", "pending"));
    await cache.invalidate(cache.makeKey(tenantId, "pending_register", "overdue"));
  }

  log?.info({ count: transitioned.length, tenants: tenants.size }, "ageing sweep: pending -> overdue");
  return transitioned.length;
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
