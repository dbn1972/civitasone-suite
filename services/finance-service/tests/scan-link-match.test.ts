/** Scan-link (Finance target) -- pure matching rules. No DB. */
import { describe, it, expect } from "vitest";
import {
  normaliseReference, maskReference, parseMinor, formatPaise, evaluateMatch,
} from "../src/modules/scan-link/match.js";

describe("normaliseReference", () => {
  it("is case, whitespace and punctuation insensitive", () => {
    expect(normaliseReference(" Bill/No. 2026-0091 ")).toBe("billno20260091");
    expect(normaliseReference("BILL-NO 2026 0091")).toBe(normaliseReference("bill no/2026/0091"));
  });
  it("empty / null -> empty string", () => {
    expect(normaliseReference(null)).toBe("");
    expect(normaliseReference("  -- ")).toBe("");
  });
});

describe("maskReference", () => {
  it("shows only the last 4 characters", () => {
    expect(maskReference("BILL-2026-0091")).toBe("****0091");
    expect(maskReference("AB")).toBe("****");
    expect(maskReference(null)).toBe("(none)");
  });
});

describe("paise helpers (bigint, no float)", () => {
  it("parseMinor accepts only non-negative digit strings", () => {
    expect(parseMinor("1234567890123")).toBe(1_234_567_890_123n);
    expect(parseMinor("9007199254740993")).toBe(9_007_199_254_740_993n); // > 2^53: a Number would round
    expect(parseMinor("12.5")).toBeNull();
    expect(parseMinor("-1")).toBeNull();
    expect(parseMinor(null)).toBeNull();
  });
  it("formatPaise groups the Indian way without precision loss", () => {
    expect(formatPaise(1_234_567_890_123n)).toBe("12,34,56,78,901.23");
    expect(formatPaise(9_007_199_254_740_993n)).toBe("9,00,71,99,25,47,409.93");
    expect(formatPaise(5n)).toBe("0.05");
  });
});

describe("evaluateMatch", () => {
  const target = { references: ["BILL/2026/0091"], amountsMinor: [1_234_567_890_123n] };
  it("exact reference (normalised) + exact amount -> match", () => {
    const m = evaluateMatch({ reference: "bill 2026 0091", amountMinor: "1234567890123" }, target);
    expect(m).toMatchObject({ outcome: "match", matchedAmountMinor: 1_234_567_890_123n });
  });
  it("one paise off -> amount_mismatch (never match)", () => {
    const m = evaluateMatch({ reference: "BILL/2026/0091", amountMinor: "1234567890124" }, target);
    expect(m.outcome).toBe("amount_mismatch");
    if (m.outcome === "amount_mismatch") {
      expect(m.reason).toBe("AMOUNT_MISMATCH");
      expect(m.detail).toEqual({ expectedMinor: "1234567890123", scannedMinor: "1234567890124" }); // digit strings, no float
      expect(JSON.stringify(m)).not.toContain("0091"); // no reference text
    }
  });
  it("amount is exact: 1 paise either way is flagged", () => {
    const hint = { reference: "BILL/2026/0091", amountMinor: "1234567890124" };
    expect(evaluateMatch(hint, target).outcome).toBe("amount_mismatch");
    expect(evaluateMatch({ ...hint, amountMinor: "1234567890122" }, target).outcome).toBe("amount_mismatch");
  });
  it("different reference -> reference_mismatch even when the amount is equal", () => {
    const m = evaluateMatch({ reference: "BILL/2026/0092", amountMinor: "1234567890123" }, target);
    expect(m).toMatchObject({ outcome: "reference_mismatch", reason: "REFERENCE_MISMATCH" });
    expect(JSON.stringify(m)).not.toMatch(/0092|0091/);
  });
  it("missing reference or amount hint -> hint_missing, never match", () => {
    expect(evaluateMatch({ reference: null, amountMinor: "1" }, target)).toMatchObject({ outcome: "hint_missing", reason: "MISSING_MATCH_HINT", detail: { missing: "reference" } });
    expect(evaluateMatch({ reference: "BILL/2026/0091", amountMinor: null }, target).outcome).toBe("hint_missing");
    expect(evaluateMatch(undefined, target).outcome).toBe("hint_missing");
  });
  it("any of several record amounts counts (bill gross OR net)", () => {
    const bill = { references: ["B-1"], amountsMinor: [100_000n, 90_000n] };
    expect(evaluateMatch({ reference: "b1", amountMinor: "90000" }, bill).outcome).toBe("match");
    expect(evaluateMatch({ reference: "b1", amountMinor: "95000" }, bill).outcome).toBe("amount_mismatch");
  });
});
