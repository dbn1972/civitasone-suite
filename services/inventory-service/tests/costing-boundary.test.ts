/**
 * Boundary condition tests for FIFO and WAVG cost engines.
 *
 * Tests zero qty, single layer, max quantity (Number.MAX_SAFE_INTEGER),
 * zero unit cost, and bigint overflow/underflow scenarios.
 *
 * Validates: Requirements 23.3
 */
import { describe, it, expect } from "vitest";
import { consumeFifo, type CostLayer } from "../src/modules/costing/fifo-engine.js";
import { recomputeWavg, type WavgState, type WavgReceipt } from "../src/modules/costing/wavg-engine.js";

function layer(
  id: string,
  receiptDate: string,
  remainingQty: number,
  unitCostPaise: bigint,
): CostLayer {
  return { id, receiptDate: new Date(receiptDate), qty: remainingQty, remainingQty, unitCostPaise };
}

describe("FIFO Cost Engine — Boundary Conditions", () => {
  describe("single layer", () => {
    it("consumes exactly 1 unit from a single-unit layer", () => {
      const layers = [layer("L1", "2024-01-01", 1, 500n)];
      const result = consumeFifo(layers, 1);
      expect(result.consumed).toHaveLength(1);
      expect(result.consumed[0]!.qty).toBe(1);
      expect(result.totalCostPaise).toBe(500n);
      expect(result.remaining).toHaveLength(0);
    });

    it("rejects issuing from empty layers array", () => {
      expect(() => consumeFifo([], 1)).toThrowError("INSUFFICIENT_STOCK");
    });
  });

  describe("zero unit cost", () => {
    it("handles layers with zero unit cost (free goods)", () => {
      const layers = [layer("L1", "2024-01-01", 100, 0n)];
      const result = consumeFifo(layers, 50);
      expect(result.totalCostPaise).toBe(0n);
      expect(result.consumed[0]!.unitCostPaise).toBe(0n);
    });

    it("mixes zero-cost and non-zero-cost layers", () => {
      const layers = [
        layer("L1", "2024-01-01", 10, 0n),
        layer("L2", "2024-02-01", 10, 1000n),
      ];
      const result = consumeFifo(layers, 15);
      // L1: 10 * 0 = 0, L2: 5 * 1000 = 5000
      expect(result.totalCostPaise).toBe(5000n);
    });
  });

  describe("max quantity (Number.MAX_SAFE_INTEGER)", () => {
    it("handles a layer with MAX_SAFE_INTEGER remaining quantity", () => {
      const maxQty = Number.MAX_SAFE_INTEGER; // 2^53 - 1
      const layers: CostLayer[] = [{
        id: "L1",
        receiptDate: new Date("2024-01-01"),
        qty: maxQty,
        remainingQty: maxQty,
        unitCostPaise: 1n,
      }];
      const result = consumeFifo(layers, 100);
      expect(result.totalCostPaise).toBe(100n);
      expect(result.remaining[0]!.remainingQty).toBe(maxQty - 100);
    });

    it("computes correct cost for large qty × large unit cost", () => {
      const layers = [layer("L1", "2024-01-01", 1000000, 9_007_199_254_740_991n)];
      const result = consumeFifo(layers, 1);
      // 1 * MAX_SAFE_INTEGER as bigint = precise
      expect(result.totalCostPaise).toBe(9_007_199_254_740_991n);
    });
  });

  describe("invalid inputs", () => {
    it("rejects issueQty of 0", () => {
      const layers = [layer("L1", "2024-01-01", 10, 100n)];
      expect(() => consumeFifo(layers, 0)).toThrowError("INVALID_ISSUE_QTY");
    });

    it("rejects negative issueQty", () => {
      const layers = [layer("L1", "2024-01-01", 10, 100n)];
      expect(() => consumeFifo(layers, -1)).toThrowError("INVALID_ISSUE_QTY");
    });
  });
});

