/**
 * F77: `procurement_po_approval` existed only for the demo tenant, so in every
 * other tenant procurement's PO approval instance was rejected as
 * unknown_definition (R13) and a PO could never be approved or dispatched.
 *
 *  - tenant provisioning now seeds the procurement PO / indent approval chains;
 *  - a PO approval instance in a provisioned tenant routes to a Procurement
 *    Head task whose approval dispatches procurement.po.approve;
 *  - a missing definition fails clearly: 422 WORKFLOW_NOT_CONFIGURED on the
 *    HTTP create and the internal pre-check, and the async rejection carries
 *    the same code;
 *  - the backfill seeds existing tenants idempotently (dry-run writes nothing).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { STANDARD_DEFINITIONS } from "../src/modules/provisioning/catalog.js";
import { seedDefinitionsTx } from "../src/modules/provisioning/seed.js";
import { backfillStandardDefinitions, selectDefinitions } from "../src/modules/provisioning/backfill.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor, sqlAsTenant } from "./helpers/engine-harness.js";

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

/** Exactly what procurement-service's po/consumer.ts publishes on PO create. */
async function raisePoApproval(tenantId: string, poId: string, actorId: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: "Procurement PO Approval — PO/2026/0001", status: "active", version: 1,
    definitionCode: "procurement_po_approval", initialTaskName: "Procurement Head Approval",
    refType: "procurement_po", refId: poId,
  }, { tenantId, actorId, messageId: id });
  return id;
}

async function outbox(tenantId: string, topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlAsTenant<{ payload: unknown }>(tenantId,
    sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${topic}`);
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
}

async function codesFor(tenantId: string): Promise<string[]> {
  const rows = await sqlAsTenant<{ code: string }>(tenantId,
    sql`SELECT code FROM workflow.definitions WHERE tenant_id = ${tenantId} AND status = 'active' ORDER BY code`);
  return rows.map((r) => r.code);
}

describe("F77 — tenant provisioning seeds the procurement approval chains", () => {
  it("a provisioned tenant has an active procurement_po_approval (Procurement Head) and procurement_indent_approval", async () => {
    const tenant = newTenant();
    await provision(tenant);

    const codes = await codesFor(tenant);
    expect(codes).toContain("procurement_po_approval");
    expect(codes).toContain("procurement_indent_approval");

    const nodes = await sqlAsTenant<{ code: string; node_key: string; role_ref: string }>(tenant, sql`
      SELECT d.code, n.node_key, n.role_ref FROM workflow.definition_nodes n
        JOIN workflow.definitions d ON d.id = n.definition_id
       WHERE d.tenant_id = ${tenant} AND d.code IN ('procurement_po_approval', 'procurement_indent_approval')
       ORDER BY d.code, n.sort_order`);
    expect(nodes).toEqual([
      { code: "procurement_indent_approval", node_key: "proc_officer", role_ref: "procurement_officer" },
      { code: "procurement_po_approval", node_key: "proc_head", role_ref: "procurement_admin" },
    ]);
  });

  it("a PO in a provisioned tenant gets a Procurement Head task whose approval dispatches procurement.po.approve", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const poId = randomUUID();
    const id = await raisePoApproval(tenant, poId, randomUUID());

    const inst = await getInstance(tenant, id);
    expect(inst?.status).toBe("active");
    const ts = await tasksFor(tenant, id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ node_key: "proc_head", role_ref: "procurement_admin", ref_type: "procurement_po", ref_id: poId, status: "pending" });

    const approver = randomUUID();
    const t = ts[0]!;
    await q.deliver(COMMANDS.completeTask, {
      id: t.id, tenantId: tenant, instanceId: id, name: t.name, status: "pending",
      roleRef: t.role_ref, nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id,
      decision: "approve", sodOverride: true,
    }, { tenantId: tenant, actorId: approver, messageId: randomUUID() });

    expect((await getInstance(tenant, id))?.status).toBe("completed");
    const dispatched = await outbox(tenant, "procurement.po.approve");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ id: poId, tenantId: tenant, approvedBy: approver });
  });
});

describe("F77 — a missing definition fails clearly with WORKFLOW_NOT_CONFIGURED", () => {
  const SECRET = process.env.JWT_SECRET as string;

  it("POST /v1/workflow/instances answers 422 WORKFLOW_NOT_CONFIGURED (not 202) when the code does not resolve", async () => {
    const tenant = newTenant();
    const tok = signToken({ sub: randomUUID(), tid: tenant, roles: ["workflow_admin"], sid: "s" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/workflow/instances", headers: { authorization: `Bearer ${tok}` },
      payload: { name: "PO approval", definitionCode: "procurement_po_approval", refType: "procurement_po", refId: randomUUID() },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("WORKFLOW_NOT_CONFIGURED");
    expect(res.json().message).toContain("procurement_po_approval");
  });

  it("the internal pre-check reports configured=false before and true after provisioning; users are refused", async () => {
    const tenant = newTenant();
    process.env.INTERNAL_SERVICE_SECRET = `internal-${randomUUID()}`;
    const headers = { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET, "x-tenant-id": tenant };
    const url = "/v1/workflow/internal/definition-configured";
    const app = await buildApp();
    const before = await app.inject({ method: "POST", url, headers, payload: { code: "procurement_po_approval" } });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ code: "procurement_po_approval", configured: false });

    await provision(tenant);
    const after = await app.inject({ method: "POST", url, headers, payload: { code: "procurement_po_approval" } });
    expect(after.json()).toEqual({ code: "procurement_po_approval", configured: true });

    const userTok = signToken({ sub: randomUUID(), tid: tenant, roles: ["super_admin", "workflow_admin"], sid: "s" }, SECRET);
    const denied = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${userTok}` }, payload: { code: "x" } });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it("the async path stays fail-closed (no task) and its rejection names WORKFLOW_NOT_CONFIGURED", async () => {
    const tenant = newTenant(); // never provisioned
    const poId = randomUUID();
    const id = await raisePoApproval(tenant, poId, randomUUID());
    expect((await getInstance(tenant, id))?.status).toBe("rejected");
    expect(await tasksFor(tenant, id)).toHaveLength(0);
    const rejected = await outbox(tenant, "workflow.instance.rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      code: "WORKFLOW_NOT_CONFIGURED", reason: "unknown_definition",
      definitionCode: "procurement_po_approval", refType: "procurement_po", refId: poId,
    });
  });
});

