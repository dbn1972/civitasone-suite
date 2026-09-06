/**
 * workflow-service deviations nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: raiseDeviation / reviewDeviation / revokeDeviation
 * (deviations/consumer.ts) each open db.transaction() and call
 * repo.raise / repo.review / repo.revoke -- functions that each opened their
 * OWN db.transaction() internally -- from INSIDE the already-open outer
 * transaction. Exercises all three concurrently in one run, the same shape
 * as a bulk waiver-policy sweep touching many requests at once.
 *
 * Fixed by routing onto raiseTx / reviewTx / revokeTx, reading and writing
 * through the already-open transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerDeviationConsumers } from "../src/modules/deviations/consumer.js";
import { deviationRequests } from "../src/modules/deviations/schema.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "dea00000-dead-4000-8000-000000dea000";
const ACTOR = "dea00000-dead-4000-8000-0000000ac70a";
const BATCH = 5; // per command type; total concurrency (15) exceeds pool.max (10)

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service deviations -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    "concurrent raise+review+revoke deviation commands drain without deadlocking the connection pool",
    async () => {
      const reviewIds: string[] = [];
      const revokeIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < BATCH; i++) {
            const pendingId = randomUUID();
            reviewIds.push(pendingId);
            await tx.insert(deviationRequests).values({
              id: pendingId, tenantId: TENANT, entityType: "test_entity", entityId: randomUUID(),
              deviationType: "waiver", reason: "test", status: "pending", requestedBy: ACTOR,
            });
            const approvedId = randomUUID();
            revokeIds.push(approvedId);
            await tx.insert(deviationRequests).values({
              id: approvedId, tenantId: TENANT, entityType: "test_entity", entityId: randomUUID(),
              deviationType: "waiver", reason: "test", status: "approved", requestedBy: ACTOR,
            });
          }
        });
      });

      const q = tenantScoped(new MemoryQueue());
      registerDeviationConsumers(q);
      await q.start();

      const publishes: Promise<unknown>[] = [];
      for (let i = 0; i < BATCH; i++) {
        publishes.push(q.publish(COMMANDS.raiseDeviation, makeMsg(COMMANDS.raiseDeviation, {
          tenantId: TENANT, entityType: "test_entity", entityId: randomUUID(),
          deviationType: "waiver", reason: "raise test",
        })));
        publishes.push(q.publish(COMMANDS.reviewDeviation, makeMsg(COMMANDS.reviewDeviation, {
          id: reviewIds[i], tenantId: TENANT, status: "approved",
        })));
        publishes.push(q.publish(COMMANDS.revokeDeviation, makeMsg(COMMANDS.revokeDeviation, {
          id: revokeIds[i], tenantId: TENANT,
        })));
      }
      await Promise.all(publishes);

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);

      await q.stop();
    },
    { timeout: 20000 },
  );
});
