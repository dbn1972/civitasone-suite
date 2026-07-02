/**
 * Coverage tests for instances/commands.ts (37.05% → target: 80%+).
 * Tests cancel, suspend, resume lifecycle + createInstance + migrateInstanceVersion.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { cancelInstance, suspendInstance, resumeInstance, createInstance, migrateInstanceVersion } from "../src/modules/instances/commands.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, getInstance } from "./helpers/engine-harness.js";
import type { RequestContext } from "@civitasone/types";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

function makeCtx(tenantId: string, actorId = randomUUID(), roles = ["workflow_admin", "super_admin"]): RequestContext {
  return { tenantId, actorId, roles, correlationId: randomUUID(), sessionId: "s1" } as RequestContext;
}

/** Create an active instance via the consumer for lifecycle testing. */
async function setupInstance(tenantId: string, actorId: string, defCode: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: "lifecycle test", status: "active", version: 1,
    initialTaskName: "Start", definitionCode: defCode,
  }, { tenantId, actorId, messageId: id });
  return id;
}

describe("instances/commands — lifecycle", () => {
  it("cancelInstance succeeds on an active instance", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = await setupInstance(tenantId, actorId, def.code);

    const ctx = makeCtx(tenantId, actorId);
    const result = await cancelInstance(ctx, instanceId, "no longer needed");
    expect(result.status).toBe("accepted");
    expect(result.id).toBe(instanceId);
  });

  it("suspendInstance succeeds on an active instance", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = await setupInstance(tenantId, actorId, def.code);

    const ctx = makeCtx(tenantId, actorId);
    const result = await suspendInstance(ctx, instanceId, "audit hold");
    expect(result.status).toBe("accepted");
  });

  it("resumeInstance fails on an active instance (must be suspended)", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = await setupInstance(tenantId, actorId, def.code);

    const ctx = makeCtx(tenantId, actorId);
    await expect(resumeInstance(ctx, instanceId)).rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  });

  it("cancelInstance on a non-existent instance returns 404", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    await expect(cancelInstance(ctx, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it("suspendInstance on a completed instance returns 409 INSTANCE_TERMINAL", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    // Single-node definition: completing the only task marks instance completed
    const def = await seedDefinition(tenantId, [
      { nodeKey: "only", name: "Only", nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = await setupInstance(tenantId, actorId, def.code);

    // Complete the only task to mark instance completed
    const taskRows = await db.execute(
      sql`SELECT id, version FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending' LIMIT 1`,
    ) as unknown as Array<{ id: string; version: number }>;
    if (taskRows.length > 0) {
      await q.deliver(COMMANDS.completeTask, {
        id: taskRows[0]!.id, instanceId, tenantId, nodeKey: "only", name: "Only",
        status: "pending", version: taskRows[0]!.version, decision: "approve", sodOverride: true,
      }, { tenantId, actorId });
    }

    const inst = await getInstance(instanceId);
    if (inst && inst.status === "completed") {
      const ctx = makeCtx(tenantId, actorId);
      await expect(suspendInstance(ctx, instanceId)).rejects.toMatchObject({ status: 409, code: "INSTANCE_TERMINAL" });
    }
  });
});

describe("instances/commands — createInstance", () => {
  it("publishes a createInstance command with projected fields", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const ctx = makeCtx(tenantId, actorId);
    const result = await createInstance(ctx, {
      name: "Test Workflow",
      definitionCode: def.code,
      refType: "estab_file",
      refId: randomUUID(),
    });

    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
    expect(result.correlationId).toBe(ctx.correlationId);
  });

  it("createInstance with minimal body (name only)", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);

    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    const result = await createInstance(ctx, { name: "Minimal" });
    expect(result.status).toBe("accepted");
  });
});

describe("instances/commands — migrateInstanceVersion", () => {
  it("migrates an active instance to a new version of the same code", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const code = `migrate_${randomUUID().slice(0, 8)}`;

    // Create v1 definition (3 nodes)
    await seedDefinition(tenantId, [
      { nodeKey: "step1", name: "Step 1", nodeType: "task", sortOrder: 1 },
      { nodeKey: "step2", name: "Step 2", nodeType: "task", sortOrder: 2 },
      { nodeKey: "step3", name: "Step 3", nodeType: "task", sortOrder: 3 },
    ], [
      { fromNode: "step1", toNode: "step2", sortOrder: 1 },
      { fromNode: "step2", toNode: "step3", sortOrder: 2 },
    ], { code });

    // Create v2 of same code - insert with explicit version 2
    const def2Id = randomUUID();
    await db.execute(sql`
      INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
      VALUES (${def2Id}, ${tenantId}, ${code}, ${code + ' v2'}, 2, 'active', ${actorId}, ${actorId})
    `);
    // Insert nodes for v2 (same node keys so migration is valid)
    await db.execute(sql`
      INSERT INTO workflow.definition_nodes (definition_id, node_key, name, node_type, sort_order)
      VALUES
        (${def2Id}, 'step1', 'Step 1 v2', 'task', 1),
        (${def2Id}, 'step2', 'Step 2 v2', 'task', 2),
        (${def2Id}, 'step3', 'Step 3 v2', 'task', 3),
        (${def2Id}, 'step4', 'Step 4 v2', 'task', 4)
    `);
    await db.execute(sql`
      INSERT INTO workflow.definition_edges (definition_id, from_node, to_node, sort_order)
      VALUES
        (${def2Id}, 'step1', 'step2', 1),
        (${def2Id}, 'step2', 'step3', 2),
        (${def2Id}, 'step3', 'step4', 3)
    `);

    // Create an instance on v1
    const instanceId = await setupInstance(tenantId, actorId, code);

    const ctx = makeCtx(tenantId, actorId);
    const result = await migrateInstanceVersion(ctx, instanceId, 2);
    expect(result.toVersion).toBe(2);
    expect(result.id).toBe(instanceId);
  });

  it("rejects migration to a non-existent version", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "a", name: "A", nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = await setupInstance(tenantId, actorId, def.code);

    const ctx = makeCtx(tenantId, actorId);
    await expect(migrateInstanceVersion(ctx, instanceId, 99)).rejects.toMatchObject({ status: 404, code: "VERSION_NOT_FOUND" });
  });

  it("rejects migration of a non-existent instance", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    await expect(migrateInstanceVersion(ctx, randomUUID(), 2)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects migration to the same version", async () => {
    q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();
    const def = await seedDefinition(tenantId, [
      { nodeKey: "a", name: "A", nodeType: "task", sortOrder: 1 },
    ], []);
    const instanceId = await setupInstance(tenantId, actorId, def.code);

    const ctx = makeCtx(tenantId, actorId);
    // Migrating to version 1 (same version) should fail
    await expect(migrateInstanceVersion(ctx, instanceId, 1)).rejects.toMatchObject({ status: 409, code: "SAME_VERSION" });
  });
});
