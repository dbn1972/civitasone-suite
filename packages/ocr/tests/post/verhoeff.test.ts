import { describe, expect, it } from "vitest";
import { generateAadhaar, isValidAadhaar, verhoeffGenerate, verhoeffValidate } from "../../src/post/verhoeff.js";

describe("verhoeff", () => {
  it("matches the published reference vector (236 -> check digit 3)", () => {
    expect(verhoeffGenerate("236")).toBe("3");
    expect(verhoeffValidate("2363")).toBe(true);
    expect(verhoeffValidate("2364")).toBe(false);
  });
  it("round-trips generated check digits for many payloads", () => {
    for (let i = 0; i < 500; i++) {
      const payload = String(1000000 + i * 7919);
      expect(verhoeffValidate(payload + verhoeffGenerate(payload))).toBe(true);
    }
  });
  it("detects every single-digit substitution error", () => {
    const good = generateAadhaar("23456789012");
    for (let pos = 0; pos < good.length; pos++) {
      for (let dgt = 0; dgt <= 9; dgt++) {
        if (String(dgt) === good[pos]) continue;
        expect(verhoeffValidate(good.slice(0, pos) + dgt + good.slice(pos + 1))).toBe(false);
      }
    }
  });
  it("detects adjacent transpositions", () => {
    const good = generateAadhaar("29876543210");
    let detected = 0;
    let tried = 0;
    for (let i = 0; i < good.length - 1; i++) {
      if (good[i] === good[i + 1]) continue;
      const sw = good.slice(0, i) + good[i + 1] + good[i] + good.slice(i + 2);
      tried++;
      if (!verhoeffValidate(sw)) detected++;
    }
    expect(detected).toBe(tried);
  });
  it("rejects non-digit / too-short input", () => {
    expect(verhoeffValidate("")).toBe(false);
    expect(verhoeffValidate("5")).toBe(false);
    expect(verhoeffValidate("23a3")).toBe(false);
    expect(() => verhoeffGenerate("12x")).toThrow();
  });
});

describe("aadhaar", () => {
  it("accepts a valid number with or without grouping", () => {
    const a = generateAadhaar("23412341234");
    expect(a).toHaveLength(12);
    expect(isValidAadhaar(a)).toBe(true);
    expect(isValidAadhaar(`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`)).toBe(true);
    expect(isValidAadhaar(`${a.slice(0, 4)}-${a.slice(4, 8)}-${a.slice(8)}`)).toBe(true);
  });
  it("well-known UIDAI sample 234123412346 is valid", () => {
    expect(isValidAadhaar("234123412346")).toBe(true);
  });
  it("rejects wrong checksum, wrong length, leading 0/1", () => {
    const a = generateAadhaar("23412341234");
    const bad = a.slice(0, 11) + String((Number(a[11]) + 1) % 10);
    expect(isValidAadhaar(bad)).toBe(false);
    expect(isValidAadhaar(a.slice(0, 11))).toBe(false);
    expect(isValidAadhaar(`${a}0`)).toBe(false);
    for (const lead of ["0", "1"]) {
      const digits = lead + "2341234123";
      expect(isValidAadhaar(digits + verhoeffGenerate(digits))).toBe(false);
    }
    expect(() => generateAadhaar("12345678901")).toThrow();
  });
});
