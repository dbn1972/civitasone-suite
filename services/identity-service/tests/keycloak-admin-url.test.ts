/**
 * FQ17: KEYCLOAK_URL is the PUBLIC Keycloak URL in identity's deployed env
 * (packages/auth uses it for the JWKS URI and the JWT issuer check), and the
 * public reverse proxy does not expose /auth/admin/* -- it falls through to the
 * web app and answers HTML. So the admin token + Admin REST API calls must go
 * to KEYCLOAK_ADMIN_URL when it is set, and fall back to KEYCLOAK_URL only when
 * it is unset. fetch is mocked (no Keycloak); the public base behaves like the
 * real proxy, so a call that leaks there fails the lookup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const PUBLIC_URL = "https://uat.civitas.test/auth";
const ADMIN_URL = "http://keycloak-internal.test:8080/auth";
const TENANT = "f0170000-0000-4000-8000-0000000000a1";
const IDENT = "f0170000-0000-4000-8000-0000000000e1";
const EMAIL = "fq17admin@dept.gov.in";
const KCID = "f0170000-0000-4000-8000-00000000cc01";

let calls: Array<{ method: string; url: string }> = [];
let realmUsers: Array<Record<string, unknown>> = [];

/** Stub fetch: `kcBase` answers like Keycloak; any other base answers like the public proxy (HTML). */
function stubKeycloakAt(kcBase: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (!url.startsWith(`${kcBase}/`)) {
      return new Response("<!doctype html><html><body>web app</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "test-admin-token", expires_in: 300 }), { status: 200 });
    }
    if (url.includes("/admin/realms/civitasone/users?")) return new Response(JSON.stringify(realmUsers), { status: 200 });
    if (method === "POST" && url.endsWith("/admin/realms/civitasone/users")) {
      realmUsers = [{ id: KCID, enabled: true, username: `${TENANT}__${EMAIL}`, attributes: { tid: [TENANT] } }];
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  }));
}

/** Fresh module per test: keycloak.ts caches the admin token at module scope. */
async function loadKc() {
  vi.resetModules();
  return import("../src/shared/keycloak.js");
}

beforeEach(() => {
  vi.stubEnv("KEYCLOAK_URL", PUBLIC_URL);
  vi.stubEnv("KEYCLOAK_REALM", "civitasone");
  vi.stubEnv("KEYCLOAK_ADMIN_USER", "admin");
  vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "test-admin-pw");
  calls = [];
  realmUsers = [{ id: KCID, enabled: true, username: `${TENANT}__${EMAIL}`, attributes: { tid: [TENANT] } }];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("FQ17 keycloak admin calls use KEYCLOAK_ADMIN_URL", () => {
  it("KEYCLOAK_ADMIN_URL set: admin token + users lookup go to it, never to the public KEYCLOAK_URL", async () => {
    vi.stubEnv("KEYCLOAK_ADMIN_URL", `${ADMIN_URL}/`); // trailing slash is trimmed
    stubKeycloakAt(ADMIN_URL);
    const { lookupUserId } = await loadKc();

    const r = await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT });

    expect(r).toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: true });
    expect(calls.map((c) => c.url)).toEqual([
      `${ADMIN_URL}/realms/master/protocol/openid-connect/token`,
      `${ADMIN_URL}/admin/realms/civitasone/users?username=${encodeURIComponent(`${TENANT}__${EMAIL}`)}&exact=true&briefRepresentation=false`,
    ]);
    expect(calls.some((c) => c.url.startsWith(PUBLIC_URL))).toBe(false);
  });

  it("KEYCLOAK_ADMIN_URL set: provisioning (token, lookup, create) goes to it", async () => {
    vi.stubEnv("KEYCLOAK_ADMIN_URL", ADMIN_URL);
    stubKeycloakAt(ADMIN_URL);
    realmUsers = [];
    const { provisionUser } = await loadKc();

    const r = await provisionUser({ id: IDENT, tenantId: TENANT, email: EMAIL, name: "Fq Seventeen" });

    expect(r).toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: true });
    expect(calls.length).toBe(4); // token, lookup, POST create, lookup
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/users"))?.url).toBe(`${ADMIN_URL}/admin/realms/civitasone/users`);
    expect(calls.every((c) => c.url.startsWith(`${ADMIN_URL}/`))).toBe(true);
  });

  it("KEYCLOAK_ADMIN_URL unset: admin token + users lookup fall back to KEYCLOAK_URL (unchanged behaviour)", async () => {
    stubKeycloakAt(PUBLIC_URL);
    const { lookupUserId } = await loadKc();

    const r = await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT });

    expect(r).toMatchObject({ ok: true, kcUserId: KCID });
    expect(calls[0]!.url).toBe(`${PUBLIC_URL}/realms/master/protocol/openid-connect/token`);
    expect(calls[1]!.url.startsWith(`${PUBLIC_URL}/admin/realms/civitasone/users?username=`)).toBe(true);
    expect(calls.every((c) => c.url.startsWith(`${PUBLIC_URL}/`))).toBe(true);
  });

  it("KEYCLOAK_ADMIN_URL empty: treated as unset, falls back to KEYCLOAK_URL", async () => {
    vi.stubEnv("KEYCLOAK_ADMIN_URL", "");
    stubKeycloakAt(PUBLIC_URL);
    const { lookupUserId, isKeycloakEnabled } = await loadKc();

    expect(isKeycloakEnabled()).toBe(true);
    expect(await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT })).toMatchObject({ ok: true, kcUserId: KCID });
    expect(calls.every((c) => c.url.startsWith(`${PUBLIC_URL}/`))).toBe(true);
  });
});
