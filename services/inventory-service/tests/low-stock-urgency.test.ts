/**
 * Low-stock report on real Postgres: biggest shortfall first (not alphabetical), a
 * capped page therefore keeps the most urgent items, and the response carries the
 * true total independent of limit/offset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { items } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { stockBalances } from "../src/modules/movements/schema.js";
import * as queries from "../src/modules/movements/queries.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const STORE = randomUUID();

// name, reorderLevel, onHand  -> shortfall
const SEED: Array<[string, number, number]> = [
  ["Aaa mild", 10, 9],      // 1
  ["Bbb severe", 100, 0],   // 100
  ["Ccc medium", 50, 30],   // 20
  ["Ddd at-level", 5, 5],   // 0 (still reported: on hand <= level)
  ["Eee healthy", 10, 50],  // not low
  ["Fff no-policy", 0, 0],  // reorder level 0: not tracked
];

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(stores).values({ id: STORE, tenantId: TENANT, name: "Urgency Store", code: "UR-1", createdBy: ACTOR, updatedBy: ACTOR });
    for (const [name, level, onHand] of SEED) {
      const id = randomUUID();
      await tx.insert(items).values({ id, tenantId: TENANT, name, reorderLevel: level, reorderQty: level * 2, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(stockBalances).values({ tenantId: TENANT, itemId: id, storeId: STORE, onHandQty: onHand });
    }
  }));
});

// Remove everything this suite seeded. The stock_balances rows deliberately have no
// matching stock_ledger entries, so leaving them behind makes the cross-tenant
// DQ-INV-01 balance/ledger reconciliation (data-quality.test.ts) report them.
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(stockBalances).where(eq(stockBalances.tenantId, TENANT));
    await tx.delete(items).where(eq(items.tenantId, TENANT));
    await tx.delete(stores).where(eq(stores.tenantId, TENANT));
  }));
});

describe("listLowStock urgency + total", () => {
  it("orders by shortfall (largest first) and reports the full total", async () => {
    const res = await runWithTenant(TENANT, () => queries.listLowStock(TENANT, 100, 0));
    expect(res.data.map((r) => r.name)).toEqual(["Bbb severe", "Ccc medium", "Aaa mild", "Ddd at-level"]);
    expect(res.meta).toEqual({ total: 4, limit: 100, offset: 0 });
  });

  it("a capped page keeps the most urgent rows and still reports the true total; offset pages continue the order", async () => {
    const first = await runWithTenant(TENANT, () => queries.listLowStock(TENANT, 2, 0));
    expect(first.data.map((r) => r.name)).toEqual(["Bbb severe", "Ccc medium"]);
    expect(first.meta.total).toBe(4);
    const second = await runWithTenant(TENANT, () => queries.listLowStock(TENANT, 2, 2));
    expect(second.data.map((r) => r.name)).toEqual(["Aaa mild", "Ddd at-level"]);
    expect(second.meta.total).toBe(4);
  });
});
