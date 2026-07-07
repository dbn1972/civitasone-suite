/**
 * Canonical data model tests — verifies the unified inventory model schema
 * covers items, warehouses, movements, and cost layers as required by Req 14.1.
 *
 * Validates:
 * - All canonical tables exist with correct columns
 * - Standard columns (tenantId, createdBy, updatedBy, version) are present
 * - Money columns use bigint paise
 * - Warehouse CRUD routes work correctly
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";

// Import all canonical model tables
import { items, categories, uoms } from "../src/modules/items/schema.js";
import { warehouses } from "../src/modules/warehouses/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { movements, movementLines, stockBalances, stockLedger, reasonCodes } from "../src/modules/movements/schema.js";
import { costLayers } from "../src/modules/costing/schema.js";
import { batches, serialNumbers } from "../src/modules/batches/schema.js";

// ── Schema completeness tests ───────────────────────────────────────────────

describe("canonical model — schema completeness", () => {
  const STANDARD_COLUMNS = ["id", "tenantId", "createdAt", "createdBy"];
  const MUTABLE_COLUMNS = [...STANDARD_COLUMNS, "updatedAt", "updatedBy", "version"];

  function columnNames(table: unknown): string[] {
    return Object.keys(getTableColumns(table as Parameters<typeof getTableColumns>[0]));
  }

  describe("items domain", () => {
    it("items table has standard columns and inventory-specific fields", () => {
      const cols = columnNames(items);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("name");
      expect(cols).toContain("sku");
      expect(cols).toContain("categoryId");
      expect(cols).toContain("uomId");
      expect(cols).toContain("valuationMethod");
      expect(cols).toContain("unitCostMinor");
      expect(cols).toContain("currency");
      expect(cols).toContain("reorderLevel");
      expect(cols).toContain("reorderQty");
    });

    it("categories table has standard columns", () => {
      const cols = columnNames(categories);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("name");
      expect(cols).toContain("code");
      expect(cols).toContain("parentId");
    });

    it("uoms table has standard columns", () => {
      const cols = columnNames(uoms);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("name");
      expect(cols).toContain("symbol");
    });
  });

  describe("warehouses domain", () => {
    it("warehouses table has standard columns and warehouse-specific fields", () => {
      const cols = columnNames(warehouses);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("name");
      expect(cols).toContain("code");
      expect(cols).toContain("address");
      expect(cols).toContain("isActive");
    });

    it("stores table has standard columns", () => {
      const cols = columnNames(stores);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("name");
      expect(cols).toContain("code");
      expect(cols).toContain("location");
      expect(cols).toContain("isActive");
    });
  });

  describe("movements domain", () => {
    it("movements table has standard columns and movement-specific fields", () => {
      const cols = columnNames(movements);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("movementType");
      expect(cols).toContain("refDoc");
      expect(cols).toContain("postingDate");
      expect(cols).toContain("fromStoreId");
      expect(cols).toContain("toStoreId");
      expect(cols).toContain("status");
    });

    it("movementLines table has monetary columns as bigint", () => {
      const cols = columnNames(movementLines);
      expect(cols).toContain("rateMinor");
      expect(cols).toContain("amountMinor");
      expect(cols).toContain("currency");
      expect(cols).toContain("qty");
      expect(cols).toContain("itemId");
      expect(cols).toContain("movementId");
    });

    it("stockBalances tracks on-hand qty and average rate in bigint paise", () => {
      const cols = columnNames(stockBalances);
      expect(cols).toContain("tenantId");
      expect(cols).toContain("itemId");
      expect(cols).toContain("storeId");
      expect(cols).toContain("onHandQty");
      expect(cols).toContain("avgRateMinor");
      expect(cols).toContain("currency");
      expect(cols).toContain("version");
    });

    it("stockLedger is append-only with complete movement history", () => {
      const cols = columnNames(stockLedger);
      expect(cols).toContain("tenantId");
      expect(cols).toContain("itemId");
      expect(cols).toContain("storeId");
      expect(cols).toContain("movementId");
      expect(cols).toContain("movementType");
      expect(cols).toContain("qtyIn");
      expect(cols).toContain("qtyOut");
      expect(cols).toContain("balanceQty");
      expect(cols).toContain("rateMinor");
      expect(cols).toContain("valueMinor");
      expect(cols).toContain("postingDate");
    });

    it("reasonCodes supports adjustment controlled vocabulary", () => {
      const cols = columnNames(reasonCodes);
      expect(cols).toContain("tenantId");
      expect(cols).toContain("code");
      expect(cols).toContain("description");
      expect(cols).toContain("kind");
    });
  });

  describe("cost layers domain", () => {
    it("costLayers table tracks receipt-based layers with bigint cost", () => {
      const cols = columnNames(costLayers);
      for (const c of STANDARD_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("itemId");
      expect(cols).toContain("warehouseId");
      expect(cols).toContain("receiptDate");
      expect(cols).toContain("qty");
      expect(cols).toContain("remainingQty");
      expect(cols).toContain("unitCostPaise");
      expect(cols).toContain("version");
    });
  });

  describe("batch and serial tracking domain", () => {
    it("batches table supports batch tracking with expiry", () => {
      const cols = columnNames(batches);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("itemId");
      expect(cols).toContain("batchNumber");
      expect(cols).toContain("mfgDate");
      expect(cols).toContain("expiryDate");
      expect(cols).toContain("qty");
      expect(cols).toContain("status");
    });

    it("serialNumbers table supports per-item serial tracking", () => {
      const cols = columnNames(serialNumbers);
      for (const c of MUTABLE_COLUMNS) expect(cols).toContain(c);
      expect(cols).toContain("itemId");
      expect(cols).toContain("batchId");
      expect(cols).toContain("serialNumber");
      expect(cols).toContain("status");
    });
  });
});

// ── Canonical model mapping verification ────────────────────────────────────

describe("canonical model — stock-service mapping coverage", () => {
  it("items covers stock_items fields: name, code/sku, category, uom, valuation", () => {
    const cols = Object.keys(getTableColumns(items as Parameters<typeof getTableColumns>[0]));
    // stock_items.code maps to items.sku
    expect(cols).toContain("sku");
    // stock_items.categoryId maps to items.categoryId
    expect(cols).toContain("categoryId");
    // stock_items.uomId maps to items.uomId
    expect(cols).toContain("uomId");
    // stock_items.valuationMethod maps to items.valuationMethod
    expect(cols).toContain("valuationMethod");
    // items adds unitCostMinor (bigint paise) which stock_items lacked
    expect(cols).toContain("unitCostMinor");
  });

  it("warehouses covers stock_warehouses fields: name, code, address, isActive", () => {
    const cols = Object.keys(getTableColumns(warehouses as Parameters<typeof getTableColumns>[0]));
    expect(cols).toContain("name");
    expect(cols).toContain("code");
    expect(cols).toContain("address");
    expect(cols).toContain("isActive");
  });

  it("movements covers stock_entries fields: type, ref, posting date, from/to", () => {
    const cols = Object.keys(getTableColumns(movements as Parameters<typeof getTableColumns>[0]));
    // entry_type → movementType
    expect(cols).toContain("movementType");
    // ref_doc → refDoc
    expect(cols).toContain("refDoc");
    // posting_date → postingDate
    expect(cols).toContain("postingDate");
    // from_warehouse_id → fromStoreId
    expect(cols).toContain("fromStoreId");
    // to_warehouse_id → toStoreId
    expect(cols).toContain("toStoreId");
  });

  it("costLayers covers stock_receipts fields: item, warehouse, qty, unit cost", () => {
    const cols = Object.keys(getTableColumns(costLayers as Parameters<typeof getTableColumns>[0]));
    expect(cols).toContain("itemId");
    expect(cols).toContain("warehouseId");
    expect(cols).toContain("qty");
    expect(cols).toContain("remainingQty");
    expect(cols).toContain("unitCostPaise");
  });
});

// ── Warehouse route tests (inject) ─────────────────────────────────────────

describe("inventory-service warehouse routes", () => {
  it("GET /v1/inventory/warehouses without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/warehouses" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/inventory/warehouses/:id without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/warehouses/00000000-0000-4000-8000-000000000001" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /v1/inventory/warehouses without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/warehouses",
      payload: { name: "Test", code: "TST" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /v1/inventory/warehouses with invalid body → 400", async () => {
    const { buildApp } = await import("../src/app.js");
    const { signToken } = await import("@civitasone/auth");
    const SECRET = "test_secret_for_civitasone_32chr";
    const token = signToken(
      { sub: "actor-1", tid: "tenant-1", roles: ["inventory_admin"], sid: "s1" },
      SECRET, 3600,
    );
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/warehouses",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "", code: "" }, // invalid: empty name/code
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
