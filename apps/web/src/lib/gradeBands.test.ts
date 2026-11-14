import { describe, it, expect } from "vitest";
import {
  BAND_CODE_PATTERN, bandLabel, bandsFromResponse, formatMinorAsRupees, payScaleFromPolicies, rupeesToMinor,
} from "./gradeBands";

describe("payScaleFromPolicies -- anything unreadable is the government default", () => {
  it("reads the pay_scale row", () => {
    expect(payScaleFromPolicies({ data: [{ key: "pay_scale", value: { kind: "private_bands" } }] })).toBe("private_bands");
    expect(payScaleFromPolicies({ data: [{ key: "pay_scale", value: { kind: "cpc7" } }] })).toBe("cpc7");
  });
  it("falls back to cpc7 for a missing row, a different key, garbage, null and a designation list", () => {
    for (const bad of [undefined, null, 5, "x", {}, { data: null }, { data: [] }, { data: [{ key: "wfh_eligibility", value: { kind: "private_bands" } }] },
      { data: [{ key: "pay_scale", value: { kind: "other" } }] }, { data: [{ key: "pay_scale" }] },
      [{ id: "d1", code: "CLK", name: "Clerk", level: 1 }]]) {
      expect(payScaleFromPolicies(bad)).toBe("cpc7");
    }
  });
});

describe("bandsFromResponse", () => {
  it("parses, defaults and sorts by rank then code", () => {
    const out = bandsFromResponse({ data: [
      { id: "b", code: "T3", name: "Tech Lead", rank: 30, ctcMinMinor: "100", isActive: true, version: 3, designationCount: 2 },
      { id: "a", code: "C2", rank: 20, track: "", noticeDays: 30 },
      { id: "c", code: "A1", name: "Analyst", rank: 20 },
    ] });
    expect(out.map((b) => b.code)).toEqual(["A1", "C2", "T3"]);
    expect(out[1]).toMatchObject({ name: "C2", track: null, noticeDays: 30, isActive: true, version: 1 });
    expect(out[2]).toMatchObject({ ctcMinMinor: "100", designationCount: 2, version: 3 });
  });
  it("drops malformed rows and tolerates a non-list", () => {
    expect(bandsFromResponse({ data: [{ id: 1, code: "X", rank: 1 }, { id: "a", code: "X" }, null] })).toEqual([]);
    expect(bandsFromResponse("nope")).toEqual([]);
    expect(bandsFromResponse(undefined)).toEqual([]);
  });
});

describe("money helpers", () => {
  it("formats paise as rupees with Indian grouping, exactly, even above 2^53", () => {
    expect(formatMinorAsRupees("1200000000")).toBe("1,20,00,000");
    expect(formatMinorAsRupees("12345")).toBe("123.45");
    expect(formatMinorAsRupees("0")).toBe("0");
    expect(formatMinorAsRupees("999999999999999")).toBe("99,99,99,99,99,999.99");
    expect(formatMinorAsRupees(null)).toBeNull();
    expect(formatMinorAsRupees("abc")).toBeNull();
  });
  it("parses typed rupees to paise, blank to null, junk to 'invalid'", () => {
    expect(rupeesToMinor("12,00,000")).toBe("120000000");
    expect(rupeesToMinor("1200000.5")).toBe("120000050");
    expect(rupeesToMinor(" 7 ")).toBe("700");
    expect(rupeesToMinor("")).toBeNull();
    for (const bad of ["abc", "-5", "1.234", "1e5", "12345678901234"]) expect(rupeesToMinor(bad)).toBe("invalid");
  });
  it("round-trips", () => {
    for (const minor of ["100", "123456700", "5"]) {
      const shown = formatMinorAsRupees(minor)!.replace(/,/g, "");
      expect(rupeesToMinor(shown)).toBe(minor);
    }
  });
});

describe("label and code rule", () => {
  it("labels with the name only when it adds something", () => {
    expect(bandLabel({ code: "C2", name: "Consultant 2" })).toBe("C2 — Consultant 2");
    expect(bandLabel({ code: "C2", name: "C2" })).toBe("C2");
    expect(bandLabel({ code: "C2", name: "" })).toBe("C2");
  });
  it("code pattern mirrors the server", () => {
    for (const ok of ["C2", "t3", "Sr-Mgr", "M2.1", "a_b"]) expect(BAND_CODE_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "-x", "a b", "a/b", "स"]) expect(BAND_CODE_PATTERN.test(bad)).toBe(false);
  });
});
