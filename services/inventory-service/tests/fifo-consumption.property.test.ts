/**
 * Property-Based Test for FIFO Cost-Layer Consumption Order.
 * Uses fast-check to verify the FIFO engine consumes layers in strict
 * receipt-date ascending order and handles all edge cases correctly.
 *
 * **Validates: Requirements 14.2, 14.3**
 *
 * Property 27: FIFO Cost-Layer Consumption Order
 * - For any set of cost layers (each with qty and unit cost, ordered by receipt date)
 *   and an issue quantity:
 *   1. Layers are consumed in strict FIFO (receipt-date ascending) order
 *   2. Total consumed quantity equals the requested issue quantity (when sufficient stock)
 *   3. If issue qty exceeds total available, the engine rejects (throws/returns error)
 *   4. Cost of goods issued = sum of (consumed_qty_from_layer × layer_unit_cost) for each layer consumed
 *   5. Remaining layers have their quantities correctly decremented
 *   6. Partial consumption of a layer is valid (remainder stays for next issue)
 *   7. After consumption, layer order is preserved (earlier layers first)
 *   8. All quantities and costs remain in bigint paise (no float operations)
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { consumeFifo, type CostLayer } from "../src/modules/costing/fifo-engine.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a receipt date within a realistic range (2020–2026). */
const receiptDateArb: fc.Arbitrary<Date> = fc
  .integer({ min: 1577836800000, max: 1798761600000 }) // 2020-01-01 to 2027-01-01
  .map((ms) => new Date(ms));

/** Generates a unit cost in paise (1 paise to 10 crore per unit). */
const unitCostPaiseArb: fc.Arbitrary<bigint> = fc.bigInt({ min: 1n, max: 1_000_000_000n });

/** Generates a layer quantity (1 to 10000 units). */
const layerQtyArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10000 });

/** Generates a single cost layer with a unique ID. */
const costLayerArb = (index: number): fc.Arbitrary<CostLayer> =>
  fc.tuple(receiptDateArb, layerQtyArb, unitCostPaiseArb).map(([date, qty, cost]) => ({
    id: `L${index}`,
    receiptDate: date,
    qty,
    remainingQty: qty,
    unitCostPaise: cost,
  }));

/** Generates a non-empty array of cost layers (1 to 20 layers). */
const costLayersArb: fc.Arbitrary<CostLayer[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => costLayerArb(i))))
  .map((layers) => layers as CostLayer[]);

/**
 * Generates a set of cost layers and a valid issue quantity
 * (between 1 and total available stock).
 */
const validConsumptionArb: fc.Arbitrary<{ layers: CostLayer[]; issueQty: number }> =
  costLayersArb
    .filter((layers) => layers.reduce((sum, l) => sum + l.remainingQty, 0) > 0)
    .chain((layers) => {
      const total = layers.reduce((sum, l) => sum + l.remainingQty, 0);
      return fc.integer({ min: 1, max: total }).map((issueQty) => ({ layers, issueQty }));
    });

/**
 * Generates a set of cost layers and an issue quantity that exceeds available stock.
 */
