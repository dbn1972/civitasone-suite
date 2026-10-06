import { describe, it, expect } from "vitest";
import { isValidGstin, gstinCheckChar } from "./gstin";

// GAP-BILLING-GSTN-06. Published, real-world valid GSTINs (widely used as
// public test vectors). The check digit is the GSTN mod-36 checksum of the
// first 14 chars; altering any character breaks it.
const VALID = [
  "27AAPFU0939F1ZV",
  "29AABCU9603R1ZJ",
  "24AAACC1206D1ZM",
];

describe("isValidGstin (GAP-BILLING-GSTN-06)", () => {
  it.each(VALID)("accepts the valid GSTIN %s", (g) => {
    expect(isValidGstin(g)).toBe(true);
  });

  it("rejects a GSTIN whose structure is valid but whose check digit is wrong", () => {
    // Flip the last char of a known-valid GSTIN to a different (wrong) digit.
    const base = "27AAPFU0939F1ZV";
    const wrong = base.slice(0, 14) + (base[14] === "A" ? "B" : "A");
    expect(isValidGstin(wrong)).toBe(false);
  });

  it("rejects a structurally invalid string", () => {
    expect(isValidGstin("123456789012345")).toBe(false);
    expect(isValidGstin("not-a-gstin")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });

  it("is case-insensitive and trims", () => {
    expect(isValidGstin("  27aapfu0939f1zv  ")).toBe(true);
  });

  it("gstinCheckChar returns the published check char for a valid GSTIN's first 14", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckChar("29AABCU9603R1Z")).toBe("J");
  });
});
