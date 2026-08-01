import { describe, it, expect } from "vitest";
import {
  assertTransitionAllowed,
  computeMilestonePenalty,
  assertBondTransition,
  assertCanAmend,
  DomainError,
} from "../src/modules/contracts/domain.js";

describe("domain — pending_approval transitions", () => {
  it("allows draft -> pending_approval -> approved", () => {
    expect(() => assertTransitionAllowed("draft", "pending_approval")).not.toThrow();
    expect(() => assertTransitionAllowed("pending_approval", "approved")).not.toThrow();
  });

  it("rejects illegal pending_approval jumps", () => {
    expect(() => assertTransitionAllowed("pending_approval", "active")).toThrowError("INVALID_TRANSITION");
    expect(() => assertTransitionAllowed("pending_approval", "closed")).toThrowError("INVALID_TRANSITION");
  });
});

describe("domain — milestone SLA penalty (bigint paise)", () => {
  it("on-time completion yields zero penalty", () => {
    const r = computeMilestonePenalty({
      amountMinor: 1_000_000n,
      dueDate: "2026-06-01",
      achievedDate: "2026-06-01",
      penaltyRatePct: 0.5,
      maxPenaltyPct: 10,
    });
    expect(r.isLate).toBe(false);
    expect(r.status).toBe("completed");
    expect(r.penaltyMinor).toBe(0n);
    expect(r.netPayableMinor).toBe(1_000_000n);
  });

  it("two weeks late at 0.5%/week = 1% of amount (bigint, no float money)", () => {
    const r = computeMilestonePenalty({
      amountMinor: 10_000_00n, // ₹10,000.00 in paise
      dueDate: "2026-06-01",
      achievedDate: "2026-06-15", // 14 days = 2 weeks
      penaltyRatePct: 0.5,
      maxPenaltyPct: 10,
    });
    expect(r.delayDays).toBe(14);
    expect(r.delayWeeks).toBe(2);
    expect(r.status).toBe("completed_late");
    expect(r.penaltyMinor).toBe(10_000n); // 1% of 1_000_000
    expect(r.netPayableMinor).toBe(990_000n);
  });

  it("caps penalty at maxPenaltyPct", () => {
    const r = computeMilestonePenalty({
      amountMinor: 1_000_000n,
      dueDate: "2026-01-01",
      achievedDate: "2026-12-31",
      penaltyRatePct: 2,
      maxPenaltyPct: 5,
    });
    expect(r.cappedPenaltyPct).toBe(5);
    expect(r.penaltyMinor).toBe(50_000n);
    expect(r.netPayableMinor).toBe(950_000n);
  });

  it("rejects invalid date formats", () => {
    expect(() => computeMilestonePenalty({
      amountMinor: 100n, dueDate: "01-06-2026", achievedDate: "2026-06-02",
      penaltyRatePct: 1, maxPenaltyPct: 10,
    })).toThrow(DomainError);
  });
});

describe("domain — performance bond transitions", () => {
  it("held can release/claim/forfeit; terminal states are closed", () => {
    expect(() => assertBondTransition("held", "released")).not.toThrow();
    expect(() => assertBondTransition("held", "claimed")).not.toThrow();
    expect(() => assertBondTransition("held", "forfeited")).not.toThrow();
    expect(() => assertBondTransition("released", "claimed")).toThrowError("INVALID_BOND_TRANSITION");
    expect(() => assertBondTransition("forfeited", "released")).toThrowError("INVALID_BOND_TRANSITION");
  });
});

describe("domain error message interpolation", () => {
  it("includes from/to statuses in transition errors", () => {
    expect(() => assertTransitionAllowed("closed", "active")).toThrow(/from 'closed' to 'active'/);
    expect(() => assertCanAmend("draft")).toThrow(/got 'draft'/);
    expect(() => assertBondTransition("released", "held")).toThrow(/from 'released' to 'held'/);
  });
});
