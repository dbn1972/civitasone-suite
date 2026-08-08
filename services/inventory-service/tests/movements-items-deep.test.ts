/**
 * Inventory Service — Movements Domain + Items Validators: Deep tests.
 *
 * Tests weighted-average rate, stock sufficiency, low-stock detection,
 * reorder suggestions, valuation, and item/movement validator boundaries.
 *
 * Source: modules/movements/domain.ts, modules/items/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  weightedAvgRate, assertSufficientStock, valuationMinor,
  isLowStock, suggestedReorderQty, type BalanceState,
} from "../src/modules/movements/domain.js";
import { createItemBody, updateItemBody, createReservationBody, idParam } from "../src/modules/items/validators.js";

// ═══ Movements Domain ═══

describe("weightedAvgRate — moving average cost", () => {
  it("first receipt sets rate directly", () => {
    const state: BalanceState = { qty: 0, rateMinor: 0n };
    expect(weightedAvgRate(state, 100, 5000n)).toBe(5000n);
  });

  it("blends existing + receipt", () => {
    // 100 @ 5000 + 100 @ 7000 → (500000+700000)/200 = 6000
    const state: BalanceState = { qty: 100, rateMinor: 5000n };
    expect(weightedAvgRate(state, 100, 7000n)).toBe(6000n);
  });

  it("zero combined qty returns 0 (no division by zero)", () => {
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 0, 5000n)).toBe(0n);
  });

  it("bigint floor division (no floating point)", () => {
    // 10 @ 1001 + 10 @ 1000 → 20010/20 = 1000 (floor)
    expect(weightedAvgRate({ qty: 10, rateMinor: 1001n }, 10, 1000n)).toBe(1000n);
  });

  it("large values stay precise", () => {
    const state: BalanceState = { qty: 10000, rateMinor: 9999999n };
    const result = weightedAvgRate(state, 5000, 10000001n);
    // (10000*9999999 + 5000*10000001) / 15000 = (99999990000 + 50000005000) / 15000 = 9999999n
    expect(result).toBe(9999999n);
  });
});

describe("assertSufficientStock", () => {
  it("passes when available >= requested", () => {
    expect(() => assertSufficientStock(100, 50)).not.toThrow();
    expect(() => assertSufficientStock(100, 100)).not.toThrow();
  });
  it("throws INSUFFICIENT_STOCK when requested > available", () => {
    expect(() => assertSufficientStock(10, 11)).toThrow("INSUFFICIENT_STOCK");
  });
  it("throws for zero stock with any request", () => {
    expect(() => assertSufficientStock(0, 1)).toThrow("INSUFFICIENT_STOCK");
  });
});

describe("valuationMinor — stock value computation", () => {
  it("qty × rate", () => expect(valuationMinor(100, 5000n)).toBe(500000n));
  it("zero qty = zero value", () => expect(valuationMinor(0, 5000n)).toBe(0n));
  it("zero rate = zero value", () => expect(valuationMinor(100, 0n)).toBe(0n));
});

describe("isLowStock — reorder level detection", () => {
  it("true when on-hand <= reorder level (positive level)", () => {
    expect(isLowStock(5, 10)).toBe(true);
    expect(isLowStock(10, 10)).toBe(true);
  });
  it("false when on-hand > reorder level", () => {
    expect(isLowStock(11, 10)).toBe(false);
  });
  it("false when reorder level is 0 (tracking disabled)", () => {
    expect(isLowStock(0, 0)).toBe(false);
  });
});

describe("suggestedReorderQty", () => {
  it("suggests enough to reach target (reorderLevel + reorderQty)", () => {
    // on-hand=5, level=10, qty=20 → target=30, gap=25
    expect(suggestedReorderQty(5, 10, 20)).toBe(25);
  });
  it("never suggests less than reorderQty", () => {
    // on-hand=25, level=10, qty=20 → target=30, gap=5 but min is 20
    expect(suggestedReorderQty(25, 10, 20)).toBe(20);
  });
  it("never negative", () => {
    expect(suggestedReorderQty(100, 10, 5)).toBeGreaterThanOrEqual(0);
  });
});

// ═══ Items Validators ═══

describe("createItemBody — item creation", () => {
  const valid = { name: "Office Paper A4", valuationMethod: "WAVG" as const };

  it("accepts valid item with minimal fields", () => {
    expect(createItemBody.safeParse(valid).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(createItemBody.safeParse({ ...valid, name: "" }).success).toBe(false);
  });
  it("rejects name > 200", () => {
    expect(createItemBody.safeParse({ ...valid, name: "x".repeat(201) }).success).toBe(false);
  });
  it("rejects negative reorderLevel", () => {
    expect(createItemBody.safeParse({ ...valid, reorderLevel: -1 }).success).toBe(false);
  });
  it("rejects reorderLevel > 1,000,000", () => {
    expect(createItemBody.safeParse({ ...valid, reorderLevel: 1000001 }).success).toBe(false);
  });
  it("accepts all valid valuationMethods", () => {
    for (const m of ["WAVG", "FIFO", "STANDARD"]) {
      expect(createItemBody.safeParse({ ...valid, valuationMethod: m }).success).toBe(true);
    }
  });
  it("rejects invalid valuationMethod", () => {
    expect(createItemBody.safeParse({ ...valid, valuationMethod: "LIFO" }).success).toBe(false);
  });
  it("accepts all valid itemTypes", () => {
    for (const t of ["consumable", "fixed_asset", "service"]) {
      expect(createItemBody.safeParse({ ...valid, itemType: t }).success).toBe(true);
    }
  });
  it("rejects invalid itemType", () => {
    expect(createItemBody.safeParse({ ...valid, itemType: "raw_material" }).success).toBe(false);
  });
  it("rejects non-3-char currency", () => {
    expect(createItemBody.safeParse({ ...valid, currency: "IN" }).success).toBe(false);
  });
  it("defaults: itemType=consumable, WAVG, reorderLevel=0, INR", () => {
    const result = createItemBody.safeParse({ name: "Test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.itemType).toBe("consumable");
      expect(result.data.valuationMethod).toBe("WAVG");
      expect(result.data.reorderLevel).toBe(0);
      expect(result.data.currency).toBe("INR");
    }
  });
});

describe("updateItemBody — optimistic locking", () => {
  it("requires version (positive int)", () => {
    expect(updateItemBody.safeParse({ version: 1 }).success).toBe(true);
    expect(updateItemBody.safeParse({ version: 0 }).success).toBe(false);
    expect(updateItemBody.safeParse({}).success).toBe(false);
  });
  it("accepts status transitions", () => {
    expect(updateItemBody.safeParse({ version: 1, status: "inactive" }).success).toBe(true);
    expect(updateItemBody.safeParse({ version: 1, status: "discontinued" }).success).toBe(true);
  });
  it("rejects invalid status", () => {
    expect(updateItemBody.safeParse({ version: 1, status: "deleted" }).success).toBe(false);
  });
});

describe("createReservationBody", () => {
  const valid = {
    itemId: "10000000-aaaa-4000-8000-000000000001",
    storeId: "20000000-bbbb-4000-8000-000000000001",
    qty: 10, refType: "indent", refId: "30000000-cccc-4000-8000-000000000001",
  };
  it("accepts valid reservation", () => expect(createReservationBody.safeParse(valid).success).toBe(true));
  it("rejects zero qty", () => expect(createReservationBody.safeParse({ ...valid, qty: 0 }).success).toBe(false));
  it("rejects non-UUID itemId", () => expect(createReservationBody.safeParse({ ...valid, itemId: "bad" }).success).toBe(false));
});
