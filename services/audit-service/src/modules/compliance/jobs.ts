import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db, scopedPlatformRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

// M3: bound each transaction. Flips + their audit events are written together per batch.
const AGEING_BATCH_SIZE = Number(process.env.AGEING_BATCH_SIZE ?? 500);

/**
 * P2-4 / M3: ageing tick — flip past-due pending items to overdue, batched.
 *
 * Bug fix (found via test coverage work): this is a system-scheduled job
 * with no per-request tenant context, but audit_pending_register's RLS
 * policy requires an exact `tenant_id = current_tenant_id()` match — a bare
 * db.transaction() here sets no GUC at all, so `current_tenant_id()` is
 * NULL and the sweep silently found (and flipped) ZERO rows in every
 * environment since it was introduced, despite being wired into worker.ts.
 *
 * Fixed with the same per-tenant-loop pattern used for admin-service's
 * break-glass TTL sweeper: step 1 finds candidate TENANT IDS ONLY via a
 * scoped platform-bypass read (minimal blast radius — ids, not rows), step
 * 2 loops per tenant id and does the actual SELECT FOR UPDATE + UPDATE
 * under that tenant's own strict-RLS GUC via runWithTenant. No bypass
 * policy exists for UPDATE — writes always remain tenant-scoped.
 */
export async function runAgeingSweep(log?: Pick<Logger, "info" | "error">): Promise<number> {
  const now = new Date();
  const tenants = await scopedPlatformRead((tx) => repo.findOverdueTenantIds(tx, now));
  let total = 0;
  const affected = new Set<string>();

  for (const tenantId of tenants) {
    // Loop batches per tenant until a batch transitions nothing.
    for (;;) {
      const transitioned = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
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
      }));

      if (transitioned.length === 0) break;
      total += transitioned.length;
      affected.add(tenantId);
      if (transitioned.length < AGEING_BATCH_SIZE) break;
    }
  }

  if (total === 0) return 0;

  // Bust the pending/overdue list caches for each affected tenant.
  for (const tenantId of affected) {
    await cache.invalidate(cache.makeKey(tenantId, "pending_register", "pending"));
    await cache.invalidate(cache.makeKey(tenantId, "pending_register", "overdue"));
  }

  log?.info({ count: total, tenants: affected.size }, "ageing sweep: pending -> overdue");
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
