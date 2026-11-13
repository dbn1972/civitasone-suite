/**
 * S8-G3 -- proof that the leave engine is UNCHANGED for a tenant with no
 * custom leave types (flag `customLeaveRules` off / absent).
 *
 * The golden file `__fixtures__/leave-rules-flag-off.golden.json` was generated
 * from the engine as it stood on main (09fdf116b), BEFORE any G3 change, by
 * running this very matrix with UPDATE_LEAVE_GOLDEN=1. Every cell of
 * (leave code x employee type x probation x gender x date shape x balance x
 * tenant-row-present) must still produce a byte-identical ValidationResult.
 * The pre-existing rules-engine.test.ts / consumer.test.ts run untouched too.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const { findTenantLeavePolicyMock } = vi.hoisted(() => ({
  findTenantLeavePolicyMock: vi.fn(async (..._args: unknown[]) => null as unknown),
}));
vi.mock("./repo.js", () => ({
  findTenantLeavePolicy: (...args: unknown[]) => findTenantLeavePolicyMock(...args),
}));
// One public holiday (Republic Day 2027 falls on a Tuesday) so sandwich / prefix-suffix paths are exercised.
vi.mock("../../shared/db.js", () => ({
  scopedRead: vi.fn(async () => [{ date: "2027-01-26" }]),
}));

import { validateLeaveRequest, LEAVE_POLICIES, type EmployeeType, type LeaveCategory } from "./rules-engine.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "leave-rules-flag-off.golden.json");

const TENANT_ROW = {
  id: "11111111-1111-4111-8111-111111111111", tenantId: "t-1", leaveTypeId: "lt-1", employeeType: "permanent",
  maxDaysPerYear: 12, carryForward: true, maxAccumulation: 90, encashable: true, countMethod: "working_days",
  maxContinuousDays: 6, minServiceMonths: 6, genderRestriction: null, requiresMedicalCert: false,
  requiresMedicalCertAfterDays: 3, prefixSuffixRule: true, sandwichRule: true, proRataOnJoining: true, isActive: true,
  createdAt: new Date(0), updatedAt: new Date(0), createdBy: "u", updatedBy: "u", version: 1,
};

const CODES = [...LEAVE_POLICIES.map((p) => p.code), "ZZ"] as string[];
const TYPES: EmployeeType[] = ["permanent", "temporary", "contract", "deputation"];
const RANGES: Array<[string, string]> = [["2027-01-25", "2027-01-27"], ["2027-02-05", "2027-02-08"], ["2027-03-01", "2027-03-01"]];

async function runMatrix(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const withRow of [false, true]) {
    findTenantLeavePolicyMock.mockImplementation(async () => (withRow ? { ...TENANT_ROW } : null));
    for (const code of CODES) for (const employeeType of TYPES) for (const isOnProbation of [false, true])
      for (const gender of [undefined, "male", "female"] as const) for (const [fromDate, toDate] of RANGES)
        for (const currentBalance of [2, 300]) {
          const r = await validateLeaveRequest({
            employeeType, leaveCode: code as LeaveCategory, fromDate, toDate, daysApplied: 1, currentBalance,
            totalAccumulated: 400, serviceStartDate: "2010-04-01", tenantId: "t-1", isOnProbation,
            ...(gender ? { gender } : {}), childrenCount: 1, ...(withRow ? { leaveTypeId: "lt-1" } : {}), rawEmployeeType: employeeType,
          });
          out.push({ code, employeeType, isOnProbation, gender: gender ?? null, fromDate, toDate, currentBalance, withRow, r });
        }
  }
  return out;
}

describe("S8-G3 flag-off parity: leave engine behaviour is unchanged", () => {
  it("every cell of the matrix matches the pre-G3 golden byte for byte", async () => {
    // One short sha256 per matrix cell (the full results are 1.3 MB); a mismatch names the exact cell.
    const cells = await runMatrix();
    const actual = cells.map((c) => createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16));
    if (process.env.UPDATE_LEAVE_GOLDEN === "1") writeFileSync(GOLDEN, JSON.stringify(actual) + String.fromCharCode(10));
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as string[];
    expect(actual.length).toBe(golden.length);
    const diffs = actual.flatMap((h, i) => (h === golden[i] ? [] : [JSON.stringify(cells[i])]));
    expect(diffs).toEqual([]);
  });
});
