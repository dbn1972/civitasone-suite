/**
 * Telephony Service — IVR + DID Domain: Deep tests.
 * Source: modules/ivr/domain.ts, modules/did/domain.ts
 */
import { describe, it, expect } from "vitest";
import { validateIvrHit, canAddHits, MAX_IVR_HITS_PER_CALL, InvalidDtmfError } from "../src/modules/ivr/domain.js";
import { normalizeNumber, resolveTenant, DEFAULT_TENANT_ID, type DidMapping } from "../src/modules/did/domain.js";

describe("validateIvrHit", () => {
  it("accepts valid DTMF digits 0-9*#", () => {
    const result = validateIvrHit({ menuKey: "main_menu", digit: "1", timestamp: "2026-07-01T10:00:00Z" });
    expect(result.menuKey).toBe("main_menu");
    expect(result.digit).toBe("1");
  });
  it("accepts multi-digit input", () => { expect(validateIvrHit({ menuKey: "pin", digit: "1234#", timestamp: "2026-07-01T10:00:00Z" }).digit).toBe("1234#"); });
  it("accepts * and # chars", () => { expect(validateIvrHit({ menuKey: "m", digit: "*#", timestamp: "2026-07-01T10:00:00Z" }).digit).toBe("*#"); });
  it("throws InvalidDtmfError for letters", () => { expect(() => validateIvrHit({ menuKey: "m", digit: "abc", timestamp: "2026-07-01T10:00:00Z" })).toThrow(InvalidDtmfError); });
  it("throws for empty menuKey", () => { expect(() => validateIvrHit({ menuKey: "", digit: "1", timestamp: "2026-07-01T10:00:00Z" })).toThrow(); });
  it("throws for menuKey > 64 chars", () => { expect(() => validateIvrHit({ menuKey: "x".repeat(65), digit: "1", timestamp: "2026-07-01T10:00:00Z" })).toThrow(); });
  it("throws for digit > 8 chars", () => { expect(() => validateIvrHit({ menuKey: "m", digit: "123456789", timestamp: "2026-07-01T10:00:00Z" })).toThrow(); });
});

describe("canAddHits", () => {
  it("MAX is 50", () => expect(MAX_IVR_HITS_PER_CALL).toBe(50));
  it("true when within limit", () => expect(canAddHits(45, 5)).toBe(true));
  it("true at exactly limit", () => expect(canAddHits(49, 1)).toBe(true));
  it("false when would exceed", () => expect(canAddHits(49, 2)).toBe(false));
});

describe("normalizeNumber — DID", () => {
  it("strips spaces and dashes", () => expect(normalizeNumber("+91 98765-43210")).toBe("+919876543210"));
  it("strips parens", () => expect(normalizeNumber("(011) 2345-6789")).toBe("01123456789"));
  it("already clean is unchanged", () => expect(normalizeNumber("+911234567890")).toBe("+911234567890"));
});

describe("resolveTenant", () => {
  const mappings: DidMapping[] = [
    { didNumber: "+91-11-23456789", tenantId: "t-delhi", active: true },
    { didNumber: "+91-22-87654321", tenantId: "t-mumbai", active: true },
    { didNumber: "+91-33-11111111", tenantId: "t-kolkata", active: false },
  ];
  it("resolves matching active DID", () => expect(resolveTenant("+91 11 23456789", mappings, "default")).toBe("t-delhi"));
  it("skips inactive mappings", () => expect(resolveTenant("+91-33-11111111", mappings, "default")).toBe("default"));
  it("falls back to default when no match", () => expect(resolveTenant("+91-99-00000000", mappings, "default")).toBe("default"));
  it("falls back for empty callee", () => expect(resolveTenant("", mappings, "default")).toBe("default"));
  it("DEFAULT_TENANT_ID is set", () => expect(DEFAULT_TENANT_ID).toBeTruthy());
});
