import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateApplicationNumber,
} from "../src/modules/applications/domain.js";
import { validateFindings, canRecommend } from "../src/modules/inspections/domain.js";
import { generateNocNumber, isExpired, calculateValidUntil } from "../src/modules/nocs/domain.js";
import { calculateRenewalFee, canRequestRenewal } from "../src/modules/lifecycle/domain.js";

describe("fire-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects draft → approved", () => {
    expect(canTransition("draft", "approved")).toBe(false);
  });
  it("calculates commercial occupancy fee", () => {
    expect(calculateFeeMinor("commercial", 1000)).toBeGreaterThan(250000n);
  });
  it("generates application number", () => {
    expect(generateApplicationNumber("DEL", 2026, 5)).toBe("FIRE/DEL/2026/000005");
  });
  it("validates inspection findings shape", () => {
    expect(validateFindings([{ description: "extinguisher ok" }])).toBe(true);
    expect(validateFindings(null)).toBe(false);
  });
  it("allows recommendation after completed inspection", () => {
    expect(canRecommend("completed")).toBe(true);
    expect(canRecommend("scheduled")).toBe(false);
  });
  it("generates NOC number", () => {
    expect(generateNocNumber("MUM", 2026, 1)).toBe("FNOC/MUM/2026/000001");
  });
  it("detects expired NOC", () => {
    expect(isExpired("2020-01-01")).toBe(true);
  });
  it("calculates NOC validity", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(calculateValidUntil(from, 3).getFullYear()).toBe(2029);
  });
  it("calculates renewal fee", () => {
    expect(calculateRenewalFee("amendment")).toBe(75000n);
  });
  it("blocks renewal for revoked NOC", () => {
    expect(canRequestRenewal("revoked", "2030-01-01")).toBe(false);
  });
});