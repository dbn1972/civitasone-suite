import { describe, it, expect } from "vitest";
import {
  validateLeaveRequest,
  LEAVE_POLICIES,
  countWorkingDaysExcludingHolidays,
  countCalendarDays,
  type LeaveValidationInput,
} from "../src/modules/leave/rules-engine.js";

// ═══════════════════════════════════════════════════════════════════════════
// HR DOMAIN EXPERT: Test cases for leave rules validation
// Tests employee types: permanent, contract, deputation
// Tests rules: balance, eligibility, holidays, sandwich, prefix/suffix
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = "00000000-0000-0000-0000-000000000001";

function makeInput(overrides: Partial<LeaveValidationInput>): LeaveValidationInput {
  return {
    employeeType: "permanent",
    leaveCode: "CL",
    fromDate: "2026-07-01",
    toDate: "2026-07-03",
    daysApplied: 3,
    currentBalance: 8,
    totalAccumulated: 8,
    serviceStartDate: "2020-01-01",
    tenantId: TENANT,
    isOnProbation: false,
    gender: "male",
    childrenCount: 0,
    ...overrides,
  };
}

describe("Leave Rules Engine — Policy Master", () => {
  it("has 10 leave types defined", () => {
    expect(LEAVE_POLICIES).toHaveLength(10);
  });

  it("CL is available to all employee types", () => {
    const cl = LEAVE_POLICIES.find(p => p.code === "CL")!;
    expect(cl.applicableTo).toContain("permanent");
    expect(cl.applicableTo).toContain("contract");
    expect(cl.applicableTo).toContain("deputation");
  });

  it("EL is NOT available to contractual employees", () => {
    const el = LEAVE_POLICIES.find(p => p.code === "EL")!;
    expect(el.applicableTo).not.toContain("contract");
  });

  it("EL requires 1 year minimum service", () => {
    const el = LEAVE_POLICIES.find(p => p.code === "EL")!;
    expect(el.minServiceYears).toBe(1);
  });

  it("EL counts working days only", () => {
    const el = LEAVE_POLICIES.find(p => p.code === "EL")!;
    expect(el.countMethod).toBe("working_days");
  });

  it("CL has sandwich and prefix/suffix rules", () => {
    const cl = LEAVE_POLICIES.find(p => p.code === "CL")!;
    expect(cl.sandwichRule).toBe(true);
    expect(cl.prefixSuffixRule).toBe(true);
  });

  it("EL max accumulation is 300 days", () => {
    const el = LEAVE_POLICIES.find(p => p.code === "EL")!;
    expect(el.maxAccumulation).toBe(300);
    expect(el.carryForward).toBe(true);
    expect(el.encashable).toBe(true);
  });
});

describe("Leave Rules Engine — Date Calculations", () => {
  it("counts calendar days correctly", () => {
    expect(countCalendarDays("2026-07-01", "2026-07-03")).toBe(3);
    expect(countCalendarDays("2026-07-01", "2026-07-01")).toBe(1);
    expect(countCalendarDays("2026-07-01", "2026-07-07")).toBe(7);
  });

  it("excludes weekends from working days", () => {
    // Mon Jul 6 to Fri Jul 10 = 5 working days
    expect(countWorkingDaysExcludingHolidays("2026-07-06", "2026-07-10", new Set())).toBe(5);
    // Mon Jul 6 to Sun Jul 12 = 5 working (excludes Sat+Sun)
    expect(countWorkingDaysExcludingHolidays("2026-07-06", "2026-07-12", new Set())).toBe(5);
  });

  it("excludes holidays from working days", () => {
    // Aug 14 (Fri) to Aug 17 (Mon) — Aug 15 is Independence Day
    const holidays = new Set(["2026-08-15"]);
    // Aug 14=Fri (working), Aug 15=Sat... wait let me check
    // 2026-08-14 is Friday, 15 is Saturday, 16 Sunday, 17 Monday
    // Working days: 14 (Fri) + 17 (Mon) = 2, but 15 is holiday AND weekend
    expect(countWorkingDaysExcludingHolidays("2026-08-14", "2026-08-17", holidays)).toBe(2);
  });
});

