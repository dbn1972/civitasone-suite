/**
 * B9-wf1: procurement-service raises approval instances for an annual plan
 * (`procurement_plan_approval`, refType procurement_plan) and a PO amendment
 * (`procurement_po_amendment_approval`, refType procurement_po_amendment). No
 * tenant had those definitions, and the 0024 ref_type CHECK rejected both
 * refTypes, so every such instance dead-lettered and no approval task could
 * exist. Now:
 *  - tenant provisioning seeds both one-node chains (Procurement Head,
 *    procurement_admin - same shape as procurement_po_approval);
 *  - an instance for either routes to a pending task (migration 0048);
 *  - a tenant without the chain gets the fail-closed R13 rejection
 *    (WORKFLOW_NOT_CONFIGURED) instead of a dead letter;
 *  - the backfill CLI seeds them into existing tenants.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { STANDARD_DEFINITIONS } from "../src/modules/provisioning/catalog.js";
import { seedDefinitionsTx } from "../src/modules/provisioning/seed.js";
import { backfillStandardDefinitions, selectDefinitions } from "../src/modules/provisioning/backfill.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor, sqlAsTenant } from "./helpers/engine-harness.js";

const CHAINS = [
  { code: "procurement_plan_approval", refType: "procurement_plan" },
  { code: "procurement_po_amendment_approval", refType: "procurement_po_amendment" },
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

/** Exactly what planning/consumer.ts and po/amendment-consumer.ts publish. */
async function raise(tenantId: string, chain: (typeof CHAINS)[number], refId: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: `${chain.code} — test`, status: "active", version: 1,
    definitionCode: chain.code, initialTaskName: "Approval",
    refType: chain.refType, refId,
  }, { tenantId, actorId: randomUUID(), messageId: id });
  return id;
}

async function codesFor(tenantId: string): Promise<string[]> {
  const rows = await sqlAsTenant<{ code: string }>(tenantId,
    sql`SELECT code FROM workflow.definitions WHERE tenant_id = ${tenantId} AND status = 'active' ORDER BY code`);
  return rows.map((r) => r.code);
}

describe("B9-wf1 — procurement plan / PO amendment approval chains", () => {
  it("tenant provisioning seeds both one-node Procurement Head chains", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const codes = await codesFor(tenant);
    for (const c of CHAINS) expect(codes).toContain(c.code);

    const nodes = await sqlAsTenant<{ code: string; node_key: string; role_ref: string }>(tenant, sql`
      SELECT d.code, n.node_key, n.role_ref FROM workflow.definition_nodes n
        JOIN workflow.definitions d ON d.id = n.definition_id
       WHERE d.tenant_id = ${tenant} AND d.code IN ('procurement_plan_approval', 'procurement_po_amendment_approval')
       ORDER BY d.code, n.sort_order`);
    expect(nodes).toEqual([
      { code: "procurement_plan_approval", node_key: "proc_head", role_ref: "procurement_admin" },
      { code: "procurement_po_amendment_approval", node_key: "proc_head", role_ref: "procurement_admin" },
    ]);
  });

  for (const chain of CHAINS) {
    it(`a ${chain.refType} instance in a provisioned tenant gets a pending Procurement Head task`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const refId = randomUUID();
      const id = await raise(tenant, chain, refId);
      expect((await getInstance(tenant, id))?.status).toBe("active");
      const ts = await tasksFor(tenant, id);
      expect(ts).toHaveLength(1);
      expect(ts[0]).toMatchObject({ node_key: "proc_head", role_ref: "procurement_admin", ref_type: chain.refType, ref_id: refId, status: "pending" });
    });

    it(`a ${chain.refType} instance in an unprovisioned tenant is rejected (WORKFLOW_NOT_CONFIGURED), not dead-lettered`, async () => {
      const tenant = newTenant();
      const id = await raise(tenant, chain, randomUUID());
      expect((await getInstance(tenant, id))?.status).toBe("rejected");
      expect(await tasksFor(tenant, id)).toHaveLength(0);
    });
  }

  it("the backfill seeds both into a tenant provisioned before them, idempotently", async () => {
    const tenant = newTenant();
    const legacy = STANDARD_DEFINITIONS.filter((d) => !CHAINS.some((c) => c.code === d.code));
    await runWithTenant(tenant, () => db.transaction((tx) => seedDefinitionsTx(tx, tenant, randomUUID(), legacy)));
    const codes = CHAINS.map((c) => c.code);

    const dry = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), dryRun: true, defs: selectDefinitions(codes) });
    expect(dry.missing.sort()).toEqual([...codes].sort());
    expect(dry.seeded).toEqual([]);

    const first = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), defs: selectDefinitions(codes) });
    expect(first.seeded.sort()).toEqual([...codes].sort());
    const second = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), defs: selectDefinitions(codes) });
    expect(second.seeded).toEqual([]);

    const id = await raise(tenant, CHAINS[0], randomUUID());
    expect((await getInstance(tenant, id))?.status).toBe("active");
  });
});

