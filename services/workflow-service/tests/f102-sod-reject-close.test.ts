/**
 * F102 (UAT T4): procurement indent / PO approvals in the workflow inbox.
 *
 *  1. SoD: the maker (with super_admin) completing their OWN approval task used
 *     to be accepted with sod_override=true - the task was consumed and the
 *     instance completed, then procurement refused the self-approval, leaving
 *     the record pending with NO open task. Now refused: 403 SOD_SELF_APPROVAL
 *     at the route, and the consumer refuses an override command too; the task
 *     stays open for a real checker.
 *  2. An inbox reject dispatches procurement.indent.reject / procurement.po.reject
 *     and the instance ends `rejected` (was `completed`).
 *  3. close_by_ref covers procurement_indent / procurement_po, so a direct
 *     approve / reject closes the inbox task with the same decision.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor, sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const CHAINS = [
  { code: "procurement_indent_approval", refType: "procurement_indent", reject: "procurement.indent.reject" },
  { code: "procurement_po_approval", refType: "procurement_po", reject: "procurement.po.reject" },
] as const;

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

/** What procurement's indent / PO create consumers publish; `maker` is the record creator. */
async function raise(tenantId: string, chain: (typeof CHAINS)[number], refId: string, maker: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: `${chain.code} — test`, status: "active", version: 1,
    definitionCode: chain.code, initialTaskName: "Approval", refType: chain.refType, refId,
  }, { tenantId, actorId: maker, messageId: id });
  return id;
}

async function outbox(tenantId: string, topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlAsTenant<{ payload: unknown }>(tenantId,
    sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${topic}`);
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
}

async function deliverComplete(tenant: string, instanceId: string, actorId: string, decision: "approve" | "reject", extra: Record<string, unknown> = {}) {
  const t = (await tasksFor(tenant, instanceId))[0]!;
  await q.deliver(COMMANDS.completeTask, {
    id: t.id, tenantId: tenant, instanceId, name: t.name, status: "pending",
    roleRef: t.role_ref, nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id, decision, ...extra,
  }, { tenantId: tenant, actorId, messageId: randomUUID() });
}

describe("F102 — the maker cannot consume their own indent / PO approval, even as super_admin", () => {
  for (const chain of CHAINS) {
    it(`${chain.refType}: POST /tasks/:id/complete by the super_admin maker -> 403 SOD_SELF_APPROVAL; task stays open`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const maker = randomUUID();
      const id = await raise(tenant, chain, randomUUID(), maker);
      const task = (await tasksFor(tenant, id))[0]!;
      const tok = signToken({ sub: maker, tid: tenant, roles: ["super_admin", "procurement_admin", "procurement_officer"], sid: "s" }, SECRET);
      const app = await buildApp();
      const res = await app.inject({
        method: "POST", url: `/v1/workflow/tasks/${task.id}/complete`,
        headers: { authorization: `Bearer ${tok}` }, payload: { decision: "approve" },
      });
      await app.close();
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("SOD_SELF_APPROVAL");
      expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending" });
      expect((await getInstance(tenant, id))?.status).toBe("active");
    });

    it(`${chain.refType}: a completeTask command by the maker carrying sodOverride is refused in the consumer; task stays open`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const maker = randomUUID();
      const id = await raise(tenant, chain, randomUUID(), maker);
      await deliverComplete(tenant, id, maker, "approve", { sodOverride: true });
      expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending" });
      expect((await getInstance(tenant, id))?.status).toBe("active");
      expect(await outbox(tenant, chain.refType === "procurement_po" ? "procurement.po.approve" : "procurement.indent.approve")).toEqual([]);
    });

    it(`${chain.refType}: a different checker still approves`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const id = await raise(tenant, chain, randomUUID(), randomUUID());
      await deliverComplete(tenant, id, randomUUID(), "approve");
      expect((await getInstance(tenant, id))?.status).toBe("completed");
    });
  }
});

describe("F102 — an inbox reject rejects the indent / PO and the instance ends rejected", () => {
  for (const chain of CHAINS) {
    it(`${chain.refType}: reject dispatches ${chain.reject} { id, reason } and the instance is rejected`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const refId = randomUUID();
      const id = await raise(tenant, chain, refId, randomUUID());
      const checker = randomUUID();
      await deliverComplete(tenant, id, checker, "reject", { reason: "not justified" });
      expect(await outbox(tenant, chain.reject)).toEqual([{ id: refId, tenantId: tenant, rejectedBy: checker, reason: "not justified" }]);
      expect((await getInstance(tenant, id))?.status).toBe("rejected");
      expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "completed", decision: "reject" });
    });
  }
});

describe("F102 — a direct indent / PO decision closes the inbox task (close_by_ref)", () => {
  for (const chain of CHAINS) {
    for (const decision of ["approve", "reject"] as const) {
      it(`${chain.refType} direct ${decision}: the task is completed with ${decision}; the instance ends ${decision === "reject" ? "rejected" : "completed"}`, async () => {
        const tenant = newTenant();
        await provision(tenant);
        const refId = randomUUID();
        const id = await raise(tenant, chain, refId, randomUUID());
        await q.deliver(COMMANDS.closeInstanceByRef, { tenantId: tenant, refType: chain.refType, refId, decision },
          { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
        expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "completed", decision });
        expect((await getInstance(tenant, id))?.status).toBe(decision === "reject" ? "rejected" : "completed");
      });
    }
  }
});

describe("F102 — repair CLI re-opens approvals consumed by a maker's super_admin override", () => {
  it("dry-run lists only the consumed self-approval; a real run re-opens it once; a checker-approved one is untouched", async () => {
    const { repairSodConsumedApprovals } = await import("../src/scripts/repair-sod-consumed-approvals.js");
    const tenant = newTenant();
    await provision(tenant);
    const maker = randomUUID();
    const stuck = await raise(tenant, CHAINS[0], randomUUID(), maker);
    // Simulate the pre-F102 outcome: the maker's override consumed the task and completed the instance.
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET status = 'completed', decision = 'approve', completed_by = ${maker}, sod_override = true WHERE instance_id = ${stuck}`);
    await sqlAsTenant(tenant, sql`UPDATE workflow.instances SET status = 'completed' WHERE id = ${stuck}`);
    const fine = await raise(tenant, CHAINS[1], randomUUID(), randomUUID());
    await deliverComplete(tenant, fine, randomUUID(), "approve");

    const dry = await repairSodConsumedApprovals(tenant, { actorId: randomUUID(), dryRun: true });
    expect(dry.candidates.map((c) => c.instanceId)).toEqual([stuck]);
    expect(dry.reopened).toEqual([]);
    expect((await getInstance(tenant, stuck))?.status).toBe("completed");

    const run = await repairSodConsumedApprovals(tenant, { actorId: randomUUID() });
    expect(run.reopened).toEqual([stuck]);
    expect((await getInstance(tenant, stuck))?.status).toBe("active");
    expect((await tasksFor(tenant, stuck))[0]).toMatchObject({ status: "pending", decision: null, completed_by: null, sod_override: false });
    expect((await getInstance(tenant, fine))?.status).toBe("completed");

    const again = await repairSodConsumedApprovals(tenant, { actorId: randomUUID() });
    expect(again.candidates).toEqual([]);
  });
});
