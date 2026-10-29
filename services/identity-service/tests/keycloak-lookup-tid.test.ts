/**
 * FQ14 security review of PR #2379, finding 5: a Keycloak id may be recorded as
 * an identity user's mapping (users.users.keycloak_user_id) only when the realm
 * user carries a `tid` attribute EQUAL to the target tenant. A realm user with
 * no tid is skipped and reported, never mapped. fetch is mocked (no Keycloak).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lookupUserId, reconcileUser, provisionUser } from "../src/shared/keycloak.js";

const KC_URL = "http://keycloak.test";
const TENANT = "f0144000-0000-4000-8000-0000000000a1";
const OTHER  = "f0144000-0000-4000-8000-0000000000b1";
const IDENT  = "f0144000-0000-4000-8000-0000000000e1";
const EMAIL  = "fq14tid@dept.gov.in";
const KCID   = "f0144000-0000-4000-8000-00000000cc01";

type RealmUser = { id: string; enabled: boolean; username?: string; attributes?: Record<string, string[]> };
let byUsername: RealmUser[] = [];
let byAttribute: RealmUser[] = [];

beforeEach(() => {
  vi.stubEnv("KEYCLOAK_URL", KC_URL);
  vi.stubEnv("KEYCLOAK_REALM", "civitasone");
  vi.stubEnv("KEYCLOAK_ADMIN_USER", "admin");
  vi.stubEnv("KEYCLOAK_ADMIN_PASSWORD", "test-admin-pw");
  byUsername = [];
  byAttribute = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "test-admin-token", expires_in: 300 }), { status: 200 });
    }
    if (url.includes("/users?username=")) return new Response(JSON.stringify(byUsername), { status: 200 });
    if (url.includes("/users?q=")) return new Response(JSON.stringify(byAttribute), { status: 200 });
    throw new Error(`unexpected fetch in test: ${init?.method ?? "GET"} ${url}`);
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const named = (attributes?: Record<string, string[]>): RealmUser =>
  ({ id: KCID, enabled: true, username: `${TENANT}__${EMAIL}`, ...(attributes ? { attributes } : {}) });

describe("keycloak lookupUserId requires tid == tenant", () => {
  it("username hit with matching tid: mapped", async () => {
    byUsername = [named({ tid: [TENANT] })];
    expect(await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT }))
      .toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: true });
  });

  it("username hit WITHOUT tid: skipped and reported as tid_missing, no kcUserId", async () => {
    byUsername = [named()];
    const r = await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT });
    expect(r.kcUserId).toBeUndefined();
    expect(r.reason).toMatch(/^tid_missing/);
  });

  it("attribute hit without tid, or with another tenant's tid: never mapped", async () => {
    byAttribute = [{ id: KCID, enabled: true, attributes: { identity_user_id: [IDENT] } }];
    expect((await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT })).kcUserId).toBeUndefined();
    byAttribute = [{ id: KCID, enabled: true, attributes: { identity_user_id: [IDENT], tid: [OTHER] } }];
    expect((await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT })).kcUserId).toBeUndefined();
    byAttribute = [{ id: KCID, enabled: true, attributes: { identity_user_id: [IDENT], tid: [TENANT] } }];
    expect(await lookupUserId({ tenantId: TENANT, email: EMAIL, identityUserId: IDENT }))
      .toMatchObject({ kcUserId: KCID, tenantVerified: true });
  });

  it("reconcile/provision report tenantVerified=false for a realm user without tid (callers then do not map it)", async () => {
    byUsername = [named()];
    const rec = await reconcileUser({ id: IDENT, tenantId: TENANT, email: EMAIL, name: "T", active: true });
    expect(rec).toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: false });
    const prov = await provisionUser({ id: IDENT, tenantId: TENANT, email: EMAIL, name: "T" });
    expect(prov).toMatchObject({ ok: true, kcUserId: KCID, tenantVerified: false });
    byUsername = [named({ tid: [TENANT] })];
    expect(await reconcileUser({ id: IDENT, tenantId: TENANT, email: EMAIL, name: "T", active: true }))
      .toMatchObject({ tenantVerified: true });
  });
});
