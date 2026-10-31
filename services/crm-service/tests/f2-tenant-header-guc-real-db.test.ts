/**
 * F2 (UAT bundle 10) -- REAL Postgres: the per-request RLS GUC comes from the
 * VERIFIED tenant, never from a raw x-tenant-id header.
 *
 * crm-service is one of the services whose app.ts relies solely on
 * createTenantTxHook for the request GUC (no extra ctx-tenant hook), so before
 * the fix a request sent straight to the service (bypassing the gateway, which
 * overwrites the header with the verified tid) could carry a valid tenant-A
 * token plus `x-tenant-id: <B>` and have RLS scope every bare db.transaction()
 * to tenant B.
 *
 * The probe app below is wired exactly like crm's app.ts (real authPlugin, then
 * createTenantTxHook(db) with crm's real tenant-aware db, connected as the
 * NOBYPASSRLS crm_svc role) and exposes one read with NO app-layer tenant
 * WHERE -- the "WHERE accidentally omitted" case RLS exists to backstop. So
 * the rows it returns are exactly what RLS lets the request see.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { authPlugin } from "@civitasone/auth/plugin";
import { createTenantTxHook, runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const PIPE_A = randomUUID();
const PIPE_B = randomUUID();
const STAGES = JSON.stringify([{ name: "s1" }, { name: "s2" }, { name: "s3" }]);
// Generated per run: the x-internal path needs a configured secret, and no literal ships here.
const INTERNAL_SECRET = randomBytes(24).toString("hex");

const bearer = (tid: string) => `Bearer ${signToken({ sub: ACTOR, tid, roles: ["crm_user"], sid: "s-f2" }, SECRET)}`;

/** Bare read, no tenant predicate: only RLS (driven by the request GUC) decides what comes back. */
async function visibleTenants(): Promise<string[]> {
  const rows = (await db.transaction(async (tx) =>
    tx.execute(sql`select tenant_id::text as tenant_id from crm.pipelines where id in (${PIPE_A}, ${PIPE_B}) order by tenant_id`),
  )) as unknown as Array<{ tenant_id: string }>;
  return rows.map((r) => r.tenant_id);
}

let app: FastifyInstance;
let savedInternalSecret: string | undefined;

async function seed(tenantId: string, id: string): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`insert into crm.pipelines (id, tenant_id, name, stages, created_by, updated_by)
             values (${id}, ${tenantId}, ${"F2 probe " + id.slice(0, 8)}, ${STAGES}::jsonb, ${ACTOR}, ${ACTOR})`;
  });
}

beforeAll(async () => {
  savedInternalSecret = process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = INTERNAL_SECRET;
  await seed(TENANT_A, PIPE_A);
  await seed(TENANT_B, PIPE_B);
  app = Fastify();
  await app.register(authPlugin);
  app.addHook("onRequest", createTenantTxHook(db));
  app.get("/v1/f2-probe", async () => ({ tenants: await visibleTenants() }));
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const [tid, id] of [[TENANT_A, PIPE_A], [TENANT_B, PIPE_B]] as const) {
    await sqlClient.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tid}, true)`;
      await tx`delete from crm.pipelines where id = ${id}`;
    });
  }
  if (savedInternalSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = savedInternalSecret;
  await sqlClient.end();
});

const probe = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/f2-probe", headers });

describe("F2: request RLS GUC follows the verified tenant (real DB, crm_svc NOBYPASSRLS)", () => {
  it("a tenant-A token with x-tenant-id of tenant B never reads B's rows (header ignored, GUC stays A)", async () => {
    const res = await probe({ authorization: bearer(TENANT_A), "x-tenant-id": TENANT_B });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenants).toEqual([TENANT_A]);
    expect(res.body).not.toContain(TENANT_B);
  });

  it("a tenant-A token with no header sees only tenant A (GUC from the verified tid)", async () => {
    const res = await probe({ authorization: bearer(TENANT_A) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenants).toEqual([TENANT_A]);
  });

  it("a matching header (the gateway path) still works and sees only that tenant", async () => {
    const res = await probe({ authorization: bearer(TENANT_B), "x-tenant-id": TENANT_B });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenants).toEqual([TENANT_B]);
  });

  it("x-internal with the service secret: the tenant header is authoritative", async () => {
    const res = await probe({ "x-internal": "1", "x-service-secret": INTERNAL_SECRET, "x-tenant-id": TENANT_B });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenants).toEqual([TENANT_B]);
  });

  it("x-internal with a wrong secret is refused before any tenant is trusted", async () => {
    const res = await probe({ "x-internal": "1", "x-service-secret": randomBytes(24).toString("hex"), "x-tenant-id": TENANT_B });
    expect(res.statusCode).toBe(401);
  });

  it("worker path: runWithTenant from the message envelope scopes the GUC, no hook involved", async () => {
    expect(await runWithTenant(TENANT_B, () => visibleTenants())).toEqual([TENANT_B]);
    expect(await runWithTenant(TENANT_A, () => visibleTenants())).toEqual([TENANT_A]);
  });
});
