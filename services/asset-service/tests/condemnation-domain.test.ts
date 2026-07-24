/**
 * Condemnation domain tests — pure business logic (SVC-060).
 * Validates: maker-checker, bid floor, condemnable condition, retirement date.
 */
import { describe, it, expect } from "vitest";
import {
  assertMakerChecker, assertBidMeetsFloor, isCondemnableCondition,
  computeRetirementDate, DomainError,
} from "../src/modules/condemnation/domain.js";

describe("Condemnation — maker-checker enforcement (GFR Rule 196)", () => {
  it("throws when approver = creator", () => {
    const same = "cccc0000-0000-4000-8000-000000000001";
    expect(() => assertMakerChecker(same, same)).toThrow(DomainError);
    expect(() => assertMakerChecker(same, same)).toThrow("recommendation approver cannot be the same as creator");
  });
  it("passes when approver ≠ creator", () => {
    expect(() => assertMakerChecker(
      "cccc0000-0000-4000-8000-000000000001",
      "dddd0000-0000-4000-8000-000000000002",
    )).not.toThrow();
  });
});

describe("Condemnation — auction bid floor validation", () => {
  it("passes when bid >= floor", () => {
    expect(() => assertBidMeetsFloor(500000n, 300000n)).not.toThrow();
  });
  it("passes when bid == floor", () => {
    expect(() => assertBidMeetsFloor(300000n, 300000n)).not.toThrow();
  });
  it("throws when bid < floor", () => {
    expect(() => assertBidMeetsFloor(200000n, 300000n)).toThrow(DomainError);
    expect(() => assertBidMeetsFloor(200000n, 300000n)).toThrow("bid 200000 is below floor value 300000");
  });
});

describe("Condemnation — condemnable condition check", () => {
  it("unserviceable is condemnable", () => {
    expect(isCondemnableCondition("unserviceable")).toBe(true);
  });
  it("beyond_repair is condemnable", () => {
    expect(isCondemnableCondition("beyond_repair")).toBe(true);
  });
  it("poor is NOT condemnable (needs further assessment)", () => {
    expect(isCondemnableCondition("poor")).toBe(false);
  });
  it("good is NOT condemnable", () => {
    expect(isCondemnableCondition("good")).toBe(false);
  });
});

describe("Condemnation — retirement date computation", () => {
  it("returns ISO date string from Date object", () => {
    const date = new Date("2026-07-15T10:30:00Z");
    expect(computeRetirementDate(date)).toBe("2026-07-15");
  });
});
