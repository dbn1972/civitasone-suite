/**
 * Comprehensive route coverage tests for stock-service
 * Covers all routes, auth guards, validation, domain functions, and error paths.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const FAKE_UUID = "eeeeeeee-eeee-4000-8000-eeeeeeeeeeee";
const ITEM_UUID = "aaaaaaaa-1111-4000-8000-000000000099";
const WH_UUID = "bbbbbbbb-2222-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["stock_manager"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// ITEM ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Item routes", () => {
  const validItem = {
    name: "Paper A4",
    code: "PPR-A4-001",
    categoryId: FAKE_UUID,
    uomId: FAKE_UUID,
    itemType: "consumable",
    reorderLevel: 10,
    reorderQty: 50,
    valuationMethod: "WAVG",
  };

  it("POST /v1/stock/items → 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/items",
      headers: authHeader(),
      payload: validItem,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/stock/items → 202 with minimal body (defaults applied)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/items",
      headers: authHeader(["super_admin"]),
      payload: { name: "Pen Blue", code: "PEN-B", categoryId: FAKE_UUID, uomId: FAKE_UUID },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/items → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/items",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/items → 400 invalid categoryId (not uuid)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/items",
      headers: authHeader(),
      payload: { ...validItem, categoryId: "not-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/items → 403 citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/items",
      headers: authHeader(["citizen"]),
      payload: validItem,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/stock/items → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/stock/items", payload: validItem });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/stock/items/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/items/${FAKE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/stock/items/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/items/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/items/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/items/${FAKE_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/stock/items → 200 list (empty)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/items",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/stock/items → 200 with category filter", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/items?category=${FAKE_UUID}&limit=10&offset=0`,
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/stock/items → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/items" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WAREHOUSE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Warehouse routes", () => {
  const validWarehouse = { name: "Main Store", code: "WH-MAIN", address: "Block A" };

  it("POST /v1/stock/warehouses → 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/warehouses",
      headers: authHeader(),
      payload: validWarehouse,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/stock/warehouses → 202 minimal (no address)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/warehouses",
      headers: authHeader(["super_admin"]),
      payload: { name: "Sub Store", code: "WH-SUB" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/warehouses → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/warehouses",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/warehouses → 400 missing name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/warehouses",
      headers: authHeader(),
      payload: { code: "WH-X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/warehouses → 403 citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/warehouses",
      headers: authHeader(["citizen"]),
      payload: validWarehouse,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/stock/warehouses → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/stock/warehouses", payload: validWarehouse });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ENTRY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Entry routes", () => {
  const validEntry = {
    entryType: "receipt",
    postingDate: "2024-06-15",
    toWarehouseId: WH_UUID,
    items: [{ itemId: ITEM_UUID, qty: 100, rateMinor: 5000, currency: "INR" }],
  };

  it("POST /v1/stock/entries → 202 receipt entry", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(),
      payload: validEntry,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/stock/entries → 202 issue entry", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(["procurement_officer"]),
      payload: { ...validEntry, entryType: "issue", fromWarehouseId: WH_UUID },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/entries → 202 transfer entry", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(["stock_admin"]),
      payload: {
        ...validEntry,
        entryType: "transfer",
        fromWarehouseId: FAKE_UUID,
        toWarehouseId: WH_UUID,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/entries → 202 adjustment entry", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(),
      payload: { ...validEntry, entryType: "adjustment" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/entries → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/entries → 400 invalid entryType", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(),
      payload: { ...validEntry, entryType: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/entries → 400 invalid date format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(),
      payload: { ...validEntry, postingDate: "15-06-2024" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/entries → 400 empty items array", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(),
      payload: { ...validEntry, items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/entries → 403 citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: authHeader(["citizen"]),
      payload: validEntry,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/stock/entries → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/stock/entries", payload: validEntry });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PHYSICAL VERIFICATION
// ══════════════════════════════════════════════════════════════════════════════
describe("Physical verification route", () => {
  const validBody = {
    warehouseId: WH_UUID,
    postingDate: "2024-06-20",
    items: [{ itemId: ITEM_UUID, countedQty: 95 }],
    notes: "Monthly verification",
  };

  it("POST /v1/stock/physical-verification → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/physical-verification",
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/physical-verification → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/physical-verification",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/physical-verification → 400 invalid warehouseId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/physical-verification",
      headers: authHeader(),
      payload: { ...validBody, warehouseId: "bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/physical-verification → 403 citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/physical-verification",
      headers: authHeader(["citizen"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/stock/physical-verification → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/physical-verification",
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// LEDGER ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Ledger routes", () => {
  it("GET /v1/stock/ledger → 200 default params", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/ledger",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/stock/ledger → 200 with all filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/stock/ledger?itemId=${ITEM_UUID}&from=2024-01-01&to=2024-12-31&limit=25&offset=0`,
      headers: authHeader(["finance_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/stock/ledger → 200 with audit_officer role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/ledger?limit=5",
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/stock/ledger → 400 invalid itemId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/ledger?itemId=not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/ledger → 403 citizen role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/ledger",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/stock/ledger → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// VALUATION ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Valuation routes", () => {
  it("GET /v1/stock/valuation → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/valuation?itemId=${FAKE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/stock/valuation → 404 with explicit warehouseId", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/valuation?itemId=${FAKE_UUID}&warehouseId=${WH_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/stock/valuation → 400 missing itemId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/valuation",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/valuation → 400 invalid itemId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/valuation?itemId=bad",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/valuation → 403 citizen role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/valuation?itemId=${FAKE_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/stock/valuation → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/valuation?itemId=${FAKE_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Dashboard routes", () => {
  it("GET /v1/stock/dashboard → 200 with valid role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/dashboard",
      headers: authHeader(["store_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/stock/dashboard → 200 super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/dashboard",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/stock/dashboard → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/dashboard",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/stock/dashboard → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E-WAY BILL ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("E-Way Bill routes", () => {
  const validEwayBill = {
    supplyType: "outward",
    subSupplyType: "supply",
    docType: "invoice",
    docNo: "INV-2024-001",
    docDate: "2024-06-15",
    fromGstin: "29ABCDE1234F1Z5",
    fromName: "Test Org",
    fromAddr: "123 Main St, City",
    fromPin: "560001",
    fromStateCode: "29",
    toName: "Recipient Org",
    toAddr: "456 Other St, Town",
    toPin: "400001",
    toStateCode: "27",
    totalValueMinor: 5000000,
    hsnCode: "8471",
    transportMode: "road",
    vehicleNo: "KA01AB1234",
  };

  it("POST /v1/stock/eway-bills → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/eway-bills",
      headers: authHeader(["logistics_officer"]),
      payload: validEwayBill,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/stock/eway-bills → 202 with optional toGstin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/eway-bills",
      headers: authHeader(),
      payload: { ...validEwayBill, toGstin: "27FGHIJ5678K2Z3" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/stock/eway-bills → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/eway-bills",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/eway-bills → 400 invalid GSTIN", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/eway-bills",
      headers: authHeader(),
      payload: { ...validEwayBill, fromGstin: "INVALID" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/eway-bills → 400 invalid PIN", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/eway-bills",
      headers: authHeader(),
      payload: { ...validEwayBill, fromPin: "1234" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/stock/eway-bills → 403 citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/eway-bills",
      headers: authHeader(["citizen"]),
      payload: validEwayBill,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/stock/eway-bills → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/stock/eway-bills", payload: validEwayBill });
    expect(res.statusCode).toBe(401);
  });

  // Cancel
  it("PATCH /v1/stock/eway-bills/:id/cancel → 404 not found", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/cancel`,
      headers: authHeader(),
      payload: { reason: "Goods not dispatched" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/stock/eway-bills/:id/cancel → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/stock/eway-bills/not-uuid/cancel",
      headers: authHeader(),
      payload: { reason: "Goods not dispatched" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/stock/eway-bills/:id/cancel → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/cancel`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/stock/eway-bills/:id/cancel → 400 reason too short", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/cancel`,
      headers: authHeader(),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/stock/eway-bills/:id/cancel → 403 citizen role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/cancel`,
      headers: authHeader(["citizen"]),
      payload: { reason: "No longer needed" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/stock/eway-bills/:id/cancel → 401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/cancel`,
      payload: { reason: "Test reason" },
    });
    expect(res.statusCode).toBe(401);
  });

  // Update vehicle
  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 404 not found", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/update-vehicle`,
      headers: authHeader(),
      payload: { vehicleNo: "MH01CD5678" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/stock/eway-bills/not-uuid/update-vehicle",
      headers: authHeader(),
      payload: { vehicleNo: "MH01CD5678" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/update-vehicle`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 400 vehicleNo too short", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/update-vehicle`,
      headers: authHeader(),
      payload: { vehicleNo: "AB" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 403 citizen", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/update-vehicle`,
      headers: authHeader(["citizen"]),
      payload: { vehicleNo: "KA02EF9012" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/stock/eway-bills/${FAKE_UUID}/update-vehicle`,
      payload: { vehicleNo: "KA02EF9012" },
    });
    expect(res.statusCode).toBe(401);
  });

  // List
  it("GET /v1/stock/eway-bills → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/eway-bills",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/stock/eway-bills → 200 with status filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/eway-bills?status=active&limit=10&offset=0",
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/stock/eway-bills → 400 invalid status", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/eway-bills?status=invalid_status",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/eway-bills → 403 citizen role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/eway-bills",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/stock/eway-bills → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/eway-bills" });
    expect(res.statusCode).toBe(401);
  });

  // Get by ID
  it("GET /v1/stock/eway-bills/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/eway-bills/${FAKE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/stock/eway-bills/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/stock/eway-bills/not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/eway-bills/:id → 403 citizen role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/eway-bills/${FAKE_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/stock/eway-bills/:id → 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/stock/eway-bills/${FAKE_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN PURE FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════
describe("Domain — weightedAvgRate", () => {
  it("basic weighted average", async () => {
    const { weightedAvgRate } = await import("../src/modules/entry/domain.js");
    expect(weightedAvgRate({ qty: 100, rateMinor: 100n }, 50, 120n)).toBe(106n);
  });

  it("zero stock → receipt rate", async () => {
    const { weightedAvgRate } = await import("../src/modules/entry/domain.js");
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 200, 300n)).toBe(300n);
  });

  it("zero total qty → 0n", async () => {
    const { weightedAvgRate } = await import("../src/modules/entry/domain.js");
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 0, 0n)).toBe(0n);
  });

  it("large numbers", async () => {
    const { weightedAvgRate } = await import("../src/modules/entry/domain.js");
    const rate = weightedAvgRate({ qty: 10000, rateMinor: 99999n }, 5000, 50000n);
    expect(rate).toBeGreaterThan(0n);
  });

  it("equal rates unchanged", async () => {
    const { weightedAvgRate } = await import("../src/modules/entry/domain.js");
    expect(weightedAvgRate({ qty: 500, rateMinor: 250n }, 500, 250n)).toBe(250n);
  });
});

describe("Domain — assertStockNotNegative", () => {
  it("throws INSUFFICIENT_STOCK when issue > stock", async () => {
    const { assertStockNotNegative } = await import("../src/modules/entry/domain.js");
    expect(() => assertStockNotNegative(50, 100)).toThrow("INSUFFICIENT_STOCK");
  });

  it("does not throw when issue = stock", async () => {
    const { assertStockNotNegative } = await import("../src/modules/entry/domain.js");
    expect(() => assertStockNotNegative(100, 100)).not.toThrow();
  });

  it("does not throw when issue < stock", async () => {
    const { assertStockNotNegative } = await import("../src/modules/entry/domain.js");
    expect(() => assertStockNotNegative(100, 1)).not.toThrow();
  });
});

describe("Domain — voucherTypeForEntry", () => {
  it("receipt → receipt", async () => {
    const { voucherTypeForEntry } = await import("../src/modules/entry/domain.js");
    expect(voucherTypeForEntry("receipt", "to")).toBe("receipt");
  });

  it("issue → issue", async () => {
    const { voucherTypeForEntry } = await import("../src/modules/entry/domain.js");
    expect(voucherTypeForEntry("issue", "from")).toBe("issue");
  });

  it("transfer from → transfer_out", async () => {
    const { voucherTypeForEntry } = await import("../src/modules/entry/domain.js");
    expect(voucherTypeForEntry("transfer", "from")).toBe("transfer_out");
  });

  it("transfer to → transfer_in", async () => {
    const { voucherTypeForEntry } = await import("../src/modules/entry/domain.js");
    expect(voucherTypeForEntry("transfer", "to")).toBe("transfer_in");
  });

  it("adjustment → adjustment", async () => {
    const { voucherTypeForEntry } = await import("../src/modules/entry/domain.js");
    expect(voucherTypeForEntry("adjustment", "from")).toBe("adjustment");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED CONTEXT
// ══════════════════════════════════════════════════════════════════════════════
describe("Shared — HttpError + DomainError", () => {
  it("HttpError preserves status and code", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(422, "UNPROCESSABLE", "test msg");
    expect(err.status).toBe(422);
    expect(err.code).toBe("UNPROCESSABLE");
    expect(err.message).toBe("test msg");
  });

  it("DomainError preserves code and message", async () => {
    const { DomainError } = await import("../src/modules/entry/domain.js");
    const err = new DomainError("TEST_CODE", "test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toContain("TEST_CODE");
    expect(err.message).toContain("test message");
    expect(err.name).toBe("DomainError");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOPICS
// ══════════════════════════════════════════════════════════════════════════════
describe("Topics constants", () => {
  it("COMMANDS contains expected keys", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    expect(COMMANDS.itemCreate).toBe("stock.item.create");
    expect(COMMANDS.warehouseCreate).toBe("stock.warehouse.create");
    expect(COMMANDS.entryCreate).toBe("stock.entry.create");
    expect(COMMANDS.physicalCreate).toBe("stock.physical.create");
    expect(COMMANDS.ewbGenerate).toBe("stock.ewb.generate");
    expect(COMMANDS.ewbCancel).toBe("stock.ewb.cancel");
    expect(COMMANDS.ewbUpdateVehicle).toBe("stock.ewb.update_vehicle");
  });

  it("EVENTS contains expected keys", async () => {
    const { EVENTS } = await import("../src/topics.js");
    expect(EVENTS.entryCreated).toBe("stock.entry.created");
    expect(EVENTS.stockNegative).toBe("stock.stock.negative_rejected");
  });

  it("CONSUMED contains expected keys", async () => {
    const { CONSUMED } = await import("../src/topics.js");
    expect(CONSUMED.grnAccepted).toBe("procurement.grn.accepted");
  });

  it("SERVICE is stock", async () => {
    const { SERVICE } = await import("../src/topics.js");
    expect(SERVICE).toBe("stock");
  });
});
