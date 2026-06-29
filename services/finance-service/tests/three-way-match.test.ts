import { describe, it, expect } from "vitest";
import { assertThreeWayMatch, assertThreeWayMatchPresent, DomainError } from "../src/modules/payments/domain.js";

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
