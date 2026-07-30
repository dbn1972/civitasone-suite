/**
 * R-RA-0099 — application fee domain (pure). Money is bigint paise.
 */
import { describe, it, expect } from "vitest";
import {
  assessFee, gatewayEnabled, validateManualPayment, DEFAULT_EXEMPT_CATEGORIES,
} from "../src/modules/recruitment/application-fee.js";

describe("assessFee", () => {
  it("is exempt (0) when the vacancy has no fee", () => {
    expect(assessFee(0n, { category: "GEN" })).toEqual({ status: "exempt", amountMinor: 0n, exemptionReason: "no_fee_for_vacancy" });
    expect(assessFee(null, { category: "GEN" }).status).toBe("exempt");
  });
  it("is exempt for a VERIFIED default exempt category (case-insensitive)", () => {
    for (const c of DEFAULT_EXEMPT_CATEGORIES) {
      expect(assessFee(50000n, { category: c.toLowerCase(), categoryVerified: true }).status).toBe("exempt");
    }
    expect(assessFee(50000n, { category: "sc", categoryVerified: true }).exemptionReason).toBe("category_SC");
  });
  it("does NOT exempt a self-declared (unverified) exempt category — fee stays payable (H2)", () => {
    const a = assessFee(50000n, { category: "SC" }); // categoryVerified omitted -> false
    expect(a.status).toBe("pending");
    expect(a.amountMinor).toBe(50000n);
    expect(assessFee(50000n, { category: "SC", categoryVerified: false }).status).toBe("pending");
  });
  it("is pending for the vacancy fee for a non-exempt category (bigint preserved)", () => {
    const a = assessFee(50000n, { category: "GEN", categoryVerified: true });
    expect(a.status).toBe("pending");
    expect(a.amountMinor).toBe(50000n);
    expect(typeof a.amountMinor).toBe("bigint");
  });
  it("honours a custom exempt-category set (when verified)", () => {
    expect(assessFee(50000n, { category: "OBC", categoryVerified: true, exemptCategories: ["OBC"] }).status).toBe("exempt");
    expect(assessFee(50000n, { category: "SC", categoryVerified: true, exemptCategories: ["OBC"] }).status).toBe("pending");
  });
});

describe("gatewayEnabled", () => {
  it("defaults off unless flag is exactly 'true'", () => {
    expect(gatewayEnabled({})).toBe(false);
    expect(gatewayEnabled({ FEATURE_FEE_GATEWAY_ENABLED: "true" })).toBe(true);
  });
});

describe("validateManualPayment", () => {
  it("requires a payment reference", () => {
    expect(validateManualPayment({}).length).toBe(1);
    expect(validateManualPayment({ paymentRef: "CHALLAN-42" })).toEqual([]);
  });
});
