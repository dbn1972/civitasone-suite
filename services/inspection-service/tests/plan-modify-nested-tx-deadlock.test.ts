/**
 * inspection-service planModify nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: planModify (planning/consumer.ts) called repo.findPlanById --
 * scopedRead-based (and cache-wrapped), opening its OWN db.transaction() --
 * from INSIDE its own already-open outer db.transaction(). Same shape hit
 * all 4 handlers in this module (planModify, planSubmitApproval,
 * planActivate, planApprovalDecided). Same bug class as notification-service
 * (#1028), building-service (#1035), payroll-service (#1042, #1048),
 * finance-service (#1043), hrms-service (#1045, #1047), grant-service
 * (#1049), billing-service (#1050), and inspection-service's own assignment
 * (#1052), capa (#1055), checklist (#1056), and enforcement (#1057) modules.
 *
 * Fixed by routing onto findPlanByIdTx, reading through the caller's
 * already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerPlanningConsumers } from "../src/modules/planning/consumer.js";
import { inspectionPlans } from "../src/modules/planning/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "2a000000-dead-4000-8000-0000000fa1a4";
const ACTOR = "2a000000-dead-4000-8000-0000000ac70b";
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

describe("inspection-service planModify -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent planModify commands (each against a real draft plan row) drain without deadlocking the connection pool`,
    async () => {
      const planIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const planId = randomUUID();
        planIds.push(planId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(inspectionPlans).values({
          id: planId, tenantId: TENANT,
          name: `Plan ${i}`, periodStart: "2026-01-01", periodEnd: "2026-03-31",
          status: "draft", entityIds: [randomUUID()],
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerPlanningConsumers(q);
      await q.start();

      await Promise.all(planIds.map((planId) =>
        q.publish(COMMANDS.planModify, makeMsg(COMMANDS.planModify, {
          planId,
          version: 1,
          patch: { name: "Updated name" },
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
