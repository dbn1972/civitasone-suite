import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateRegistrationNumber,
} from "../src/modules/registrations/domain.js";
import {
  canSuspend,
  canCancel,
  generateLicenceNumber,
  calculateLicenceFeeMinor,
} from "../src/modules/licences/domain.js";
import { calculateRenewalFeeMinor, canDecideLifecycle } from "../src/modules/lifecycle/domain.js";
import { canAllocateZone } from "../src/modules/committee/domain.js";

describe("vendor-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects draft → approved", () => {
    expect(canTransition("draft", "approved")).toBe(false);
  });
  it("calculates food vendor fee", () => {
    expect(calculateFeeMinor({ category: "food" })).toBe(100000n);
  });
  it("generates registration number", () => {
    expect(generateRegistrationNumber("DEL", 4)).toMatch(/^VEND\/DEL\/\d{4}\/000004$/);
  });
  it("allows suspend on active licence", () => {
    expect(canSuspend("active")).toBe(true);
  });
  it("blocks cancel on cancelled licence", () => {
    expect(canCancel("cancelled")).toBe(false);
  });
  it("generates licence number", () => {
    expect(generateLicenceNumber("MUM", 1)).toMatch(/^VLIC\/MUM\/\d{4}\/000001$/);
  });
  it("calculates licence fee by category", () => {
    expect(calculateLicenceFeeMinor("food")).toBeGreaterThan(0n);
  });
  it("calculates renewal fee", () => {
    expect(calculateRenewalFeeMinor("renewal")).toBeGreaterThan(0n);
  });
  it("allows lifecycle decision under review", () => {
    expect(canDecideLifecycle("under_review")).toBe(true);
  });
  it("allows zone allocation on approve recommendation", () => {
    expect(canAllocateZone("approve")).toBe(true);
  });
});