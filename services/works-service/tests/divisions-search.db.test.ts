/**
 * GAP-WORKS-REPORTS-01 — works division master (works.divisions) + search.
 *
 * DB-backed against a real Postgres (DATABASE_URL from vitest.config.ts, port
 * 5672). Proves the capability the reports division picker needs end to end:
 *   1. searchDivisions matches name OR code (case-insensitive) and returns
 *      {id, name, code, officeType} — the shape the FE resolves a label from.
 *   2. Only ACTIVE divisions are returned (a deactivated division is hidden).
 *   3. An empty query returns the first `limit` active divisions (useful before
 *      the user types), name-ordered.
 *   4. STRICT tenant isolation via FORCE RLS: a tenant-A caller never sees a
 *      tenant-B division by name or code, and tenant B resolves its own.
 *
 * Mirrors the real-DB harness of tests/contractor-pan-encryption.test.ts
 * (runWithTenant + the shared db/sqlClient), not the mocked-repo route harness.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { divisions } from "../src/modules/masters/schema.js";
import { searchDivisions } from "../src/modules/masters/repo.js";

const TENANT_A = "aaaaaaaa-4444-4000-8000-0000000000a1";
const TENANT_B = "bbbbbbbb-4444-4000-8000-0000000000b2";

// Deterministic ids so cross-tenant assertions can target a specific row.
const A_PWD = randomUUID();
const A_RURAL = randomUUID();
const A_INACTIVE = randomUUID();
const B_PWD = randomUUID();

async function seedDivision(
  tenantId: string,
  id: string,
  name: string,
  code: string,
  active = true,
): Promise<void> {
  await runWithTenant(tenantId, async () => {
    await db.transaction(async (tx) => {
      await tx.insert(divisions).values({ id, tenantId, name, code, active });
    });
  });
}

// FORCE ROW LEVEL SECURITY is on works.divisions and works_svc is NOBYPASSRLS,
// so a DELETE must run with app.tenant_id set to the row's tenant or it matches
// ZERO rows. Clean each tenant's rows inside its own GUC scope.
async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await sql`DELETE FROM works.divisions WHERE tenant_id = ${tenantId}`;
    });
  }
}

beforeAll(async () => {
  // Clean any residue from a prior run (idempotent test setup).
  await cleanup();
  await seedDivision(TENANT_A, A_PWD, "Nagpur PWD Division", "NGP-PWD");
  await seedDivision(TENANT_A, A_RURAL, "Rural Roads Division", "RRD-01");
  await seedDivision(TENANT_A, A_INACTIVE, "Defunct Division", "OLD-99", false);
  await seedDivision(TENANT_B, B_PWD, "Pune PWD Division", "PUN-PWD");
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("works divisions master — searchDivisions (DB-backed, RLS)", () => {
  it("matches on name (case-insensitive) and returns the label shape", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "nagpur", 20));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: A_PWD, name: "Nagpur PWD Division", code: "NGP-PWD" });
  });

  it("matches on code (case-insensitive)", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "rrd", 20));
    expect(rows.map((r) => r.id)).toEqual([A_RURAL]);
  });

  it("hides inactive divisions", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "defunct", 20));
    expect(rows).toHaveLength(0);
  });

  it("empty query returns active divisions name-ordered", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "", 20));
    expect(rows.map((r) => r.name)).toEqual(["Nagpur PWD Division", "Rural Roads Division"]);
  });

  it("respects the limit", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "", 1));
    expect(rows).toHaveLength(1);
  });

  it("tenant A cannot see tenant B's division by name (RLS)", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "pune", 20));
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot see tenant B's division by code (RLS)", async () => {
    const rows = await runWithTenant(TENANT_A, () => searchDivisions(TENANT_A, "PUN-PWD", 20));
    expect(rows).toHaveLength(0);
  });

  it("tenant B resolves its own division", async () => {
    const rows = await runWithTenant(TENANT_B, () => searchDivisions(TENANT_B, "pune", 20));
    expect(rows.map((r) => r.id)).toEqual([B_PWD]);
  });
});
