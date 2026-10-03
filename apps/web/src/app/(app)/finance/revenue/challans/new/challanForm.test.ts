import { describe, it, expect } from "vitest";
import { validateChallan, challanPayload } from "./challanForm";

const ok = { receiptHeadId: "9f1b3c1e-0000-4000-8000-000000000001", depositor: "ABC Traders", amount: "2500.75", grnNo: "" };

describe("validateChallan (GAP-FINANCE-REVENUE-CHALLANS-06)", () => {
  it("accepts a complete form", () => {
    expect(validateChallan(ok)).toEqual({});
  });
  it("requires a receipt head and a depositor", () => {
    expect(validateChallan({ ...ok, receiptHeadId: "", depositor: "  " })).toEqual({ receiptHeadId: "required", depositor: "required" });
  });
  it("rejects zero, negative, sub-paise and non-numeric amounts", () => {
    for (const amount of ["", "0", "-1", "1.005", "abc"]) expect(validateChallan({ ...ok, amount }).amount).toBe("amount");
  });
});

describe("challanPayload", () => {
  it("sends integer paise without float error, trims, and omits a blank GRN", () => {
    const p = challanPayload({ ...ok, depositor: " ABC ", amount: "0.10" });
    expect(p).toMatchObject({ depositor: "ABC", amountMinor: 10, currency: "INR", receiptHeadId: ok.receiptHeadId });
    expect(p).not.toHaveProperty("grnNo");
    expect(challanPayload(ok).amountMinor).toBe(250075);
  });
  it("includes a GRN when given", () => {
    expect(challanPayload({ ...ok, grnNo: " G-1 " })).toMatchObject({ grnNo: "G-1" });
  });
});
