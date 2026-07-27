import { describe, it, expect } from "vitest";
import { assertThreeWayMatch, assertThreeWayMatchPresent, deviationExceedsTolerance, DomainError } from "../src/modules/payments/domain.js";

/**
 * R5 — real tri-leg PO↔GRN↔invoice reconciliation (not just ref presence).
 * The invoice may not exceed the received (GRN) or ordered (PO) value beyond
 * tolerance; under-billing is allowed; unpriced legs cannot match.
 */
describe("3-way match — presence check (legacy)", () => {
  it("throws when po_ref is missing", () => {
    expect(() => assertThreeWayMatchPresent(null, "grn-1")).toThrowError(/THREE_WAY_MATCH_FAILED/);
  });
  it("throws when grn_ref is missing", () => {
    expect(() => assertThreeWayMatchPresent("po-1", undefined)).toThrowError(/THREE_WAY_MATCH_FAILED/);
  });
  it("passes when both refs present", () => {
    expect(() => assertThreeWayMatchPresent("po-1", "grn-1")).not.toThrow();
  });
});

describe("3-way match — tri-leg reconciliation (R5)", () => {
  const PO = "procurement_po:po-1";
  const GRN = "procurement_grn:grn-1";

  it("passes when invoice == GRN == PO", () => {
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 100000n, grnAmountMinor: 100000n, invoiceMinor: 100000n })).not.toThrow();
  });

  it("passes when invoice is below GRN (vendor billed less)", () => {
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 100000n, grnAmountMinor: 100000n, invoiceMinor: 80000n })).not.toThrow();
  });

  it("passes a small overage within the 2% default tolerance", () => {
    // invoice 101000 vs GRN 100000 = +1% (≤2%)
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 100000n, grnAmountMinor: 100000n, invoiceMinor: 101000n })).not.toThrow();
  });

  it("rejects an invoice exceeding GRN beyond tolerance (over-billing)", () => {
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 100000n, grnAmountMinor: 100000n, invoiceMinor: 150000n }))
      .toThrowError(/INVOICE_EXCEEDS_GRN/);
  });

  it("rejects when received value (GRN) exceeds ordered value (PO) beyond tolerance", () => {
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 100000n, grnAmountMinor: 130000n, invoiceMinor: 100000n }))
      .toThrowError(/GRN_EXCEEDS_PO/);
  });

  it("rejects when any leg is non-positive (unpriced PO/GRN cannot match)", () => {
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 0n, grnAmountMinor: 100000n, invoiceMinor: 100000n }))
      .toThrowError(DomainError);
  });

  it("still requires both refs even with valid amounts", () => {
    expect(() => assertThreeWayMatch(null, GRN, { poAmountMinor: 100000n, grnAmountMinor: 100000n, invoiceMinor: 100000n }))
      .toThrowError(/THREE_WAY_MATCH_FAILED/);
  });

  it("honours a custom (tighter) tolerance", () => {
    // +1% overage fails under a 0.5% tolerance
    expect(() => assertThreeWayMatch(PO, GRN, { poAmountMinor: 100000n, grnAmountMinor: 100000n, invoiceMinor: 101000n }, 0.5))
      .toThrowError(/INVOICE_EXCEEDS_GRN/);
  });
});

/**
 * Precision regression guards.
 *
 * The tolerance decision must not run through `overagePct()`, whose BigInt
 * division truncates toward zero and therefore quantises the measured overage
 * down to 0.01%-of-cap steps. Because the rounding always favours admitting
 * overage, the larger the PO the more unauthorised money passes. These cases all
 * sit inside one quantum, so they pass only with exact integer comparison.
 */
describe("3-way match — exact tolerance (no truncation)", () => {
  const PO = "po-1";
  const GRN = "grn-1";

  it("rejects a sub-quantum overage on a large PO at zero tolerance", () => {
    // PO Rs 1 crore = 1_000_000_000 paise; quantum = cap/10000 = 100_000 paise.
    // GRN is Rs 999.99 (99_999 paise) over — less than one quantum, so the
    // truncating percentage reports 0.00% and would admit it.
    expect(() =>
      assertThreeWayMatch(PO, GRN, {
        poAmountMinor: 1_000_000_000n,
        grnAmountMinor: 1_000_099_999n,
        invoiceMinor: 1_000_000_000n,
      }, 0),
    ).toThrowError(/GRN_EXCEEDS_PO/);
  });

  it("rejects an overage one paise above the tolerance boundary", () => {
    // PO Rs 1,000 = 100_000 paise. 2% = 2_000 paise. 2_001 paise is 2.001%,
    // which the truncating percentage reports as exactly 2.00%.
    expect(() =>
      assertThreeWayMatch(PO, GRN, {
        poAmountMinor: 100_000n,
        grnAmountMinor: 102_001n,
        invoiceMinor: 100_000n,
      }),
    ).toThrowError(/GRN_EXCEEDS_PO/);
  });

  it("still allows an overage exactly at the tolerance boundary", () => {
    // The boundary stays exclusive — exactly 2% is authorised.
    expect(() =>
      assertThreeWayMatch(PO, GRN, {
        poAmountMinor: 100_000n,
        grnAmountMinor: 102_000n,
        invoiceMinor: 100_000n,
      }),
    ).not.toThrow();
  });

  it("keeps fractional tolerances exact", () => {
    // 2.5% of 100_000 = 2_500 paise: at is allowed, one paise past is not.
    const at = { poAmountMinor: 100_000n, grnAmountMinor: 102_500n, invoiceMinor: 100_000n };
    const past = { poAmountMinor: 100_000n, grnAmountMinor: 102_501n, invoiceMinor: 100_000n };
    expect(() => assertThreeWayMatch(PO, GRN, at, 2.5)).not.toThrow();
    expect(() => assertThreeWayMatch(PO, GRN, past, 2.5)).toThrowError(/GRN_EXCEEDS_PO/);
  });

  it("rejects a sub-quantum invoice overage above GRN", () => {
    expect(() =>
      assertThreeWayMatch(PO, GRN, {
        poAmountMinor: 2_000_000_000n,
        grnAmountMinor: 1_000_000_000n,
        invoiceMinor: 1_000_099_999n,
      }, 0),
    ).toThrowError(/INVOICE_EXCEEDS_GRN/);
  });
});

describe("deviationExceedsTolerance — shared exact comparator", () => {
  it("is exclusive at the boundary", () => {
    expect(deviationExceedsTolerance(2_000n, 100_000n, 2)).toBe(false);
    expect(deviationExceedsTolerance(2_001n, 100_000n, 2)).toBe(true);
  });

  it("detects sub-quantum deviation at zero tolerance", () => {
    expect(deviationExceedsTolerance(1n, 1_000_000_000n, 0)).toBe(true);
    expect(deviationExceedsTolerance(0n, 1_000_000_000n, 0)).toBe(false);
  });

  it("treats a non-positive cap as no authorised amount", () => {
    expect(deviationExceedsTolerance(1n, 0n, 100)).toBe(true);
    expect(deviationExceedsTolerance(0n, 0n, 0)).toBe(false);
  });

  it("ignores negative deviation (under-run is always within tolerance)", () => {
    expect(deviationExceedsTolerance(-5_000n, 100_000n, 0)).toBe(false);
  });
});
