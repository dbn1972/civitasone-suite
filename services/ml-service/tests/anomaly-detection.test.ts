import { describe, it, expect } from "vitest";
import {
  computeZScore,
  isAnomaly,
  levenshteinDistance,
  detectDuplicates,
  type TransactionRecord,
} from "../src/modules/algorithms/anomaly-detection.js";

describe("computeZScore", () => {
  it("computes correct Z-score for positive deviation", () => {
    // (10 - 5) / 2 = 2.5
    expect(computeZScore(10, 5, 2)).toBe(2.5);
  });

  it("computes correct Z-score for negative deviation", () => {
    // (2 - 5) / 2 = -1.5
    expect(computeZScore(2, 5, 2)).toBe(-1.5);
  });

  it("returns 0 when value equals mean", () => {
    expect(computeZScore(5, 5, 2)).toBe(0);
  });

  it("returns 0 when std is 0 (never flag)", () => {
    expect(computeZScore(100, 5, 0)).toBe(0);
    expect(computeZScore(0, 0, 0)).toBe(0);
    expect(computeZScore(-50, 10, 0)).toBe(0);
  });

  it("handles large values correctly", () => {
    // (1000000 - 500000) / 100000 = 5.0
    expect(computeZScore(1_000_000, 500_000, 100_000)).toBe(5);
  });

  it("returns exactly 3.0 at boundary", () => {
    // (9 - 0) / 3 = 3.0
    expect(computeZScore(9, 0, 3)).toBe(3);
  });
});

describe("isAnomaly", () => {
  it("returns true when |zScore| exceeds default threshold (3.0)", () => {
    expect(isAnomaly(3.1)).toBe(true);
    expect(isAnomaly(-3.5)).toBe(true);
  });

  it("returns false when |zScore| is at or below threshold", () => {
    expect(isAnomaly(3.0)).toBe(false);
    expect(isAnomaly(2.9)).toBe(false);
    expect(isAnomaly(-3.0)).toBe(false);
    expect(isAnomaly(0)).toBe(false);
  });

  it("supports custom threshold", () => {
    expect(isAnomaly(2.5, 2.0)).toBe(true);
    expect(isAnomaly(1.5, 2.0)).toBe(false);
  });

  it("zero Z-score is never anomalous (handles std=0 case)", () => {
    expect(isAnomaly(0)).toBe(false);
    expect(isAnomaly(0, 0.1)).toBe(false);
  });
});

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("xyz", "")).toBe(3);
  });

  it("returns 1 for single character difference", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
    expect(levenshteinDistance("cat", "bat")).toBe(1);
  });

  it("handles insertion", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  it("handles deletion", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("computes correct distance for completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });

  it("handles multi-character edits", () => {
    // "kitten" → "sitting": k→s, e→i, +g = 3
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance("abc", "def")).toBe(
      levenshteinDistance("def", "abc")
    );
  });
});

describe("detectDuplicates", () => {
  const baseDate = new Date("2024-06-15T10:00:00Z");

  function makeTransaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
    return {
      id: "txn-1",
      amountPaise: 100000n, // ₹1000.00
      vendorId: "vendor-abc",
      date: baseDate,
      description: "Office supplies purchase",
      ...overrides,
    };
  }

  it("returns empty array for empty candidates", () => {
    const txn = makeTransaction();
    expect(detectDuplicates(txn, [])).toEqual([]);
  });

  it("detects exact duplicate (all criteria match)", () => {
    const txn = makeTransaction({ id: "txn-1" });
    const candidate = makeTransaction({ id: "txn-2" });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(1);
    expect(result[0]!.candidateId).toBe("txn-2");
    expect(result[0]!.matchScore).toBe(1.0);
    expect(result[0]!.criteria).toEqual({
      amountMatch: true,
      vendorMatch: true,
      dateMatch: true,
      descriptionMatch: true,
    });
  });

  it("detects duplicate with amount within 1% tolerance", () => {
    const txn = makeTransaction({ id: "txn-1", amountPaise: 100000n });
    // 100000 * 1% = 1000, so 100999 is within tolerance
    const candidate = makeTransaction({ id: "txn-2", amountPaise: 100999n });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(1);
  });

  it("does NOT flag when amount exceeds 1% tolerance", () => {
    const txn = makeTransaction({ id: "txn-1", amountPaise: 100000n });
    // 100000 * 1% = 1000, so 101001 exceeds tolerance
    const candidate = makeTransaction({ id: "txn-2", amountPaise: 101001n });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(0);
  });

  it("does NOT flag when vendor differs", () => {
    const txn = makeTransaction({ id: "txn-1" });
    const candidate = makeTransaction({ id: "txn-2", vendorId: "vendor-xyz" });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(0);
  });

  it("detects duplicate with date within 3 days", () => {
    const txn = makeTransaction({ id: "txn-1" });
    const candidate = makeTransaction({
      id: "txn-2",
      date: new Date(baseDate.getTime() + 3 * 86_400_000), // exactly 3 days later
    });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(1);
  });

  it("does NOT flag when date exceeds 3 days", () => {
    const txn = makeTransaction({ id: "txn-1" });
    const candidate = makeTransaction({
      id: "txn-2",
      date: new Date(baseDate.getTime() + 3 * 86_400_000 + 1), // just over 3 days
    });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(0);
  });

  it("detects duplicate with description Levenshtein ≤ 3", () => {
    const txn = makeTransaction({ id: "txn-1", description: "Office supplies" });
    // "Office supplyes" has 1 edit distance
    const candidate = makeTransaction({ id: "txn-2", description: "Office supplyes" });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(1);
  });

  it("does NOT flag when description Levenshtein > 3", () => {
    const txn = makeTransaction({ id: "txn-1", description: "Office supplies" });
    const candidate = makeTransaction({ id: "txn-2", description: "Kitchen equipment" });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(0);
  });

  it("requires ALL 4 criteria to match (3 out of 4 is not enough)", () => {
    const txn = makeTransaction({ id: "txn-1" });
    // Amount, vendor, and date match but description differs significantly
    const candidate = makeTransaction({
      id: "txn-2",
      description: "Completely different description text here",
    });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(0);
  });

  it("handles multiple candidates with mixed results", () => {
    const txn = makeTransaction({ id: "txn-1" });
    const candidates: TransactionRecord[] = [
      makeTransaction({ id: "txn-2" }), // exact duplicate
      makeTransaction({ id: "txn-3", vendorId: "other-vendor" }), // vendor mismatch
      makeTransaction({ id: "txn-4" }), // another exact duplicate
    ];

    const result = detectDuplicates(txn, candidates);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.candidateId)).toEqual(["txn-2", "txn-4"]);
  });

  it("handles zero amount on both transactions", () => {
    const txn = makeTransaction({ id: "txn-1", amountPaise: 0n });
    const candidate = makeTransaction({ id: "txn-2", amountPaise: 0n });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(1);
  });

  it("handles zero amount on reference with nonzero candidate", () => {
    const txn = makeTransaction({ id: "txn-1", amountPaise: 0n });
    const candidate = makeTransaction({ id: "txn-2", amountPaise: 100n });

    const result = detectDuplicates(txn, [candidate]);
    expect(result).toHaveLength(0);
  });
});
