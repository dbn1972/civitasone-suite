import { describe, it, expect } from "vitest";
import { parseDebtForm, type DebtFormValues } from "./debtForm";

const OK: DebtFormValues = {
  instrument: "State Development Loan", source: "market", lender: "NABARD",
  principal: "10,00,000", ratePct: "8.5", tenureMonths: "12", firstEmiDate: "2031-05-31",
};

describe("parseDebtForm", () => {
  it("builds exact paise, whole basis points and integer months", () => {
    const r = parseDebtForm({ ...OK, principal: "1000000.05" });
    expect(r).toEqual({
      ok: true,
      body: {
        instrument: "State Development Loan", source: "market", lender: "NABARD",
        principalMinor: "100000005", interestRateBps: 850, tenureMonths: 12, firstEmiDate: "2031-05-31",
      },
    });
  });

  it("rejects thousands separators and sub-paise amounts rather than guessing", () => {
    const r = parseDebtForm(OK); // "10,00,000"
    expect(r.ok).toBe(false);
    expect(parseDebtForm({ ...OK, principal: "1.005" }).ok).toBe(false);
  });

  it("reports one error per bad field", () => {
    const r = parseDebtForm({ instrument: "x", source: "", lender: "", principal: "0", ratePct: "100.5", tenureMonths: "0", firstEmiDate: "" });
    expect(r).toEqual({
      ok: false,
      errors: { instrument: "instrument", source: "source", lender: "lender", principal: "principal", rate: "rate", tenure: "tenure", firstEmi: "firstEmi" },
    });
  });

  it("accepts a 0% loan and the 100% / 600-month limits", () => {
    expect(parseDebtForm({ ...OK, principal: "1000", ratePct: "0" }).ok).toBe(true);
    expect(parseDebtForm({ ...OK, principal: "1000", ratePct: "100", tenureMonths: "600" }).ok).toBe(true);
    expect(parseDebtForm({ ...OK, principal: "1000", tenureMonths: "601" }).ok).toBe(false);
  });
});
