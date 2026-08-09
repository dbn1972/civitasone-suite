import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateApplicationNumber,
} from "../src/modules/applications/domain.js";
import { canPerformAction, generateLicenceNumber } from "../src/modules/licences/domain.js";
import { calculateRenewalFeeMinor, canRequestRenewal } from "../src/modules/lifecycle/domain.js";
import { canDecide } from "../src/modules/approvals/domain.js";

describe("trade-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects approved → submitted", () => {
    expect(canTransition("approved", "submitted")).toBe(false);
  });
  it("calculates manufacturing fee", () => {
    expect(calculateFeeMinor({ tradeCategory: "manufacturing" })).toBe(500000n);
  });
  it("adds area surcharge above 500 sqft", () => {
    expect(calculateFeeMinor({ tradeCategory: "retail", areaInSqft: 700 })).toBe(110000n);
  });
  it("generates trade application number", () => {
    expect(generateApplicationNumber("MUM", 12)).toMatch(/^TRADE\/MUM\/\d{4}\/000012$/);
  });
  it("allows licence suspension from active", () => {
    expect(canPerformAction("active", "suspended")).toBe(true);
  });
  it("generates licence number", () => {
    expect(generateLicenceNumber("BLR", 3)).toMatch(/^LIC\/TRADE\/BLR\/\d{4}\/000003$/);
  });
  it("calculates surrender renewal fee", () => {
    expect(calculateRenewalFeeMinor("surrender")).toBe(0n);
  });
  it("allows renewal on active licence", () => {
    expect(canRequestRenewal("active", "renewal")).toBe(true);
  });
  it("allows decision during scrutiny", () => {
    expect(canDecide("under_scrutiny")).toBe(true);
  });
});