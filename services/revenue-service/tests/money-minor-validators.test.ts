/**
 * Regression tests for the money-minor validator gap (shared/validators.ts
 * `bigintString` and arrears/validators.ts `bigintStringCoerce`).
 *
 * ROOT CAUSE: `bigintString` was `z.string().regex(/^\d+$/)` -- string-only,
 * with no branch accepting a plain JSON number at all. Every route using it
 * for a money-minor field (assessment baseValue/amount, collection/bbps
 * amountMinor, rate-engine bandFrom/bandTo/rateValue) rejected the common
 * case of a client sending a JSON number instead of a pre-stringified one.
 * Separately, arrears' own hand-rolled `bigintStringCoerce` DID accept a
 * number, but via `z.number().int().min(0)` with no Number.isSafeInteger
 * guard, so an already-imprecise unsafe integer (>2^53) silently passed
 * through and got String()'d into a wrong amount instead of being rejected.
 *
 * Both are now the canonical `@civitasone/schemas` `zMoneyMinorStringNonNeg`
 * codec, which accepts string | safe-integer number and rejects unsafe
 * numbers with a proper 400 instead of laundering them.
 */
import { describe, it, expect } from "vitest";
import { bigintString } from "../src/shared/validators.js";
import { createWriteOffBody, createWaiverBody } from "../src/modules/arrears/validators.js";

describe("bigintString (shared money-minor validator)", () => {
  it("accepts a plain JSON number (the regression)", () => {
    const r = bigintString.safeParse(50000);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("50000");
  });

  it("still accepts a pre-stringified digit string", () => {
    const r = bigintString.safeParse("50000");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("50000");
  });

  it("rejects an unsafe-integer number (>2^53) instead of silently rounding it", () => {
    const r = bigintString.safeParse(9007199254740993);
    expect(r.success).toBe(false);
  });

  it("rejects a negative number", () => {
    const r = bigintString.safeParse(-1);
    expect(r.success).toBe(false);
  });

  it("rejects a non-numeric string", () => {
    const r = bigintString.safeParse("abc");
    expect(r.success).toBe(false);
  });
});

describe("arrears amountMinor (createWriteOffBody / createWaiverBody)", () => {
  const ASSESSEE = "aaaaaaaa-0000-4000-8000-000000000001";
  const DEMAND = "dddddddd-0000-4000-8000-000000000001";

  it("createWriteOffBody accepts a plain JSON number amountMinor", () => {
    const r = createWriteOffBody.safeParse({ assesseeId: ASSESSEE, amountMinor: 100000, reason: "Bad debt" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amountMinor).toBe("100000");
  });

  it("createWriteOffBody rejects an unsafe-integer amountMinor instead of silently mis-encoding it", () => {
    const r = createWriteOffBody.safeParse({
      assesseeId: ASSESSEE,
      amountMinor: 9007199254740993,
      reason: "Bad debt",
    });
    expect(r.success).toBe(false);
  });

  it("createWaiverBody accepts a plain JSON number amountMinor", () => {
    const r = createWaiverBody.safeParse({ demandId: DEMAND, amountMinor: 25000, reason: "Hardship" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amountMinor).toBe("25000");
  });
});
