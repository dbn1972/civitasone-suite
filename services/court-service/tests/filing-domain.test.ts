/** Pure-domain tests for the filing money guard + id derivation. */
import { describe, it, expect } from "vitest";
import { assertNonNegativeFee, deriveFilingId } from "../src/modules/filing/domain.js";

describe("filing domain — money-conservation guard", () => {
  it("accepts non-negative integer paise amounts", () => {
    expect(() => assertNonNegativeFee(0)).not.toThrow();
    expect(() => assertNonNegativeFee(15000)).not.toThrow();
  });

  it("rejects negative and non-integer amounts", () => {
    expect(() => assertNonNegativeFee(-1)).toThrow(/INVALID_FEE/);
    expect(() => assertNonNegativeFee(10.5)).toThrow(/INVALID_FEE/);
  });

  it("deriveFilingId is deterministic per (tenant, case, type, key) and differs per key", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    const k = "33333333-3333-3333-3333-333333333333";
    expect(deriveFilingId(t, c, "plaint", k)).toBe(deriveFilingId(t, c, "plaint", k));
    expect(deriveFilingId(t, c, "plaint", k)).not.toBe(deriveFilingId(t, c, "plaint", "44444444-4444-4444-4444-444444444444"));
  });
});
