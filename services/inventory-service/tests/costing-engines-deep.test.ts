/**
 * Inventory Service — Costing Engines: Deep test suite.
 *
 * Tests FIFO consumption and WAVG recomputation with exact bigint paise
 * arithmetic. Verifies boundary conditions, error paths, and the fundamental
 * accounting property that cost never goes negative.
 *
 * Source: modules/costing/fifo-engine.ts, modules/costing/wavg-engine.ts
 */
import { describe, it, expect } from "vitest";
import { consumeFifo, type CostLayer } from "../src/modules/costing/fifo-engine.js";
import { recomputeWavg, type WavgState, type WavgReceipt } from "../src/modules/costing/wavg-engine.js";

// ═══ FIFO Engine ═══

function layer(id: string, date: string, qty: number, unitPaise: bigint): CostLayer {
  return { id, receiptDate: new Date(date), qty, remainingQty: qty, unitCostPaise: unitPaise };
}

describe("consumeFifo — FIFO cost-layer consumption", () => {
  it("consumes entirely from a single layer", () => {
    const layers = [layer("L1", "2026-01-01", 100, 5000n)];
    const result = consumeFifo(layers, 50);
    expect(result.consumed).toEqual([{ layerId: "L1", qty: 50, unitCostPaise: 5000n }]);
    expect(result.totalCostPaise).toBe(250000n); // 50 * 5000
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]!.remainingQty).toBe(50);
  });

  it("fully depletes a layer then moves to next (FIFO order)", () => {
    const layers = [
      layer("L1", "2026-01-01", 30, 5000n),
      layer("L2", "2026-02-01", 70, 6000n),
    ];
    const result = consumeFifo(layers, 50);
    expect(result.consumed).toHaveLength(2);
    expect(result.consumed[0]).toEqual({ layerId: "L1", qty: 30, unitCostPaise: 5000n });
    expect(result.consumed[1]).toEqual({ layerId: "L2", qty: 20, unitCostPaise: 6000n });
    expect(result.totalCostPaise).toBe(30n * 5000n + 20n * 6000n); // 150000 + 120000 = 270000
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]!.id).toBe("L2");
    expect(result.remaining[0]!.remainingQty).toBe(50);
  });

  it("sorts layers by receipt date regardless of input order", () => {
    const layers = [
      layer("L2", "2026-03-01", 50, 7000n), // newer
      layer("L1", "2026-01-01", 50, 5000n), // older — consumed first
    ];
    const result = consumeFifo(layers, 30);
    expect(result.consumed[0]!.layerId).toBe("L1"); // FIFO = oldest first
    expect(result.consumed[0]!.unitCostPaise).toBe(5000n);
  });

  it("throws INSUFFICIENT_STOCK when issueQty exceeds available", () => {
    const layers = [layer("L1", "2026-01-01", 10, 5000n)];
    expect(() => consumeFifo(layers, 11)).toThrow("INSUFFICIENT_STOCK");
  });

  it("throws INSUFFICIENT_STOCK for empty layers", () => {
    expect(() => consumeFifo([], 1)).toThrow("INSUFFICIENT_STOCK");
  });

  it("throws INVALID_ISSUE_QTY for zero quantity", () => {
    const layers = [layer("L1", "2026-01-01", 10, 5000n)];
    expect(() => consumeFifo(layers, 0)).toThrow("INVALID_ISSUE_QTY");
  });

  it("throws INVALID_ISSUE_QTY for negative quantity", () => {
    const layers = [layer("L1", "2026-01-01", 10, 5000n)];
    expect(() => consumeFifo(layers, -5)).toThrow("INVALID_ISSUE_QTY");
  });

  it("exact consumption empties all layers (remaining is empty)", () => {
    const layers = [
      layer("L1", "2026-01-01", 20, 5000n),
      layer("L2", "2026-02-01", 30, 6000n),
    ];
    const result = consumeFifo(layers, 50);
    expect(result.remaining).toHaveLength(0);
    expect(result.totalCostPaise).toBe(20n * 5000n + 30n * 6000n); // 100000 + 180000 = 280000
  });

  it("totalCostPaise is exact bigint (no floating point)", () => {
    // ₹99.99 unit cost * 3 = ₹299.97 = 29997 paise
    const layers = [layer("L1", "2026-01-01", 10, 9999n)];
    const result = consumeFifo(layers, 3);
    expect(result.totalCostPaise).toBe(29997n);
  });

  it("handles many small layers efficiently", () => {
    const layers = Array.from({ length: 100 }, (_, i) =>
      layer(`L${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`, 1, BigInt(1000 + i)),
    );
    const result = consumeFifo(layers, 50);
    expect(result.consumed).toHaveLength(50);
    expect(result.remaining).toHaveLength(50);
  });
});

