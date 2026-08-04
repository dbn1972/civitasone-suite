/**
 * LQ-003 — lead classification columns, PATCH endpoint, list filters, RLS.
 *
 * Round-trips through the real route → bus → consumer path (a 202 that writes
 * nothing is the CQRS failure mode) and proves the classification filters and
 * cross-tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-cls" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(method: "GET" | "POST" | "PATCH", url: string, opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method, url,
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

async function createLead(name: string, tenantId = TENANT): Promise<string> {
  const res = await call("POST", "/v1/crm/contacts", { headers: headers(["crm_admin"], tenantId), payload: { name } });
  expect(res.statusCode).toBe(202);
  return (res.json() as { id: string }).id;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`);
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

describe("PATCH /v1/crm/contacts/:id/classification", () => {
  it("persists all classification fields (round-trip through the consumer)", async () => {
    const id = await createLead("Classify Me");
    const res = await call("PATCH", `/v1/crm/contacts/${id}/classification`, {
      payload: { temperature: "hot", priority: "high", segment: "enterprise", product: "erp", region: "south", expectedValueMinor: 250000 },
    });
    expect(res.statusCode).toBe(202);

    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT temperature, priority, segment, product, region, expected_value_minor AS "ev"
      FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.temperature).toBe("hot");
    expect(rows[0]!.priority).toBe("high");
    expect(rows[0]!.segment).toBe("enterprise");
    expect(rows[0]!.product).toBe("erp");
    expect(rows[0]!.region).toBe("south");
    expect(String(rows[0]!.ev)).toBe("250000");
  });

  it("applies a partial update without clearing untouched fields", async () => {
    const id = await createLead("Partial");
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { temperature: "warm", priority: "low" } });
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { priority: "high" } });
    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT temperature, priority FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows[0]!.temperature).toBe("warm"); // untouched
    expect(rows[0]!.priority).toBe("high");   // updated
  });

  it("clears a field when the key is explicitly null, leaving other set fields intact (LQ-003 null-clear)", async () => {
    const id = await createLead("Null Clear");
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { temperature: "hot", priority: "high" } });
    // Explicit null clears temperature; priority (absent) is left unchanged.
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { temperature: null } });
    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT temperature, priority FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows[0]!.temperature).toBeNull();
    expect(rows[0]!.priority).toBe("high");
  });

  it("an absent key leaves that field unchanged (only present keys are written)", async () => {
    const id = await createLead("Absent Key");
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { temperature: "warm", segment: "smb" } });
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { segment: "enterprise" } });
    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT temperature, segment FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows[0]!.temperature).toBe("warm"); // absent from 2nd PATCH → unchanged
    expect(rows[0]!.segment).toBe("enterprise");
  });

  it("rejects an invalid temperature with 400", async () => {
    const id = await createLead("Bad Temp");
    const res = await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { temperature: "boiling" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty body with 400", async () => {
    const id = await createLead("Empty");
    const res = await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a negative expected value with 400", async () => {
    const id = await createLead("Neg");
    const res = await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { expectedValueMinor: -1 } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PATCH", `/v1/crm/contacts/${randomUUID()}/classification`, { noAuth: true, payload: { temperature: "hot" } });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("PATCH", `/v1/crm/contacts/${randomUUID()}/classification`, { headers: headers(["citizen"]), payload: { temperature: "hot" } });
    expect(res.statusCode).toBe(403);
  });

  it("does not classify another tenant's lead (cross-tenant no-op)", async () => {
    const id = await createLead("Tenant A Lead");
    // Tenant B attempts to classify Tenant A's lead.
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { headers: headers(["crm_admin"], OTHER), payload: { temperature: "cold" } });
    const rows = (await scoped(TENANT, (tx) => tx`
      SELECT temperature FROM crm.contacts WHERE id = ${id} AND tenant_id = ${TENANT}
    `)) as unknown as Array<Record<string, unknown>>;
    expect(rows[0]!.temperature).toBeNull();
  });
});

describe("GET /v1/crm/contacts classification filters (LQ-003)", () => {
  it("filters by temperature", async () => {
    const hot = await createLead("Hot Lead");
    const cold = await createLead("Cold Lead");
    await call("PATCH", `/v1/crm/contacts/${hot}/classification`, { payload: { temperature: "hot" } });
    await call("PATCH", `/v1/crm/contacts/${cold}/classification`, { payload: { temperature: "cold" } });

    const res = await call("GET", "/v1/crm/contacts?temperature=hot&limit=200");
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).toContain(hot);
    expect(ids).not.toContain(cold);
  });

  it("filters by priority and segment together", async () => {
    const match = await createLead("Match");
    const noMatch = await createLead("No Match");
    await call("PATCH", `/v1/crm/contacts/${match}/classification`, { payload: { priority: "high", segment: "govt" } });
    await call("PATCH", `/v1/crm/contacts/${noMatch}/classification`, { payload: { priority: "low", segment: "govt" } });

    const res = await call("GET", "/v1/crm/contacts?priority=high&segmentName=govt&limit=200");
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).toContain(match);
    expect(ids).not.toContain(noMatch);
  });

  it("returns the classification fields on the contact view", async () => {
    const id = await createLead("View Fields");
    await call("PATCH", `/v1/crm/contacts/${id}/classification`, { payload: { temperature: "warm", expectedValueMinor: 5000 } });
    const res = await call("GET", "/v1/crm/contacts?temperature=warm&limit=200");
    const row = (res.json() as { data: Array<{ id: string; temperature: string | null; expectedValueMinor: string | null }> })
      .data.find((c) => c.id === id);
    expect(row?.temperature).toBe("warm");
    expect(row?.expectedValueMinor).toBe("5000");
  });
});
