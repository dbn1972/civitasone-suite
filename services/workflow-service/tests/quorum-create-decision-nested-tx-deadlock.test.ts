/**
 * workflow-service createCommitteeDecision nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the createCommitteeDecision command handler (quorum/consumer.ts)
 * opens db.transaction() and called repo.createDecision -- a function that
 * opened its OWN db.transaction() internally -- from INSIDE the already-open
 * outer transaction. A committee convening many decisions at once (e.g. batch
 * tender approvals) is a realistic trigger.
 *
 * Fixed by routing onto createDecisionTx, writing through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { registerQuorumConsumers } from "../src/modules/quorum/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "acb00000-dead-4000-8000-000000acb000";
const ACTOR = "acb00000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service createCommitteeDecision -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent createCommitteeDecision commands drain without deadlocking the connection pool",
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerQuorumConsumers(q);
      await q.start();

      await Promise.all(Array.from({ length: CONCURRENCY }, () =>
        q.publish(COMMANDS.createCommitteeDecision, makeMsg(COMMANDS.createCommitteeDecision, {
          id: randomUUID(), tenantId: TENANT, instanceId: null, taskId: null, nodeKey: null,
          subject: "test decision", rule: "majority", threshold: null, totalMembers: 5,
        })),
      ));

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