describe("WAVG Cost Engine — Boundary Conditions", () => {
  describe("zero qty receipt (no-op)", () => {
    it("returns existing state unchanged when receipt qty is 0", () => {
      const existing: WavgState = { qty: 50, totalCostPaise: 50000n, unitCostPaise: 1000n };
      const receipt: WavgReceipt = { qty: 0, unitCostPaise: 2000n };
      const result = recomputeWavg(existing, receipt);
      expect(result.qty).toBe(50);
      expect(result.unitCostPaise).toBe(1000n);
      expect(result.totalCostPaise).toBe(50000n);
    });
  });

  describe("first receipt (existing qty = 0)", () => {
    it("sets rate directly from receipt when existing qty is zero", () => {
      const existing: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
      const receipt: WavgReceipt = { qty: 100, unitCostPaise: 500n };
      const result = recomputeWavg(existing, receipt);
      expect(result.qty).toBe(100);
      expect(result.unitCostPaise).toBe(500n);
      expect(result.totalCostPaise).toBe(50000n);
    });
  });

  describe("single item receipt", () => {
    it("handles receipt of exactly 1 item", () => {
      const existing: WavgState = { qty: 10, totalCostPaise: 10000n, unitCostPaise: 1000n };
      const receipt: WavgReceipt = { qty: 1, unitCostPaise: 2100n };
      const result = recomputeWavg(existing, receipt);
      expect(result.qty).toBe(11);
      // (10 * 1000 + 1 * 2100) / 11 = 12100 / 11 = 1100
      expect(result.unitCostPaise).toBe(1100n);
    });
  });

  describe("zero unit cost receipt", () => {
    it("dilutes existing cost when receipt unit cost is zero", () => {
      const existing: WavgState = { qty: 10, totalCostPaise: 10000n, unitCostPaise: 1000n };
      const receipt: WavgReceipt = { qty: 10, unitCostPaise: 0n };
      const result = recomputeWavg(existing, receipt);
      expect(result.qty).toBe(20);
      // (10 * 1000 + 10 * 0) / 20 = 10000 / 20 = 500
      expect(result.unitCostPaise).toBe(500n);
    });
  });

  describe("bigint near MAX_SAFE_INTEGER", () => {
    it("handles unit cost near Number.MAX_SAFE_INTEGER without overflow", () => {
      const largeCost = 9_007_199_254_740_991n; // 2^53 - 1
      const existing: WavgState = { qty: 1, totalCostPaise: largeCost, unitCostPaise: largeCost };
      const receipt: WavgReceipt = { qty: 1, unitCostPaise: largeCost };
      const result = recomputeWavg(existing, receipt);
      expect(result.qty).toBe(2);
      // (1 * MAX + 1 * MAX) / 2 = 2*MAX / 2 = MAX
      expect(result.unitCostPaise).toBe(largeCost);
    });

    it("handles total exceeding MAX_SAFE_INTEGER", () => {
      const largeCost = 9_007_199_254_740_991n;
      const existing: WavgState = { qty: 100, totalCostPaise: largeCost * 100n, unitCostPaise: largeCost };
      const receipt: WavgReceipt = { qty: 100, unitCostPaise: largeCost };
      const result = recomputeWavg(existing, receipt);
      expect(result.qty).toBe(200);
      // Average should remain the same since both have the same unit cost
      expect(result.unitCostPaise).toBe(largeCost);
    });
  });

  describe("floor division behavior", () => {
    it("truncates toward zero on indivisible weighted average", () => {
      const existing: WavgState = { qty: 1, totalCostPaise: 100n, unitCostPaise: 100n };
      const receipt: WavgReceipt = { qty: 2, unitCostPaise: 200n };
      const result = recomputeWavg(existing, receipt);
      // (1 * 100 + 2 * 200) / 3 = 500 / 3 = 166 (floor)
      expect(result.unitCostPaise).toBe(166n);
    });
  });
});
