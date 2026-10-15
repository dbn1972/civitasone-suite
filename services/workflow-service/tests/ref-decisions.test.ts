/**
 * GAP-PROCUREMENT-INDENTS-DETAIL-05: the decisions recorded against a business
 * record (refType + refId), exposed to the owning domain service through a
 * service-account-only internal read. Tenant-scoped; decisions only.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { listDecisionsForRef } from "../src/modules/history/repo.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, tasksFor, asTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
const newTenant = () => { const t = randomUUID(); tenants.push(t); return t; };

let q: TestQueue;
beforeAll(() => {
  q = new TestQueue();
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
});
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

async function indentInstance(tenant: string, refId: string): Promise<string> {
  const def = await seedDefinition(tenant, [
    { nodeKey: "start", name: "Submit", nodeType: "start", sortOrder: 1 },
    { nodeKey: "review", name: "Review", sortOrder: 2 },
    { nodeKey: "end", name: "Done", nodeType: "end", sortOrder: 3 },
  ], [{ fromNode: "start", toNode: "review" }, { fromNode: "review", toNode: "end" }]);
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId: tenant, name: "indent", status: "active", version: 1, initialTaskName: "Start",
    definitionCode: def.code, refType: "procurement_indent", refId, context: {},
  }, { tenantId: tenant, actorId: randomUUID(), messageId: id });
  return id;
}

async function decide(task: Record<string, unknown>, decision: "approve" | "reject", actor: string, reason?: string) {
  await q.deliver(COMMANDS.completeTask, {
    id: task.id, tenantId: task.tenant_id, instanceId: task.instance_id, name: task.name, status: "pending",
    roleRef: task.role_ref, nodeKey: task.node_key, refType: task.ref_type, refId: task.ref_id,
    decision, sodOverride: true, ...(reason ? { reason } : {}),
  }, { tenantId: task.tenant_id as string, actorId: actor, messageId: randomUUID() });
}

describe("listDecisionsForRef", () => {
  it("returns the ordered decisions with actor, decision and reason - and nothing for another tenant or ref", async () => {
    const tenant = newTenant();
    const other = newTenant();
    const refId = randomUUID();
    const id = await indentInstance(tenant, refId);
    const a1 = randomUUID();
    const a2 = randomUUID();
    await decide((await tasksFor(tenant, id))[0]!, "approve", a1);
    const review = (await tasksFor(tenant, id)).find((t) => t.node_key === "review" && t.status === "pending")!;
    await decide(review, "reject", a2, "Over the sanctioned budget");

    const rows = await asTenant(tenant, () => listDecisionsForRef(tenant, "procurement_indent", refId));
    expect(rows.map((r) => [r.action, r.actorId, r.reason])).toEqual([
      ["complete", a1, null],
      ["reject", a2, "Over the sanctioned budget"],
    ]);
    expect(rows[0]!.createdAt.getTime()).toBeLessThanOrEqual(rows[1]!.createdAt.getTime());

    expect(await asTenant(other, () => listDecisionsForRef(other, "procurement_indent", refId))).toEqual([]);
    expect(await asTenant(tenant, () => listDecisionsForRef(tenant, "procurement_indent", randomUUID()))).toEqual([]);
    expect(await asTenant(tenant, () => listDecisionsForRef(tenant, "procurement_po", refId))).toEqual([]);
  });
});

describe("POST /v1/workflow/internal/ref-decisions", () => {
  it("is service-account only and returns decisions for the calling tenant", async () => {
    const { buildApp } = await import("../src/app.js");
    const { signToken } = await import("@civitasone/auth");
    const app = await buildApp();
    const tenant = newTenant();
    const refId = randomUUID();
    const id = await indentInstance(tenant, refId);
    const actor = randomUUID();
    await decide((await tasksFor(tenant, id))[0]!, "approve", actor);
    const payload = { refType: "procurement_indent", refId };

    const userTok = signToken({ sub: randomUUID(), tid: tenant, roles: ["super_admin", "workflow_admin"], sid: "s" }, process.env.JWT_SECRET as string);
    const denied = await app.inject({ method: "POST", url: "/v1/workflow/internal/ref-decisions", headers: { authorization: `Bearer ${userTok}` }, payload });
    expect(denied.statusCode).toBe(403);

    process.env.INTERNAL_SERVICE_SECRET = `internal-${randomUUID()}`;
    const headers = (t: string) => ({ "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET as string, "x-tenant-id": t });
    const ok = await app.inject({ method: "POST", url: "/v1/workflow/internal/ref-decisions", headers: headers(tenant), payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toHaveLength(1);
    expect(ok.json().data[0]).toMatchObject({ action: "complete", decision: "approve", actorId: actor });

    const foreign = await app.inject({ method: "POST", url: "/v1/workflow/internal/ref-decisions", headers: headers(randomUUID()), payload });
    expect(foreign.json().data).toEqual([]);

    const bad = await app.inject({ method: "POST", url: "/v1/workflow/internal/ref-decisions", headers: headers(tenant), payload: { refType: "procurement_indent", refId: "not-a-uuid" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
