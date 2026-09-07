/**
 * workflow-service tasks markCompleted/assignTx nested-transaction
 * connection-pool deadlock regression. Found by an independent reviewer
 * during the review of PR #1069 (quorum castVote / sla resumeTask): both
 * markCompleted and assignTx (tasks/repo.ts) take a Writer tx as their first
 * parameter, meant for use inside an already-open outer transaction, but
 * internally called the plain findById(id, tenantId) -- a scopedRead-based
 * function that opens its OWN db.transaction() -- rather than the
 * already-existing findByIdTx sibling in the same file. The classic
 * partial-fix-left-unapplied sub-pattern: findByIdTx already existed and is
 * used correctly at other call sites in this same file, just not here.
 * Real call sites: markCompleted from completeTask (tasks/consumer.ts) and
 * three other in-transaction handlers; assignTx from assignTask
 * (tasks/commands.ts).
 *
 * Fixed by routing both through findByIdTx (+ toView, since findByIdTx
 * returns the raw TaskRow, not the TaskView shape these functions need),
 * reading through the already-open transaction passed in by the caller.
 *
 * Exercised directly at the repo layer (bypassing the full completeTask/
 * assignTask command machinery, which needs a live workflow instance,
 * SoD checks, and an instance-level row lock unrelated to this bug) --
 * each concurrent command opens its own outer db.transaction() and calls
 * markCompleted/assignTx exactly as the real consumer/commands code does.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { tasks } from "../src/modules/tasks/schema.js";
import { instances } from "../src/modules/instances/schema.js";
import * as repo from "../src/modules/tasks/repo.js";

const TENANT = "7a5c0000-dead-4000-8000-00007a5c0000";
const ACTOR = "7a5c0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

describe("workflow-service tasks markCompleted/assignTx -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent markCompleted calls (each a real seeded pending task) drain without deadlocking the connection pool",
    async () => {
      const taskIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const instanceId = randomUUID();
            await tx.insert(instances).values({
              id: instanceId, tenantId: TENANT, name: "Deadlock Test Instance " + i,
              status: "active", createdBy: ACTOR, updatedBy: ACTOR,
            });
            const taskId = randomUUID();
            taskIds.push(taskId);
            await tx.insert(tasks).values({
              id: taskId, tenantId: TENANT, instanceId, nodeKey: "n" + i,
              name: "Deadlock Test Task " + i, status: "pending",
              createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      const race = Promise.race([
        Promise.all(taskIds.map((id) =>
          runWithTenant(TENANT, () => db.transaction((tx) => repo.markCompleted(tx, id, TENANT, ACTOR, "approve"))),
        )),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      await race;

      expect(timedOut, "concurrent markCompleted calls did not complete within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
    },
    { timeout: 20000 },
  );

  it(
    CONCURRENCY + " concurrent assignTx calls (each a real seeded pending task) drain without deadlocking the connection pool",
    async () => {
      const taskIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const instanceId = randomUUID();
            await tx.insert(instances).values({
              id: instanceId, tenantId: TENANT, name: "Deadlock Test Instance Assign " + i,
              status: "active", createdBy: ACTOR, updatedBy: ACTOR,
            });
            const taskId = randomUUID();
            taskIds.push(taskId);
            await tx.insert(tasks).values({
              id: taskId, tenantId: TENANT, instanceId, nodeKey: "n" + i,
              name: "Deadlock Test Task Assign " + i, status: "pending",
              createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      const race = Promise.race([
        Promise.all(taskIds.map((id) =>
          runWithTenant(TENANT, () => db.transaction((tx) => repo.assignTx(tx, id, TENANT, randomUUID(), ACTOR))),
        )),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      await race;

      expect(timedOut, "concurrent assignTx calls did not complete within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
    },
    { timeout: 20000 },
  );
});
