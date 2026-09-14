/**
 * PERF-005 tranche 2 regression test — court-service.
 *
 * NOTE ON SCOPE: court-service was not named at all in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's original PERF-005/PERF-019 rows.
 * This is a newly-discovered N+1 found by an independent codebase-wide grep
 * for the same anti-pattern (`Promise.all(items.map(async ...))` doing a
 * per-row DB call after an initial list query). See this tranche's PR
 * description for the full list of newly-discovered sites.
 *
 * Covers:
 *   - case-registry/repo.ts::getCasesByIds, the batch loader that replaced
 *     court-documents/routes.ts's cause-list PDF route calling getCaseById()
 *     once per cause-list item (N+1).
 *
 * Tested at the repo/function level (like grant/citizen/legal/procurement's
 * PERF-005/PERF-019 tests), not through the HTTP route: the route renders a
 * PDF binary, so its data-assembly correctness is best proven directly on
 * the batch loader that replaced the per-item loop; render.ts's PDF byte
 * output is already covered by tests/court-documents.test.ts and is
 * unchanged by this fix. Deliberately bypasses getCaseById's per-id
 * read-through cache (see repo.ts's comment on getCasesByIds) so this always
 * hits the DB — countQueriesDuring's count is therefore meaningful here
 * without a cache-warm/cache-cold distinction to control for.
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring), only counting anything when DB_QUERY_DEBUG=true is
 * set at test-run time — mirrors PERF-005/PERF-019's own test files.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { cases } from "../src/modules/case-registry/schema.js";
import { getCasesByIds } from "../src/modules/case-registry/repo.js";

const ACTOR = "80000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 20;

async function seedCases(tenant: string, n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, cnrNumber: `PERF005T2CNR${String(i).padStart(4, "0")}`,
    title: `Case ${i}`, status: "filed", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(cases).values(rows)));
  return rows;
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction((tx) => tx.delete(cases).where(eq(cases.tenantId, tenant))));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-005 tranche 2 — court-service N+1 fix", () => {
  it("getCasesByIds: query count is O(1) not O(N), every requested case resolves correctly (was N+1 via getCaseById per item)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedCases(tenantSmall, SMALL_N);
    const large = await seedCases(tenantLarge, LARGE_N);
    try {
      // Warm-up (untimed): postgres-js resolves the element-type OID for an
      // array-bound parameter (inArray(ids) in getCasesByIds) lazily on its
      // first use per process/connection, as an extra round trip that would
      // otherwise land arbitrarily on whichever of the two MEASURED calls
      // below happens to run first and break the O(1) comparison (see
      // estab-service's sibling perf-005-tranche2 test for the fuller
      // writeup, including a second, cache-collision-shaped failure mode
      // this function doesn't have: getCasesByIds deliberately bypasses
      // getCaseById's read-through cache entirely -- see this file's header
      // comment and repo.ts's comment on getCasesByIds -- so there is no
      // cache key for a warm-up to collide with). Reuses tenantSmall's own
      // real seeded ids so the inArray() query actually executes rather
      // than short-circuiting on an empty id list.
      await runWithTenant(tenantSmall, () => getCasesByIds(tenantSmall, small.map((c) => c.id)));

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => getCasesByIds(tenantSmall, small.map((c) => c.id))));
      const { result: byId, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => getCasesByIds(tenantLarge, large.map((c) => c.id))));

      // O(1): identical round-trip count whether 3 case ids or 20 are
      // requested. The old per-item getCaseById() loop would have made ~17
      // more queries (or cache lookups) for 20 items than 3.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(10);

      expect(byId.size).toBe(LARGE_N);
      for (const seeded of large) {
        expect(byId.get(seeded.id)?.cnrNumber).toBe(seeded.cnrNumber);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("getCasesByIds: ids from another tenant or that don't exist are simply absent from the Map (tenant-scoped, no cross-tenant leak)", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const casesA = await seedCases(tenantA, 2);
    const casesB = await seedCases(tenantB, 2);
    try {
      const byId = await runWithTenant(tenantA, () =>
        getCasesByIds(tenantA, [...casesA.map((c) => c.id), ...casesB.map((c) => c.id), randomUUID()]));
      expect(byId.size).toBe(2);
      for (const c of casesA) expect(byId.has(c.id)).toBe(true);
      for (const c of casesB) expect(byId.has(c.id)).toBe(false);
    } finally {
      await wipe(tenantA);
      await wipe(tenantB);
    }
  });
});
