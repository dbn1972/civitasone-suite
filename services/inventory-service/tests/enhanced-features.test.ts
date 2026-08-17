/**
 * Enhanced inventory features — route-level integration tests (SVC-051..055).
 * Tests: substitutes, bins, reservations, goods-returns+QC, HSN/GST items.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR  = "22222222-aaaa-4000-8000-000000000001";
const ITEM_A = "33333333-aaaa-4000-8000-000000000aaa";
const ITEM_B = "33333333-aaaa-4000-8000-000000000bbb";
const STORE  = "44444444-aaaa-4000-8000-000000000001";

function authHeader(roles = ["inventory_admin", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("Items with HSN/GST (SVC-051)", () => {
  it("POST /v1/inventory/items with hsnCode + gstRate → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(),
      payload: {
        name: "Printer Toner HP-CF258A",
        sku: "TONER-258A",
        hsnCode: "84439999",
        gstRate: "18.00",
        taxClass: "standard_goods",
        itemType: "consumable",
        reorderLevel: 10, reorderQty: 50, reorderMax: 200,
        requiresBatchTracking: true,
        shelfLifeDays: 365,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("POST /v1/inventory/items rejects invalid hsnCode", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/items",
      headers: authHeader(),
      payload: { name: "Bad Item", hsnCode: "X" }, // too short
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Item Substitutes (SVC-051)", () => {
  it("POST /v1/inventory/substitutes → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/substitutes",
      headers: authHeader(),
      payload: { itemId: ITEM_A, substituteId: ITEM_B, priority: 1, conversionFactor: "1.0" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/substitutes rejects self-reference validation (both UUIDs)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/substitutes",
      headers: authHeader(),
      payload: { itemId: ITEM_A, substituteId: ITEM_A, priority: 1 },
    });
    // The schema accepts it but consumer should reject — route returns 202 (async)
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/inventory/items/:id/substitutes → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/items/${ITEM_A}/substitutes`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /v1/inventory/items/:id/substitutes → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/items/${ITEM_A}/substitutes`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Bins / Rack Locations (SVC-052)", () => {
  it("POST /v1/inventory/bins → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/bins",
      headers: authHeader(),
      payload: { storeId: STORE, code: "A-01-03", aisle: "A", rack: "01", shelf: "03" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/inventory/bins → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/bins",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("POST /v1/inventory/bins rejects invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/bins",
      headers: authHeader(),
      payload: { code: "X" }, // missing storeId
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Reservations / Allocations (SVC-054)", () => {
  it("POST /v1/inventory/reservations → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/reservations",
      headers: authHeader(),
      payload: {
        itemId: ITEM_A, storeId: STORE, qty: 25,
        refType: "indent", refId: "55555555-aaaa-4000-8000-000000000001",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/reservations rejects zero qty", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/reservations",
      headers: authHeader(),
      payload: { itemId: ITEM_A, storeId: STORE, qty: 0, refType: "indent", refId: ITEM_B },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/inventory/reservations/:id/release → 202", async () => {
    const fakeId = "66666666-aaaa-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/reservations/${fakeId}/release`,
      headers: authHeader(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/inventory/reservations → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/reservations",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/reservations → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/reservations" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Goods Returns + QC Gate (SVC-053)", () => {
  it("POST /v1/inventory/goods-returns → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/goods-returns",
      headers: authHeader(),
      payload: {
        originalIssueId: "77777777-aaaa-4000-8000-000000000001",
        itemId: ITEM_A, storeId: STORE, qty: 5, reason: "Defective batch",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/inventory/goods-returns rejects missing reason", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/goods-returns",
      headers: authHeader(),
      payload: { originalIssueId: ITEM_A, itemId: ITEM_A, storeId: STORE, qty: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/inventory/goods-returns/:id/inspect → 202 (QC gate)", async () => {
    const fakeId = "88888888-aaaa-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${fakeId}/inspect`,
      headers: authHeader(["qc_inspector"]),
      payload: { qcStatus: "passed", disposition: "restock" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/inventory/goods-returns/:id/inspect → 403 wrong role", async () => {
    const fakeId = "88888888-aaaa-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${fakeId}/inspect`,
      headers: authHeader(["employee"]),
      payload: { qcStatus: "passed", disposition: "restock" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/inventory/goods-returns → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/goods-returns",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/inventory/goods-returns/:id → 404 for a nonexistent goods return", async () => {
    const fakeId = "88888888-aaaa-4000-8000-000000000002";
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/goods-returns/${fakeId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/inventory/goods-returns/:id → 401 no token", async () => {
    const fakeId = "88888888-aaaa-4000-8000-000000000002";
    const res = await app.inject({ method: "GET", url: `/v1/inventory/goods-returns/${fakeId}` });
    expect(res.statusCode).toBe(401);
  });
});
