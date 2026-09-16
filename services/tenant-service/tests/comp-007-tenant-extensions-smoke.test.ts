/**
 * COMP-007 -- tenant-service `tenant-extensions` module (config, modules,
 * feature-flags, stats, billing -- "routes missing from the core tenant
 * module" per routes.ts's own header) smoke test.
 *
 * Registered as a route only but had zero test references anywhere in the
 * service.
 *
 * TWO REAL BUGS found while writing this test, not fixed here (see PR
 * description):
 *
 * 1. KNOWN ISSUE -- migration gap (this codebase's own recurring pattern;
 *    matches migrations/0007_missing_module_tables.sql's own precedent,
 *    which fixed the identical "declared in Drizzle, no migration ever
 *    created it" gap for plans/subscriptions/settings/quotas -- but never
 *    touched tenant_configs, a different table entirely, per that file's own
 *    closing note "0006_quotas.sql... created an unrelated
 *    tenant.tenant_quotas table -- a different concept, left untouched.").
 *    `tenant/schema.ts` declares `tenantSchema.table("tenant_configs", ...)`,
 *    but no migration anywhere creates it -- confirmed directly: grepping
 *    every migration for it, and `\dt tenant.tenant_configs` against a
 *    freshly bootstrapped disposable Postgres finds nothing (tenant_quotas
 *    DOES exist -- a real, different table these routes ALSO use, only for
 *    /stats). Every route here except GET /stats calls the shared
 *    getOrInitConfig() helper against tenant_configs, so config/modules/
 *    feature-flags/billing all 500 on every real request past the auth
 *    layer.
 *
 * 2. REAL BUG -- GET /v1/tenants/:tenantId/feature-flags's cross-tenant
 *    guard is broken: `if (ctx.tenantId !== req.params && ...)` compares a
 *    string (ctx.tenantId) to req.params, THE WHOLE OBJECT (`{tenantId:
 *    "..."}`), not the destructured tenantId string its two sibling routes
 *    (GET /config, GET /stats) correctly compare against -- a string is
 *    never `!==`-false against an object, so this half of the condition is
 *    always true, and the guard collapses to "must have a PLAT role",
 *    unconditionally, even for a caller reading their OWN tenant's flags.
 *    Confirmed in isolation below: the identical pattern on GET /stats
 *    (compared correctly there) lets a same-tenant non-PLAT caller through
 *    and still 403s a cross-tenant one; feature-flags 403s a same-tenant
 *    non-PLAT caller too, proving the check itself -- not roles or intent --
 *    is what's broken.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tid: string) {
  return signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-tenant-ext" }, SECRET);
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COMP-007: tenant-extensions -- auth layer + the one route not blocked by the migration gap (GET /stats)", () => {
  it("returns 401 without a token", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/stats` });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /modules requires a PLAT role (403 for tenant_admin, which is ADMIN but not PLAT)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/tenants/${tid}/modules`,
      headers: { authorization: `Bearer ${token(["tenant_admin"], tid)}` },
      payload: { modules: { hrms: true } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /billing requires an ADMIN role (403 for a plain staff role)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/billing`,
      headers: { authorization: `Bearer ${token(["staff"], tid)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /billing requires PLAT specifically (403 for tenant_admin even though GET /billing would allow it)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/tenants/${tid}/billing`,
      headers: { authorization: `Bearer ${token(["tenant_admin"], tid)}` },
      payload: { billing: { plan: "annual" } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /stats: a non-PLAT caller CAN read their own tenant's stats (real DB round trip, no quota row -> quotas: null, not an error)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/stats`,
      headers: { authorization: `Bearer ${token(["tenant_admin"], tid)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(tid);
    expect(body.quotas).toBeNull();
    expect(typeof body.timestamp).toBe("string");
  });

  it("GET /stats: the SAME non-PLAT caller is correctly 403'd reading a DIFFERENT tenant's stats", async () => {
    const ownTenant = randomUUID();
    const otherTenant = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${otherTenant}/stats`,
      headers: { authorization: `Bearer ${token(["tenant_admin"], ownTenant)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /stats: a PLAT role CAN read a different tenant's stats (the platform override)", async () => {
    const platTenant = randomUUID();
    const otherTenant = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${otherTenant}/stats`,
      headers: { authorization: `Bearer ${token(["platform_admin"], platTenant)}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("COMP-007: tenant-extensions -- REAL BUG: GET /feature-flags's cross-tenant guard (see file header)", () => {
  it("a non-PLAT caller reading their OWN tenant's flags is incorrectly 403'd (should be allowed, like GET /stats above)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/feature-flags`,
      headers: { authorization: `Bearer ${token(["tenant_admin"], tid)}` },
    });
    // This IS the bug: compare to the equivalent GET /stats test above,
    // which correctly returns 200 for the identical same-tenant/non-PLAT
    // shape. This should also be 200, not 403.
    expect(res.statusCode).toBe(403);
  });

  it("a PLAT caller passes the (accidentally permissive-for-them) guard, then hits the SEPARATE missing-table bug", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/feature-flags`,
      headers: { authorization: `Bearer ${token(["platform_admin"], tid)}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "tenant.tenant_configs" does not exist');
  });
});

describe("COMP-007: tenant-extensions -- KNOWN ISSUE: tenant_configs was never migrated (see file header)", () => {
  it("GET /config 500s for an authorized (PLAT) caller", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/config`,
      headers: { authorization: `Bearer ${token(["platform_admin"], tid)}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "tenant.tenant_configs" does not exist');
  });

  it("PATCH /config, PATCH /modules, GET /billing, and PATCH /feature-flags all 500 the same way for an authorized (PLAT) caller", async () => {
    const tid = randomUUID();
    const plat = { authorization: `Bearer ${token(["platform_admin"], tid)}` };
    for (const [method, url, payload] of [
      ["PATCH", `/v1/tenants/${tid}/config`, { settings: { x: 1 } }],
      ["PATCH", `/v1/tenants/${tid}/modules`, { modules: { hrms: true } }],
      ["GET", `/v1/tenants/${tid}/billing`, undefined],
      ["PATCH", `/v1/tenants/${tid}/feature-flags`, { featureFlags: { beta: true } }],
    ] as const) {
      const res = await app.inject({ method, url, headers: plat, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(500);
    }
  });
});
