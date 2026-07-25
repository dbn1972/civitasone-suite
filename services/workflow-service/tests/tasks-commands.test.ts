/**
 * Coverage tests for tasks/commands.ts (8.96% → target: 80%+).
 * Tests completeTask, claimTask, assignTask, bulkComplete.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { completeTask, claimTask, assignTask, bulkComplete } from "../src/modules/tasks/commands.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";
import type { RequestContext } from "@civitasone/types";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

function makeCtx(tenantId: string, actorId = randomUUID(), roles = ["workflow_user", "super_admin"]): RequestContext {
  return { tenantId, actorId, roles, correlationId: randomUUID(), sessionId: "s1" } as RequestContext;
}

/** Create an instance and return the pending task id. */
async function setupTask(tenantId: string, actorId: string, opts: { roleRef?: string } = {}): Promise<{ taskId: string; instanceId: string }> {
  const def = await seedDefinition(tenantId, [
    { nodeKey: "step1", name: "Review", roleRef: opts.roleRef ?? null, nodeType: "task", sortOrder: 1 },
    { nodeKey: "step2", name: "Approve", nodeType: "task", sortOrder: 2 },
  ], [{ fromNode: "step1", toNode: "step2", sortOrder: 1 }]);

  const instanceId = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id: instanceId, tenantId, name: "test", status: "active", version: 1,
    initialTaskName: "Review", definitionCode: def.code,
  }, { tenantId, actorId, messageId: instanceId });

  const rows = await sqlAsTenant(tenantId, 
    sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending' LIMIT 1`,
  ) as unknown as Array<{ id: string }>;

  return { taskId: rows[0]!.id, instanceId };
}

describe("tasks/commands — completeTask", () => {
  it("accepts task completion for super_admin", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    // Use a different actor (not the submitter) who is super_admin
    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["super_admin"]);
    const result = await asTenant(tenantId, () => completeTask(ctx, taskId, "approve"));
    expect(result.status).toBe("accepted");
    expect(result.id).toBe(taskId);
  });

  it("returns 404 for non-existent task", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    await expect(asTenant(tenantId, () => completeTask(ctx, randomUUID(), "approve"))).rejects.toMatchObject({ status: 404 });
  });

  it("returns 403 ROLE_NOT_AUTHORIZED if user lacks the task roleRef", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId, { roleRef: "special_reviewer" });

    const completor = randomUUID();
    // Actor does NOT have 'special_reviewer' and is NOT super_admin
    const ctx = makeCtx(tenantId, completor, ["workflow_user"]);
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
  });

  it("returns 403 SELF_APPROVAL_DENIED if actor is the submitter", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    // Same actorId who created the instance tries to complete the task (non-super_admin)
    const ctx = makeCtx(tenantId, actorId, ["workflow_user"]);
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({ status: 403, code: "SELF_APPROVAL_DENIED" });
  });

  it("returns 409 for already-completed task", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    // Mark task as completed directly
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET status = 'completed' WHERE id = ${taskId}`);

    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["super_admin"]);
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it("returns 409 CALL_TASK for a call task", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    // Mark task as a call task
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET is_call = true WHERE id = ${taskId}`);

    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["super_admin"]);
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({ status: 409, code: "CALL_TASK" });
  });

  it("returns 403 NOT_ASSIGNEE when task is assigned to another user", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const assignedTo = randomUUID();
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET assignee_id = ${assignedTo} WHERE id = ${taskId}`);

    // A different non-admin actor tries to complete
    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["workflow_user"]);
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({ status: 403, code: "NOT_ASSIGNEE" });
  });

  it("returns 409 INSTANCE_NOT_ACTIVE when instance is suspended", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId, instanceId } = await setupTask(tenantId, actorId);

    // Suspend the instance directly
    await sqlAsTenant(tenantId, sql`UPDATE workflow.instances SET status = 'suspended' WHERE id = ${instanceId}`);

    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["super_admin"]);
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({ status: 409, code: "INSTANCE_NOT_ACTIVE" });
  });
});

describe("tasks/commands — claimTask", () => {
  it("claims an unassigned pending task", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const claimer = randomUUID();
    const ctx = makeCtx(tenantId, claimer, ["super_admin"]);
    const result = await asTenant(tenantId, () => claimTask(ctx, taskId));
    expect(result.assigneeId).toBe(claimer);
  });

  it("re-claim by same user is idempotent", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const claimer = randomUUID();
    // Assign manually to simulate already-claimed
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET assignee_id = ${claimer} WHERE id = ${taskId}`);

    const ctx = makeCtx(tenantId, claimer, ["super_admin"]);
    const result = await asTenant(tenantId, () => claimTask(ctx, taskId));
    expect(result.assigneeId).toBe(claimer);
  });

  it("returns 409 ALREADY_CLAIMED for task claimed by another", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const other = randomUUID();
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET assignee_id = ${other} WHERE id = ${taskId}`);

    const claimer = randomUUID();
    const ctx = makeCtx(tenantId, claimer, ["super_admin"]);
    await expect(asTenant(tenantId, () => claimTask(ctx, taskId))).rejects.toMatchObject({ status: 409, code: "ALREADY_CLAIMED" });
  });

  it("returns 404 for non-existent task", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    await expect(asTenant(tenantId, () => claimTask(ctx, randomUUID()))).rejects.toMatchObject({ status: 404 });
  });

  it("returns 409 CONFLICT for non-pending task", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET status = 'completed' WHERE id = ${taskId}`);

    const ctx = makeCtx(tenantId, randomUUID(), ["super_admin"]);
    await expect(asTenant(tenantId, () => claimTask(ctx, taskId))).rejects.toMatchObject({ status: 409 });
  });

  it("returns 403 ROLE_NOT_AUTHORIZED without proper role", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId, { roleRef: "special_role" });

    const ctx = makeCtx(tenantId, randomUUID(), ["workflow_user"]);
    await expect(asTenant(tenantId, () => claimTask(ctx, taskId))).rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
  });
});

