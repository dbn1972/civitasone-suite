/**
 * SEC-025 — two independent hardening follow-ups from SEC-007's review
 * (identity-service's per-tenant SCIM token system):
 *
 *   1. scim.scim_tokens deliberately shipped with NO RLS at all (migration
 *      0022) — necessary because findBySecretHash must discover the tenant
 *      from a bearer token before any tenant is known, and a normal
 *      FORCE-RLS tenant policy would make that lookup return zero rows for
 *      everyone. That left the write paths (insert/touchLastUsed/revoke,
 *      token-repo.ts) relying solely on application-code tenant_id
 *      filtering, with no DB-level backstop if that code ever had a bug.
 *      migration 0024 adds a hybrid policy set: SELECT stays permissive
 *      (USING (true)), INSERT/UPDATE/DELETE are tenant-scoped for the first
 *      time. GROUP 1 below proves both halves empirically against a real
 *      Postgres connection — not a reimplementation of the policy.
 *
 *   2. POST/GET /identity/scim-tokens and the revoke route (all added by
 *      SEC-007) had no test confirming a non-admin role gets 403.
 *      requireRole/hasAnyRole is shared, pre-existing code, but this gap's
 *      own PR never exercised the negative case for ITS OWN three routes.
 *      GROUP 2 below adds it, mirroring sessions-apikeys-routes.test.ts's
 *      existing "→ 403 for employee" convention for the sibling
 *      /identity/api-keys routes.
 *
 * DB-gated: skipped unless a reachable identity DB is present (same
 * convention as apikeys-breakglass.db.test.ts / sec-024's route test).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db } from "../src/shared/db.js";
import { scimTokens } from "../src/modules/scim/schema.js";
import * as tokenRepo from "../src/modules/scim/token-repo.js";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

function jwt(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sec025-sess" } as never, SECRET);
}
const authHeaders = (roles: string[], tid: string) => ({ authorization: `Bearer ${jwt(roles, tid)}` });

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

// ── GROUP 1 — DB-level RLS backstop ─────────────────────────────────────────
describe.skipIf(!RUN_DB)("SEC-025 — scim.scim_tokens: DB-level RLS backstop for writes", () => {
  const TENANT_A = "e1000000-0000-4000-8000-0000000000a1";
  const TENANT_B = "e1000000-0000-4000-8000-0000000000b1";
  const ROW_A = randomUUID();
  const ROW_B = randomUUID();
  const HASH_B = "b".repeat(64);

  beforeAll(async () => {
    // Seed one row per tenant via the correct tenant-scoped path (each
    // insert's own GUC matches the row's own tenant) — same idiom as
    // SEC-009's fix notes ("seed via the correct tenant-scoped path, then
    // prove ..."). Talks to the schema directly (not tokenRepo) so this
    // group tests the TABLE's own policies, independent of any additional
    // filtering application code layers on top.
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx.insert(scimTokens).values({
          id: ROW_A, tenantId: TENANT_A, name: "sec025-fixture-a",
          tokenPrefix: "scim_live_sec025a", secretHash: "a".repeat(64),
          status: "active", createdBy: TENANT_A,
        }),
      ),
    );
    await runWithTenant(TENANT_B, () =>
      db.transaction((tx) =>
        tx.insert(scimTokens).values({
          id: ROW_B, tenantId: TENANT_B, name: "sec025-fixture-b",
          tokenPrefix: "scim_live_sec025b", secretHash: HASH_B,
          status: "active", createdBy: TENANT_B,
        }),
      ),
    );
  });

  afterAll(async () => {
    // Best-effort cleanup, each row under its own tenant's GUC (a plain
    // unscoped DELETE would now correctly do nothing — see the DELETE test
    // below — so cleanup must use the row's own tenant, not skip RLS).
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.delete(scimTokens).where(eq(scimTokens.id, ROW_A))),
    );
    await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.delete(scimTokens).where(eq(scimTokens.id, ROW_B))),
    );
  });

  it("carries ENABLE + FORCE ROW LEVEL SECURITY (migration 0024)", async () => {
    const res = await db.execute(
      sql`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'scim_tokens'`,
    );
    // Normalize across driver result shapes (postgres.js returns an
    // array-like result directly; some wrappers nest it under `.rows`) —
    // this helper test only needs whichever shape actually comes back.
    type Row = { relrowsecurity: boolean; relforcerowsecurity: boolean };
    const rows = (Array.isArray(res) ? res : (res as unknown as { rows: Row[] }).rows) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it("UPDATE outside the row's own bound tenant is rejected — 0 rows affected, row unchanged", async () => {
    const res = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx
          .update(scimTokens)
          .set({ status: "revoked" })
          .where(eq(scimTokens.id, ROW_B))
          .returning({ id: scimTokens.id }),
      ),
    );
    expect(res).toHaveLength(0);

    const [stillA] = await db.select().from(scimTokens).where(eq(scimTokens.id, ROW_B));
    expect(stillA.status).toBe("active");
    expect(stillA.tenantId).toBe(TENANT_B);
  });

  it("DELETE outside the row's own bound tenant is rejected — 0 rows affected, row still exists", async () => {
    const res = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.delete(scimTokens).where(eq(scimTokens.id, ROW_B)).returning({ id: scimTokens.id })),
    );
    expect(res).toHaveLength(0);

    const [stillThere] = await db.select().from(scimTokens).where(eq(scimTokens.id, ROW_B));
    expect(stillThere).toBeDefined();
  });

  it("INSERT claiming a tenant other than the GUC's own tenant is rejected outright", async () => {
    await expect(
      runWithTenant(TENANT_A, () =>
        db.transaction((tx) =>
          tx.insert(scimTokens).values({
            id: randomUUID(), tenantId: TENANT_B, name: "sec025-forged",
            tokenPrefix: "scim_live_forged", secretHash: "f".repeat(64),
            status: "active", createdBy: TENANT_A,
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("control: a write inside the row's own bound tenant still succeeds normally", async () => {
    const res = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx
          .update(scimTokens)
          .set({ status: "revoked" })
          .where(eq(scimTokens.id, ROW_A))
          .returning({ id: scimTokens.id }),
      ),
    );
    expect(res).toHaveLength(1);
  });

  it("control: SELECT-by-hash still works with NO tenant GUC set at all (findBySecretHash unaffected)", async () => {
    // Deliberately NOT wrapped in runWithTenant/db.transaction — this is the
    // exact shape resolveScimTenant calls it in (routes.ts), before any
    // tenant is known. Proves the permissive SELECT policy (migration 0024)
    // keeps this tenant-blind lookup working exactly as before the fix.
    const row = await tokenRepo.findBySecretHash(db, HASH_B);
    expect(row?.id).toBe(ROW_B);
    expect(row?.tenantId).toBe(TENANT_B);
  });
});

// ── GROUP 2 — negative-role (403) coverage for the 3 token-management routes ─
describe("SEC-025 — scim-tokens routes reject a non-admin role", () => {
  const TENANT = "e1000000-0000-4000-8000-0000000000c1";

  it("POST /identity/scim-tokens → 403 for a non-admin (employee) role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/identity/scim-tokens",
      headers: authHeaders(["employee"], TENANT),
      payload: { name: "should-never-be-created" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /identity/scim-tokens → 403 for a non-admin (employee) role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/identity/scim-tokens",
      headers: authHeaders(["employee"], TENANT),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /identity/scim-tokens/:id/revoke → 403 for a non-admin (employee) role", async () => {
    // requireRole runs before the id param is even parsed/looked up, so a
    // random id that names no real token is sufficient — the 403 must fire
    // first regardless of whether the token exists.
    const res = await app.inject({
      method: "POST",
      url: `/identity/scim-tokens/${randomUUID()}/revoke`,
      headers: authHeaders(["employee"], TENANT),
    });
    expect(res.statusCode).toBe(403);
  });

  it("control: platform_admin CAN reach POST /identity/scim-tokens (200/201, not 403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/identity/scim-tokens",
      headers: authHeaders(["platform_admin"], TENANT),
      payload: { name: "sec025-control-admin-can" },
    });
    expect(res.statusCode).toBe(201);
  });
});
