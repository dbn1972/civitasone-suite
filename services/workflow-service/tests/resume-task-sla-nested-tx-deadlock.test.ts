/**
 * workflow-service resumeTaskSla nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1, on a re-scan after fixing a scanner limitation (an
 * object-literal return-type like
 * `Promise<{ pausedMinutes: number } | null>` was hiding the real function
 * body from the earlier pass, which had only caught the sibling pauseTask in
 * this same repo file): the resumeTaskSla command handler (sla/consumer.ts)
 * opens db.transaction() and called repo.resumeTask -- a function that
 * opened its OWN db.transaction() internally -- from INSIDE the already-open
 * outer transaction.
 *
 * Fixed by routing onto resumeTaskTx, reading and writing through the
 * already-open transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerSlaConsumers } from "../src/modules/sla/consumer.js";
import { tasks } from "../src/modules/tasks/schema.js";
import { instances } from "../src/modules/instances/schema.js";
import { taskSlaPauses } from "../src/modules/sla/schema.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "50021000-dead-4000-8000-0000005002a0";
const ACTOR = "50021000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service resumeTaskSla -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent resumeTaskSla commands (each a real seeded open pause) drain without deadlocking the connection pool",
    async () => {
      const taskIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const instanceId = randomUUID();
            await tx.insert(instances).values({
              id: instanceId, tenantId: TENANT, name: "Resume Test Instance " + i,
              status: "active", createdBy: ACTOR, updatedBy: ACTOR,
            });
            const taskId = randomUUID();
            taskIds.push(taskId);
            await tx.insert(tasks).values({
              id: taskId, tenantId: TENANT, instanceId, nodeKey: "n" + i,
              name: "Resume Test " + i, status: "pending",
              dueAt: new Date(Date.now() + 3600_000), createdBy: ACTOR, updatedBy: ACTOR,
            });
            await tx.insert(taskSlaPauses).values({
              tenantId: TENANT, taskId, reason: "deadlock test", createdBy: ACTOR,
            });
          }
        });
      });

      const q = tenantScoped(new MemoryQueue());
      registerSlaConsumers(q);
      await q.start();

      await Promise.all(taskIds.map((id) =>
        q.publish(COMMANDS.resumeTaskSla, makeMsg(COMMANDS.resumeTaskSla, { id, tenantId: TENANT })),
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
