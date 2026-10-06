import { describe, it, expect } from "vitest";
import { scoreBand, riskScoreVariant, riskStatusVariant } from "./riskBands";

describe("GAP-PROJECTS-DETAIL-RISKS-02 scoreBand", () => {
  it("bands scores: 9+ critical, 4–8 medium, below 4 low", () => {
    expect(scoreBand(9)).toBe("critical");
    expect(scoreBand(12)).toBe("critical");
    expect(scoreBand(4)).toBe("medium");
    expect(scoreBand(8)).toBe("medium");
    expect(scoreBand(3)).toBe("low");
    expect(scoreBand(0)).toBe("low");
  });

  it("maps bands to pill tones", () => {
    expect(riskScoreVariant(9)).toBe("bad");
    expect(riskScoreVariant(4)).toBe("warn");
    expect(riskScoreVariant(1)).toBe("good");
  });
});

describe("GAP-PROJECTS-DETAIL-RISKS-03 riskStatusVariant (domain override)", () => {
  it("treats an OPEN risk as bad (unresolved) — not the global 'open'=good", () => {
    expect(riskStatusVariant("open")).toBe("bad");
    expect(riskStatusVariant("OPEN")).toBe("bad");
  });
  it("mitigated=good, occurred=bad, closed=mut", () => {
    expect(riskStatusVariant("mitigated")).toBe("good");
    expect(riskStatusVariant("occurred")).toBe("bad");
    expect(riskStatusVariant("closed")).toBe("mut");
  });
  it("returns undefined for an unknown status so the global map is used", () => {
    expect(riskStatusVariant("whatever")).toBeUndefined();
  });
});
