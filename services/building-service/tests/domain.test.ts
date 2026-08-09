import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateApplicationNumber,
  computeFAR,
} from "../src/modules/applications/domain.js";
import { canPerformAction, generatePermitNumber } from "../src/modules/permits/domain.js";
import { calculateRenewalFeeMinor, canRequestRenewal } from "../src/modules/lifecycle/domain.js";
import { validateDcrResults, canDecide } from "../src/modules/scrutiny/domain.js";

describe("building-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects draft → approved", () => {
    expect(canTransition("draft", "approved")).toBe(false);
  });
  it("calculates fee with floor surcharge", () => {
    expect(calculateFeeMinor({ proposedFloors: 4 })).toBe(900000n);
  });
  it("computes FAR ratio", () => {
    expect(computeFAR(1500, 500)).toBe(3);
  });
  it("returns zero FAR for invalid plot", () => {
    expect(computeFAR(100, 0)).toBe(0);
  });
  it("generates building application number", () => {
    expect(generateApplicationNumber("PNQ", 9)).toMatch(/^BLDG\/PNQ\/\d{4}\/000009$/);
  });
  it("allows permit suspension", () => {
    expect(canPerformAction("active", "suspended")).toBe(true);
  });
  it("generates permit number", () => {
    expect(generatePermitNumber("DEL", 1)).toMatch(/^PERM\/BLDG\/DEL\/\d{4}\/000001$/);
  });
  it("calculates extension renewal fee", () => {
    expect(calculateRenewalFeeMinor("extension")).toBe(150000n);
  });
  it("allows renewal on active permit", () => {
    expect(canRequestRenewal("active")).toBe(true);
  });
  it("validates DCR results before decision", () => {
    expect(
      validateDcrResults([
        {
          checkName: "setback",
          parameter: "front",
          allowedValue: "3m",
          actualValue: "3m",
          result: "pass",
        },
      ]).allPassed,
    ).toBe(true);
    expect(canDecide("under_scrutiny")).toBe(true);
  });
});