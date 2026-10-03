/**
 * GAP-HR-LEAVE-APPROVALS-03: the approver reason travels with the decision.
 *  - completeTaskBody accepts an optional bounded reason,
 *  - the consumer persists it atomically (transition history detail),
 *  - a REJECTED leave_app task dispatches hrms.leave.reject carrying that
 *    reason (previously a workflow rejection never reached the leave row),
 *  - an approval does not dispatch a reject.
 * GAP-HR-LEAVE-APPROVALS-04: openTaskRefIdsForActor (id-based read authorisation).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { openTaskRefIdsForActor } from "../src/modules/tasks/repo.js";
import { completeTaskBody } from "../src/modules/tasks/validators.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, getInstance, tasksFor, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;
beforeAll(() => {
  q = new TestQueue();
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
});
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

async function leaveInstance(tenant: string, refId: string, roleRef?: string): Promise<string> {
  const def = await seedDefinition(tenant, [
    { nodeKey: "start", name: "Submit", nodeType: "start", ...(roleRef ? { roleRef } : {}), sortOrder: 1 },
    { nodeKey: "review", name: "Review", ...(roleRef ? { roleRef } : {}), sortOrder: 2 },
    { nodeKey: "end", name: "Done", nodeType: "end", sortOrder: 3 },
  ], [{ fromNode: "start", toNode: "review" }, { fromNode: "review", toNode: "end" }]);
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId: tenant, name: "leave", status: "active", version: 1, initialTaskName: "Start",
    definitionCode: def.code, refType: "leave_app", refId, context: {},
  }, { tenantId: tenant, actorId: randomUUID(), messageId: id });
  return id;
}

async function complete(task: Record<string, unknown>, decision: "approve" | "reject", reason?: string): Promise<void> {
  await q.deliver(COMMANDS.completeTask, {
    id: task.id, tenantId: task.tenant_id, instanceId: task.instance_id, name: task.name, status: "pending",
    roleRef: task.role_ref, nodeKey: task.node_key, refType: task.ref_type, refId: task.ref_id,
    decision, sodOverride: true, ...(reason ? { reason } : {}),
  }, { tenantId: task.tenant_id as string, actorId: randomUUID(), messageId: randomUUID() });
}

const outbox = async (tenant: string, topic: string) => {
  const rows = (await sqlAsTenant(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = ${topic}`)) as unknown as Array<{ payload: unknown }>;
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
};

describe("completeTaskBody reason (GAP-HR-LEAVE-APPROVALS-03)", () => {
  it("accepts an optional trimmed reason and bounds it at 1000 chars", () => {
    expect(completeTaskBody.parse({ decision: "reject", reason: "  No cover  " }).reason).toBe("No cover");
    expect(completeTaskBody.parse({ decision: "approve" }).reason).toBeUndefined();
    expect(() => completeTaskBody.parse({ decision: "reject", reason: "x".repeat(1001) })).toThrow();
    expect(() => completeTaskBody.parse({ decision: "reject", reason: "   " })).toThrow();
  });
});

describe("task decision reason (GAP-HR-LEAVE-APPROVALS-03)", () => {
  it("a rejected leave task dispatches hrms.leave.reject with the approver reason, and records it in history", async () => {
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await leaveInstance(tenant, refId);
    await complete((await tasksFor(tenant, id))[0]!, "reject", "Insufficient staffing on those dates");

    const dispatched = await outbox(tenant, "hrms.leave.reject");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ id: refId, tenantId: tenant, reason: "Insufficient staffing on those dates" });
    expect((await getInstance(tenant, id))?.status).toBe("completed");

    const hist = (await sqlAsTenant(tenant, sql`SELECT detail FROM workflow.transition_history WHERE instance_id = ${id} AND action = 'reject'`)) as unknown as Array<{ detail: unknown }>;
    const detail = typeof hist[0]!.detail === "string" ? JSON.parse(hist[0]!.detail as string) : hist[0]!.detail;
    expect((detail as Record<string, unknown>).reason).toBe("Insufficient staffing on those dates");
    // never the approval path
    expect(await outbox(tenant, "hrms.leave.approve")).toHaveLength(0);
  });

  it("a reject with no reason still rejects the leave, with an explicit placeholder reason", async () => {
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await leaveInstance(tenant, refId);
    await complete((await tasksFor(tenant, id))[0]!, "reject");
    const dispatched = await outbox(tenant, "hrms.leave.reject");
    expect(dispatched).toHaveLength(1);
    expect(String(dispatched[0]!.reason)).toMatch(/no reason recorded/i);
  });

  it("an approve with a remark stores it in history but dispatches approve, never reject", async () => {
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await leaveInstance(tenant, refId);
    await complete((await tasksFor(tenant, id))[0]!, "approve");            // submit -> review
    const review = (await tasksFor(tenant, id)).find((t) => t.node_key === "review" && t.status === "pending")!;
    await complete(review, "approve", "Looks fine");                        // review -> terminal
    expect(await outbox(tenant, "hrms.leave.reject")).toHaveLength(0);
    expect((await outbox(tenant, "hrms.leave.approve"))[0]).toMatchObject({ id: refId });
    const hist = (await sqlAsTenant(tenant, sql`SELECT detail FROM workflow.transition_history WHERE instance_id = ${id} AND action = 'complete' AND detail::text LIKE '%Looks fine%'`)) as unknown as Array<{ detail: unknown }>;
    const detail = typeof hist[0]!.detail === "string" ? JSON.parse(hist[0]!.detail as string) : hist[0]!.detail;
    expect((detail as Record<string, unknown>).reason).toBe("Looks fine");
  });
});

describe("openTaskRefIdsForActor (GAP-HR-LEAVE-APPROVALS-04)", () => {
  it("returns only refs with an open task the actor can act on (role + assignee lock + tenant)", async () => {
    const tenant = newTenant();
    const otherTenant = newTenant();
    const refOpen = randomUUID();
    const refOtherRole = randomUUID();
    const refNoRole = randomUUID();
    await leaveInstance(tenant, refOpen, "dept_head");
    await leaveInstance(tenant, refOtherRole, "finance_officer");
    await leaveInstance(tenant, refNoRole);
    const actor = randomUUID();
    const all = [refOpen, refOtherRole, refNoRole];

    const got = await asTenant(tenant, () => openTaskRefIdsForActor(tenant, "leave_app", all, actor, ["dept_head"]));
    expect(got.sort()).toEqual([refOpen, refNoRole].sort()); // role-matched + unrestricted; not the other role
    expect(await asTenant(tenant, () => openTaskRefIdsForActor(tenant, "leave_app", all, actor, []))).toEqual([refNoRole]);
    expect(await asTenant(tenant, () => openTaskRefIdsForActor(tenant, "payroll_run", all, actor, ["dept_head"]))).toEqual([]);
    expect(await asTenant(otherTenant, () => openTaskRefIdsForActor(otherTenant, "leave_app", all, actor, ["dept_head"]))).toEqual([]);

    // assignee lock: once claimed by someone else, the actor no longer sees it
    const someoneElse = randomUUID();
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = ${someoneElse} WHERE tenant_id = ${tenant} AND ref_id = ${refOpen}`);
    expect(await asTenant(tenant, () => openTaskRefIdsForActor(tenant, "leave_app", all, actor, ["dept_head"]))).toEqual([refNoRole]);
    expect(await asTenant(tenant, () => openTaskRefIdsForActor(tenant, "leave_app", [refOpen], someoneElse, ["dept_head"]))).toEqual([refOpen]);
  });
});

describe("POST /v1/workflow/internal/open-task-refs (GAP-HR-LEAVE-APPROVALS-04)", () => {
  it("refuses an end-user token (service-account only) and accepts the internal service call", async () => {
    const { buildApp } = await import("../src/app.js");
    const { signToken } = await import("@civitasone/auth");
    const app = await buildApp();
    const tenant = newTenant();
    const refId = randomUUID();
    await leaveInstance(tenant, refId);
    const payload = { actorId: randomUUID(), roles: [], refType: "leave_app", refIds: [refId] };

    const userTok = signToken({ sub: randomUUID(), tid: tenant, roles: ["super_admin", "manager"], sid: "s" }, process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr");
    const denied = await app.inject({ method: "POST", url: "/v1/workflow/internal/open-task-refs", headers: { authorization: `Bearer ${userTok}` }, payload });
    expect(denied.statusCode).toBe(403);

    process.env.INTERNAL_SERVICE_SECRET = "internal_secret_for_tests_only_32c"; // gitleaks:allow
    const ok = await app.inject({
      method: "POST", url: "/v1/workflow/internal/open-task-refs",
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET, "x-tenant-id": tenant },
      payload,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ refIds: [refId] });

    const tooMany = await app.inject({
      method: "POST", url: "/v1/workflow/internal/open-task-refs",
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET, "x-tenant-id": tenant },
      payload: { ...payload, refIds: Array.from({ length: 51 }, () => randomUUID()) },
    });
    expect(tooMany.statusCode).toBe(400);
    await app.close();
  });
});
