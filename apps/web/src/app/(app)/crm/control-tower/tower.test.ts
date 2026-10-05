import { describe, it, expect } from "vitest";
import { hotExceptions, mergeRegionsByName, rankRegions, totalExceptionCount } from "./tower";

describe("P2-8 control tower FE helpers", () => {
  it("ranks regions by pipeline bigint", () => {
    expect(
      rankRegions([
        { region: "A", dealCount: 1, pipelineMinor: "10" },
        { region: "B", dealCount: 1, pipelineMinor: "100" },
      ]).map((r) => r.region),
    ).toEqual(["B", "A"]);
  });

  it("GAP-CRM-CONTROL-TOWER-04: treats a malformed pipeline string as 0 instead of throwing", () => {
    expect(() =>
      rankRegions([
        { region: "bad", dealCount: 1, pipelineMinor: "1.5" },
        { region: "good", dealCount: 1, pipelineMinor: "100" },
      ]),
    ).not.toThrow();
    const ranked = rankRegions([
      { region: "bad", dealCount: 1, pipelineMinor: "abc" },
      { region: "good", dealCount: 1, pipelineMinor: "100" },
    ]);
    // 'good' (100) sorts above 'bad' (treated as 0)
    expect(ranked.map((r) => r.region)).toEqual(["good", "bad"]);
  });

  it("GAP-CRM-CONTROL-TOWER-02: folds case/whitespace region variants into one row", () => {
    const merged = mergeRegionsByName([
      { region: "South", dealCount: 2, pipelineMinor: "100" },
      { region: " south ", dealCount: 3, pipelineMinor: "200" },
      { region: "North", dealCount: 1, pipelineMinor: "50" },
    ]);
    expect(merged).toHaveLength(2);
    const south = merged.find((r) => r.region.trim().toLowerCase() === "south");
    expect(south?.dealCount).toBe(5);
    expect(south?.pipelineMinor).toBe("300");
  });

  it("GAP-CRM-CONTROL-TOWER-02: a district with mixed case appears once after ranking", () => {
    const ranked = rankRegions([
      { region: "West", dealCount: 1, pipelineMinor: "10" },
      { region: "WEST", dealCount: 1, pipelineMinor: "20" },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.dealCount).toBe(2);
    expect(ranked[0]?.pipelineMinor).toBe("30");
  });

  it("surfaces high-severity exceptions first", () => {
    const ranked = hotExceptions([
      { id: "1", kind: "dormant_account", label: "d", severity: "medium", href: "/", count: 9 },
      { id: "2", kind: "overdue_follow_up", label: "o", severity: "high", href: "/", count: 1 },
    ]);
    expect(ranked[0]?.id).toBe("2");
    expect(totalExceptionCount(ranked)).toBe(10);
  });
});
