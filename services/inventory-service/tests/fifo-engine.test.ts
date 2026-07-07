/**
 * FIFO Cost-Layer Engine tests — pure domain logic.
 *
 * Covers:
 *   1. Single layer consumption
 *   2. Multi-layer spanning (consumes across multiple layers)
 *   3. Exact depletion (consumes all available stock exactly)
 *   4. Over-issue rejection (throws when qty exceeds available)
 *   5. Receipt-date ordering (oldest consumed first regardless of input order)
 *   6. Zero/invalid qty rejection
 *   7. Partial consumption (leaves remainder in layer)
 *   8. Total cost calculation correctness
 */
import { describe, it, expect } from "vitest";
import { consumeFifo, type CostLayer } from "../src/modules/costing/fifo-engine.js";

// Helper to create a cost layer
function layer(
  id: string,
  receiptDate: string,
  remainingQty: number,
  unitCostPaise: bigint,
  qty?: number,
): CostLayer {
  return {
    id,
    receiptDate: new Date(receiptDate),
    qty: qty ?? remainingQty,
    remainingQty,
    unitCostPaise,
  };
}

describe("consumeFifo — single layer consumption", () => {
  it("consumes from a single layer partially", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-10", 100, 500n),
    ];

    const result = consumeFifo(layers, 30);

    expect(result.consumed).toEqual([
      { layerId: "L1", qty: 30, unitCostPaise: 500n },
    ]);
    expect(result.totalCostPaise).toBe(15000n); // 30 * 500
    expect(result.remaining).toEqual([
      expect.objectContaining({ id: "L1", remainingQty: 70 }),
    ]);
  });

  it("fully depletes a single layer", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-10", 50, 1000n),
    ];

    const result = consumeFifo(layers, 50);

    expect(result.consumed).toEqual([
      { layerId: "L1", qty: 50, unitCostPaise: 1000n },
    ]);
    expect(result.totalCostPaise).toBe(50000n);
    expect(result.remaining).toEqual([]); // fully depleted
  });
});

describe("consumeFifo — multi-layer spanning", () => {
  it("spans across two layers (depletes first, partial second)", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 40, 200n),
      layer("L2", "2024-02-01", 60, 300n),
    ];

    const result = consumeFifo(layers, 70);

    expect(result.consumed).toEqual([
      { layerId: "L1", qty: 40, unitCostPaise: 200n },
      { layerId: "L2", qty: 30, unitCostPaise: 300n },
    ]);
    // Total: (40 * 200) + (30 * 300) = 8000 + 9000 = 17000
    expect(result.totalCostPaise).toBe(17000n);
    expect(result.remaining).toEqual([
      expect.objectContaining({ id: "L2", remainingQty: 30 }),
    ]);
  });

  it("spans across three layers", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 20, 100n),
      layer("L2", "2024-02-01", 30, 150n),
      layer("L3", "2024-03-01", 50, 200n),
    ];

    const result = consumeFifo(layers, 60);

    expect(result.consumed).toEqual([
      { layerId: "L1", qty: 20, unitCostPaise: 100n },
      { layerId: "L2", qty: 30, unitCostPaise: 150n },
      { layerId: "L3", qty: 10, unitCostPaise: 200n },
    ]);
    // Total: (20*100) + (30*150) + (10*200) = 2000 + 4500 + 2000 = 8500
    expect(result.totalCostPaise).toBe(8500n);
    expect(result.remaining).toEqual([
      expect.objectContaining({ id: "L3", remainingQty: 40 }),
    ]);
  });
});

describe("consumeFifo — exact depletion", () => {
  it("consumes exactly the total available across all layers", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 25, 400n),
      layer("L2", "2024-02-01", 75, 600n),
    ];

    const result = consumeFifo(layers, 100);

    expect(result.consumed).toEqual([
      { layerId: "L1", qty: 25, unitCostPaise: 400n },
      { layerId: "L2", qty: 75, unitCostPaise: 600n },
    ]);
    // Total: (25*400) + (75*600) = 10000 + 45000 = 55000
    expect(result.totalCostPaise).toBe(55000n);
    expect(result.remaining).toEqual([]); // all layers depleted
  });
});

