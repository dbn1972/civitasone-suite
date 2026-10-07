import { describe, it, expect } from "vitest";
import { parseConfidence, averageConfidence } from "./confidence";

describe("parseConfidence", () => {
  it("reads a percent string", () => {
    expect(parseConfidence("84%")).toBe(84);
    expect(parseConfidence("60")).toBe(60);
  });
  it("returns null for unreadable values", () => {
    expect(parseConfidence("n/a")).toBeNull();
    expect(parseConfidence("")).toBeNull();
    expect(parseConfidence(null)).toBeNull();
    expect(parseConfidence(undefined)).toBeNull();
  });
  it("clamps to 0..100", () => {
    expect(parseConfidence("140%")).toBe(100);
    expect(parseConfidence("-5")).toBe(0);
  });
});

describe("averageConfidence (GAP-ANALYTICS-AI-INSIGHTS-03)", () => {
  it("averages only readable values — unparsable rows do NOT count as 0", () => {
    // Old code did parseInt||0 -> (84+0+60)/3 = 48. Correct is (84+60)/2 = 72.
    expect(averageConfidence(["84%", "n/a", "60%"])).toBe(72);
  });
  it("returns null when nothing is parseable", () => {
    expect(averageConfidence(["n/a", "", null])).toBeNull();
  });
  it("returns null for an empty list", () => {
    expect(averageConfidence([])).toBeNull();
  });
});
