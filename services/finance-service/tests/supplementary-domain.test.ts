/**
 * SVC-035 — supplementary demand pure domain tests. No DB/IO.
 */
import { describe, it, expect } from "vitest";
import {
  assertValidSupplementaryKind,
  assertSupplementaryValid,
  assertSupplementaryApproverDistinct,
  assertSupplementaryTransition,
  availabilityAfterSupplementary,
} from "../src/modules/budget/supplementary-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("supplementary — assertValidSupplementaryKind()", () => {
  it("accepts known kinds", () => {
    for (const k of ["supplementary", "additional", "excess"]) {
      expect(() => assertValidSupplementaryKind(k)).not.toThrow();
    }
  });
  it("rejects unknown kinds", () => {
    expect(() => assertValidSupplementaryKind("token")).toThrow(/INVALID_KIND/);
  });
});

describe("supplementary — assertSupplementaryValid()", () => {
  it("accepts a positive amount with authority and no cap", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 1000n, authority: "MoF sanction 12/2026", limitMinor: 0n })).not.toThrow();
  });
  it("accepts an amount within the cap", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 1000n, authority: "auth", limitMinor: 1000n })).not.toThrow();
  });
  it("rejects non-positive amount", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 0n, authority: "auth", limitMinor: 0n })).toThrow(/INVALID_AMOUNT/);
  });
  it("rejects missing authority", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 100n, authority: "  ", limitMinor: 0n })).toThrow(/MISSING_AUTHORITY/);
  });
  it("rejects amount above the cap", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 1500n, authority: "auth", limitMinor: 1000n })).toThrow(/LIMIT_EXCEEDED/);
    try { assertSupplementaryValid({ amountMinor: 1500n, authority: "auth", limitMinor: 1000n }); }
    catch (e) { expect((e as DomainError).code).toBe("LIMIT_EXCEEDED"); }
  });
});

describe("supplementary — assertSupplementaryApproverDistinct() (maker-checker)", () => {
  it("passes for distinct officers", () => { expect(() => assertSupplementaryApproverDistinct("m", "c")).not.toThrow(); });
  it("throws for self-approval", () => { expect(() => assertSupplementaryApproverDistinct("x", "x")).toThrow(/MAKER_CHECKER_VIOLATION/); });
});

describe("supplementary — assertSupplementaryTransition()", () => {
  it("allows approve/reject from pending", () => {
    expect(() => assertSupplementaryTransition("pending_approval", "approved")).not.toThrow();
    expect(() => assertSupplementaryTransition("pending_approval", "rejected")).not.toThrow();
  });
  it("blocks re-approval of a decided demand", () => {
    expect(() => assertSupplementaryTransition("approved", "rejected")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertSupplementaryTransition("rejected", "approved")).toThrow(DomainError);
  });
});

describe("supplementary — availabilityAfterSupplementary()", () => {
  it("raises availability by exactly the supplementary amount", () => {
    // re 1000, utilised 300 → available 700; supplementary 500 → 1200
    expect(availabilityAfterSupplementary(1000n, 300n, 500n)).toBe(1200n);
  });
});
