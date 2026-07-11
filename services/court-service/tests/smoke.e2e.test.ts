/**
 * court-service — end-to-end smoke test (REAL Postgres, assembled app).
 *
 * Unlike the module unit tests (which mock shared/db), this boots the ACTUAL
 * Fastify app via buildApp() and drives it with app.inject(), against a real
 * civitas_court database reached as the least-privileged court_svc role. It
 * proves the whole HTTP stack assembles and that RLS tenant isolation holds
 * THROUGH THE REAL REQUEST PATH — auth plugin → per-request app.tenant_id GUC
 * hook (createTenantTxHook) → RLS-scoped repo read — not just at raw SQL.
 *
 * Opt-in only: runs when COURT_E2E=1 and a real DATABASE_URL/JWT_SECRET/PII key
 * are present. The default `vitest run` skips it (the DB is mocked there), so
 * this never destabilises the unit suite.
 *
 * Strict by design: we assert exact success/deny outcomes. We deliberately do
 * NOT accept HTTP 500 as a pass (a 500 means the tenant GUC was not configured
 * and RLS was never exercised — that would be a false green).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const ACTOR_A = "1111aaaa-1111-4111-8111-111111111111";
const ACTOR_B = "2222bbbb-2222-4222-8222-222222222222";
const SEED_COURT_ID = "5eed0000-0000-4000-8000-000000000e2e";

function token(tenantId: string, actorId: string, roles: string[] = ["court_admin"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-e2e" }, SECRET, 3600);
}

let app: FastifyInstance;

describe.skipIf(!RUN)("court-service e2e smoke (real DB, RLS through HTTP)", () => {
  beforeAll(async () => {
    app = await buildApp();
    // Seed one court for tenant A directly (as court_svc, GUC-scoped so the
    // FORCE-RLS WITH CHECK accepts it). This is the row tenant B must never see.
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type)
                values (${SEED_COURT_ID}, ${TENANT_A}, ${"E2E Smoke Court"}, ${"revenue"})
                on conflict (id) do nothing`;
    });
  });

  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      await sql`delete from court.courts where id = ${SEED_COURT_ID}`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("boots and serves /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an unauthenticated read (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/court/courts" });
    expect(res.statusCode).toBe(401);
  });

  it("tenant A sees its seeded court through the full HTTP+RLS path", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/courts",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string }>;
    expect(items.some((c) => c.id === SEED_COURT_ID)).toBe(true);
  });

  it("tenant B does NOT see tenant A's court (RLS enforced via the request path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/courts",
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200); // 200 with zero leak — NOT a tolerated 500
    const items = res.json().items as Array<{ id: string; tenantId?: string }>;
    expect(items.some((c) => c.id === SEED_COURT_ID)).toBe(false);
    expect(items.some((c) => c.tenantId === TENANT_A)).toBe(false);
  });

  it("accepts a well-formed create as court_admin (202 → command bus)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/court/courts",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { name: "E2E Created Court", courtType: "revenue" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("denies a create from a read-only role (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/court/courts",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A, ["court_clerk"])}`, "content-type": "application/json" },
      payload: { name: "Should Fail", courtType: "revenue" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps the drizzle handle importable (sanity)", () => {
    expect(db).toBeDefined();
  });
});
