/**
 * WAVG Cost-Layer Engine tests — pure domain logic.
 *
 * Covers:
 *   1. First receipt (sets rate directly)
 *   2. Subsequent receipt (weighted average recomputation)
 *   3. Large values (bigint precision)
 *   4. Zero combined quantity (rate = 0)
 *   5. Multiple sequential receipts
 *   6. Zero receipt qty (no-op)
 *
 * Validates: Requirements 14.4
 */
import { describe, it, expect } from "vitest";
import { recomputeWavg, type WavgState } from "../src/modules/costing/wavg-engine.js";

describe("recomputeWavg — first receipt (zero existing qty)", () => {
  it("sets rate directly from receipt when existing qty is zero", () => {
    const existing: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    const receipt = { qty: 100, unitCostPaise: 5000n };

    const result = recomputeWavg(existing, receipt);

    expect(result.qty).toBe(100);
    expect(result.totalCostPaise).toBe(500000n); // 100 * 5000
    expect(result.unitCostPaise).toBe(5000n); // directly from receipt
  });

  it("sets rate for a single unit first receipt", () => {
    const existing: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    const receipt = { qty: 1, unitCostPaise: 99999n };

    const result = recomputeWavg(existing, receipt);

    expect(result.qty).toBe(1);
    expect(result.totalCostPaise).toBe(99999n);
    expect(result.unitCostPaise).toBe(99999n);
  });
});

describe("recomputeWavg — subsequent receipt (weighted average)", () => {
  it("computes weighted average of two rates", () => {
    // Existing: 100 units at 5000 paise each (total = 500000)
    const existing: WavgState = { qty: 100, totalCostPaise: 500000n, unitCostPaise: 5000n };
    // Receipt: 100 units at 6000 paise each (total = 600000)
    const receipt = { qty: 100, unitCostPaise: 6000n };

    const result = recomputeWavg(existing, receipt);

    // New total: 500000 + 600000 = 1100000
    // New qty: 200
    // New rate: 1100000 / 200 = 5500
    expect(result.qty).toBe(200);
    expect(result.totalCostPaise).toBe(1100000n);
    expect(result.unitCostPaise).toBe(5500n);
  });

  it("uses floor division when result is not evenly divisible", () => {
    // Existing: 3 units at 100 paise each (total = 300)
    const existing: WavgState = { qty: 3, totalCostPaise: 300n, unitCostPaise: 100n };
    // Receipt: 2 units at 200 paise each (total = 400)
    const receipt = { qty: 2, unitCostPaise: 200n };

    const result = recomputeWavg(existing, receipt);

    // New total: 300 + 400 = 700
    // New qty: 5
    // New rate: 700 / 5 = 140 (exact division here)
    expect(result.qty).toBe(5);
    expect(result.totalCostPaise).toBe(700n);
    expect(result.unitCostPaise).toBe(140n);
  });

  it("applies bigint floor division (truncates toward zero)", () => {
    // Existing: 7 units at 100 paise each (total = 700)
    const existing: WavgState = { qty: 7, totalCostPaise: 700n, unitCostPaise: 100n };
    // Receipt: 3 units at 110 paise each (total = 330)
    const receipt = { qty: 3, unitCostPaise: 110n };

    const result = recomputeWavg(existing, receipt);

    // New total: 700 + 330 = 1030
    // New qty: 10
    // New rate: 1030 / 10 = 103 (exact)
    expect(result.qty).toBe(10);
    expect(result.totalCostPaise).toBe(1030n);
    expect(result.unitCostPaise).toBe(103n);
  });

  it("floor divides correctly when remainder exists", () => {
    // Existing: 2 units at 100 paise (total = 200)
    const existing: WavgState = { qty: 2, totalCostPaise: 200n, unitCostPaise: 100n };
    // Receipt: 1 unit at 50 paise (total = 50)
    const receipt = { qty: 1, unitCostPaise: 50n };

    const result = recomputeWavg(existing, receipt);

    // New total: 200 + 50 = 250
    // New qty: 3
    // New rate: 250 / 3 = 83 (floor, not 83.33)
    expect(result.qty).toBe(3);
    expect(result.totalCostPaise).toBe(250n);
    expect(result.unitCostPaise).toBe(83n);
  });
});