describe("F77 — backfill for existing tenants", () => {
  /** A tenant provisioned before F77: only the original five standard chains. */
  async function legacyTenant(): Promise<string> {
    const tenant = newTenant();
    const legacy = STANDARD_DEFINITIONS.filter((d) => !d.code.startsWith("procurement_") || d.code === "procurement_approval");
    expect(legacy.map((d) => d.code).sort()).toEqual(
      ["file_noting", "finance_approval", "grant_disbursement", "leave_approval", "procurement_approval"],
    );
    await runWithTenant(tenant, () => db.transaction((tx) => seedDefinitionsTx(tx, tenant, randomUUID(), legacy)));
    return tenant;
  }

  it("dry-run reports the missing procurement chains and writes nothing", async () => {
    const tenant = await legacyTenant();
    const r = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), dryRun: true, defs: selectDefinitions() });
    // B9-wf1 added the plan / amendment chains to the same catalogue.
    expect(r.missing.sort()).toEqual([
      "procurement_indent_approval", "procurement_plan_approval", "procurement_po_amendment_approval", "procurement_po_approval",
    ]);
    expect(r.seeded).toEqual([]);
    expect(await codesFor(tenant)).not.toContain("procurement_po_approval");
  });

  it("seeds the missing chains once; a re-run is a no-op; the PO then routes", async () => {
    const tenant = await legacyTenant();
    const actor = randomUUID();
    const first = await backfillStandardDefinitions(tenant, { actorId: actor, defs: selectDefinitions(["procurement_po_approval"]) });
    expect(first.seeded).toEqual(["procurement_po_approval"]);
    const second = await backfillStandardDefinitions(tenant, { actorId: actor, defs: selectDefinitions(["procurement_po_approval"]) });
    expect(second.seeded).toEqual([]);
    expect(second.present).toEqual(["procurement_po_approval"]);

    const all = await sqlAsTenant<{ n: number }>(tenant,
      sql`SELECT count(*)::int AS n FROM workflow.definitions WHERE tenant_id = ${tenant} AND code = 'procurement_po_approval'`);
    expect(all[0]!.n).toBe(1);
    expect(await outbox(tenant, "audit.event.record")).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "backfill_definitions", metadata: { codes: ["procurement_po_approval"] } })]),
    );

    const id = await raisePoApproval(tenant, randomUUID(), randomUUID());
    expect((await getInstance(tenant, id))?.status).toBe("active");
  });

  it("never touches a draft/archived chain an admin left in place, and rejects unknown codes", async () => {
    const tenant = newTenant();
    await sqlAsTenant(tenant, sql`
      INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
      VALUES (${randomUUID()}, ${tenant}, 'procurement_po_approval', 'draft chain', 1, 'draft', ${randomUUID()}, ${randomUUID()})`);
    const r = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), defs: selectDefinitions(["procurement_po_approval"]) });
    expect(r.inactive).toEqual(["procurement_po_approval"]);
    expect(r.seeded).toEqual([]);
    expect(() => selectDefinitions(["procurement_po_aproval"])).toThrow(/not a standard catalogue code/);
  });
});
