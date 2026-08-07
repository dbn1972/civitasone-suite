import { describe, expect, it } from "vitest";
import { hiddenBlocksForPattern, patternChangeImpact } from "./designerConstants";

describe("hiddenBlocksForPattern", () => {
  it("hides fee block for grievance pattern", () => {
    expect(hiddenBlocksForPattern("grievance").has("b5")).toBe(true);
  });

  it("hides eligibility and approval for collection pattern", () => {
    const hidden = hiddenBlocksForPattern("collection");
    expect(hidden.has("b3")).toBe(true);
    expect(hidden.has("b4")).toBe(true);
    expect(hidden.has("b6")).toBe(true);
  });
});

describe("patternChangeImpact", () => {
  it("reports blocks hidden when switching certificate to grievance", () => {
    const impact = patternChangeImpact("certificate", "grievance");
    expect(impact.hidden).toContain("Fee & Revenue");
    expect(impact.shown).toEqual([]);
  });

  it("reports blocks shown when switching collection to certificate", () => {
    const impact = patternChangeImpact("collection", "certificate");
    expect(impact.shown).toEqual(
      expect.arrayContaining(["Eligibility", "Approval Chain", "Documents"]),
    );
  });
});
