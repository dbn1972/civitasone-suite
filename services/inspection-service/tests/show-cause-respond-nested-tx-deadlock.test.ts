/**
 * inspection-service showCauseRespond nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: showCauseRespond (enforcement/consumer.ts) -- and its siblings
 * penaltyOrderIssue/penaltyOrderPay -- called repo.findShowCauseById /
 * repo.findPenaltyOrderById, scopedRead-based (and cache-wrapped) functions
 * that each open their OWN db.transaction(), from INSIDE their own
 * already-open outer db.transaction(). Real enforcement workflow commands
 * under concurrent load is a realistic trigger. Same shape as
 * notification-service (#1028), building-service (#1035), payroll-service
 * (#1042, #1048), finance-service (#1043), hrms-service (#1045, #1047),
 * grant-service (#1049), billing-service (#1050), inspection-service
 * assignment (#1052), capa (#1055), and checklist (#1056) modules.
 *
 * Fixed by routing onto findShowCauseByIdTx / findPenaltyOrderByIdTx,
 * reading through the caller's already-open tx (and deliberately bypassing
 * the read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerEnforcementConsumers } from "../src/modules/enforcement/consumer.js";
import { showCauseNotices } from "../src/modules/enforcement/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "5c0a0000-dead-4000-8000-00000005c0a0";
const ACTOR = "5c0a0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("inspection-service showCauseRespond -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent showCauseRespond commands (each with a real issued show-cause notice) drain without deadlocking the connection pool`,
    async () => {
      const showCauseIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const showCauseId = randomUUID();
        showCauseIds.push(showCauseId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(showCauseNotices).values({
          id: showCauseId, tenantId: TENANT, findingId: randomUUID(), entityId: randomUUID(),
          issuedTo: "Owner Co.", responseDeadline: "2026-12-31", status: "issued",
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerEnforcementConsumers(q);
      await q.start();

      await Promise.all(showCauseIds.map((showCauseId) =>
        q.publish(COMMANDS.showCauseRespond, makeMsg(COMMANDS.showCauseRespond, {
          showCauseId, responseText: "We dispute this notice.",
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
