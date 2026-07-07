/**
 * Cross-Tenant Isolation Integration Test — Gateway Service
 *
 * Validates: Requirements 1.5, 1.6
 *
 * The gateway holds no tenant-scoped database rows itself (it is a stateless
 * proxy), so the "Tenant A creates a resource, Tenant B reads/updates/deletes
 * it → 0 rows / 404" pattern used by the 31 DB-backed services doesn't apply
 * verbatim here. Instead this test targets the gateway's own tenant-scoped
 * in-memory state and forwarding behavior — the places a cross-tenant leak
 * could actually occur at this layer:
 *
 *   1. The module-enablement cache (module-guard.ts) is keyed by tenantId.
 *      A cache-key collision would let Tenant B inherit Tenant A's enabled
 *      modules (equivalent to a 200-with-other-tenant's-data leak).
 *   2. The JWT edge verifier injects x-tenant-id from the token's `tid` claim
 *      per request — concurrent requests from different tenants must never
 *      have their tenant context swapped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { _test as moduleGuardTest } from "../src/module-guard.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function tokenFor(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["finance_officer", "hrms_officer"] }, SECRET, 3600);
}

let lastUpstreamHeaders: Record<string, string> = {};

beforeEach(() => {
  moduleGuardTest.moduleCache.clear();
  lastUpstreamHeaders = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  moduleGuardTest.moduleCache.clear();
});

describe("Gateway — Cross-Tenant Isolation", () => {
  it("module cache is isolated per tenant — Tenant B never inherits Tenant A's cache entry", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes(`/tenants/${TENANT_A}/modules-list`)) {
        return new Response(JSON.stringify({ data: [{ name: "finance" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes(`/tenants/${TENANT_B}/modules-list`)) {
        return new Response(JSON.stringify({ data: [{ name: "hrms" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: { authorization: `Bearer ${tokenFor(TENANT_A, "actor-a")}`, "x-tenant-id": TENANT_A },
    });
    await app.inject({
      method: "GET",
      url: "/api/v1/hrms/employees",
      headers: { authorization: `Bearer ${tokenFor(TENANT_B, "actor-b")}`, "x-tenant-id": TENANT_B },
    });

    const cacheA = moduleGuardTest.moduleCache.get(TENANT_A);
    const cacheB = moduleGuardTest.moduleCache.get(TENANT_B);
    expect(cacheA?.modules.has("finance")).toBe(true);
    expect(cacheA?.modules.has("hrms")).toBe(false);
    expect(cacheB?.modules.has("hrms")).toBe(true);
    expect(cacheB?.modules.has("finance")).toBe(false);
  });

  it("Tenant B is denied a module enabled only for Tenant A (403 MODULE_DISABLED, not silent passthrough)", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes(`/tenants/${TENANT_A}/modules-list`)) {
        return new Response(JSON.stringify({ data: [{ name: "finance" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes(`/tenants/${TENANT_B}/modules-list`)) {
        // Tenant B has no modules enabled at all
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = await buildApp();
    // Prime the cache with Tenant A's entitlement, then request as Tenant B on the same module.
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: { authorization: `Bearer ${tokenFor(TENANT_A, "actor-a")}`, "x-tenant-id": TENANT_A },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: { authorization: `Bearer ${tokenFor(TENANT_B, "actor-b")}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MODULE_DISABLED");
  });

  it("concurrent requests from different tenants never swap x-tenant-id when forwarded upstream", async () => {
    const seenByCorrelation: Record<string, string | undefined> = {};
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) ?? {};
      seenByCorrelation[headers["x-correlation-id"] as string] = headers["x-tenant-id"];
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = await buildApp();
    await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/queue/status",
        headers: {
          authorization: `Bearer ${tokenFor(TENANT_A, "actor-a")}`,
          "x-tenant-id": TENANT_A,
          "x-correlation-id": "corr-a",
        },
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/queue/status",
        headers: {
          authorization: `Bearer ${tokenFor(TENANT_B, "actor-b")}`,
          "x-tenant-id": TENANT_B,
          "x-correlation-id": "corr-b",
        },
      }),
    ]);

    expect(seenByCorrelation["corr-a"]).toBe(TENANT_A);
    expect(seenByCorrelation["corr-b"]).toBe(TENANT_B);
  });
});
