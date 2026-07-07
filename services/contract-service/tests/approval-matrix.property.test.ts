/**
 * Property-Based Test for Contract Approval Matrix Level Selection.
 * Uses fast-check to verify the approval matrix resolves the correct level
 * for any contract value and any valid matrix configuration.
 *
 * **Validates: Requirements 9.6**
 *
 * Property 16: Contract Approval Matrix Level Selection
 * - For any contract value and any valid approval matrix configuration (1-5 thresholds, sorted ascending),
 *   the selected approval level must be:
 *   1. The highest threshold that the contract value meets or exceeds
 *   2. Deterministic (same value + same matrix = same level)
 *   3. Never skip a level
 *   4. If value < lowest threshold, select level 0 (no approval needed or basic level)
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveApprovalLevel, MAX_APPROVAL_LEVELS, type ApprovalLevel } from "../src/modules/approvals/domain.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a valid bigint paise value (positive, realistic contract values up to 10^15 paise = 10 billion INR) */
const contractValueArb: fc.Arbitrary<bigint> = fc.bigInt({ min: 0n, max: 1_000_000_000_000_000n });

/** Generates a valid approval role string */
const roleArb: fc.Arbitrary<string> = fc.constantFrom(
  "department_head",
  "finance_officer",
  "director",
  "secretary",
  "minister",
);

/**
 * Generates a valid approval matrix with 1-5 levels, each with distinct ascending thresholds.
 * Thresholds are strictly increasing (sorted ascending) to avoid ambiguity.
 */
const approvalMatrixArb: fc.Arbitrary<ApprovalLevel[]> = fc
  .tuple(
    fc.integer({ min: 1, max: MAX_APPROVAL_LEVELS }),
    fc.array(
      fc.bigInt({ min: 1n, max: 1_000_000_000_000_000n }),
      { minLength: MAX_APPROVAL_LEVELS, maxLength: MAX_APPROVAL_LEVELS },
    ),
    fc.array(roleArb, { minLength: MAX_APPROVAL_LEVELS, maxLength: MAX_APPROVAL_LEVELS }),
  )
  .map(([count, thresholds, roles]) => {
    // Sort and deduplicate thresholds to get strictly ascending values
    const sorted = [...new Set(thresholds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // Take the first `count` values (may be fewer if duplicates were removed)
    const usable = sorted.slice(0, count);
    return usable.map((threshold, i) => ({
      minValuePaise: threshold,
      requiredRole: roles[i]!,
    }));
  })
  .filter((levels) => levels.length >= 1);

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 16: Contract Approval Matrix Level Selection", () => {
  it("selects the highest threshold that the contract value meets or exceeds", () => {
    fc.assert(
      fc.property(contractValueArb, approvalMatrixArb, (contractValue, levels) => {
        const result = resolveApprovalLevel(contractValue, levels);

        // Sort levels ascending to reason about them
        const sorted = [...levels].sort((a, b) =>
          a.minValuePaise < b.minValuePaise ? -1 : a.minValuePaise > b.minValuePaise ? 1 : 0,
        );

        // Find the expected level: highest threshold <= contractValue
        const qualifying = sorted.filter((l) => contractValue >= l.minValuePaise);

        if (qualifying.length === 0) {
          // Value is below ALL thresholds → no level matches (null)
          expect(result).toBeNull();
        } else {
          // Should select the highest qualifying threshold
          const expected = qualifying[qualifying.length - 1]!;
          expect(result).not.toBeNull();
          expect(result!.minValuePaise).toBe(expected.minValuePaise);
          expect(result!.requiredRole).toBe(expected.requiredRole);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("is deterministic: same value + same matrix = same level", () => {
    fc.assert(
      fc.property(contractValueArb, approvalMatrixArb, (contractValue, levels) => {
        const result1 = resolveApprovalLevel(contractValue, levels);
        const result2 = resolveApprovalLevel(contractValue, levels);

        // Both calls should produce identical results
        if (result1 === null) {
          expect(result2).toBeNull();
        } else {
          expect(result2).not.toBeNull();
          expect(result2!.minValuePaise).toBe(result1!.minValuePaise);
          expect(result2!.requiredRole).toBe(result1!.requiredRole);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("never skips a level: if level N applies, all levels below N also qualify", () => {
    fc.assert(
      fc.property(contractValueArb, approvalMatrixArb, (contractValue, levels) => {
        const result = resolveApprovalLevel(contractValue, levels);

        if (result !== null) {
          // Sort ascending
          const sorted = [...levels].sort((a, b) =>
            a.minValuePaise < b.minValuePaise ? -1 : a.minValuePaise > b.minValuePaise ? 1 : 0,
          );

          // Find index of the selected level
          const selectedIdx = sorted.findIndex(
            (l) => l.minValuePaise === result.minValuePaise && l.requiredRole === result.requiredRole,
          );

          // All levels at or below the selected index must have thresholds <= contractValue
          for (let i = 0; i <= selectedIdx; i++) {
            expect(contractValue >= sorted[i]!.minValuePaise).toBe(true);
          }

          // All levels above the selected index must have thresholds > contractValue
          for (let i = selectedIdx + 1; i < sorted.length; i++) {
            expect(contractValue < sorted[i]!.minValuePaise).toBe(true);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("returns null (level 0) when value is below the lowest threshold", () => {
    fc.assert(
      fc.property(approvalMatrixArb, (levels) => {
        // Find the lowest threshold
        const lowestThreshold = levels.reduce(
          (min, l) => (l.minValuePaise < min ? l.minValuePaise : min),
          levels[0]!.minValuePaise,
        );

        // Use a value strictly below the lowest threshold
        if (lowestThreshold > 0n) {
          const belowValue = lowestThreshold - 1n;
          const result = resolveApprovalLevel(belowValue, levels);
          expect(result).toBeNull();
        }
      }),
      { numRuns: 500 },
    );
  });

  it("handles unsorted input: result is independent of input order", () => {
    fc.assert(
      fc.property(contractValueArb, approvalMatrixArb, (contractValue, levels) => {
        // Shuffle the levels array
        const shuffled = [...levels].reverse();
        const resultOriginal = resolveApprovalLevel(contractValue, levels);
        const resultShuffled = resolveApprovalLevel(contractValue, shuffled);

        if (resultOriginal === null) {
          expect(resultShuffled).toBeNull();
        } else {
          expect(resultShuffled).not.toBeNull();
          expect(resultShuffled!.minValuePaise).toBe(resultOriginal!.minValuePaise);
          expect(resultShuffled!.requiredRole).toBe(resultOriginal!.requiredRole);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("selects the exact boundary: contractValue === threshold matches that level", () => {
    fc.assert(
      fc.property(approvalMatrixArb, (levels) => {
        // Pick the highest threshold and use it as the exact contract value
        const sorted = [...levels].sort((a, b) =>
          a.minValuePaise < b.minValuePaise ? -1 : a.minValuePaise > b.minValuePaise ? 1 : 0,
        );
        const highest = sorted[sorted.length - 1]!;
        const result = resolveApprovalLevel(highest.minValuePaise, levels);

        expect(result).not.toBeNull();
        expect(result!.minValuePaise).toBe(highest.minValuePaise);
        expect(result!.requiredRole).toBe(highest.requiredRole);
      }),
      { numRuns: 500 },
    );
  });
});
