import { describe, it, expect } from "vitest";
import type { CRMCampaignRoiPeriod, CRMCampaignRoiSummaryRow } from "@civitasone/types";
import {
  formatRoiPercent,
  orderPeriods,
  periodLabel,
  portfolioTotals,
  rankByNet,
  roiVerdict,
} from "./campaigns";

function summaryRow(overrides: Partial<CRMCampaignRoiSummaryRow> = {}): CRMCampaignRoiSummaryRow {
  return {
    campaignId: "11111111-1111-1111-1111-111111111111",
    currency: "INR",
    periods: 1,
    costMinor: "100000",
    revenueMinor: "150000",
    netMinor: "50000",
    responses: 10,
    roiBasisPoints: "5000",
    roiPercent: "50.00",
    costPerResponseMinor: "10000",
    ...overrides,
  };
}

describe("portfolioTotals", () => {
  it("sums cost, revenue and responses across campaigns", () => {
    const totals = portfolioTotals([
      summaryRow({ costMinor: "100000", revenueMinor: "150000", responses: 10 }),
      summaryRow({ campaignId: "b", costMinor: "50000", revenueMinor: "20000", responses: 4 }),
    ]);

    expect(totals.campaigns).toBe(2);
    expect(totals.costMinor).toBe("150000");
    expect(totals.revenueMinor).toBe("170000");
    expect(totals.netMinor).toBe("20000");
    expect(totals.responses).toBe(14);
  });

  it("recomputes portfolio ROI from summed money, not by averaging percentages", () => {
    // A tiny campaign at +900% next to a large one at -50%: averaging the two
    // percentages would report +425%, but the portfolio actually lost money.
    const totals = portfolioTotals([
      summaryRow({ costMinor: "100", revenueMinor: "1000", roiPercent: "900.00" }),
      summaryRow({ campaignId: "b", costMinor: "1000000", revenueMinor: "500000", roiPercent: "-50.00" }),
    ]);

    expect(totals.netMinor).toBe("-499100");
    // (501000 - 1000100) / 1000100 * 10000 = -4990 bp (truncated toward zero)
    expect(totals.roiBasisPoints).toBe("-4990");
  });

  it("keeps paise exact on crore-scale sums", () => {
    const totals = portfolioTotals([
      summaryRow({ costMinor: "999999999999999", revenueMinor: "1000000000000001" }),
    ]);

    expect(totals.netMinor).toBe("2");
  });

  it("reports ROI as null when nothing was spent", () => {
    const totals = portfolioTotals([summaryRow({ costMinor: "0", revenueMinor: "5000" })]);
    expect(totals.roiBasisPoints).toBeNull();
  });

  it("returns a zeroed portfolio for no campaigns", () => {
    expect(portfolioTotals([])).toEqual({
      campaigns: 0,
      costMinor: "0",
      revenueMinor: "0",
      netMinor: "0",
      responses: 0,
      roiBasisPoints: null,
    });
  });

  it("treats a malformed money string as zero rather than throwing", () => {
    const totals = portfolioTotals([summaryRow({ costMinor: "not-a-number", revenueMinor: "1000" })]);
    expect(totals.costMinor).toBe("0");
    expect(totals.revenueMinor).toBe("1000");
  });
});

describe("roiVerdict", () => {
  it("separates a zero-spend campaign from a break-even one", () => {
    expect(roiVerdict({ costMinor: "0", netMinor: "0" })).toBe("unmeasured");
    expect(roiVerdict({ costMinor: "1000", netMinor: "0" })).toBe("breakeven");
  });

  it("classifies profit and loss", () => {
    expect(roiVerdict({ costMinor: "1000", netMinor: "500" })).toBe("profit");
    expect(roiVerdict({ costMinor: "1000", netMinor: "-500" })).toBe("loss");
  });
});

describe("formatRoiPercent", () => {
  it("signs a positive return and leaves a negative one alone", () => {
    expect(formatRoiPercent("50.00")).toBe("+50.00%");
    expect(formatRoiPercent("-12.50")).toBe("-12.50%");
  });

  it("shows an em dash when ROI is undefined", () => {
    expect(formatRoiPercent(null)).toBe("—");
    expect(formatRoiPercent(undefined)).toBe("—");
    expect(formatRoiPercent("")).toBe("—");
  });
});

describe("rankByNet", () => {
  it("orders biggest earner first and losses last", () => {
    const ranked = rankByNet([
      summaryRow({ campaignId: "loss", netMinor: "-9000" }),
      summaryRow({ campaignId: "small", netMinor: "100" }),
      summaryRow({ campaignId: "big", netMinor: "900000" }),
    ]);

    expect(ranked.map((r) => r.campaignId)).toEqual(["big", "small", "loss"]);
  });

  it("breaks ties on campaign id so the order is stable", () => {
    const ranked = rankByNet([
      summaryRow({ campaignId: "b", netMinor: "100" }),
      summaryRow({ campaignId: "a", netMinor: "100" }),
    ]);

    expect(ranked.map((r) => r.campaignId)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [summaryRow({ campaignId: "a", netMinor: "1" }), summaryRow({ campaignId: "b", netMinor: "2" })];
    rankByNet(rows);
    expect(rows.map((r) => r.campaignId)).toEqual(["a", "b"]);
  });
});

describe("periodLabel", () => {
  it("marks an open-ended period as ongoing", () => {
    expect(periodLabel({ periodStart: "2026-04-01", periodEnd: null })).toBe("2026-04-01 → ongoing");
  });

  it("renders a closed period as a range", () => {
    expect(periodLabel({ periodStart: "2026-04-01", periodEnd: "2026-06-30" })).toBe("2026-04-01 → 2026-06-30");
  });

  it("labels a period with no start date", () => {
    expect(periodLabel({ periodStart: null, periodEnd: null })).toBe("Unscheduled");
  });
});

describe("orderPeriods", () => {
  it("reads oldest period first", () => {
    const periods: CRMCampaignRoiPeriod[] = [
      { periodStart: "2026-07-01", periodEnd: null, costMinor: "1", revenueMinor: "1", netMinor: "0", responses: 0, roiBasisPoints: "0", roiPercent: "0.00", costPerResponseMinor: null },
      { periodStart: "2026-04-01", periodEnd: null, costMinor: "1", revenueMinor: "1", netMinor: "0", responses: 0, roiBasisPoints: "0", roiPercent: "0.00", costPerResponseMinor: null },
    ];

    expect(orderPeriods(periods).map((p) => p.periodStart)).toEqual(["2026-04-01", "2026-07-01"]);
  });
});
