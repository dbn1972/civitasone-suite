import { describe, it, expect } from "vitest";
import {
  computeScorecard, ratingBand, classifyPerformanceEvent,
  assertShowCauseTransition, assertDistinctIssuerDecider, ScorecardDomainError,
} from "../src/modules/vendor/scorecard-domain.js";

describe("SVC-049 scorecard domain — objective rating", () => {
  it("is unrated with no orders", () => {
    const sc = computeScorecard({ grnAccepted: 0, grnRejected: 0, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 0 });
    expect(sc.ratingBand).toBe("unrated");
    expect(sc.overallRating).toBe(0);
  });

  it("perfect record → band A", () => {
    const sc = computeScorecard({ grnAccepted: 10, grnRejected: 0, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 0 });
    expect(sc.deliveryScore).toBe(100);
    expect(sc.qualityScore).toBe(100);
    expect(sc.slaScore).toBe(100);
    expect(sc.overallRating).toBe(100);
    expect(sc.ratingBand).toBe("A");
  });

  it("penalises quality rejections", () => {
    const sc = computeScorecard({ grnAccepted: 6, grnRejected: 4, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 0 });
    expect(sc.totalOrders).toBe(10);
    expect(sc.qualityRejections).toBe(4);
    expect(sc.qualityScore).toBe(60); // (10-4)/10
    expect(sc.deliveryScore).toBe(60); // 6 accepted on-time / 10
  });

  it("penalises late deliveries in the delivery score", () => {
    const sc = computeScorecard({ grnAccepted: 10, grnRejected: 0, deliveryLate: 3, deliveryOnTime: 0, slaBreach: 0 });
    expect(sc.lateDeliveries).toBe(3);
    expect(sc.onTimeDeliveries).toBe(7);
    expect(sc.deliveryScore).toBe(70);
  });

  it("penalises SLA breaches (20 pts each, floored at 0)", () => {
    expect(computeScorecard({ grnAccepted: 5, grnRejected: 0, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 2 }).slaScore).toBe(60);
    expect(computeScorecard({ grnAccepted: 5, grnRejected: 0, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 9 }).slaScore).toBe(0);
  });

  it("weights delivery 40 / quality 40 / sla 20", () => {
    const sc = computeScorecard({ grnAccepted: 8, grnRejected: 2, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 1 });
    // delivery=80, quality=80, sla=80 → 0.4*80+0.4*80+0.2*80 = 80
    expect(sc.overallRating).toBe(80);
    expect(sc.ratingBand).toBe("B");
  });

  it("maps bands at boundaries", () => {
    expect(ratingBand(10, 85)).toBe("A");
    expect(ratingBand(10, 70)).toBe("B");
    expect(ratingBand(10, 50)).toBe("C");
    expect(ratingBand(10, 49)).toBe("D");
    expect(ratingBand(0, 100)).toBe("unrated");
  });
});

describe("SVC-049 scorecard domain — event classification + show-cause", () => {
  it("classifies GRN and contract events", () => {
    expect(classifyPerformanceEvent("procurement.grn.accepted")).toEqual({ eventType: "grn_accepted", source: "grn" });
    expect(classifyPerformanceEvent("procurement.grn.rejected")).toEqual({ eventType: "grn_rejected", source: "grn" });
    expect(classifyPerformanceEvent("contract.contract.terminated")).toEqual({ eventType: "sla_breach", source: "contract" });
    expect(classifyPerformanceEvent("unknown.topic")).toBeNull();
  });

  it("enforces show-cause transitions", () => {
    expect(() => assertShowCauseTransition("issued", "responded")).not.toThrow();
    expect(() => assertShowCauseTransition("responded", "appealed")).not.toThrow();
    expect(() => assertShowCauseTransition("appealed", "upheld")).not.toThrow();
    expect(() => assertShowCauseTransition("issued", "upheld")).toThrow(ScorecardDomainError);
    expect(() => assertShowCauseTransition("closed", "responded")).toThrow();
  });

  it("rejects issuer === decider (maker-checker)", () => {
    expect(() => assertDistinctIssuerDecider("u1", "u1")).toThrow(/SOD_VIOLATION/);
    expect(() => assertDistinctIssuerDecider("u1", "u2")).not.toThrow();
  });
});
