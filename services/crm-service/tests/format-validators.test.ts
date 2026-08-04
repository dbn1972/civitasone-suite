/**
 * DQ-003 — reusable Indian-format validators (pure).
 */
import { describe, it, expect } from "vitest";
import {
  isValidMobile,
  isValidPincode,
  isValidGstin,
  isValidPan,
  collectFormatViolations,
  CONTACT_FORMAT_SPECS,
  ACCOUNT_FORMAT_SPECS,
  FORMAT_ERROR_CODES,
} from "../src/modules/contacts/format-validators.js";

describe("isValidMobile", () => {
  it("accepts a bare 10-digit number starting 6-9", () => {
    expect(isValidMobile("9876543210")).toBe(true);
    expect(isValidMobile("6000000000")).toBe(true);
  });
  it("accepts a +91-prefixed number", () => {
    expect(isValidMobile("+919876543210")).toBe(true);
  });
  it("rejects numbers starting 0-5", () => {
    expect(isValidMobile("5876543210")).toBe(false);
    expect(isValidMobile("1234567890")).toBe(false);
  });
  it("rejects wrong length", () => {
    expect(isValidMobile("98765")).toBe(false);
    expect(isValidMobile("98765432101")).toBe(false);
  });
  it("treats absent values as valid (optional field)", () => {
    expect(isValidMobile(null)).toBe(true);
    expect(isValidMobile(undefined)).toBe(true);
    expect(isValidMobile("")).toBe(true);
  });
  it("rejects non-strings", () => {
    expect(isValidMobile(9876543210)).toBe(false);
  });
});

describe("isValidPincode", () => {
  it("accepts a 6-digit PIN not starting with 0", () => {
    expect(isValidPincode("560001")).toBe(true);
  });
  it("rejects leading zero and wrong length", () => {
    expect(isValidPincode("060001")).toBe(false);
    expect(isValidPincode("12345")).toBe(false);
    expect(isValidPincode("1234567")).toBe(false);
  });
  it("treats absent as valid", () => {
    expect(isValidPincode(undefined)).toBe(true);
  });
});

describe("isValidGstin", () => {
  it("accepts a well-formed GSTIN", () => {
    expect(isValidGstin("29ABCDE1234F1Z5")).toBe(true);
  });
  it("is case-insensitive on input", () => {
    expect(isValidGstin("29abcde1234f1z5")).toBe(true);
  });
  it("rejects malformed GSTIN", () => {
    expect(isValidGstin("29ABCDE1234F1X5")).toBe(false); // missing Z
    expect(isValidGstin("ABCDE1234F1Z5")).toBe(false);
    expect(isValidGstin("29ABCDE1234F1Z")).toBe(false);
  });
  it("treats absent as valid", () => {
    expect(isValidGstin("")).toBe(true);
  });
});

describe("isValidPan", () => {
  it("accepts a well-formed PAN", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
    expect(isValidPan("abcde1234f")).toBe(true);
  });
  it("rejects malformed PAN", () => {
    expect(isValidPan("ABCD1234F")).toBe(false);
    expect(isValidPan("ABCDE12345")).toBe(false);
  });
  it("treats absent as valid", () => {
    expect(isValidPan(null)).toBe(true);
  });
});

describe("collectFormatViolations", () => {
  it("returns no violations for a clean contact", () => {
    const v = collectFormatViolations(
      { phone: "9876543210", pincode: "560001", gstin: "29ABCDE1234F1Z5", pan: "ABCDE1234F" },
      CONTACT_FORMAT_SPECS,
    );
    expect(v).toEqual([]);
  });
  it("flags each bad field with a distinct code", () => {
    const v = collectFormatViolations(
      { phone: "123", pincode: "0", gstin: "bad", pan: "bad" },
      CONTACT_FORMAT_SPECS,
    );
    const codes = v.map((x) => x.code).sort();
    expect(codes).toEqual(
      [
        FORMAT_ERROR_CODES.gstin,
        FORMAT_ERROR_CODES.mobile,
        FORMAT_ERROR_CODES.pan,
        FORMAT_ERROR_CODES.pincode,
      ].sort(),
    );
  });
  it("account specs only check gstin + pan", () => {
    const v = collectFormatViolations({ phone: "123", gstin: "bad" }, ACCOUNT_FORMAT_SPECS);
    expect(v.map((x) => x.field)).toEqual(["gstin"]);
  });
  it("defaults to contact specs", () => {
    expect(collectFormatViolations({ phone: "9876543210" })).toEqual([]);
  });
});
