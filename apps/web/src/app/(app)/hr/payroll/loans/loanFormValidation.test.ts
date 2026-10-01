import { describe, it, expect } from "vitest";
import { validateLoanForm, simpleInterestBoundMinor, type LoanFormInput } from "./loanFormValidation";

const valid: LoanFormInput = {
  loanNo: " LN-1 ",
  employeeId: "11111111-1111-4111-8111-111111111111",
  principalRupees: "1000",
  emiRupees: "100",
  tenureMonths: "10",
  interestRatePct: "0",
};

describe("validateLoanForm (GAP-PAYROLL-LOANS-05)", () => {
  it("parses money exactly into bigint paise", () => {
    const r = validateLoanForm({ ...valid, principalRupees: "12.50", emiRupees: "1.25", tenureMonths: "10" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.principalMinor).toBe(1250n);
      expect(r.value.emiMinor).toBe(125n);
      expect(r.value.loanNo).toBe("LN-1");
    }
  });

  it.each(["1.005", "1e3", "-5", "0", "abc"])("rejects principal %s", (principal) => {
    const r = validateLoanForm({ ...valid, principalRupees: principal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.principal).toBe("amountInvalid");
  });

  it("rejects amounts above the API's ₹10 crore ceiling", () => {
    const r = validateLoanForm({ ...valid, principalRupees: "100000000.01" });
    expect(!r.ok && r.errors.principal).toBe("amountTooLarge");
  });

  it("rejects EMI 100 x tenure 2 against principal 1000", () => {
    const r = validateLoanForm({ ...valid, principalRupees: "1000", emiRupees: "100", tenureMonths: "2" });
    expect(!r.ok && r.errors.emi).toBe("emiTooLow");
  });

  it("allows an interest-bearing loan whose EMI x tenure exceeds principal", () => {
    expect(validateLoanForm({ ...valid, emiRupees: "110", interestRatePct: "12.5" }).ok).toBe(true);
  });

  it("warns (never blocks) when EMI x tenure exceeds principal + simple interest", () => {
    // bound = 1000 x (1 + 12 x 12 / 1200) = ₹1,120.00; EMI 100 x 12 = ₹1,200.00
    const r = validateLoanForm({ ...valid, principalRupees: "1000", emiRupees: "100", tenureMonths: "12", interestRatePct: "12" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.emiAboveSimpleInterest).toEqual({ totalMinor: 120000n, boundMinor: 112000n });
  });

  it("does not warn at or under the simple-interest bound", () => {
    const at = validateLoanForm({ ...valid, principalRupees: "1000", emiRupees: "93.33", tenureMonths: "12", interestRatePct: "12" });
    expect(at.ok && at.warnings.emiAboveSimpleInterest).toBeFalsy();
    const zeroRate = validateLoanForm({ ...valid, principalRupees: "1000", emiRupees: "100", tenureMonths: "10", interestRatePct: "0" });
    expect(zeroRate.ok && zeroRate.warnings.emiAboveSimpleInterest).toBeFalsy();
  });

  it("rounds the bound up so rounding alone never triggers the warning", () => {
    // 1 paisa x 1 bps x 1 month -> interest 1/120000 paisa -> rounds up to 1
    expect(simpleInterestBoundMinor(1n, 1, 1)).toBe(2n);
    expect(simpleInterestBoundMinor(100000n, 1200, 12)).toBe(112000n);
  });

  it.each(["0", "1.5", "361", "abc"])("rejects tenure %s", (tenure) => {
    const r = validateLoanForm({ ...valid, tenureMonths: tenure });
    expect(!r.ok && r.errors.tenure).toBe("tenureInvalid");
  });

  it.each(["100.01", "5.555", "-1"])("rejects interest rate %s", (rate) => {
    const r = validateLoanForm({ ...valid, interestRatePct: rate });
    expect(!r.ok && r.errors.interestRate).toBe("rateInvalid");
  });

  it("flags every missing required field", () => {
    const r = validateLoanForm({ loanNo: " ", employeeId: null, principalRupees: "", emiRupees: "", tenureMonths: "", interestRatePct: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual({ loanNo: "required", employeeId: "required", principal: "required", emi: "required", tenure: "required" });
    }
  });
});
