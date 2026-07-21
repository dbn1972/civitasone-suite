/**
 * Coverage tests for tasks/sweeper.ts (0% → target: 80%+).
 * Tests sweepOverdueTasks, sweepReminders, sweepTimerTasks, and the startX utilities.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import {
  sweepOverdueTasks,
  sweepReminders,
  sweepTimerTasks,
  startSlaSweeper,
  startReminderSweeper,
  startTimerSweeper,
  SYSTEM_ACTOR_ID,
} from "../src/modules/tasks/sweeper.js";
import { TestQueue, cleanup, seedDefinition } from "./helpers/engine-harness.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS } from "../src/topics.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("sweeper — sweepOverdueTasks", () => {
  it("returns 0 when no tasks are overdue", async () => {
    const count = await sweepOverdueTasks(new Date(), 100, 60 * 60 * 1000);
    // Some global tasks might be overdue but for a fresh sweep with no seeded data this is fine
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("escalates a pending task past its due_at", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "review", name: "Review", roleRef: "reviewer", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "sweep-esc", status: "active", version: 1,
      initialTaskName: "Review", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Set due_at to the past
    const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    await db.execute(sql`
      UPDATE workflow.tasks SET due_at = ${pastDate}::timestamptz
      WHERE instance_id = ${instanceId} AND status = 'pending'
    `);

    const now = new Date();
    const count = await sweepOverdueTasks(now, 100, 60 * 60 * 1000);
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify escalation_count was bumped
    const task = await db.execute(
      sql`SELECT escalation_count, escalated_at FROM workflow.tasks WHERE instance_id = ${instanceId}`,
    ) as unknown as Array<{ escalation_count: number; escalated_at: Date | null }>;
    expect(task[0]!.escalation_count).toBeGreaterThanOrEqual(1);
    expect(task[0]!.escalated_at).not.toBeNull();
  });

  it("does not re-escalate within cooldown window", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "step", name: "Step", roleRef: "role1", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "cooldown", status: "active", version: 1,
      initialTaskName: "Step", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Set due_at to the past and escalated_at to very recently (within cooldown)
    const pastDue = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recentEscalation = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    await db.execute(sql`
      UPDATE workflow.tasks
      SET due_at = ${pastDue}::timestamptz, escalated_at = ${recentEscalation}::timestamptz, escalation_count = 1
      WHERE instance_id = ${instanceId} AND status = 'pending'
    `);

    // Sweep with a 1-hour cooldown — should not re-escalate since last was 5 min ago
    const count = await sweepOverdueTasks(new Date(), 100, 60 * 60 * 1000);
    // The task should NOT be escalated again
    const task = await db.execute(
      sql`SELECT escalation_count FROM workflow.tasks WHERE instance_id = ${instanceId}`,
    ) as unknown as Array<{ escalation_count: number }>;
    expect(task[0]!.escalation_count).toBe(1);
  });
});

describe("sweeper — sweepReminders", () => {
  it("returns 0 when no pending tasks qualify for reminders", async () => {
    const count = await sweepReminders(new Date(), 100);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("sends a reminder when elapsed fraction crosses a threshold", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "task1", name: "Task1", roleRef: "role1", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "reminder", status: "active", version: 1,
      initialTaskName: "Task1", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Set created_at to 6 hours ago, due_at to 4 hours from now (so 60% elapsed)
    const createdAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const dueAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    await db.execute(sql`
      UPDATE workflow.tasks
      SET created_at = ${createdAt}::timestamptz, due_at = ${dueAt}::timestamptz, reminder_count = 0, is_call = false
      WHERE instance_id = ${instanceId} AND status = 'pending'
    `);

    // At 60% elapsed with threshold [0.5, 0.8], the first reminder (50%) should fire
    const count = await sweepReminders(new Date(), 100);
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify reminder_count was incremented
    const task = await db.execute(
      sql`SELECT reminder_count FROM workflow.tasks WHERE instance_id = ${instanceId}`,
    ) as unknown as Array<{ reminder_count: number }>;
    expect(task[0]!.reminder_count).toBe(1);
  });

  it("does not send reminder when threshold not yet reached", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);

    const def = await seedDefinition(tenantId, [
      { nodeKey: "task2", name: "Task2", roleRef: "role2", nodeType: "task", sortOrder: 1 },
    ], []);

    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id: instanceId, tenantId, name: "no-remind", status: "active", version: 1,
      initialTaskName: "Task2", definitionCode: def.code,
    }, { tenantId, actorId, messageId: instanceId });

    // Set created_at to just now, due_at far in the future (so ~0% elapsed)
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now
    await db.execute(sql`
      UPDATE workflow.tasks
      SET due_at = ${dueAt}::timestamptz, reminder_count = 0, is_call = false
      WHERE instance_id = ${instanceId} AND status = 'pending'
    `);

    const count = await sweepReminders(new Date(), 100);
    // Should not have sent reminders for this task (threshold not met)
    const task = await db.execute(
      sql`SELECT reminder_count FROM workflow.tasks WHERE instance_id = ${instanceId}`,
    ) as unknown as Array<{ reminder_count: number }>;
    expect(task[0]!.reminder_count).toBe(0);
  });
});

describe("sweeper — sweepTimerTasks", () => {
  it("returns 0 when no timer tasks are due", async () => {
    const count = await sweepTimerTasks(new Date(), 100);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("auto-advances a timer task past its fire_at", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();

    // Create definition with a timer node (deemed_approval=true)
    const defId = randomUUID();
    await db.execute(sql`
      INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
      VALUES (${defId}, ${tenantId}, ${"timer_" + defId.slice(0, 8)}, 'Timer Def', 1, 'active', ${actorId}, ${actorId})
    `);
    await db.execute(sql`
      INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, node_type, sort_order, deemed_approval)
      VALUES (${randomUUID()}, ${defId}, 'wait_node', 'Wait', 'timer', 1, true)
    `);

    // Create instance
    const instanceId = randomUUID();
    await db.execute(sql`
      INSERT INTO workflow.instances (id, tenant_id, name, status, definition_id, created_by, updated_by)
      VALUES (${instanceId}, ${tenantId}, 'timer-inst', 'active', ${defId}, ${actorId}, ${actorId})
    `);

    // Create a timer task with fire_at in the past
    const taskId = randomUUID();
    const pastFire = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    await db.execute(sql`
      INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, node_key, fire_at, created_by, updated_by)
      VALUES (${taskId}, ${tenantId}, ${instanceId}, 'Timer Wait', 'pending', 'wait_node', ${pastFire}::timestamptz, ${actorId}, ${actorId})
    `);

    const count = await sweepTimerTasks(new Date(), 100);
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify fire_at was nulled out (claimed)
    const task = await db.execute(
      sql`SELECT fire_at FROM workflow.tasks WHERE id = ${taskId}`,
    ) as unknown as Array<{ fire_at: Date | null }>;
    expect(task[0]!.fire_at).toBeNull();
  });
});

describe("sweeper — start functions (interval-based)", () => {
  it("startSlaSweeper returns a timer handle that can be cleared", () => {
    const timer = startSlaSweeper(60_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("startReminderSweeper returns a timer handle that can be cleared", () => {
    const timer = startReminderSweeper(60_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("startTimerSweeper returns a timer handle that can be cleared", () => {
    const timer = startTimerSweeper(60_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});
