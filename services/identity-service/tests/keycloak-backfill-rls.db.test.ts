/**
 * FQ16 — the keycloak_user_id backfill must see the tenant's users under RLS.
 *
 * users.users is FORCE RLS and identity_svc is NOBYPASSRLS. The backfill CLI
 * calls backfillKeycloakUserIds() with no request (so no tenant in
 * AsyncLocalStorage); its reads ran with app.tenant_id unset, saw ZERO rows,
 * and the dry run reported `scanned: 0` with exit 0 for every UAT tenant while
 * all 29 users were still unmapped. Real Postgres as the service role; only
 * the Keycloak lookup is stubbed. Called exactly as the CLI calls it: outside
 * any runWithTenant / request context.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { withRawTenantGuc, getCurrentTenantId } from "@civitasone/db";

vi.mock("../src/shared/keycloak.js", async (orig) => ({
  ...(await orig<typeof import("../src/shared/keycloak.js")>()),
  lookupUserId: vi.fn(),
}));
import * as keycloak from "../src/shared/keycloak.js";
import { sqlClient } from "../src/shared/db.js";
import { backfillKeycloakUserIds } from "../src/modules/users/keycloak-link.js";

const TA = "f0161000-0000-4000-8000-0000000000a1";
const TB = "f0161000-0000-4000-8000-0000000000b1";
const T_EMPTY = "f0161000-0000-4000-8000-0000000000e1";
const BY = "f0161000-0000-4000-8000-000000000099";
const A1 = "f0161000-0000-4000-8000-0000000a0001";
const A2 = "f0161000-0000-4000-8000-0000000a0002";
const A_MAPPED = "f0161000-0000-4000-8000-0000000a0003";
const B1 = "f0161000-0000-4000-8000-0000000b0001";
const B2 = "f0161000-0000-4000-8000-0000000b0002";
const KC_A_MAPPED = "f0161000-0000-4000-8000-00000000cc00";
// Deterministic fake Keycloak id per identity user (last 12 hex digits kept).
const kcFor = (id: string) => `f0161000-0000-4000-8000-0000cc${id.slice(-6)}`;

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
  // The bug only shows under a role RLS applies to; make sure that is what we run as.
  const [role] = await sqlClient`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  expect(role).toMatchObject({ rolsuper: false, rolbypassrls: false });
  const [force] = await sqlClient`SELECT relforcerowsecurity FROM pg_class WHERE oid = 'users.users'::regclass`;
  expect(force?.relforcerowsecurity).toBe(true);

  await wipe();
  await seed(TA, A1, "fq16a1@dept.gov.in", null);
  await seed(TA, A2, "fq16a2@dept.gov.in", null);
  await seed(TA, A_MAPPED, "fq16a3@dept.gov.in", KC_A_MAPPED);
  await seed(TB, B1, "fq16b1@other.gov.in", null);
  await seed(TB, B2, "fq16b2@other.gov.in", null);
});
afterAll(async () => {
  await wipe();
  await sqlClient.end();
});
beforeEach(() => {
  vi.mocked(keycloak.lookupUserId).mockReset();
  vi.mocked(keycloak.lookupUserId).mockImplementation(async (u) =>
    ({ ok: true, kcUserId: kcFor(u.identityUserId ?? ""), tenantVerified: true }));
});

const lookedUp = () => vi.mocked(keycloak.lookupUserId).mock.calls.map(([u]) => ({ tenantId: u.tenantId, id: u.identityUserId }));

describe("backfillKeycloakUserIds under FORCE RLS as the NOBYPASSRLS service role (CLI context)", () => {
  it("runs outside any tenant context, like the CLI", () => {
    expect(getCurrentTenantId()).toBeUndefined();
  });

  it("dry run scans exactly this tenant's unmapped users and writes nothing", async () => {
    const dry = await backfillKeycloakUserIds({ tenantId: TA, apply: false });
    expect(dry).toMatchObject({ tenantId: TA, apply: false, tenantUsers: 3, scanned: 2, wouldLink: 2, linked: 0, unmatched: [], tidMissing: [], conflicts: [], errors: [] });
    expect(lookedUp()).toEqual([{ tenantId: TA, id: A1 }, { tenantId: TA, id: A2 }]);
    expect(await kcOf(TA, A1)).toBeNull();
    expect(await kcOf(TA, A2)).toBeNull();
    expect(await kcOf(TB, B1)).toBeNull();
  });

  it("--apply links this tenant's users and leaves the other tenant alone", async () => {
    const real = await backfillKeycloakUserIds({ tenantId: TA, apply: true, pageSize: 1 });
    expect(real).toMatchObject({ tenantUsers: 3, scanned: 2, linked: 2, wouldLink: 0, unmatched: [], conflicts: [], errors: [] });
    expect(await kcOf(TA, A1)).toBe(kcFor(A1));
    expect(await kcOf(TA, A2)).toBe(kcFor(A2));
    expect(await kcOf(TA, A_MAPPED)).toBe(KC_A_MAPPED);
    expect(await kcOf(TB, B1)).toBeNull();
    expect(await kcOf(TB, B2)).toBeNull();
    expect(lookedUp().every((c) => c.tenantId === TA)).toBe(true);

    // Re-running is a no-op: nothing left to scan, but the tenant is visible.
    const again = await backfillKeycloakUserIds({ tenantId: TA, apply: true });
    expect(again).toMatchObject({ tenantUsers: 3, scanned: 0, linked: 0 });
  });

  it("the other tenant scans exactly its own rows", async () => {
    const dry = await backfillKeycloakUserIds({ tenantId: TB, apply: false });
    expect(dry).toMatchObject({ tenantUsers: 2, scanned: 2, wouldLink: 2 });
    expect(lookedUp()).toEqual([{ tenantId: TB, id: B1 }, { tenantId: TB, id: B2 }]);
  });

  it("a tenant with nothing visible reports tenantUsers 0, distinguishable from 'all linked'", async () => {
    const r = await backfillKeycloakUserIds({ tenantId: T_EMPTY, apply: false });
    expect(r).toMatchObject({ tenantUsers: 0, scanned: 0 });
    expect(lookedUp()).toEqual([]);
  });
});
