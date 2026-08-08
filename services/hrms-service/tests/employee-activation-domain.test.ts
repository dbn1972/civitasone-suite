/**
 * HRMS Employee — activation gate mandatory conditions tests.
 * Pack #03. Source: modules/employee/activation-domain.ts
 */
import { describe, it, expect } from "vitest";
import { checkMandatoryConditions, type ActivationCandidate } from "../src/modules/employee/activation-domain.js";

const VALID_CANDIDATE: ActivationCandidate = {
  id: "emp-001", fullName: "John Doe", fitnessStatus: "fit",
  departmentId: "dept-001", designationId: "des-001",
  dateOfJoining: "2026-04-01", bankAccountNo: "123456789",
  pan: "ABCDE1234F", employeeType: "regular",
};

describe("checkMandatoryConditions", () => {
  it("canActivate when all conditions met", () => {
    const result = checkMandatoryConditions(VALID_CANDIDATE);
    expect(result.canActivate).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails on missing fitnessStatus (pending)", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, fitnessStatus: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some(f => f.field === "fitnessStatus")).toBe(true);
  });

  it("passes with fitnessStatus = exempt", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, fitnessStatus: "exempt" });
    expect(result.canActivate).toBe(true);
  });

  it("fails on missing departmentId", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, departmentId: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some(f => f.field === "departmentId")).toBe(true);
  });

  it("fails on missing designationId", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, designationId: null });
    expect(result.canActivate).toBe(false);
  });

  it("fails on missing dateOfJoining", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, dateOfJoining: null });
    expect(result.canActivate).toBe(false);
  });

  it("fails on missing bankAccountNo for regular employee", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, bankAccountNo: null });
    expect(result.canActivate).toBe(false);
    expect(result.failures.some(f => f.field === "bankAccountNo")).toBe(true);
  });

  it("consultant exempt from bank account", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, bankAccountNo: null, employeeType: "consultant" });
    expect(result.failures.some(f => f.field === "bankAccountNo")).toBe(false);
  });

  it("apprentice exempt from bank account", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, bankAccountNo: null, employeeType: "apprentice" });
    expect(result.failures.some(f => f.field === "bankAccountNo")).toBe(false);
  });

  it("accumulates all failures (not short-circuit)", () => {
    const result = checkMandatoryConditions({ ...VALID_CANDIDATE, departmentId: null, designationId: null, dateOfJoining: null });
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });

  it("checks mandatory documents when provided", () => {
    const result = checkMandatoryConditions(VALID_CANDIDATE, ["id_proof", "address_proof"], ["id_proof"]);
    expect(result.canActivate).toBe(false);
    expect(result.failures.some(f => f.field === "document:address_proof")).toBe(true);
  });
});
