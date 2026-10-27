/**
 * GAP-STOCK-LEDGER-02 (UAT B4): GET /v1/stock/ledger joins the warehouse name onto each row (the
 * stock_ledger table only stores ids), so the web ledger never has to show an id fragment. The
 * join stays tenant-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { stockItems, stockUoms, stockItemCategories } from "../src/modules/item/schema.js";
import { stockWarehouses } from "../src/modules/warehouse/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const CAT = randomUUID();
const UOM = randomUUID();
const ITEM = randomUUID();
const ITEM_GONE = randomUUID(); // ledger row whose item/warehouse cannot be resolved
const WH = randomUUID();
const WH_GONE = randomUUID();
const L_OK = randomUUID();
const L_ORPHAN = randomUUID();

const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["stock_manager"], sid: "s-b4led" }, SECRET, 3600)}` };
let app: FastifyInstance;

async function clean() {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, t));
      await tx.delete(stockItems).where(eq(stockItems.tenantId, t));
      await tx.delete(stockUoms).where(eq(stockUoms.tenantId, t));
      await tx.delete(stockItemCategories).where(eq(stockItemCategories.tenantId, t));
      await tx.delete(stockWarehouses).where(eq(stockWarehouses.tenantId, t));
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
    await tx.insert(stockItems).values({ id: ITEM, tenantId: TENANT, name: "A4 Paper", code: "PAP-A4", categoryId: CAT, uomId: UOM, ...a });
    await tx.insert(stockWarehouses).values({ id: WH, tenantId: TENANT, name: "Central Store", code: "CS-01", ...a });
    await tx.insert(stockLedger).values([
      { id: L_OK, tenantId: TENANT, itemId: ITEM, warehouseId: WH, entryId: randomUUID(), voucherType: "receipt", qtyIn: 5, balanceQty: 5, postingDate: "2026-10-01", createdBy: ACTOR },
      { id: L_ORPHAN, tenantId: TENANT, itemId: ITEM_GONE, warehouseId: WH_GONE, entryId: randomUUID(), voucherType: "issue", qtyOut: 1, balanceQty: 4, postingDate: "2026-10-02", createdBy: ACTOR },
    ]);
  }));
  // Same ids exist in ANOTHER tenant under different names: they must never leak into TENANT's rows.
  await runWithTenant(OTHER, () => db.transaction(async (tx) => {
    await tx.insert(stockItemCategories).values({ id: randomUUID(), tenantId: OTHER, name: "x", code: "x", ...a });
    await tx.insert(stockItems).values({ id: ITEM_GONE, tenantId: OTHER, name: "Foreign Item", code: "FOR-1", categoryId: CAT, uomId: UOM, ...a });
    await tx.insert(stockWarehouses).values({ id: WH_GONE, tenantId: OTHER, name: "Foreign Warehouse", code: "FW-1", ...a });
  }));
});
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("GET /v1/stock/ledger warehouse name join", () => {
  it("returns warehouseName next to the warehouseId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger", headers });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const ok = rows.find((r) => r.id === L_OK)!;
    expect(ok).toMatchObject({ warehouseId: WH, warehouseName: "Central Store", qtyIn: 5 });
  });

  it("leaves the name null (never an id fragment, never another tenant) when it cannot be resolved", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger", headers });
    const orphan = (res.json().data as Array<Record<string, unknown>>).find((r) => r.id === L_ORPHAN)!;
    expect(orphan.warehouseName).toBeNull();
    expect(JSON.stringify(res.json())).not.toContain("Foreign");
  });

  it("keeps newest-first ordering and the money field as a string", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger", headers });
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual([L_ORPHAN, L_OK]);
    expect(typeof rows[0]!.rateMinor).toBe("string");
  });
});
