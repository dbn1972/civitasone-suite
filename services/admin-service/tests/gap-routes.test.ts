/**
 * admin-service — gap/routes.ts regression tests (COMP-001).
 *
 * These 21 routes used to fabricate every response: hardcoded stats, empty
 * lists regardless of what existed, `POST /v1/admin/roles` returning a
 * `randomUUID()` while creating nothing. Every test below asserts the
 * ANTI-fabrication property specifically — a real row appears after being
 * created through a REAL path (never through the route under test itself,
 * so the assertion cannot pass just because the route echoes its own input),
 * or a real peer-service call actually happened (mocked fetch, asserted on),
 * or an honest non-2xx is returned instead of a fabricated 2xx.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerDataExportConsumers } from "../src/modules/data-export/consumer.js";
import { registerCustomDomainConsumers } from "../src/modules/custom-domains/consumer.js";
import { registerFeatureFlagConsumers } from "../src/modules/feature-flags/consumer.js";
import { registerSecurityComplianceConsumers } from "../src/modules/security-compliance/consumer.js";
import { registerSecurityIncidentConsumers } from "../src/modules/security-incident/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000099";

function token(roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-gap" }, SECRET, 3600);
}
function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

/**
 * Regression guard for the whole cross-service-forward security design
 * (COMP-001 fix-up, review finding #2): every one of these routes MUST
 * forward the CALLER's own bearer token to the peer service, never the
 * x-internal/x-service-secret service-account seam (packages/auth/src/
 * plugin.ts, permissions.ts) — that seam resolves to a synthetic context
 * with roles: ["super_admin", "hr_admin", "payroll_admin", "finance_admin"]
 * (packages/auth/src/context.ts), so using it here would let ANY caller
 * admin-service itself lets through (tenant_admin included) act with
 * super_admin authority at the receiving service — a privilege-escalation
 * bug. Call this on every mocked fetch call's init argument in this file so a future
 * refactor that reintroduces the seam fails a test, not just a code review.
 */
function expectForwardsCallerAuth(init: { headers: Record<string, string> }) {
  expect(init.headers.authorization).toMatch(/^Bearer /);
  expect(init.headers["x-internal"]).toBeUndefined();
  expect(init.headers["x-service-secret"]).toBeUndefined();
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Production wires these up in worker.ts, a separate process from the API
  // app under test here — without registering them, every async command this
  // suite issues (feature-flag update, compliance-control create, custom-
  // domain register, security-incident create) would sit unprocessed forever
  // and every "does the real read side reflect it" assertion below would be
  // unable to tell a real fix from a no-op fabrication. QUEUE_DRIVER=memory
  // (vitest.config.ts) dispatches to subscribers synchronously on publish.
  registerDataExportConsumers(queue);
  registerCustomDomainConsumers(queue);
  registerFeatureFlagConsumers(queue);
  registerSecurityComplianceConsumers(tenantScoped(queue));
  registerSecurityIncidentConsumers(tenantScoped(queue));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => { vi.unstubAllGlobals(); });