describe("recomputeWavg — large values (bigint precision)", () => {
  it("handles large quantities and costs without overflow", () => {
    // Existing: 1,000,000 units at 9,999,999 paise each
    const existing: WavgState = {
      qty: 1_000_000,
      totalCostPaise: 9_999_999_000_000n,
      unitCostPaise: 9_999_999n,
    };
    // Receipt: 500,000 units at 10,000,001 paise each
    const receipt = { qty: 500_000, unitCostPaise: 10_000_001n };

    const result = recomputeWavg(existing, receipt);

    // New total: 9_999_999_000_000 + 5_000_000_500_000 = 14_999_999_500_000
    // New qty: 1_500_000
    // New rate: 14_999_999_500_000 / 1_500_000 = 9_999_999 (floor)
    expect(result.qty).toBe(1_500_000);
    expect(result.totalCostPaise).toBe(14_999_999_500_000n);
    expect(result.unitCostPaise).toBe(9_999_999n);
  });

  it("handles values exceeding 2^53 safely in bigint", () => {
    // Values beyond Number.MAX_SAFE_INTEGER to verify bigint correctness
    const largeRate = 10_000_000_000_000n; // 10 trillion paise per unit
    const existing: WavgState = {
      qty: 1_000_000,
      totalCostPaise: largeRate * 1_000_000n,
      unitCostPaise: largeRate,
    };
    const receipt = { qty: 1_000_000, unitCostPaise: largeRate + 2n };

    const result = recomputeWavg(existing, receipt);

    // New total: 10^18 + (10^13 + 2) * 10^6 = 10^18 + 10^19 + 2*10^6
    // New qty: 2,000,000
    const expectedTotal = largeRate * 1_000_000n + (largeRate + 2n) * 1_000_000n;
    const expectedRate = expectedTotal / 2_000_000n;
    expect(result.qty).toBe(2_000_000);
    expect(result.totalCostPaise).toBe(expectedTotal);
    expect(result.unitCostPaise).toBe(expectedRate);
  });
});

describe("recomputeWavg — zero combined qty", () => {
  it("returns zero rate when both existing and receipt qty are zero", () => {
    const existing: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    const receipt = { qty: 0, unitCostPaise: 5000n };

    const result = recomputeWavg(existing, receipt);

    // Zero receipt → no-op, returns existing state
    expect(result.qty).toBe(0);
    expect(result.totalCostPaise).toBe(0n);
    expect(result.unitCostPaise).toBe(0n);
  });
});

describe("recomputeWavg — zero receipt qty (no-op)", () => {
  it("returns existing state unchanged when receipt qty is zero", () => {
    const existing: WavgState = { qty: 50, totalCostPaise: 250000n, unitCostPaise: 5000n };
    const receipt = { qty: 0, unitCostPaise: 9999n };

    const result = recomputeWavg(existing, receipt);

    expect(result.qty).toBe(50);
    expect(result.totalCostPaise).toBe(250000n);
    expect(result.unitCostPaise).toBe(5000n);
  });

  it("does not mutate the original state object on no-op", () => {
    const existing: WavgState = { qty: 10, totalCostPaise: 1000n, unitCostPaise: 100n };
    const receipt = { qty: 0, unitCostPaise: 500n };

    const result = recomputeWavg(existing, receipt);

    // Result is a new object (spread copy)
    expect(result).not.toBe(existing);
    expect(result).toEqual(existing);
  });
});

describe("recomputeWavg — multiple sequential receipts", () => {
  it("correctly accumulates average across 3 sequential receipts", () => {
    // Receipt 1: 10 units at 100 paise
    let state: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    state = recomputeWavg(state, { qty: 10, unitCostPaise: 100n });

    expect(state.qty).toBe(10);
    expect(state.totalCostPaise).toBe(1000n);
    expect(state.unitCostPaise).toBe(100n);

    // Receipt 2: 10 units at 200 paise
    state = recomputeWavg(state, { qty: 10, unitCostPaise: 200n });

    // Total: 1000 + 2000 = 3000, qty: 20, rate: 150
    expect(state.qty).toBe(20);
    expect(state.totalCostPaise).toBe(3000n);
    expect(state.unitCostPaise).toBe(150n);

    // Receipt 3: 20 units at 300 paise
    state = recomputeWavg(state, { qty: 20, unitCostPaise: 300n });

    // Total: 3000 + 6000 = 9000, qty: 40, rate: 225
    expect(state.qty).toBe(40);
    expect(state.totalCostPaise).toBe(9000n);
    expect(state.unitCostPaise).toBe(225n);
  });

  it("handles progressive receipts with floor division accumulation", () => {
    // Receipt 1: 3 units at 10 paise
    let state: WavgState = { qty: 0, totalCostPaise: 0n, unitCostPaise: 0n };
    state = recomputeWavg(state, { qty: 3, unitCostPaise: 10n });

    expect(state.qty).toBe(3);
    expect(state.unitCostPaise).toBe(10n);

    // Receipt 2: 2 units at 7 paise
    state = recomputeWavg(state, { qty: 2, unitCostPaise: 7n });

    // Total: 30 + 14 = 44, qty: 5, rate: 44/5 = 8 (floor)
    expect(state.qty).toBe(5);
    expect(state.totalCostPaise).toBe(44n);
    expect(state.unitCostPaise).toBe(8n);

    // Receipt 3: 1 unit at 20 paise
    state = recomputeWavg(state, { qty: 1, unitCostPaise: 20n });

    // Total: 5*8 + 20 = 40 + 20 = 60, qty: 6, rate: 60/6 = 10
    // NOTE: uses existing.unitCostPaise (8) × existing.qty (5) = 40, not totalCostPaise (44)
    // This matches the formula: (existingQty × existingRate + receiptQty × receiptRate) / combined
    expect(state.qty).toBe(6);
    // existingValue = 5 * 8 = 40, receiptValue = 1 * 20 = 20, total = 60
    expect(state.totalCostPaise).toBe(60n);
    expect(state.unitCostPaise).toBe(10n);
  });
});
