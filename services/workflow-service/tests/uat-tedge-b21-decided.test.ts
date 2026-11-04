/**
 * UAT T-EDGE bundle 21 (TE-08): two checkers approve the same task at the same moment. Both HTTP
 * calls passed the synchronous pre-check (the task was still pending) and both got 202; the
 * consumer optimistic lock lets ONE complete it. The other used to be dropped silently -- the
 * losing checker now gets an in-app notification ("not applied: already decided") and an audit row.
 * A later, non-racing attempt is refused synchronously with 409 TASK_ALREADY_DECIDED.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { completeTask } from "../src/modules/tasks/commands.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";
import type { RequestContext } from "@civitasone/types";

const tenants: string[] = [];
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("parallel approval: the losing checker is told (TE-08)", () => {
  it("one completion wins; the late one is refused in the consumer and notified; a retry is 409", async () => {
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    const tenantId = randomUUID();
    tenants.push(tenantId);
    const maker = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "step1", name: "Review", roleRef: null, nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "b21", status: "active", version: 1, initialTaskName: "Review", definitionCode: def.code,
    }, { tenantId, actorId: maker, messageId: instanceId });
    const rows = await sqlAsTenant(tenantId, sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = ${"pending"} LIMIT 1`) as unknown as Array<{ id: string }>;
    const taskId = rows[0]!.id;

    const u2 = randomUUID();
    const u3 = randomUUID();
    // Both checkers passed the HTTP pre-check while the task was pending; deliver both commands.
    const payload = (decision: string) => ({
      id: taskId, tenantId, instanceId, name: "Review", status: "pending", roleRef: null, nodeKey: "step1",
      refType: null, refId: null, decision, assigneeId: null, isCall: false, version: 1,
      authz: { roles: ["super_admin"], assigneeAtCheck: null },
    });
    await q.deliver(COMMANDS.completeTask, payload("approve"), { tenantId, actorId: u2, messageId: randomUUID() });
    await q.deliver(COMMANDS.completeTask, payload("approve"), { tenantId, actorId: u3, messageId: randomUUID() });

    const task = await sqlAsTenant(tenantId, sql`SELECT status, completed_by FROM workflow.tasks WHERE id = ${taskId}`) as unknown as Array<{ status: string; completed_by: string }>;
    expect(task[0]!.status).toBe("completed");
    expect(task[0]!.completed_by).toBe(u2);

    const notes = await sqlAsTenant(tenantId, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${"notification.send"}`) as unknown as Array<{ payload: { eventType?: string; recipient?: string; channel?: string; variables?: Record<string, string> } }>;
    const late = notes.filter((n) => n.payload.eventType === "workflow.task.decision_not_applied");
    expect(late).toHaveLength(1);
    expect(late[0]!.payload.recipient).toBe(u3);
    expect(late[0]!.payload.channel).toBe("in_app");
    expect(late[0]!.payload.variables?.status).toMatch(/^rejected: /);

    const audits = await sqlAsTenant(tenantId, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${"audit.event.record"}`) as unknown as Array<{ payload: { action?: string; actorId?: string } }>;
    expect(audits.some((a) => a.payload.action === "task.complete.refused")).toBe(true);

    // The non-racing case: a third checker asks after it is decided -> synchronous 409 naming u2.
    const ctx = { tenantId, actorId: randomUUID(), roles: ["super_admin"], correlationId: randomUUID(), sessionId: "s" } as RequestContext;
    await expect(asTenant(tenantId, () => completeTask(ctx, taskId, "approve"))).rejects.toMatchObject({
      status: 409, code: "TASK_ALREADY_DECIDED", details: { decision: "approve", decidedBy: { id: u2 } },
    });
  });
});
