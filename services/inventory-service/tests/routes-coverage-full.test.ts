/**
 * routes-coverage-full.test.ts — comprehensive route + domain coverage test for inventory-service.
 * Targets 80%+ line coverage by exercising all routes (auth, validation, happy path),
 * domain logic edge cases, validators, and query/command paths.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  weightedAvgRate, assertSufficientStock, valuationMinor,
  isLowStock, suggestedReorderQty,
} from "../src/modules/movements/domain.js";
import {
  createReceiptBody, createIssueBody, createTransferBody,
  createAdjustmentBody, balanceQueryParams, ledgerQueryParams, lowStockQueryParams,
} from "../src/modules/movements/validators.js";
import {
  createItemBody, updateItemBody, createCategoryBody, createUomBody,
  itemQueryParams, idParam,
} from "../src/modules/items/validators.js";
import { createStoreBody, storeQueryParams } from "../src/modules/stores/validators.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const STORE_UUID = "22222222-aaaa-4000-8000-000000000099";
const STORE2_UUID = "22222222-bbbb-4000-8000-000000000099";
const ITEM_UUID = "33333333-aaaa-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["inventory_admin"], sub = ACTOR): string {
  return signToken({ sub, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[], sub?: string) {
  return { authorization: `Bearer ${token(roles, sub)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Extended coverage
// ══════════════════════════════════════════════════════════════════════════════
describe("Domain logic — extended coverage", () => {
  it("weightedAvgRate: large quantities", () => {
    expect(weightedAvgRate({ qty: 10000, rateMinor: 500n }, 5000, 600n)).toBe(533n);
  });
  it("weightedAvgRate: zero combined qty returns 0", () => {
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 0, 100n)).toBe(0n);
  });
  it("weightedAvgRate: single unit receipt", () => {
    expect(weightedAvgRate({ qty: 99, rateMinor: 100n }, 1, 200n)).toBe(101n);
  });
  it("assertSufficientStock: zero requested is ok", () => {
    expect(() => assertSufficientStock(10, 0)).not.toThrow();
  });
  it("assertSufficientStock: zero available zero requested is ok", () => {
    expect(() => assertSufficientStock(0, 0)).not.toThrow();
  });
  it("assertSufficientStock: one more than available throws", () => {
    expect(() => assertSufficientStock(5, 6)).toThrow();
  });
  it("valuationMinor: zero qty", () => {
    expect(valuationMinor(0, 500n)).toBe(0n);
  });
  it("valuationMinor: large values", () => {
    expect(valuationMinor(1000, 99999n)).toBe(99999000n);
  });
  it("isLowStock: exactly at reorder level", () => {
    expect(isLowStock(10, 10)).toBe(true);
  });
  it("isLowStock: one above reorder level", () => {
    expect(isLowStock(11, 10)).toBe(false);
  });
  it("isLowStock: reorder level 0 always false", () => {
    expect(isLowStock(0, 0)).toBe(false);
  });
  it("suggestedReorderQty: stock at zero", () => {
    expect(suggestedReorderQty(0, 10, 50)).toBe(60);
  });
  it("suggestedReorderQty: stock above target still returns reorderQty", () => {
    expect(suggestedReorderQty(100, 10, 50)).toBe(50);
  });
  it("suggestedReorderQty: zero reorderQty and zero level returns 0", () => {
    expect(suggestedReorderQty(5, 0, 0)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATORS — Extended coverage
// ══════════════════════════════════════════════════════════════════════════════
describe("Validators — extended coverage", () => {
  // Items validators
  it("createItemBody: valid minimal", () => {
    const r = createItemBody.parse({ name: "Pen" });
    expect(r.name).toBe("Pen");
    expect(r.itemType).toBe("consumable");
    expect(r.reorderLevel).toBe(0);
    expect(r.currency).toBe("INR");
  });
  it("createItemBody: all fields", () => {
    const r = createItemBody.parse({
      name: "Desk", sku: "DSK-1", categoryId: ITEM_UUID, uomId: ITEM_UUID,
      itemType: "fixed_asset", reorderLevel: 5, reorderQty: 20,
      valuationMethod: "STANDARD", unitCostMinor: 100000, currency: "USD",
    });
    expect(r.valuationMethod).toBe("STANDARD");
    expect(r.currency).toBe("USD");
  });
  it("createItemBody: rejects negative reorderLevel", () => {
    expect(() => createItemBody.parse({ name: "X", reorderLevel: -1 })).toThrow();
  });
  it("createItemBody: rejects name over 200 chars", () => {
    expect(() => createItemBody.parse({ name: "a".repeat(201) })).toThrow();
  });
  it("updateItemBody: valid with version", () => {
    const r = updateItemBody.parse({ version: 3, name: "Updated" });
    expect(r.version).toBe(3);
  });
  it("updateItemBody: rejects version 0", () => {
    expect(() => updateItemBody.parse({ version: 0 })).toThrow();
  });
  it("updateItemBody: accepts nullable fields", () => {
    const r = updateItemBody.parse({ version: 1, sku: null, categoryId: null, uomId: null });
    expect(r.sku).toBeNull();
  });
  it("createCategoryBody: valid", () => {
    const r = createCategoryBody.parse({ name: "Office", code: "OFF" });
    expect(r.name).toBe("Office");
  });
  it("createCategoryBody: with parentId", () => {
    const r = createCategoryBody.parse({ name: "Sub", code: "SUB", parentId: ITEM_UUID });
    expect(r.parentId).toBe(ITEM_UUID);
  });
  it("createCategoryBody: rejects empty code", () => {
    expect(() => createCategoryBody.parse({ name: "X", code: "" })).toThrow();
  });
  it("createUomBody: valid", () => {
    const r = createUomBody.parse({ name: "Meter", symbol: "m" });
    expect(r.symbol).toBe("m");
  });
  it("createUomBody: rejects empty symbol", () => {
    expect(() => createUomBody.parse({ name: "X", symbol: "" })).toThrow();
  });
  it("idParam: valid uuid", () => {
    expect(idParam.parse({ id: ITEM_UUID }).id).toBe(ITEM_UUID);
  });
  it("idParam: rejects non-uuid", () => {
    expect(() => idParam.parse({ id: "bad" })).toThrow();
  });
  it("itemQueryParams: defaults", () => {
    const r = itemQueryParams.parse({});
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
  });
  it("itemQueryParams: custom values", () => {
    const r = itemQueryParams.parse({ limit: "10", offset: "5", categoryId: ITEM_UUID, status: "active" });
    expect(r.limit).toBe(10);
    expect(r.categoryId).toBe(ITEM_UUID);
  });

  // Store validators
  it("createStoreBody: valid with location", () => {
    const r = createStoreBody.parse({ name: "Main", code: "M1", location: "Bldg A" });
    expect(r.location).toBe("Bldg A");
  });
  it("createStoreBody: valid without location", () => {
    const r = createStoreBody.parse({ name: "Sub", code: "S1" });
    expect(r.location).toBeUndefined();
  });
  it("createStoreBody: rejects empty name", () => {
    expect(() => createStoreBody.parse({ name: "", code: "X" })).toThrow();
  });
  it("storeQueryParams: defaults", () => {
    const r = storeQueryParams.parse({});
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
  });

  // Movement validators
  it("createReceiptBody: valid", () => {
    const r = createReceiptBody.parse({
      toStoreId: STORE_UUID, postingDate: "2024-06-01",
      lines: [{ itemId: ITEM_UUID, qty: 10, rateMinor: 1000, currency: "INR" }],
    });
    expect(r.lines).toHaveLength(1);
  });
  it("createReceiptBody: with optional fields", () => {
    const r = createReceiptBody.parse({
      toStoreId: STORE_UUID, postingDate: "2024-01-15",
      refDoc: "PO-99", refNo: "GRN-01", notes: "Test",
      lines: [{ itemId: ITEM_UUID, qty: 5 }],
    });
    expect(r.refDoc).toBe("PO-99");
    expect(r.lines[0]!.rateMinor).toBe(0);
  });
  it("createReceiptBody: rejects invalid date", () => {
    expect(() => createReceiptBody.parse({
      toStoreId: STORE_UUID, postingDate: "2024/06/01",
      lines: [{ itemId: ITEM_UUID, qty: 1 }],
    })).toThrow();
  });
  it("createIssueBody: valid", () => {
    const r = createIssueBody.parse({
      fromStoreId: STORE_UUID, postingDate: "2024-07-01",
      lines: [{ itemId: ITEM_UUID, qty: 5 }],
    });
    expect(r.fromStoreId).toBe(STORE_UUID);
  });
  it("createIssueBody: with optional fields", () => {
    const r = createIssueBody.parse({
      fromStoreId: STORE_UUID, postingDate: "2024-07-01",
      refDoc: "REQ-1", refNo: "ISS-1", reasonCode: "DAMAGED", notes: "Broken",
      lines: [{ itemId: ITEM_UUID, qty: 2, rateMinor: 500, currency: "USD" }],
    });
    expect(r.reasonCode).toBe("DAMAGED");
  });
  it("createIssueBody: rejects empty lines", () => {
    expect(() => createIssueBody.parse({
      fromStoreId: STORE_UUID, postingDate: "2024-07-01", lines: [],
    })).toThrow();
  });
  it("createTransferBody: valid different stores", () => {
    const r = createTransferBody.parse({
      fromStoreId: STORE_UUID, toStoreId: STORE2_UUID, postingDate: "2024-08-01",
      lines: [{ itemId: ITEM_UUID, qty: 3 }],
    });
    expect(r.fromStoreId).not.toBe(r.toStoreId);
  });
  it("createTransferBody: rejects same store", () => {
    expect(() => createTransferBody.parse({
      fromStoreId: STORE_UUID, toStoreId: STORE_UUID, postingDate: "2024-08-01",
      lines: [{ itemId: ITEM_UUID, qty: 1 }],
    })).toThrow();
  });
  it("createAdjustmentBody: valid", () => {
    const r = createAdjustmentBody.parse({
      storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "STOCKTAKE",
      lines: [{ itemId: ITEM_UUID, countedQty: 10 }],
    });
    expect(r.reasonCode).toBe("STOCKTAKE");
  });
  it("createAdjustmentBody: rejects missing reasonCode", () => {
    expect(() => createAdjustmentBody.parse({
      storeId: STORE_UUID, postingDate: "2024-09-01",
      lines: [{ itemId: ITEM_UUID, countedQty: 5 }],
    })).toThrow();
  });
  it("balanceQueryParams: defaults", () => {
    const r = balanceQueryParams.parse({});
    expect(r.limit).toBe(100);
  });
  it("balanceQueryParams: with filters", () => {
    const r = balanceQueryParams.parse({ itemId: ITEM_UUID, storeId: STORE_UUID, limit: "50", offset: "10" });
    expect(r.itemId).toBe(ITEM_UUID);
  });
  it("ledgerQueryParams: with date range", () => {
    const r = ledgerQueryParams.parse({ from: "2024-01-01", to: "2024-12-31" });
    expect(r.from).toBe("2024-01-01");
    expect(r.to).toBe("2024-12-31");
  });
  it("ledgerQueryParams: rejects invalid date", () => {
    expect(() => ledgerQueryParams.parse({ from: "bad-date" })).toThrow();
  });
  it("lowStockQueryParams: defaults", () => {
    const r = lowStockQueryParams.parse({});
    expect(r.limit).toBe(100);
    expect(r.offset).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ITEM ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Item routes", () => {
  // POST /v1/inventory/items
  it("POST /v1/inventory/items → 202 valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(),
      payload: { name: "A4 Paper Ream", sku: "PPR-001", itemType: "consumable" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json()).toHaveProperty("id");
    expect(res.json()).toHaveProperty("correlationId");
  });

  it("POST /v1/inventory/items → 202 full body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(["store_keeper"]),
      payload: {
        name: "Stapler", sku: "STP-01", categoryId: ITEM_UUID,
        uomId: ITEM_UUID, itemType: "fixed_asset", reorderLevel: 10,
        reorderQty: 50, valuationMethod: "FIFO", unitCostMinor: 5000, currency: "INR",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/items → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/inventory/items → 400 empty name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(), payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/items → 400 invalid categoryId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(), payload: { name: "Test", categoryId: "not-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/items → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(["citizen"]), payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/items → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items", payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });

  // PATCH /v1/inventory/items/:id
  it("PATCH /v1/inventory/items/:id → 202 valid update", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(),
      payload: { version: 1, name: "Updated Paper" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("PATCH /v1/inventory/items/:id → 202 status change", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(),
      payload: { version: 2, status: "inactive", reorderLevel: 20 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/inventory/items/:id → 202 nullable fields", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(),
      payload: { version: 1, sku: null, categoryId: null, uomId: null },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/inventory/items/:id → 400 missing version", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(), payload: { name: "No version" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/inventory/items/:id → 400 bad uuid param", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/inventory/items/not-a-uuid",
      headers: authHeader(), payload: { version: 1, name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/inventory/items/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(["citizen"]), payload: { version: 1, name: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/inventory/items/:id → 401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/items/${ITEM_UUID}`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/items/:id
  it("GET /v1/inventory/items/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/inventory/items/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/items/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/items/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/items/${ITEM_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/items/:id → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/items/${ITEM_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/items
  it("GET /v1/inventory/items → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/items",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
    expect(res.json()).toHaveProperty("pagination");
  });

  it("GET /v1/inventory/items?limit=5&offset=0 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/items?limit=5&offset=0",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pagination.pageSize).toBe(5);
  });

  it("GET /v1/inventory/items with filters → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/items?categoryId=${ITEM_UUID}&status=active`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/items?categoryId=bad → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/items?categoryId=not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/items → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/items",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/items → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/items" });
    expect(res.statusCode).toBe(401);
  });

  // POST /v1/inventory/categories
  it("POST /v1/inventory/categories → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/categories",
      headers: authHeader(), payload: { name: "Office Supplies", code: "OFF-SUP" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/categories → 202 with parentId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/categories",
      headers: authHeader(), payload: { name: "Paper", code: "PAP", parentId: ITEM_UUID },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/categories → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/categories",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/categories → 400 invalid parentId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/categories",
      headers: authHeader(), payload: { name: "Cat", code: "C", parentId: "bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/categories → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/categories",
      headers: authHeader(["citizen"]), payload: { name: "X", code: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/categories → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/categories",
      payload: { name: "X", code: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/categories
  it("GET /v1/inventory/categories → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/categories",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/inventory/categories?limit=10&offset=5 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/categories?limit=10&offset=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/categories → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/categories",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/categories → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/categories" });
    expect(res.statusCode).toBe(401);
  });

  // POST /v1/inventory/uoms
  it("POST /v1/inventory/uoms → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/uoms",
      headers: authHeader(), payload: { name: "Kilogram", symbol: "kg" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/uoms → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/uoms",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/uoms → 400 symbol too long", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/uoms",
      headers: authHeader(), payload: { name: "Test", symbol: "a".repeat(17) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/uoms → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/uoms",
      headers: authHeader(["citizen"]), payload: { name: "X", symbol: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/uoms → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/uoms",
      payload: { name: "X", symbol: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/uoms
  it("GET /v1/inventory/uoms → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/uoms",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/inventory/uoms?limit=20 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/uoms?limit=20",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/uoms → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/uoms",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/uoms → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/uoms" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STORE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Store routes", () => {
  it("POST /v1/inventory/stores → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(["inventory_manager"]),
      payload: { name: "Central Warehouse", code: "CW-01", location: "Building A" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/stores → 202 without location", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(["inventory_admin"]),
      payload: { name: "Sub Store", code: "SS-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/stores → 202 super_admin role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(["super_admin"]),
      payload: { name: "Admin Store", code: "AS-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/stores → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/stores → 400 empty name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(), payload: { name: "", code: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/stores → 400 empty code", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(), payload: { name: "Store", code: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/stores → 403 store_keeper", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(["store_keeper"]),
      payload: { name: "X", code: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/stores → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      headers: authHeader(["citizen"]),
      payload: { name: "X", code: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/stores → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/stores",
      payload: { name: "X", code: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/stores
  it("GET /v1/inventory/stores → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/stores",
      headers: authHeader(["store_keeper"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/inventory/stores?limit=10&offset=5 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/stores?limit=10&offset=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/stores → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/stores",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/stores → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/stores" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MOVEMENT ROUTES — WRITES
// ══════════════════════════════════════════════════════════════════════════════
describe("Movement write routes", () => {
  // POST /v1/inventory/receipts
  it("POST /v1/inventory/receipts → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(["store_keeper"]),
      payload: {
        toStoreId: STORE_UUID, postingDate: "2024-06-01",
        lines: [{ itemId: ITEM_UUID, qty: 100, rateMinor: 5000, currency: "INR" }],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/receipts → 202 with optional fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(),
      payload: {
        toStoreId: STORE_UUID, postingDate: "2024-06-02",
        refDoc: "PO-001", refNo: "GRN-123", notes: "Received from vendor",
        lines: [{ itemId: ITEM_UUID, qty: 50, rateMinor: 3000 }],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/receipts → 400 empty lines", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(),
      payload: { toStoreId: STORE_UUID, postingDate: "2024-06-01", lines: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/receipts → 400 missing toStoreId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(),
      payload: { postingDate: "2024-06-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/receipts → 400 invalid date", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(),
      payload: { toStoreId: STORE_UUID, postingDate: "06/01/2024", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/receipts → 400 qty zero", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(),
      payload: { toStoreId: STORE_UUID, postingDate: "2024-06-01", lines: [{ itemId: ITEM_UUID, qty: 0 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/receipts → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      headers: authHeader(["citizen"]),
      payload: { toStoreId: STORE_UUID, postingDate: "2024-06-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/receipts → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts",
      payload: { toStoreId: STORE_UUID, postingDate: "2024-06-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  // POST /v1/inventory/issues
  it("POST /v1/inventory/issues → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      headers: authHeader(["store_keeper"]),
      payload: {
        fromStoreId: STORE_UUID, postingDate: "2024-07-01",
        lines: [{ itemId: ITEM_UUID, qty: 10, rateMinor: 0, currency: "INR" }],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/issues → 202 with optional fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      headers: authHeader(["inventory_user"]),
      payload: {
        fromStoreId: STORE_UUID, postingDate: "2024-07-02",
        refDoc: "REQ-01", refNo: "ISS-01", reasonCode: "CONSUMED", notes: "Office use",
        lines: [{ itemId: ITEM_UUID, qty: 5, rateMinor: 1000, currency: "INR" }],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/issues → 400 empty lines", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      headers: authHeader(),
      payload: { fromStoreId: STORE_UUID, postingDate: "2024-07-01", lines: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/issues → 400 missing fromStoreId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      headers: authHeader(),
      payload: { postingDate: "2024-07-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/issues → 400 negative qty", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      headers: authHeader(),
      payload: { fromStoreId: STORE_UUID, postingDate: "2024-07-01", lines: [{ itemId: ITEM_UUID, qty: -5 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/issues → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      headers: authHeader(["citizen"]),
      payload: { fromStoreId: STORE_UUID, postingDate: "2024-07-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/issues → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues",
      payload: { fromStoreId: STORE_UUID, postingDate: "2024-07-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  // POST /v1/inventory/transfers
  it("POST /v1/inventory/transfers → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      headers: authHeader(["store_keeper"]),
      payload: {
        fromStoreId: STORE_UUID, toStoreId: STORE2_UUID, postingDate: "2024-08-01",
        lines: [{ itemId: ITEM_UUID, qty: 20, rateMinor: 2000, currency: "INR" }],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/transfers → 202 with optional fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      headers: authHeader(["inventory_manager"]),
      payload: {
        fromStoreId: STORE_UUID, toStoreId: STORE2_UUID, postingDate: "2024-08-02",
        refNo: "TFR-01", notes: "Moving to sub-store",
        lines: [{ itemId: ITEM_UUID, qty: 15 }],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/transfers → 400 same store", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      headers: authHeader(),
      payload: {
        fromStoreId: STORE_UUID, toStoreId: STORE_UUID, postingDate: "2024-08-01",
        lines: [{ itemId: ITEM_UUID, qty: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/transfers → 400 empty lines", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      headers: authHeader(),
      payload: { fromStoreId: STORE_UUID, toStoreId: STORE2_UUID, postingDate: "2024-08-01", lines: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/transfers → 400 missing fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      headers: authHeader(),
      payload: { postingDate: "2024-08-01", lines: [{ itemId: ITEM_UUID, qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/transfers → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      headers: authHeader(["citizen"]),
      payload: {
        fromStoreId: STORE_UUID, toStoreId: STORE2_UUID, postingDate: "2024-08-01",
        lines: [{ itemId: ITEM_UUID, qty: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/transfers → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers",
      payload: {
        fromStoreId: STORE_UUID, toStoreId: STORE2_UUID, postingDate: "2024-08-01",
        lines: [{ itemId: ITEM_UUID, qty: 1 }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // POST /v1/inventory/adjustments
  it("POST /v1/inventory/adjustments → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(["inventory_manager"]),
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "STOCKTAKE",
        lines: [{ itemId: ITEM_UUID, countedQty: 95 }],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/inventory/adjustments → 202 with notes", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(["super_admin"]),
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-02", reasonCode: "DAMAGE",
        notes: "Items damaged in transit",
        lines: [{ itemId: ITEM_UUID, countedQty: 50 }],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/adjustments → 400 missing reasonCode", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(),
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-01",
        lines: [{ itemId: ITEM_UUID, countedQty: 5 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/adjustments → 400 empty lines", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(),
      payload: { storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "X", lines: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/adjustments → 400 negative countedQty", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(),
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "X",
        lines: [{ itemId: ITEM_UUID, countedQty: -1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/inventory/adjustments → 403 wrong role (store_keeper)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(["store_keeper"]),
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "X",
        lines: [{ itemId: ITEM_UUID, countedQty: 5 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/adjustments → 403 wrong role (citizen)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      headers: authHeader(["citizen"]),
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "X",
        lines: [{ itemId: ITEM_UUID, countedQty: 5 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/inventory/adjustments → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/adjustments",
      payload: {
        storeId: STORE_UUID, postingDate: "2024-09-01", reasonCode: "X",
        lines: [{ itemId: ITEM_UUID, countedQty: 5 }],
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MOVEMENT ROUTES — READS
// ══════════════════════════════════════════════════════════════════════════════
describe("Movement read routes", () => {
  // GET /v1/inventory/balances
  it("GET /v1/inventory/balances → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/balances",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/inventory/balances with filters → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/balances?itemId=${ITEM_UUID}&storeId=${STORE_UUID}&limit=50&offset=0`,
      headers: authHeader(["store_keeper"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/balances → 400 invalid itemId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/balances?itemId=bad",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/balances → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/balances",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/balances → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/balances" });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/ledger
  it("GET /v1/inventory/ledger → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/ledger",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/inventory/ledger with all filters → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inventory/ledger?itemId=${ITEM_UUID}&storeId=${STORE_UUID}&from=2024-01-01&to=2024-12-31&limit=50&offset=0`,
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/ledger → 400 invalid date", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/ledger?from=bad-date",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/ledger → 400 invalid storeId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/ledger?storeId=not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/inventory/ledger → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/ledger",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/ledger → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/ledger" });
    expect(res.statusCode).toBe(401);
  });

  // GET /v1/inventory/low-stock
  it("GET /v1/inventory/low-stock → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/low-stock",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/inventory/low-stock?limit=10&offset=0 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/low-stock?limit=10&offset=0",
      headers: authHeader(["finance_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/low-stock → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/low-stock",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/low-stock → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/low-stock" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// OPS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Ops routes", () => {
  it("GET /health → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("GET /ready → 200 or 503", async () => {
    const res = await app.inject({ method: "GET", url: "/ready", headers: authHeader() });
    expect([200, 503]).toContain(res.statusCode);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED CONTEXT — DomainError
// ══════════════════════════════════════════════════════════════════════════════
describe("DomainError", () => {
  it("has code and message", async () => {
    const { DomainError } = await import("../src/shared/domain.js");
    const err = new DomainError("TEST_CODE", "test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("[TEST_CODE] test message");
    expect(err.name).toBe("DomainError");
  });
});
