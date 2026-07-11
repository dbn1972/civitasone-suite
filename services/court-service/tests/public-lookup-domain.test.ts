/**
 * public-lookup PURE domain tests — the security-critical helpers.
 * No mocks: these are deterministic, side-effect-free functions.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeMobile, hashMobile, generateOtp, hashOtp, constantTimeEqualHex,
  cnrPrefix, toPublicDocket, deriveEstablishmentDirId, PUBLIC_CASE_FIELDS,
} from "../src/modules/public-lookup/domain.js";

describe("normalizeMobile", () => {
  it("strips non-digits and keeps the last 10", () => {
    expect(normalizeMobile("+91 98765-43210")).toBe("9876543210");
    expect(normalizeMobile("0091-9876543210")).toBe("9876543210");
    expect(normalizeMobile("9876543210")).toBe("9876543210");
  });
  it("throws INVALID_MOBILE on <10 digits", () => {
    expect(() => normalizeMobile("12345")).toThrow(/INVALID_MOBILE/);
    expect(() => normalizeMobile("abc")).toThrow(/INVALID_MOBILE/);
    expect(() => normalizeMobile("")).toThrow(/INVALID_MOBILE/);
  });
});

describe("hashMobile", () => {
  it("is deterministic and a 64-char hex sha256", () => {
    const h = hashMobile("9876543210");
    expect(h).toBe(hashMobile("+91 98765 43210")); // same normalized number → same hash
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs for different mobiles", () => {
    expect(hashMobile("9876543210")).not.toBe(hashMobile("9876543211"));
  });
  it("never returns the raw mobile", () => {
    expect(hashMobile("9876543210")).not.toContain("9876543210");
  });
});

describe("generateOtp", () => {
  it("is always exactly 6 digits (zero-padded)", () => {
    for (let i = 0; i < 500; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashOtp + constantTimeEqualHex", () => {
  it("hashOtp is deterministic per (salt, otp) and salted by challenge id", () => {
    const salt = "11111111-1111-1111-1111-111111111111";
    expect(hashOtp("123456", salt)).toBe(hashOtp("123456", salt));
    expect(hashOtp("123456", salt)).not.toBe(hashOtp("123456", "22222222-2222-2222-2222-222222222222"));
    expect(hashOtp("123456", salt)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("constant-time compare: equal → true", () => {
    const a = hashOtp("654321", "s");
    expect(constantTimeEqualHex(a, a)).toBe(true);
  });
  it("constant-time compare: different → false", () => {
    expect(constantTimeEqualHex(hashOtp("111111", "s"), hashOtp("222222", "s"))).toBe(false);
  });
  it("constant-time compare: different length → false (no throw)", () => {
    expect(constantTimeEqualHex("abcd", "abcdef")).toBe(false);
    expect(constantTimeEqualHex("", "ab")).toBe(false);
  });
});

describe("cnrPrefix", () => {
  it("uppercases, strips spaces, returns first 6", () => {
    expect(cnrPrefix("dlhc01 0001234")).toBe("DLHC01");
    expect(cnrPrefix("  mhcc9 9")).toBe("MHCC99");
    expect(cnrPrefix("ab")).toBe("AB");
  });
});

describe("toPublicDocket", () => {
  const fullRow = {
    // whitelisted
    cnrNumber: "DLHC010001234", caseType: "civil", title: "A vs B",
    status: "pending", stage: "arguments", filingDate: "2026-01-02", disposalDate: null,
    // NOT whitelisted — must never appear
    id: "row-id", tenantId: "tenant-id", courtId: "court-id", benchId: "bench-id",
    filingNumber: "F-1", version: 3, createdBy: "u1", updatedBy: "u2",
    petitionerName: "Ravi Kumar", petitionerPhone: "9876543210",
    respondentEmail: "x@y.com", address: "12 MG Road",
  } as never;

  it("returns ONLY the whitelisted fields", () => {
    const d = toPublicDocket(fullRow);
    expect(Object.keys(d).sort()).toEqual([...PUBLIC_CASE_FIELDS].sort());
  });

  it("leaks NO party/contact/PII or internal keys", () => {
    const keys = Object.keys(toPublicDocket(fullRow));
    for (const banned of [
      "id", "tenantId", "courtId", "benchId", "filingNumber", "version",
      "createdBy", "updatedBy", "petitionerName", "petitionerPhone",
      "respondentEmail", "address", "name", "phone", "email",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("carries the public values through unchanged", () => {
    const d = toPublicDocket(fullRow);
    expect(d.cnrNumber).toBe("DLHC010001234");
    expect(d.status).toBe("pending");
    expect(d.disposalDate).toBeNull();
  });
});

describe("deriveEstablishmentDirId", () => {
  it("is a stable UUIDv5 on (tenant, code) and case/space-insensitive on code", () => {
    const t = "33333333-3333-3333-3333-333333333333";
    const a = deriveEstablishmentDirId(t, "DLHC01");
    expect(a).toBe(deriveEstablishmentDirId(t, " dlhc01 "));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(deriveEstablishmentDirId(t, "MHCC01"));
  });
});
