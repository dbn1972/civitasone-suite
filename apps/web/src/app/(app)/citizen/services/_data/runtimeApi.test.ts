import { describe, expect, it } from "vitest";
import {
  buildDemandLines,
  buildTrackingTimeline,
  formatExpectedByDate,
  formatFeeExact,
  journeyStepsForService,
  trackingLaneIndex,
} from "./runtimeApi";

describe("formatFeeExact", () => {
  it("formats paise as rupees", () => {
    expect(formatFeeExact(50000, "INR")).toBe("₹500");
  });

  it("handles missing fee", () => {
    expect(formatFeeExact(null, "INR")).toBe("Calculated on approval");
  });
});

describe("formatExpectedByDate", () => {
  it("skips weekends when projecting SLA", () => {
    // Friday 7 Aug 2026 → 1 working day → Monday 10 Aug 2026
    const friday = new Date("2026-08-07T10:00:00Z");
    expect(formatExpectedByDate(1, friday)).toBe("10 Aug 2026");
  });

  it("returns null when SLA missing", () => {
    expect(formatExpectedByDate(null)).toBeNull();
  });
});

describe("journeyStepsForService", () => {
  it("omits fee when service has no fee", () => {
    expect(journeyStepsForService(false).map((s) => s.id)).toEqual(["form", "review", "submitted"]);
  });

  it("keeps fee when present", () => {
    expect(journeyStepsForService(true).map((s) => s.id)).toEqual(["form", "review", "fee", "submitted"]);
  });
});

describe("trackingLaneIndex", () => {
  it("maps statuses to lane indices", () => {
    expect(trackingLaneIndex("submitted", true)).toBe(0);
    expect(trackingLaneIndex("under_review", true)).toBe(1);
    expect(trackingLaneIndex("payment_due", true)).toBe(2);
    expect(trackingLaneIndex("issued", true)).toBe(3);
    expect(trackingLaneIndex("issued", false)).toBe(2);
  });
});

describe("buildTrackingTimeline", () => {
  it("builds certificate timeline with fee lane", () => {
    const steps = buildTrackingTimeline({
      status: "submitted",
      servicePattern: "certificate",
      acknowledgedAt: "2026-08-01T00:00:00.000Z",
      slaDays: 12,
      hasFee: true,
    });
    expect(steps.map((s) => s.id)).toEqual(["submitted", "review", "fee", "issued"]);
    expect(steps[0].state).toBe("current");
    expect(steps[0].date).toMatch(/2026/);
    expect(steps[0].slaDaysRemaining).toBeTypeOf("number");
  });

  it("omits fee for grievance and uses Resolved", () => {
    const steps = buildTrackingTimeline({
      status: "assigned",
      servicePattern: "grievance",
      hasFee: false,
    });
    expect(steps.map((s) => s.label)).toEqual(["Submitted", "Assigned", "Resolved"]);
    expect(steps[1].state).toBe("current");
  });

  it("marks all done when issued", () => {
    const steps = buildTrackingTimeline({ status: "issued", hasFee: true });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("advances past fee after payment", () => {
    const steps = buildTrackingTimeline({ status: "paid", hasFee: true });
    expect(steps.find((s) => s.id === "fee")?.state).toBe("done");
    expect(steps.find((s) => s.id === "issued")?.state).toBe("current");
  });
});

describe("buildDemandLines", () => {
  it("returns a single application fee line", () => {
    const lines = buildDemandLines({
      name: "Trade License",
      feeFromMinor: 100000,
      feeCurrency: "INR",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amountLabel).toBe("₹1,000");
    expect(lines[0].label).toContain("Trade License");
  });
});
