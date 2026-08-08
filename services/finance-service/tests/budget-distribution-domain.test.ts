/**
 * Budget Distribution Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/budget/distribution-domain.ts
 * Covers: remaining distributable, over-distribution guard, office distinctness,
 * state machine transitions, maker-checker on acknowledgement.
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

describe("remainingDistributable", () => {
  it("returns allocated minus already distributed", () => {
    expect(remainingDistributable(1_000_000n, 400_000n)).toBe(600_000n);
  });

  it("returns zero when fully distributed", () => {
    expect(remainingDistributable(500n, 500n)).toBe(0n);
  });

  it("returns negative when over-distributed", () => {
    expect(remainingDistributable(100n, 200n)).toBe(-100n);
  });
});

describe("assertDistributionAmountValid", () => {
  it("passes for positive amount", () => {
    expect(() => assertDistributionAmountValid(1n)).not.toThrow();
  });

  it("throws INVALID_AMOUNT for zero", () => {
    expect(() => assertDistributionAmountValid(0n)).toThrow(DomainError);
    try { assertDistributionAmountValid(0n); } catch (e) { expect((e as DomainError).code).toBe("INVALID_AMOUNT"); }
  });

  it("throws INVALID_AMOUNT for negative", () => {
    expect(() => assertDistributionAmountValid(-100n)).toThrow(DomainError);
  });
});

describe("assertDistinctOffices", () => {
  it("passes for different offices", () => {
    expect(() => assertDistinctOffices("office-A", "office-B")).not.toThrow();
  });

  it("throws INVALID_DISTRIBUTION for same office", () => {
    expect(() => assertDistinctOffices("office-A", "office-A")).toThrow(DomainError);
    try { assertDistinctOffices("x", "x"); } catch (e) { expect((e as DomainError).code).toBe("INVALID_DISTRIBUTION"); }
  });
});

describe("assertWithinAllocation", () => {
  it("passes when requesting exactly the remaining amount", () => {
    expect(() => assertWithinAllocation(1_000_000n, 600_000n, 400_000n)).not.toThrow();
  });

  it("throws DISTRIBUTION_EXCEEDS_ALLOCATION for 1 paise over", () => {
    expect(() => assertWithinAllocation(1_000_000n, 600_000n, 400_001n)).toThrow(DomainError);
    try { assertWithinAllocation(1_000_000n, 600_000n, 400_001n); } catch (e) {
      expect((e as DomainError).code).toBe("DISTRIBUTION_EXCEEDS_ALLOCATION");
    }
  });

  it("passes for zero request", () => {
    expect(() => assertWithinAllocation(1_000_000n, 999_999n, 0n)).not.toThrow();
  });
});

describe("assertDistributionTransition (state machine)", () => {
  it("draft → issued", () => { expect(() => assertDistributionTransition("draft", "issued")).not.toThrow(); });
  it("issued → acknowledged", () => { expect(() => assertDistributionTransition("issued", "acknowledged")).not.toThrow(); });
  it("issued → returned", () => { expect(() => assertDistributionTransition("issued", "returned")).not.toThrow(); });

  it("draft → acknowledged (skip) → INVALID_TRANSITION", () => {
    expect(() => assertDistributionTransition("draft", "acknowledged")).toThrow(DomainError);
  });

  it("acknowledged is terminal → cannot transition", () => {
    expect(() => assertDistributionTransition("acknowledged", "draft")).toThrow(DomainError);
    expect(() => assertDistributionTransition("acknowledged", "issued")).toThrow(DomainError);
  });

  it("returned is terminal", () => {
    expect(() => assertDistributionTransition("returned", "draft")).toThrow(DomainError);
  });
});

describe("assertAcknowledgerDistinct (maker-checker)", () => {
  it("passes for different officers", () => {
    expect(() => assertAcknowledgerDistinct("officer-A", "officer-B")).not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION for same officer", () => {
    expect(() => assertAcknowledgerDistinct("officer-A", "officer-A")).toThrow(DomainError);
    try { assertAcknowledgerDistinct("x", "x"); } catch (e) { expect((e as DomainError).code).toBe("MAKER_CHECKER_VIOLATION"); }
  });
});
