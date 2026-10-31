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
  const AMEND = { code: "procurement_po_amendment_approval", refType: "procurement_po_amendment", reject: "procurement.po_amendment.reject" } as const;

  /** Simulate the pre-F102 outcome: the maker's override consumed the task and completed the instance. */
  async function consumed(tenant: string, chain: { code: string; refType: string }, refId: string): Promise<string> {
    const maker = randomUUID();
    const id = await raise(tenant, chain as (typeof CHAINS)[number], refId, maker);
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET status = 'completed', decision = 'approve', completed_by = ${maker}, sod_override = true WHERE instance_id = ${id}`);
    await sqlAsTenant(tenant, sql`UPDATE workflow.instances SET status = 'completed' WHERE id = ${id}`);
    return id;
  }

  it("re-opens only consumed approvals whose domain record still awaits approval; audits each; re-run is a no-op", async () => {
    const { repairSodConsumedApprovals } = await import("../src/scripts/repair-sod-consumed-approvals.js");
    const tenant = newTenant();
    await provision(tenant);
    const indentRef = randomUUID(), poRef = randomUUID(), amendRef = randomUUID();
    const indentId = await consumed(tenant, CHAINS[0], indentRef);   // indent still pending -> re-open
    const poId = await consumed(tenant, CHAINS[1], poRef);           // PO approved since -> skip
    const amendId = await consumed(tenant, AMEND, amendRef);         // amendment still pending -> re-open
    const fine = await raise(tenant, CHAINS[1], randomUUID(), randomUUID());
    await deliverComplete(tenant, fine, randomUUID(), "approve");    // a real checker approval -> never a candidate
    const domain: Record<string, string> = { [indentRef]: "pending", [poRef]: "approved", [amendRef]: "pending" };
    const readDomainStatus = async (_t: string, _r: string, refId: string) => domain[refId] ?? null;

    const dry = await repairSodConsumedApprovals(tenant, { actorId: randomUUID(), dryRun: true, readDomainStatus });
    expect(dry.candidates.map((c) => c.instanceId).sort()).toEqual([indentId, poId, amendId].sort());
    expect(dry.skipped).toEqual([{ instanceId: poId, reason: "already_decided:approved" }]);
    expect(dry.reopened).toEqual([]);
    expect((await getInstance(tenant, indentId))?.status).toBe("completed");

    const actor = randomUUID();
    const run = await repairSodConsumedApprovals(tenant, { actorId: actor, readDomainStatus });
    expect(run.reopened.sort()).toEqual([indentId, amendId].sort());
    for (const id of [indentId, amendId]) {
      expect((await getInstance(tenant, id))?.status).toBe("active");
      expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending", decision: null, completed_by: null, sod_override: false });
    }
    expect((await getInstance(tenant, poId))?.status).toBe("completed");
    expect((await getInstance(tenant, fine))?.status).toBe("completed");
    const audits = (await outbox(tenant, "audit.event.record")).filter((a) => a.action === "sod_repair_reopen");
    expect(audits.map((a) => a.resourceId).sort()).toEqual([indentId, amendId].sort());

    const again = await repairSodConsumedApprovals(tenant, { actorId: actor, readDomainStatus });
    expect(again.reopened).toEqual([]);
    expect(again.candidates.map((c) => c.instanceId)).toEqual([poId]);
  });

  it("procurementStatusReader reads the record status from procurement's DB under the tenant GUC", async () => {
    const { procurementStatusReader } = await import("../src/scripts/repair-sod-consumed-approvals.js");
    const url = new URL(process.env.DATABASE_URL as string);
    url.username = "procurement_svc"; url.password = "procurement_dev_pw"; url.pathname = "/civitas_procurement";
    const tenant = randomUUID();
    const indentId = randomUUID();
    const postgres = (await import("postgres")).default;
    const pg = postgres(url.toString(), { max: 1 });
    try {
      await pg.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
        await tx`INSERT INTO indent.procurement_indents (id, tenant_id, indent_no, department, purpose, status, created_by, updated_by)
                 VALUES (${indentId}, ${tenant}, 'IND-F102-R', 'Stores', 'F102', 'pending', ${tenant}, ${tenant})`;
      });
      const reader = procurementStatusReader(url.toString());
      try {
        expect(await reader.read(tenant, "procurement_indent", indentId)).toBe("pending");
        expect(await reader.read(randomUUID(), "procurement_indent", indentId)).toBeNull(); // other tenant
        expect(await reader.read(tenant, "procurement_po", randomUUID())).toBeNull();
      } finally {
        await reader.end();
      }
    } finally {
      await pg.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
        await tx`DELETE FROM indent.procurement_indents WHERE id = ${indentId}`;
      });
      await pg.end();
    }
  });
});

describe("F102 review — `rejected` is a terminal instance status", () => {
  it("cancel and migrate of a rejected instance are refused (409 INSTANCE_TERMINAL); search accepts status=rejected", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const id = await raise(tenant, CHAINS[0], randomUUID(), randomUUID());
    await deliverComplete(tenant, id, randomUUID(), "reject", { reason: "no" });
    expect((await getInstance(tenant, id))?.status).toBe("rejected");

    const tok = signToken({ sub: randomUUID(), tid: tenant, roles: ["workflow_admin"], sid: "s" }, SECRET);
    const headers = { authorization: `Bearer ${tok}` };
    const app = await buildApp();
    const cancel = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/cancel`, headers, payload: { reason: "x" } });
    const migrate = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/migrate`, headers, payload: { toVersion: 2 } });
    const search = await app.inject({ method: "GET", url: "/v1/workflow/instances/search?status=rejected", headers });
    await app.close();
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe("INSTANCE_TERMINAL");
    expect(migrate.statusCode).toBe(409);
    expect(migrate.json().code).toBe("INSTANCE_TERMINAL");
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).toContain(id);
  });
});