describe("tasks/commands — assignTask", () => {
  it("assigns a pending task to a user", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const assignee = randomUUID();
    const ctx = makeCtx(tenantId, actorId, ["workflow_admin"]);
    const result = await asTenant(tenantId, () => assignTask(ctx, taskId, assignee));
    expect(result.assigneeId).toBe(assignee);
  });

  it("returns 404 for non-existent task", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    await expect(asTenant(tenantId, () => assignTask(ctx, randomUUID(), randomUUID()))).rejects.toMatchObject({ status: 404 });
  });

  it("returns 409 CONFLICT for non-pending task", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET status = 'completed' WHERE id = ${taskId}`);

    const ctx = makeCtx(tenantId, actorId, ["workflow_admin"]);
    await expect(asTenant(tenantId, () => assignTask(ctx, taskId, randomUUID()))).rejects.toMatchObject({ status: 409 });
  });

  it("returns 409 ALREADY_ASSIGNED if already assigned to another without reassign", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const first = randomUUID();
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET assignee_id = ${first} WHERE id = ${taskId}`);

    const ctx = makeCtx(tenantId, actorId, ["workflow_admin"]);
    const second = randomUUID();
    await expect(asTenant(tenantId, () => assignTask(ctx, taskId, second, false))).rejects.toMatchObject({ status: 409, code: "ALREADY_ASSIGNED" });
  });

  it("allows reassignment with reassign=true", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId } = await setupTask(tenantId, actorId);

    const first = randomUUID();
    await sqlAsTenant(tenantId, sql`UPDATE workflow.tasks SET assignee_id = ${first} WHERE id = ${taskId}`);

    const ctx = makeCtx(tenantId, actorId, ["workflow_admin"]);
    const second = randomUUID();
    const result = await asTenant(tenantId, () => assignTask(ctx, taskId, second, true));
    expect(result.assigneeId).toBe(second);
  });
});

describe("tasks/commands — bulkComplete", () => {
  it("completes multiple tasks, collecting results", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId: t1 } = await setupTask(tenantId, actorId);
    const { taskId: t2 } = await setupTask(tenantId, actorId);

    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["super_admin"]);
    const results = await asTenant(tenantId, () => bulkComplete(ctx, [t1, t2], "approve"));
    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("partial failure: one bad task doesn't block others", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const { taskId: t1 } = await setupTask(tenantId, actorId);
    const fakeId = randomUUID();

    const completor = randomUUID();
    const ctx = makeCtx(tenantId, completor, ["super_admin"]);
    const results = await asTenant(tenantId, () => bulkComplete(ctx, [t1, fakeId], "approve"));
    expect(results.length).toBe(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.code).toBe("NOT_FOUND");
  });
});
