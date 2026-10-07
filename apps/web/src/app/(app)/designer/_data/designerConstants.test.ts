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

/**
 * GAP-DESIGNER-DETAIL-B1-01: blockStatuses derives a consistent status per
 * block from the definition, replacing inconsistent per-page ternaries.
 */
import { blockStatuses } from "./designerConstants";

describe("blockStatuses (GAP-DESIGNER-DETAIL-B1-01)", () => {
  it("marks b1 complete when all identity fields are present", () => {
    const s = blockStatuses({
      name: "Trade License",
      serviceKey: "tl",
      ownerDepartment: "Dept",
      slaDays: 21,
      channels: ["portal"],
    });
    expect(s.b1).toBe("complete");
  });

  it("marks b1 in-progress when some identity fields present", () => {
    const s = blockStatuses({
      name: "Trade License",
      serviceKey: "tl",
    });
    expect(s.b1).toBe("in-progress");
  });

  it("marks b1 empty with no data", () => {
    const s = blockStatuses({});
    expect(s.b1).toBe("empty");
  });

  it("marks b5 in-progress when feeModel set but no HOA", () => {
    const s = blockStatuses({ feeModel: "flat" });
    expect(s.b5).toBe("in-progress");
  });

  it("marks b5 complete with feeModel and hoaCode", () => {
    const s = blockStatuses({ feeModel: "flat", hoaCode: "4201" });
    expect(s.b5).toBe("complete");
  });

  it("marks b4 complete when workflowDefinitionId present", () => {
    const s = blockStatuses({ workflowDefinitionId: "wf-1" });
    expect(s.b4).toBe("complete");
  });
});
