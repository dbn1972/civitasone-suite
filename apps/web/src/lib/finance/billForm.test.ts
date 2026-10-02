import { describe, it, expect } from "vitest";
import { buildCreateBillRequest, buildInitiatePaymentRequest } from "./billForm";

const UUID = "11111111-2222-4333-8444-555555555555";
const base = { billNo: "INV-1", vendorId: UUID, headId: UUID, ddoCode: "ddo123", amountRupees: "1,20,000.50", billDate: "", poRef: "", grnRef: "" };

describe("buildCreateBillRequest", () => {
  it("converts rupees to a paise STRING without float math and sends no status", () => {
    const r = buildCreateBillRequest(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.grossMinor).toBe("12000050");
      expect(r.body.ddoCode).toBe("DDO123");
      expect(r.body).not.toHaveProperty("status");
    }
  });
  it("rejects a missing vendor and a zero amount with field errors", () => {
    const r = buildCreateBillRequest({ ...base, vendorId: "", amountRupees: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.vendorId).toBeTruthy();
      expect(r.errors.amountRupees).toBeTruthy();
    }
  });
  it("rejects a European decimal comma (12,50) instead of reading it as 1,250", () => {
    expect(buildCreateBillRequest({ ...base, amountRupees: "12,50" }).ok).toBe(false);
  });
  it("rejects a sub-paise amount instead of rounding it", () => {
    expect(buildCreateBillRequest({ ...base, amountRupees: "1.005" }).ok).toBe(false);
  });
});

describe("buildInitiatePaymentRequest", () => {
  const pay = { billId: UUID, ddoCode: "DDO123", mode: "NEFT", amountMinor: "1500000" };
  it("builds the initiateEftBody shape", () => {
    const r = buildInitiatePaymentRequest(pay);
    expect(r).toEqual({ ok: true, body: { billId: UUID, ddoCode: "DDO123", mode: "NEFT", amountMinor: "1500000", currency: "INR" } });
  });
  it("cannot submit without beneficiary bill, mode or amount", () => {
    const r = buildInitiatePaymentRequest({ billId: "", ddoCode: "DDO123", mode: "", amountMinor: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["amountMinor", "billId", "mode"]);
  });
});
