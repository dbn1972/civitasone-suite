/**
 * S8-G3 -- the row-based resolver (customRules: true): matrix of leave type x employee type x
 * probation x gender, tenant-defined codes, the contract/contractual alias, and NO_LEAVE_RULE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn(async (..._a: unknown[]) => null as unknown) }));
vi.mock("./repo.js", () => ({ findTenantLeavePolicy: (...a: unknown[]) => findMock(...a) }));
vi.mock("../../shared/db.js", () => ({ scopedRead: vi.fn(async () => []) }));

import { validateLeaveRequest, LEAVE_POLICIES } from "./rules-engine.js";
import { canonicalLeaveEmployeeType, leaveEmployeeTypeCandidates, leaveEngineBucket, LEAVE_RULE_EMPLOYEE_TYPES } from "./employee-type-alias.js";
import { SYSTEM_CODES } from "./type-admin-validators.js";

const row = (o: Record<string, unknown> = {}) => ({
  id: "r1", tenantId: "t", leaveTypeId: "lt", employeeType: "contractual", maxDaysPerYear: 12, carryForward: false,
  maxAccumulation: 0, encashable: false, countMethod: "calendar", maxContinuousDays: 5, minServiceMonths: 0,
  genderRestriction: null, requiresMedicalCert: false, requiresMedicalCertAfterDays: 3, prefixSuffixRule: false,
  sandwichRule: false, proRataOnJoining: true, allowedInProbation: false, isActive: true,
  createdAt: new Date(0), updatedAt: new Date(0), createdBy: "u", updatedBy: "u", version: 1, ...o,
});
const base = {
  employeeType: "contract" as const, leaveCode: "PRJ" as never, fromDate: "2027-03-02", toDate: "2027-03-02",
  daysApplied: 1, currentBalance: 10, totalAccumulated: 10, serviceStartDate: "2022-04-01", tenantId: "t",
  isOnProbation: false, leaveTypeId: "lt", rawEmployeeType: "contract", customRules: true, leaveTypeName: "Project Leave",
  systemCode: null as string | null,
};

beforeEach(() => findMock.mockReset().mockResolvedValue(null));

describe("employee-type alias", () => {
  it("contract and contractual are one type; candidates cover both spellings, no duplicates", () => {
    expect(canonicalLeaveEmployeeType("contract")).toBe("contractual");
    expect(canonicalLeaveEmployeeType(" Contractual ")).toBe("contractual");
    expect(leaveEmployeeTypeCandidates("contract")).toEqual(["contract", "contractual"]);
    expect(leaveEmployeeTypeCandidates("contractual")).toEqual(["contractual", "contract"]);
    expect(leaveEmployeeTypeCandidates("deputation")).toEqual(["deputation"]);
  });
  it("engine bucket: contract-like and unknown values are the restrictive `contract` bucket", () => {
    expect(["permanent", "contract", "contractual", "deputation", "temporary", "vendor_deputed", "consultant", "intern"].map(leaveEngineBucket))
      .toEqual(["permanent", "contract", "contract", "deputation", "temporary", "contract", "contract", "contract"]);
  });
  it("the accepted vocabulary includes every spelling a record or old rule may carry", () => {
    expect(LEAVE_RULE_EMPLOYEE_TYPES).toEqual(expect.arrayContaining(["contract", "contractual", "deputation", "permanent"]));
  });
  it("SYSTEM_CODES equals the engine's built-in catalogue codes (no drift)", () => {
    expect([...SYSTEM_CODES].sort()).toEqual(LEAVE_POLICIES.map((p) => p.code).sort());
  });
});

describe("custom resolver", () => {
  it("a tenant-defined code with a tenant rule resolves (no 'Unknown leave code')", async () => {
    findMock.mockResolvedValue(row());
    const r = await validateLeaveRequest(base);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("looks the rule up under both spellings: a `contractual` rule serves a `contract` employee", async () => {
    findMock.mockImplementation(async (...a: unknown[]) => (a[2] === "contractual" ? row() : null));
    expect((await validateLeaveRequest(base)).valid).toBe(true);
    expect(findMock.mock.calls.map((c) => c[2])).toEqual(["contract", "contractual"]);
  });

  it("no tenant rule and no built-in => NO_LEAVE_RULE", async () => {
    const r = await validateLeaveRequest(base);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/^NO_LEAVE_RULE: .*Project Leave \(PRJ\)/);
  });

  it("the rule's limits apply (max continuous days)", async () => {
    findMock.mockResolvedValue(row({ maxContinuousDays: 2 }));
    const r = await validateLeaveRequest({ ...base, fromDate: "2027-03-02", toDate: "2027-03-05", daysApplied: 4 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/maximum continuous/i);
  });

  it.each([
    ["no rule row, built-in CL is allowed in probation", null, "CL", true],
    ["no rule row, built-in EL is not allowed in probation", null, "EL", false],
    ["rule says allowed_in_probation", row({ allowedInProbation: true }), null, true],
    ["rule says not allowed in probation", row({ allowedInProbation: false }), null, false],
  ])("probation is a rule property: %s", async (_n, tenantRow, sys, ok) => {
    findMock.mockResolvedValue(tenantRow);
    const r = await validateLeaveRequest({ ...base, isOnProbation: true, systemCode: sys, leaveCode: (sys ?? "PRJ") as never,
      employeeType: sys === "EL" ? "permanent" : "contract", rawEmployeeType: sys === "EL" ? "permanent" : "contract" });
    expect(r.valid).toBe(ok);
    if (!ok) expect(r.errors.join(" ")).toMatch(/probation/i);
  });

  it("built-in behaviours key on system_code: a type coded PL but with system_code NULL is NOT Paternity Leave", async () => {
    findMock.mockResolvedValue(row());
    const r = await validateLeaveRequest({ ...base, leaveCode: "PL" as never, leaveTypeName: "Paid Leave (Project Contract Staff)", gender: "female" });
    expect(r.valid).toBe(true); // legacy path would say "Paternity Leave is for male employees only"
    const legacy = await validateLeaveRequest({ ...base, customRules: false, leaveCode: "PL" as never, gender: "female", employeeType: "permanent" });
    expect(legacy.errors.join(" ")).toMatch(/Paternity/);
  });

  it("system_code ML keeps the maternity gender check; PL the paternity one", async () => {
    findMock.mockResolvedValue(null);
    const ml = await validateLeaveRequest({ ...base, employeeType: "permanent", rawEmployeeType: "permanent", leaveCode: "ML" as never, systemCode: "ML", gender: "male" });
    expect(ml.errors.join(" ")).toMatch(/Maternity/);
    const pl = await validateLeaveRequest({ ...base, employeeType: "permanent", rawEmployeeType: "permanent", leaveCode: "PL" as never, systemCode: "PL", gender: "female" });
    expect(pl.errors.join(" ")).toMatch(/Paternity/);
  });

  it("tenant gender restriction on a custom type: the rule row wins over the type's", async () => {
    findMock.mockResolvedValue(row({ genderRestriction: "female" }));
    expect((await validateLeaveRequest({ ...base, gender: "male" })).errors.join(" ")).toMatch(/women only/);
    expect((await validateLeaveRequest({ ...base, gender: "female" })).valid).toBe(true);
    findMock.mockResolvedValue(row());
    expect((await validateLeaveRequest({ ...base, gender: "female", typeGenderRestriction: "male" })).errors.join(" ")).toMatch(/men only/);
  });

  it("half-day is only for the built-in CL (system_code), not any tenant code", async () => {
    findMock.mockResolvedValue(row());
    const r = await validateLeaveRequest({ ...base, dayPart: "first_half", daysApplied: 0.5 });
    expect(r.errors.join(" ")).toMatch(/Casual Leave/);
    const cl = await validateLeaveRequest({ ...base, leaveCode: "CL" as never, systemCode: "CL", dayPart: "first_half", daysApplied: 0.5 });
    expect(cl.errors).toEqual([]);
  });

  it("a built-in type with no tenant rule keeps the catalogue defaults (EL not for contract staff)", async () => {
    const r = await validateLeaveRequest({ ...base, leaveCode: "EL" as never, systemCode: "EL", leaveTypeName: "Earned Leave" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/not available for contract employees/);
  });
});
