import { describe, it, expect } from "vitest";
import {
  isGstinChecksumValid,
  validateGstinStrict,
  validateGstinPanMatch,
  gstinToPan,
  normalizePhone,
  validateMobileNormalized,
  validateAccountNo,
} from "./validators";

describe("GSTIN checksum (GAP-PROCUREMENT-VENDORS-NEW-02)", () => {
  // Known-good GSTINs whose check digit was computed with the GSTN algorithm.
  const VALID = ["27AAPFU0939F1ZV", "09AAACH7409R1ZZ", "19AABCT3518Q1ZT", "36AADCB2230M1ZU"];

  it("accepts known-good GSTINs", () => {
    for (const g of VALID) expect(isGstinChecksumValid(g)).toBe(true);
    for (const g of VALID) expect(validateGstinStrict(g)).toBeNull();
  });

  it("rejects a GSTIN with a flipped check digit", () => {
    // Last char changed to something that is not the real check char.
    expect(isGstinChecksumValid("27AAPFU0939F1ZX")).toBe(false);
    expect(validateGstinStrict("27AAPFU0939F1ZX")).toMatch(/check digit/);
  });

  it("rejects an invalid state code", () => {
    // 00 is not a valid state code; keep the rest format-valid.
    expect(validateGstinStrict("00AAPFU0939F1ZV")).toMatch(/state code/);
  });

  it("is optional (blank passes)", () => {
    expect(validateGstinStrict("")).toBeNull();
  });
});

describe("GSTIN↔PAN match (GAP-PROCUREMENT-VENDORS-NEW-02)", () => {
  it("extracts the PAN from a GSTIN", () => {
    expect(gstinToPan("27AAPFU0939F1ZV")).toBe("AAPFU0939F");
  });
  it("passes when PAN matches the GSTIN", () => {
    expect(validateGstinPanMatch("27AAPFU0939F1ZV", "AAPFU0939F")).toBeNull();
  });
  it("fails when PAN disagrees with the GSTIN", () => {
    expect(validateGstinPanMatch("27AAPFU0939F1ZV", "ABCDE1234F")).toMatch(/does not match/);
  });
  it("skips the check when either is blank or malformed", () => {
    expect(validateGstinPanMatch("", "ABCDE1234F")).toBeNull();
    expect(validateGstinPanMatch("27AAPFU0939F1ZV", "")).toBeNull();
  });
});

describe("phone normalization (GAP-PROCUREMENT-VENDORS-NEW-05)", () => {
  it("strips +91/91/0 prefixes and separators to 10 digits", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("098765-43210")).toBe("9876543210");
    expect(normalizePhone("919876543210")).toBe("9876543210");
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });
  it("accepts a valid mobile after normalization and rejects a short one", () => {
    expect(validateMobileNormalized("+91 98765 43210")).toBeNull();
    expect(validateMobileNormalized("12345")).toMatch(/valid/);
    // A number starting with 1-5 is not a valid Indian mobile.
    expect(validateMobileNormalized("1234567890")).toMatch(/valid/);
  });
});

describe("account number (GAP-PROCUREMENT-VENDORS-NEW-01)", () => {
  it("accepts 9-18 digits, rejects letters/short/long", () => {
    expect(validateAccountNo("123456789")).toBeNull();
    expect(validateAccountNo("123456789012345678")).toBeNull();
    expect(validateAccountNo("12345")).toMatch(/valid/);
    expect(validateAccountNo("12345678A")).toMatch(/valid/);
    expect(validateAccountNo("")).toBeNull();
  });
});
