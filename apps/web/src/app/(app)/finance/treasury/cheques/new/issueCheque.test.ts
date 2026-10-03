import { describe, it, expect } from "vitest";
import { validateIssueCheque, issueChequePayload, type IssueChequeForm } from "./issueCheque";

const ok: IssueChequeForm = { instrumentType: "cheque", instrumentNo: "000123", bankName: "SBI", payee: "ABC Traders", amount: "1500.50", issueDate: "2026-10-01" };

describe("validateIssueCheque (GAP-FINANCE-TREASURY-CHEQUES-03)", () => {
  it("accepts a complete form", () => {
    expect(validateIssueCheque(ok, "2026-10-03")).toEqual({});
  });
  it("requires number, bank and payee", () => {
    const e = validateIssueCheque({ ...ok, instrumentNo: " ", bankName: "", payee: "" }, "2026-10-03");
    expect(e).toEqual({ instrumentNo: "required", bankName: "required", payee: "required" });
  });
  it("rejects a zero, malformed or negative amount", () => {
    for (const amount of ["", "0", "0.00", "abc", "-5", "1.234"]) {
      expect(validateIssueCheque({ ...ok, amount }, "2026-10-03").amount).toBe("amount");
    }
  });
  it("rejects a future issue date", () => {
    expect(validateIssueCheque({ ...ok, issueDate: "2026-10-04" }, "2026-10-03").issueDate).toBe("future");
  });
});

describe("issueChequePayload", () => {
  it("converts rupees to integer paise without float error and trims text", () => {
    const p = issueChequePayload({ ...ok, amount: "1.005".slice(0, 4), payee: "  ABC  " });
    expect(p).toMatchObject({ instrumentType: "cheque", payee: "ABC", amountMinor: 100, currency: "INR" });
    expect(issueChequePayload(ok)).toMatchObject({ amountMinor: 150050 });
  });
  it("omits issueDate when blank so the server defaults it, and maps dd", () => {
    const p = issueChequePayload({ ...ok, instrumentType: "dd", issueDate: "" });
    expect(p).not.toHaveProperty("issueDate");
    expect(p.instrumentType).toBe("dd");
  });
});
