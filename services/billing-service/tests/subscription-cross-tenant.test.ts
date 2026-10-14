/**
 * GAP-TENANT-ADMIN-SUBSCRIPTION-06 — cross-tenant isolation of
 * GET /v1/billing/subscriptions, now readable by tenant_admin / billing_admin.
 * Real Postgres as the non-superuser service role (FORCE RLS), real Fastify:
 * a tenant admin of tenant A gets ONLY A's subscription; naming tenant B in the
 * query, a header or the path never returns B's data. billing_admin is scoped the same way.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "c1000000-0000-4000-8000-0000000000a1";
const TENANT_B = "c1000000-0000-4000-8000-0000000000b2";
const TENANT_C = "c1000000-0000-4000-8000-0000000000c3"; // no subscription
const ACTOR = "c1000000-0000-4000-8000-0000000000ac";
const SUB_A = randomUUID();
const SUB_B = randomUUID();
const PLAN_A = randomUUID();
const PLAN_B = randomUUID();

const hdr = (tid: string, roles: string[], extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-xt" }, SECRET, 3600)}`,
  ...extra,
});

async function asTenant<R>(tenant: string, fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
async function wipe() {
  for (const t of [TENANT_A, TENANT_B]) await asTenant(t, async (q) => { await q`DELETE FROM subscriptions.billing_subscriptions WHERE tenant_id = ${t}`; });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await wipe();
  await asTenant(TENANT_A, async (q) => {
    await q`INSERT INTO subscriptions.billing_subscriptions (id, tenant_id, plan_id, status, created_by, updated_by) VALUES (${SUB_A}, ${TENANT_A}, ${PLAN_A}, 'active', ${ACTOR}, ${ACTOR})`;
  });
  await asTenant(TENANT_B, async (q) => {
    await q`INSERT INTO subscriptions.billing_subscriptions (id, tenant_id, plan_id, status, created_by, updated_by) VALUES (${SUB_B}, ${TENANT_B}, ${PLAN_B}, 'suspended', ${ACTOR}, ${ACTOR})`;
  });
});
afterAll(async () => { await wipe(); await app.close(); });

const get = (url: string, tid: string, roles: string[], extra: Record<string, string> = {}) =>
  app.inject({ method: "GET", url, headers: hdr(tid, roles, extra) });

describe.each([["tenant_admin"], ["billing_admin"]])("GET /v1/billing/subscriptions as %s of tenant A", (role) => {
  it("returns only tenant A's subscription", async () => {
    const res = await get("/v1/billing/subscriptions", TENANT_A, [role]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: SUB_A, plan: PLAN_A, status: "active" });
  });

  it("naming tenant B in the query string (any spelling) never returns B's data", async () => {
    for (const qs of [`tenantId=${TENANT_B}`, `tenant_id=${TENANT_B}`, `tid=${TENANT_B}`, `id=${SUB_B}`]) {
      const res = await get(`/v1/billing/subscriptions?${qs}`, TENANT_A, [role]);
      expect(res.statusCode, qs).toBe(200);
      const body = res.json();
      expect(body.id, qs).toBe(SUB_A);
      expect(JSON.stringify(body), qs).not.toContain(SUB_B);
      expect(JSON.stringify(body), qs).not.toContain(PLAN_B);
    }
  });

  it("a tenant header naming B is ignored (the token's tenant wins)", async () => {
    const res = await get("/v1/billing/subscriptions", TENANT_A, [role], { "x-tenant-id": TENANT_B });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(SUB_A);
  });

  it("the by-tenant-id path route stays super-admin only: B's subscription is not reachable", async () => {
    const res = await get(`/v1/billing/tenants/${TENANT_B}/subscription`, TENANT_A, [role]);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(SUB_B);
  });

  it("a tenant with no subscription gets null, not another tenant's row", async () => {
    const res = await get(`/v1/billing/subscriptions?tenantId=${TENANT_A}`, TENANT_C, [role]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

describe("tenant B's own admin sees B's subscription (status suspended)", () => {
  it("returns B's row and not A's", async () => {
    const res = await get(`/v1/billing/subscriptions?tenantId=${TENANT_A}`, TENANT_B, ["tenant_admin"]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: SUB_B, status: "suspended" });
    expect(res.body).not.toContain(SUB_A);
  });
});
