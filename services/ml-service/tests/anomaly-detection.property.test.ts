/**
 * Property-based tests for the anomaly-detection algorithms module.
 *
 * Uses fast-check to validate universal correctness properties:
 *   - Property 8: Z-Score Anomaly Detection Correctness
 *   - Property 9: Duplicate Detection Symmetry and Criteria
 *
 * Validates: Requirements 11.1, 11.2
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  computeZScore,
  isAnomaly,
  levenshteinDistance,
  detectDuplicates,
  type TransactionRecord,
} from "../src/modules/algorithms/anomaly-detection.js";

/** Arbitrary finite, non-extreme numeric value (avoids NaN/Infinity noise). */
const arbFiniteNumber = fc.double({
  min: -1_000_000,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Arbitrary non-negative standard deviation, including 0. */
const arbStd = fc.double({
  min: 0,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Arbitrary strictly positive standard deviation (excludes the zero-std edge case). */
const arbPositiveStd = fc.double({
  min: Math.fround(0.0001),
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Arbitrary vendor id drawn from a small fixed pool to encourage matches and mismatches. */
const arbVendorId = fc.constantFrom("vendor-a", "vendor-b", "vendor-c");

/** Arbitrary short description text drawn from a small pool to encourage near/far matches. */
const arbDescription = fc.constantFrom(
  "Office supplies purchase",
  "Office supplies purchse",
  "Kitchen equipment order",
  "Travel reimbursement claim",
  ""
);

/** Arbitrary bigint amount in paise, bounded to keep percentage math meaningful. */
const arbAmountPaise = fc
  .integer({ min: 0, max: 10_000_000 })
  .map((n) => BigInt(n));

/** Arbitrary date within a reasonably small window around a fixed epoch. */
const arbDaysOffset = fc.integer({ min: -10, max: 10 });

const BASE_DATE_MS = new Date("2024-06-15T00:00:00Z").getTime();
const MS_PER_DAY = 86_400_000;

function dateFromOffset(daysOffset: number): Date {
  return new Date(BASE_DATE_MS + daysOffset * MS_PER_DAY);
}

/** Arbitrary transaction record built from the bounded pools above. */
const arbTransaction: fc.Arbitrary<TransactionRecord> = fc.record({
  id: fc.uuid(),
  amountPaise: arbAmountPaise,
  vendorId: arbVendorId,
  date: arbDaysOffset.map(dateFromOffset),
  description: arbDescription,
});

describe("Property 8: Z-Score Anomaly Detection Correctness", () => {
  it("computeZScore always matches the formula (value - mean) / std when std > 0", () => {
    fc.assert(
      fc.property(arbFiniteNumber, arbFiniteNumber, arbPositiveStd, (value, mean, std) => {
        const result = computeZScore(value, mean, std);
        const expected = (value - mean) / std;
        expect(result).toBeCloseTo(expected, 10);
      })
    );
  });

  it("computeZScore always returns 0 when std is exactly 0, regardless of value/mean", () => {
    fc.assert(
      fc.property(arbFiniteNumber, arbFiniteNumber, (value, mean) => {
        expect(computeZScore(value, mean, 0)).toBe(0);
      })
    );
  });

  it("isAnomaly flags iff the absolute z-score exceeds the threshold (default 3.0)", () => {
    fc.assert(
      fc.property(arbFiniteNumber, arbFiniteNumber, arbStd, (value, mean, std) => {
        const z = computeZScore(value, mean, std);
        const flagged = isAnomaly(z);
        expect(flagged).toBe(Math.abs(z) > 3.0);
      })
    );
  });

  it("isAnomaly respects a custom threshold boundary consistently", () => {
    fc.assert(
      fc.property(
        arbFiniteNumber,
        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        (zScore, threshold) => {
          expect(isAnomaly(zScore, threshold)).toBe(Math.abs(zScore) > threshold);
        }
      )
    );
  });

  it("a zero std-derived z-score (always 0) is never flagged as an anomaly", () => {
    fc.assert(
      fc.property(arbFiniteNumber, arbFiniteNumber, (value, mean) => {
        const z = computeZScore(value, mean, 0);
        expect(isAnomaly(z)).toBe(false);
      })
    );
  });
});

describe("Property 9: Duplicate Detection Symmetry and Criteria", () => {
  it("a candidate is flagged as a duplicate iff ALL 4 criteria independently hold", () => {
    fc.assert(
      fc.property(arbTransaction, arbTransaction, (txn, candidate) => {
        const results = detectDuplicates(txn, [candidate]);
        const flagged = results.length === 1 && results[0]!.candidateId === candidate.id;

        // Recompute each criterion independently of the implementation's internals
        // using the same public primitives to cross-check the "ALL 4" invariant.
        const amountMatch = amountsWithinTolerance(txn.amountPaise, candidate.amountPaise);
        const vendorMatch = txn.vendorId === candidate.vendorId;
        const dateMatch = Math.abs(txn.date.getTime() - candidate.date.getTime()) <= 3 * MS_PER_DAY;
        const descriptionMatch = levenshteinDistance(txn.description, candidate.description) <= 3;

        const expectedFlag = amountMatch && vendorMatch && dateMatch && descriptionMatch;

        expect(flagged).toBe(expectedFlag);

        if (flagged) {
          const match = results[0]!;
          expect(match.criteria).toEqual({
            amountMatch: true,
            vendorMatch: true,
            dateMatch: true,
            descriptionMatch: true,
          });
        }
      })
    );
  });

  it("detectDuplicates is symmetric: swapping transaction and candidate yields the same flag outcome", () => {
    fc.assert(
      fc.property(arbTransaction, arbTransaction, (a, b) => {
        const aVsB = detectDuplicates(a, [b]).length === 1;
        const bVsA = detectDuplicates(b, [a]).length === 1;
        expect(aVsB).toBe(bVsA);
      })
    );
  });

  it("returns an empty array for an empty candidates list, for any transaction", () => {
    fc.assert(
      fc.property(arbTransaction, (txn) => {
        expect(detectDuplicates(txn, [])).toEqual([]);
      })
    );
  });

  it("every returned match's candidateId corresponds to a candidate present in the input list", () => {
    fc.assert(
      fc.property(arbTransaction, fc.array(arbTransaction, { minLength: 0, maxLength: 8 }), (txn, candidates) => {
        const results = detectDuplicates(txn, candidates);
        const candidateIds = new Set(candidates.map((c) => c.id));
        for (const match of results) {
          expect(candidateIds.has(match.candidateId)).toBe(true);
        }
        // No more matches than candidates
        expect(results.length).toBeLessThanOrEqual(candidates.length);
      })
    );
  });
});

/**
 * Independent re-implementation of the ±1% amount tolerance rule (mirrors the
 * documented behavior: both-zero matches, zero-reference-with-nonzero-candidate
 * never matches) used to cross-check `detectDuplicates` without relying on its
 * internals.
 */
function amountsWithinTolerance(a: bigint, b: bigint): boolean {
  if (a === 0n && b === 0n) return true;
  if (a === 0n) return false;
  const diff = a > b ? a - b : b - a;
  const absA = a < 0n ? -a : a;
  return diff * 100n <= absA;
}
