/**
 * HRMS AI Fraud Detection + Scheduler — engine tests.
 * Packs #20, #46.
 */
import { describe, it, expect } from "vitest";
import { detectGpsSpoofing, detectBuddyPunch, detectImpossibleTime, detectGhostEmployee, detectDuplicateBankAccount, detectSalaryAnomaly, detectMondayFridayPattern, detectSandwichAvoidance, detectApproverCollusion, predictAttritionRisk, generateRecommendations } from "../src/modules/ai-fraud/detection-engine.js";
import { superannuationDate, daysBetween, addMonths, computeSuperannuationDue, computeProbationDue } from "../src/modules/scheduler/engine.js";

// ─── GPS Spoofing ────────────────────────────────────────────────────────────
describe("detectGpsSpoofing", () => {
  it("not suspicious with no previous location", () => expect(detectGpsSpoofing(28.6, 77.2, null, null, 10).isSuspicious).toBe(false));
  it("suspicious when distance impossible in time", () => {
    const r = detectGpsSpoofing(28.6, 77.2, 19.0, 72.8, 5); // Delhi→Mumbai in 5min
    expect(r.isSuspicious).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });
  it("not suspicious for reasonable movement", () => {
    const r = detectGpsSpoofing(28.61, 77.21, 28.60, 77.20, 30);
    expect(r.isSuspicious).toBe(false);
  });
});

// ─── Buddy Punch ─────────────────────────────────────────────────────────────
describe("detectBuddyPunch", () => {
  it("not suspicious without deviceId", () => expect(detectBuddyPunch(null, "e1", []).isSuspicious).toBe(false));
  it("suspicious when same device used by different employee", () => {
    const r = detectBuddyPunch("dev-001", "e1", [{ employeeId: "e2", deviceId: "dev-001", markedAt: "2026-07-15T09:00:00Z" }]);
    expect(r.isSuspicious).toBe(true);
  });
  it("not suspicious when only own check-ins", () => {
    const r = detectBuddyPunch("dev-001", "e1", [{ employeeId: "e1", deviceId: "dev-001", markedAt: "2026-07-15T08:00:00Z" }]);
    expect(r.isSuspicious).toBe(false);
  });
});

// ─── Ghost Employee ──────────────────────────────────────────────────────────
describe("detectGhostEmployee", () => {
  it("flags zero attendance on active payroll", () => {
    const r = detectGhostEmployee("e1", 0, true, "confirmed");
    expect(r).not.toBeNull();
    expect(r!.score).toBe(0.95);
  });
  it("ignores non-payroll employees", () => expect(detectGhostEmployee("e1", 0, false, "confirmed")).toBeNull());
  it("ignores non-confirmed employees", () => expect(detectGhostEmployee("e1", 0, true, "probation")).toBeNull());
});

// ─── Duplicate Bank Account ──────────────────────────────────────────────────
describe("detectDuplicateBankAccount", () => {
  it("flags shared bank account", () => {
    const alerts = detectDuplicateBankAccount([
      { employeeId: "e1", bankAccountNo: "123456", bankIfsc: "SBIN0001" },
      { employeeId: "e2", bankAccountNo: "123456", bankIfsc: "SBIN0001" },
    ]);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.severity).toBe("critical");
  });
  it("no alert when accounts are unique", () => {
    expect(detectDuplicateBankAccount([
      { employeeId: "e1", bankAccountNo: "111", bankIfsc: "SBIN0001" },
      { employeeId: "e2", bankAccountNo: "222", bankIfsc: "SBIN0001" },
    ]).length).toBe(0);
  });
});

// ─── Monday/Friday Pattern ───────────────────────────────────────────────────
describe("detectMondayFridayPattern", () => {
  it("flags when >60% leaves on Mon/Fri with 4+ records", () => {
    const leaves = [
      { fromDate: "2026-07-06", toDate: "2026-07-06" }, // Mon
      { fromDate: "2026-07-10", toDate: "2026-07-10" }, // Fri
      { fromDate: "2026-07-13", toDate: "2026-07-13" }, // Mon
      { fromDate: "2026-07-17", toDate: "2026-07-17" }, // Fri
    ];
    const r = detectMondayFridayPattern(leaves);
    expect(r.isSuspicious).toBe(true);
  });
  it("not suspicious with few records", () => {
    const r = detectMondayFridayPattern([{ fromDate: "2026-07-06", toDate: "2026-07-06" }]);
    expect(r.isSuspicious).toBe(false);
  });
});

