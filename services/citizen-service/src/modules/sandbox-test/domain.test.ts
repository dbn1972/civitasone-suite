import { describe, it, expect } from "vitest";
import { runSandboxPipeline } from "./domain.js";
import type { ServiceDefinitionRow } from "../catalogue/schema.js";

function baseDef(overrides: Partial<ServiceDefinitionRow> = {}): ServiceDefinitionRow {
  return {
    id: "def-1",
    tenantId: "tenant-1",
    serviceKey: "test-svc",
    serviceId: null,
    name: "Test Service",
    ownerDepartment: "Licensing",
    servicePattern: "certificate",
    ownerOfficeId: null,
    offeringOfficeIds: null,
    workflowDefinitionId: "wf-1",
    formId: "form-1",
    feeModel: "flat",
    hoaCode: "4201",
    statutoryReferences: [],
    version: 1,
    status: "draft",
    eligibilityRuleSetId: "elig-1",
    feeScheduleId: "fee-1",
    issuanceType: "certificate",
    requiredDocuments: [{ docType: "id", mandatory: true, verifiedAtLane: "inspection" }],
    laneBindings: [
      {
        key: "inspection",
        name: "Inspection",
        enabled: true,
        designationId: "pos-inspector",
        designationLabel: "Licensing Inspector",
        slaDays: 7,
        escalationDesignationId: "pos-officer",
        escalationDesignationLabel: "Licensing Officer",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "pos-officer",
        designationLabel: "Licensing Officer",
        slaDays: 5,
        escalationDesignationId: "pos-chief",
        escalationDesignationLabel: "Chief Licensing Officer",
      },
    ],
    slaDays: 15,
    channels: ["portal"],
    forms: [],
    outputs: [],
    submittedBy: null,
    publishedBy: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "user-1",
    updatedBy: "user-1",
    rowVersion: 1,
    ...overrides,
  };
}

describe("runSandboxPipeline (FN-10)", () => {
  it("passes a fully wired certificate service", () => {
    const result = runSandboxPipeline(baseDef());
    expect(result.passed).toBe(true);
    expect(result.steps.filter((s) => s.status === "fail")).toHaveLength(0);
  });

  it("fails when form is missing", () => {
    const result = runSandboxPipeline(baseDef({ formId: null, forms: [] }));
    expect(result.passed).toBe(false);
    const form = result.steps.find((s) => s.id === "form");
    expect(form?.status).toBe("fail");
    expect(form?.blockId).toBe("b2");
  });

  it("fails when HOA is missing on fee-bearing pattern", () => {
    const result = runSandboxPipeline(baseDef({ hoaCode: null }));
    expect(result.passed).toBe(false);
    expect(result.steps.find((s) => s.id === "demand")?.status).toBe("fail");
  });

  it("skips fee steps for grievance pattern", () => {
    const result = runSandboxPipeline(baseDef({
      servicePattern: "grievance",
      feeScheduleId: null,
      feeModel: null,
      hoaCode: null,
    }));
    expect(result.steps.find((s) => s.id === "demand")?.status).toBe("skip");
    expect(result.steps.find((s) => s.id === "payment")?.status).toBe("skip");
    expect(result.steps.find((s) => s.id === "gl")?.status).toBe("skip");
  });

  it("fails engine fee without binding", () => {
    const result = runSandboxPipeline(baseDef({ feeModel: "engine", outputs: [] }));
    expect(result.passed).toBe(false);
    expect(result.steps.find((s) => s.id === "demand")?.status).toBe("fail");
  });

  it("FN-25: passes SLA breach escalation when lanes have clocks + superiors", () => {
    const result = runSandboxPipeline(baseDef());
    const step = result.steps.find((s) => s.id === "sla_escalation");
    expect(step?.status).toBe("pass");
    const notes = (step?.artifacts as { breachedNotifications?: unknown[] })?.breachedNotifications;
    expect(notes?.length).toBeGreaterThan(0);
  });

  it("FN-25: fails when escalation designation is missing on a tracked lane", () => {
    const result = runSandboxPipeline(baseDef({
      laneBindings: [{
        key: "inspection", name: "Inspection", enabled: true, slaDays: 7, designationId: "pos-i",
      }],
    }));
    expect(result.steps.find((s) => s.id === "sla_escalation")?.status).toBe("fail");
  });

  it("FN-26: fails when a mandatory document has no verifying lane", () => {
    const result = runSandboxPipeline(baseDef({
      requiredDocuments: [{ docType: "id", mandatory: true }],
    }));
    expect(result.steps.find((s) => s.id === "doc_verification")?.status).toBe("fail");
  });
});
