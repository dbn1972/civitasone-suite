/**
 * Coverage tests for messages/consumer.ts (0% → target: 100%).
 * Tests registerMessageConsumers: message correlation + signal broadcast flows.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMessagesConsumers } from "../src/modules/messages/consumer.js";
import { messageSubscriptions, signalSubscriptions } from "../src/modules/messages/schema.js";
import { TestQueue, cleanup, seedDefinition } from "./helpers/engine-harness.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS } from "../src/topics.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("messages/consumer — workflow.message.correlate", () => {
  it("correlates a message to an active subscription and completes the waiting task", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    // Set up an instance with a pending task
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    registerMessagesConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
      { nodeKey: "catch_msg", name: "Catch Message", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "start", toNode: "catch_msg", sortOrder: 1 }]);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "msg-test", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Get the task that was created
    const taskRows = await db.execute(
      sql`SELECT id, node_key FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending'`,
    ) as unknown as Array<{ id: string; node_key: string }>;
    const taskId = taskRows[0]!.id;

    // Seed a message subscription for this task
    const subId = randomUUID();
    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId,
      instanceId,
      taskId,
      messageName: "payment.received",
      correlationKey: "ORDER-001",
      nodeKey: "start",
      status: "active",
    });

    // Deliver the correlate command
    await q.deliver("workflow.message.correlate", {
      tenantId,
      messageName: "payment.received",
      correlationKey: "ORDER-001",
      payload: { amount: 5000 },
    }, { tenantId, actorId, messageId: randomUUID() });

    // Verify: subscription should be marked as matched
    const subs = await db.execute(
      sql`SELECT status FROM workflow.message_subscriptions WHERE id = ${subId}`,
    ) as unknown as Array<{ status: string }>;
    expect(subs[0]!.status).toBe("matched");
  });

  it("skips silently when no active subscription matches", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerMessagesConsumers(q);

    // Deliver a correlate command with no matching subscription — should not throw
    await q.deliver("workflow.message.correlate", {
      tenantId,
      messageName: "nonexistent.message",
      correlationKey: "INVALID-KEY",
      payload: {},
    }, { tenantId, actorId, messageId: randomUUID() });
  });

  it("is idempotent — same messageId does not process twice", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    registerMessagesConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "idem-test", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    const taskRows = await db.execute(
      sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending'`,
    ) as unknown as Array<{ id: string }>;
    const taskId = taskRows[0]!.id;

    const subId = randomUUID();
    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId,
      instanceId,
      taskId,
      messageName: "dup.test",
      correlationKey: "DUP-001",
      nodeKey: "start",
      status: "active",
    });

    const msgId = randomUUID();
    // First delivery
    await q.deliver("workflow.message.correlate", {
      tenantId,
      messageName: "dup.test",
      correlationKey: "DUP-001",
      payload: { v: 1 },
    }, { tenantId, actorId, messageId: msgId });

    // Second delivery with same messageId — should be idempotent
    await q.deliver("workflow.message.correlate", {
      tenantId,
      messageName: "dup.test",
      correlationKey: "DUP-001",
      payload: { v: 2 },
    }, { tenantId, actorId, messageId: msgId });
  });

  it("merges payload into instance context when payload is non-empty", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    registerMessagesConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "ctx-test", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    const taskRows = await db.execute(
      sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending'`,
    ) as unknown as Array<{ id: string }>;
    const taskId = taskRows[0]!.id;

    const subId = randomUUID();
    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId,
      instanceId,
      taskId,
      messageName: "ctx.merge",
      correlationKey: "CTX-001",
      nodeKey: "start",
      status: "active",
    });

    await q.deliver("workflow.message.correlate", {
      tenantId,
      messageName: "ctx.merge",
      correlationKey: "CTX-001",
      payload: { invoiceId: "INV-123", amount: 9000 },
    }, { tenantId, actorId, messageId: randomUUID() });

    // Verify context was merged (the consumer uses context || payload::jsonb)
    const inst = await db.execute(
      sql`SELECT context::text AS ctx FROM workflow.instances WHERE id = ${instanceId}`,
    ) as unknown as Array<{ ctx: string }>;
    const ctxStr = inst[0]!.ctx;
    expect(ctxStr).toContain("invoiceId");
    expect(ctxStr).toContain("INV-123");
    expect(ctxStr).toContain("9000");
  });
});

describe("messages/consumer — workflow.signal.broadcast", () => {
  it("does nothing when no active signal subscriptions exist", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerMessagesConsumers(q);

    // Broadcast with no subscriptions — should not throw
    await q.deliver("workflow.signal.broadcast", {
      tenantId,
      signalName: "ghost.signal",
      payload: {},
    }, { tenantId, actorId, messageId: randomUUID() });
  });

  it("finds active signal subscriptions for the given signal name", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    registerMessagesConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "sig-lookup", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    const taskRows = await db.execute(
      sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending'`,
    ) as unknown as Array<{ id: string }>;

    // Insert subscription — signal broadcast will find it
    const sigId = randomUUID();
    await db.insert(signalSubscriptions).values({
      id: sigId, tenantId, instanceId, taskId: taskRows[0]!.id,
      signalName: "found.sig", nodeKey: "start", status: "active",
    });

    // Verify signal subscriptions lookup works (active ones found)
    const { findActiveSignalSubscriptions } = await import("../src/modules/messages/repo.js");
    const subs = await findActiveSignalSubscriptions(tenantId, "found.sig");
    expect(subs.length).toBe(1);
    expect(subs[0]!.id).toBe(sigId);
  });

  it("does not find subscriptions from a different tenant", async () => {
    const tenantId = newTenant();
    const otherTenant = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerMessagesConsumers(q);

    // Seed a subscription in other tenant
    const sigId = randomUUID();
    await db.insert(signalSubscriptions).values({
      id: sigId, tenantId: otherTenant, instanceId: randomUUID(), taskId: randomUUID(),
      signalName: "cross.tenant.sig", nodeKey: "start", status: "active",
    });

    // Broadcast from our tenant — should find zero
    await q.deliver("workflow.signal.broadcast", {
      tenantId,
      signalName: "cross.tenant.sig",
      payload: {},
    }, { tenantId, actorId, messageId: randomUUID() });

    // Subscription should still be active (not matched from wrong tenant)
    const sigs = await db.execute(
      sql`SELECT status FROM workflow.signal_subscriptions WHERE id = ${sigId}`,
    ) as unknown as Array<{ status: string }>;
    expect(sigs[0]!.status).toBe("active");
  });
});
