/**
 * GAP-CRM-ASSIGNMENT-DIRECTORY-04 — deleting a queue/territory/partner/branch
 * that an assignment rule still references must be refused with 409 IN_USE
 * rather than silently orphaning the rule (which would leave leads it routes
 * never assigned). An unreferenced target still deletes cleanly.
 *
 * DB-backed, HTTP round-trip (CQRS reads back after the queue drains).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-ad4" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(), ...(payload === undefined ? {} : { payload }) });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.assignment_rules WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.territories WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.assignment_queues WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.branches WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.partners WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function createTerritory(name: string, code: string): Promise<string> {
  const res = await call("POST", "/v1/crm/territories", { name, code });
  expect([200, 202]).toContain(res.statusCode);
  const row = (await scoped((tx) => tx`SELECT id FROM crm.territories WHERE tenant_id = ${TENANT} AND code = ${code} LIMIT 1`)) as unknown as Array<{ id: string }>;
  return row[0]!.id;
}

async function createRuleReferencing(targetId: string, name = "Route north to territory"): Promise<void> {
  const res = await call("POST", "/v1/crm/assignment-rules", {
    name,
    ruleType: "territory",
    criteria: { territory: "north", territoryId: targetId, ownerId: randomUUID() },
  });
  expect([200, 202]).toContain(res.statusCode);
}

describe("GAP-CRM-ASSIGNMENT-DIRECTORY-04: delete guard for referenced targets", () => {
  it("refuses to delete a territory still referenced by an assignment rule (409 IN_USE)", async () => {
    const id = await createTerritory("North", "N1");
    await createRuleReferencing(id);

    const del = await call("DELETE", `/v1/crm/territories/${id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error?.code ?? del.json().code).toBe("IN_USE");

    // The territory is still there — nothing was orphaned.
    const still = (await scoped((tx) => tx`SELECT id FROM crm.territories WHERE id = ${id}`)) as unknown as Array<{ id: string }>;
    expect(still.length).toBe(1);
  });

  it("deletes an unreferenced territory cleanly", async () => {
    const id = await createTerritory("South", "S1");
    const del = await call("DELETE", `/v1/crm/territories/${id}`);
    expect([200, 202]).toContain(del.statusCode);

    const gone = (await scoped((tx) => tx`SELECT id FROM crm.territories WHERE id = ${id}`)) as unknown as Array<{ id: string }>;
    expect(gone.length).toBe(0);
  });
});

// ── What exactly still uses the target (GAP-CRM-ASSIGNMENT-DIRECTORY-04) ─────────
// The 409 used to carry only a count in prose and covered rules for a territory only
// in the tests; a territory still holding branches was not guarded at all.
async function createViaApi(path: string, body: Record<string, unknown>, table: string, nameKey = "name"): Promise<string> {
  const res = await call("POST", path, body);
  expect([200, 202]).toContain(res.statusCode);
  const rows = (await scoped((tx) => tx.unsafe(
    `SELECT id FROM crm.${table} WHERE tenant_id = '${TENANT}' AND ${nameKey} = '${String(body[nameKey])}' LIMIT 1`,
  ))) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe("GAP-CRM-ASSIGNMENT-DIRECTORY-04: 409 IN_USE names what still uses the target", () => {
  it.each([
    ["queue", "/v1/crm/assignment-queues", "assignment_queues"],
    ["partner", "/v1/crm/partners", "partners"],
    ["branch", "/v1/crm/branches", "branches"],
  ])("refuses to delete a %s a rule still points at, listing the rule", async (kind, path, table) => {
    const id = await createViaApi(path, { name: `Used ${kind}` }, table);
    await createRuleReferencing(id, `Rule using ${kind}`);

    // The refusal must stop the request: no delete command may be enqueued behind it.
    const publish = vi.spyOn(queue, "publish");
    const del = await call("DELETE", `${path}/${id}`);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect(del.statusCode).toBe(409);
    const body = del.json();
    expect(body.code).toBe("IN_USE");
    expect(body.message).toContain("1 assignment rule");
    expect(body.references).toMatchObject({
      assignmentRules: [{ name: `Rule using ${kind}` }],
      assignmentRuleCount: 1,
      branches: [],
      branchCount: 0,
    });
    const still = (await scoped((tx) => tx.unsafe(`SELECT id FROM crm.${table} WHERE id = '${id}'`))) as unknown as unknown[];
    expect(still).toHaveLength(1);
  });

  it("refuses to delete a territory that branches are filed under, even with no rule, listing them", async () => {
    const territoryId = await createViaApi("/v1/crm/territories", { name: "East", code: "E1" }, "territories", "code");
    await call("POST", "/v1/crm/branches", { name: "Kolkata branch", territoryId });
    await call("POST", "/v1/crm/branches", { name: "Patna branch", territoryId });

    const publish = vi.spyOn(queue, "publish");
    const del = await call("DELETE", `/v1/crm/territories/${territoryId}`);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("IN_USE");
    expect(del.json().message).toContain("2 branches");
    expect(del.json().references.branchCount).toBe(2);
    expect((del.json().references.branches as Array<{ name: string }>).map((b) => b.name).sort()).toEqual([
      "Kolkata branch",
      "Patna branch",
    ]);
    expect(del.json().references.assignmentRuleCount).toBe(0);
  });

  it("reports rule AND branch usage together, with exact counts beyond the sampled names", async () => {
    const territoryId = await createViaApi("/v1/crm/territories", { name: "West", code: "W1" }, "territories", "code");
    await call("POST", "/v1/crm/branches", { name: "Mumbai branch", territoryId });
    // 12 rules mention the territory: names are sampled (10) but the count is exact.
    for (let i = 0; i < 12; i++) await createRuleReferencing(territoryId, `West rule ${String(i).padStart(2, "0")}`);

    const refs = (await call("DELETE", `/v1/crm/territories/${territoryId}`)).json().references;
    expect(refs.assignmentRuleCount).toBe(12);
    expect(refs.assignmentRules).toHaveLength(10);
    expect(refs.branchCount).toBe(1);
  });

  it("allows deleting the territory once its branches are gone", async () => {
    const territoryId = await createViaApi("/v1/crm/territories", { name: "Central", code: "C1" }, "territories", "code");
    const branchId = await createViaApi("/v1/crm/branches", { name: "Bhopal branch", territoryId }, "branches");
    expect((await call("DELETE", `/v1/crm/territories/${territoryId}`)).statusCode).toBe(409);

    expect([200, 202]).toContain((await call("DELETE", `/v1/crm/branches/${branchId}`)).statusCode);
    const del = await call("DELETE", `/v1/crm/territories/${territoryId}`);
    expect([200, 202]).toContain(del.statusCode);
    const gone = (await scoped((tx) => tx`SELECT id FROM crm.territories WHERE id = ${territoryId}`)) as unknown as unknown[];
    expect(gone).toHaveLength(0);
  });

  it("the consumer re-checks atomically: a delete command that bypassed the route cannot orphan branches", async () => {
    const territoryId = await createViaApi("/v1/crm/territories", { name: "South", code: "S9" }, "territories", "code");
    await call("POST", "/v1/crm/branches", { name: "Chennai branch", territoryId });
    await queue.publish(COMMANDS.deleteTerritory, {
      messageId: randomUUID(),
      type: COMMANDS.deleteTerritory,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id: territoryId, tenantId: TENANT },
    });
    await drainQueue();
    const still = (await scoped((tx) => tx`SELECT id FROM crm.territories WHERE id = ${territoryId}`)) as unknown as unknown[];
    expect(still).toHaveLength(1);
  });

  it("deletes an unreferenced queue, partner and branch cleanly", async () => {
    for (const [path, table, name] of [
      ["/v1/crm/assignment-queues", "assignment_queues", "Free queue"],
      ["/v1/crm/partners", "partners", "Free partner"],
      ["/v1/crm/branches", "branches", "Free branch"],
    ] as const) {
      const id = await createViaApi(path, { name }, table);
      expect([200, 202]).toContain((await call("DELETE", `${path}/${id}`)).statusCode);
      const gone = (await scoped((tx) => tx.unsafe(`SELECT id FROM crm.${table} WHERE id = '${id}'`))) as unknown as unknown[];
      expect(gone).toHaveLength(0);
    }
  });
});
