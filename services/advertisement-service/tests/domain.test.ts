import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateApplicationNumber,
} from "../src/modules/applications/domain.js";
import { canDecide } from "../src/modules/approvals/domain.js";
import { isExpired, generatePermitNumber } from "../src/modules/permits/domain.js";
import {
  calculatePenaltyMinor,
  canIssueNotice,
  canImposePenalty,
  generateViolationNumber,
} from "../src/modules/enforcement/domain.js";

describe("advertisement-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects approved → submitted", () => {
    expect(canTransition("approved", "submitted")).toBe(false);
  });
  it("applies minimum hoarding fee", () => {
    const fee = calculateFeeMinor({
      advertisementType: "hoarding",
      dimensions: { widthFt: 1, heightFt: 1, areaInSqFt: 1 },
    });
    expect(fee).toBe(500000n);
  });
  it("generates application number", () => {
    expect(generateApplicationNumber("MUM", 42)).toMatch(/^ADV\/MUM\/\d{4}\/000042$/);
  });
  it("allows decision under review", () => {
    expect(canDecide("under_review")).toBe(true);
  });
  it("detects expired permit", () => {
    expect(isExpired("2020-01-01")).toBe(true);
  });
  it("generates permit number", () => {
    expect(generatePermitNumber("DEL", 2)).toMatch(/^ADVP\/DEL\/\d{4}\/000002$/);
  });
  it("calculates unauthorized hoarding penalty", () => {
    expect(calculatePenaltyMinor("unauthorized_hoarding")).toBe(5000000n);
  });
  it("allows notice from reported status", () => {
    expect(canIssueNotice("reported")).toBe(true);
  });
  it("allows penalty after notice", () => {
    expect(canImposePenalty("notice_issued")).toBe(true);
  });
  it("generates violation number", () => {
    expect(generateViolationNumber("PNQ", 9)).toMatch(/^ADVV\/PNQ\/\d{4}\/000009$/);
  });
});