/**
 * PERF-019 regression test — procurement-service tranche.
 *
 * Covers the 1 procurement-service site named in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-019 row:
 *   - grn/queries.ts::listGrns (was N+1 — via Promise.all(findGrnItemsByGrnId)
 *     per row, concurrent but still N round trips, just to take .length)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook), only counting
 * anything when DB_QUERY_DEBUG=true is set at test-run time (see
 * packages/db/src/pool.ts) — mirrors PERF-005 tranche 1's
 * perf-005-n-plus-one.test.ts files exactly. The primary assertion is
 * O(1)-not-O(N): the same function issues the SAME query count for a small
 * (3-GRN) tenant and a large (20-GRN) one.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { listGrns } from "../src/modules/grn/queries.js";

const ACTOR = "a0000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 20;

async function seed(tenant: string, n: number) {
  const vendor = {
    id: randomUUID(), tenantId: tenant, name: "PERF-019 Vendor",
    createdBy: ACTOR, updatedBy: ACTOR,
  };
  const grns = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, grnNo: `PERF019-GRN-${i}`, poRef: `PO-${i}`,
    vendorId: vendor.id, status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // 3 items per GRN, so itemCount is a real, non-trivial value.
  const items = grns.flatMap((g, i) => Array.from({ length: 3 }, (_, j) => ({
    id: randomUUID(), grnId: g.id, tenantId: tenant, poItemRef: `ITEM-${i}-${j}`,
    itemCode: `CODE-${i}-${j}`, orderedQty: 10, receivedQty: 10, acceptedQty: 10,
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values(vendor);
    await tx.insert(procurementGrns).values(grns);
    await tx.insert(procurementGrnItems).values(items);
  }));
  return { vendor, grns, items };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, tenant));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, tenant));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-019 — procurement-service N+1 fix", () => {
  it("listGrns: query count is O(1) not O(N), itemCount matches actual count (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listGrns(tenantSmall, 100, 0)));
      const { result: rows, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listGrns(tenantLarge, 100, 0)));

      // O(1): identical round-trip count whether the tenant has 3 GRNs or 20.
      // The old Promise.all(findGrnItemsByGrnId) loop made one additional
      // (concurrent but real) query per GRN.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(rows).toHaveLength(LARGE_N);
      for (const row of rows) {
        expect(row.itemCount).toBe(3);
        expect(row.vendor).toBe(large.vendor.name);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
