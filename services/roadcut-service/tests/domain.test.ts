import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  calculateDepositMinor,
  generateApplicationNumber,
} from "../src/modules/applications/domain.js";
import { canExtend, generatePermitNumber } from "../src/modules/permits/domain.js";
import { canComplete as canCompleteInspection } from "../src/modules/inspections/domain.js";
import { calculateRefundMinor } from "../src/modules/restoration/domain.js";

describe("roadcut-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects draft → approved", () => {
    expect(canTransition("draft", "approved")).toBe(false);
  });
  it("calculates arterial road fee", () => {
    const fee = calculateFeeMinor({ roadType: "arterial", cuttingLength: 2, cuttingWidth: 1 });
    expect(fee).toBe(500000n);
  });
  it("calculates deposit for collector road", () => {
    const deposit = calculateDepositMinor({ roadType: "collector", cuttingLength: 2, cuttingWidth: 1 });
    expect(deposit).toBe(600000n);
  });
  it("generates application number", () => {
    expect(generateApplicationNumber("DEL", 8)).toMatch(/^ROADCUT\/DEL\/\d{4}\/000008$/);
  });
  it("allows extension on active permit", () => {
    expect(canExtend("active")).toBe(true);
  });
  it("generates permit number", () => {
    expect(generatePermitNumber("MUM", 2)).toMatch(/^RCP\/MUM\/\d{4}\/000002$/);
  });
  it("allows completing scheduled inspection", () => {
    expect(canCompleteInspection("scheduled")).toBe(true);
  });
  it("refunds full deposit for satisfactory restoration", () => {
    expect(calculateRefundMinor(1000000n, "satisfactory")).toBe(1000000n);
  });
  it("forfeits deposit for unsatisfactory restoration", () => {
    expect(calculateRefundMinor(1000000n, "unsatisfactory")).toBe(0n);
  });
});