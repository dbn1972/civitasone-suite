/**
 * inspection-service inspectionTransition nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: inspectionTransition (execution/consumer.ts) -- and its siblings
 * inspectionSubmitReview/inspectionFinalize -- called repo.findInspectionById,
 * a scopedRead-based (and cache-wrapped) function that opens its OWN
 * db.transaction(), from INSIDE its own already-open outer db.transaction().
 * Real inspection-execution workflow commands under concurrent load is a
 * realistic trigger. Same shape as notification-service (#1028),
 * building-service (#1035), payroll-service (#1042, #1048), finance-service
 * (#1043), hrms-service (#1045, #1047), grant-service (#1049),
 * billing-service (#1050), inspection-service assignment (#1052), capa
 * (#1055), checklist (#1056), and enforcement (#1057) modules.
 *
 * Fixed by routing onto findInspectionByIdTx, reading through the callers
 * already-open tx (and deliberately bypassing the read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerExecutionConsumers } from "../src/modules/execution/consumer.js";
import { inspections } from "../src/modules/execution/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e8ec0000-dead-4000-8000-00000000e8ec";
const ACTOR = "e8ec0000-dead-4000-8000-0000000ac70a";
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

describe("inspection-service inspectionTransition -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent inspectionTransition commands (each with a real scheduled inspection) drain without deadlocking the connection pool`,
    async () => {
      const inspectionIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const inspectionId = randomUUID();
        inspectionIds.push(inspectionId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(inspections).values({
          id: inspectionId, tenantId: TENANT, entityId: randomUUID(),
          inspectionTypeId: randomUUID(), state: "scheduled",
          assignedInspectors: [randomUUID()],
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerExecutionConsumers(q);
      await q.start();

      await Promise.all(inspectionIds.map((inspectionId) =>
        q.publish(COMMANDS.inspectionTransition, makeMsg(COMMANDS.inspectionTransition, {
          inspectionId, targetState: "in_progress",
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
