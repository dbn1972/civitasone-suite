/**
 * GAP-HR-TRAINING-NOMINATIONS-02/03 and GAP-HR-TRAINING-FEEDBACK-02.
 *
 * Pure functions exported specifically so these row-shaping rules are
 * unit-tested directly rather than only indirectly via a full route/DB
 * integration test -- see rti/routes.test.ts's own doc comment for the
 * established rationale this mirrors.
 */
import { describe, it, expect } from "vitest";
import { projectNominationAdminRow, projectFeedbackRow } from "./routes.js";
import type { NominationRow } from "./schema.js";

function nomination(overrides: Partial<NominationRow> = {}): NominationRow {
  return {
    id: "nom-1",
    tenantId: "tenant-1",
    trainingId: "training-1",
    employeeId: "emp-1",
    status: "nominated",
    certificateRef: null,
    completedDate: null,
    score: null,
    result: null,
    nominatedBy: "actor-hr-1",
    approvedBy: null,
    sessionId: null,
    waitlistPosition: null,
    decidedAt: null,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    createdBy: "actor-hr-1",
    updatedBy: "actor-hr-1",
    version: 1,
    ...overrides,
  };
}

describe("projectNominationAdminRow — GAP-HR-TRAINING-NOMINATIONS-02/03", () => {
  const trainingMap = new Map([["training-1", { title: "Advanced Excel", fromDate: "2026-11-01" }]]);
  const employeeMap = new Map([["emp-1", { fullName: "Priya Sharma", departmentId: "dept-1" }]]);
  const deptMap = new Map([["dept-1", { name: "Finance" }]]);
  const nominatorNames = new Map([["actor-hr-1", "Anita Rao"]]);

  it("includes trainingId (needed by the Approve action's session lookup)", () => {
    const row = projectNominationAdminRow(nomination(), trainingMap, employeeMap, deptMap, nominatorNames);
    expect(row.trainingId).toBe("training-1");
  });

  it("resolves nominatedBy to a person's name, never the raw actor id", () => {
    const row = projectNominationAdminRow(nomination(), trainingMap, employeeMap, deptMap, nominatorNames);
    expect(row.nominatedBy).toBe("Anita Rao");
  });

  it("falls back to '—' when the nominator's actor id has no resolvable employee", () => {
    const row = projectNominationAdminRow(nomination({ nominatedBy: "actor-unknown" }), trainingMap, employeeMap, deptMap, nominatorNames);
    expect(row.nominatedBy).toBe("—");
  });

  it("falls back to '—' when nominatedBy is null", () => {
    const row = projectNominationAdminRow(nomination({ nominatedBy: null }), trainingMap, employeeMap, deptMap, nominatorNames);
    expect(row.nominatedBy).toBe("—");
  });

  it("resolves employee/department/program from the batch-loaded maps", () => {
    const row = projectNominationAdminRow(nomination(), trainingMap, employeeMap, deptMap, nominatorNames);
    expect(row.employee).toBe("Priya Sharma");
    expect(row.department).toBe("Finance");
    expect(row.program).toBe("Advanced Excel");
  });
});

describe("projectFeedbackRow — GAP-HR-TRAINING-FEEDBACK-02", () => {
  const trainingMap = new Map([["training-1", { title: "Advanced Excel" }]]);
  const employeeMap = new Map([["emp-1", { fullName: "Priya Sharma" }]]);

  it("passes through a real assessment score", () => {
    const row = projectFeedbackRow(nomination({ score: 80 }), trainingMap, employeeMap);
    expect(row.score).toBe(80);
  });

  it("keeps an unscored completion as null, never a fabricated 0", () => {
    const row = projectFeedbackRow(nomination({ score: null }), trainingMap, employeeMap);
    expect(row.score).toBeNull();
    expect(row.score).not.toBe(0);
  });

  it("prefers the recorded completedDate over updatedAt for submittedOn", () => {
    const row = projectFeedbackRow(
      nomination({ completedDate: "2026-09-15", updatedAt: new Date("2026-09-20T00:00:00Z") }),
      trainingMap,
      employeeMap,
    );
    expect(row.submittedOn).toBe("2026-09-15");
  });
});
