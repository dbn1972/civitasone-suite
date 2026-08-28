/** Pure-domain tests for the certified-copy state machine, id derivation, and fee math (§30). */
import { describe, it, expect } from "vitest";
import {
  canTransition, assertTransition, isTerminal, deriveCopyId, computeCopyFeeMinor,
  assertReceiptMatchesFee, parseReceiptMinor,
} from "../src/modules/certified-copy/domain.js";

describe("certified-copy domain — state machine", () => {
  it("a requested copy can move to fee_paid or rejected", () => {
    expect(canTransition("requested", "fee_paid")).toBe(true);
    expect(canTransition("requested", "rejected")).toBe(true);
  });

  it("fee_paid → prepared → issued is the happy path", () => {
    expect(canTransition("fee_paid", "prepared")).toBe(true);
    expect(canTransition("prepared", "issued")).toBe(true);
  });

  it("every pre-terminal state can be rejected", () => {
    expect(canTransition("fee_paid", "rejected")).toBe(true);
    expect(canTransition("prepared", "rejected")).toBe(true);
  });

  it("rejects illegal edges (skipping states / from terminal)", () => {
    expect(canTransition("requested", "issued")).toBe(false);
    expect(canTransition("requested", "prepared")).toBe(false);
    expect(canTransition("issued", "prepared")).toBe(false);
    expect(canTransition("rejected", "fee_paid")).toBe(false);
    expect(() => assertTransition("requested", "issued")).toThrow(/INVALID_COPY_TRANSITION/);
  });

  it("issued and rejected are terminal", () => {
    expect(isTerminal("issued")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("requested")).toBe(false);
    expect(isTerminal("fee_paid")).toBe(false);
    expect(isTerminal("prepared")).toBe(false);
  });
});

describe("certified-copy domain — id derivation", () => {
  it("deriveCopyId is deterministic per (tenant, case, requester, ref)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    const u = "33333333-3333-3333-3333-333333333333";
    expect(deriveCopyId(t, c, u, "doc-1")).toBe(deriveCopyId(t, c, u, "doc-1"));
    expect(deriveCopyId(t, c, u, "doc-1")).not.toBe(deriveCopyId(t, c, u, "doc-2"));
  });
});

describe("certified-copy domain — computeCopyFeeMinor", () => {
  it("multiplies per-copy fee by the number of copies (BigInt paise)", () => {
    expect(computeCopyFeeMinor(500n, 3, false, 0n)).toBe(1500n);
  });

  it("adds the flat urgent surcharge only when urgent", () => {
    expect(computeCopyFeeMinor(500n, 2, true, 250n)).toBe(1250n);
    expect(computeCopyFeeMinor(500n, 2, false, 250n)).toBe(1000n);
  });

  it("handles a single copy with no surcharge", () => {
    expect(computeCopyFeeMinor(500n, 1, false, 0n)).toBe(500n);
  });
});

describe("certified-copy domain — assertReceiptMatchesFee (§30 payment proof)", () => {
  it("does not throw when the receipted amount equals the fee", () => {
    expect(() => assertReceiptMatchesFee(1500n, 1500n)).not.toThrow();
  });

  it("throws RECEIPT_AMOUNT_MISMATCH when the receipt is short", () => {
    expect(() => assertReceiptMatchesFee(1500n, 1000n)).toThrow(/RECEIPT_AMOUNT_MISMATCH/);
  });

  it("throws RECEIPT_AMOUNT_MISMATCH when the receipt overshoots the fee", () => {
    expect(() => assertReceiptMatchesFee(1500n, 2000n)).toThrow(/RECEIPT_AMOUNT_MISMATCH/);
  });

  it("treats zero fee and zero receipt as a match (no false positive)", () => {
    expect(() => assertReceiptMatchesFee(0n, 0n)).not.toThrow();
  });
});

describe("certified-copy domain — parseReceiptMinor (shared by commands.ts and consumer.ts)", () => {
  it("parses a non-negative integer number", () => {
    expect(parseReceiptMinor(1500)).toBe(1500n);
    expect(parseReceiptMinor(0)).toBe(0n);
  });

  it("parses a numeric string, trimming surrounding whitespace", () => {
    expect(parseReceiptMinor("1500")).toBe(1500n);
    expect(parseReceiptMinor(" 1500 ")).toBe(1500n);
  });

  it("throws INVALID_RECEIPT_AMOUNT for a negative number", () => {
    expect(() => parseReceiptMinor(-5)).toThrow(/INVALID_RECEIPT_AMOUNT/);
  });

  it("throws INVALID_RECEIPT_AMOUNT for a non-integer number", () => {
    expect(() => parseReceiptMinor(15.5)).toThrow(/INVALID_RECEIPT_AMOUNT/);
  });

  it("throws INVALID_RECEIPT_AMOUNT for a non-numeric string", () => {
    expect(() => parseReceiptMinor("abc")).toThrow(/INVALID_RECEIPT_AMOUNT/);
  });

  it("throws INVALID_RECEIPT_AMOUNT when undefined", () => {
    expect(() => parseReceiptMinor(undefined)).toThrow(/INVALID_RECEIPT_AMOUNT/);
  });
});
