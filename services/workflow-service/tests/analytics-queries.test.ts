/**
 * Coverage tests for analytics/queries.ts (1.78% → target: 100%).
 * Tests summary() and bottlenecks() read-only analytics queries.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { summary, bottlenecks } from "../src/modules/analytics/queries.js";
import { TestQueue, seedDefinition, cleanup } from "./helpers/engine-harness.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS } from "../src/topics.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("analytics/queries — summary()", () => {
  it("returns zeroed summary for empty tenant", async () => {
    const tenantId = newTenant();
    const result = await summary(tenantId);

    expect(result.totalInstances).toBe(0);
    expect(result.instancesByStatus).toEqual({});
    expect(result.avgCycleTimeSeconds).toBeNull();
    expect(result.completedCount).toBe(0);
    expect(result.slaBreachRate).toBe(0);
    expect(result.slaBreachedTasks).toBe(0);
    expect(result.slaTrackedTasks).toBe(0);
    expect(result.escalations).toBe(0);
  });

  it("reports instance status counts after creating instances", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    // Create two instances
    const id1 = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: id1, tenantId, name: "inst1", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: id1 });

    const id2 = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: id2, tenantId, name: "inst2", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: id2 });

    const result = await summary(tenantId);
    expect(result.totalInstances).toBe(2);
    expect(result.instancesByStatus["active"]).toBe(2);
  });

  it("reports escalation count from tasks", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const id = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id, tenantId, name: "inst", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: id });

    // Manually bump escalation_count on the task
    await db.execute(sql`UPDATE workflow.tasks SET escalation_count = 3 WHERE tenant_id = ${tenantId}`);

    const result = await summary(tenantId);
    expect(result.escalations).toBe(3);
  });
});

describe("analytics/queries — bottlenecks()", () => {
  it("returns empty arrays for empty tenant", async () => {
    const tenantId = newTenant();
    const result = await bottlenecks(tenantId);

    expect(result.nodes).toEqual([]);
    expect(result.pendingByRole).toEqual([]);
  });

  it("reports pending tasks by role and node", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "review", name: "Review", roleRef: "reviewer", nodeType: "task", sortOrder: 1 },
      { nodeKey: "approve", name: "Approve", roleRef: "approver", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "review", toNode: "approve", sortOrder: 1 }]);

    const id = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id, tenantId, name: "inst", status: "active", version: 1,
      initialTaskName: "Review", definitionCode: def.code,
    }, { tenantId, actorId, messageId: id });

    const result = await bottlenecks(tenantId);
    expect(result.nodes.length).toBeGreaterThan(0);
    const reviewNode = result.nodes.find((n) => n.nodeKey === "review");
    expect(reviewNode).toBeDefined();
    expect(reviewNode!.pendingTasks).toBe(1);

    expect(result.pendingByRole.length).toBeGreaterThan(0);
    const reviewerRole = result.pendingByRole.find((r) => r.roleRef === "reviewer");
    expect(reviewerRole).toBeDefined();
    expect(reviewerRole!.pendingTasks).toBe(1);
  });
});
