/**
 * GAP2-STOCK-DASHBOARD-01 — inventory valuation money precision.
 *
 * SUM(qty * rate_minor) is a bigint-paise aggregate. The service used to coerce
 * it to a JS Number before serialising, which loses precision once the total
 * exceeds Number.MAX_SAFE_INTEGER (9_007_199_254_740_991) paise. This test
 * seeds a valuation whose paise total is MAX_SAFE_INTEGER + 2 and asserts the
 * dashboard returns the EXACT paise string. On the old `Number(total)` code the
 * returned value is rounded (…992) and this fails; with the string contract it
 * is exact.
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
const T = "da5b0000-0000-4000-8000-0000000db001";
const ACTOR = "da5b0000-0000-4000-8000-0000000db00a";
const CAT = "da5b0000-0000-4000-8000-0000000dbc01";
const UOM = "da5b0000-0000-4000-8000-0000000dbd01";
const ITEM = "da5b0000-0000-4000-8000-0000000db0e1";
const WH = "da5b0000-0000-4000-8000-0000000db0f1";

// MAX_SAFE_INTEGER + 2 paise, factored as qty * rateMinor exactly.
// 9_007_199_254_740_993 = qty 1 * 9007199254740993 (prime-ish large bigint rate).
const BIG_PAISE = 9007199254740993n; // = Number.MAX_SAFE_INTEGER + 2

const hdr = (roles: string[] = ["stock_manager"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "sess-dash-big" }, SECRET, 3600)}`,
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
    await tx.insert(stockItemCategories).values({ id: CAT, tenantId: T, name: "Bullion", code: "BU", ...audit });
    await tx.insert(stockUoms).values({ id: UOM, tenantId: T, name: "Each", symbol: "EA", ...audit });
    await tx.insert(stockItems).values({ id: ITEM, tenantId: T, name: "GoldBar", code: "AU", categoryId: CAT, uomId: UOM, reorderLevel: 0, ...audit });
    await tx.insert(stockValuationRates).values({ tenantId: T, itemId: ITEM, warehouseId: WH, qty: 1, rateMinor: BIG_PAISE });
  }));
});

afterAll(async () => {
  await clean();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/stock/dashboard — money precision (GAP2-STOCK-DASHBOARD-01)", () => {
  it("returns the exact paise total beyond Number.MAX_SAFE_INTEGER (no float rounding)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/dashboard", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    // Exact string — Number(total) would have produced "9007199254740992".
    expect(b.inventoryValue).toBe(BIG_PAISE.toString());
    expect(BigInt(b.inventoryValue)).toBe(BIG_PAISE);
  });
});
