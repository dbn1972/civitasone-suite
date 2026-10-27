/**
 * GAP-STOCK-LIST-04 (UAT B4): GET /v1/stock/items returns current stock, unit cost and stock value
 * (bigint paise as strings) computed from the valuation rows, so the web list never shows a
 * missing or mis-scaled value.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { stockItems, stockUoms, stockItemCategories } from "../src/modules/item/schema.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const CAT = randomUUID();
const UOM = randomUUID();
const ITEM_STOCKED = randomUUID();
const ITEM_EMPTY = randomUUID();
const WH1 = randomUUID();
const WH2 = randomUUID();
const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["stock_manager"], sid: "s-b4list" }, SECRET, 3600)}` };
let app: FastifyInstance;

async function clean() {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, t));
      await tx.delete(stockItems).where(eq(stockItems.tenantId, t));
      await tx.delete(stockUoms).where(eq(stockUoms.tenantId, t));
      await tx.delete(stockItemCategories).where(eq(stockItemCategories.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  app = await buildApp();
  await clean();
  const a = { createdBy: ACTOR, updatedBy: ACTOR };
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(stockItemCategories).values({ id: CAT, tenantId: TENANT, name: "Stationery", code: "STN", ...a });
    await tx.insert(stockUoms).values({ id: UOM, tenantId: TENANT, name: "Ream", symbol: "rm", ...a });
    await tx.insert(stockItems).values([
      { id: ITEM_STOCKED, tenantId: TENANT, name: "A4 Paper", code: "PAP-A4", categoryId: CAT, uomId: UOM, reorderLevel: 4, ...a },
      { id: ITEM_EMPTY, tenantId: TENANT, name: "Zebra Pen", code: "PEN-Z", categoryId: CAT, uomId: UOM, ...a },
    ]);
    await tx.insert(stockValuationRates).values([
      { tenantId: TENANT, itemId: ITEM_STOCKED, warehouseId: WH1, qty: 3, rateMinor: 1050n },
      { tenantId: TENANT, itemId: ITEM_STOCKED, warehouseId: WH2, qty: 2, rateMinor: 2000n },
    ]);
  }));
  // A foreign tenant's valuation row for the same item id must not be counted.
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(stockValuationRates).values(
    { tenantId: OTHER, itemId: ITEM_STOCKED, warehouseId: WH1, qty: 999, rateMinor: 99999n },
  )));
});
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("GET /v1/stock/items joined names and stock value", () => {
  async function list() {
    const res = await app.inject({ method: "GET", url: "/v1/stock/items", headers });
    expect(res.statusCode).toBe(200);
    return res.json().data as Array<Record<string, unknown>>;
  }

  it("returns current stock and stock value summed over warehouses, in paise as strings", async () => {
    const paper = (await list()).find((i) => i.id === ITEM_STOCKED)!;
    expect(paper.currentStock).toBe(5);
    expect(paper.totalValue).toBe("7150"); // 3*1050 + 2*2000, ignoring the other tenant
    expect(paper.unitCost).toBe("1430");   // 7150 / 5
  });

  it("an item with no stock rows reports 0 stock, value 0 and no unit cost (not a guess)", async () => {
    const pen = (await list()).find((i) => i.id === ITEM_EMPTY)!;
    expect(pen.currentStock).toBe(0);
    expect(pen.totalValue).toBe("0");
    expect(pen.unitCost).toBeNull();
  });

  it("reflects a stock change immediately (balances are not served from the list cache)", async () => {
    await list(); // prime the list cache
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(stockValuationRates)
      .set({ qty: 10 }).where(eq(stockValuationRates.warehouseId, WH2))));
    const paper = (await list()).find((i) => i.id === ITEM_STOCKED)!;
    expect(paper.currentStock).toBe(13);
    expect(paper.totalValue).toBe(String(3 * 1050 + 10 * 2000));
  });
});
