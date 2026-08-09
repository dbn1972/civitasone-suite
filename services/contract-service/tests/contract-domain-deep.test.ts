/**
 * Contract Service — Domain Logic: Deep tests.
 *
 * Tests contract lifecycle, maker-checker SOD, amendment guard, milestone
 * SLA penalty computation (exact bigint paise), bond transitions, and renewals.
 *
 * Source: modules/contracts/domain.ts, modules/renewals/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  assertTransitionAllowed, assertDistinctMakerChecker, assertCanAmend,
  computeMilestonePenalty, assertBondTransition, DomainError, type ContractStatus,
} from "../src/modules/contracts/domain.js";
import {
  computeRenewalNotices, isWithinNoticeWindow,
  MIN_ADVANCE_NOTICE_DAYS, MAX_ADVANCE_NOTICE_DAYS, RENEWAL_STATUSES,
} from "../src/modules/renewals/domain.js";

// ═══ Contract Lifecycle ═══

describe("assertTransitionAllowed — contract state machine", () => {
  const valid: [string, ContractStatus][] = [
    ["draft", "pending_approval"], ["draft", "approved"], ["draft", "terminated"],
    ["pending_approval", "approved"], ["pending_approval", "terminated"], ["pending_approval", "draft"],
    ["approved", "active"], ["approved", "terminated"],
    ["active", "closed"], ["active", "terminated"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(() => assertTransitionAllowed(from, to)).not.toThrow());
  }

  const invalid: [string, ContractStatus][] = [
    ["draft", "active"], ["draft", "closed"],
    ["pending_approval", "active"], ["pending_approval", "closed"],
    ["approved", "draft"], ["approved", "closed"],
    ["active", "draft"], ["active", "approved"],
    ["closed", "active"], ["closed", "draft"], ["closed", "terminated"],
    ["terminated", "active"], ["terminated", "draft"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => expect(() => assertTransitionAllowed(from, to)).toThrow("INVALID_TRANSITION"));
  }

  it("closed is terminal", () => {
    for (const target of ["draft", "active", "terminated"] as ContractStatus[]) {
      expect(() => assertTransitionAllowed("closed", target)).toThrow(DomainError);
    }
  });

  it("terminated is terminal", () => {
    for (const target of ["draft", "active", "closed"] as ContractStatus[]) {
      expect(() => assertTransitionAllowed("terminated", target)).toThrow(DomainError);
    }
  });
});

// ═══ Segregation of Duties ═══

describe("assertDistinctMakerChecker", () => {
  it("passes when different", () => expect(() => assertDistinctMakerChecker("A", "B")).not.toThrow());
  it("throws SOD_VIOLATION on self-approval", () => expect(() => assertDistinctMakerChecker("A", "A")).toThrow("SOD_VIOLATION"));
  it("passes when either is empty", () => {
    expect(() => assertDistinctMakerChecker("", "B")).not.toThrow();
    expect(() => assertDistinctMakerChecker("A", "")).not.toThrow();
  });
});

// ═══ Amendment Guard ═══

describe("assertCanAmend", () => {
  it("passes for active contracts", () => expect(() => assertCanAmend("active")).not.toThrow());
  it("throws for draft", () => expect(() => assertCanAmend("draft")).toThrow("INVALID_STATUS"));
  it("throws for closed", () => expect(() => assertCanAmend("closed")).toThrow("INVALID_STATUS"));
  it("throws for terminated", () => expect(() => assertCanAmend("terminated")).toThrow(DomainError));
});

// ═══ Milestone SLA Penalty (bigint paise) ═══

describe("computeMilestonePenalty — exact money arithmetic", () => {
  it("no penalty when on time", () => {
    const result = computeMilestonePenalty({
      amountMinor: 1000000n, dueDate: "2026-08-15", achievedDate: "2026-08-15",
      penaltyRatePct: 1, maxPenaltyPct: 10,
    });
    expect(result.isLate).toBe(false);
    expect(result.penaltyMinor).toBe(0n);
    expect(result.netPayableMinor).toBe(1000000n);
    expect(result.status).toBe("completed");
  });

  it("penalty for 1 week delay at 1%/week", () => {
    const result = computeMilestonePenalty({
      amountMinor: 1000000n, dueDate: "2026-08-01", achievedDate: "2026-08-08",
      penaltyRatePct: 1, maxPenaltyPct: 10,
    });
    expect(result.isLate).toBe(true);
    expect(result.delayDays).toBe(7);
    expect(result.delayWeeks).toBe(1);
    // 1% of 1000000 = 10000, 1 week × 100bp = 100bp → 1000000 * 100 / 10000 = 10000
    expect(result.penaltyMinor).toBe(10000n);
    expect(result.netPayableMinor).toBe(990000n);
    expect(result.status).toBe("completed_late");
  });

  it("caps penalty at maxPenaltyPct", () => {
    const result = computeMilestonePenalty({
      amountMinor: 1000000n, dueDate: "2026-08-01", achievedDate: "2026-12-01",
      penaltyRatePct: 5, maxPenaltyPct: 10, // many weeks × 5% but capped at 10%
    });
    expect(result.cappedPenaltyPct).toBe(10);
    // 10% of 1000000 = 100000
    expect(result.penaltyMinor).toBe(100000n);
    expect(result.netPayableMinor).toBe(900000n);
  });

  it("partial week counts as full week", () => {
    const result = computeMilestonePenalty({
      amountMinor: 500000n, dueDate: "2026-08-01", achievedDate: "2026-08-03",
      penaltyRatePct: 2, maxPenaltyPct: 20,
    });
    expect(result.delayDays).toBe(2);
    expect(result.delayWeeks).toBe(1); // ceil(2/7) = 1
  });

  it("throws INVALID_AMOUNT for negative amount", () => {
    expect(() => computeMilestonePenalty({
      amountMinor: -100n, dueDate: "2026-08-01", achievedDate: "2026-08-01",
      penaltyRatePct: 1, maxPenaltyPct: 10,
    })).toThrow("INVALID_AMOUNT");
  });

  it("throws INVALID_DATE for malformed date", () => {
    expect(() => computeMilestonePenalty({
      amountMinor: 100n, dueDate: "bad", achievedDate: "2026-08-01",
      penaltyRatePct: 1, maxPenaltyPct: 10,
    })).toThrow("INVALID_DATE");
  });
});

// ═══ Bond Transitions ═══

describe("assertBondTransition", () => {
  it("held → released", () => expect(() => assertBondTransition("held", "released")).not.toThrow());
  it("held → claimed", () => expect(() => assertBondTransition("held", "claimed")).not.toThrow());
  it("held → forfeited", () => expect(() => assertBondTransition("held", "forfeited")).not.toThrow());
  it("released is terminal", () => expect(() => assertBondTransition("released", "held")).toThrow("INVALID_BOND_TRANSITION"));
  it("claimed is terminal", () => expect(() => assertBondTransition("claimed", "held")).toThrow(DomainError));
  it("forfeited is terminal", () => expect(() => assertBondTransition("forfeited", "held")).toThrow(DomainError));
});

// ═══ Renewals ═══

describe("computeRenewalNotices", () => {
  it("computes advance notice 30 days before expiry", () => {
    const result = computeRenewalNotices("2026-09-30", 30);
    expect(result.advanceNoticeDate).toBe("2026-08-31");
    expect(result.finalReminderDate).toBe("2026-09-23"); // always 7d before
  });

  it("clamps below MIN_ADVANCE_NOTICE_DAYS (7)", () => {
    const result = computeRenewalNotices("2026-09-30", 3);
    expect(MIN_ADVANCE_NOTICE_DAYS).toBe(7);
    // Clamped to 7, so advance = Sep 30 - 7 = Sep 23
    expect(result.advanceNoticeDate).toBe("2026-09-23");
  });

  it("clamps above MAX_ADVANCE_NOTICE_DAYS (180)", () => {
    expect(MAX_ADVANCE_NOTICE_DAYS).toBe(180);
    const result = computeRenewalNotices("2026-09-30", 999);
    // Clamped to 180
    expect(result.advanceNoticeDate).toBe("2026-04-03"); // Sep 30 - 180
  });
});

describe("isWithinNoticeWindow", () => {
  it("true when within window", () => {
    expect(isWithinNoticeWindow("2026-09-30", 30, "2026-09-15")).toBe(true);
  });
  it("false when before window", () => {
    expect(isWithinNoticeWindow("2026-09-30", 30, "2026-08-01")).toBe(false);
  });
  it("true at exact window start", () => {
    expect(isWithinNoticeWindow("2026-09-30", 30, "2026-08-31")).toBe(true);
  });
  it("true at expiry date", () => {
    expect(isWithinNoticeWindow("2026-09-30", 30, "2026-09-30")).toBe(true);
  });
  it("false after expiry", () => {
    expect(isWithinNoticeWindow("2026-09-30", 30, "2026-10-01")).toBe(false);
  });
});

describe("RENEWAL_STATUSES", () => {
  it("has 4 statuses", () => expect(RENEWAL_STATUSES).toHaveLength(4));
  it("contains active, renewed, expired, cancelled", () => {
    expect([...RENEWAL_STATUSES]).toEqual(["active", "renewed", "expired", "cancelled"]);
  });
});
