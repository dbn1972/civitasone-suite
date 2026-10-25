/**
 * CLOS3-S4-10: findLatestApprovedVersionsByProductIds against REAL Postgres, connected as the
 * non-superuser catalogue_svc role (RLS enforced). Skips when Postgres is unreachable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import type { ScopedTx } from "../src/shared/db.js";

const EXPECTED_DB = "civitas_catalogue";
const DEFAULT_DSN = `postgres://catalogue_svc:catalogue_dev_pw@localhost:5435/${EXPECTED_DB}`;
const inherited = process.env["DATABASE_URL"];
const DSN = inherited?.includes(EXPECTED_DB) === true ? inherited : DEFAULT_DSN;
process.env["DATABASE_URL"] = DSN;

async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try { await client`SELECT 1`; return true; } catch { return false; }
  finally { await client.end({ timeout: 1 }).catch(() => undefined); }
}
const reachable = await probe();

const { db, sqlClient } = await import("../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const govRepo = await import("../src/modules/products/governance-repo.js");
const { productVersions } = await import("../src/modules/products/governance-schema.js");

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const asTenant = <T>(t: string, fn: () => Promise<T>): Promise<T> => Promise.resolve(runWithTenant(t, fn));
const tx = <T>(fn: (t: ScopedTx) => Promise<T>): Promise<T> => db.transaction(fn);

async function addVersion(tenantId: string, productId: string, versionNumber: number, status: string): Promise<void> {
  await asTenant(tenantId, () =>
    tx((t) => t.insert(productVersions).values({ tenantId, productId, versionNumber, status, createdBy: ACTOR })),
  );
}

describe.skipIf(!reachable)("findLatestApprovedVersionsByProductIds — real Postgres", () => {
  afterAll(async () => {
    for (const t of [TENANT, OTHER_TENANT]) {
      await asTenant(t, () => tx((x) => x.delete(productVersions).where(eq(productVersions.tenantId, t)))).catch(() => undefined);
    }
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("returns the highest APPROVED version per product, ignores drafts, omits unapproved products", async () => {
    const p1 = randomUUID(); const p2 = randomUUID(); const p3 = randomUUID();
    await addVersion(TENANT, p1, 1, "approved");
    await addVersion(TENANT, p1, 2, "approved");
    await addVersion(TENANT, p1, 3, "draft");
    await addVersion(TENANT, p2, 1, "approved");
    await addVersion(TENANT, p3, 1, "draft");

    const map = await asTenant(TENANT, () => govRepo.findLatestApprovedVersionsByProductIds([p1, p2, p3], TENANT));
    expect(map.get(p1)?.versionNumber).toBe(2);
    expect(map.get(p2)?.versionNumber).toBe(1);
    expect(map.has(p3)).toBe(false);
    expect(map.size).toBe(2);
  });

  it("never returns another tenant's version, even when the predicate tenantId is forged", async () => {
    const p = randomUUID();
    await addVersion(OTHER_TENANT, p, 7, "approved");
    const own = await asTenant(TENANT, () => govRepo.findLatestApprovedVersionsByProductIds([p], TENANT));
    expect(own.size).toBe(0);
    const forged = await asTenant(TENANT, () => govRepo.findLatestApprovedVersionsByProductIds([p], OTHER_TENANT));
    expect(forged.size).toBe(0); // RLS still scopes to the session tenant
  });

  it("returns an empty map for an empty id list without querying", async () => {
    const map = await asTenant(TENANT, () => govRepo.findLatestApprovedVersionsByProductIds([], TENANT));
    expect(map.size).toBe(0);
  });
});
