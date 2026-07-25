/**
 * CAP-091 — central-config route integration tests (admin-service).
 *
 * Exercises the governed lifecycle against a real Postgres with RLS:
 *   propose → approve (maker-checker + versioning) → version history
 *   → sensitive values encrypted at rest → reject → RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

// Set the config encryption key BEFORE buildApp so configKey() sees it.
process.env.CONFIG_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-dddd-4000-8000-0000000000c1";
const OTHER_TENANT = "cccccccc-dddd-4000-8000-0000000000c2";
const PROPOSER = "11111111-cccc-4000-8000-000000000001";
const APPROVER = "22222222-cccc-4000-8000-000000000002";

function token(actorId: string, roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-cc" }, SECRET, 3600);
}
function auth(actorId: string, roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(actorId, roles, tenantId)}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

function readAsTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function propose(body: Record<string, unknown>, actor = PROPOSER, tenantId = TENANT): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/central-config/changes",
    headers: auth(actor, ["tenant_admin"], tenantId), payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("central-config — auth", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/central-config" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a non-admin role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/central-config", headers: auth(PROPOSER, ["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("central-config — propose + maker-checker approve", () => {
  const key = `feature.timeout_ms.${Date.now()}`;

  it("proposes a change (status pending)", async () => {
    const id = await propose({ key, value: 3000, description: "request timeout" });
    const list = await app.inject({ method: "GET", url: "/v1/admin/central-config/changes?status=pending", headers: auth(APPROVER) });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<{ id: string; status: string }>;
    expect(rows.find((r) => r.id === id)?.status).toBe("pending");
  });

  it("BLOCKS the proposer from approving their own change (maker-checker)", async () => {
    const id = await propose({ key: `${key}.self`, value: 1 });
    const res = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(PROPOSER), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("a distinct approver applies the value and versions it", async () => {
    const id = await propose({ key: `${key}.apply`, value: 5000 });
    const res = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "approved", version: 1 });

    const entries = await app.inject({ method: "GET", url: "/v1/admin/central-config", headers: auth(APPROVER) });
    const row = (entries.json().data as Array<{ key: string; value: unknown; version: number }>).find((r) => r.key === `${key}.apply`);
    expect(row?.value).toBe(5000);
    expect(row?.version).toBe(1);
  });

  it("a second approved change to the same key bumps the version and appends history", async () => {
    const k = `${key}.v2`;
    const id1 = await propose({ key: k, value: "one" });
    await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id1}/approve`, headers: auth(APPROVER), payload: {} });
    const id2 = await propose({ key: k, value: "two" });
    const r2 = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id2}/approve`, headers: auth(APPROVER), payload: {} });
    expect(r2.json().version).toBe(2);

    const hist = await app.inject({ method: "GET", url: `/v1/admin/central-config/${encodeURIComponent(k)}/versions`, headers: auth(APPROVER) });
    const versions = hist.json().data as Array<{ version: number; value: unknown }>;
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions.find((v) => v.version === 1)?.value).toBe("one");
    expect(versions.find((v) => v.version === 2)?.value).toBe("two");
  });
});

describe("central-config — sensitive values are encrypted at rest", () => {
  it("stores ciphertext (not plaintext) and masks it on read", async () => {
    const k = `secret.api_key.${Date.now()}`;
    const id = await propose({ key: k, value: "sk-live-SUPERSECRET", sensitive: true });
    await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });

    // Raw DB value must NOT contain the plaintext secret.
    const raw = await readAsTenant(TENANT, (sql) => sql<Array<{ value: unknown; encrypted: boolean }>>`
      SELECT value, encrypted FROM central_config.config_entries WHERE tenant_id = ${TENANT} AND key = ${k}`);
    expect(raw[0]?.encrypted).toBe(true);
    expect(JSON.stringify(raw[0]?.value)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(raw[0]?.value)).toContain("v1:");

    // API read masks the value.
    const entries = await app.inject({ method: "GET", url: "/v1/admin/central-config", headers: auth(APPROVER) });
    const row = (entries.json().data as Array<{ key: string; value: unknown; sensitive: boolean }>).find((r) => r.key === k);
    expect(row?.sensitive).toBe(true);
    expect(row?.value).toBe("***");
  });
});

describe("central-config — reject", () => {
  it("rejects a pending change and blocks a re-decision", async () => {
    const id = await propose({ key: `reject.me.${Date.now()}`, value: 1 });
    const rej = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/reject`, headers: auth(APPROVER), payload: { reason: "not needed" } });
    expect(rej.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("NOT_PENDING");
  });
});

describe("central-config — RLS tenant isolation", () => {
  it("another tenant cannot see this tenant's entries", async () => {
    const k = `iso.key.${Date.now()}`;
    const id = await propose({ key: k, value: 42 });
    await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });

    const other = await app.inject({ method: "GET", url: "/v1/admin/central-config", headers: auth(PROPOSER, ["tenant_admin"], OTHER_TENANT) });
    const keys = (other.json().data as Array<{ key: string }>).map((r) => r.key);
    expect(keys).not.toContain(k);
  });
});
