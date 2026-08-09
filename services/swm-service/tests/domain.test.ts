import { describe, it, expect } from "vitest";
import { validateComplaintTransition } from "../src/modules/complaints/domain.js";
import { validateCollectionTransition, validateTaskTransition } from "../src/modules/collection/domain.js";
import { validateGeneratorTransition } from "../src/modules/bulk_generators/domain.js";
import { validateHotspotTransition, calculateRiskScore } from "../src/modules/analytics/domain.js";

describe("swm-service domain", () => {
  it("allows reported → assigned complaint", () => {
    expect(validateComplaintTransition("reported", "assigned")).toBeNull();
  });
  it("rejects closed → assigned complaint", () => {
    expect(validateComplaintTransition("closed", "assigned")).toMatch(/invalid transition/);
  });
  it("allows scheduled → collected", () => {
    expect(validateCollectionTransition("scheduled", "collected")).toBeNull();
  });
  it("allows assigned → in_progress task", () => {
    expect(validateTaskTransition("assigned", "in_progress")).toBeNull();
  });
  it("allows registered → active generator", () => {
    expect(validateGeneratorTransition("registered", "active")).toBeNull();
  });
  it("allows identified → action_planned hotspot", () => {
    expect(validateHotspotTransition("identified", "action_planned")).toBeNull();
  });
  it("calculates high risk score", () => {
    expect(calculateRiskScore(20)).toBe(100);
  });
  it("calculates low risk score", () => {
    expect(calculateRiskScore(1)).toBe(10);
  });
});