/**
 * Three-Way Match domain logic tests.
 *
 * Covers:
 *   1. Perfect match (all values equal) → "matched"
 *   2. Minor variance within tolerance → "mismatch" (payment allowed)
 *   3. Variance exceeds tolerance → "exception" (payment blocked)
 *   4. Tolerance edge cases: exact boundary, zero qty, large values
 *   5. Absolute tolerance override for rate comparison
 *   6. Input validation: negative quantities/rates
 *
 * Validates: Requirements 14.10, 14.11
 */
import { describe, it, expect } from "vitest";
import {
  threeWayMatch,
  type ThreeWayMatchInput,
  type MatchTolerance,
} from "../src/modules/matching/domain.js";

describe("threeWayMatch — perfect match", () => {
  it("returns matched when all values are equal", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("matched");
    expect(result.paymentBlocked).toBe(false);
    expect(result.qtyVariances).toHaveLength(0);
    expect(result.rateVariances).toHaveLength(0);
    expect(result.summary).toContain("payment authorized");
  });

  it("returns matched with zero quantities (all zero)", () => {
    const input: ThreeWayMatchInput = {
      poQty: 0,
      poRatePaise: 0n,
      grnQty: 0,
      invoiceQty: 0,
      invoiceRatePaise: 0n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("matched");
    expect(result.paymentBlocked).toBe(false);
  });
});

describe("threeWayMatch — minor variance within tolerance (mismatch)", () => {
  it("allows payment when GRN qty is slightly less (within 5%)", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: 97, // 3% variance
      invoiceQty: 100,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
    expect(result.qtyVariances).toHaveLength(1);
    expect(result.qtyVariances[0]!.comparison).toBe("PO vs GRN");
    expect(result.qtyVariances[0]!.exceedsTolerance).toBe(false);
  });

  it("allows payment when invoice rate is slightly different (within 5%)", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 10400n, // 4% variance
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
    expect(result.rateVariances).toHaveLength(1);
    expect(result.rateVariances[0]!.exceedsTolerance).toBe(false);
  });

  it("allows payment with multiple small variances all within tolerance", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 98,      // 2% qty variance
      invoiceQty: 99,  // 1% qty variance
      invoiceRatePaise: 10200n, // 2% rate variance
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
  });
});

describe("threeWayMatch — variance exceeds tolerance (exception)", () => {
  it("blocks payment when GRN qty exceeds tolerance", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: 88, // 12% variance
      invoiceQty: 100,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
    expect(result.qtyVariances[0]!.exceedsTolerance).toBe(true);
    expect(result.summary).toContain("blocked");
  });

  it("blocks payment when invoice qty exceeds tolerance", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: 100,
      invoiceQty: 120, // 20% variance
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
  });

  it("blocks payment when invoice rate exceeds tolerance", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 12000n, // 20% variance
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
    expect(result.rateVariances[0]!.exceedsTolerance).toBe(true);
  });

  it("blocks if any single variance exceeds tolerance (even if others are fine)", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 100,       // qty matches PO
      invoiceQty: 100,   // qty matches PO
      invoiceRatePaise: 11000n, // 10% rate variance → exceeds 5%
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
  });
});

describe("threeWayMatch — tolerance edge cases", () => {
  it("variance exactly at tolerance boundary is within tolerance", () => {
    // 5% of 100 qty = 5, so GRN of 95 is exactly 5% off
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 95, // exactly 5%
      invoiceQty: 100,
      invoiceRatePaise: 10000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    // 5% variance == 5% tolerance → not exceeds (≤ comparison)
    expect(result.qtyVariances[0]!.exceedsTolerance).toBe(false);
    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
  });

  it("variance just above tolerance boundary triggers exception", () => {
    // 5.01+% variance should exceed 5% tolerance
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 94, // 6% → exceeds 5%
      invoiceQty: 100,
      invoiceRatePaise: 10000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.qtyVariances[0]!.exceedsTolerance).toBe(true);
    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
  });

  it("zero tolerance means any variance triggers exception", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 99, // 1 unit off
      invoiceQty: 100,
      invoiceRatePaise: 10000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 0 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
  });

  it("100% tolerance means nothing triggers exception", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 50, // 50% off
      invoiceQty: 200,
      invoiceRatePaise: 20000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 100 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
  });

  it("handles large bigint rate values correctly", () => {
    const input: ThreeWayMatchInput = {
      poQty: 1,
      poRatePaise: 9999999999n, // ~1 crore
      grnQty: 1,
      invoiceQty: 1,
      invoiceRatePaise: 10099999999n, // 1% over
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
  });
});

