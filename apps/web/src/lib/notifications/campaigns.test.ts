import { describe, it, expect } from "vitest";
import {
  formatRoiBps,
  campaignStatusLabel,
  normaliseCampaigns,
  normaliseMetrics,
  CAMPAIGN_STATUSES,
} from "./campaigns";

describe("formatRoiBps (MK-004)", () => {
  it("renders an em dash for null — never 0%", () => {
    expect(formatRoiBps(null)).toBe("—");
    // guard the exact anti-pattern the review cares about
    expect(formatRoiBps(null)).not.toBe("0%");
    expect(formatRoiBps(null)).not.toBe("0.0%");
  });

  it("renders 0.0% (no sign) for an exact zero", () => {
    expect(formatRoiBps(0)).toBe("0.0%");
  });

  it("renders positive figures with a leading +", () => {
    expect(formatRoiBps(4200)).toBe("+42.0%");
    expect(formatRoiBps(12500)).toBe("+125.0%");
  });

  it("renders one decimal place, integer-safe (no float drift)", () => {
    expect(formatRoiBps(4205)).toBe("+42.1%");
    expect(formatRoiBps(4204)).toBe("+42.0%");
  });

  it("renders negative ROI with a leading -", () => {
    expect(formatRoiBps(-1234)).toBe("-12.3%");
  });

  it("treats non-finite as unknown (—)", () => {
    expect(formatRoiBps(NaN)).toBe("—");
  });
});

describe("campaignStatusLabel / variant", () => {
  it("labels every known lifecycle status", () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(campaignStatusLabel(s)).not.toBe("Unknown");
    }
    expect(campaignStatusLabel("draft")).toBe("Draft");
    expect(campaignStatusLabel("sent")).toBe("Sent");
  });
  it("shows an unknown status verbatim", () => {
    expect(campaignStatusLabel("weird")).toBe("weird");
  });
});

describe("normalisers", () => {
  it("tolerates a { campaigns, total } wrapper and keeps budget a paise string", () => {
    const list = normaliseCampaigns({
      campaigns: [
        { id: "c1", name: "Alpha", status: "draft", budgetMinor: "500000", currency: "INR" },
        { id: "c2", name: "Beta", status: "sent", budgetMinor: 250000 },
      ],
      total: 2,
    });
    expect(list).toHaveLength(2);
    expect(list[0].budgetMinor).toBe("500000");
    // a numeric paise field is coerced to a string, never a float
    expect(list[1].budgetMinor).toBe("250000");
    expect(typeof list[1].budgetMinor).toBe("string");
  });

  it("drops rows without an id", () => {
    expect(normaliseCampaigns([{ name: "no id" }])).toHaveLength(0);
  });

  it("keeps roiBps null (does not coerce to 0) and money as paise strings", () => {
    const m = normaliseMetrics({
      campaignId: "c1",
      recipients: 100,
      delivered: 90,
      failed: 10,
      responses: 20,
      conversions: 5,
      budgetMinor: "500000",
      actualCostMinor: "0",
      attributedRevenueMinor: "1200000",
      roiBps: null,
    });
    expect(m?.roiBps).toBeNull();
    expect(m?.attributedRevenueMinor).toBe("1200000");
    expect(m?.recipients).toBe(100);
  });

  it("preserves a real roiBps integer", () => {
    const m = normaliseMetrics({ campaignId: "c1", roiBps: 4200 });
    expect(m?.roiBps).toBe(4200);
  });
});
