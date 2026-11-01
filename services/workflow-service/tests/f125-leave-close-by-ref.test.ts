/**
 * F125 (UAT T4): a leave application decided directly by the manager / HR
 * (PATCH /v1/hrms/leave-applications/:id/approve|reject) left its
 * `leave_approval` instance active, with the pending "Reporting Officer
 * Approval" task in the approvals inbox. hrms-service now sends
 * workflow.instance.close_by_ref for refType leave_app; this proves:
 *  1. close_by_ref accepts leave_app and closes the task with the decision
 *     (approve -> instance completed, reject -> instance rejected);
 *  2. closing never dispatches hrms.leave.approve / hrms.leave.reject back
 *     (no loop, nothing for hrms to dead-letter);
 *  3. when the decision came from the inbox task itself, the close_by_ref hrms
 *     sends in answer is a no-op (instance already ended, no second history).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor, historyActions, sqlAsTenant } from "./helpers/engine-harness.js";

const APPROVE = "hrms.leave.approve";
const REJECT = "hrms.leave.reject";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;
beforeAll(() => {
  q = new TestQueue();
  registerProvisioningConsumers(q);
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
});
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

async function provision(tenantId: string): Promise<void> {
  await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId: randomUUID() });
}

/** Exactly what hrms-service's leaveApply consumer publishes. */
async function applyLeave(tenantId: string, refId: string, applicant: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: `Leave Approval Workflow — ${refId.slice(0, 8)}`, status: "active", version: 1,
    definitionCode: "leave_approval", initialTaskName: "Reporting Officer Approval", refType: "leave_app", refId,
  }, { tenantId, actorId: applicant, messageId: id });
  return id;
}

async function outbox(tenantId: string, topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlAsTenant<{ payload: unknown }>(tenantId,
    sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${topic}`);
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
}

async function closeByRef(tenantId: string, refId: string, decision: "approve" | "reject", reason?: string) {
  await q.deliver(COMMANDS.closeInstanceByRef, { tenantId, refType: "leave_app", refId, decision, ...(reason ? { reason } : {}) },
    { tenantId, actorId: randomUUID(), messageId: randomUUID() });
}

describe("F125 — a direct leave decision closes its approval inbox task (close_by_ref)", () => {
  it("leave_app is in the close_by_ref allow-list", async () => {
    const { CLOSE_BY_REF_TYPES } = await import("../src/modules/tasks/close-by-ref.js");
    expect(CLOSE_BY_REF_TYPES).toContain("leave_app");
  });

  it("direct approve: the Reporting Officer task is completed (approve), the instance completed; nothing is dispatched back; a replay is a no-op", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const refId = randomUUID();
    const id = await applyLeave(tenant, refId, randomUUID());
    expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending", name: "Reporting Officer Approval" });

    await closeByRef(tenant, refId, "approve");
    expect((await getInstance(tenant, id))?.status).toBe("completed");
    const ts = await tasksFor(tenant, id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ status: "completed", decision: "approve" });
    expect(await historyActions(tenant, id)).toContain("closed_by_domain");
    expect(await outbox(tenant, APPROVE)).toEqual([]);
    expect(await outbox(tenant, REJECT)).toEqual([]);

    await closeByRef(tenant, refId, "approve");
    expect((await getInstance(tenant, id))?.status).toBe("completed");
    expect((await historyActions(tenant, id)).filter((a) => a === "closed_by_domain")).toHaveLength(1);
  });

  it("direct reject: the task is completed (reject), the instance rejected; no hrms.leave.reject is dispatched back", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const refId = randomUUID();
    const id = await applyLeave(tenant, refId, randomUUID());

    await closeByRef(tenant, refId, "reject", "project deadline");
    expect((await getInstance(tenant, id))?.status).toBe("rejected");
    expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "completed", decision: "reject" });
    expect(await outbox(tenant, REJECT)).toEqual([]);
    expect(await outbox(tenant, APPROVE)).toEqual([]);
  });

  for (const decision of ["approve", "reject"] as const) {
    it(`an inbox ${decision} dispatches to hrms once; hrms's answering close_by_ref is a no-op`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const refId = randomUUID();
      const id = await applyLeave(tenant, refId, randomUUID());
      const t = (await tasksFor(tenant, id))[0]!;
      await q.deliver(COMMANDS.completeTask, {
        id: t.id, tenantId: tenant, instanceId: id, name: t.name, status: "pending",
        roleRef: t.role_ref, nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id, decision,
        ...(decision === "reject" ? { reason: "short staffed" } : {}),
      }, { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
      const endStatus = decision === "reject" ? "rejected" : "completed";
      expect((await getInstance(tenant, id))?.status).toBe(endStatus);
      expect(await outbox(tenant, decision === "approve" ? APPROVE : REJECT)).toHaveLength(1);

      // hrms decides the leave and, in that same transaction, sends close_by_ref
      await closeByRef(tenant, refId, decision, decision === "reject" ? "short staffed" : undefined);
      expect((await getInstance(tenant, id))?.status).toBe(endStatus);
      expect(await historyActions(tenant, id)).not.toContain("closed_by_domain");
      expect(await outbox(tenant, APPROVE)).toHaveLength(decision === "approve" ? 1 : 0);
      expect(await outbox(tenant, REJECT)).toHaveLength(decision === "reject" ? 1 : 0);
    });
  }
});
