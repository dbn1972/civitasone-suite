/** Pure-domain tests for the filing money guard + id derivation. */
import { describe, it, expect } from "vitest";
import { assertNonNegativeFee, deriveFilingId, resolveFees } from "../src/modules/filing/domain.js";

describe("filing domain — money-conservation guard (BigInt paise)", () => {
  it("accepts non-negative bigint paise amounts", () => {
    expect(() => assertNonNegativeFee(0n)).not.toThrow();
    expect(() => assertNonNegativeFee(15000n)).not.toThrow();
  });

  it("rejects negative bigint amounts", () => {
    expect(() => assertNonNegativeFee(-1n)).toThrow(/INVALID_FEE/);
  });

  it("accepts amounts far beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    const huge = 900700000000000001n; // ~₹9,007 cr + 1 paisa
    expect(() => assertNonNegativeFee(huge)).not.toThrow();
  });

  it("deriveFilingId is deterministic per (tenant, case, type, key) and differs per key", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    const k = "33333333-3333-3333-3333-333333333333";
    expect(deriveFilingId(t, c, "plaint", k)).toBe(deriveFilingId(t, c, "plaint", k));
    expect(deriveFilingId(t, c, "plaint", k)).not.toBe(deriveFilingId(t, c, "plaint", "44444444-4444-4444-4444-444444444444"));
  });
});

describe("filing domain — resolveFees (§47 fee_schedule, BigInt paise)", () => {
  const fallback = { filingFeeMinor: 15000n, courtFeeMinor: 5000n };

  it("falls back to client-supplied bigint amounts when no schedule is configured", () => {
    const fees = resolveFees(undefined, fallback);
    expect(fees).toEqual({ filingFeeMinor: 15000n, courtFeeMinor: 5000n, source: "client" });
  });

  it("accepts a config schedule expressed as JSON numbers and decodes to bigint", () => {
    const fees = resolveFees({ filingFeeMinor: 25000, courtFeeMinor: 10000 }, fallback);
    expect(fees).toEqual({ filingFeeMinor: 25000n, courtFeeMinor: 10000n, source: "config" });
  });

  it("accepts a config schedule expressed as decimal strings (round-trips exactly beyond 2^53)", () => {
    const fees = resolveFees(
      { filingFeeMinor: "900700000000000001", courtFeeMinor: "500" },
      fallback,
    );
    expect(fees.filingFeeMinor).toBe(900700000000000001n);
    expect(fees.courtFeeMinor).toBe(500n);
    expect(fees.source).toBe("config");
  });

  it("rejects a negative config schedule value (poison message)", () => {
    expect(() => resolveFees({ filingFeeMinor: -5, courtFeeMinor: 10 }, fallback))
      .toThrow(/INVALID_FEE_SCHEDULE/);
  });

  it("rejects a non-numeric / malformed config schedule value (poison message)", () => {
    expect(() => resolveFees({ filingFeeMinor: "abc", courtFeeMinor: 10 }, fallback))
      .toThrow(/INVALID_FEE_SCHEDULE/);
  });
});
