import { describe, it, expect } from "vitest";
import {
  panSchema,
  gstinSchema,
  mobileSchema,
  gstinContainsPan,
  validateContractorIds,
} from "./indianIds";

describe("indianIds — PAN", () => {
  it("accepts a well-formed PAN", () => {
    expect(panSchema.safeParse("AAAPZ1234C").success).toBe(true);
    expect(panSchema.safeParse("ABCDE1234F").success).toBe(true);
  });
  it("rejects malformed PANs", () => {
    expect(panSchema.safeParse("ABCDE12345").success).toBe(false); // ends in digit
    expect(panSchema.safeParse("abcde1234f").success).toBe(false); // lower-case
    expect(panSchema.safeParse("ABCD1234F").success).toBe(false); // too short
  });
});

describe("indianIds — GSTIN", () => {
  it("accepts a well-formed GSTIN", () => {
    expect(gstinSchema.safeParse("29AAAPZ1234C1Z5").success).toBe(true);
  });
  it("rejects a malformed GSTIN", () => {
    expect(gstinSchema.safeParse("BADGSTIN").success).toBe(false);
    expect(gstinSchema.safeParse("29AAAPZ1234C1A5").success).toBe(false); // 13th char not Z
  });
  it("gstinContainsPan validates the embedded PAN segment", () => {
    expect(gstinContainsPan("29AAAPZ1234C1Z5", "AAAPZ1234C")).toBe(true);
    expect(gstinContainsPan("29AAAPZ1234C1Z5", "ABCDE1234F")).toBe(false);
  });
});

describe("indianIds — mobile", () => {
  it("accepts a 10-digit number starting 6-9", () => {
    expect(mobileSchema.safeParse("9876543210").success).toBe(true);
  });
  it("rejects a 9-digit number and a leading-5 number", () => {
    expect(mobileSchema.safeParse("987654321").success).toBe(false);
    expect(mobileSchema.safeParse("5876543210").success).toBe(false);
  });
});

describe("validateContractorIds", () => {
  it("returns no errors for empty/absent values (all optional)", () => {
    expect(validateContractorIds({})).toEqual({});
    expect(validateContractorIds({ pan: "", gst: "", phone: "", email: "" })).toEqual({});
  });
  it("flags each malformed field", () => {
    const errs = validateContractorIds({ pan: "BAD", gst: "BADGSTIN", phone: "123", email: "nope" });
    expect(errs.pan).toBeTruthy();
    expect(errs.gst).toBeTruthy();
    expect(errs.phone).toBeTruthy();
    expect(errs.email).toBeTruthy();
  });
  it("flags a GSTIN whose PAN segment disagrees with the given PAN", () => {
    const errs = validateContractorIds({ pan: "ABCDE1234F", gst: "29AAAPZ1234C1Z5" });
    expect(errs.gst).toMatch(/does not match the PAN/i);
  });
  it("passes a consistent PAN + GSTIN pair", () => {
    expect(validateContractorIds({ pan: "AAAPZ1234C", gst: "29AAAPZ1234C1Z5" })).toEqual({});
  });
});
