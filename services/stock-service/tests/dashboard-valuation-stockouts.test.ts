/**
 * GAP-STOCK-DASHBOARD-04 / GAP-STOCK-DASHBOARD-06 — stock dashboard query.
 *
 * - inventoryValue is SUM(qty * rate_minor) in paise (minor units): one item
 *   with qty 10 at ₹5.00 (500 paise) => 5000, NOT 50000 and NOT 5.
 * - stockOuts counts active items whose on-hand qty is <= 0 (new field; the UI
 *   tile was previously a hard-coded "—").
 * - lowStockAlerts counts items under their reorder level.
 * Real Postgres, tenant scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { stockItems, stockItemCategories, stockUoms } from "../src/modules/item/schema.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "da5b0000-0000-4000-8000-0000000da001";
const ACTOR = "da5b0000-0000-4000-8000-0000000da00a";
const CAT = "da5b0000-0000-4000-8000-0000000dac01";
const UOM = "da5b0000-0000-4000-8000-0000000dad01";
const STOCKED = "da5b0000-0000-4000-8000-0000000d0001"; // qty 10 @ 500 paise, reorder 5 -> OK
const LOW = "da5b0000-0000-4000-8000-0000000d0002";     // qty 2 @ 0, reorder 5 -> low
const OUT = "da5b0000-0000-4000-8000-0000000d0003";     // qty 0 -> stock-out (and low)
const WH = "da5b0000-0000-4000-8000-0000000d00f1";

const hdr = (roles: string[] = ["stock_manager"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "sess-dash" }, SECRET, 3600)}`,
  "x-tenant-id": T,
});

let app: FastifyInstance;

async function clean() {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, T));
    await tx.delete(stockItems).where(eq(stockItems.tenantId, T));
    await tx.delete(stockItemCategories).where(eq(stockItemCategories.tenantId, T));
    await tx.delete(stockUoms).where(eq(stockUoms.tenantId, T));
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await clean();
  const audit = { createdBy: ACTOR, updatedBy: ACTOR };
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.insert(stockItemCategories).values({ id: CAT, tenantId: T, name: "Stationery", code: "ST", ...audit });
    await tx.insert(stockUoms).values({ id: UOM, tenantId: T, name: "Each", symbol: "EA", ...audit });
    await tx.insert(stockItems).values([
      { id: STOCKED, tenantId: T, name: "Stocked", code: "S-OK", categoryId: CAT, uomId: UOM, reorderLevel: 5, ...audit },
      { id: LOW, tenantId: T, name: "LowItem", code: "S-LOW", categoryId: CAT, uomId: UOM, reorderLevel: 5, ...audit },
      { id: OUT, tenantId: T, name: "OutItem", code: "S-OUT", categoryId: CAT, uomId: UOM, reorderLevel: 5, ...audit },
    ]);
    await tx.insert(stockValuationRates).values([
      { tenantId: T, itemId: STOCKED, warehouseId: WH, qty: 10, rateMinor: 500n }, // ₹5.00 x 10 = 5000 paise
      { tenantId: T, itemId: LOW, warehouseId: WH, qty: 2, rateMinor: 0n },
      { tenantId: T, itemId: OUT, warehouseId: WH, qty: 0, rateMinor: 0n },
    ]);
  }));
});

afterAll(async () => {
  await clean();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/stock/dashboard", () => {
  it("GAP-STOCK-DASHBOARD-06: inventoryValue is in paise (10 @ ₹5.00 => 5000)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/dashboard", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.inventoryValue).toBe(5000);
    expect(b.totalSKUs).toBe(3);
  });

  it("GAP-STOCK-DASHBOARD-04: stockOuts counts items with on-hand qty <= 0", async () => {
    const b = (await app.inject({ method: "GET", url: "/v1/stock/dashboard", headers: hdr() })).json();
    expect(b.stockOuts).toBe(1); // only OUT has qty 0
  });

  it("lowStockAlerts counts items under reorder level (LOW qty2<5, OUT qty0<5)", async () => {
    const b = (await app.inject({ method: "GET", url: "/v1/stock/dashboard", headers: hdr() })).json();
    expect(b.lowStockAlerts).toBe(2);
  });

  it("403 for a caller without a stock role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/dashboard", headers: hdr(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});
