/**
 * DOM-009 — Leave rules engine regression tests.
 *
 * Before this fix, validateLeaveRequest() ONLY ever consulted the hardcoded
 * LEAVE_POLICIES catalog — a tenant's admin-configured policy row
 * (hrms_leave_policy_rules, edited via policy-admin-routes.ts) was written to
 * the DB but never read back on the apply path. These tests prove:
 *
 *  1. An admin-edited policy value (a tightened maxContinuousDays cap) is
 *     actually enforced when validating a leave request — the literal DoD
 *     ("admin-edited cap is enforced in test").
 *  2. A tenant with no configured policy row falls back to the platform
 *     default catalog (parity with the prior hardcoded-only behavior).
 *  3. resolveAccumulationCap()'s three-tier fallback (tenant row → default
 *     catalog by code → no cap) used by the leaveAllocate consumer to decide
 *     the EL lapse amount.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing rules-engine.js.
// ---------------------------------------------------------------------------
const { findTenantLeavePolicyMock } = vi.hoisted(() => ({
  findTenantLeavePolicyMock: vi.fn(async (..._args: any[]) => null as any),
}));

vi.mock("./repo.js", () => ({
  findTenantLeavePolicy: (...args: any[]) => findTenantLeavePolicyMock(...args),
}));

// getHolidaysInRange() calls scopedRead(tx => tx.select(...).from(...).where(...))
// — stub it to always resolve zero holidays so date-math tests are deterministic.
vi.mock("../../shared/db.js", () => ({
  scopedRead: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    }),
  ),
}));

import { validateLeaveRequest, resolveAccumulationCap, LEAVE_POLICIES } from "./rules-engine.js";
import type { LeavePolicyRuleRow } from "./policy-schema.js";

const TENANT = "tenant-1";
const LT_ID = "leave-type-el";

function makeTenantRow(overrides: Partial<LeavePolicyRuleRow> = {}): LeavePolicyRuleRow {
  return {
    id: "policy-row-1",
    tenantId: TENANT,
    leaveTypeId: LT_ID,
    employeeType: "permanent",
    maxDaysPerYear: 30,
    carryForward: true,
    maxAccumulation: 300,
    encashable: true,
    countMethod: "working_days",
    maxContinuousDays: 180,
    minServiceMonths: 0,
    genderRestriction: null,
    requiresMedicalCert: false,
    requiresMedicalCertAfterDays: 3,
    prefixSuffixRule: false,
    sandwichRule: false,
    proRataOnJoining: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "admin-1",
    updatedBy: "admin-1",
    version: 1,
    ...overrides,
  } as LeavePolicyRuleRow;
}

const baseInput = {
  employeeType: "permanent" as const,
  leaveCode: "EL" as const,
  // 15 calendar days (inclusive) — under the default 180-day EL continuous
  // cap, over a tightened tenant cap of 10 days used in the tests below.
  fromDate: "2025-06-01",
  toDate: "2025-06-15",
  daysApplied: 15,
  currentBalance: 100,
  totalAccumulated: 50,
  serviceStartDate: "2015-01-01",
  tenantId: TENANT,
  isOnProbation: false,
  leaveTypeId: LT_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  findTenantLeavePolicyMock.mockResolvedValue(null);
});

describe("validateLeaveRequest — DOM-009 tenant policy wiring", () => {
  it("enforces an admin-edited policy cap on the apply path (DoD)", async () => {
    // Admin tightened EL's max continuous days from the default 180 down to
    // 10 via policy-admin-routes.ts. The 15-day request below would PASS
    // under the hardcoded default but must FAIL once the tenant's edit is
    // actually read.
    findTenantLeavePolicyMock.mockResolvedValue(makeTenantRow({ maxContinuousDays: 10 }));

    const result = await validateLeaveRequest(baseInput);

    expect(findTenantLeavePolicyMock).toHaveBeenCalledWith(TENANT, LT_ID, "permanent");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maximum continuous") && e.includes("allowed 10 days"))).toBe(true);
  });

  it("falls back to the platform default catalog when the tenant has no configured policy (parity)", async () => {
    findTenantLeavePolicyMock.mockResolvedValue(null);

    // Same 15-day request: under the DEFAULT 180-day cap this must pass.
    const result = await validateLeaveRequest(baseInput);
    expect(result.errors.some((e) => e.includes("maximum continuous"))).toBe(false);

    // And the default catalog's 300-day accumulation cap (not some other
    // value) is what drives the R10 warning when no tenant row exists.
    const overAccumulated = await validateLeaveRequest({ ...baseInput, totalAccumulated: 320 });
    expect(overAccumulated.warnings.some((w) => w.includes("exceeds max 300"))).toBe(true);
    const defaultEl = LEAVE_POLICIES.find((p) => p.code === "EL")!;
    expect(defaultEl.maxAccumulation).toBe(300);
  });

  it("uses the tenant's edited accumulation cap (not the default) in the R10 warning once configured", async () => {
    findTenantLeavePolicyMock.mockResolvedValue(makeTenantRow({ maxAccumulation: 120 }));
    const result = await validateLeaveRequest({ ...baseInput, totalAccumulated: 150 });
    expect(result.warnings.some((w) => w.includes("exceeds max 120"))).toBe(true);
  });
});

describe("resolveAccumulationCap — DOM-009 three-tier fallback", () => {
  it("prefers the tenant's admin-configured row when present", () => {
    const cap = resolveAccumulationCap(makeTenantRow({ carryForward: true, maxAccumulation: 250 }), "EL");
    expect(cap).toEqual({ carryForward: true, maxAccumulation: 250 });
  });

  it("falls back to the default catalog entry (EL: 300, carryForward true) when no tenant row exists", () => {
    const cap = resolveAccumulationCap(null, "EL");
    expect(cap).toEqual({ carryForward: true, maxAccumulation: 300 });
  });

  it("returns no cap for a code unknown to both the tenant and the default catalog", () => {
    const cap = resolveAccumulationCap(null, "EOL");
    expect(cap).toEqual({ carryForward: false, maxAccumulation: 0 });
  });
});
