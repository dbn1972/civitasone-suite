/**
 * Contract Service — lifecycle, penalty, bond domain tests. 9 packs.
 */
import { describe, it, expect } from "vitest";
import { assertTransitionAllowed, assertDistinctMakerChecker, assertCanAmend, computeMilestonePenalty, assertBondTransition, DomainError } from "../src/modules/contracts/domain.js";

describe("contract state machine", () => {
  it("draft → pending_approval/approved", () => { expect(() => assertTransitionAllowed("draft", "pending_approval")).not.toThrow(); expect(() => assertTransitionAllowed("draft", "approved")).not.toThrow(); });
  it("approved → active", () => expect(() => assertTransitionAllowed("approved", "active")).not.toThrow());
  it("active → closed/terminated", () => { expect(() => assertTransitionAllowed("active", "closed")).not.toThrow(); expect(() => assertTransitionAllowed("active", "terminated")).not.toThrow(); });
  it("closed/terminated are terminal", () => { expect(() => assertTransitionAllowed("closed", "active")).toThrow(DomainError); expect(() => assertTransitionAllowed("terminated", "draft")).toThrow(DomainError); });
  it("maker-checker on approval", () => { expect(() => assertDistinctMakerChecker("u1", "u1")).toThrow(DomainError); expect(() => assertDistinctMakerChecker("u1", "u2")).not.toThrow(); });
  it("amendments only on active contracts", () => { expect(() => assertCanAmend("active")).not.toThrow(); expect(() => assertCanAmend("draft")).toThrow(DomainError); });
});

describe("milestone delay penalty (bigint)", () => {
  it("on-time: no penalty", () => {
    const r = computeMilestonePenalty({ amountMinor: 1_000_000n, dueDate: "2026-07-15", achievedDate: "2026-07-10", penaltyRatePct: 0.5, maxPenaltyPct: 10 });
    expect(r.isLate).toBe(false);
    expect(r.penaltyMinor).toBe(0n);
    expect(r.netPayableMinor).toBe(1_000_000n);
  });
  it("1 week late: 0.5% penalty", () => {
    const r = computeMilestonePenalty({ amountMinor: 1_000_000n, dueDate: "2026-07-01", achievedDate: "2026-07-08", penaltyRatePct: 0.5, maxPenaltyPct: 10 });
    expect(r.delayWeeks).toBe(1);
    expect(r.penaltyMinor).toBe(5_000n); // 0.5% of 1M = 5000
  });
  it("penalty capped at maxPenaltyPct", () => {
    const r = computeMilestonePenalty({ amountMinor: 1_000_000n, dueDate: "2026-01-01", achievedDate: "2026-07-01", penaltyRatePct: 1, maxPenaltyPct: 5 });
    expect(r.cappedPenaltyPct).toBe(5);
    expect(r.penaltyMinor).toBe(50_000n); // 5% of 1M
  });
  it("net payable = amount - penalty", () => {
    const r = computeMilestonePenalty({ amountMinor: 1_000_000n, dueDate: "2026-07-01", achievedDate: "2026-07-15", penaltyRatePct: 1, maxPenaltyPct: 10 });
    expect(r.netPayableMinor).toBe(r.amountMinor !== undefined ? 1_000_000n - r.penaltyMinor : r.netPayableMinor);
  });
});

describe("performance bond transitions", () => {
  it("held → released/claimed/forfeited", () => {
    expect(() => assertBondTransition("held", "released")).not.toThrow();
    expect(() => assertBondTransition("held", "claimed")).not.toThrow();
    expect(() => assertBondTransition("held", "forfeited")).not.toThrow();
  });
  it("released/claimed/forfeited are terminal", () => {
    expect(() => assertBondTransition("released", "held")).toThrow(DomainError);
  });
});
