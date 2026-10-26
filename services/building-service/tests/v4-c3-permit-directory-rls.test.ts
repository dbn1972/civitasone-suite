/**
 * V4-C3: building.building_permit_directory is FORCE RLS. Tenant writes are isolated by tenant_isolation; the anonymous
 * verify path is admitted ONLY through the token-scoped public_verify_read policy
 * (app.permit_verification_code = the presented code). Real Postgres as the non-superuser
 * service role.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/permits/repo.js";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
afterAll(async () => { await sqlClient.end(); });

async function issue(tenantId: string) {
  const code = `V4C3${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await runWithTenant(tenantId, () => db.transaction((tx) => repo.insertPermit(tx, {
    id: randomUUID(), tenantId, applicationId: randomUUID(), permitNumber: `P-${code}`, status: "active",
    issuedAt: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2027-01-01T00:00:00Z"),
    verificationCode: code, createdBy: ACTOR, updatedBy: ACTOR,
  })));
  return code;
}
const count = async (fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<number>) =>
  db.transaction(fn);
const countWhere = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], cond: string) =>
  tx.execute(sql.raw(`SELECT count(*)::int AS n FROM building.building_permit_directory WHERE ${cond}`)) as unknown as Promise<Array<{ n: number }>>;

describe("building.building_permit_directory RLS", () => {
  it("is ENABLE + FORCE row level security", async () => {
    const rows = (await db.transaction((tx) => tx.execute(sql`SELECT relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE oid = 'building.building_permit_directory'::regclass`))) as unknown as Array<{ e: boolean; f: boolean }>;
    expect(rows[0]).toEqual({ e: true, f: true });
  });

  it("with no tenant and no code the directory is empty (not enumerable)", async () => {
    await issue(TENANT);
    const n = await count(async (tx) => (await countWhere(tx, "true"))[0]!.n);
    expect(n).toBe(0);
  });

  it("the presented code exposes exactly that one row, and nothing else", async () => {
    const a = await issue(TENANT); await issue(TENANT); await issue(OTHER);
    const only = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.permit_verification_code', ${a}, true)`);
      return (await countWhere(tx, "true"))[0]!.n;
    });
    expect(only).toBe(1);
    expect((await repo.findPublicByVerificationCode(a))?.permitNumber).toBe(`P-${a}`);
    expect(await repo.findPublicByVerificationCode("not-a-real-code")).toBeNull();
  });

  it("a tenant sees only its own rows and cannot write another tenant's row", async () => {
    const mine = await issue(TENANT); const theirs = await issue(OTHER);
    const seen = await runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      mine: (await countWhere(tx, `verification_code = '${mine}'`))[0]!.n,
      theirs: (await countWhere(tx, `verification_code = '${theirs}'`))[0]!.n,
    })));
    expect(seen).toEqual({ mine: 1, theirs: 0 });
    await expect(runWithTenant(TENANT, () => db.transaction((tx) => tx.execute(sql.raw(
      `INSERT INTO building.building_permit_directory (verification_code, tenant_id, permit_id, permit_number, status) VALUES ('x-${randomUUID()}', '${OTHER}', '${randomUUID()}', 'n', 'active')`,
    ))))).rejects.toThrow();
  });

  it("the public policy is SELECT-only: a code holder cannot update the row", async () => {
    const a = await issue(TENANT);
    const touched = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.permit_verification_code', ${a}, true)`);
      return (await tx.execute(sql.raw(`UPDATE building.building_permit_directory SET status = 'cancelled' WHERE verification_code = '${a}' RETURNING 1`))) as unknown as unknown[];
    });
    expect(touched).toHaveLength(0);
    expect((await repo.findPublicByVerificationCode(a))?.status).toBe("active");
  });
});
