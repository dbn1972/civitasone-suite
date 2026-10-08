/**
 * COMP-007 -- tenant-service `tenant-extensions` module (config, modules,
 * feature-flags, stats, billing -- "routes missing from the core tenant
 * module" per routes.ts's own header) smoke test.
 *
 * Registered as a route only but had zero test references anywhere in the
 * service.
 *
 * Two real bugs were found while writing this test:
 *
 * 1. (FIXED -- migration 0029_tenant_configs.sql.) `tenant/schema.ts` declares
 *    `tenantSchema.table("tenant_configs", ...)` but no migration ever created
 *    it, so config / modules / feature-flags / billing answered 500
 *    (`relation "tenant.tenant_configs" does not exist`) on every real request
 *    past the auth layer; this file used to assert that 500. It now asserts the
 *    real round trip. (tenant_quotas, the table /stats reads, always existed.)
 *
 * 2. (STILL OPEN, pinned below as-is.) GET /v1/tenants/:tenantId/feature-flags's
 *    cross-tenant guard is broken: `if (ctx.tenantId !== req.params && ...)`
 *    compares a string (ctx.tenantId) to req.params, THE WHOLE OBJECT
 *    (`{tenantId: "..."}`), not the destructured tenantId string its two sibling
 *    routes (GET /config, GET /stats) correctly compare against -- a string is
 *    never `!==`-false against an object, so this half of the condition is always
 *    true, and the guard collapses to "must have a PLAT role", unconditionally,
 *    even for a caller reading their OWN tenant's flags. Confirmed in isolation
 *    below: the identical pattern on GET /stats (compared correctly there) lets a
 *    same-tenant non-PLAT caller through and still 403s a cross-tenant one;
 *    feature-flags 403s a same-tenant non-PLAT caller too, proving the check
 *    itself -- not roles or intent -- is what's broken.
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

describe("COMP-007: tenant-extensions -- auth layer + GET /stats", () => {
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

describe("COMP-007: tenant-extensions -- OPEN BUG: GET /feature-flags's cross-tenant guard (see file header)", () => {
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

  it("a PLAT caller passes the (accidentally permissive-for-them) guard and reads the default, empty flags from tenant_configs", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/feature-flags`,
      headers: { authorization: `Bearer ${token(["platform_admin"], tid)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: tid, featureFlags: {} });
  });
});

describe("COMP-007: tenant-extensions -- tenant_configs round trip (0029_tenant_configs.sql)", () => {
  const plat = (tid: string) => ({ authorization: `Bearer ${token(["platform_admin"], tid)}` });
  const admin = (tid: string) => ({ authorization: `Bearer ${token(["tenant_admin"], tid)}` });

  it("GET /config lazily creates the tenant's row with empty modules / flags / billing", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/config`, headers: plat(tid) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tenantId: tid, modules: {}, featureFlags: {}, billing: {} });

    // The row now exists: a second read returns the same persisted shape.
    const again = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/config`, headers: plat(tid) });
    expect(again.json()).toMatchObject({ tenantId: tid, modules: {}, featureFlags: {}, billing: {} });
  });

  it("PATCH /modules merges into the stored modules and is visible via GET /config", async () => {
    const tid = randomUUID();
    expect((await app.inject({ method: "PATCH", url: `/v1/tenants/${tid}/modules`, headers: plat(tid), payload: { modules: { hrms: true } } })).statusCode).toBe(202);
    expect((await app.inject({ method: "PATCH", url: `/v1/tenants/${tid}/modules`, headers: plat(tid), payload: { modules: { finance: false } } })).statusCode).toBe(202);

    const cfg = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/config`, headers: plat(tid) });
    expect(cfg.json().modules).toEqual({ hrms: true, finance: false });
  });

  it("PATCH /feature-flags merges, and GET /feature-flags returns the merged flags", async () => {
    const tid = randomUUID();
    await app.inject({ method: "PATCH", url: `/v1/tenants/${tid}/feature-flags`, headers: plat(tid), payload: { featureFlags: { beta: true } } });
    await app.inject({ method: "PATCH", url: `/v1/tenants/${tid}/feature-flags`, headers: plat(tid), payload: { featureFlags: { newUi: true, beta: false } } });

    const res = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/feature-flags`, headers: plat(tid) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: tid, featureFlags: { beta: false, newUi: true } });
  });

  it("PATCH /billing (PLAT) is readable by a tenant_admin via GET /billing", async () => {
    const tid = randomUUID();
    const patch = await app.inject({ method: "PATCH", url: `/v1/tenants/${tid}/billing`, headers: plat(tid), payload: { billing: { plan: "annual", seats: 25 } } });
    expect(patch.statusCode).toBe(202);

    const res = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/billing`, headers: admin(tid) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: tid, billing: { plan: "annual", seats: 25 } });
  });

  it("PATCH /config (tenant_admin) replaces the sections it is given and keeps the rest", async () => {
    const tid = randomUUID();
    await app.inject({ method: "PATCH", url: `/v1/tenants/${tid}/modules`, headers: plat(tid), payload: { modules: { hrms: true } } });
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/tenants/${tid}/config`,
      headers: admin(tid),
      payload: { featureFlags: { beta: true } },
    });
    expect(patch.statusCode).toBe(202);

    const cfg = await app.inject({ method: "GET", url: `/v1/tenants/${tid}/config`, headers: admin(tid) });
    expect(cfg.json()).toMatchObject({ modules: { hrms: true }, featureFlags: { beta: true } });
  });

  it("is tenant-isolated: a tenant_admin cannot read another tenant's config", async () => {
    const own = randomUUID();
    const other = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${other}/config`, headers: admin(own) });
    expect(res.statusCode).toBe(403);
  });
});
