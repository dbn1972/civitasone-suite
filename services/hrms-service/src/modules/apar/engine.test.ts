import { describe, it, expect } from "vitest";
import { GRADE_BANDS, bandForGrade, computeOverallGrade } from "./engine.js";

// GAP-HR-APAR-DETAIL-05: GRADE_BANDS is the one table behind both
// bandForGrade() and the `gradeBands` the detail endpoint returns for the
// page's scale text, so the two cannot drift apart.
describe("APAR grade bands", () => {
  it("lists the bands highest first, ending in a catch-all with no lower bound", () => {
    const mins = GRADE_BANDS.map((b) => b.min);
    expect(mins).toEqual([9, 7, 5, 4, null]);
    expect(GRADE_BANDS.map((b) => b.band)).toEqual(["Outstanding", "Very Good", "Good", "Average", "Below Average"]);
  });

  it.each([
    [10, "Outstanding"], [9, "Outstanding"], [8.99, "Very Good"], [7, "Very Good"],
    [6.99, "Good"], [5, "Good"], [4.99, "Average"], [4, "Average"], [3.99, "Below Average"], [1, "Below Average"],
  ])("maps a grade of %s to %s", (grade, band) => {
    expect(bandForGrade(grade)).toBe(band);
  });

  it("computes the weighted grade (60/40 weights, scores 10 and 2 -> 6.8, Good) and its band", () => {
    const r = computeOverallGrade([
      { attribute: "Quality", weight: 60, score: 10 },
      { attribute: "Timeliness", weight: 40, score: 2 },
    ]);
    expect(r.overallGrade).toBe(6.8);
    expect(r.band).toBe("Good");
  });
});
