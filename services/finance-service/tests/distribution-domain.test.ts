/**
 * SVC-033 — allocation distribution pure domain tests. No DB/IO.
 */
import { describe, it, expect } from "vitest";
import {
  remainingDistributable,
  assertDistributionAmountValid,
  assertDistinctOffices,
  assertWithinAllocation,
  assertDistributionTransition,
  assertAcknowledgerDistinct,
} from "../src/modules/budget/distribution-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("distribution — remainingDistributable()", () => {
  it("subtracts distributed from allocated", () => {
    expect(remainingDistributable(1000n, 600n)).toBe(400n);
    expect(remainingDistributable(1000n, 1000n)).toBe(0n);
  });
});

describe("distribution — assertDistributionAmountValid()", () => {
  it("passes for positive", () => { expect(() => assertDistributionAmountValid(1n)).not.toThrow(); });
  it("throws for zero/negative", () => {
    expect(() => assertDistributionAmountValid(0n)).toThrow(/INVALID_AMOUNT/);
    expect(() => assertDistributionAmountValid(-5n)).toThrow(DomainError);
  });
});

describe("distribution — assertDistinctOffices()", () => {
  it("passes for different offices", () => { expect(() => assertDistinctOffices("a", "b")).not.toThrow(); });
  it("throws for same office", () => { expect(() => assertDistinctOffices("a", "a")).toThrow(/INVALID_DISTRIBUTION/); });
});

describe("distribution — assertWithinAllocation()", () => {
  it("allows a distribution within remaining", () => {
    expect(() => assertWithinAllocation(1000n, 600n, 400n)).not.toThrow();
    expect(() => assertWithinAllocation(1000n, 0n, 1000n)).not.toThrow();
  });
  it("blocks over-distribution", () => {
    expect(() => assertWithinAllocation(1000n, 600n, 401n)).toThrow(/DISTRIBUTION_EXCEEDS_ALLOCATION/);
    try { assertWithinAllocation(1000n, 600n, 500n); } catch (e) {
      expect((e as DomainError).code).toBe("DISTRIBUTION_EXCEEDS_ALLOCATION");
    }
  });
});

describe("distribution — assertDistributionTransition()", () => {
  it("allows the lifecycle", () => {
    expect(() => assertDistributionTransition("draft", "issued")).not.toThrow();
    expect(() => assertDistributionTransition("issued", "acknowledged")).not.toThrow();
    expect(() => assertDistributionTransition("issued", "returned")).not.toThrow();
  });
  it("blocks illegal jumps", () => {
    expect(() => assertDistributionTransition("draft", "acknowledged")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertDistributionTransition("acknowledged", "issued")).toThrow(DomainError);
  });
});

describe("distribution — assertAcknowledgerDistinct() (maker-checker)", () => {
  it("passes for distinct officers", () => { expect(() => assertAcknowledgerDistinct("issuer", "receiver")).not.toThrow(); });
  it("throws for self-acknowledgement", () => { expect(() => assertAcknowledgerDistinct("x", "x")).toThrow(/MAKER_CHECKER_VIOLATION/); });
});
