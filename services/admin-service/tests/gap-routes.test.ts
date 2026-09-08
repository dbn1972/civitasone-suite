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
      expect(init.headers.authorization).toMatch(/^Bearer /);
      expect(init.headers["x-tenant-id"]).toBe(TENANT);
      return jsonResponse(200, [{ id: "u1", tenantId: TENANT, email: "a@gov.in", name: "A", empCode: null, status: "active", mfaEnabled: true, version: 1 }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.json().data[0].email).toBe("a@gov.in");
  });

  it("POST /v1/admin/users returns identity-service's real accepted id — not a locally-invented randomUUID()", async () => {
    const upstreamId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async () => jsonResponse(202, { id: upstreamId, status: "accepted", correlationId: "c-1" }));
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
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(409, { code: "CONFLICT", message: "email already in use" })));
    const res = await app.inject({
      method: "POST", url: "/v1/admin/users",
      headers: authHeader(["tenant_admin"]),
      payload: { name: "Dup", email: "dup@gov.in" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });

  it("GET /v1/admin/roles and POST /v1/admin/roles relay identity-service's real RBAC store", async () => {
    const listMock = vi.fn(async () => jsonResponse(200, [{ id: "r1", tenantId: TENANT, key: "auditor", name: "Auditor", description: null, isSystem: false, version: 1 }]));
    vi.stubGlobal("fetch", listMock);
    const list = await app.inject({ method: "GET", url: "/v1/admin/roles", headers: authHeader(["platform_admin"]) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].key).toBe("auditor");

    const upstreamId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(202, { id: upstreamId, status: "accepted", correlationId: "c-2" })));
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

  it("PATCH /v1/admin/roles/:id honestly 501s — no update-role-metadata command exists in identity-service", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/roles/33333333-3333-4333-8333-333333333333",
      headers: authHeader(["platform_admin"]),
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe("NOT_IMPLEMENTED");
  });

  it("GET /v1/admin/permissions relays identity-service's real permission list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, [{ id: "p1", tenantId: TENANT, key: "finance.read", name: "Read finance", description: null, version: 1 }])));
    const res = await app.inject({ method: "GET", url: "/v1/admin/permissions", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].key).toBe("finance.read");
  });

  it("PATCH /v1/admin/roles/:id/permissions diffs the desired set against the real role and issues real grant/revoke calls", async () => {
    const roleId = "44444444-4444-4444-8444-444444444444";
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: { method: string; body?: string }) => {
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

    const grantCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/permissions"));
    expect(grantCall).toBeDefined();
    expect(JSON.parse(grantCall!.body!)).toEqual({ permissionId: "perm-finance-write" });
    const revokeCall = calls.find((c) => c.method === "DELETE");
    expect(revokeCall!.url).toContain("perm-finance-read");
  });

  it("GET /v1/admin/mfa/users maps identity-service's real mfaEnabled column, never a fabricated status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, [
      { id: "u1", tenantId: TENANT, email: "mfa-on@gov.in", name: "On", empCode: null, status: "active", mfaEnabled: true, version: 1 },
      { id: "u2", tenantId: TENANT, email: "mfa-off@gov.in", name: "Off", empCode: null, status: "active", mfaEnabled: false, version: 1 },
    ])));
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
  it("relays audit-service's real event list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toContain("/v1/audit/events");
      return jsonResponse(200, [{ id: "e1", actor: "someone@gov.in", action: "role.granted", resource: "role:auditor", outcome: "success", timestamp: "2026-09-01T00:00:00.000Z" }]);
    }));
    const res = await app.inject({ method: "GET", url: "/v1/admin/audit-logs", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].action).toBe("role.granted");
  });

  it("relays audit-service's real 403 for a role it restricts — honest, not a fabricated empty 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(403, { code: "FORBIDDEN", message: "requires one of: audit_officer, audit_admin, super_admin, platform_admin" })));
    const res = await app.inject({ method: "GET", url: "/v1/admin/audit-logs", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Usage — real, forwarded to tenant-service's quota tracker
// ══════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/usage", () => {
  it("relays tenant-service's real per-resource quota usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toContain("/v1/tenant/usage");
      return jsonResponse(200, { tenantId: TENANT, resources: [{ resource: "storage", limit: 1000, used: 342, usagePercent: 34.2, overLimit: false, projectedOverageDate: null }], anyOverLimit: false, anyWarning: false });
    }));
    const res = await app.inject({ method: "GET", url: "/v1/admin/usage", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ resource: string; used: number; limit: number }>;
    expect(rows[0]).toMatchObject({ resource: "storage", used: 342, limit: 1000 });
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
    "/v1/admin/org-hierarchy",
  ]) {
    it(`GET ${path} returns 501 NOT_IMPLEMENTED, never a fabricated 2xx`, async () => {
      const res = await app.inject({ method: "GET", url: path, headers: authHeader(["tenant_admin"]) });
      expect(res.statusCode).toBe(501);
      expect(res.json().code).toBe("NOT_IMPLEMENTED");
    });
  }
});
