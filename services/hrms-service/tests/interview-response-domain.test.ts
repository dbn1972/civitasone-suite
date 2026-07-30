/**
 * R-RA-0143 — candidate interview response domain (pure).
 */
import { describe, it, expect } from "vitest";
import {
  validateResponse, initialStatus, isDecidable, RESPONSE_STATUSES,
} from "../src/modules/recruitment/interview-response.js";

describe("validateResponse", () => {
  it("accepts a bare confirm", () => {
    expect(validateResponse({ type: "confirm" })).toEqual([]);
  });
  it("requires preferred slot + reason for a reschedule request", () => {
    const e = validateResponse({ type: "reschedule_request" });
    expect(e.some((x) => x.includes("preferredDate and preferredTime"))).toBe(true);
    expect(e.some((x) => x.includes("reason"))).toBe(true);
  });
  it("rejects an invalid preferred date", () => {
    const e = validateResponse({ type: "reschedule_request", preferredDate: "2026-13-40", preferredTime: "09:30", reason: "clash" }, Date.parse("2026-01-01T00:00:00Z"));
    expect(e.some((x) => x.includes("preferredDate"))).toBe(true);
  });
  it("rejects an invalid preferred time", () => {
    const e = validateResponse({ type: "reschedule_request", preferredDate: "2035-08-20", preferredTime: "99:99", reason: "clash" }, Date.parse("2026-01-01T00:00:00Z"));
    expect(e.some((x) => x.includes("preferredTime"))).toBe(true);
  });
  it("accepts a valid future reschedule request", () => {
    const now = Date.parse("2026-08-01T00:00:00Z");
    expect(validateResponse({ type: "reschedule_request", preferredDate: "2026-08-20", preferredTime: "09:30", reason: "exam clash" }, now)).toEqual([]);
  });
  it("rejects a past preferred slot", () => {
    const now = Date.parse("2026-08-25T00:00:00Z");
    const e = validateResponse({ type: "reschedule_request", preferredDate: "2026-08-20", preferredTime: "09:30", reason: "clash" }, now);
    expect(e.some((x) => x.includes("future"))).toBe(true);
  });
});

describe("initialStatus", () => {
  it("confirm is terminal-confirmed, reschedule starts pending", () => {
    expect(initialStatus("confirm")).toBe("confirmed");
    expect(initialStatus("reschedule_request")).toBe("pending");
  });
});

describe("isDecidable", () => {
  it("only pending is decidable", () => {
    expect(isDecidable("pending")).toBe(true);
    for (const s of RESPONSE_STATUSES.filter((x) => x !== "pending")) expect(isDecidable(s)).toBe(false);
  });
});
