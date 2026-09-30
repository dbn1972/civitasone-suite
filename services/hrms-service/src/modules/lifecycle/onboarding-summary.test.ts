/**
 * GET /v1/hrms/onboarding row-shaping — unit tests.
 *
 * GAP-HR-ONBOARDING-01/04/05: this logic used to live inline in the route
 * handler (onboarding-routes.ts), which is why the sibling
 * onboarding-documents-merge.test.ts's own comment notes the tenant-wide
 * summary route "has never had a dedicated test file in this module" -- it
 * wasn't a pure function to test in isolation. This fix extracts it into
 * buildOnboardingSummaryRows/countOnboardingRows/filterOnboardingRows
 * (mirroring the mergeOnboardingDocuments precedent: config/rows in, shaped
 * data out, no DB), so it can finally get direct coverage here rather than
 * only through a route-level integration test.
 */
import { describe, it, expect } from "vitest";
import {
  buildOnboardingSummaryRows,
  countOnboardingRows,
  filterOnboardingRows,
  type OnboardingEmployeeLite,
  type OnboardingTaskLite,
} from "./onboarding-routes.js";

const TODAY = "2026-09-30";

function emp(overrides: Partial<OnboardingEmployeeLite> & { id: string }): OnboardingEmployeeLite {
  return {
    fullName: "Priya Sharma",
    employeeNo: "EMP-1",
    departmentId: "dept-1",
    dateOfJoining: "2026-08-01",
    ...overrides,
  };
}

function task(overrides: Partial<OnboardingTaskLite> = {}): OnboardingTaskLite {
  return { employeeId: "emp-1", status: "pending", dueByDay: 3, ...overrides };
}

describe("buildOnboardingSummaryRows", () => {
  it("GAP-HR-ONBOARDING-01: reports stepsCompleted as a real 'completed/total' string, not a value Number() would turn into NaN", () => {
    const empMap = new Map([["emp-1", emp({ id: "emp-1" })]]);
    const deptMap = new Map([["dept-1", "Finance"]]);
    const tasks = new Map([["emp-1", [task({ status: "completed" }), task(), task()]]]);
    // Non-null assertion is safe: `empIds` above has exactly one id, so the
    // returned array always has exactly one element at index 0.
    const row = buildOnboardingSummaryRows(["emp-1"], empMap, deptMap, tasks, TODAY)[0]!;
    expect(row.stepsCompleted).toBe("1/3");
    expect(row.totalSteps).toBe("3");
    // The historical bug: apps/web's page.tsx did Number(row.stepsCompleted),
    // and Number("1/3") is NaN. Assert the shape a caller can safely parse
    // (split on "/"), not just that it happens to look right.
    expect(Number(row.stepsCompleted.split("/")[0])).toBe(1);
  });

  it("GAP-HR-ONBOARDING-04: resolves a known department to its real name", () => {
    const empMap = new Map([["emp-1", emp({ id: "emp-1", departmentId: "dept-1" })]]);
    const deptMap = new Map([["dept-1", "Finance"]]);
    const tasks = new Map([["emp-1", [task()]]]);
    const row = buildOnboardingSummaryRows(["emp-1"], empMap, deptMap, tasks, TODAY)[0]!;
    expect(row.department).toBe("Finance");
    expect(row.joiningDate).toBe("2026-08-01");
  });

  it("GAP-HR-ONBOARDING-04: never leaks the raw department uuid or a placeholder string that would format as an invalid date -- null instead", () => {
    const empMap = new Map([["emp-1", emp({ id: "emp-1", departmentId: "dept-missing", dateOfJoining: null })]]);
    const deptMap = new Map<string, string>(); // "dept-missing" is not in the map
    const tasks = new Map([["emp-1", [task()]]]);
    const row = buildOnboardingSummaryRows(["emp-1"], empMap, deptMap, tasks, TODAY)[0]!;
    expect(row.department).toBeNull();
    expect(row.joiningDate).toBeNull();
  });

  it("marks an employee overdue once a pending task's due date (joining date + dueByDay) has passed", () => {
    const empMap = new Map([["emp-1", emp({ id: "emp-1", dateOfJoining: "2026-09-01" })]]);
    const deptMap = new Map([["dept-1", "Finance"]]);
    // Due 2026-09-04 (dueByDay 3 from 2026-09-01) -- before TODAY (2026-09-30).
    const tasks = new Map([["emp-1", [task({ dueByDay: 3 })]]]);
    const row = buildOnboardingSummaryRows(["emp-1"], empMap, deptMap, tasks, TODAY)[0]!;
    expect(row.status).toBe("overdue");
    expect(row.overdue).toBe(1);
  });

  it("is completed only when every task is completed", () => {
    const empMap = new Map([["emp-1", emp({ id: "emp-1" })]]);
    const deptMap = new Map([["dept-1", "Finance"]]);
    const tasks = new Map([["emp-1", [task({ status: "completed" }), task({ status: "completed" })]]]);
    const row = buildOnboardingSummaryRows(["emp-1"], empMap, deptMap, tasks, TODAY)[0]!;
    expect(row.status).toBe("completed");
    expect(row.progress).toBe("100%");
  });
});

describe("countOnboardingRows / filterOnboardingRows", () => {
  const ROWS = [
    { id: "e1", status: "overdue" as const },
    { id: "e2", status: "in_progress" as const },
    { id: "e3", status: "completed" as const },
    { id: "e4", status: "completed" as const },
  ].map((r) => ({
    ...r,
    employee: "x", employeeNo: "x", department: null, joiningDate: null,
    stepsCompleted: "0/1", totalSteps: "1", overdue: r.status === "overdue" ? 1 : 0, progress: "0%",
  }));

  it("GAP-HR-ONBOARDING-05: counts are tenant-wide over every row, unaffected by which status is later filtered to", () => {
    const counts = countOnboardingRows(ROWS);
    expect(counts).toEqual({ total: 4, inProgress: 1, overdue: 1, completed: 2 });
  });

  it("'active' (the default) excludes completed joinees but keeps overdue and in_progress", () => {
    const filtered = filterOnboardingRows(ROWS, "active");
    expect(filtered.map((r) => r.id).sort()).toEqual(["e1", "e2"]);
  });

  it("'all' returns every row, including completed", () => {
    expect(filterOnboardingRows(ROWS, "all")).toHaveLength(4);
  });

  it("a specific status returns only rows in that status", () => {
    expect(filterOnboardingRows(ROWS, "completed").map((r) => r.id).sort()).toEqual(["e3", "e4"]);
    expect(filterOnboardingRows(ROWS, "overdue").map((r) => r.id)).toEqual(["e1"]);
  });
});
