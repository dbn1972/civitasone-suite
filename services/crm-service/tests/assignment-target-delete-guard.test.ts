/**
 * GAP-CRM-ASSIGNMENT-DIRECTORY-04 — deleting a queue/territory/partner/branch
 * that an assignment rule still references must be refused with 409 IN_USE
 * rather than silently orphaning the rule (which would leave leads it routes
 * never assigned). An unreferenced target still deletes cleanly.
 *
 * DB-backed, HTTP round-trip (CQRS reads back after the queue drains).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
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

async function createRuleReferencing(targetId: string): Promise<void> {
  const res = await call("POST", "/v1/crm/assignment-rules", {
    name: "Route north to territory",
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
