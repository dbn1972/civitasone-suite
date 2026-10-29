/**
 * FQ14 — internal user lookups resolve a Keycloak sub, tenant-scoped.
 *
 * Every other service holds a login as its JWT `sub`, which is the KEYCLOAK
 * user id; users.users.id is identity-service's own id. Before migration 0033
 * /identity/internal/users/:id/email|status only matched users.users.id, so
 * every real login 404'd there and HRMS could never link a login to its
 * employee record. Real Postgres (FORCE RLS) + real Fastify; Keycloak is the
 * only thing mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";

vi.mock("../src/shared/keycloak.js", async (orig) => ({
  ...(await orig<typeof import("../src/shared/keycloak.js")>()),
  reconcileUser: vi.fn(),
  lookupUserId: vi.fn(),
}));
import * as keycloak from "../src/shared/keycloak.js";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { persistKeycloakUserId, backfillKeycloakUserIds } from "../src/modules/users/keycloak-link.js";

const SECRET = process.env.JWT_SECRET as string;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test-internal-service-secret-32chr";

const TA = "f0141000-0000-4000-8000-0000000000a1";
const TB = "f0141000-0000-4000-8000-0000000000b1";
const BY = "f0141000-0000-4000-8000-000000000099";
const USER_A  = "f0141000-0000-4000-8000-0000000a0001";
const KC_A    = "f0141000-0000-4000-8000-00000000cc01";
const USER_A2 = "f0141000-0000-4000-8000-0000000a0002"; // no mapping yet (backfill target)
const USER_A3 = "f0141000-0000-4000-8000-0000000a0003"; // not found in Keycloak
const USER_B  = "f0141000-0000-4000-8000-0000000b0001";
const KC_B    = "f0141000-0000-4000-8000-00000000cc02";
const KC_A2   = "f0141000-0000-4000-8000-00000000cc03";

const internal = (tid: string) => ({ "x-internal": "1", "x-tenant-id": tid, "x-service-secret": INTERNAL_SECRET });

let app: Awaited<ReturnType<typeof buildApp>>;

async function wipe(): Promise<void> {
  for (const t of [TA, TB]) await withRawTenantGuc(sqlClient, t, (tx) => tx`DELETE FROM users.users WHERE tenant_id = ${t}`);
}
async function seed(t: string, id: string, email: string, kc: string | null): Promise<void> {
  await withRawTenantGuc(sqlClient, t, (tx) => tx`
    INSERT INTO users.users (id, tenant_id, email, name, status, keycloak_user_id, created_by, updated_by)
    VALUES (${id}, ${t}, ${email}, ${"User " + email}, 'active', ${kc}, ${BY}, ${BY})`);
}
async function kcOf(t: string, id: string): Promise<string | null> {
  const rows = await withRawTenantGuc(sqlClient, t, (tx) => tx`SELECT keycloak_user_id FROM users.users WHERE id = ${id}`);
  return (rows[0]?.keycloak_user_id as string | null) ?? null;
}

beforeAll(async () => {
  await wipe();
  await seed(TA, USER_A, "fq14a@dept.gov.in", KC_A);
  await seed(TA, USER_A2, "fq14a2@dept.gov.in", null);
  await seed(TA, USER_A3, "fq14a3@dept.gov.in", null);
  await seed(TB, USER_B, "fq14b@other.gov.in", KC_B);
  app = await buildApp();
});
afterAll(async () => {
  await wipe();
  await app.close();
});

describe("GET /identity/internal/users/:id/email|status by identity id or Keycloak sub", () => {
  it("lookup by identity id still works", async () => {
    const res = await app.inject({ method: "GET", url: `/identity/internal/users/${USER_A}/email`, headers: internal(TA) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: USER_A, email: "fq14a@dept.gov.in" });
  });

  it("lookup by Keycloak sub resolves the same user (email and status)", async () => {
    const email = await app.inject({ method: "GET", url: `/identity/internal/users/${KC_A}/email`, headers: internal(TA) });
    expect(email.statusCode).toBe(200);
    expect(email.json()).toEqual({ id: USER_A, email: "fq14a@dept.gov.in" });
    const status = await app.inject({ method: "GET", url: `/identity/internal/users/${KC_A}/status`, headers: internal(TA) });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ id: USER_A, status: "active" });
  });

  it("a Keycloak sub (or identity id) from another tenant 404s", async () => {
    for (const id of [KC_B, USER_B]) {
      for (const leaf of ["email", "status"]) {
        const res = await app.inject({ method: "GET", url: `/identity/internal/users/${id}/${leaf}`, headers: internal(TA) });
        expect(res.statusCode).toBe(404);
      }
    }
  });

  it("still refuses an ordinary authenticated user (403)", async () => {
    const res = await app.inject({
      method: "GET", url: `/identity/internal/users/${KC_A}/email`,
      headers: { authorization: `Bearer ${signToken({ sub: KC_A, tid: TA, roles: ["employee"], sid: "s-fq14" }, SECRET, 3600)}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("keycloak_user_id mapping writes", () => {
  it("persistKeycloakUserId never overwrites a different mapping and refuses a Keycloak id already used", async () => {
    expect(await persistKeycloakUserId(TA, USER_A, KC_A)).toBe("unchanged");
    expect(await persistKeycloakUserId(TA, USER_A, KC_A2)).toBe("conflict");
    expect(await kcOf(TA, USER_A)).toBe(KC_A);
    expect(await persistKeycloakUserId(TA, USER_A2, KC_A)).toBe("conflict"); // unique index
    expect(await kcOf(TA, USER_A2)).toBeNull();
    expect(await persistKeycloakUserId(TA, USER_B, KC_A2)).toBe("not_found"); // other tenant's user
  });

  it("backfill: dry run writes nothing; --apply maps matched users and reports the unmatched", async () => {
    vi.mocked(keycloak.lookupUserId).mockImplementation(async (u) =>
      u.identityUserId === USER_A2 ? { ok: true, kcUserId: KC_A2, tenantVerified: true }
        : u.identityUserId === USER_A3 ? { ok: true, reason: "tid_missing: realm user has no tid attribute for this tenant" }
          : { ok: true, reason: "user not present in keycloak" });

    const dry = await backfillKeycloakUserIds({ tenantId: TA, apply: false });
    expect(dry).toMatchObject({ scanned: 2, wouldLink: 1, linked: 0, unmatched: [], tidMissing: [USER_A3] });
    expect(await kcOf(TA, USER_A2)).toBeNull();

    const real = await backfillKeycloakUserIds({ tenantId: TA, apply: true });
    expect(real).toMatchObject({ scanned: 2, linked: 1, unmatched: [], tidMissing: [USER_A3], conflicts: [] });
    expect(await kcOf(TA, USER_A3)).toBeNull();
    expect(await kcOf(TA, USER_A2)).toBe(KC_A2);
    // Only this tenant's users were looked at.
    expect(vi.mocked(keycloak.lookupUserId).mock.calls.every(([u]) => u.tenantId === TA)).toBe(true);

    const res = await app.inject({ method: "GET", url: `/identity/internal/users/${KC_A2}/status`, headers: internal(TA) });
    expect(res.json()).toEqual({ id: USER_A2, status: "active" });
  });

  it("POST /identity/users/:id/keycloak-reconcile never maps a realm user without this tenant's tid", async () => {
    const KC_A3 = "f0141000-0000-4000-8000-00000000cc04";
    vi.mocked(keycloak.reconcileUser).mockResolvedValueOnce({ ok: true, kcUserId: KC_A3, tenantVerified: false, reason: "already in sync" });
    const res = await app.inject({
      method: "POST", url: `/identity/users/${USER_A3}/keycloak-reconcile`,
      headers: { authorization: `Bearer ${signToken({ sub: BY, tid: TA, roles: ["super_admin"], sid: "s-fq14b" }, SECRET, 3600)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().keycloakUserIdLink).toBe("tid_missing");
    expect(await kcOf(TA, USER_A3)).toBeNull();
  });

  it("POST /identity/users/:id/keycloak-reconcile records the mapping", async () => {
    const KC_A3 = "f0141000-0000-4000-8000-00000000cc04";
    vi.mocked(keycloak.reconcileUser).mockResolvedValueOnce({ ok: true, kcUserId: KC_A3, tenantVerified: true, reason: "already in sync" });
    const res = await app.inject({
      method: "POST", url: `/identity/users/${USER_A3}/keycloak-reconcile`,
      headers: { authorization: `Bearer ${signToken({ sub: BY, tid: TA, roles: ["super_admin"], sid: "s-fq14a" }, SECRET, 3600)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().keycloakUserIdLink).toBe("linked");
    expect(await kcOf(TA, USER_A3)).toBe(KC_A3);
  });
});
