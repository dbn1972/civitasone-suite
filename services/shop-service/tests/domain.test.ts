import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateApplicationNumber,
} from "../src/modules/registrations/domain.js";
import { canPerformAction, isExpired, calculateValidUntil } from "../src/modules/permits/domain.js";
import { calculateRenewalFeeMinor, canRequestRenewal } from "../src/modules/lifecycle/domain.js";
import { validateScrutinyComplete, canDecide } from "../src/modules/approvals/domain.js";

describe("shop-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects draft → approved", () => {
    expect(canTransition("draft", "approved")).toBe(false);
  });
  it("calculates factory fee in paise", () => {
    const fee = calculateFeeMinor({ establishmentType: "factory", activityCategory: "manufacturing" });
    expect(fee).toBe(500000n);
  });
  it("adds employee surcharge above 20", () => {
    const fee = calculateFeeMinor({ establishmentType: "shop", activityCategory: "retail", employeeCount: 25 });
    expect(fee).toBe(105000n);
  });
  it("generates application number", () => {
    expect(generateApplicationNumber("DEL", 7)).toMatch(/^SHOP\/DEL\/\d{4}\/000007$/);
  });
  it("allows active → suspended permit action", () => {
    expect(canPerformAction("active", "suspended")).toBe(true);
  });
  it("detects expired permit", () => {
    expect(isExpired(new Date("2020-01-01"))).toBe(true);
  });
  it("calculates renewal fee for duplicate", () => {
    expect(calculateRenewalFeeMinor("duplicate")).toBe(25000n);
  });
  it("blocks renewal on cancelled permit", () => {
    expect(canRequestRenewal("cancelled", "renewal")).toBe(false);
  });
  it("requires scrutiny before decision", () => {
    expect(canDecide("under_scrutiny")).toBe(true);
    expect(validateScrutinyComplete([{ checkItem: "document_check", result: "pass" }]).allPassed).toBe(true);
  });
});