describe("threeWayMatch — absolute tolerance for rates", () => {
  it("uses absolute tolerance when configured (within)", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 10400n, // 400 paise diff
    };
    const tolerance: MatchTolerance = {
      percentageTolerance: 5,
      absoluteAmountPaise: 500n, // allow up to 500 paise
    };

    const result = threeWayMatch(input, tolerance);

    // 400 paise < 500 paise absolute → within tolerance
    expect(result.rateVariances[0]!.exceedsTolerance).toBe(false);
    expect(result.status).toBe("mismatch");
    expect(result.paymentBlocked).toBe(false);
  });

  it("uses absolute tolerance when configured (exceeds)", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 10600n, // 600 paise diff
    };
    const tolerance: MatchTolerance = {
      percentageTolerance: 5,
      absoluteAmountPaise: 500n, // allow up to 500 paise
    };

    const result = threeWayMatch(input, tolerance);

    // 600 paise > 500 paise absolute → exceeds
    expect(result.rateVariances[0]!.exceedsTolerance).toBe(true);
    expect(result.status).toBe("exception");
    expect(result.paymentBlocked).toBe(true);
  });
});

describe("threeWayMatch — input validation", () => {
  it("rejects negative PO quantity", () => {
    const input: ThreeWayMatchInput = {
      poQty: -1,
      poRatePaise: 5000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    expect(() => threeWayMatch(input, tolerance)).toThrowError("INVALID_MATCH_INPUT");
  });

  it("rejects negative GRN quantity", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: -1,
      invoiceQty: 100,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    expect(() => threeWayMatch(input, tolerance)).toThrowError("INVALID_MATCH_INPUT");
  });

  it("rejects negative invoice quantity", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: 100,
      invoiceQty: -5,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    expect(() => threeWayMatch(input, tolerance)).toThrowError("INVALID_MATCH_INPUT");
  });

  it("rejects negative PO rate", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: -5000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: 5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    expect(() => threeWayMatch(input, tolerance)).toThrowError("INVALID_MATCH_INPUT");
  });

  it("rejects negative invoice rate", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 5000n,
      grnQty: 100,
      invoiceQty: 100,
      invoiceRatePaise: -5000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    expect(() => threeWayMatch(input, tolerance)).toThrowError("INVALID_MATCH_INPUT");
  });
});

describe("threeWayMatch — variance detail reporting", () => {
  it("reports correct variance details for all mismatches", () => {
    const input: ThreeWayMatchInput = {
      poQty: 100,
      poRatePaise: 10000n,
      grnQty: 90,
      invoiceQty: 110,
      invoiceRatePaise: 11000n,
    };
    const tolerance: MatchTolerance = { percentageTolerance: 5 };

    const result = threeWayMatch(input, tolerance);

    // Should have 2 qty variances and 1 rate variance
    expect(result.qtyVariances).toHaveLength(2);
    expect(result.rateVariances).toHaveLength(1);

    // PO vs GRN
    const poGrn = result.qtyVariances.find((v) => v.comparison === "PO vs GRN")!;
    expect(poGrn.expected).toBe("100");
    expect(poGrn.actual).toBe("90");
    expect(poGrn.varianceAbsolute).toBe("10");
    expect(poGrn.exceedsTolerance).toBe(true);

    // PO vs Invoice
    const poInv = result.qtyVariances.find((v) => v.comparison === "PO vs Invoice")!;
    expect(poInv.expected).toBe("100");
    expect(poInv.actual).toBe("110");
    expect(poInv.varianceAbsolute).toBe("10");
    expect(poInv.exceedsTolerance).toBe(true);

    // Rate: PO vs Invoice
    const rate = result.rateVariances[0]!;
    expect(rate.expected).toBe("10000");
    expect(rate.actual).toBe("11000");
    expect(rate.varianceAbsolute).toBe("1000");
    expect(rate.exceedsTolerance).toBe(true);
  });
});
