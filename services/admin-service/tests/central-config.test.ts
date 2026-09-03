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
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_central_config_Consumers } = await import("../src/modules/central-config/f3-consumer.js");

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

function readAsTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

/**
 * Test-hygiene fix: this file previously created rows with `Date.now()`-suffixed
 * keys and never removed them, so `central_config.config_entries` grew by a
 * handful of rows on every run and NOTHING ever reclaimed them.
 *
 * That eventually breaks the encryption test deterministically, not randomly:
 * `GET /v1/admin/central-config` orders by `key` and defaults to `limit=200`, so
 * once this tenant accumulated more than 200 entries the freshly created
 * `secret.api_key.<ts>` row — which sorts late alphabetically — fell off the
 * first page and `.find()` returned undefined. The suite had crossed 220 rows.
 *
 * Every other test file in this service wipes its own tenants; this one did not.
 * Wiping on both sides makes the file self-contained and order-independent.
 */
async function wipe(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await readAsTenant(t, async (sql) => {
      await sql`DELETE FROM central_config.config_versions WHERE tenant_id = ${t}`;
      await sql`DELETE FROM central_config.config_change_requests WHERE tenant_id = ${t}`;
      await sql`DELETE FROM central_config.config_entries WHERE tenant_id = ${t}`;
    });
  }
}

beforeAll(async () => {
  // propose/approve/reject were converted to F3 async (202); the consumer
  // that applies them only runs in src/worker.ts in production, so register
  // it here against the real queue singleton buildApp() wires the routes
  // through — same pattern as tests/data-correction.test.ts.
  registerF3_central_config_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

async function propose(body: Record<string, unknown>, actor = PROPOSER, tenantId = TENANT): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/central-config/changes",
    headers: auth(actor, ["tenant_admin"], tenantId), payload: body,
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  // central-config/f3-apply.ts's apply_central_config_0 (propose) never
  // forwards the route-generated id into repo.insertChange() — the DB
  // assigns its own id (schema default), so the id echoed in the 202 response
  // does NOT match the persisted row. Same class of bug already documented in
  // tests/integration-ops.test.ts for a different module (real, pre-existing,
  // out of this batch's scope) — worked around the same way: look the real id
  // up by content (key) instead of trusting the echo.
  const list = await app.inject({
    method: "GET", url: "/v1/admin/central-config/changes?status=pending",
    headers: auth(actor, ["tenant_admin"], tenantId),
  });
  const rows = list.json().data as Array<{ id: string; key: string }>;
  const match = rows.find((r) => r.key === (body.key as string));
  if (!match) throw new Error(`proposed change for key '${body.key}' never landed`);
  return match.id;
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

  // GAP (not a stale-status-code issue, left unfixed): central-config/routes.ts'
  // approve endpoint has no synchronous pre-accept maker-checker check — unlike
  // integration-settings/routes.ts (fixed by PR #920) — so a self-approval is
  // accepted (202) here and only silently rejected later inside the async
  // consumer (central-config/f3-apply.ts's apply_central_config_1). The caller
  // has no way to observe the 409 MAKER_CHECKER_VIOLATION the pre-conversion
  // route used to return synchronously. Same gap as
  // tests/data-correction.test.ts's "blocks the proposer..." test.
  it("BLOCKS the proposer from approving their own change (maker-checker)", async () => {
    const id = await propose({ key: `${key}.self`, value: 1 });
    const res = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(PROPOSER), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("a distinct approver applies the value and versions it", async () => {
    const id = await propose({ key: `${key}.apply`, value: 5000 });
    const res = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(res.statusCode).toBe(202);
    // 202 command-acknowledgement envelope — "approved"/version only exist
    // once the async consumer applies the write; verified below via the real
    // persisted entry instead of the synchronous response body.
    expect(res.json().status).toBe("accepted");
    await (queue as any).drain?.();

    const entries = await app.inject({ method: "GET", url: "/v1/admin/central-config", headers: auth(APPROVER) });
    const row = (entries.json().data as Array<{ key: string; value: unknown; version: number }>).find((r) => r.key === `${key}.apply`);
    expect(row?.value).toBe(5000);
    expect(row?.version).toBe(1);
  });

  it("a second approved change to the same key bumps the version and appends history", async () => {
    const k = `${key}.v2`;
    const id1 = await propose({ key: k, value: "one" });
    const a1 = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id1}/approve`, headers: auth(APPROVER), payload: {} });
    expect(a1.statusCode).toBe(202);
    // Land the first approve (version 1) before proposing the second change,
    // whose approve needs to read the entry at its post-first-approve version.
    await (queue as any).drain?.();
    const id2 = await propose({ key: k, value: "two" });
    const r2 = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id2}/approve`, headers: auth(APPROVER), payload: {} });
    expect(r2.statusCode).toBe(202);
    await (queue as any).drain?.();

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
    const approve = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(approve.statusCode).toBe(202);
    await (queue as any).drain?.();

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
    expect(rej.statusCode).toBe(200); // reject sends a bare 200, unlike propose/approve — not converted to 202
    await (queue as any).drain?.();
    // GAP (not a stale-status-code issue, left unfixed — see the maker-checker
    // test above): re-approving an already-rejected change is accepted (202)
    // here too — the NOT_PENDING conflict is only enforced inside the async
    // consumer, same missing-synchronous-pre-validation gap.
    const again = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("NOT_PENDING");
  });
});

describe("central-config — RLS tenant isolation", () => {
  it("another tenant cannot see this tenant's entries", async () => {
    const k = `iso.key.${Date.now()}`;
    const id = await propose({ key: k, value: 42 });
    const approve = await app.inject({ method: "POST", url: `/v1/admin/central-config/changes/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(approve.statusCode).toBe(202);
    await (queue as any).drain?.();

    const other = await app.inject({ method: "GET", url: "/v1/admin/central-config", headers: auth(PROPOSER, ["tenant_admin"], OTHER_TENANT) });
    const keys = (other.json().data as Array<{ key: string }>).map((r) => r.key);
    expect(keys).not.toContain(k);
  });
});
