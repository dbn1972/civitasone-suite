/**
 * GAP-STOCK-LIST-02 (UAT B4): GET /v1/stock/items returns the joined category name and UOM code, so
 * the web list never has to show ids or invented units/categories.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { stockItems, stockUoms, stockItemCategories } from "../src/modules/item/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CAT = randomUUID();
const UOM = randomUUID();
const ITEM_STOCKED = randomUUID();
const ITEM_EMPTY = randomUUID();
const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["stock_manager"], sid: "s-b4list" }, SECRET, 3600)}` };
let app: FastifyInstance;

async function clean() {
  for (const t of [TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
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
  }));
});
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("GET /v1/stock/items joined names", () => {
  it("returns category name and UOM code, not just ids", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/items", headers });
    expect(res.statusCode).toBe(200);
    const paper = (res.json().data as Array<Record<string, unknown>>).find((i) => i.id === ITEM_STOCKED)!;
    expect(paper).toMatchObject({ code: "PAP-A4", categoryName: "Stationery", uomCode: "rm", categoryId: CAT, uomId: UOM });
  });
});
