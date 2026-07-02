/**
 * Coverage tests for payments/domain.ts (0% → target: 100%).
 * Pure domain logic — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import {
  DomainError,
  assertThreeWayMatchPresent,
  assertThreeWayMatch,
  assertValidPaymentMode,
  assertBillPassed,
  nextStage,
  DEFAULT_THREE_WAY_TOLERANCE_PCT,
} from "../src/modules/payments/domain.js";

describe("payments/domain — assertThreeWayMatchPresent()", () => {
  it("passes when both PO and GRN refs present", () => {
    expect(() => assertThreeWayMatchPresent("PO-001", "GRN-001")).not.toThrow();
  });

  it("throws when PO ref missing", () => {
    expect(() => assertThreeWayMatchPresent(null, "GRN-001")).toThrow(DomainError);
  });

  it("throws when GRN ref missing", () => {
    expect(() => assertThreeWayMatchPresent("PO-001", null)).toThrow(DomainError);
  });

  it("throws when both missing", () => {
    expect(() => assertThreeWayMatchPresent(null, null)).toThrow(DomainError);
    try { assertThreeWayMatchPresent(null, null); } catch (e) {
      expect((e as DomainError).code).toBe("THREE_WAY_MATCH_FAILED");
    }
  });
});

describe("payments/domain — assertThreeWayMatch()", () => {
  it("passes when all legs match within tolerance", () => {
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", {
      poAmountMinor: 1000000n,
      grnAmountMinor: 1000000n,
      invoiceMinor: 1000000n,
    })).not.toThrow();
  });

  it("passes when invoice is below GRN (under-billing)", () => {
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", {
      poAmountMinor: 1000000n,
      grnAmountMinor: 1000000n,
      invoiceMinor: 900000n, // 10% under — allowed
    })).not.toThrow();
  });

  it("throws when GRN exceeds PO beyond tolerance", () => {
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", {
      poAmountMinor: 1000000n,
      grnAmountMinor: 1100000n, // 10% over, default tolerance is 2%
      invoiceMinor: 1000000n,
    })).toThrow(DomainError);
    try {
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 1000000n, grnAmountMinor: 1100000n, invoiceMinor: 1000000n,
      });
    } catch (e) { expect((e as DomainError).code).toBe("GRN_EXCEEDS_PO"); }
  });

  it("throws when invoice exceeds GRN beyond tolerance", () => {
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", {
      poAmountMinor: 1000000n,
      grnAmountMinor: 1000000n,
      invoiceMinor: 1050000n, // 5% over tolerance (default 2%)
    })).toThrow(DomainError);
  });

  it("throws when invoice exceeds PO beyond tolerance", () => {
    try {
      assertThreeWayMatch("PO-1", "GRN-1", {
        poAmountMinor: 1000000n, grnAmountMinor: 1020000n, invoiceMinor: 1050000n,
      });
    } catch (e) {
      expect((e as DomainError).code).toMatch(/INVOICE_EXCEEDS/);
    }
  });

  it("throws when amounts are zero", () => {
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", {
      poAmountMinor: 0n, grnAmountMinor: 1000000n, invoiceMinor: 1000000n,
    })).toThrow(DomainError);
  });

  it("respects custom tolerance", () => {
    // With 10% tolerance, 5% overage passes
    expect(() => assertThreeWayMatch("PO-1", "GRN-1", {
      poAmountMinor: 1000000n,
      grnAmountMinor: 1050000n, // 5% over
      invoiceMinor: 1050000n,
    }, 10)).not.toThrow();
  });
});

describe("payments/domain — assertValidPaymentMode()", () => {
  it("passes for valid modes", () => {
    expect(() => assertValidPaymentMode("NEFT")).not.toThrow();
    expect(() => assertValidPaymentMode("RTGS")).not.toThrow();
    expect(() => assertValidPaymentMode("IMPS")).not.toThrow();
    expect(() => assertValidPaymentMode("DBT")).not.toThrow();
    expect(() => assertValidPaymentMode("PFMS")).not.toThrow();
    expect(() => assertValidPaymentMode("cheque")).not.toThrow();
  });

  it("throws for invalid mode", () => {
    expect(() => assertValidPaymentMode("bitcoin")).toThrow(DomainError);
    try { assertValidPaymentMode("UPI"); } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_PAYMENT_MODE");
    }
  });
});

describe("payments/domain — assertBillPassed()", () => {
  it("passes for status 'passed'", () => {
    expect(() => assertBillPassed("passed")).not.toThrow();
  });

  it("throws for other statuses", () => {
    expect(() => assertBillPassed("draft")).toThrow(DomainError);
    expect(() => assertBillPassed("submitted")).toThrow();
    try { assertBillPassed("draft"); } catch (e) {
      expect((e as DomainError).code).toBe("BILL_NOT_PASSED");
    }
  });
});

describe("payments/domain — nextStage()", () => {
  it("section → accounts", () => {
    expect(nextStage("section")).toBe("accounts");
  });

  it("accounts → pay", () => {
    expect(nextStage("accounts")).toBe("pay");
  });

  it("throws STAGE_TERMINAL for pay", () => {
    expect(() => nextStage("pay")).toThrow(DomainError);
    try { nextStage("pay"); } catch (e) {
      expect((e as DomainError).code).toBe("STAGE_TERMINAL");
    }
  });
});
