/** Decision C2: invoice capped at the PO amount (mismatch), warn at 90%. Pure. */
import { describe, it, expect } from "vitest";
import { evaluateMatch, invoiceCapStatus, DEFAULT_TOLERANCE_CONFIG } from "../src/modules/three-way-match/domain.js";

const lines = [{ orderedQty: 100, acceptedQty: 100 }];
const base = { poAmountMinor: 1_250_000_00n, grnAmountMinor: 1_250_000_00n, grnQtyLines: lines, invoicePresent: true };
const loose = { qtyTolerancePct: 5, priceTolerancePct: 10, totalTolerancePct: 10 };

describe("invoiceCapStatus", () => {
  it("is neutral without an invoice", () => {
    expect(invoiceCapStatus(100n, null)).toEqual({ invoiceToPoPct: null, overInvoiced: false, nearPoCap: false });
  });
  it("warns at exactly 90% but does not cap", () => {
    expect(invoiceCapStatus(1000n, 900n)).toMatchObject({ overInvoiced: false, nearPoCap: true, invoiceToPoPct: 90 });
  });
  it("is quiet below 90% and capped above 100%", () => {
    expect(invoiceCapStatus(1000n, 899n).nearPoCap).toBe(false);
    expect(invoiceCapStatus(1000n, 1001n)).toMatchObject({ overInvoiced: true, nearPoCap: false });
  });
});

describe("evaluateMatch over-invoicing cap", () => {
  it("forces mismatch when invoice exceeds PO even inside the total tolerance", () => {
    const r = evaluateMatch({ ...base, invoiceAmountMinor: 1_300_000_00n }, loose);
    expect(r.overInvoiced).toBe(true);
    expect(r.matchStatus).toBe("mismatch");
  });
  it("matches an invoice equal to the PO and flags near-cap", () => {
    const r = evaluateMatch({ ...base, invoiceAmountMinor: 1_250_000_00n }, DEFAULT_TOLERANCE_CONFIG);
    expect(r).toMatchObject({ matchStatus: "matched", overInvoiced: false, nearPoCap: true });
  });
});
