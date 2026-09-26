/**
 * Coverage for shared/keycloak.ts's assignRealmRoles() — the fix for the
 * tenant-onboarding bug where a brand-new tenant's bootstrap admin ended up
 * with zero working Keycloak realm roles (see modules/tenant-onboard/
 * consumer.ts's BOOTSTRAP_ADMIN_REALM_ROLES doc comment for the full story).
 *
 * Deliberately standalone (no buildApp(), no DB): assignRealmRoles is pure
 * Keycloak-HTTP-calling logic (resolve role names → POST role-mappings), so
 * this file mocks `fetch` directly rather than paying for a full Fastify app
 * + Postgres pool just to reach it. Compare keycloak-scim-coverage.test.ts,
 * which legitimately needs both for its SCIM-route/session coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

describe("Keycloak module — assignRealmRoles — disabled path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns skipped when keycloak admin creds are not configured", async () => {
    vi.stubEnv("KEYCLOAK_URL", "");
    vi.stubEnv("KEYCLOAK_ADMIN_USER", "");
    vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "");
    vi.resetModules();
    const { assignRealmRoles } = await import("../src/shared/keycloak.js");
    const result = await assignRealmRoles({ tenantId: TENANT, email: "test@test.gov.in" }, ["tenant_admin"]);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("not configured");
  });
});

// ── assignRealmRoles — enabled path, mocked Keycloak HTTP API ──────────────
//
// Regression coverage for the tenant-onboard bug: the bootstrap-admin role
// grant must actually reach Keycloak's role-mappings endpoint with the full
// {id, name} role representations (a bare name string 404s there), and must
// degrade gracefully — never throw — when a requested role name isn't in the
// realm's catalog (exactly the situation for grant/inventory/project's roles
// today, per BOOTSTRAP_ADMIN_REALM_ROLES's "known gap" note).
describe("Keycloak module — assignRealmRoles — enabled path", () => {
  const KC_URL = "https://kc-test.invalid/auth";
  const REALM_USER_ID = "11111111-2222-4000-8000-000000000001";
  const KNOWN_ROLES: Record<string, { id: string; name: string }> = {
    tenant_admin:       { id: "role-tenant-admin-id",       name: "tenant_admin" },
    finance_admin:      { id: "role-finance-admin-id",      name: "finance_admin" },
    hr_admin:           { id: "role-hr-admin-id",           name: "hr_admin" },
    payroll_admin:      { id: "role-payroll-admin-id",      name: "payroll_admin" },
    procurement_admin:  { id: "role-procurement-admin-id",  name: "procurement_admin" },
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  let roleMappingCalls: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_URL", KC_URL);
    vi.stubEnv("KEYCLOAK_REALM", "civitasone");
    vi.stubEnv("KEYCLOAK_ADMIN_USER", "admin");
    vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "test-admin-pw");
    roleMappingCalls = [];

    fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(JSON.stringify({ access_token: "test-admin-token", expires_in: 300 }), { status: 200 });
      }
      if (url.includes("/users?username=")) {
        // Must match kcUsername(tenantId, email) exactly — findUser() does an
        // exact-string compare against this, by design (SEC H3: never resolve
        // by realm-wide email, only the tenant-namespaced username).
        return new Response(JSON.stringify([
          { id: REALM_USER_ID, enabled: true, username: `${TENANT}__admin@new-tenant.gov.in`, attributes: { tid: [TENANT] } },
        ]), { status: 200 });
      }
      const roleMatch = url.match(/\/admin\/realms\/civitasone\/roles\/([^/?]+)$/);
      if (roleMatch && (!init || init.method === undefined)) {
        const name = decodeURIComponent(roleMatch[1]);
        const role = KNOWN_ROLES[name];
        return role
          ? new Response(JSON.stringify(role), { status: 200 })
          : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith(`/users/${REALM_USER_ID}/role-mappings/realm`) && init?.method === "POST") {
        roleMappingCalls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch in test: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves each role name to its {id,name} representation and POSTs them all — the exact BOOTSTRAP_ADMIN_REALM_ROLES set", async () => {
    vi.resetModules();
    const { assignRealmRoles } = await import("../src/shared/keycloak.js");
    const result = await assignRealmRoles(
      { tenantId: TENANT, email: "admin@new-tenant.gov.in" },
      ["tenant_admin", "finance_admin", "hr_admin", "payroll_admin", "procurement_admin"],
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.kcUserId).toBe(REALM_USER_ID);

    expect(roleMappingCalls).toHaveLength(1);
    const posted = roleMappingCalls[0].body as Array<{ id: string; name: string }>;
    expect(posted.map((r) => r.name).sort()).toEqual(
      ["finance_admin", "hr_admin", "payroll_admin", "procurement_admin", "tenant_admin"],
    );
    // Full representations, not bare names — the role-mappings endpoint 400s on bare strings.
    expect(posted.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
  });

  it("skips a role name absent from the realm catalog instead of failing the whole grant", async () => {
    vi.resetModules();
    const { assignRealmRoles } = await import("../src/shared/keycloak.js");
    const result = await assignRealmRoles(
      { tenantId: TENANT, email: "admin@new-tenant.gov.in" },
      ["tenant_admin", "grant_admin" /* not in KNOWN_ROLES — mirrors the live catalog gap */],
    );

    expect(result.ok).toBe(true);
    expect(result.reason).toContain("tenant_admin");
    expect(result.reason).toContain("skipped");
    const posted = roleMappingCalls[0].body as Array<{ id: string; name: string }>;
    expect(posted.map((r) => r.name)).toEqual(["tenant_admin"]);
  });

  it("returns ok:false (never throws) when none of the requested roles exist", async () => {
    vi.resetModules();
    const { assignRealmRoles } = await import("../src/shared/keycloak.js");
    const result = await assignRealmRoles(
      { tenantId: TENANT, email: "admin@new-tenant.gov.in" },
      ["grant_admin", "inventory_admin", "project_admin"],
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("none of the requested roles exist");
    expect(roleMappingCalls).toHaveLength(0);
  });

  it("returns ok:false (never throws) when the user isn't federated in Keycloak yet", async () => {
    vi.resetModules();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(JSON.stringify({ access_token: "test-admin-token", expires_in: 300 }), { status: 200 });
      }
      if (url.includes("/users?username=")) {
        return new Response(JSON.stringify([]), { status: 200 }); // no such user
      }
      throw new Error(`unexpected fetch in test: ${init?.method ?? "GET"} ${url}`);
    });
    const { assignRealmRoles } = await import("../src/shared/keycloak.js");
    const result = await assignRealmRoles({ tenantId: TENANT, email: "ghost@new-tenant.gov.in" }, ["tenant_admin"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not present in keycloak");
  });

  it("returns ok:false (never throws) on an unexpected role-mappings POST failure", async () => {
    vi.resetModules();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(JSON.stringify({ access_token: "test-admin-token", expires_in: 300 }), { status: 200 });
      }
      if (url.includes("/users?username=")) {
        return new Response(JSON.stringify([
          { id: REALM_USER_ID, enabled: true, username: `${TENANT}__admin@new-tenant.gov.in`, attributes: { tid: [TENANT] } },
        ]), { status: 200 });
      }
      const roleMatch = url.match(/\/admin\/realms\/civitasone\/roles\/([^/?]+)$/);
      if (roleMatch && (!init || init.method === undefined)) {
        const name = decodeURIComponent(roleMatch[1]);
        const role = KNOWN_ROLES[name];
        return role ? new Response(JSON.stringify(role), { status: 200 }) : new Response(null, { status: 404 });
      }
      if (url.endsWith(`/users/${REALM_USER_ID}/role-mappings/realm`) && init?.method === "POST") {
        return new Response("internal error", { status: 500 });
      }
      throw new Error(`unexpected fetch in test: ${init?.method ?? "GET"} ${url}`);
    });
    const { assignRealmRoles } = await import("../src/shared/keycloak.js");
    const result = await assignRealmRoles({ tenantId: TENANT, email: "admin@new-tenant.gov.in" }, ["tenant_admin"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("500");
  });
});
