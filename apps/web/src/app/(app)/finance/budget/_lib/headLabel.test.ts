import { describe, it, expect } from "vitest";
import { budgetHeadLabel, UNKNOWN_HEAD } from "./headLabel";

describe("budgetHeadLabel", () => {
  it("renders code · name", () => {
    expect(budgetHeadLabel({ headCode: "3054", headName: "Roads and Bridges" })).toBe("3054 · Roads and Bridges");
  });
  it("falls back to whichever half is known", () => {
    expect(budgetHeadLabel({ headCode: "2202", headName: null })).toBe("2202");
    expect(budgetHeadLabel({ headCode: null, headName: "General Education" })).toBe("General Education");
  });
  it("never guesses: an unresolved head is explicitly unknown", () => {
    expect(budgetHeadLabel({})).toBe(UNKNOWN_HEAD);
    expect(budgetHeadLabel({ headCode: " ", headName: "" })).toBe(UNKNOWN_HEAD);
  });
});
