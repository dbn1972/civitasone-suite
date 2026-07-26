/**
 * CAP-052 — API catalogue route + persistence integration tests.
 *
 * Hits the live civitas_gateway DB (gateway_svc, NOBYPASSRLS + FORCE RLS) via a
 * real buildApp() + app.inject(). Uses isolated test tenants so seed data is
 * never polluted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/modules/catalogue/db.js";
import { apiEntry, apiChangelog } from "../src/modules/catalogue/schema.js";
import { SERVICE_ROUTES } from "../src/registry.js";
import { versionFromPrefix, registryEntries } from "../src/modules/catalogue/seed.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "ca7a1041-0000-4000-8000-0000000000a1";
const TENANT_B = "ca7a1041-0000-4000-8000-0000000000b2";
const ACTOR = "ac70b111-0000-4000-8000-0000000000c3";

function adminToken(tenantId: string) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["platform_admin"] }, SECRET, 3600);
}
function readerToken(tenantId: string) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["finance_officer"] }, SECRET, 3600);
}
function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function wipe(tenantId: string) {
  await withTenantScope(db as any, tenantId, async (tx: any) => {
    await tx.delete(apiChangelog).where(eq(apiChangelog.tenantId, tenantId));
    await tx.delete(apiEntry).where(eq(apiEntry.tenantId, tenantId));
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await wipe(TENANT_A);
  await wipe(TENANT_B);
});

afterAll(async () => {
  await wipe(TENANT_A);
  await wipe(TENANT_B);
  await app.close();
});

describe("CAP-052 seed helpers (pure)", () => {
  it("derives version labels from route prefixes", () => {
    expect(versionFromPrefix("/api/v1/finance")).toBe("v1");
    expect(versionFromPrefix("/api/identity")).toBe("v1");
    expect(versionFromPrefix("/api/v2/foo")).toBe("v2");
  });
  it("maps every SERVICE_ROUTE to a catalogue entry", () => {
    const entries = registryEntries(TENANT_A, ACTOR);
    expect(entries.length).toBe(SERVICE_ROUTES.length);
    expect(entries.every((e) => e.status === "active" && e.source === "registry")).toBe(true);
  });
});

describe("CAP-052 catalogue routes", () => {
  it("rejects unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue" });
    expect(res.statusCode).toBe(401);
  });

  it("seeds the catalogue from the live route registry (idempotent)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/seed",
      headers: auth(adminToken(TENANT_A)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.total).toBe(SERVICE_ROUTES.length);
    expect(body.data.created).toBe(SERVICE_ROUTES.length);

    // Re-seed: idempotent — nothing newly created.
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/seed",
      headers: auth(adminToken(TENANT_A)),
    });
    expect(res2.json().data.created).toBe(0);
  });

  it("lists seeded APIs (all active)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogue?status=active",
      headers: auth(readerToken(TENANT_A)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(SERVICE_ROUTES.length);
    expect(body.data.every((r: any) => r.status === "active")).toBe(true);
  });

  it("enforces RBAC on register (reader forbidden)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue",
      headers: auth(readerToken(TENANT_A)),
      payload: { name: "reports-export", module: "reports", path: "/api/v1/reports/export", method: "GET" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("registers a new API, then walks it through the lifecycle", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue",
      headers: auth(adminToken(TENANT_A)),
      payload: {
        name: "reports-export",
        module: "reports",
        version: "v1",
        path: "/api/v1/reports/export",
        method: "POST",
        owner: "reporting-team",
        description: "Async report export",
      },
    });
    expect(reg.statusCode).toBe(201);
    const id = reg.json().data.id;
    expect(reg.json().data.status).toBe("draft");

    // duplicate registration → 409
    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue",
      headers: auth(adminToken(TENANT_A)),
      payload: { name: "reports-export", module: "reports", version: "v1", path: "/api/v1/reports/export", method: "POST" },
    });
    expect(dup.statusCode).toBe(409);

    // get one + changelog shows 'registered'
    const got = await app.inject({ method: "GET", url: `/api/v1/catalogue/${id}`, headers: auth(readerToken(TENANT_A)) });
    expect(got.statusCode).toBe(200);
    expect(got.json().changelog.some((c: any) => c.changeType === "registered")).toBe(true);

    // activate (draft → active)
    const act = await app.inject({
      method: "POST",
      url: `/api/v1/catalogue/${id}/lifecycle`,
      headers: auth(adminToken(TENANT_A)),
      payload: { action: "activate" },
    });
    expect(act.json().data.status).toBe("active");

    // deprecate — sets deprecation date + changelog
    const dep = await app.inject({
      method: "POST",
      url: `/api/v1/catalogue/${id}/deprecate`,
      headers: auth(adminToken(TENANT_A)),
      payload: { sunsetDate: "2027-01-01", note: "superseded by v2" },
    });
    expect(dep.statusCode).toBe(200);
    expect(dep.json().data.status).toBe("deprecated");
    expect(dep.json().data.deprecationDate).toBeTruthy();

    // retire (deprecated → retired)
    const ret = await app.inject({
      method: "POST",
      url: `/api/v1/catalogue/${id}/lifecycle`,
      headers: auth(adminToken(TENANT_A)),
      payload: { action: "retire" },
    });
    expect(ret.json().data.status).toBe("retired");

    // retired is terminal — reinstate rejected as INVALID_TRANSITION
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/catalogue/${id}/lifecycle`,
      headers: auth(adminToken(TENANT_A)),
      payload: { action: "reinstate" },
    });
    expect(bad.statusCode).toBe(409);

    // full changelog reflects the whole journey
    const final = await app.inject({ method: "GET", url: `/api/v1/catalogue/${id}`, headers: auth(readerToken(TENANT_A)) });
    const types = final.json().changelog.map((c: any) => c.changeType);
    expect(types).toEqual(expect.arrayContaining(["registered", "activated", "deprecated", "retired"]));
  });

  it("isolates tenants — Tenant B never sees Tenant A's catalogue (RLS)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: auth(readerToken(TENANT_B)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(0);

    // 404 (not 403/200) when B tries to read an A-owned entry by id
    const aList = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: auth(readerToken(TENANT_A)) });
    const someId = aList.json().data[0].id;
    const cross = await app.inject({ method: "GET", url: `/api/v1/catalogue/${someId}`, headers: auth(readerToken(TENANT_B)) });
    expect(cross.statusCode).toBe(404);
  });
});