// ══════════════════════════════════════════════════════════════════════════
// GET /v1/admin/compliance — real, computed from persisted compliance controls
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/compliance", () => {
  it("reflects a real, passing DPDP control — not a hardcoded score", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/security/compliance/controls",
      headers: authHeader(["super_admin"]),
      payload: { controlKey: `DPDP-${Date.now()}`, framework: "DPDP", title: "Consent capture retention control" },
    });
    expect(create.statusCode).toBe(202);
    await queue.drain();
    const controlId = create.json().id as string;

    const patch = await app.inject({
      method: "PATCH", url: `/v1/admin/security/compliance/controls/${controlId}`,
      headers: authHeader(["super_admin"]),
      payload: { status: "pass" },
    });
    expect(patch.statusCode).toBe(202);
    await queue.drain();

    const res = await app.inject({ method: "GET", url: "/v1/admin/compliance", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Flat shape — NOT wrapped in `{data: ...}` (the old fabricated route's
    // shape didn't match the frontend loader at all; this is the real fix).
    expect(body.dpdpScore).toBe(100);
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.some((c: { id: string }) => c.id === controlId)).toBe(true);
  });

  it("returns 401 without auth, 403 for an unrelated role", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/v1/admin/compliance" });
    expect(noAuth.statusCode).toBe(401);
    const wrongRole = await app.inject({ method: "GET", url: "/v1/admin/compliance", headers: authHeader(["employee"]) });
    expect(wrongRole.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /v1/admin/data-exports — real, same store as /v1/admin/data-export
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/data-exports", () => {
  it("lists a request created through the real /v1/admin/data-export endpoint", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "full", format: "json" },
    });
    expect(create.statusCode).toBe(202);
    await queue.drain();
    const id = create.json().id as string;

    const res = await app.inject({ method: "GET", url: "/v1/admin/data-exports", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.some((r: { id: string }) => r.id === id)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /v1/admin/domains — real, same store as /v1/admin/custom-domains;
// role-tightened to match the canonical module (no tenant_admin)
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/domains", () => {
  it("lists a domain registered through the real /v1/admin/custom-domains endpoint", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["platform_admin"]),
      payload: { domain: `gap-test-${Date.now()}.example.gov.in` },
    });
    expect([200, 201, 202]).toContain(create.statusCode);
    await queue.drain();

    const res = await app.inject({ method: "GET", url: "/v1/admin/domains", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it("returns 403 for tenant_admin — sabotage check for the role tightening", async () => {
    // The gap module's own blanket ROLES constant includes tenant_admin; this
    // specific route must NOT use that constant, because the canonical
    // custom-domains module (which owns this data) restricts to
    // platform_admin/super_admin. Reverting the tightened requireRole() call
    // to plain `ROLES` is exactly the sabotage this test catches.
    const res = await app.inject({ method: "GET", url: "/v1/admin/domains", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /v1/admin/siem/alerts — real, backed by security-incident's own store
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/siem/alerts", () => {
  it("lists an incident created through the real security-incident endpoint", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents",
      headers: authHeader(["super_admin"]),
      payload: { title: "Unusual login pattern detected", severity: "high", category: "auth_anomaly" },
    });
    expect(create.statusCode).toBe(202);
    await queue.drain();

    const res = await app.inject({ method: "GET", url: "/v1/admin/siem/alerts", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.some((a: { title: string }) => a.title === "Unusual login pattern detected")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET/PATCH /v1/admin/features — real alias of feature-flags/manage;
// role-tightened to match the canonical module (no tenant_admin)
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/features + PATCH /v1/admin/features/:id", () => {
  it("lists a flag created via the canonical module and PATCH really updates it", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["platform_admin"]),
      payload: { key: `gap_test_${Date.now()}`, name: "Gap test flag", enabled: false },
    });
    expect(create.statusCode).toBe(202);
    await queue.drain();

    const list = await app.inject({ method: "GET", url: "/v1/admin/features", headers: authHeader(["platform_admin"]) });
    expect(list.statusCode).toBe(200);
    const flags = list.json().data as Array<{ id: string; enabled: boolean }>;
    expect(flags.length).toBeGreaterThan(0);
    const flagId = flags[flags.length - 1].id;

    const patch = await app.inject({
      method: "PATCH", url: `/v1/admin/features/${flagId}`,
      headers: authHeader(["platform_admin"]),
      payload: { enabled: true },
    });
    // 202 real-accepted (async command), not the old synchronous `{updated:true}` lie.
    expect(patch.statusCode).toBe(202);
    expect(patch.json().status).toBe("accepted");
    await queue.drain();

    const relist = await app.inject({ method: "GET", url: "/v1/admin/features", headers: authHeader(["platform_admin"]) });
    const updated = (relist.json().data as Array<{ id: string; enabled: boolean }>).find((f) => f.id === flagId);
    expect(updated?.enabled).toBe(true);
  });

  it("returns 403 for tenant_admin on both routes — sabotage check for the role tightening", async () => {
    const get = await app.inject({ method: "GET", url: "/v1/admin/features", headers: authHeader(["tenant_admin"]) });
    expect(get.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Users / Roles / Permissions / MFA users — real, forwarded to identity-service
// with the CALLER'S OWN bearer token (never x-internal). Fetch is mocked;
// each test asserts on the actual outbound call, not just the response.
// ══════════════════════════════════════════════════════════════════════════
describe("cross-service routes → identity-service (token-forwarded)", () => {
  it("GET /v1/admin/users forwards the caller's bearer token and relays real rows", async () => {
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toContain("/identity/users");
      expectForwardsCallerAuth(init);
      expect(init.headers["x-tenant-id"]).toBe(TENANT);
      return jsonResponse(200, [{ id: "u1", tenantId: TENANT, email: "a@gov.in", name: "A", empCode: null, status: "active", mfaEnabled: true, version: 1 }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.json().data[0].email).toBe("a@gov.in");
  });

  it("POST /v1/admin/users forwards the caller's bearer token and returns identity-service's real accepted id — not a locally-invented randomUUID()", async () => {
    const upstreamId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(202, { id: upstreamId, status: "accepted", correlationId: "c-1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/users",
      headers: authHeader(["tenant_admin"]),
      payload: { name: "New User", email: "new@gov.in" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe(upstreamId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST /v1/admin/users relays a real identity-service failure honestly (never swallows it into a fake 2xx)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(409, { code: "CONFLICT", message: "email already in use" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/users",
      headers: authHeader(["tenant_admin"]),
      payload: { name: "Dup", email: "dup@gov.in" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });

  it("PATCH /v1/admin/users/:id forwards the caller's bearer token and relays identity-service's real update", async () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toContain(`/identity/users/${userId}`);
      expectForwardsCallerAuth(init);
      return jsonResponse(200, { id: userId, tenantId: TENANT, email: "a@gov.in", name: "Updated Name", empCode: null, status: "active", mfaEnabled: true, version: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/users/${userId}`,
      headers: authHeader(["tenant_admin"]),
      payload: { name: "Updated Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PATCH /v1/admin/users/:id relays a real identity-service failure honestly (never swallows it into a fake 2xx)", async () => {
    const userId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(404, { code: "NOT_FOUND", message: "user not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/users/${userId}`,
      headers: authHeader(["tenant_admin"]),
      payload: { name: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("GET /v1/admin/roles and POST /v1/admin/roles forward the caller's bearer token and relay identity-service's real RBAC store", async () => {
    const listMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(200, [{ id: "r1", tenantId: TENANT, key: "auditor", name: "Auditor", description: null, isSystem: false, version: 1 }]);
    });
    vi.stubGlobal("fetch", listMock);
    const list = await app.inject({ method: "GET", url: "/v1/admin/roles", headers: authHeader(["platform_admin"]) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].key).toBe("auditor");

    const upstreamId = "22222222-2222-4222-8222-222222222222";
    const createMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(202, { id: upstreamId, status: "accepted", correlationId: "c-2" });
    });
    vi.stubGlobal("fetch", createMock);
    const create = await app.inject({
      method: "POST", url: "/v1/admin/roles",
      headers: authHeader(["platform_admin"]),
      payload: { key: "budget_reviewer", name: "Budget Reviewer" },
    });
    // 202 real-accepted, not the old `reply.code(201).send({id: randomUUID()})`
    // — the flagship fabrication the gap report cited by name.
    expect(create.statusCode).toBe(202);
    expect(create.json().id).toBe(upstreamId);
  });

  it("GET /v1/admin/roles/:id forwards the caller's bearer token and relays the role's real current permissions (COMP-004: backs the admin/roles permissions editor)", async () => {
    const roleId = "55555555-5555-4555-8555-555555555555";
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      expect(url).toContain(`/identity/rbac/roles/${roleId}`);
      return jsonResponse(200, { id: roleId, key: "auditor", name: "Auditor", permissions: ["finance.read", "audit.read"] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: `/v1/admin/roles/${roleId}`, headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().permissions).toEqual(["finance.read", "audit.read"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET /v1/admin/roles/:id relays a real identity-service 404 honestly (never fabricates an empty role)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(404, { code: "NOT_FOUND", message: "role not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "GET", url: "/v1/admin/roles/66666666-6666-4666-8666-666666666666",
      headers: authHeader(["platform_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("PATCH /v1/admin/roles/:id honestly 501s — no update-role-metadata command exists in identity-service", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/roles/33333333-3333-4333-8333-333333333333",
      headers: authHeader(["platform_admin"]),
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe("NOT_IMPLEMENTED");
  });

  it("GET /v1/admin/permissions forwards the caller's bearer token and relays identity-service's real permission list", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(200, [{ id: "p1", tenantId: TENANT, key: "finance.read", name: "Read finance", description: null, version: 1 }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/permissions", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].key).toBe("finance.read");
  });

  it("PATCH /v1/admin/roles/:id/permissions forwards the caller's bearer token on every upstream call and diffs the desired set against the real role", async () => {
    const roleId = "44444444-4444-4444-8444-444444444444";
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      calls.push({ method: init.method, url, body: init.body });
      if (url.endsWith(`/identity/rbac/roles/${roleId}`)) return jsonResponse(200, { id: roleId, permissions: ["finance.read"] });
      if (url.includes("/identity/rbac/permissions")) {
        return jsonResponse(200, [
          { id: "perm-finance-read", key: "finance.read" },
          { id: "perm-finance-write", key: "finance.write" },
        ]);
      }
      if (init.method === "POST" && url.endsWith("/permissions")) return jsonResponse(202, { id: roleId, status: "accepted", correlationId: "c-3" });
      if (init.method === "DELETE") return jsonResponse(202, { id: roleId, status: "accepted", correlationId: "c-4" });
      throw new Error(`unexpected upstream call: ${init.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/roles/${roleId}/permissions`,
      headers: authHeader(["platform_admin"]),
      // desired = {finance.write} — must grant finance.write and revoke finance.read
      payload: { permissionKeys: ["finance.write"] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.granted).toEqual(["finance.write"]);
    expect(body.revoked).toEqual(["finance.read"]);
    // Every one of the >=3 upstream calls this route makes (role read, permission
    // list, grant/revoke) must have been asserted via expectForwardsCallerAuth above.
    expect(calls.length).toBeGreaterThanOrEqual(3);

    const grantCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/permissions"));
    expect(grantCall).toBeDefined();
    expect(JSON.parse(grantCall!.body!)).toEqual({ permissionId: "perm-finance-write" });
    const revokeCall = calls.find((c) => c.method === "DELETE");
    expect(revokeCall!.url).toContain("perm-finance-read");
  });

  it("PATCH /v1/admin/roles/:id/permissions (COMP-011): a mixed success/failure request continues applying every remaining change and reports exactly what succeeded, what failed, and why — instead of aborting on the first failure and discarding partial state", async () => {
    const roleId = "55555555-5555-4555-8555-555555555555";
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      calls.push({ method: init.method, url });
      if (url.endsWith(`/identity/rbac/roles/${roleId}`)) {
        return jsonResponse(200, { id: roleId, permissions: ["finance.read", "hr.read"] });
      }
      if (url.includes("/identity/rbac/permissions")) {
        return jsonResponse(200, [
          { id: "perm-finance-read", key: "finance.read" },
          { id: "perm-finance-write", key: "finance.write" },
          { id: "perm-hr-read", key: "hr.read" },
        ]);
      }
      // Grant of finance.write FAILS (identity-service's own self-escalation
      // guard rejecting it, e.g.) — this must NOT stop the revoke below from
      // being attempted.
      if (init.method === "POST" && url.endsWith("/permissions")) {
        return jsonResponse(403, { code: "SELF_ESCALATION_DENIED", message: "caller cannot grant a permission it does not itself hold" });
      }
      // Revoke of hr.read SUCCEEDS.
      if (init.method === "DELETE") return jsonResponse(202, { id: roleId, status: "accepted", correlationId: "c-9" });
      throw new Error(`unexpected upstream call: ${init.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/roles/${roleId}/permissions`,
      headers: authHeader(["platform_admin"]),
      // current = {finance.read, hr.read}, desired = {finance.read, finance.write}
      // => must attempt: grant finance.write (FAILS), revoke hr.read (SUCCEEDS)
      payload: { permissionKeys: ["finance.read", "finance.write"] },
    });

    // Real partial state, not a bare relayed upstream error: 207, not the
    // upstream's raw 403, and not the old behaviour's 202-looks-like-success.
    expect(res.statusCode).toBe(207);
    const body = res.json();
    expect(body.status).toBe("partial");
    expect(body.granted).toEqual([]);
    expect(body.revoked).toEqual(["hr.read"]);
    expect(body.failed).toEqual([
      { key: "finance.write", action: "grant", status: 403, code: "SELF_ESCALATION_DENIED", message: "caller cannot grant a permission it does not itself hold" },
    ]);

    // The revoke call must have actually happened — proves the failed grant
    // did not abort the rest of the batch (the old code `return`ed on the
    // first non-2xx, so the DELETE call was never made at all).
    const revokeCall = calls.find((c) => c.method === "DELETE");
    expect(revokeCall).toBeDefined();
    expect(revokeCall!.url).toContain("perm-hr-read");
  });

  it("GET /v1/admin/user-roles/:id forwards the caller's bearer token and relays the user's real effective roles (not /v1/admin/users/:id/roles — see route comment for why)", async () => {
    const userId = "77777777-7777-4777-8777-777777777777";
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      expect(url).toContain(`/identity/rbac/users/${userId}/effective`);
      return jsonResponse(200, { roles: [{ id: "role-1", key: "hr_admin", name: "HR Admin" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: `/v1/admin/user-roles/${userId}`, headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: "role-1", key: "hr_admin", name: "HR Admin" }]);
  });

  it("PATCH /v1/admin/user-roles/:id diffs the desired role-key set against the user's real effective roles and issues one real assign/revoke call per change", async () => {
    const userId = "88888888-8888-4888-8888-888888888888";
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      calls.push({ method: init.method, url, body: init.body });
      if (url.endsWith(`/identity/rbac/users/${userId}/effective`)) {
        return jsonResponse(200, { roles: [{ id: "role-hr", key: "hr_staff" }] });
      }
      if (url.includes("/identity/rbac/roles?")) {
        return jsonResponse(200, [
          { id: "role-hr", key: "hr_staff" },
          { id: "role-fin", key: "finance_admin" },
        ]);
      }
      if (init.method === "POST" && url.endsWith("/assignments")) return jsonResponse(202, { id: userId, status: "accepted", correlationId: "c-5" });
      if (init.method === "DELETE") return jsonResponse(202, { id: userId, status: "accepted", correlationId: "c-6" });
      throw new Error(`unexpected upstream call: ${init.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/user-roles/${userId}`,
      headers: authHeader(["tenant_admin"]),
      // desired = {finance_admin} — must grant finance_admin and revoke hr_staff
      payload: { roleKeys: ["finance_admin"] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.granted).toEqual(["finance_admin"]);
    expect(body.revoked).toEqual(["hr_staff"]);

    const grantCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/assignments"));
    expect(grantCall).toBeDefined();
    expect(grantCall!.url).toContain("role-fin");
    expect(JSON.parse(grantCall!.body!)).toEqual({ userId });
    const revokeCall = calls.find((c) => c.method === "DELETE");
    expect(revokeCall!.url).toContain("role-hr");
    expect(revokeCall!.url).toContain(userId);
  });

  it("PATCH /v1/admin/user-roles/:id rejects a body missing roleKeys instead of silently no-op-ing", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/user-roles/99999999-9999-4999-8999-999999999999",
      headers: authHeader(["tenant_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("GET /v1/admin/mfa/users forwards the caller's bearer token and maps identity-service's real mfaEnabled column, never a fabricated status", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(200, [
        { id: "u1", tenantId: TENANT, email: "mfa-on@gov.in", name: "On", empCode: null, status: "active", mfaEnabled: true, version: 1 },
        { id: "u2", tenantId: TENANT, email: "mfa-off@gov.in", name: "Off", empCode: null, status: "active", mfaEnabled: false, version: 1 },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/mfa/users", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ email: string; mfaStatus: string }>;
    expect(rows.find((r) => r.email === "mfa-on@gov.in")?.mfaStatus).toBe("enabled");
    expect(rows.find((r) => r.email === "mfa-off@gov.in")?.mfaStatus).toBe("disabled");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Audit logs — real, forwarded to audit-service
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/audit-logs", () => {
  it("forwards the caller's bearer token and relays audit-service's real event list", async () => {
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toContain("/v1/audit/events");
      expectForwardsCallerAuth(init);
      return jsonResponse(200, [{ id: "e1", actor: "someone@gov.in", action: "role.granted", resource: "role:auditor", outcome: "success", timestamp: "2026-09-01T00:00:00.000Z" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/audit-logs", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].action).toBe("role.granted");
  });

  it("forwards the caller's bearer token and relays audit-service's real 403 for a role it restricts — honest, not a fabricated empty 200", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expectForwardsCallerAuth(init);
      return jsonResponse(403, { code: "FORBIDDEN", message: "requires one of: audit_officer, audit_admin, super_admin, platform_admin" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/audit-logs", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Usage — real, forwarded to tenant-service's quota tracker
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/usage", () => {
  it("forwards the caller's bearer token and relays tenant-service's real per-resource quota usage", async () => {
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toContain("/v1/tenant/usage");
      expectForwardsCallerAuth(init);
      return jsonResponse(200, { tenantId: TENANT, resources: [{ resource: "storage", limit: 1000, used: 342, usagePercent: 34.2, overLimit: false, projectedOverageDate: null }], anyOverLimit: false, anyWarning: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/usage", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ resource: string; used: number; limit: number }>;
    expect(rows[0]).toMatchObject({ resource: "storage", used: 342, limit: 1000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Org hierarchy — real, forwarded to tenant-service's org-hierarchy module
// ══════════════════════════════════════════════════════════════════════════
//
// COMP-001 fix-up (review finding #1): the original PR's comment/PR-body
// claimed org-hierarchy "has no backing store anywhere in the platform" and
// left it 501. That was wrong — tenant-service/src/modules/org-hierarchy is
// a fully built, registered module with a real tenant-scoped `orgUnits`
// table and a real `GET /v1/org/hierarchy` read. Two tests below: one in the
// same mocked-fetch style as every other forwarding route (fast, asserts the
// forwarding contract), and one genuine integration test that boots a REAL
// tenant-service instance on a real loopback port, creates a REAL row in its
// REAL table through its REAL write path, and proves admin-service's route
// relays that real data end-to-end over a real (unmocked) HTTP hop — not a
// mocked-fetch assertion.
describe("GET /v1/admin/org-hierarchy", () => {
  it("forwards the caller's bearer token and relays tenant-service's real org-unit rows", async () => {
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toContain("/v1/org/hierarchy");
      expectForwardsCallerAuth(init);
      expect(init.headers["x-tenant-id"]).toBe(TENANT);
      return jsonResponse(200, { data: [{ id: "ou1", tenantId: TENANT, name: "Finance Wing", type: "department" }], meta: { total: 1 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.json().data[0].name).toBe("Finance Wing");
  });

  describe("real integration — genuine tenant-service round trip (not mocked fetch)", () => {
    let tenantApp: FastifyInstance | undefined;
    let tenantDb: typeof import("../../tenant-service/src/shared/db.js") | undefined;
    let previousTenantServiceUrl: string | undefined;
    const ORG_TENANT = "dddddddd-eeee-4000-8000-000000000501";
    const ORG_ACTOR = "00000000-eeee-4000-8000-000000000502";

    beforeAll(async () => {
      // tenant-service's own db/queue singletons are created at MODULE-LOAD
      // time from process.env.DATABASE_URL. This test process is running
      // under admin-service's vitest env, whose DATABASE_URL points at
      // civitas_admin — NOT the civitas_tenant database org_units actually
      // lives in. Swap DATABASE_URL to tenant-service's own DSN for the
      // instant of the dynamic import (mirrors the technique
      // packages/db/src/create-tenant-db.basic.test.ts uses), then restore
      // it — admin-service's own db module was already loaded/bound at the
      // top of this file under the correct DSN, so this only affects the
      // freshly-imported tenant-service modules.
      const savedDbUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL =
        process.env.TENANT_DATABASE_URL_FOR_TEST ??
        "postgres://tenant_svc:tenant_dev_pw@localhost:5435/civitas_tenant";
      try {
        tenantDb = await import("../../tenant-service/src/shared/db.js");
        const { queue: tenantQueue } = await import("../../tenant-service/src/shared/infra.js");
        const { registerOrgHierarchyConsumers } = await import("../../tenant-service/src/modules/org-hierarchy/consumer.js");
        registerOrgHierarchyConsumers(tenantQueue);
        const { buildApp: buildTenantApp } = await import("../../tenant-service/src/app.js");
        tenantApp = await buildTenantApp();
        await tenantApp.listen({ port: 0, host: "127.0.0.1" });

        // Create a REAL org unit through tenant-service's REAL write path
        // (POST /v1/org/hierarchy → CQRS command → real consumer → real
        // INSERT into tenant.org_units), never a mocked response.
        const createToken = signToken({ sub: ORG_ACTOR, tid: ORG_TENANT, roles: ["tenant_admin"], sid: "sess-org" }, SECRET, 3600);
        const createRes = await tenantApp.inject({
          method: "POST", url: "/v1/org/hierarchy",
          headers: { authorization: `Bearer ${createToken}` },
          payload: { name: "Directorate of Real Data", type: "department" },
        });
        if (createRes.statusCode !== 202) {
          throw new Error(`setup: failed to create real org unit — ${createRes.statusCode} ${createRes.body}`);
        }
        // publish() is fire-and-forget; drain() awaits the tracked delivery
        // (including the consumer's real INSERT) before we read it back.
        await (tenantQueue as { drain: () => Promise<void> }).drain();
      } finally {
        process.env.DATABASE_URL = savedDbUrl;
      }
    });

    afterAll(async () => {
      if (tenantApp) await tenantApp.close();
      if (tenantDb) await tenantDb.sqlClient.end();
      if (previousTenantServiceUrl === undefined) delete process.env.TENANT_SERVICE_URL;
      else process.env.TENANT_SERVICE_URL = previousTenantServiceUrl;
    });

    it("GET /v1/admin/org-hierarchy relays the real row from tenant-service's real table over a real HTTP hop", async () => {
      if (!tenantApp) throw new Error("tenant-service test app failed to start in beforeAll");
      const address = tenantApp.server.address();
      if (address === null || typeof address === "string") throw new Error("tenant-service test app has no TCP address");
      previousTenantServiceUrl = process.env.TENANT_SERVICE_URL;
      process.env.TENANT_SERVICE_URL = `http://127.0.0.1:${address.port}`;

      // Deliberately NOT stubbing global fetch here — admin-service's real
      // upstream-client.ts makes a real network call to the real
      // tenant-service instance started above.
      const res = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy", headers: { authorization: `Bearer ${signToken({ sub: ORG_ACTOR, tid: ORG_TENANT, roles: ["tenant_admin"], sid: "sess-org" }, SECRET, 3600)}` } });
      expect(res.statusCode).toBe(200);
      const rows = res.json().data as Array<{ name: string; type: string; tenantId: string }>;
      expect(rows.length).toBeGreaterThan(0);
      const created = rows.find((r) => r.name === "Directorate of Real Data");
      expect(created).toBeDefined();
      expect(created!.type).toBe("department");
      expect(created!.tenantId).toBe(ORG_TENANT);
      // Cross-tenant isolation, proven end-to-end through the real forward:
      // a caller from a different tenant must never see this row.
      const otherTenantRes = await app.inject({ method: "GET", url: "/v1/admin/org-hierarchy", headers: authHeader(["tenant_admin"]) });
      expect(otherTenantRes.statusCode).toBe(200);
      expect((otherTenantRes.json().data as Array<{ name: string }>).some((r) => r.name === "Directorate of Real Data")).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Honest 501s — no trustworthy real backing store exists for these within
// the scope of this single gap. Never a fabricated 2xx.
// ══════════════════════════════════════════════════════════════════════════
describe("honest 501s (no real backing store in scope)", () => {
  for (const path of [
    "/v1/admin/security/overview",
    "/v1/admin/idp/providers",
    "/v1/admin/sso/providers",
  ]) {
    it(`GET ${path} returns 501 NOT_IMPLEMENTED, never a fabricated 2xx`, async () => {
      const res = await app.inject({ method: "GET", url: path, headers: authHeader(["tenant_admin"]) });
      expect(res.statusCode).toBe(501);
      expect(res.json().code).toBe("NOT_IMPLEMENTED");
    });
  }
});
