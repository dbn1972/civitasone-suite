/**
 * B10 `backfill --repair-broken`: 21 of 22 live leave_approval definitions
 * still carry the pre-B10 chain (hrms_employee -> hrms_manager -> hrms_hr),
 * whose role refs exist in no realm. The repair replaces such a chain with the
 * catalogue graph ONLY when the code is in the catalogue, a node uses one of
 * the catalogue's explicit brokenRoleRefs, and no instance on it is in flight.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as defRepo from "../src/modules/definitions/repo.js";
import { definitions } from "../src/modules/definitions/schema.js";
import { repairBrokenStandardDefinitions, selectDefinitions } from "../src/modules/provisioning/backfill.js";
import { STANDARD_DEFINITIONS } from "../src/modules/provisioning/catalog.js";
import { cleanup, sqlAsTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

const BROKEN_NODES = [
  { nodeKey: "apply", name: "Employee Application", roleRef: "hrms_employee" },
  { nodeKey: "manager_approve", name: "Manager Approval", roleRef: "hrms_manager" },
  { nodeKey: "hr_approve", name: "HR Approval", roleRef: "hrms_hr" },
];

/** A leave_approval v1 as the old catalogue / migration 0003+0012b seeded it. */
async function seedLeave(tenant: string, nodes: Array<{ nodeKey: string; name: string; roleRef: string }>): Promise<string> {
  const id = randomUUID();
  const actor = randomUUID();
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(definitions).values({
      id, tenantId: tenant, code: "leave_approval", name: "Leave Approval Workflow",
      version: 1, status: "active", createdBy: actor, updatedBy: actor,
    });
    await defRepo.insertGraphTx(tx, id,
      nodes.map((n, i) => ({ ...n, nodeType: "task", sortOrder: i + 1 })),
      nodes.slice(1).map((n, i) => ({ fromNode: nodes[i]!.nodeKey, toNode: n.nodeKey, sortOrder: i + 1 })));
  }));
  return id;
}

async function addInstance(tenant: string, definitionId: string, status: string): Promise<void> {
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, definition_id, definition_version, ref_type, ref_id, current_node, created_by, updated_by, version)
    VALUES (${randomUUID()}, ${tenant}, 'Leave', ${status}, ${definitionId}, 1, 'leave_app', ${randomUUID()}, 'apply', ${randomUUID()}, ${randomUUID()}, 1)`);
}

async function leaveDefs(tenant: string) {
  return sqlAsTenant<{ id: string; version: number; status: string; roles: string }>(tenant, sql`
    SELECT d.id, d.version, d.status, string_agg(n.role_ref, ',' ORDER BY n.sort_order) AS roles
      FROM workflow.definitions d JOIN workflow.definition_nodes n ON n.definition_id = d.id
     WHERE d.tenant_id = ${tenant} AND d.code = 'leave_approval'
     GROUP BY d.id, d.version, d.status ORDER BY d.version`);
}

async function repairAudits(tenant: string) {
  const rows = await sqlAsTenant<{ payload: unknown }>(tenant,
    sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = 'audit.event.record'`);
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.action === "repair_definition");
}

const run = (tenant: string, dryRun = false) =>
  repairBrokenStandardDefinitions(tenant, { actorId: randomUUID(), dryRun, defs: selectDefinitions() });

describe("B10 backfill --repair-broken", () => {
  it("the matcher is explicit: only leave_approval lists broken role refs, exactly the hrms_* three", () => {
    const withBroken = STANDARD_DEFINITIONS.filter((d) => (d.brokenRoleRefs ?? []).length > 0);
    expect(withBroken.map((d) => [d.code, d.brokenRoleRefs])).toEqual([
      ["leave_approval", ["hrms_employee", "hrms_manager", "hrms_hr"]],
    ]);
  });

  it("a broken chain with no in-flight instances is replaced (new active version, old archived, audited); dry run first writes nothing", async () => {
    const tenant = newTenant();
    const oldId = await seedLeave(tenant, BROKEN_NODES);
    await addInstance(tenant, oldId, "completed"); // finished history does not block the repair
    await addInstance(tenant, oldId, "rejected");

    const dry = await run(tenant, true);
    expect(dry.repairable).toMatchObject([{ code: "leave_approval", definitionId: oldId, inFlight: 0 }]);
    expect(dry.repaired).toEqual([]);
    expect(await leaveDefs(tenant)).toEqual([{ id: oldId, version: 1, status: "active", roles: "hrms_employee,hrms_manager,hrms_hr" }]);
    expect(await repairAudits(tenant)).toEqual([]);

    const r = await run(tenant);
    expect(r.repaired).toHaveLength(1);
    expect(r.repaired[0]).toMatchObject({ definitionId: oldId, version: 1, newVersion: 2, brokenRoleRefs: ["hrms_employee", "hrms_hr", "hrms_manager"] });
    const defs = await leaveDefs(tenant);
    expect(defs).toEqual([
      { id: oldId, version: 1, status: "archived", roles: "hrms_employee,hrms_manager,hrms_hr" },
      { id: r.repaired[0]!.newDefinitionId, version: 2, status: "active", roles: "manager" },
    ]);
    const audits = await repairAudits(tenant);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      resourceType: "workflow_definition", resourceId: r.repaired[0]!.newDefinitionId,
      metadata: { code: "leave_approval", replacedDefinitionId: oldId, replacedVersion: 1, newVersion: 2 },
    });
  });

  // IN_FLIGHT_STATUSES also lists "pending" as the owner asked, but the
  // instances_status_check constraint does not admit it, so it cannot be seeded.
  it.each(["active", "suspended"])("a broken chain with an in-flight (%s) instance is skipped and reported", async (status) => {
    const tenant = newTenant();
    const oldId = await seedLeave(tenant, BROKEN_NODES);
    await addInstance(tenant, oldId, status);
    const r = await run(tenant);
    expect(r.repaired).toEqual([]);
    expect(r.skippedInFlight).toMatchObject([{ code: "leave_approval", definitionId: oldId, inFlight: 1 }]);
    expect(await leaveDefs(tenant)).toEqual([{ id: oldId, version: 1, status: "active", roles: "hrms_employee,hrms_manager,hrms_hr" }]);
    expect(await repairAudits(tenant)).toEqual([]);
  });

  it("a good chain is untouched (catalogue shape, and a tenant-customised chain on real roles)", async () => {
    const good = newTenant();
    const goodId = await seedLeave(good, [{ nodeKey: "manager_approval", name: "Reporting Officer Approval", roleRef: "manager" }]);
    const custom = newTenant();
    const customId = await seedLeave(custom, [
      { nodeKey: "ro", name: "Reporting Officer", roleRef: "manager" },
      { nodeKey: "hr", name: "HR", roleRef: "hr_officer" },
    ]);
    for (const [t, id, roles] of [[good, goodId, "manager"], [custom, customId, "manager,hr_officer"]] as const) {
      const r = await run(t);
      expect(r).toEqual({ repairable: [], skippedInFlight: [], repaired: [] });
      expect(await leaveDefs(t)).toEqual([{ id, version: 1, status: "active", roles }]);
    }
  });

  it("a second run does nothing", async () => {
    const tenant = newTenant();
    await seedLeave(tenant, BROKEN_NODES);
    expect((await run(tenant)).repaired).toHaveLength(1);
    const before = await leaveDefs(tenant);
    const second = await run(tenant);
    expect(second).toEqual({ repairable: [], skippedInFlight: [], repaired: [] });
    expect(await leaveDefs(tenant)).toEqual(before);
    expect(await repairAudits(tenant)).toHaveLength(1);
  });
});
