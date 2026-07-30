/**
 * Domain unit tests for Agent 1 gap-closure features:
 * - 0180: activation mandatory-condition check
 * - 0230: cycle-detection on manager assignment
 */
import { describe, it, expect } from "vitest";
import { checkMandatoryConditions } from "../src/modules/employee/activation-domain.js";
import { wouldCreateCycle, validateManagerAssignment, type ManagerGraph } from "../src/modules/employee/manager-domain.js";

describe("0180 — checkMandatoryConditions (activation gate)", () => {
  const validCandidate = {
    id: "emp-1",
    fullName: "Test Employee",
    fitnessStatus: "fit",
    departmentId: "dept-1",
    designationId: "desig-1",
    dateOfJoining: "2026-01-15",
    bankAccountNo: "1234567890",
    pan: "ABCDE1234F",
    employeeType: "permanent",
  };

  it("passes when all mandatory conditions are met", () => {
    const result = checkMandatoryConditions(validCandidate);
    expect(result.canActivate).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("fails when fitnessStatus is pending", () => {
    const result = checkMandatoryConditions({ ...validCandidate, fitnessStatus: "pending" });
    expect(result.canActivate).toBe(false);
    expect(result.failures).toContainEqual(expect.objectContaining({ field: "fitnessStatus" }));
  });

  it("fails when fitnessStatus is unfit", () => {
    const result = checkMandatoryConditions({ ...validCandidate, fitnessStatus: "unfit" });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some((f) => f.field === "fitnessStatus")).toBe(true);
  });

  it("passes when fitnessStatus is exempt", () => {
    const result = checkMandatoryConditions({ ...validCandidate, fitnessStatus: "exempt" });
    expect(result.canActivate).toBe(true);
  });

  it("fails when departmentId is null", () => {
    const result = checkMandatoryConditions({ ...validCandidate, departmentId: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some((f) => f.field === "departmentId")).toBe(true);
  });

  it("fails when designationId is null", () => {
    const result = checkMandatoryConditions({ ...validCandidate, designationId: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some((f) => f.field === "designationId")).toBe(true);
  });

  it("fails when dateOfJoining is null", () => {
    const result = checkMandatoryConditions({ ...validCandidate, dateOfJoining: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some((f) => f.field === "dateOfJoining")).toBe(true);
  });

  it("fails when bankAccountNo is null for permanent employee", () => {
    const result = checkMandatoryConditions({ ...validCandidate, bankAccountNo: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some((f) => f.field === "bankAccountNo")).toBe(true);
  });

  it("passes when bankAccountNo is null for consultant", () => {
    const result = checkMandatoryConditions({ ...validCandidate, bankAccountNo: null, employeeType: "consultant" });
    expect(result.canActivate).toBe(true);
  });

  it("passes when bankAccountNo is null for apprentice", () => {
    const result = checkMandatoryConditions({ ...validCandidate, bankAccountNo: null, employeeType: "apprentice" });
    expect(result.canActivate).toBe(true);
  });

  it("reports multiple failures", () => {
    const result = checkMandatoryConditions({
      ...validCandidate,
      fitnessStatus: "unfit",
      departmentId: null,
      bankAccountNo: null,
    });
    expect(result.canActivate).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });

  it("checks mandatory documents when provided", () => {
    const result = checkMandatoryConditions(
      validCandidate,
      ["id_proof", "address_proof", "pan_card"],
      ["id_proof"],
    );
    expect(result.canActivate).toBe(false);
    expect(result.failures.some((f) => f.field === "document:address_proof")).toBe(true);
    expect(result.failures.some((f) => f.field === "document:pan_card")).toBe(true);
  });

  it("passes document check when all mandatory docs are uploaded", () => {
    const result = checkMandatoryConditions(
      validCandidate,
      ["id_proof", "pan_card"],
      ["id_proof", "pan_card", "photo"],
    );
    expect(result.canActivate).toBe(true);
  });
});

describe("0230 — wouldCreateCycle (manager cycle detection)", () => {
  // Graph: A→B→C→D (D is root)
  const graph: ManagerGraph = {
    edges: new Map([
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
      ["D", null],
      ["E", "D"],
    ]),
  };

  it("returns false for valid assignment (no cycle)", () => {
    // Assign E as manager of A: A→E→D — no cycle
    expect(wouldCreateCycle(graph, "A", "E")).toBe(false);
  });

  it("detects self-assignment as a cycle", () => {
    expect(wouldCreateCycle(graph, "A", "A")).toBe(true);
  });

  it("detects direct cycle (A→B, assigning A as manager of B)", () => {
    expect(wouldCreateCycle(graph, "B", "A")).toBe(true);
  });

  it("detects indirect cycle (A→B→C, assigning A as manager of C)", () => {
    expect(wouldCreateCycle(graph, "C", "A")).toBe(true);
  });

  it("detects long chain cycle", () => {
    // A→B→C→D. Assigning A as manager of D would make D→A→B→C→D
    expect(wouldCreateCycle(graph, "D", "A")).toBe(true);
  });

  it("allows assignment to root node", () => {
    // Assign D (root) as manager of A: A→D — no cycle
    expect(wouldCreateCycle(graph, "A", "D")).toBe(false);
  });

  it("allows assignment when new manager is not in the chain", () => {
    expect(wouldCreateCycle(graph, "A", "E")).toBe(false);
  });

  it("handles unknown nodes gracefully (stops at missing edge)", () => {
    expect(wouldCreateCycle(graph, "A", "UNKNOWN")).toBe(false);
  });

  it("respects maxDepth to avoid infinite loops on corrupt data", () => {
    // Create a cyclic graph (corrupt data)
    const corruptGraph: ManagerGraph = {
      edges: new Map([["X", "Y"], ["Y", "X"]]),
    };
    // Without maxDepth this would loop forever; with it, it stops
    // Note: since we start at "Z" checking if assigning "X" to "Z" creates a cycle,
    // Z is not in the corrupt cycle, so it returns false
    expect(wouldCreateCycle(corruptGraph, "Z", "X", 10)).toBe(false);
  });
});

describe("0230 — validateManagerAssignment (multi-field check)", () => {
  const graph: ManagerGraph = {
    edges: new Map([["A", "B"], ["B", "C"], ["C", null]]),
  };

  it("returns null when all assignments are safe", () => {
    const result = validateManagerAssignment(graph, "A", { managerId: "C", functionalManagerId: "C" });
    expect(result).toBeNull();
  });

  it("returns the first cyclic field", () => {
    const result = validateManagerAssignment(graph, "C", { managerId: "B", functionalManagerId: "A" });
    // B→C would create cycle C→B→C; A→B→C would also create C→A→B→C
    expect(result).not.toBeNull();
    expect(result!.field).toBe("managerId");
  });

  it("skips null managers", () => {
    const result = validateManagerAssignment(graph, "A", { managerId: null, functionalManagerId: null });
    expect(result).toBeNull();
  });
});