// ─── Attrition Risk ──────────────────────────────────────────────────────────
describe("predictAttritionRisk", () => {
  it("high risk with multiple signals", () => {
    const r = predictAttritionRisk({
      attendanceDecline: true, leaveExhausted: true, noTrainingLast12Months: true,
      sameRoleOver3Years: true, recentPeerDepartures: 3, overtimeIncreasing: true,
      appraisalRatingLow: true, salaryBelowMarket: true, noPromotionLast5Years: true,
    });
    expect(r.overall).toBeGreaterThan(0.7);
    expect(r.factors.length).toBeGreaterThan(5);
  });
  it("low risk with no signals", () => {
    const r = predictAttritionRisk({
      attendanceDecline: false, leaveExhausted: false, noTrainingLast12Months: false,
      sameRoleOver3Years: false, recentPeerDepartures: 0, overtimeIncreasing: false,
      appraisalRatingLow: false, salaryBelowMarket: false, noPromotionLast5Years: false,
    });
    expect(r.overall).toBe(0);
    expect(r.factors.length).toBe(0);
  });
});

// ─── Recommendations ─────────────────────────────────────────────────────────
describe("generateRecommendations", () => {
  it("generates wellness rec for no-leave employees", () => {
    const recs = generateRecommendations({ employeesWithNoLeave6Months: ["e1"], employeesWithHighOvertime: [], departmentsUnderstaffed: [], leaveBalanceExpiring: [], upcomingProbationEnd: [] });
    expect(recs.some(r => r.category === "wellness")).toBe(true);
  });
  it("generates staffing rec for understaffed depts", () => {
    const recs = generateRecommendations({ employeesWithNoLeave6Months: [], employeesWithHighOvertime: [], departmentsUnderstaffed: ["IT"], leaveBalanceExpiring: [], upcomingProbationEnd: [] });
    expect(recs.some(r => r.category === "staffing")).toBe(true);
  });
});

// ─── Scheduler: Superannuation ───────────────────────────────────────────────
describe("superannuationDate", () => {
  it("born 15 July 1966 → retires last day of July 2026", () => {
    expect(superannuationDate("1966-07-15")).toBe("2026-07-31");
  });
  it("born 1 April 1966 → retires last day of March 2026 (born-on-1st rule)", () => {
    expect(superannuationDate("1966-04-01")).toBe("2026-03-31");
  });
  it("born 1 January 1966 → retires last day of December 2025", () => {
    expect(superannuationDate("1966-01-01")).toBe("2025-12-31");
  });
});

describe("daysBetween", () => {
  it("same day = 0", () => expect(daysBetween("2026-07-15", "2026-07-15")).toBe(0));
  it("one day apart = 1", () => expect(daysBetween("2026-07-15", "2026-07-16")).toBe(1));
  it("negative when to < from", () => expect(daysBetween("2026-07-16", "2026-07-15")).toBe(-1));
});

describe("addMonths", () => {
  it("adds 24 months", () => expect(addMonths("2024-04-01", 24)).toBe("2026-04-01"));
  it("clamps day (Jan 31 + 1m → Feb 28)", () => expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"));
});

describe("computeSuperannuationDue", () => {
  it("filters candidates within window", () => {
    const candidates = [
      { employeeId: "e1", employeeNo: "001", fullName: "A", dateOfBirthISO: "1966-07-15" },
      { employeeId: "e2", employeeNo: "002", fullName: "B", dateOfBirthISO: "1970-01-01" },
    ];
    const result = computeSuperannuationDue(candidates, "2026-07-01", 60);
    expect(result.some(r => r.employeeId === "e1")).toBe(true);
    expect(result.some(r => r.employeeId === "e2")).toBe(false); // 2030, not within 60 days
  });
});

describe("computeProbationDue", () => {
  it("includes probation employees whose end is within window", () => {
    const candidates = [
      { employeeId: "e1", employeeNo: "001", fullName: "A", status: "probation", dateOfJoiningISO: "2024-07-01", confirmationDateISO: null },
    ];
    const result = computeProbationDue(candidates, "2026-06-15", 30); // DOJ + 24m = 2026-07-01, 16 days away
    expect(result.length).toBe(1);
    expect(result[0]!.daysRemaining).toBe(16);
  });
  it("skips non-probation employees", () => {
    const candidates = [{ employeeId: "e1", employeeNo: "001", fullName: "A", status: "confirmed", dateOfJoiningISO: "2024-01-01", confirmationDateISO: null }];
    expect(computeProbationDue(candidates, "2026-07-01", 60).length).toBe(0);
  });
});
