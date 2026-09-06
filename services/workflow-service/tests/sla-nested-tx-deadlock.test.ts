/**
 * workflow-service SLA createCalendar / pauseTaskSla nested-transaction
 * connection-pool deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1: the
 * createCalendar and pauseTaskSla command handlers (sla/consumer.ts) each
 * open db.transaction() and call repo.createCalendar / repo.pauseTask --
 * functions that each opened their OWN db.transaction() internally -- from
 * INSIDE the already-open outer transaction. Exercises both concurrently in
 * one run.
 *
 * Fixed by routing onto createCalendarTx / pauseTaskTx, reading and writing
 * through the already-open transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerSlaConsumers } from "../src/modules/sla/consumer.js";
import { tasks } from "../src/modules/tasks/schema.js";
import { instances } from "../src/modules/instances/schema.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "51a00000-dead-4000-8000-00000051a000";
const ACTOR = "51a00000-dead-4000-8000-0000000ac70a";
const BATCH = 7; // per command type; total concurrency (14) exceeds pool.max (10)

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service SLA calendar+pause -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    "concurrent createCalendar+pauseTaskSla commands drain without deadlocking the connection pool",
    async () => {
      const taskIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < BATCH; i++) {
            const instanceId = randomUUID();
            await tx.insert(instances).values({
              id: instanceId, tenantId: TENANT, name: "SLA Pause Test Instance " + i,
              status: "active", createdBy: ACTOR, updatedBy: ACTOR,
            });
            const id = randomUUID();
            taskIds.push(id);
            await tx.insert(tasks).values({
              id, tenantId: TENANT, instanceId, nodeKey: "n" + i,
              name: "SLA Pause Test " + i, status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const q = tenantScoped(new MemoryQueue());
      registerSlaConsumers(q);
      await q.start();

      const publishes: Promise<unknown>[] = [];
      for (let i = 0; i < BATCH; i++) {
        publishes.push(q.publish(COMMANDS.createCalendar, makeMsg(COMMANDS.createCalendar, {
          tenantId: TENANT, code: "cal_deadlock_" + randomUUID().slice(0, 8), name: "Cal " + i,
          timezone: "Asia/Kolkata", workweek: [1, 2, 3, 4, 5], holidays: [],
          workStartMinute: 540, workEndMinute: 1080,
        })));
        publishes.push(q.publish(COMMANDS.pauseTaskSla, makeMsg(COMMANDS.pauseTaskSla, {
          id: taskIds[i], tenantId: TENANT, reason: "deadlock test",
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