// ---- review follow-up: task decisions dispatch to procurement; direct decisions close the task ----

async function outbox(tenantId: string, topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlAsTenant<{ payload: unknown }>(tenantId,
    sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${topic}`);
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
}

async function completeOnly(tenant: string, instanceId: string, decision: "approve" | "reject", reason?: string): Promise<string> {
  const ts = await tasksFor(tenant, instanceId);
  const t = ts[0]!;
  const approver = randomUUID();
  await q.deliver(COMMANDS.completeTask, {
    id: t.id, tenantId: tenant, instanceId, name: t.name, status: "pending",
    roleRef: t.role_ref, nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id,
    decision, sodOverride: true, ...(reason ? { reason } : {}),
  }, { tenantId: tenant, actorId: approver, messageId: randomUUID() });
  return approver;
}

const DISPATCHES = [
  { chain: CHAINS[0], idKey: "id", approve: "procurement.plan.approve", reject: "procurement.plan.reject" },
  { chain: CHAINS[1], idKey: "amendmentId", approve: "procurement.po_amendment.approve", reject: "procurement.po_amendment.reject" },
] as const;

describe("B9-wf1 — completing the task decides the procurement record", () => {
  for (const d of DISPATCHES) {
    it(`${d.chain.refType}: approving the task dispatches ${d.approve} { ${d.idKey} }`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const refId = randomUUID();
      const id = await raise(tenant, d.chain, refId);
      const approver = await completeOnly(tenant, id, "approve");
      expect((await getInstance(tenant, id))?.status).toBe("completed");
      const sent = await outbox(tenant, d.approve);
      expect(sent).toEqual([{ [d.idKey]: refId, tenantId: tenant, approvedBy: approver }]);
      expect(await outbox(tenant, d.reject)).toEqual([]);
    });

    it(`${d.chain.refType}: rejecting the task dispatches ${d.reject} { ${d.idKey}, reason }`, async () => {
      const tenant = newTenant();
      await provision(tenant);
      const refId = randomUUID();
      const id = await raise(tenant, d.chain, refId);
      const approver = await completeOnly(tenant, id, "reject", "not justified");
      const sent = await outbox(tenant, d.reject);
      expect(sent).toEqual([{ [d.idKey]: refId, tenantId: tenant, rejectedBy: approver, reason: "not justified" }]);
      expect(await outbox(tenant, d.approve)).toEqual([]);
    });
  }
});

describe("B9-wf1 — a direct procurement decision closes the open approval (close_by_ref)", () => {
  for (const chain of CHAINS) {
    for (const decision of ["approve", "reject"] as const) {
      // F102: a reject closes the instance as `rejected`, an approve as `completed`.
      const endStatus = decision === "reject" ? "rejected" : "completed";
      it(`${chain.refType} ${decision}: the pending task is completed and the instance ends ${endStatus}; a replay is a no-op`, async () => {
        const tenant = newTenant();
        await provision(tenant);
        const refId = randomUUID();
        const id = await raise(tenant, chain, refId);
        const payload = { tenantId: tenant, refType: chain.refType, refId, decision };
        await q.deliver(COMMANDS.closeInstanceByRef, payload, { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
        expect((await getInstance(tenant, id))?.status).toBe(endStatus);
        const ts = await tasksFor(tenant, id);
        expect(ts).toHaveLength(1);
        expect(ts[0]).toMatchObject({ status: "completed", decision });
        // closing must not re-dispatch the domain decision back to procurement
        expect(await outbox(tenant, decision === "approve" ? DISPATCHES[0].approve : DISPATCHES[0].reject)).toEqual([]);
        await q.deliver(COMMANDS.closeInstanceByRef, payload, { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
        expect((await getInstance(tenant, id))?.status).toBe(endStatus);
      });
    }
  }

  // F102 extended close_by_ref to procurement_indent / procurement_po, so the
  // negative case now uses a refType that is still excluded (leave_app).
  it("ignores refTypes whose producer does not send it (a leave approval stays open)", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const refId = randomUUID();
    const id = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id, tenantId: tenant, name: "PO approval", status: "active", version: 1,
      definitionCode: "leave_approval", initialTaskName: "Approval", refType: "leave_app", refId,
    }, { tenantId: tenant, actorId: randomUUID(), messageId: id });
    await q.deliver(COMMANDS.closeInstanceByRef, { tenantId: tenant, refType: "leave_app", refId, decision: "approve" },
      { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
    expect((await getInstance(tenant, id))?.status).toBe("active");
    expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending" });
  });
});