const overIssueArb: fc.Arbitrary<{ layers: CostLayer[]; issueQty: number }> =
  costLayersArb.chain((layers) => {
    const total = layers.reduce((sum, l) => sum + l.remainingQty, 0);
    return fc.integer({ min: total + 1, max: total + 10000 }).map((issueQty) => ({ layers, issueQty }));
  });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 27: FIFO Cost-Layer Consumption Order", () => {
  it("1. layers are consumed in strict FIFO (receipt-date ascending) order", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        // Sort layers by receipt date to know expected order
        const sorted = [...layers].sort(
          (a, b) => a.receiptDate.getTime() - b.receiptDate.getTime(),
        );

        // Consumed layer IDs must appear in FIFO order (matching sorted order)
        const consumedIds = result.consumed.map((c) => c.layerId);
        const sortedIds = sorted.map((l) => l.id);

        // Verify each consumed layer appears in the same relative order as the sorted layers
        let lastSortedIndex = -1;
        for (const id of consumedIds) {
          const idx = sortedIds.indexOf(id);
          expect(idx).toBeGreaterThan(lastSortedIndex);
          lastSortedIndex = idx;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("2. total consumed quantity equals the requested issue quantity", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        const totalConsumed = result.consumed.reduce((sum, c) => sum + c.qty, 0);
        expect(totalConsumed).toBe(issueQty);
      }),
      { numRuns: 500 },
    );
  });

  it("3. rejects issue when qty exceeds total available layers", () => {
    fc.assert(
      fc.property(overIssueArb, ({ layers, issueQty }) => {
        expect(() => consumeFifo(layers, issueQty)).toThrowError("INSUFFICIENT_STOCK");
      }),
      { numRuns: 500 },
    );
  });

  it("4. cost of goods issued = sum of (consumed_qty × layer_unit_cost)", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        const expectedCost = result.consumed.reduce(
          (sum, c) => sum + BigInt(c.qty) * c.unitCostPaise,
          0n,
        );
        expect(result.totalCostPaise).toBe(expectedCost);
      }),
      { numRuns: 500 },
    );
  });

  it("5. remaining layers have their quantities correctly decremented", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        // Total remaining + total consumed must equal original total
        const originalTotal = layers.reduce((sum, l) => sum + l.remainingQty, 0);
        const totalConsumed = result.consumed.reduce((sum, c) => sum + c.qty, 0);
        const totalRemaining = result.remaining.reduce((sum, l) => sum + l.remainingQty, 0);

        expect(totalConsumed + totalRemaining).toBe(originalTotal);
      }),
      { numRuns: 500 },
    );
  });

  it("6. partial consumption of a layer leaves valid remainder for next issue", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        // Every remaining layer must have a positive remainingQty
        for (const layer of result.remaining) {
          expect(layer.remainingQty).toBeGreaterThan(0);
        }

        // If there are remaining layers, we can issue from them again
        if (result.remaining.length > 0) {
          const nextAvailable = result.remaining.reduce((sum, l) => sum + l.remainingQty, 0);
          expect(nextAvailable).toBeGreaterThan(0);

          // Consuming 1 from remaining should work without error
          const nextResult = consumeFifo(result.remaining, 1);
          expect(nextResult.consumed.length).toBeGreaterThanOrEqual(1);
          expect(nextResult.consumed.reduce((s, c) => s + c.qty, 0)).toBe(1);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("7. after consumption, remaining layer order is preserved (earlier layers first)", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        // Remaining layers must be in receipt-date ascending order
        for (let i = 1; i < result.remaining.length; i++) {
          const prev = result.remaining[i - 1]!;
          const curr = result.remaining[i]!;
          expect(prev.receiptDate.getTime()).toBeLessThanOrEqual(curr.receiptDate.getTime());
        }
      }),
      { numRuns: 500 },
    );
  });

  it("8. all quantities and costs remain in bigint paise (no float operations)", () => {
    fc.assert(
      fc.property(validConsumptionArb, ({ layers, issueQty }) => {
        const result = consumeFifo(layers, issueQty);

        // totalCostPaise is a bigint
        expect(typeof result.totalCostPaise).toBe("bigint");

        // Each consumed layer's unitCostPaise is a bigint
        for (const c of result.consumed) {
          expect(typeof c.unitCostPaise).toBe("bigint");
          // qty is an integer (no fractional units)
          expect(Number.isInteger(c.qty)).toBe(true);
          expect(c.qty).toBeGreaterThan(0);
        }

        // Each remaining layer's unitCostPaise is a bigint and remainingQty is integer
        for (const l of result.remaining) {
          expect(typeof l.unitCostPaise).toBe("bigint");
          expect(Number.isInteger(l.remainingQty)).toBe(true);
          expect(l.remainingQty).toBeGreaterThan(0);
        }

        // Cost can be independently verified as bigint arithmetic
        let verifiedCost = 0n;
        for (const c of result.consumed) {
          verifiedCost += BigInt(c.qty) * c.unitCostPaise;
        }
        expect(result.totalCostPaise).toBe(verifiedCost);
      }),
      { numRuns: 500 },
    );
  });
});