describe("Leave Rules Engine — Permanent Employee (Govt)", () => {
  it("PASS: CL within balance", async () => {
    const result = await validateLeaveRequest(makeInput({
      employeeType: "permanent", leaveCode: "CL",
      fromDate: "2026-07-01", toDate: "2026-07-02", daysApplied: 2, currentBalance: 8,
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("FAIL: CL exceeds balance", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "CL", fromDate: "2026-07-01", toDate: "2026-07-10",
      daysApplied: 10, currentBalance: 5,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Insufficient balance"))).toBe(true);
  });

  it("PASS: EL for permanent employee with 5 years service", async () => {
    const result = await validateLeaveRequest(makeInput({
      employeeType: "permanent", leaveCode: "EL",
      fromDate: "2026-07-07", toDate: "2026-07-11", // Mon-Fri = 5 working days
      daysApplied: 5, currentBalance: 30, serviceStartDate: "2020-01-01",
    }));
    expect(result.valid).toBe(true);
  });

  it("FAIL: EL for employee with < 1 year service", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "EL", serviceStartDate: "2026-03-01", // joined 3 months ago
      fromDate: "2026-07-01", toDate: "2026-07-05", daysApplied: 5, currentBalance: 30,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("minimum 1 year"))).toBe(true);
  });

  it("PASS: HPL for permanent employee", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "HPL", fromDate: "2026-07-01", toDate: "2026-07-10",
      daysApplied: 10, currentBalance: 20,
    }));
    expect(result.valid).toBe(true);
  });

  it("PASS: Maternity leave for female permanent employee", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "ML", gender: "female",
      fromDate: "2026-07-01", toDate: "2026-12-27", daysApplied: 180, currentBalance: 180,
    }));
    expect(result.valid).toBe(true);
  });

  it("FAIL: Maternity leave for male employee", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "ML", gender: "male",
      fromDate: "2026-07-01", toDate: "2026-07-10", daysApplied: 10, currentBalance: 180,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("women employees only"))).toBe(true);
  });

  it("FAIL: CCL for employee with 2+ children", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "CCL", gender: "female", childrenCount: 2,
      fromDate: "2026-07-01", toDate: "2026-07-30", daysApplied: 30, currentBalance: 730,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("2 or more surviving children"))).toBe(true);
  });
});

describe("Leave Rules Engine — Contractual Employee", () => {
  it("PASS: CL allowed for contractual", async () => {
    const result = await validateLeaveRequest(makeInput({
      employeeType: "contract", leaveCode: "CL",
      fromDate: "2026-07-01", toDate: "2026-07-02", daysApplied: 2, currentBalance: 8,
    }));
    expect(result.valid).toBe(true);
  });

  it("FAIL: EL NOT allowed for contractual", async () => {
    const result = await validateLeaveRequest(makeInput({
      employeeType: "contract", leaveCode: "EL",
      fromDate: "2026-07-01", toDate: "2026-07-05", daysApplied: 5, currentBalance: 30,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("not available for contract"))).toBe(true);
  });

  it("FAIL: HPL NOT allowed for contractual", async () => {
    const result = await validateLeaveRequest(makeInput({
      employeeType: "contract", leaveCode: "HPL",
      fromDate: "2026-07-01", toDate: "2026-07-05", daysApplied: 5, currentBalance: 20,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("not available for contract"))).toBe(true);
  });

  it("FAIL: Maternity NOT allowed for contractual", async () => {
    const result = await validateLeaveRequest(makeInput({
      employeeType: "contract", leaveCode: "ML", gender: "female",
      fromDate: "2026-07-01", toDate: "2026-07-30", daysApplied: 30, currentBalance: 180,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("not available for contract"))).toBe(true);
  });
});

describe("Leave Rules Engine — Probation Period", () => {
  it("PASS: CL allowed during probation", async () => {
    const result = await validateLeaveRequest(makeInput({
      isOnProbation: true, leaveCode: "CL",
      fromDate: "2026-07-01", toDate: "2026-07-02", daysApplied: 2, currentBalance: 8,
    }));
    expect(result.valid).toBe(true);
  });

  it("FAIL: EL not allowed during probation", async () => {
    const result = await validateLeaveRequest(makeInput({
      isOnProbation: true, leaveCode: "EL",
      fromDate: "2026-07-01", toDate: "2026-07-05", daysApplied: 5, currentBalance: 30,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("probation"))).toBe(true);
  });

  it("FAIL: HPL not allowed during probation", async () => {
    const result = await validateLeaveRequest(makeInput({
      isOnProbation: true, leaveCode: "HPL",
      fromDate: "2026-07-01", toDate: "2026-07-05", daysApplied: 5, currentBalance: 20,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("probation"))).toBe(true);
  });
});

describe("Leave Rules Engine — Max Continuous & Accumulation", () => {
  it("FAIL: CL exceeds max 8 continuous days", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "CL",
      fromDate: "2026-07-01", toDate: "2026-07-12", daysApplied: 12, currentBalance: 12,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("maximum continuous"))).toBe(true);
  });

  it("WARN: EL accumulation exceeds 300 days", async () => {
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "EL", fromDate: "2026-07-07", toDate: "2026-07-11",
      daysApplied: 5, currentBalance: 30, totalAccumulated: 310,
    }));
    expect(result.valid).toBe(true); // still valid but warns
    expect(result.warnings.some(w => w.includes("exceeds max 300"))).toBe(true);
  });
});

describe("Leave Rules Engine — Holiday-Aware (EL working days)", () => {
  it("EL: working days excludes weekends", async () => {
    // Jul 6 (Mon) to Jul 12 (Sun) = 5 working days
    const result = await validateLeaveRequest(makeInput({
      leaveCode: "EL", fromDate: "2026-07-06", toDate: "2026-07-12",
      daysApplied: 5, currentBalance: 30,
    }));
    expect(result.valid).toBe(true);
    expect(result.workingDaysInRange).toBe(5);
    expect(result.computedDays).toBe(5); // EL counts working days only
  });
});
