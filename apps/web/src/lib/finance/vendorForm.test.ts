import { describe, it, expect } from "vitest";
import { buildCreateVendorRequest, type VendorFormInput } from "./vendorForm";

const valid: VendorFormInput = {
  name: "Acme Supplies", category: "Goods", pan: "abcde1234f", gstin: "", address: "1 Main Rd",
  contactPerson: "", phone: "", email: "", bankName: "HDFC Bank", bankAccount: "123456789012", ifsc: "hdfc0001234",
};

describe("buildCreateVendorRequest (GAP-FINANCE-VENDORS-01)", () => {
  it("upper-cases PAN/IFSC and omits blank optional fields", () => {
    const r = buildCreateVendorRequest(valid);
    expect(r).toEqual({
      ok: true,
      body: { name: "Acme Supplies", category: "Goods", pan: "ABCDE1234F", address: "1 Main Rd", bankName: "HDFC Bank", bankAccount: "123456789012", ifsc: "HDFC0001234" },
    });
  });
  it("rejects a bad PAN, IFSC and GSTIN with field errors", () => {
    const r = buildCreateVendorRequest({ ...valid, pan: "12345", ifsc: "BAD", gstin: "XYZ" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["gstin", "ifsc", "pan"]);
  });
  it("accepts a valid GSTIN", () => {
    expect(buildCreateVendorRequest({ ...valid, gstin: "27ABCDE1234F1Z5" }).ok).toBe(true);
  });
});