// ═══ WAVG Engine ═══

describe("recomputeWavg — weighted average recomputation", () => {
  it("first receipt sets unit cost directly", () => {
    const existing: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    const receipt: WavgReceipt = { qty: 100, unitCostPaise: 5000n };
    const result = recomputeWavg(existing, receipt);
    expect(result.qty).toBe(100);
    expect(result.unitCostPaise).toBe(5000n);
    expect(result.totalCostPaise).toBe(500000n);
  });

  it("blends two receipts at different prices", () => {
    // 100 @ ₹50 + 100 @ ₹60 → avg = (500000 + 600000) / 200 = 5500 paise
    const existing: WavgState = { qty: 100, totalCostPaise: 500000n, unitCostPaise: 5000n };
    const receipt: WavgReceipt = { qty: 100, unitCostPaise: 6000n };
    const result = recomputeWavg(existing, receipt);
    expect(result.qty).toBe(200);
    expect(result.unitCostPaise).toBe(5500n);
    expect(result.totalCostPaise).toBe(1100000n);
  });

  it("zero receipt qty is a no-op", () => {
    const existing: WavgState = { qty: 50, totalCostPaise: 250000n, unitCostPaise: 5000n };
    const result = recomputeWavg(existing, { qty: 0, unitCostPaise: 9999n });
    expect(result.qty).toBe(50);
    expect(result.unitCostPaise).toBe(5000n);
  });

  it("uses bigint floor division (no rounding up)", () => {
    // 10 @ 1001 + 10 @ 1000 → total = 10010 + 10000 = 20010 / 20 = 1000 (floor)
    const existing: WavgState = { qty: 10, totalCostPaise: 10010n, unitCostPaise: 1001n };
    const receipt: WavgReceipt = { qty: 10, unitCostPaise: 1000n };
    const result = recomputeWavg(existing, receipt);
    expect(result.unitCostPaise).toBe(1000n); // 20010 / 20 = 1000 (floor)
  });

  it("large values stay precise in bigint", () => {
    // ₹1,00,00,000 (1 crore) × 1000 units + ₹1,50,00,000 × 500 units
    const existing: WavgState = { qty: 1000, totalCostPaise: 100000000000n, unitCostPaise: 100000000n };
    const receipt: WavgReceipt = { qty: 500, unitCostPaise: 150000000n };
    const result = recomputeWavg(existing, receipt);
    expect(result.qty).toBe(1500);
    // (100000000000 + 75000000000) / 1500 = 175000000000 / 1500 = 116666666n
    expect(result.unitCostPaise).toBe(116666666n);
  });

  it("successive receipts converge the average", () => {
    let state: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    state = recomputeWavg(state, { qty: 100, unitCostPaise: 1000n });
    expect(state.unitCostPaise).toBe(1000n);
    state = recomputeWavg(state, { qty: 100, unitCostPaise: 2000n });
    expect(state.unitCostPaise).toBe(1500n); // midpoint
    state = recomputeWavg(state, { qty: 200, unitCostPaise: 1500n });
    expect(state.unitCostPaise).toBe(1500n); // already at avg
  });

  it("unit cost never goes negative with valid inputs", () => {
    const state: WavgState = { qty: 10, totalCostPaise: 50000n, unitCostPaise: 5000n };
    // Even a very cheap receipt keeps the average positive
    const result = recomputeWavg(state, { qty: 100, unitCostPaise: 1n });
    expect(result.unitCostPaise).toBeGreaterThanOrEqual(0n);
  });
});
