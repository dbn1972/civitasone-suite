import { describe, expect, it } from "vitest";
import type { CRMForecast } from "@civitasone/types";
import {
  averageWeightedDealMinor,
  probabilityBand,
  rankStages,
  stageSharePct,
  topContributingStage,
} from "./forecast";

function forecast(overrides: Partial<CRMForecast> = {}): CRMForecast {
  return {
    totalForecastMinor: "1000000",
    dealCount: 4,
    stages: [
      { stageId: "s1", stageName: "Qualified", probability: 40, weightedTotalMinor: "400000" },
      { stageId: "s2", stageName: "Negotiation", probability: 80, weightedTotalMinor: "500000" },
      { stageId: "s3", stageName: "Lead", probability: 10, weightedTotalMinor: "100000" },
    ],
    ...overrides,
  };
}

describe("stageSharePct", () => {
  it("returns the percentage share of the weighted total", () => {
    expect(stageSharePct("500000", "1000000")).toBe(50);
    expect(stageSharePct("250000", "1000000")).toBe(25);
  });

  it("keeps two decimal places", () => {
    expect(stageSharePct("1", "3")).toBe(33.33);
  });

  it("returns 0 when the total is zero rather than dividing by zero", () => {
    expect(stageSharePct("500000", "0")).toBe(0);
  });

  it("stays exact for crore-scale paise where float division would drift", () => {
    // 1 crore rupees = 10^9 paise; a third of it must not round to 33.34.
    expect(stageSharePct("333333333", "1000000000")).toBe(33.33);
  });

  it("treats malformed input as zero instead of throwing", () => {
    expect(stageSharePct("not-a-number", "1000")).toBe(0);
    expect(stageSharePct("", "")).toBe(0);
  });
});

describe("probabilityBand", () => {
  it("bands at the documented thresholds", () => {
    expect(probabilityBand(0)).toBe("low");
    expect(probabilityBand(29)).toBe("low");
    expect(probabilityBand(30)).toBe("medium");
    expect(probabilityBand(69)).toBe("medium");
    expect(probabilityBand(70)).toBe("high");
    expect(probabilityBand(100)).toBe("high");
  });
});

describe("rankStages", () => {
  it("orders stages by contribution, largest first", () => {
    const ranked = rankStages(forecast());
    expect(ranked.map((s) => s.stageName)).toEqual(["Negotiation", "Qualified", "Lead"]);
    expect(ranked[0].sharePct).toBe(50);
    expect(ranked[0].band).toBe("high");
    expect(ranked[2].band).toBe("low");
  });

  it("breaks ties on stage name so the order is stable", () => {
    const ranked = rankStages(forecast({
      totalForecastMinor: "200000",
      stages: [
        { stageId: "b", stageName: "Beta", probability: 50, weightedTotalMinor: "100000" },
        { stageId: "a", stageName: "Alpha", probability: 50, weightedTotalMinor: "100000" },
      ],
    }));
    expect(ranked.map((s) => s.stageName)).toEqual(["Alpha", "Beta"]);
  });

  it("returns an empty list for a forecast with no stages", () => {
    expect(rankStages(forecast({ stages: [], totalForecastMinor: "0", dealCount: 0 }))).toEqual([]);
  });
});

describe("topContributingStage", () => {
  it("returns the largest contributor", () => {
    expect(topContributingStage(forecast())?.stageName).toBe("Negotiation");
  });

  it("returns null when there is nothing in the forecast", () => {
    expect(topContributingStage(forecast({ stages: [], dealCount: 0 }))).toBeNull();
  });
});

describe("averageWeightedDealMinor", () => {
  it("divides the weighted total across the deal count", () => {
    expect(averageWeightedDealMinor(forecast())).toBe("250000");
  });

  it("returns 0 when there are no deals", () => {
    expect(averageWeightedDealMinor(forecast({ dealCount: 0 }))).toBe("0");
  });

  it("floors rather than producing a fractional paise value", () => {
    expect(averageWeightedDealMinor(forecast({ totalForecastMinor: "10", dealCount: 3 }))).toBe("3");
  });
});
