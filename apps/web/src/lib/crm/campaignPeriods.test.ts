import { describe, it, expect } from "vitest";
import { buildPerformanceBody, CampaignPeriodValidationError } from "./campaignPeriods";

describe("buildPerformanceBody (GAP-CRM-CAMPAIGNS-DETAIL-04)", () => {
  it("converts rupees to paise strings (1500.50 -> 150050)", () => {
    const body = buildPerformanceBody({
      periodStart: "2026-01-01",
      costRupees: "1500.50",
      revenueRupees: "2000",
      responses: 10,
    });
    expect(body.costMinor).toBe("150050");
    expect(body.revenueMinor).toBe("200000");
    expect(body.responses).toBe(10);
    expect(body.currency).toBe("INR");
    expect(body.periodStart).toBe("2026-01-01");
    expect("periodEnd" in body).toBe(false);
  });

  it("allows zero cost/revenue (a period may have no spend yet)", () => {
    const body = buildPerformanceBody({
      periodStart: "2026-01-01",
      costRupees: "0",
      revenueRupees: "0",
      responses: 0,
    });
    expect(body.costMinor).toBe("0");
    expect(body.revenueMinor).toBe("0");
  });

  it("uppercases the currency and forwards a valid periodEnd", () => {
    const body = buildPerformanceBody({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      costRupees: "100",
      revenueRupees: "100",
      responses: 1,
      currency: "usd",
    });
    expect(body.currency).toBe("USD");
    expect(body.periodEnd).toBe("2026-01-31");
  });

  it("rejects a periodEnd before periodStart", () => {
    expect(() =>
      buildPerformanceBody({
        periodStart: "2026-02-01",
        periodEnd: "2026-01-01",
        costRupees: "1",
        revenueRupees: "1",
        responses: 0,
      }),
    ).toThrow(CampaignPeriodValidationError);
  });

  it("rejects a cost with more than two decimal places", () => {
    expect(() =>
      buildPerformanceBody({
        periodStart: "2026-01-01",
        costRupees: "1.005",
        revenueRupees: "1",
        responses: 0,
      }),
    ).toThrow(CampaignPeriodValidationError);
  });

  it("rejects a missing/invalid period start", () => {
    expect(() =>
      buildPerformanceBody({
        periodStart: "",
        costRupees: "1",
        revenueRupees: "1",
        responses: 0,
      }),
    ).toThrow(CampaignPeriodValidationError);
  });

  it("rejects fractional responses", () => {
    expect(() =>
      buildPerformanceBody({
        periodStart: "2026-01-01",
        costRupees: "1",
        revenueRupees: "1",
        responses: 1.5,
      }),
    ).toThrow(CampaignPeriodValidationError);
  });
});
