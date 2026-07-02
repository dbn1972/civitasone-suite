/**
 * Coverage tests for history/repo.ts (28.12% → target: 100%).
 * Tests record(), listForInstance(), and exportForTenant().
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import * as historyRepo from "../src/modules/history/repo.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("history/repo — listForInstance", () => {
  it("returns transition history for an instance", async () => {
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "step1", name: "Step 1", nodeType: "task", sortOrder: 1 },
      { nodeKey: "step2", name: "Step 2", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "step1", toNode: "step2", sortOrder: 1 }]);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "history test", status: "active", version: 1,
      initialTaskName: "Step 1", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    const rows = await historyRepo.listForInstance(instanceId, tenantId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.instanceId).toBe(instanceId);
    expect(rows[0]!.tenantId).toBe(tenantId);
  });

  it("returns empty array for non-existent instance", async () => {
    const tenantId = newTenant();
    const rows = await historyRepo.listForInstance(randomUUID(), tenantId);
    expect(rows).toEqual([]);
  });
});

describe("history/repo — exportForTenant", () => {
  it("returns rows within date range", async () => {
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "s1", name: "S1", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "export test", status: "active", version: 1,
      initialTaskName: "S1", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    const from = new Date("2020-01-01T00:00:00Z");
    const to = new Date("2030-12-31T23:59:59Z");
    const rows = await historyRepo.exportForTenant(tenantId, from, to, 100, null, null);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.tenantId).toBe(tenantId);
  });

  it("returns empty for out-of-range dates", async () => {
    const tenantId = newTenant();
    const from = new Date("2000-01-01T00:00:00Z");
    const to = new Date("2000-12-31T23:59:59Z");
    const rows = await historyRepo.exportForTenant(tenantId, from, to, 100, null, null);
    expect(rows).toEqual([]);
  });

  it("supports keyset pagination (afterCreatedAt + afterId)", async () => {
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "s1", name: "S1", nodeType: "task", sortOrder: 1 },
    ], []);

    // Create multiple instances to get multiple history rows
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      await q.deliver(COMMANDS.createInstance, {
        id, tenantId, name: `inst-${i}`, status: "active", version: 1,
        initialTaskName: "S1", definitionCode: def.code,
      }, { tenantId, actorId, messageId: id });
    }

    const from = new Date("2020-01-01T00:00:00Z");
    const to = new Date("2030-12-31T23:59:59Z");

    // First page: limit=1
    const page1 = await historyRepo.exportForTenant(tenantId, from, to, 1, null, null);
    expect(page1.length).toBe(1);

    // Second page using cursor from first
    const cursor = page1[0]!;
    const cursorDate = cursor.createdAt instanceof Date ? cursor.createdAt : new Date(String(cursor.createdAt));
    const page2 = await historyRepo.exportForTenant(tenantId, from, to, 1, cursorDate, cursor.id);
    expect(page2.length).toBe(1);
    expect(page2[0]!.id).not.toBe(page1[0]!.id);
  });
});