describe("consumeFifo — over-issue rejection", () => {
  it("rejects when issue qty exceeds available balance", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 30, 500n),
      layer("L2", "2024-02-01", 20, 700n),
    ];

    expect(() => consumeFifo(layers, 51)).toThrowError("INSUFFICIENT_STOCK");
  });

  it("rejects with zero available layers (empty array)", () => {
    expect(() => consumeFifo([], 1)).toThrowError("INSUFFICIENT_STOCK");
  });

  it("rejects when issuing 1 more than available", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 10, 100n),
    ];

    expect(() => consumeFifo(layers, 11)).toThrowError("INSUFFICIENT_STOCK");
  });
});

describe("consumeFifo — receipt-date ordering", () => {
  it("consumes oldest layer first regardless of input order", () => {
    // Input is NOT sorted by date — newer first
    const layers: CostLayer[] = [
      layer("L-new", "2024-06-01", 50, 900n),
      layer("L-old", "2024-01-01", 50, 100n),
      layer("L-mid", "2024-03-15", 50, 500n),
    ];

    const result = consumeFifo(layers, 60);

    // Should consume L-old (50), then L-mid (10)
    expect(result.consumed).toEqual([
      { layerId: "L-old", qty: 50, unitCostPaise: 100n },
      { layerId: "L-mid", qty: 10, unitCostPaise: 500n },
    ]);
    // Total: (50*100) + (10*500) = 5000 + 5000 = 10000
    expect(result.totalCostPaise).toBe(10000n);
    expect(result.remaining).toEqual([
      expect.objectContaining({ id: "L-mid", remainingQty: 40 }),
      expect.objectContaining({ id: "L-new", remainingQty: 50 }),
    ]);
  });

  it("handles layers with the same receipt date", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 10, 100n),
      layer("L2", "2024-01-01", 10, 200n),
    ];

    const result = consumeFifo(layers, 15);

    // Both have same date — consumed in stable order (L1 first since sort is stable)
    expect(result.consumed).toHaveLength(2);
    expect(result.consumed[0]!.layerId).toBe("L1");
    expect(result.consumed[0]!.qty).toBe(10);
    expect(result.consumed[1]!.layerId).toBe("L2");
    expect(result.consumed[1]!.qty).toBe(5);
    // Total: (10*100) + (5*200) = 1000 + 1000 = 2000
    expect(result.totalCostPaise).toBe(2000n);
  });
});

describe("consumeFifo — invalid inputs", () => {
  it("rejects zero issue quantity", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 10, 100n),
    ];

    expect(() => consumeFifo(layers, 0)).toThrowError("INVALID_ISSUE_QTY");
  });

  it("rejects negative issue quantity", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 10, 100n),
    ];

    expect(() => consumeFifo(layers, -5)).toThrowError("INVALID_ISSUE_QTY");
  });
});

describe("consumeFifo — cost calculation", () => {
  it("handles large unit costs (bigint paise) correctly", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 1000, 9999999n), // ~1 lakh per unit
    ];

    const result = consumeFifo(layers, 500);

    expect(result.totalCostPaise).toBe(4999999500n); // 500 * 9999999
    expect(result.consumed[0]!.qty).toBe(500);
  });

  it("accumulates cost across multiple layers with different rates", () => {
    const layers: CostLayer[] = [
      layer("L1", "2024-01-01", 10, 1000n),
      layer("L2", "2024-02-01", 10, 2000n),
      layer("L3", "2024-03-01", 10, 3000n),
    ];

    const result = consumeFifo(layers, 25);

    // 10*1000 + 10*2000 + 5*3000 = 10000 + 20000 + 15000 = 45000
    expect(result.totalCostPaise).toBe(45000n);
  });
});
