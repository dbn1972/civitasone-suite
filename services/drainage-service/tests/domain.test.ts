import { describe, it, expect } from "vitest";
import { validateComplaintTransition, classifySeverity } from "../src/modules/complaints/domain.js";
import { validateHotspotTransition, calculateRiskScore } from "../src/modules/hotspots/domain.js";
import { isValidActionType } from "../src/modules/field_actions/domain.js";

describe("drainage-service domain", () => {
  it("allows reported → assigned complaint", () => {
    expect(validateComplaintTransition("reported", "assigned")).toBeNull();
  });
  it("rejects closed → assigned complaint", () => {
    expect(validateComplaintTransition("closed", "assigned")).toMatch(/invalid transition/);
  });
  it("classifies structural damage as critical", () => {
    expect(classifySeverity("structural_damage")).toBe("critical");
  });
  it("classifies blocked drain as medium", () => {
    expect(classifySeverity("blocked_drain")).toBe("medium");
  });
  it("allows identified → action_planned hotspot", () => {
    expect(validateHotspotTransition("identified", "action_planned")).toBeNull();
  });
  it("calculates risk with recency", () => {
    expect(calculateRiskScore(15, 1)).toBeGreaterThan(calculateRiskScore(15, 30));
  });
  it("validates desilting action type", () => {
    expect(isValidActionType("desilting")).toBe(true);
  });
  it("rejects unknown action type", () => {
    expect(isValidActionType("unknown")).toBe(false);
  });
});