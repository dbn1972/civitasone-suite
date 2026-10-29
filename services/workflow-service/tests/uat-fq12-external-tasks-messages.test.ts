/**
 * Real-DB regressions for UAT FQ12 workflow-service defects.
 *
 *  #158 fetch-and-lock answered 500 (r.fire_at.toISOString is not a function: raw
 *       execute rows carry timestamptz as strings) AFTER the lock had committed.
 *  #159 external-task complete with a free-form workerId answered 200 "completed",
 *       but the published completeTask carried actorId=<workerId>, which the
 *       consumer writes to uuid columns, so it failed/dead-lettered and the task
 *       stayed pending.
 *  #160 messages/deliver published {subscriptionId,...} with no tenantId, the
 *       consumer expected {tenantId, recipientInstanceId}: NOT NULL violation,
 *       dead-letter, instance never resumed.
 *  #161 signals/broadcast: consumer read tenantId from the payload (absent) ->
 *       UNDEFINED_VALUE -> dead-letter, instance never resumed.
 *
 * HTTP routes run for real; the command they publish is captured and delivered
 * to the real (DLQ-wrapped) consumers through the harness TestQueue.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { registerMessagesConsumers } from "../src/modules/messages/consumer.js";
import { messageSubscriptions, signalSubscriptions } from "../src/modules/messages/schema.js";
import { TestQueue, cleanup, seedDefinition, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => {
  vi.restoreAllMocks();
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

function bearer(tenantId: string, actorId: string, roles = ["workflow_admin"]) {
  return { authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-fq12" }, SECRET)}` };
}

/** Capture what the HTTP layer publishes instead of sending it to the memory broker. */
function capturePublishes(): Array<{ topic: string; msg: CommandEnvelope }> {
  const captured: Array<{ topic: string; msg: CommandEnvelope }> = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, input: unknown) => {
    const msg = input as CommandEnvelope;
    captured.push({ topic, msg });
    return msg.messageId ?? randomUUID();
  });
  return captured;
}

/** Re-deliver a captured envelope (as the broker would) to the TestQueue consumers. */
async function redeliver(q: TestQueue, c: { topic: string; msg: CommandEnvelope }): Promise<void> {
  await q.deliver(c.topic, c.msg.payload, {
    messageId: c.msg.messageId, tenantId: c.msg.tenantId, actorId: c.msg.actorId, correlationId: c.msg.correlationId,
  });
}

async function seedInstanceWithPendingTask(q: TestQueue, tenantId: string, actorId: string) {
  const def = await seedDefinition(tenantId, [
    { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    { nodeKey: "next", name: "Next", nodeType: "task", sortOrder: 2 },
  ], [{ fromNode: "start", toNode: "next", sortOrder: 1 }]);
  const instanceId = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id: instanceId, tenantId, name: "fq12", status: "active", version: 1,
    initialTaskName: "Start", definitionCode: def.code,
  }, { tenantId, actorId, messageId: instanceId });
  const rows = await sqlAsTenant<{ id: string }>(tenantId,
    sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending'`);
  expect(rows).toHaveLength(1);
  return { instanceId, taskId: rows[0]!.id };
}

async function taskStatus(tenantId: string, taskId: string): Promise<string | undefined> {
  const r = await sqlAsTenant<{ status: string }>(tenantId, sql`SELECT status FROM workflow.tasks WHERE id = ${taskId}`);
  return r[0]?.status;
}

async function completeTaskEnqueued(tenantId: string, taskId: string): Promise<number> {
  const r = await sqlAsTenant<{ n: number }>(tenantId, sql`
    SELECT count(*)::int AS n FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND topic = ${COMMANDS.completeTask} AND payload->>'id' = ${taskId}`);
  return r[0]!.n;
}

