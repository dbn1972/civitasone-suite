/**
 * fq-inventory-01: stock-service read additions that back the inventory <-> stock item
 * cross-reference (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02). Real Postgres.
 *   - GET /v1/stock/items?q= : case-insensitive name/code search, LIKE wildcards literal, tenant scoped, stable order
 *   - GET /v1/stock/items/:id/balances : per-warehouse quantity + valuation, 404 for another tenant's item
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
const T1 = "fb1b1b1b-0000-4000-8000-0000000fb001";
const T2 = "fb2b2b2b-0000-4000-8000-0000000fb002";
const ACTOR = "fb1b1b1b-0000-4000-8000-0000000ab001";
const CAT1 = "fb1b1b1b-0000-4000-8000-0000000c0001";
const CAT2 = "fb2b2b2b-0000-4000-8000-0000000c0002";
const UOM1 = "fb1b1b1b-0000-4000-8000-0000000d0001";
const UOM2 = "fb2b2b2b-0000-4000-8000-0000000d0002";
const PEN = "fb1b1b1b-0000-4000-8000-0000000e0001";
const PAPER = "fb1b1b1b-0000-4000-8000-0000000e0002";
const PCT = "fb1b1b1b-0000-4000-8000-0000000e0003";
const OTHER = "fb2b2b2b-0000-4000-8000-0000000e0004";
const WH1 = "fb1b1b1b-0000-4000-8000-0000000f0001";
const WH2 = "fb1b1b1b-0000-4000-8000-0000000f0002";

const hdr = (tenant: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["stock_manager"], sid: "sess-fq-stock" }, SECRET, 3600)}`,
  "x-tenant-id": tenant,
});

// The shared service secret the internal (x-internal) path checks. Test-only value.
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || "fq_inv_internal_secret_for_tests"; // gitleaks:allow

let app: FastifyInstance;

async function clean() {
  for (const t of [T1, T2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, t));
      await tx.delete(stockItems).where(eq(stockItems.tenantId, t));
      await tx.delete(stockItemCategories).where(eq(stockItemCategories.tenantId, t));
      await tx.delete(stockUoms).where(eq(stockUoms.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  app = await buildApp();
  await clean();
  const audit = { createdBy: ACTOR, updatedBy: ACTOR };
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.insert(stockItemCategories).values({ id: CAT1, tenantId: T1, name: "Stationery", code: "ST", ...audit });
    await tx.insert(stockUoms).values({ id: UOM1, tenantId: T1, name: "Each", symbol: "EA", ...audit });
    await tx.insert(stockItems).values([
      { id: PEN, tenantId: T1, name: "Gel Pen", code: "PEN-01", categoryId: CAT1, uomId: UOM1, ...audit },
      { id: PAPER, tenantId: T1, name: "A4 Paper", code: "PAPER-A", categoryId: CAT1, uomId: UOM1, ...audit },
      { id: PCT, tenantId: T1, name: "100% Cotton Swab", code: "SWAB_1", categoryId: CAT1, uomId: UOM1, ...audit },
    ]);
    await tx.insert(stockValuationRates).values([
      { tenantId: T1, itemId: PEN, warehouseId: WH1, qty: 10, rateMinor: 500n },
      { tenantId: T1, itemId: PEN, warehouseId: WH2, qty: 5, rateMinor: 600n },
    ]);
  }));
  await runWithTenant(T2, () => db.transaction(async (tx) => {
    await tx.insert(stockItemCategories).values({ id: CAT2, tenantId: T2, name: "Other", code: "OT", ...audit });
    await tx.insert(stockUoms).values({ id: UOM2, tenantId: T2, name: "Each", symbol: "EA", ...audit });
    await tx.insert(stockItems).values({ id: OTHER, tenantId: T2, name: "Gel Pen Other", code: "PEN-01", categoryId: CAT2, uomId: UOM2, ...audit });
  }));
});

afterAll(async () => {
  await clean();
  await app.close();
  await sqlClient.end();
});

const list = async (tenant: string, qs: string) =>
  (await app.inject({ method: "GET", url: `/v1/stock/items?${qs}`, headers: hdr(tenant) })).json().data as Array<{ id: string; code: string }>;

describe("GET /v1/stock/items?q=", () => {
  it("matches name or code case-insensitively, in a stable name order", async () => {
    expect((await list(T1, "q=pen")).map((r) => r.id)).toEqual([PEN]);
    expect((await list(T1, "q=paper-a")).map((r) => r.id)).toEqual([PAPER]);
    expect((await list(T1, "limit=10")).map((r) => r.id)).toEqual([PCT, PAPER, PEN].sort((a, b) => {
      const n: Record<string, string> = { [PCT]: "100% Cotton Swab", [PAPER]: "A4 Paper", [PEN]: "Gel Pen" };
      return n[a]!.localeCompare(n[b]!);
    }));
  });

  it("treats % and _ literally (no accidental match-all)", async () => {
    expect((await list(T1, "q=%25")).map((r) => r.id)).toEqual([PCT]);   // only the item whose name has a real %
    expect((await list(T1, "q=SWAB_")).map((r) => r.id)).toEqual([PCT]);
    expect(await list(T1, "q=PEN_")).toEqual([]);                        // "_" is not "any one character"
  });

  it("is tenant scoped", async () => {
    expect((await list(T2, "q=pen")).map((r) => r.id)).toEqual([OTHER]);
  });
});

describe("GET /v1/stock/items/:id/balances", () => {
  it("returns per-warehouse quantity and valuation with totals (minor units as strings)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: hdr(T1) });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.totalQty).toBe(15);
    expect(b.totalValueMinor).toBe(String(10 * 500 + 5 * 600));
    expect(b.warehouses).toHaveLength(2);
    expect(b.warehouses.find((w: { warehouseId: string }) => w.warehouseId === WH1)).toMatchObject({ qty: 10, rateMinor: "500", valueMinor: "5000" });
  });

  it("an item with no stock yet is zero, not an error", async () => {
    const b = (await app.inject({ method: "GET", url: `/v1/stock/items/${PAPER}/balances`, headers: hdr(T1) })).json();
    expect(b).toMatchObject({ totalQty: 0, totalValueMinor: "0", warehouses: [] });
  });

  it("404 for another tenant's item", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: hdr(T2) })).statusCode).toBe(404);
  });
});

describe("balances access", () => {
  it("403 for a caller without a stock role (the inventory roles are not stock roles)", async () => {
    const token = signToken({ sub: ACTOR, tid: T1, roles: ["inventory_user"], sid: "sess-fq-stock" }, SECRET, 3600);
    const res = await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: { authorization: `Bearer ${token}`, "x-tenant-id": T1 } });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("rateMinor");
  });
});

describe("the real x-internal handshake inventory-service uses (service identity + tenant header)", () => {
  const internal = (tenant: string, secret: string) => ({ "x-internal": "1", "x-service-secret": secret, "x-tenant-id": tenant });

  it("the right secret reads this tenant's item, search and balances, and only this tenant's", async () => {
    const secret = process.env.INTERNAL_SERVICE_SECRET!;
    const one = await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}`, headers: internal(T1, secret) });
    expect(one.statusCode).toBe(200);
    expect(one.json().code).toBe("PEN-01");
    const list = await app.inject({ method: "GET", url: "/v1/stock/items?q=pen&limit=20&offset=0", headers: internal(T1, secret) });
    expect(list.json().data.map((r: { id: string }) => r.id)).toEqual([PEN]);
    const bal = await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: internal(T1, secret) });
    expect(bal.statusCode).toBe(200);
    expect(bal.json().totalQty).toBe(15);
    // another tenant's header never sees T1's item
    expect((await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}`, headers: internal(T2, secret) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: internal(T2, secret) })).statusCode).toBe(404);
  });

  it("a wrong or missing secret is refused", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: internal(T1, "wrong") })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/stock/items/${PEN}/balances`, headers: { "x-internal": "1", "x-tenant-id": T1 } })).statusCode).toBe(401);
  });
});
