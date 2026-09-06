/**
 * workflow-service upsertWorkbasket nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the upsertWorkbasket command handler (workbaskets/consumer.ts)
 * opens db.transaction() and calls repo.upsert -- a function that opened its
 * OWN db.transaction() internally -- from INSIDE the already-open outer
 * transaction. A bulk workbasket-configuration import is a realistic trigger.
 *
 * Fixed by routing onto upsertTx, writing through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { registerWorkbasketConsumers } from "../src/modules/workbaskets/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "beac0000-dead-4000-8000-0000000beac0";
const ACTOR = "beac0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service upsertWorkbasket -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent upsertWorkbasket commands drain without deadlocking the connection pool",
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerWorkbasketConsumers(q);
      await q.start();

      await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) =>
        q.publish(COMMANDS.upsertWorkbasket, makeMsg(COMMANDS.upsertWorkbasket, {
          tenantId: TENANT, code: "wb_deadlock_" + randomUUID().slice(0, 8), name: "Workbasket " + i,
          filter: {}, sortOrder: "created_at",
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
