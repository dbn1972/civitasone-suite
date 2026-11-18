import { describe, it, expect } from "vitest";
import { validateGstSplit, validateGstHeads, splitIntraStateTax, GSTIN_RE, HSN_SAC_RE } from "../src/index.js";

const SUP = "07AAACN1234A1Z5"; // Delhi supplier
const REC_SAME = "07AABCD5678B1Z2"; // Delhi recipient (intra-state)
const REC_OTHER = "27AABCD5678B1Z9"; // Maharashtra recipient (inter-state)

describe("validateGstSplit (pure)", () => {
  const base = { supplierGstin: SUP, recipientGstin: REC_SAME, placeOfSupply: "07" };
  it("intra-state: CGST == SGST, IGST 0, sum == tax", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1800n)).toBeNull();
  });
  it("intra-state with an IGST amount is refused", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 0n, sgstMinor: 0n, igstMinor: 1800n }, 1800n)).toMatch(/intra-state/i);
  });
  it("inter-state: IGST only, sum == tax", () => {
    const o = { supplierGstin: SUP, recipientGstin: REC_OTHER, placeOfSupply: "27" };
    expect(validateGstSplit({ ...o, cgstMinor: 0n, sgstMinor: 0n, igstMinor: 1800n }, 1800n)).toBeNull();
    expect(validateGstSplit({ ...o, cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1800n)).toMatch(/inter-state/i);
  });
  it("the split must add up to the tax lines exactly", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1801n)).toMatch(/tax/i);
  });
  it("CGST and SGST must be equal", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 1000n, sgstMinor: 800n, igstMinor: 0n }, 1800n)).toMatch(/equal/i);
  });
  it("a malformed supplier or recipient GSTIN is refused", () => {
    const z = { cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n };
    expect(validateGstSplit({ ...base, supplierGstin: "BAD", ...z }, 1800n)).toMatch(/supplier GSTIN/);
    expect(validateGstSplit({ ...base, recipientGstin: "BAD", ...z }, 1800n)).toMatch(/recipient GSTIN/);
  });
  it("a malformed place of supply is refused", () => {
    expect(validateGstSplit({ ...base, placeOfSupply: "7", cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1800n)).toMatch(/place of supply/);
  });
  it("negative components are refused", () => {
    expect(validateGstSplit({ ...base, cgstMinor: -900n, sgstMinor: 2700n, igstMinor: 0n }, 1800n)).toMatch(/negative/);
  });
});

describe("odd-paise tax", () => {
  const base = { supplierGstin: "06AAACN1234A1Z5", recipientGstin: REC_SAME, placeOfSupply: "06", igstMinor: 0n };
  it("an odd intra-state tax splits CGST rounded down, SGST rounded up; anything else is refused with the exact figures", () => {
    expect(splitIntraStateTax(1801n)).toEqual({ cgstMinor: 900n, sgstMinor: 901n });
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 901n }, 1801n)).toBeNull();
    expect(validateGstSplit({ ...base, cgstMinor: 901n, sgstMinor: 900n }, 1801n)).toMatch(/odd and cannot be split equally: use CGST 900 and SGST 901/);
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 900n }, 1800n)).toBeNull();
    expect(validateGstSplit({ ...base, cgstMinor: 1000n, sgstMinor: 800n }, 1800n)).toMatch(/must be equal \(900 paise each/);
  });
});

describe("validateGstHeads (B2C, no recipient GSTIN)", () => {
  it("applies the head rule without a recipient GSTIN", () => {
    expect(validateGstHeads({ supplierGstin: SUP, placeOfSupply: "07", cgstMinor: 50n, sgstMinor: 50n, igstMinor: 0n }, 100n)).toBeNull();
    expect(validateGstHeads({ supplierGstin: SUP, placeOfSupply: "27", cgstMinor: 0n, sgstMinor: 0n, igstMinor: 100n }, 100n)).toBeNull();
    expect(validateGstHeads({ supplierGstin: SUP, placeOfSupply: "27", cgstMinor: 50n, sgstMinor: 50n, igstMinor: 0n }, 100n)).toMatch(/inter-state/);
  });
  it("nil tax is valid in both modes", () => {
    expect(validateGstHeads({ supplierGstin: SUP, placeOfSupply: "07", cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n }, 0n)).toBeNull();
  });
});

describe("patterns", () => {
  it("GSTIN_RE", () => {
    expect(GSTIN_RE.test(SUP)).toBe(true);
    expect(GSTIN_RE.test("nope")).toBe(false);
  });
  it("HSN_SAC_RE accepts 4/6/8 digits only", () => {
    for (const ok of ["9983", "998311", "99831100"]) expect(HSN_SAC_RE.test(ok)).toBe(true);
    for (const bad of ["998", "99831", "9983110", "abcd"]) expect(HSN_SAC_RE.test(bad)).toBe(false);
  });
});
