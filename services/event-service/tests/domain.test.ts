import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  calculateDepositMinor,
  generateApplicationNumber,
  determineRequiredNocs,
} from "../src/modules/applications/domain.js";
import { canRespond } from "../src/modules/nocs/domain.js";
import { canRevoke, generatePermitNumber } from "../src/modules/permits/domain.js";
import { canDecideDeposit } from "../src/modules/post_event/domain.js";

describe("event-service domain", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("rejects completed → submitted", () => {
    expect(canTransition("completed", "submitted")).toBe(false);
  });
  it("waives fee for government events", () => {
    expect(calculateFeeMinor({ eventType: "government", expectedAttendance: 100, soundPermission: false })).toBe(0n);
  });
  it("adds sound permission surcharge", () => {
    const fee = calculateFeeMinor({ eventType: "cultural", expectedAttendance: 100, soundPermission: true });
    expect(fee).toBe(700000n);
  });
  it("scales deposit with attendance", () => {
    expect(calculateDepositMinor({ eventType: "commercial", expectedAttendance: 1500, soundPermission: false })).toBe(5000000n);
  });
  it("generates application number", () => {
    expect(generateApplicationNumber("PNQ", 3)).toMatch(/^EVT\/PNQ\/\d{4}\/000003$/);
  });
  it("requires fire NOC for large crowds", () => {
    expect(determineRequiredNocs("cultural", 500, false)).toContain("fire");
  });
  it("allows NOC response when requested", () => {
    expect(canRespond("requested")).toBe(true);
  });
  it("allows revoke on active permit", () => {
    expect(canRevoke("active")).toBe(true);
  });
  it("generates permit number", () => {
    expect(generatePermitNumber("DEL", 1)).toMatch(/^EVTP\/DEL\/\d{4}\/000001$/);
  });
  it("allows deposit decision when unset", () => {
    expect(canDecideDeposit({ depositDecision: null })).toBe(true);
  });
});