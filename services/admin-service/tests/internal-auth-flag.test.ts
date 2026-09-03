/**
 * Defense-in-depth regression tests (follow-up to gateway-service#986).
 *
 * The two internal-caller endpoints below used to treat "a valid
 * x-internal-secret header is present" as sufficient proof of a genuine
 * machine-to-machine caller, skipping the normal user-role check entirely.
 * That was unsound: PR #986 showed the gateway could attach a real
 * x-internal-secret to every proxied client request, not just genuine
 * internal calls — so an authenticated NON-ADMIN user's own request (which
 * always carries a real Bearer JWT, since @civitasone/auth's global
 * authPlugin gates every route before a handler ever runs) could reach these
 * routes with a real secret attached and skip the role check entirely. Both
 * routes now also require the explicit `x-internal: "1"` flag — the same
 * pattern already used correctly by policy-service and crm-service — before
 * treating the caller as trusted-internal.
 *
 *   - GET /v1/admin/tenants/:id/modules-list
 *   - GET /v1/admin/composition/internal/:tenantId/modules
 *
 * Each route is exercised against three cases (mirroring the exact PR #986
 * exploit shape — a real, authenticated, NON-ADMIN Bearer JWT is present in
 * every case, since authPlugin's onRequest hook 401s any request lacking
 * both a Bearer token and the full x-internal:1+x-tenant-id+x-service-secret
 * elevation contract before the route handler is ever reached):
 *   (a) secret only, no flag       → falls through to normal role auth (denied for non-admin)
 *   (b) secret AND flag            → genuine internal-caller signal still bypasses role auth
 *   (c) flag only, no valid secret → still rejected (the flag alone is not trustworthy)
 *
 * A fourth scenario additionally proves the real machine-to-machine shape
 * (no user JWT at all, using the same x-internal:1+x-tenant-id+x-service-secret
 * contract authPlugin already grants elevation for) still reaches the route
 * and succeeds, confirming genuine internal callers are unaffected.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const INTERNAL_SECRET = "int3rnal-shared-secret-for-tests";
const TENANT = "aaaaaaaa-bbbb-4000-8000-000000000f01";
const ACTOR = "00000000-bbbb-4000-8000-000000000f02";

function nonAdminAuth() {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "s" }, JWT_SECRET, 3600)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

beforeEach(() => { vi.stubEnv("INTERNAL_SERVICE_SECRET", INTERNAL_SECRET); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /v1/admin/tenants/:id/modules-list — internal-caller authz", () => {
  const url = `/v1/admin/tenants/${TENANT}/modules-list`;

  it("(a) secret only, no x-internal flag, non-admin JWT → falls through to normal role auth and is denied", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal-secret": INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(403);
  });

  it("(b) secret AND x-internal:1 flag, non-admin JWT → the internal-caller signal still bypasses role auth", async () => {
    // Same non-admin actor as (a) — only the explicit x-internal flag differs.
    // This isolates exactly the code path this PR changed: isValidInternal
    // now requires the flag, and when it's present + the secret is valid, the
    // route still treats the caller as trusted-internal regardless of role.
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal-secret": INTERNAL_SECRET, "x-internal": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("(b-machine) pure machine-to-machine call (no user JWT), using the full x-internal:1 + x-tenant-id + x-service-secret elevation contract, still succeeds", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: {
        "x-internal": "1",
        "x-tenant-id": TENANT,
        "x-service-secret": INTERNAL_SECRET,
        "x-internal-secret": INTERNAL_SECRET,
        "x-internal-caller": "gateway-module-guard",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("(c) x-internal:1 flag only, no valid secret, non-admin JWT → not treated as internal, normal role auth still denies", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal": "1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("(c-alt) x-internal:1 flag + WRONG secret, non-admin JWT → not treated as internal, normal role auth still denies", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal": "1", "x-internal-secret": "not-the-real-secret" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/composition/internal/:tenantId/modules — internal-caller authz", () => {
  const url = `/v1/admin/composition/internal/${TENANT}/modules`;

  it("(a) secret only, no x-internal flag, non-admin JWT → falls through to normal role auth and is denied", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal-secret": INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(403);
  });

  it("(b) secret AND x-internal:1 flag, non-admin JWT → the internal-caller signal still bypasses role auth", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal-secret": INTERNAL_SECRET, "x-internal": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("configured");
  });

  it("(b-machine) pure machine-to-machine call (no user JWT), matching gateway module-guard's real composition-mode contract, still succeeds", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: {
        "x-internal": "1",
        "x-tenant-id": TENANT,
        "x-service-secret": INTERNAL_SECRET,
        "x-internal-caller": "gateway-module-guard",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("configured");
  });

  it("(c) x-internal:1 flag only, no valid secret, non-admin JWT → not treated as internal, normal role auth still denies", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal": "1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("(c-alt) x-internal:1 flag + WRONG secret, non-admin JWT → not treated as internal, normal role auth still denies", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { ...nonAdminAuth(), "x-internal": "1", "x-internal-secret": "not-the-real-secret" },
    });
    expect(res.statusCode).toBe(403);
  });
});
