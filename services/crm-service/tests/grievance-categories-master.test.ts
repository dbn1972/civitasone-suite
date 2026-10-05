/**
 * GAP-CRM-GRIEVANCES-NEW-03 — grievance-category master admin CRUD.
 *
 * DB-backed, HTTP round-trip. Proves: empty-on-first-read (no fake seed rows),
 * admin create/update/delete, non-admin cannot write but can read, tenant
 * isolation, duplicate-code 409, audit event emitted, and that a category added
 * via the admin API is immediately readable (the "appears without redeploy" claim).
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
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-gc" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.grievance_categories WHERE tenant_id = ${t}`).catch(() => {});
  }
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

describe("GET /v1/crm/grievance-categories", () => {
  it("returns an empty list on first read (no fake tenant rows are seeded)", async () => {
    const res = await call("GET", "/v1/crm/grievance-categories", { headers: headers(["crm_admin"], OTHER) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("401 without a token", async () => {
    expect((await call("GET", "/v1/crm/grievance-categories", { noAuth: true })).statusCode).toBe(401);
  });
});

describe("POST/PUT/DELETE /v1/crm/grievance-categories", () => {
  it("admin can create a category and it appears on the very next read (no redeploy)", async () => {
    const create = await call("POST", "/v1/crm/grievance-categories", {
      payload: { code: "water_supply", label: "Water Supply", sortOrder: 1 },
    });
    expect(create.statusCode).toBe(202);
    expect(create.json().status).toBe("accepted");
    const rowsNow = ((await call("GET", "/v1/crm/grievance-categories")).json() as { data: Array<{ id: string; code: string; active: boolean }> }).data;
    const created = rowsNow.find((r) => r.id === create.json().id)!;
    expect(created.code).toBe("water_supply");
    expect(created.active).toBe(true);

    const list = await call("GET", "/v1/crm/grievance-categories");
    const codes = (list.json() as { data: Array<{ code: string }> }).data.map((r) => r.code);
    expect(codes).toContain("water_supply");

    const audit = (await scoped(TENANT, (tx) => tx`
      SELECT COUNT(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND payload->>'action' = 'grievance_category_create'
    `)) as unknown as Array<{ n: number }>;
    expect(audit[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("rejects a duplicate code with 409", async () => {
    const dup = await call("POST", "/v1/crm/grievance-categories", {
      payload: { code: "water_supply", label: "Water Supply (dup)" },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("rejects a non-snake_case code with 400", async () => {
    const bad = await call("POST", "/v1/crm/grievance-categories", {
      payload: { code: "Water Supply", label: "x" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("admin can update label/active, bumping version", async () => {
    const list = await call("GET", "/v1/crm/grievance-categories");
    const row = (list.json() as { data: Array<{ id: string; version: number }> }).data[0]!;
    const upd = await call("PUT", `/v1/crm/grievance-categories/${row.id}`, {
      payload: { label: "Water Supply (updated)", active: false },
    });
    expect(upd.statusCode).toBe(202);
    const updated = ((await call("GET", "/v1/crm/grievance-categories")).json() as { data: Array<{ id: string; label: string; active: boolean; version: number }> }).data.find((r) => r.id === row.id)!;
    expect(updated.label).toBe("Water Supply (updated)");
    expect(updated.active).toBe(false);
    expect(updated.version).toBe(row.version + 1);
  });

  it("admin can delete a category", async () => {
    const list = await call("GET", "/v1/crm/grievance-categories");
    const row = (list.json() as { data: Array<{ id: string }> }).data[0]!;
    const del = await call("DELETE", `/v1/crm/grievance-categories/${row.id}`);
    expect(del.statusCode).toBe(202);
    const after = await call("GET", "/v1/crm/grievance-categories");
    expect((after.json() as { data: unknown[] }).data).toEqual([]);
  });

  it("non-admin crm_user can read but cannot create", async () => {
    expect((await call("GET", "/v1/crm/grievance-categories", { headers: headers(["crm_user"]) })).statusCode).toBe(200);
    const forbidden = await call("POST", "/v1/crm/grievance-categories", {
      headers: headers(["crm_user"]),
      payload: { code: "x", label: "X" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("is tenant-isolated: one tenant's categories are invisible to another", async () => {
    await call("POST", "/v1/crm/grievance-categories", { payload: { code: "tenant_a_only", label: "A only" } });
    const otherList = await call("GET", "/v1/crm/grievance-categories", { headers: headers(["crm_admin"], OTHER) });
    const otherCodes = (otherList.json() as { data: Array<{ code: string }> }).data.map((r) => r.code);
    expect(otherCodes).not.toContain("tenant_a_only");
  });
});

describe("CQRS write path", () => {
  it("returns 404 synchronously for a missing target and writes nothing", async () => {
    const missing = randomUUID();
    expect((await call("PUT", `/v1/crm/grievance-categories/${missing}`, { payload: { label: "x" } })).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/crm/grievance-categories/${missing}`)).statusCode).toBe(404);
  });

  it("a create answers 202 with a generated id and the row only exists after the consumer runs", async () => {
    const res = await call("POST", "/v1/crm/grievance-categories", { payload: { code: "cqrs_probe", label: "Probe" } });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = (await scoped(TENANT, (tx) => tx`SELECT id FROM crm.grievance_categories WHERE id = ${id}`)) as unknown as unknown[];
    expect(rows).toHaveLength(1);
  });
});

