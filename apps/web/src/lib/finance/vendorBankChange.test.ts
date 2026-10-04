import { describe, it, expect } from "vitest";
import { validateBankChange } from "./vendorBankChange";

const ok = { bankName: "State Bank of India", bankAccount: "9988 7766 5544", ifsc: "sbin0001234", reason: "Moved banks, see letter" };

describe("validateBankChange", () => {
  it("normalises the account (spaces) and IFSC (upper-case) and trims", () => {
    const r = validateBankChange({ ...ok, bankName: "  State Bank of India " });
    expect(r).toEqual({ ok: true, body: { bankName: "State Bank of India", bankAccount: "998877665544", ifsc: "SBIN0001234", reason: "Moved banks, see letter" } });
  });
  it("reports every invalid field with its own key", () => {
    const r = validateBankChange({ bankName: "S", bankAccount: "12", ifsc: "BAD", reason: "no" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ bankName: "bankNameRequired", bankAccount: "bankAccountInvalid", ifsc: "ifscInvalid", reason: "reasonTooShort" });
  });
  it("rejects an account with punctuation or more than 30 characters", () => {
    expect(validateBankChange({ ...ok, bankAccount: "1234-5678" }).ok).toBe(false);
    expect(validateBankChange({ ...ok, bankAccount: "1".repeat(31) }).ok).toBe(false);
  });
});
