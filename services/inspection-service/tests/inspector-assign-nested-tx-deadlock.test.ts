/**
 * inspection-service inspectorAssign nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: inspectorAssign (assignment/consumer.ts) called
 * repo.findCapacity, repo.findConflicts, and repo.countDailyAssignments --
 * all scopedRead-based, each opening its OWN db.transaction() -- from
 * INSIDE its own already-open outer db.transaction(). Real inspector
 * scheduling under concurrent assignment load is a realistic trigger. Same
 * shape as notification-service (#1028), building-service (#1035),
 * payroll-service (#1042, #1048), finance-service (#1043), hrms-service
 * (#1045, #1047), grant-service (#1049), billing-service (#1050).
 *
 * Fixed by routing onto findCapacityTx / findConflictsTx /
 * countDailyAssignmentsTx, reading through the caller's already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerAssignmentConsumers } from "../src/modules/assignment/consumer.js";
import { inspectorCapacity } from "../src/modules/assignment/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "1a000000-dead-4000-8000-00000000a55e";
const ACTOR = "1a000000-dead-4000-8000-0000000ac70a";
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

describe("inspection-service inspectorAssign -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent inspectorAssign commands (each with a real inspector-capacity row) drain without deadlocking the connection pool`,
    async () => {
      const inspectorIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const inspectorId = randomUUID();
        inspectorIds.push(inspectorId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(inspectorCapacity).values({
          id: randomUUID(), tenantId: TENANT, inspectorId,
          dailyLimit: 10, competencies: ["plumbing"],
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerAssignmentConsumers(q);
      await q.start();

      await Promise.all(inspectorIds.map((inspectorId) =>
        q.publish(COMMANDS.inspectorAssign, makeMsg(COMMANDS.inspectorAssign, {
          inspectionId: randomUUID(),
          inspectorId,
          inspectionTypeId: randomUUID(),
          entityId: randomUUID(),
          scheduledDate: "2026-09-10",
          competencies: ["plumbing"],
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
