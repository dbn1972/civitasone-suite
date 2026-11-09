/**
 * UAT onboarding gap: federated Keycloak users never got a tenant attribute recorded.
 *
 * Root cause: the realm runs Keycloak 24 with a declarative user profile that does not
 * declare `tid` / `identity_user_id` / `email_addr`, so Keycloak silently drops them on
 * create; the only attribute the realm manages (and the one the `tenant-id-mapper` turns
 * into the `tid` token claim) is `tenantId`. keycloak-reconcile therefore always answered
 * tid_missing and users.users.keycloak_user_id was never set.
 *
 * So identity-service must (a) stamp the `tenantId` attribute on create and (b) accept it,
 * not only `tid`, as proof that a realm user belongs to the tenant. fetch is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lookupUserId, reconcileUser, provisionUser } from "../src/shared/keycloak.js";

const TENANT = "8dcb509d-0000-4000-8000-0000000000a1";
const OTHER = "8dcb509d-0000-4000-8000-0000000000b1";
const IDENT = "8dcb509d-0000-4000-8000-0000000000e1";
const EMAIL = "dm.thane@maharashtra.gov.in";
const KCID = "8dcb509d-0000-4000-8000-00000000cc01";

type RealmUser = { id: string; enabled: boolean; username?: string; attributes?: Record<string, string[]> };
let byUsername: RealmUser[] = [];
let created: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.stubEnv("KEYCLOAK_URL", "http://keycloak.test");
  vi.stubEnv("KEYCLOAK_REALM", "civitasone");
  vi.stubEnv("KEYCLOAK_ADMIN_USER", "admin");
  vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "test-admin-pw");
  byUsername = [];
  created = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 300 }), { status: 200 });
    if (url.includes("/users?username=")) return new Response(JSON.stringify(byUsername), { status: 200 });
    if (init?.method === "POST" && url.endsWith("/users")) {
      created.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected fetch in test: ${init?.method ?? "GET"} ${url}`);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const named = (attributes?: Record<string, string[]>): RealmUser =>
  ({ id: KCID, enabled: true, username: `${TENANT}__${EMAIL}`, ...(attributes ? { attributes } : {}) });

describe("tenant attribute on federated realm users", () => {
  it("provisionUser stamps the managed `tenantId` attribute (the mapper source), alongside tid", async () => {
    await provisionUser({ id: IDENT, tenantId: TENANT, email: EMAIL, name: "Sunita Deshmukh" });
    expect(created).toHaveLength(1);
    const attrs = created[0]!.attributes as Record<string, string[]>;
    expect(attrs.tenantId).toEqual([TENANT]);
    expect(attrs.tid).toEqual([TENANT]);
  });

  it("a realm user carrying only `tenantId` for this tenant is verified and mapped", async () => {
    byUsername = [named({ tenantId: [TENANT] })];
    expect(await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT }))
      .toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: true });
    expect(await reconcileUser({ id: IDENT, tenantId: TENANT, email: EMAIL, name: "Sunita Deshmukh", active: true }))
      .toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: true });
  });

  it("another tenant's tenantId, or tenantId and tid disagreeing, is never verified", async () => {
    byUsername = [named({ tenantId: [OTHER] })];
    expect((await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT })).kcUserId).toBeUndefined();
    byUsername = [named({ tenantId: [TENANT], tid: [OTHER] })];
    expect((await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT })).kcUserId).toBeUndefined();
  });
});
