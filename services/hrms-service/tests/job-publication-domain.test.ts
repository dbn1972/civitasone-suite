/**
 * Job publication domain — the application-open gate (status + published +
 * deadline) and closed reasons.
 */
import { describe, it, expect } from "vitest";
import { isApplicationOpen, applicationClosedReason } from "../src/modules/recruitment/job-publication.js";

const NOW = Date.parse("2026-08-15T10:00:00Z");

describe("isApplicationOpen (R-RA-0069)", () => {
  it("open + published + no deadline -> open", () => {
    expect(isApplicationOpen({ status: "open", isPublished: "true" }, NOW)).toBe(true);
  });
  it("open + published + future deadline -> open; past deadline -> closed", () => {
    expect(isApplicationOpen({ status: "open", isPublished: "true", applicationDeadline: "2026-08-31T23:59:59Z" }, NOW)).toBe(true);
    expect(isApplicationOpen({ status: "open", isPublished: "true", applicationDeadline: "2026-08-01T00:00:00Z" }, NOW)).toBe(false);
  });
  it("closed / cancelled / unpublished -> not open", () => {
    expect(isApplicationOpen({ status: "closed", isPublished: "true" }, NOW)).toBe(false);
    expect(isApplicationOpen({ status: "cancelled", isPublished: "true" }, NOW)).toBe(false);
    expect(isApplicationOpen({ status: "open", isPublished: "false" }, NOW)).toBe(false);
  });
  it("accepts a Date deadline as well as an ISO string", () => {
    expect(isApplicationOpen({ status: "open", isPublished: "true", applicationDeadline: new Date("2026-08-01T00:00:00Z") }, NOW)).toBe(false);
  });
});

describe("applicationClosedReason", () => {
  it("gives a specific reason", () => {
    expect(applicationClosedReason({ status: "cancelled", isPublished: "true" }, NOW)).toMatch(/cancelled/);
    expect(applicationClosedReason({ status: "open", isPublished: "true", applicationDeadline: "2026-08-01T00:00:00Z" }, NOW)).toMatch(/deadline has passed/);
    expect(applicationClosedReason({ status: "closed", isPublished: "true" }, NOW)).toMatch(/not accepting/);
  });
});
