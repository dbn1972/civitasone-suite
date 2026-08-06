/**
 * G15 — MoU milestone governance: pure domain logic.
 *
 * Covers every state transition (legal and illegal), the waiver rules, the
 * review cadence arithmetic, and money arithmetic above 2^53 to prove the
 * bigint path never degrades to an IEEE-754 double.
 */
import { describe, it, expect } from "vitest";
import {
  MILESTONE_STATUSES,
  MilestoneDomainError,
  REVIEW_CADENCES,
  assertReviewTransition,
  assertTermRepresentation,
  assertTransition,
  assertWaiverAllowed,
  canTransition,
  computePenalty,
  daysOverdue,
  isDueWithin,
  isMilestoneStatus,
  isMissed,
  isReviewCadence,
  isReviewDue,
  nextReviewDate,
  occurrenceKey,
  parseDateOnly,
  type MilestoneStatus,
  type PenaltyTermSpec,
} from "../src/modules/milestones/domain.js";

// ══ State machine ══════════════════════════════════════════════════════════

describe("milestone state machine — exhaustive transition matrix", () => {
  const LEGAL: ReadonlyArray<[MilestoneStatus, MilestoneStatus]> = [
    ["pending", "met"],
    ["pending", "missed"],
    ["missed", "met"],
    ["missed", "waived"],
  ];

  it("every (from,to) pair matches the declared legal set", () => {
    for (const from of MILESTONE_STATUSES) {
      for (const to of MILESTONE_STATUSES) {
        const expected = LEGAL.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("allows every legal transition without throwing", () => {
    for (const [from, to] of LEGAL) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it("rejects self-transitions", () => {
    for (const s of MILESTONE_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("treats met and waived as terminal", () => {
    for (const to of MILESTONE_STATUSES) {
      expect(canTransition("met", to)).toBe(false);
      expect(canTransition("waived", to)).toBe(false);
    }
  });

  it("rejects illegal transitions with INVALID_TRANSITION and both statuses named", () => {
    expect(() => assertTransition("pending", "waived")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertTransition("pending", "waived")).toThrow(/from 'pending' to 'waived'/);
    expect(() => assertTransition("met", "missed")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertTransition("waived", "met")).toThrow(/INVALID_TRANSITION/);
  });

  it("rejects unknown statuses on either side", () => {
    expect(() => assertTransition("bogus", "met")).toThrow(/UNKNOWN_STATUS/);
    expect(() => assertTransition("pending", "bogus")).toThrow(/UNKNOWN_STATUS/);
    expect(canTransition("bogus", "met")).toBe(false);
    expect(canTransition("pending", "bogus")).toBe(false);
    expect(isMilestoneStatus("pending")).toBe(true);
    expect(isMilestoneStatus("completed")).toBe(false);
  });

  it("throws MilestoneDomainError instances carrying a code", () => {
    try {
      assertTransition("met", "pending");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MilestoneDomainError);
      expect((err as MilestoneDomainError).code).toBe("INVALID_TRANSITION");
      expect((err as MilestoneDomainError).name).toBe("MilestoneDomainError");
    }
  });
});

describe("waiver rules — who and why are mandatory", () => {
  const WHO = "11111111-2222-4000-8000-000000000001";

  it("accepts a missed milestone waived with an actor and a reason", () => {
    expect(() => assertWaiverAllowed("missed", { waivedBy: WHO, reason: "force majeure — flood" })).not.toThrow();
  });

  it("refuses to waive a milestone that was never missed", () => {
    expect(() => assertWaiverAllowed("pending", { waivedBy: WHO, reason: "why not" })).toThrow(/INVALID_TRANSITION/);
    expect(() => assertWaiverAllowed("met", { waivedBy: WHO, reason: "why not" })).toThrow(/INVALID_TRANSITION/);
    expect(() => assertWaiverAllowed("waived", { waivedBy: WHO, reason: "again" })).toThrow(/INVALID_TRANSITION/);
  });

  it("requires a waiving actor", () => {
    expect(() => assertWaiverAllowed("missed", { waivedBy: "", reason: "flood" })).toThrow(/WAIVER_ACTOR_REQUIRED/);
    expect(() => assertWaiverAllowed("missed", { waivedBy: "   ", reason: "flood" })).toThrow(/WAIVER_ACTOR_REQUIRED/);
  });

  it("requires a non-blank reason", () => {
    expect(() => assertWaiverAllowed("missed", { waivedBy: WHO, reason: "" })).toThrow(/WAIVER_REASON_REQUIRED/);
    expect(() => assertWaiverAllowed("missed", { waivedBy: WHO, reason: "\t \n" })).toThrow(/WAIVER_REASON_REQUIRED/);
  });
});

// ══ Dates ══════════════════════════════════════════════════════════════════

describe("date helpers", () => {
  it("parses YYYY-MM-DD as UTC midnight", () => {
    expect(parseDateOnly("2026-06-01").toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("rejects the wrong format and impossible calendar dates", () => {
    expect(() => parseDateOnly("01-06-2026")).toThrow(/INVALID_DATE/);
    expect(() => parseDateOnly("2026-6-1")).toThrow(/INVALID_DATE/);
    expect(() => parseDateOnly("")).toThrow(/INVALID_DATE/);
    expect(() => parseDateOnly("2026-13-01")).toThrow(/INVALID_DATE/);
  });

  it("counts whole days overdue and floors at zero", () => {
    expect(daysOverdue("2026-06-01", "2026-06-01")).toBe(0);
    expect(daysOverdue("2026-06-01", "2026-05-20")).toBe(0);
    expect(daysOverdue("2026-06-01", "2026-06-16")).toBe(15);
    // Leap year, spanning February.
    expect(daysOverdue("2028-02-27", "2028-03-01")).toBe(3);
  });

  it("applies a grace threshold before declaring a milestone missed", () => {
    expect(isMissed("2026-06-01", "2026-06-01")).toBe(false);
    expect(isMissed("2026-06-01", "2026-06-02")).toBe(true);
    expect(isMissed("2026-06-01", "2026-06-08", 7)).toBe(false);
    expect(isMissed("2026-06-01", "2026-06-09", 7)).toBe(true);
  });

  it("rejects a nonsensical grace threshold", () => {
    expect(() => isMissed("2026-06-01", "2026-06-09", -1)).toThrow(/INVALID_THRESHOLD/);
    expect(() => isMissed("2026-06-01", "2026-06-09", 1.5)).toThrow(/INVALID_THRESHOLD/);
  });

  it("detects milestones falling due inside a look-ahead window", () => {
    expect(isDueWithin("2026-06-10", "2026-06-01", 14)).toBe(true);
    expect(isDueWithin("2026-06-16", "2026-06-01", 14)).toBe(false);
    // Already overdue counts as due.
    expect(isDueWithin("2026-05-01", "2026-06-01", 0)).toBe(true);
    expect(() => isDueWithin("2026-06-10", "2026-06-01", -3)).toThrow(/INVALID_WINDOW/);
  });
});

// ══ Money — bigint precision ═══════════════════════════════════════════════

const pct = (bps: number, cap = 10_000): PenaltyTermSpec => ({
  penaltyKind: "percentage",
  penaltyRateBps: bps,
  maxPenaltyBps: cap,
  thresholdValue: 0,
});

describe("penalty computation — percentage in basis points", () => {
  it("charges 0.5% (50 bp) exactly", () => {
    const r = computePenalty({ term: pct(50), milestoneAmountMinor: 1_000_000n, overdueDays: 3 });
    expect(r.penaltyMinor).toBe(5_000n);
    expect(r.netPayableMinor).toBe(995_000n);
    expect(r.capped).toBe(false);
  });

  it("charges nothing at 0 bp", () => {
    const r = computePenalty({ term: pct(0), milestoneAmountMinor: 1_000_000n, overdueDays: 90 });
    expect(r.penaltyMinor).toBe(0n);
    expect(r.netPayableMinor).toBe(1_000_000n);
  });

  it("charges the whole amount at 10000 bp and floors net payable at zero", () => {
    const r = computePenalty({ term: pct(10_000), milestoneAmountMinor: 777n, overdueDays: 1 });
    expect(r.penaltyMinor).toBe(777n);
    expect(r.netPayableMinor).toBe(0n);
  });

  it("truncates toward zero rather than rounding up (payer's favour)", () => {
    // 1 paisa at 50 bp = 0.005 paise → 0, not 1.
    const r = computePenalty({ term: pct(50), milestoneAmountMinor: 1n, overdueDays: 1 });
    expect(r.penaltyMinor).toBe(0n);
  });
});

describe("penalty computation — bigint precision above 2^53", () => {
  const TWO_53 = 9_007_199_254_740_992n; // 2^53

  it("computes exactly at an amount above 2^53 where a double would round", () => {
    const amount = TWO_53 + 1n; // 9007199254740993 — not representable as a double
    // Sanity: the naive Number path DOES lose this value.
    expect(BigInt(Number(amount))).toBe(TWO_53);

    const r = computePenalty({ term: pct(10_000), milestoneAmountMinor: amount, overdueDays: 1 });
    expect(r.penaltyMinor).toBe(amount);
    expect(r.penaltyMinor).not.toBe(TWO_53);
    expect(r.netPayableMinor).toBe(0n);
  });

  it("keeps a 1-paisa difference at 1 bp on a >2^53 amount", () => {
    const a = 10_000_000_000_000_000n; // 1e16 paise = ₹1e14
    const b = a + 10_000n;
    const ra = computePenalty({ term: pct(1), milestoneAmountMinor: a, overdueDays: 1 });
    const rb = computePenalty({ term: pct(1), milestoneAmountMinor: b, overdueDays: 1 });
    expect(ra.penaltyMinor).toBe(1_000_000_000_000n);
    expect(rb.penaltyMinor).toBe(1_000_000_000_001n);
    expect(rb.penaltyMinor - ra.penaltyMinor).toBe(1n);
  });

  it("net payable is exact on a >2^53 amount", () => {
    const amount = 9_007_199_254_740_993n;
    const r = computePenalty({ term: pct(1), milestoneAmountMinor: amount, overdueDays: 1 });
    // 1 bp of 9007199254740993 = 900719925474.0993 → truncated to 900719925474
    expect(r.penaltyMinor).toBe(900_719_925_474n);
    expect(r.netPayableMinor).toBe(amount - 900_719_925_474n);
    expect(r.penaltyMinor + r.netPayableMinor).toBe(amount);
  });

  it("per_day accumulation stays exact across a huge day count", () => {
    const perDay = 9_007_199_254_740_993n;
    const r = computePenalty({
      term: { penaltyKind: "per_day", penaltyAmountMinor: perDay, maxPenaltyBps: 10_000, thresholdValue: 0 },
      milestoneAmountMinor: 10n ** 24n,
      overdueDays: 1000,
    });
    expect(r.uncappedMinor).toBe(perDay * 1000n);
    expect(r.uncappedMinor).toBe(9_007_199_254_740_993_000n);
  });
});

describe("penalty computation — fixed and per_day kinds", () => {
  it("fixed ignores overdue days", () => {
    const term: PenaltyTermSpec = {
      penaltyKind: "fixed",
      penaltyAmountMinor: 250_000n,
      maxPenaltyBps: 10_000,
      thresholdValue: 0,
    };
    const a = computePenalty({ term, milestoneAmountMinor: 10_000_000n, overdueDays: 1 });
    const b = computePenalty({ term, milestoneAmountMinor: 10_000_000n, overdueDays: 400 });
    expect(a.penaltyMinor).toBe(250_000n);
    expect(b.penaltyMinor).toBe(250_000n);
  });

  it("per_day multiplies by chargeable days after the grace threshold", () => {
    const term: PenaltyTermSpec = {
      penaltyKind: "per_day",
      penaltyAmountMinor: 10_000n,
      maxPenaltyBps: 10_000,
      thresholdValue: 5,
    };
    const r = computePenalty({ term, milestoneAmountMinor: 100_000_000n, overdueDays: 12 });
    expect(r.chargeableDays).toBe(7);
    expect(r.penaltyMinor).toBe(70_000n);
  });

  it("per_day inside the grace period charges nothing", () => {
    const term: PenaltyTermSpec = {
      penaltyKind: "per_day",
      penaltyAmountMinor: 10_000n,
      maxPenaltyBps: 10_000,
      thresholdValue: 30,
    };
    const r = computePenalty({ term, milestoneAmountMinor: 1_000_000n, overdueDays: 30 });
    expect(r.chargeableDays).toBe(0);
    expect(r.penaltyMinor).toBe(0n);
  });
});

describe("penalty computation — cap", () => {
  it("caps a runaway per_day penalty at maxPenaltyBps of the milestone amount", () => {
    const term: PenaltyTermSpec = {
      penaltyKind: "per_day",
      penaltyAmountMinor: 100_000n,
      maxPenaltyBps: 500, // 5%
      thresholdValue: 0,
    };
    const r = computePenalty({ term, milestoneAmountMinor: 10_000_000n, overdueDays: 100 });
    expect(r.uncappedMinor).toBe(10_000_000n);
    expect(r.capMinor).toBe(500_000n);
    expect(r.capped).toBe(true);
    expect(r.penaltyMinor).toBe(500_000n);
    expect(r.netPayableMinor).toBe(9_500_000n);
  });

  it("a zero cap means no penalty is ever charged", () => {
    const r = computePenalty({ term: pct(1_000, 0), milestoneAmountMinor: 5_000_000n, overdueDays: 10 });
    expect(r.capped).toBe(true);
    expect(r.penaltyMinor).toBe(0n);
    expect(r.netPayableMinor).toBe(5_000_000n);
  });

  it("does not report capped when the raw penalty equals the cap", () => {
    const r = computePenalty({ term: pct(500, 500), milestoneAmountMinor: 1_000_000n, overdueDays: 1 });
    expect(r.capped).toBe(false);
    expect(r.penaltyMinor).toBe(50_000n);
  });
});

describe("penalty computation — input validation", () => {
  it("rejects a negative milestone amount", () => {
    expect(() => computePenalty({ term: pct(50), milestoneAmountMinor: -1n, overdueDays: 0 })).toThrow(/INVALID_AMOUNT/);
  });

  it("rejects non-integer or negative overdue days", () => {
    expect(() => computePenalty({ term: pct(50), milestoneAmountMinor: 1n, overdueDays: -1 })).toThrow(/INVALID_OVERDUE/);
    expect(() => computePenalty({ term: pct(50), milestoneAmountMinor: 1n, overdueDays: 2.5 })).toThrow(/INVALID_OVERDUE/);
  });

  it("rejects an out-of-range cap", () => {
    expect(() => computePenalty({ term: pct(50, -1), milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(/INVALID_CAP/);
    expect(() => computePenalty({ term: pct(50, 10_001), milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(/INVALID_CAP/);
    expect(() => computePenalty({ term: pct(50, 1.5), milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(/INVALID_CAP/);
  });

  it("rejects a bad grace threshold", () => {
    const term: PenaltyTermSpec = { ...pct(50), thresholdValue: -2 };
    expect(() => computePenalty({ term, milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(/INVALID_THRESHOLD/);
  });

  it("rejects a percentage term with no rate", () => {
    const term = { penaltyKind: "percentage", maxPenaltyBps: 10_000, thresholdValue: 0 } as PenaltyTermSpec;
    expect(() => computePenalty({ term, milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(/MISSING_PENALTY_RATE/);
  });

  it("rejects a percentage term with an out-of-range rate", () => {
    expect(() => computePenalty({ term: pct(10_001), milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(
      /INVALID_PENALTY_RATE/,
    );
    expect(() => computePenalty({ term: pct(-5), milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(
      /INVALID_PENALTY_RATE/,
    );
  });

  it("rejects a fixed/per_day term with no amount or a negative amount", () => {
    const noAmount = { penaltyKind: "fixed", maxPenaltyBps: 10_000, thresholdValue: 0 } as PenaltyTermSpec;
    expect(() => computePenalty({ term: noAmount, milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(
      /MISSING_PENALTY_AMOUNT/,
    );
    const negative: PenaltyTermSpec = {
      penaltyKind: "per_day",
      penaltyAmountMinor: -1n,
      maxPenaltyBps: 10_000,
      thresholdValue: 0,
    };
    expect(() => computePenalty({ term: negative, milestoneAmountMinor: 1n, overdueDays: 1 })).toThrow(
      /INVALID_PENALTY_AMOUNT/,
    );
  });

  it("rejects an unknown penalty kind coming out of the database", () => {
    const term = { penaltyKind: "sliding_scale", maxPenaltyBps: 10_000, thresholdValue: 0 } as unknown as PenaltyTermSpec;
    expect(() => computePenalty({ term, milestoneAmountMinor: 1n, overdueDays: 0 })).toThrow(/UNKNOWN_PENALTY_KIND/);
  });
});

describe("term representation — money can never be stored ambiguously", () => {
  it("accepts a well-formed percentage term", () => {
    expect(() => assertTermRepresentation(pct(50))).not.toThrow();
  });

  it("accepts a well-formed fixed term", () => {
    expect(() =>
      assertTermRepresentation({
        penaltyKind: "fixed",
        penaltyAmountMinor: 100n,
        maxPenaltyBps: 10_000,
        thresholdValue: 0,
      }),
    ).not.toThrow();
  });

  it("rejects a percentage term that also carries an amount", () => {
    expect(() =>
      assertTermRepresentation({
        penaltyKind: "percentage",
        penaltyRateBps: 50,
        penaltyAmountMinor: 100n,
        maxPenaltyBps: 10_000,
        thresholdValue: 0,
      }),
    ).toThrow(/TERM_REPRESENTATION/);
  });

  it("rejects a per_day term that also carries a rate", () => {
    expect(() =>
      assertTermRepresentation({
        penaltyKind: "per_day",
        penaltyAmountMinor: 100n,
        penaltyRateBps: 50,
        maxPenaltyBps: 10_000,
        thresholdValue: 0,
      }),
    ).toThrow(/TERM_REPRESENTATION/);
  });

  it("rejects a half-specified term either way round", () => {
    expect(() =>
      assertTermRepresentation({ penaltyKind: "percentage", maxPenaltyBps: 10_000, thresholdValue: 0 }),
    ).toThrow(/MISSING_PENALTY_RATE/);
    expect(() => assertTermRepresentation({ penaltyKind: "fixed", maxPenaltyBps: 10_000, thresholdValue: 0 })).toThrow(
      /MISSING_PENALTY_AMOUNT/,
    );
  });
});

// ══ Occurrence key (double-count business key) ═════════════════════════════

describe("occurrence key", () => {
  const MID = "aaaaaaaa-1111-4000-8000-00000000000a";

  it("is deterministic for the same occurrence", () => {
    expect(occurrenceKey("milestone_missed", MID)).toBe(occurrenceKey("milestone_missed", MID));
  });

  it("namespaces by trigger so a milestone id and an SLA code cannot collide", () => {
    expect(occurrenceKey("milestone_missed", MID)).toBe(`milestone:${MID}`);
    expect(occurrenceKey("sla_breached", MID)).toBe(`sla:${MID}`);
    expect(occurrenceKey("milestone_missed", MID)).not.toBe(occurrenceKey("sla_breached", MID));
  });

  it("rejects a blank reference", () => {
    expect(() => occurrenceKey("milestone_missed", "")).toThrow(/INVALID_OCCURRENCE_REF/);
    expect(() => occurrenceKey("sla_breached", "  ")).toThrow(/INVALID_OCCURRENCE_REF/);
  });
});

// ══ Review cadence ═════════════════════════════════════════════════════════

describe("review-date cadence", () => {
  it("advances by the right number of months for each cadence", () => {
    expect(nextReviewDate("2026-01-15", "monthly")).toBe("2026-02-15");
    expect(nextReviewDate("2026-01-15", "quarterly")).toBe("2026-04-15");
    expect(nextReviewDate("2026-01-15", "half_yearly")).toBe("2026-07-15");
    expect(nextReviewDate("2026-01-15", "annual")).toBe("2027-01-15");
  });

  it("rolls the year over correctly", () => {
    expect(nextReviewDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(nextReviewDate("2026-12-01", "monthly")).toBe("2027-01-01");
  });

  it("clamps to the end of a shorter target month instead of sliding forward", () => {
    expect(nextReviewDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextReviewDate("2026-03-31", "monthly")).toBe("2026-04-30");
    // Leap year February has 29 days.
    expect(nextReviewDate("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("rejects an unknown cadence and a bad start date", () => {
    expect(() => nextReviewDate("2026-01-15", "fortnightly")).toThrow(/INVALID_CADENCE/);
    expect(() => nextReviewDate("15-01-2026", "monthly")).toThrow(/INVALID_DATE/);
  });

  it("recognises the declared cadence set", () => {
    for (const c of REVIEW_CADENCES) expect(isReviewCadence(c)).toBe(true);
    expect(isReviewCadence("weekly")).toBe(false);
  });

  it("treats a review as due on or before the reference date", () => {
    expect(isReviewDue("2026-06-01", "2026-06-01")).toBe(true);
    expect(isReviewDue("2026-06-01", "2026-06-02")).toBe(true);
    expect(isReviewDue("2026-06-02", "2026-06-01")).toBe(false);
  });

  it("a full cadence chain never drifts off the anchor day", () => {
    let d = "2026-01-15";
    for (let i = 0; i < 12; i++) d = nextReviewDate(d, "monthly");
    expect(d).toBe("2027-01-15");
  });
});

describe("review schedule transitions", () => {
  it("allows scheduled → completed and completed → scheduled (next cycle)", () => {
    expect(() => assertReviewTransition("scheduled", "completed")).not.toThrow();
    expect(() => assertReviewTransition("completed", "scheduled")).not.toThrow();
    expect(() => assertReviewTransition("scheduled", "cancelled")).not.toThrow();
  });

  it("treats cancelled as terminal and rejects nonsense", () => {
    expect(() => assertReviewTransition("cancelled", "scheduled")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertReviewTransition("completed", "cancelled")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertReviewTransition("scheduled", "scheduled")).toThrow(/INVALID_TRANSITION/);
  });

  it("rejects unknown review statuses on either side", () => {
    expect(() => assertReviewTransition("archived", "scheduled")).toThrow(/UNKNOWN_STATUS/);
    expect(() => assertReviewTransition("scheduled", "archived")).toThrow(/UNKNOWN_STATUS/);
  });
});
