/**
 * PERF-006 regression test — catalogue-service.
 *
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md names `products/repo.ts:47` →
 * `routes.ts:73`: `listByTenant(tenantId)` had no limit/offset at all, one
 * row per product, feeding GET /v1/catalogue/products/tree.
 *
 * Unlike this campaign's other PERF-006 sites, `/tree` builds a 4-level
 * parent/child hierarchy from the flat result (routes.ts's
 * buildHierarchyTree) -- it can't be split into client-paged chunks without
 * either orphaning children whose parent lands on a different page, or
 * pushing tree-reassembly onto every caller. So the fix is a generous hard
 * cap (repo.TREE_ROW_CAP = 5000) rather than real pagination: this proves
 * the query is now bounded by an explicit LIMIT regardless of how many
 * products the tenant actually has, using a small limit override so the
 * test doesn't need to seed thousands of rows to exercise it, plus one
 * check that a realistic-sized tenant (under the real 5000 default) is
 * completely unaffected.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { products } from "../src/modules/products/schema.js";
import * as productRepo from "../src/modules/products/repo.js";

const ACTOR = "80000000-cccc-4000-8000-000000000001";

afterAll(async () => { await sqlClient.end(); });

describe("PERF-006 — catalogue-service unbounded products.listByTenant", () => {
  it("caps at the requested limit regardless of how many products the tenant has, but a realistic tenant sees no rows dropped", async () => {
    const tenant = randomUUID();
    const TOTAL = 12;
    const rows = Array.from({ length: TOTAL }, (_, i) => ({
      tenantId: tenant, name: `Product ${i}`, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.insert(products).values(rows);
    }));
    try {
      // Bounded: an explicit small override never returns more than asked,
      // no matter how many rows exist underneath -- this is what
      // repo.TREE_ROW_CAP does for the real route by default (5000, not
      // reproduced here at full size so the test stays fast).
      const capped = await runWithTenant(tenant, () => productRepo.listByTenant(tenant, 5));
      expect(capped).toHaveLength(5);

      // Correctness: a tenant nowhere near the cap (the realistic case)
      // still gets every product, same as before this fix.
      const all = await runWithTenant(tenant, () => productRepo.listByTenant(tenant));
      expect(all).toHaveLength(TOTAL);
    } finally {
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.delete(products).where(eq(products.tenantId, tenant));
      }));
    }
  });
});
