/**
 * HRMS Disciplinary, Pension, Reservation, APAR — engine/state-machine tests.
 * Packs #09, #08, #44, #15.
 */
import { describe, it, expect } from "vitest";
import { canTransition, penaltyClassOf, assertMajorPenaltyInquiry, MINOR_PENALTIES, MAJOR_PENALTIES } from "../src/modules/disciplinary/state-machine.js";
import { computePension, qualifyingService, commutationFactor, elEncashment, parseNonQualifyingDays, DCRG_ABSOLUTE_CAP_MINOR } from "../src/modules/pension/engine.js";
import { computeRoster } from "../src/modules/reservation/engine.js";
import { computeOverallGrade, bandForGrade } from "../src/modules/apar/engine.js";

// ─── Disciplinary State Machine ──────────────────────────────────────────────
describe("disciplinary state machine", () => {
  it("issue_charge_memo: opened → charge_memo_issued", () => {
    const r = canTransition("opened", "issue_charge_memo", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("charge_memo_issued");
  });
  it("appoint_inquiry: only for major proceedings", () => {
    expect(canTransition("charge_memo_issued", "appoint_inquiry", "major").ok).toBe(true);
    expect(canTransition("charge_memo_issued", "appoint_inquiry", "minor").ok).toBe(false);
  });
  it("minor penalty shortcut: charge_memo → impose_penalty", () => {
    expect(canTransition("charge_memo_issued", "impose_penalty", "minor").ok).toBe(true);
  });
  it("major penalty requires inquiry: charge_memo → impose_penalty (major) fails", () => {
    const r = canTransition("charge_memo_issued", "impose_penalty", "major");
    // The state machine allows impose_penalty from charge_memo only with requiresProceeding: minor
    expect(r.ok).toBe(false);
  });
  it("drop from any live state", () => {
    expect(canTransition("opened", "drop", "major").ok).toBe(true);
    expect(canTransition("finding_recorded", "drop", "major").ok).toBe(true);
    expect(canTransition("pending_approval", "drop", "major").ok).toBe(true);
  });
  it("closed/dropped are terminal (no actions)", () => {
    expect(canTransition("closed", "drop", "major").ok).toBe(false);
    expect(canTransition("dropped", "issue_charge_memo", "major").ok).toBe(false);
  });
  it("eOffice approve → impose_penalty from pending_approval", () => {
    expect(canTransition("pending_approval", "impose_penalty", "major").ok).toBe(true);
  });
});

describe("penaltyClassOf", () => {
  it("censure is minor", () => expect(penaltyClassOf("censure")).toBe("minor"));
  it("dismissal is major", () => expect(penaltyClassOf("dismissal")).toBe("major"));
  it("unknown returns null", () => expect(penaltyClassOf("warning")).toBeNull());
  it("all minor penalties known", () => expect(MINOR_PENALTIES.size).toBe(5));
  it("all major penalties known", () => expect(MAJOR_PENALTIES.size).toBe(5));
});

describe("assertMajorPenaltyInquiry (Rule 14)", () => {
  it("minor passes unconditionally", () => expect(assertMajorPenaltyInquiry({ proceedingType: "minor" }).ok).toBe(true));
  it("major passes with full record", () => {
    expect(assertMajorPenaltyInquiry({ proceedingType: "major", chargeMemoRef: "CM-1", inquiryOfficerId: "IO-1", finding: "guilty", findingDate: "2026-07-01" }).ok).toBe(true);
  });
  it("major fails without charge memo", () => {
    expect(assertMajorPenaltyInquiry({ proceedingType: "major", chargeMemoRef: null, inquiryOfficerId: "IO-1", finding: "guilty", findingDate: "2026-07-01" }).ok).toBe(false);
  });
  it("major fails without finding", () => {
    expect(assertMajorPenaltyInquiry({ proceedingType: "major", chargeMemoRef: "CM-1", inquiryOfficerId: "IO-1", finding: null, findingDate: null }).ok).toBe(false);
  });
});

// ─── Pension Engine ──────────────────────────────────────────────────────────
describe("pension engine — qualifyingService", () => {
  it("33 years = 66 half-years (capped)", () => {
    const r = qualifyingService("1993-04-01", "2026-04-01");
    expect(r.halfYears).toBe(66);
  });
  it("10 years = 20 half-years (minimum pension floor)", () => {
    const r = qualifyingService("2016-04-01", "2026-04-01");
    expect(r.halfYears).toBe(20);
  });
  it("deducts non-qualifying days", () => {
    const r = qualifyingService("2016-04-01", "2026-04-01", 180); // ~6 months
    expect(r.halfYears).toBeLessThan(20);
  });
});

describe("pension engine — computePension (GPF)", () => {
  it("GPF: 50% of emoluments for >=10 yrs service", () => {
    const r = computePension({
      pensionScheme: "GPF", dateOfJoining: "1996-04-01", retirementDate: "2026-04-01",
      lastBasicMinor: 100_000_00n, daRatePct: 50,
    });
    expect(r.definedBenefit).toBe(true);
    expect(r.pensionEligible).toBe(true);
    expect(r.monthlyPensionMinor).toBeGreaterThan(0n);
    // 50% of avg emoluments (basic + DA = 150000)
    expect(r.monthlyPensionMinor).toBe(BigInt(Math.round(150_000_00 * 0.5)));
  });
  it("NPS: no defined-benefit", () => {
    const r = computePension({
      pensionScheme: "NPS", dateOfJoining: "2016-04-01", retirementDate: "2026-04-01",
      lastBasicMinor: 80_000_00n, daRatePct: 50,
    });
    expect(r.definedBenefit).toBe(false);
    expect(r.monthlyPensionMinor).toBe(0n);
  });
  it("<10 years: no pension (not eligible)", () => {
    const r = computePension({
      pensionScheme: "GPF", dateOfJoining: "2020-04-01", retirementDate: "2026-04-01",
      lastBasicMinor: 50_000_00n, daRatePct: 50,
    });
    expect(r.pensionEligible).toBe(false);
    expect(r.monthlyPensionMinor).toBe(0n);
  });
  it("DCRG capped at Rs 20L", () => {
    const r = computePension({
      pensionScheme: "GPF", dateOfJoining: "1993-04-01", retirementDate: "2026-04-01",
      lastBasicMinor: 200_000_00n, daRatePct: 50, // High basic → DCRG hits cap
    });
    expect(r.dcrg.payableMinor).toBeLessThanOrEqual(DCRG_ABSOLUTE_CAP_MINOR);
  });
});

describe("commutationFactor", () => {
  it("age 60 → 8.287", () => expect(commutationFactor(60)).toBe(8.287));
  it("age 61 → 8.194", () => expect(commutationFactor(61)).toBe(8.194));
  it("unknown age uses nearest", () => expect(commutationFactor(75)).toBeGreaterThan(0));
});

describe("elEncashment", () => {
  it("300 days max for full balance", () => {
    const e = elEncashment(100_000_00n, 50, 350); // 350 capped at 300
    const dailyEmol = Number(100_000_00n) * 1.5 / 30;
    expect(e).toBe(BigInt(Math.round(dailyEmol * 300)));
  });
  it("0 days = 0", () => expect(elEncashment(100_000_00n, 50, 0)).toBe(0n));
});

describe("parseNonQualifyingDays", () => {
  it("parses days=180", () => expect(parseNonQualifyingDays("EOL not counting QS; days=180")).toBe(180));
  it("parses from/to range", () => expect(parseNonQualifyingDays("from=2025-01-01;to=2025-06-30")).toBe(181));
  it("returns null for unparseable", () => expect(parseNonQualifyingDays("some text")).toBeNull());
});

// ─── Reservation Roster ──────────────────────────────────────────────────────
describe("reservation roster engine", () => {
  it("computes category vacancies from entitlement - filled", () => {
    const r = computeRoster(
      { rosterSize: 100, pctSc: 15, pctSt: 7.5, pctObc: 27, pctEws: 10, pctPwd: 4, cf: { SC: 2, ST: 0, OBC: 1, EWS: 0, UR: 0 } },
      { SC: 10, ST: 5, OBC: 20, EWS: 8, UR: 30 },
    );
    const sc = r.categories.find(c => c.category === "SC")!;
    expect(sc.entitlement).toBe(15 + 2); // 15% of 100 + 2 carry-forward
    expect(sc.vacancy).toBe(17 - 10); // entitlement - filled
  });
  it("PwD is horizontal (reported separately)", () => {
    const r = computeRoster(
      { rosterSize: 100, pctSc: 15, pctSt: 8, pctObc: 27, pctEws: 10, pctPwd: 4, cf: { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 } },
      { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 },
    );
    expect(r.pwd.entitlement).toBe(4);
  });
  it("vacancy cannot be negative", () => {
    const r = computeRoster(
      { rosterSize: 10, pctSc: 15, pctSt: 8, pctObc: 27, pctEws: 10, pctPwd: 4, cf: { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 } },
      { SC: 99, ST: 99, OBC: 99, EWS: 99, UR: 99 },
    );
    expect(r.categories.every(c => c.vacancy >= 0)).toBe(true);
  });
});

// ─── APAR Grade Engine ───────────────────────────────────────────────────────
describe("APAR grade engine", () => {
  it("weighted mean correctly computed", () => {
    const r = computeOverallGrade([
      { attribute: "integrity", weight: 2, score: 9 },
      { attribute: "output", weight: 3, score: 7 },
    ]);
    // (9*2 + 7*3) / (2+3) = 39/5 = 7.80
    expect(r.overallGrade).toBe(7.8);
    expect(r.band).toBe("Very Good");
  });
  it("throws on empty scores", () => {
    expect(() => computeOverallGrade([])).toThrow();
  });
  it("equal weights", () => {
    const r = computeOverallGrade([
      { attribute: "a", weight: 1, score: 10 },
      { attribute: "b", weight: 1, score: 8 },
    ]);
    expect(r.overallGrade).toBe(9);
    expect(r.band).toBe("Outstanding");
  });
});

describe("bandForGrade thresholds", () => {
  it(">=9 = Outstanding", () => expect(bandForGrade(9)).toBe("Outstanding"));
  it(">=7 <9 = Very Good", () => expect(bandForGrade(7)).toBe("Very Good"));
  it(">=5 <7 = Good", () => expect(bandForGrade(5)).toBe("Good"));
  it(">=4 <5 = Average", () => expect(bandForGrade(4)).toBe("Average"));
  it("<4 = Below Average", () => expect(bandForGrade(3.9)).toBe("Below Average"));
});
