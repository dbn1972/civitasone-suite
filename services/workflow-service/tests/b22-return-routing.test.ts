/**
 * Bundle 22 (W4 / W6): Return routing, single trail entry, decision audit events.
 *  - a Return from a single-step chain (indent / PO) goes to the MAKER as a
 *    "correct and resubmit" task, not back into the same approver's queue;
 *  - the Return is recorded once in the decision trail (not also as the follow-on assignment);
 *  - after the maker resubmits, the approver task re-opens and approving it completes the instance;
 *  - every approve / reject / return writes an audit event keyed to the item.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { listDecisionsForRef } from "../src/modules/history/repo.js";
import { completeTask } from "../src/modules/tasks/commands.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, getInstance, tasksFor, historyActions, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
let q: TestQueue;
beforeAll(() => { q = new TestQueue(); registerInstancesConsumers(q); registerTasksConsumers(q); });
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

const MAKER = randomUUID();
const CHECKER = randomUUID();

async function startIndentChain(tenant: string, refId: string): Promise<string> {
  const def = await seedDefinition(tenant, [
    { nodeKey: "proc_officer", name: "Procurement Officer Approval", roleRef: "procurement_officer", sortOrder: 1 },
  ], []);
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId: tenant, name: "Indent for Public Works Department", status: "active", version: 1,
    initialTaskName: "Start", definitionCode: def.code, refType: "procurement_indent", refId, context: {},
  }, { tenantId: tenant, actorId: MAKER, messageId: id });
  return id;
}

async function decide(task: Record<string, unknown>, actorId: string, decision: "approve" | "reject" | "return", reason?: string) {
  await q.deliver(COMMANDS.completeTask, {
    id: task.id, tenantId: task.tenant_id, instanceId: task.instance_id, name: task.name, status: "pending",
    roleRef: task.role_ref, nodeKey: task.node_key, refType: task.ref_type, refId: task.ref_id,
    decision, sodOverride: false, ...(reason ? { reason } : {}),
  }, { tenantId: task.tenant_id as string, actorId, messageId: randomUUID() });
}

async function auditFor(tenant: string, refId: string) {
  const rows = await sqlAsTenant<{ payload: unknown; actor_id: string }>(
    tenant, sql`SELECT payload, actor_id FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = 'audit.event.record'`);
  return rows
    .map((r) => ({ p: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>, actor: r.actor_id }))
    .filter((r) => r.p.resourceId === refId);
}

describe("W4: Return routes to the maker", () => {
  it("raises one maker task, leaves the approver queue, and records Return once", async () => {
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await startIndentChain(tenant, refId);
    const [first] = await tasksFor(tenant, id);
    await decide(first!, CHECKER, "return", "Quantity must be 6 nos per DDO note dated 06-11-2026");

    const pending = (await tasksFor(tenant, id)).filter((t) => t.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.assignee_id).toBe(MAKER);
    expect(pending[0]!.role_ref).toBeNull();
    expect(String(pending[0]!.node_key)).toMatch(/^rework:/);
    expect((await getInstance(tenant, id))?.status).toBe("active");

    const actions = await historyActions(tenant, id);
    expect(actions.filter((a) => a === "return")).toHaveLength(1);
    const trail = await asTenant(tenant, () => listDecisionsForRef(tenant, "procurement_indent", refId));
    expect(trail.filter((d) => d.action === "return")).toHaveLength(1);
    expect(trail[0]!.reason).toContain("6 nos");
  });

  it("after the maker resubmits, the approver task re-opens and approving completes the instance", async () => {
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await startIndentChain(tenant, refId);
    await decide((await tasksFor(tenant, id))[0]!, CHECKER, "return", "Revise quantity");
    const rework = (await tasksFor(tenant, id)).find((t) => t.status === "pending")!;
    await decide(rework, MAKER, "approve");   // maker resubmits; not subject to checker SoD

    const pending = (await tasksFor(tenant, id)).filter((t) => t.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.node_key).toBe("proc_officer");
    expect(pending[0]!.role_ref).toBe("procurement_officer");

    await decide(pending[0]!, CHECKER, "approve");   // same checker may decide after resubmission
    expect((await getInstance(tenant, id))?.status).toBe("completed");
    const out = await sqlAsTenant<{ payload: unknown }>(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = 'procurement.indent.approve'`);
    expect(out.length).toBe(1);
  });
});

describe("W4: the maker resubmits through the HTTP command path", () => {
  it("accepts the maker's resubmit (no self-approval block), refuses reject/return on a rework task, and refuses other users", async () => {
    const tenant = newTenant();
    const id = await startIndentChain(tenant, randomUUID());
    await decide((await tasksFor(tenant, id))[0]!, CHECKER, "return", "Revise quantity");
    const rework = (await tasksFor(tenant, id)).find((t) => t.status === "pending")!;
    const ctx = (actorId: string) => ({ tenantId: tenant, actorId, actorType: "user" as const, roles: ["procurement_officer"], correlationId: randomUUID() });

    await expect(asTenant(tenant, () => completeTask(ctx(MAKER), rework.id as string, "reject", "no"))).rejects.toMatchObject({ code: "REWORK_RESUBMIT_ONLY" });
    await expect(asTenant(tenant, () => completeTask(ctx(CHECKER), rework.id as string, "approve"))).rejects.toMatchObject({ status: 403 });
    await expect(asTenant(tenant, () => completeTask(ctx(MAKER), rework.id as string, "approve"))).resolves.toMatchObject({ status: "accepted" });
  });
});

describe("W6: decision audit events", () => {
  it("writes an audit event with actor, action, item ref and reason for return and reject", async () => {
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await startIndentChain(tenant, refId);
    await decide((await tasksFor(tenant, id))[0]!, CHECKER, "return", "Revise quantity");
    const rework = (await tasksFor(tenant, id)).find((t) => t.status === "pending")!;
    await decide(rework, MAKER, "approve");
    const reopened = (await tasksFor(tenant, id)).find((t) => t.status === "pending")!;
    await decide(reopened, CHECKER, "reject", "Not budgeted for FY 2026-27");

    const ev = await auditFor(tenant, refId);
    const ret = ev.find((e) => e.p.action === "workflow.task.return");
    const rej = ev.find((e) => e.p.action === "workflow.task.reject");
    expect(ret?.actor).toBe(CHECKER);
    expect(ret?.p.reason).toBe("Revise quantity");
    expect(ret?.p.resourceType).toBe("procurement_indent");
    expect(rej?.actor).toBe(CHECKER);
    expect(rej?.p.reason).toBe("Not budgeted for FY 2026-27");
  });
});