describe("UAT FQ12 #158/#159 external tasks with a free-form workerId", () => {
  it("fetch-and-lock returns 200 with the lock, and complete actually completes the task", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    const { taskId } = await seedInstanceWithPendingTask(q, tenantId, actorId);

    const app = await buildApp();
    try {
      const lock = await app.inject({
        method: "POST",
        url: "/v1/workflow/external-tasks/fetch-and-lock",
        headers: bearer(tenantId, actorId, ["workflow_worker"]),
        payload: { workerId: "FQ12-RUNNER-worker1", topics: ["start"], maxTasks: 5, lockDurationMs: 60000 },
      });
      // #158: was 500 after the lock committed.
      expect(lock.statusCode).toBe(200);
      const data = lock.json().data as Array<{ id: string; lockedUntil: string }>;
      expect(data.map((t) => t.id)).toEqual([taskId]);
      expect(new Date(data[0]!.lockedUntil).getTime()).toBeGreaterThan(Date.now());

      const captured = capturePublishes();
      const done = await app.inject({
        method: "POST",
        url: `/v1/workflow/external-tasks/${taskId}/complete`,
        headers: bearer(tenantId, actorId, ["workflow_worker"]),
        payload: { workerId: "FQ12-RUNNER-worker1", result: { ok: true } },
      });
      expect(done.statusCode).toBe(200);
      const cmd = captured.find((c) => c.topic === COMMANDS.completeTask);
      expect(cmd).toBeDefined();
      // The actor recorded downstream must be a uuid (tasks.completed_by is uuid).
      expect(cmd!.msg.actorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      vi.restoreAllMocks();

      // #159: the success the route reported must take effect in the consumer.
      await redeliver(q, cmd!);
      expect(await taskStatus(tenantId, taskId)).toBe("completed");
      const dl = await sqlAsTenant<{ n: number }>(tenantId,
        sql`SELECT count(*)::int AS n FROM workflow.dead_letters WHERE tenant_id = ${tenantId}`).catch(() => [{ n: 0 }]);
      expect(dl[0]!.n).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe("UAT FQ12 #160 POST /v1/workflow/messages/deliver resumes the waiting instance", () => {
  it("marks the subscription matched and enqueues completeTask for the waiting task", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    registerMessagesConsumers(q);
    const { instanceId, taskId } = await seedInstanceWithPendingTask(q, tenantId, actorId);

    const subId = randomUUID();
    await asTenant(tenantId, () => db.transaction(async (tx) => tx.insert(messageSubscriptions).values({
      id: subId, tenantId, instanceId, taskId, messageName: "fq12.payment", correlationKey: "INV-7",
      nodeKey: "start", status: "active",
    })));

    const app = await buildApp();
    try {
      const captured = capturePublishes();
      const res = await app.inject({
        method: "POST",
        url: "/v1/workflow/messages/deliver",
        headers: bearer(tenantId, actorId),
        payload: { messageName: "fq12.payment", correlationKey: "INV-7", payload: { paid: 500 } },
      });
      expect(res.statusCode).toBe(202);
      const cmd = captured.find((c) => c.topic === COMMANDS.deliverMessage);
      expect(cmd).toBeDefined();
      vi.restoreAllMocks();

      await redeliver(q, cmd!);

      const sub = await sqlAsTenant<{ status: string }>(tenantId,
        sql`SELECT status FROM workflow.message_subscriptions WHERE id = ${subId}`);
      expect(sub[0]!.status).toBe("matched");
      expect(await completeTaskEnqueued(tenantId, taskId)).toBe(1);
      const ctx = await sqlAsTenant<{ paid: string }>(tenantId,
        sql`SELECT context->>'paid' AS paid FROM workflow.instances WHERE id = ${instanceId}`);
      expect(ctx[0]!.paid).toBe("500");
      const dl = await sqlAsTenant<{ n: number }>(tenantId,
        sql`SELECT count(*)::int AS n FROM workflow.dead_letters WHERE tenant_id = ${tenantId}`).catch(() => [{ n: 0 }]);
      expect(dl[0]!.n).toBe(0);

      // Redelivery of the same command is a no-op (idempotent, no second completion).
      await redeliver(q, cmd!);
      expect(await completeTaskEnqueued(tenantId, taskId)).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("UAT FQ12 #161 POST /v1/workflow/signals/broadcast resumes each subscriber once", () => {
  it("matches every active subscriber and enqueues exactly one completeTask per subscriber", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    registerMessagesConsumers(q);
    const a = await seedInstanceWithPendingTask(q, tenantId, actorId);
    const b = await seedInstanceWithPendingTask(q, tenantId, actorId);

    const subA = randomUUID();
    const subB = randomUUID();
    await asTenant(tenantId, () => db.transaction(async (tx) => tx.insert(signalSubscriptions).values([
      { id: subA, tenantId, instanceId: a.instanceId, taskId: a.taskId, signalName: "fq12.sig", nodeKey: "start", status: "active" },
      { id: subB, tenantId, instanceId: b.instanceId, taskId: b.taskId, signalName: "fq12.sig", nodeKey: "start", status: "active" },
    ])));

    const app = await buildApp();
    try {
      const captured = capturePublishes();
      const res = await app.inject({
        method: "POST",
        url: "/v1/workflow/signals/broadcast",
        headers: bearer(tenantId, actorId),
        payload: { signalName: "fq12.sig", payload: {} },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().matched).toBe(2);
      const cmds = captured.filter((c) => c.topic === COMMANDS.broadcastSignal);
      expect(cmds).toHaveLength(2);
      vi.restoreAllMocks();

      for (const c of cmds) await redeliver(q, c);

      const subs = await sqlAsTenant<{ status: string }>(tenantId,
        sql`SELECT status FROM workflow.signal_subscriptions WHERE id IN (${subA}, ${subB})`);
      expect(subs.map((s) => s.status)).toEqual(["matched", "matched"]);
      expect(await completeTaskEnqueued(tenantId, a.taskId)).toBe(1);
      expect(await completeTaskEnqueued(tenantId, b.taskId)).toBe(1);
      const dl = await sqlAsTenant<{ n: number }>(tenantId,
        sql`SELECT count(*)::int AS n FROM workflow.dead_letters WHERE tenant_id = ${tenantId}`).catch(() => [{ n: 0 }]);
      expect(dl[0]!.n).toBe(0);
    } finally {
      await app.close();
    }
  });
});
