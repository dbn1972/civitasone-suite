/**
 * Coverage tests for compensation/executor.ts (9.77% → target: 80%+).
 * Tests runCompensation and appendCompletedNode.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { runCompensation, appendCompletedNode, SYSTEM_ACTOR_ID } from "../src/modules/compensation/executor.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { TestQueue, cleanup, seedDefinition, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";
import { COMMANDS } from "../src/topics.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("compensation/executor — runCompensation", () => {
  it("returns zeroed result when instance does not exist", async () => {
    const result = await runCompensation(randomUUID(), randomUUID(), randomUUID());
    expect(result.compensated).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.details).toEqual([]);
  });

  it("returns zeroed result when instance has no definitionId", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const instanceId = randomUUID();

    // Insert a raw instance without a definition
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
      VALUES (${instanceId}, ${tenantId}, 'no-def', 'active', ${actorId}, ${actorId})
    `);

    const result = await runCompensation(instanceId, tenantId, actorId);
    expect(result.compensated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns zeroed result when instance has empty completed_nodes", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "comp-test", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Instance exists but has empty completed_nodes
    const result = await runCompensation(instanceId, tenantId, actorId);
    expect(result.compensated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("skips nodes without compensation_handler_key", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "step1", name: "Step 1", nodeType: "task", sortOrder: 1 },
      { nodeKey: "step2", name: "Step 2", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "step1", toNode: "step2", sortOrder: 1 }]);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "comp-skip", status: "active", version: 1,
      initialTaskName: "Step 1", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Mark step1 as completed
    await asTenant(tenantId, () => db.transaction(async (tx) => appendCompletedNode(tx as unknown as typeof db, instanceId, "step1")));

    const result = await runCompensation(instanceId, tenantId, actorId);
    // No compensation handlers → all skipped
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.compensated).toBe(0);
  });

  it("skips when completed node key is not found in definition", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "step1", name: "Step 1", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "comp-missing", status: "active", version: 1,
      initialTaskName: "Step 1", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Manually add a non-existent node key to completed_nodes
    await asTenant(tenantId, () => db.transaction(async (tx) => appendCompletedNode(tx as unknown as typeof db, instanceId, "ghost_node")));

    const result = await runCompensation(instanceId, tenantId, actorId);
    expect(result.skipped).toBeGreaterThan(0);
    const ghostDetail = result.details.find((d) => d.nodeKey === "ghost_node");
    expect(ghostDetail).toBeDefined();
    expect(ghostDetail!.status).toBe("skipped");
    expect(ghostDetail!.error).toBe("node not found in definition");
  });

  it("executes compensation handler with message_topic (message_throw)", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    // Create a definition with a compensation handler that has a message_topic
    const defId = randomUUID();
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
      VALUES (${defId}, ${tenantId}, ${"comp_msg_" + defId.slice(0, 8)}, 'Comp Message', 1, 'active', ${actorId}, ${actorId})
    `);
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order, compensation_handler_key)
      VALUES (${randomUUID()}, ${defId}, 'pay_step', 'Payment Step', 'task', 1, 'undo_pay')
    `);
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order, message_topic)
      VALUES (${randomUUID()}, ${defId}, 'undo_pay', 'Undo Payment', 'message_throw', 2, 'finance.payment.reverse')
    `);

    // Create instance linked to that definition
    const instanceId = randomUUID();
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.instances (id, tenant_id, name, status, definition_id, completed_nodes, context, created_by, updated_by)
      VALUES (${instanceId}, ${tenantId}, 'comp-msg-inst', 'cancelled', ${defId}, '["pay_step"]'::jsonb, '{"orderId":"ORD-1"}'::jsonb, ${actorId}, ${actorId})
    `);

    const result = await runCompensation(instanceId, tenantId, actorId);
    expect(result.compensated).toBe(1);
    expect(result.details[0]!.status).toBe("compensated");
    expect(result.details[0]!.handlerKey).toBe("undo_pay");
  });

  it("executes compensation handler without message_topic (compensation_noted)", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const defId = randomUUID();
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
      VALUES (${defId}, ${tenantId}, ${"comp_noted_" + defId.slice(0, 8)}, 'Comp Noted', 1, 'active', ${actorId}, ${actorId})
    `);
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order, compensation_handler_key)
      VALUES (${randomUUID()}, ${defId}, 'approval', 'Approval', 'task', 1, 'note_undo')
    `);
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order)
      VALUES (${randomUUID()}, ${defId}, 'note_undo', 'Undo Note', 'task', 2)
    `);

    const instanceId = randomUUID();
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.instances (id, tenant_id, name, status, definition_id, completed_nodes, context, created_by, updated_by)
      VALUES (${instanceId}, ${tenantId}, 'comp-noted-inst', 'cancelled', ${defId}, '["approval"]'::jsonb, '{}'::jsonb, ${actorId}, ${actorId})
    `);

    const result = await runCompensation(instanceId, tenantId, actorId);
    expect(result.compensated).toBe(1);
    expect(result.details[0]!.status).toBe("compensated");
  });

  it("handles mixed: some compensated, some skipped", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const defId = randomUUID();
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
      VALUES (${defId}, ${tenantId}, ${"comp_mix_" + defId.slice(0, 8)}, 'Mix', 1, 'active', ${actorId}, ${actorId})
    `);
    // Node with handler
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order, compensation_handler_key)
      VALUES (${randomUUID()}, ${defId}, 'with_handler', 'Has Handler', 'task', 1, 'handler_node')
    `);
    // The handler node
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order)
      VALUES (${randomUUID()}, ${defId}, 'handler_node', 'Handler', 'task', 2)
    `);
    // Node without handler
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order)
      VALUES (${randomUUID()}, ${defId}, 'no_handler', 'No Handler', 'task', 3)
    `);

    const instanceId = randomUUID();
    await sqlAsTenant(tenantId, sql`
      INSERT INTO workflow.instances (id, tenant_id, name, status, definition_id, completed_nodes, context, created_by, updated_by)
      VALUES (${instanceId}, ${tenantId}, 'mixed', 'cancelled', ${defId}, '["with_handler","no_handler"]'::jsonb, '{}'::jsonb, ${actorId}, ${actorId})
    `);

    const result = await runCompensation(instanceId, tenantId, actorId);
    expect(result.compensated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.details.length).toBe(2);
  });
});

describe("compensation/executor — appendCompletedNode", () => {
  it("appends a node key to the instance completed_nodes array", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "append-test", status: "active", version: 1,
      initialTaskName: "Start", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    await asTenant(tenantId, () => db.transaction(async (tx) => appendCompletedNode(tx as unknown as typeof db, instanceId, "start")));
    await asTenant(tenantId, () => db.transaction(async (tx) => appendCompletedNode(tx as unknown as typeof db, instanceId, "review")));

    const row = await sqlAsTenant(tenantId, 
      sql`SELECT completed_nodes FROM workflow.instances WHERE id = ${instanceId}`,
    ) as unknown as Array<{ completed_nodes: string[] }>;
    expect(row[0]!.completed_nodes).toContain("start");
    expect(row[0]!.completed_nodes).toContain("review");
  });
});
